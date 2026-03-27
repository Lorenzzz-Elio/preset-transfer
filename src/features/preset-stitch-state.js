import { arePresetsSameDifferentVersion, extractPresetVersionInfo } from '../core/preset-name-utils.js';
import { loadTransferSettings } from '../settings/settings-manager.js';
import { extractStitchPatch } from '../preset/stitch-patch.js';
import { getStitchId } from '../preset/stitch-meta.js';
import * as SnapshotStorage from './snapshot-storage.js';

const STITCH_STATE_SCHEMA_VERSION = 1;

function normalizeSnapshotPatch(patch) {
  if (!patch || typeof patch !== 'object') return null;

  return {
    ...patch,
    runs: (Array.isArray(patch.runs) ? patch.runs : [])
      .map(run => ({
        ...run,
        stitches: Array.isArray(run?.stitches) ? run.stitches : [],
      }))
      .filter(run => run.stitches.length > 0),
    uninserted: [],
  };
}

function countPatchStitches(patch) {
  if (!patch || typeof patch !== 'object') return 0;
  const runs = Array.isArray(patch.runs) ? patch.runs : [];
  const uninserted = Array.isArray(patch.uninserted) ? patch.uninserted : [];
  const inRuns = runs.reduce((acc, run) => acc + (Array.isArray(run?.stitches) ? run.stitches.length : 0), 0);
  return inRuns + uninserted.length;
}

function hasAnyStitchMeta(presetData) {
  const prompts = Array.isArray(presetData?.prompts) ? presetData.prompts : [];
  return prompts.some(p => !!getStitchId(p));
}

async function getStitchStateByBase(normalizedBase) {
  const key = String(normalizedBase ?? '').trim();
  if (!key) return null;

  const state = await SnapshotStorage.loadSnapshot(key);
  if (!state || typeof state !== 'object') return null;

  const patch = normalizeSnapshotPatch(state.patch);
  return {
    ...state,
    patch,
    stitchCount: countPatchStitches(patch),
  };
}

async function setStitchStateByBase(normalizedBase, state) {
  const key = String(normalizedBase ?? '').trim();
  if (!key) return false;

  return await SnapshotStorage.saveSnapshot(key, state);
}

async function getStitchPatchSnapshotForBase(normalizedBase) {
  try {
    const state = await getStitchStateByBase(normalizedBase);
    const patch = state?.patch;
    if (!patch || typeof patch !== 'object') return null;
    return patch;
  } catch {
    return null;
  }
}

async function recordStitchPatchSnapshot(presetName, presetData, options = {}) {
  const { now = Date.now(), force = false } = options;

  const settings = loadTransferSettings();
  if (settings.presetStitchSnapshotEnabled === false) return null;

  const name = String(presetName ?? '').trim();
  if (!name) return null;
  if (!presetData || typeof presetData !== 'object') return null;

  const info = extractPresetVersionInfo(name);
  if (!info?.normalizedBase) return null;

  if (!force && !hasAnyStitchMeta(presetData)) return null;

  const patch = normalizeSnapshotPatch(
    extractStitchPatch(presetData, { compressForSnapshot: true, includeUninserted: false }),
  );
  const stitchCount = countPatchStitches(patch);
  if (stitchCount === 0) return null;

  const state = {
    schema: STITCH_STATE_SCHEMA_VERSION,
    updatedAt: now,
    presetName: name,
    version: info?.version ? String(info.version) : '',
    patch,
    stitchCount,
  };

  await setStitchStateByBase(info.normalizedBase, state);
  return state;
}

async function syncStitchPatchSnapshot(presetName, presetData, options = {}) {
  const { now = Date.now(), force = false, deleteIfEmpty = true } = options;

  const settings = loadTransferSettings();
  if (settings.presetStitchSnapshotEnabled === false) return { status: 'disabled' };

  const name = String(presetName ?? '').trim();
  if (!name) return { status: 'missing_name' };
  if (!presetData || typeof presetData !== 'object') return { status: 'missing_data' };

  const info = extractPresetVersionInfo(name);
  if (!info?.normalizedBase) return { status: 'missing_base' };

  if (!force && !hasAnyStitchMeta(presetData)) {
    if (deleteIfEmpty) {
      await SnapshotStorage.deleteSnapshot(info.normalizedBase);
      return { status: 'deleted_empty_meta', normalizedBase: info.normalizedBase };
    }

    return { status: 'skipped_empty_meta', normalizedBase: info.normalizedBase };
  }

  const patch = normalizeSnapshotPatch(
    extractStitchPatch(presetData, { compressForSnapshot: true, includeUninserted: false }),
  );
  const stitchCount = countPatchStitches(patch);

  if (stitchCount === 0) {
    if (deleteIfEmpty) {
      await SnapshotStorage.deleteSnapshot(info.normalizedBase);
      return { status: 'deleted_empty_patch', normalizedBase: info.normalizedBase };
    }

    return { status: 'skipped_empty_patch', normalizedBase: info.normalizedBase };
  }

  const state = {
    schema: STITCH_STATE_SCHEMA_VERSION,
    updatedAt: now,
    presetName: name,
    version: info?.version ? String(info.version) : '',
    patch,
    stitchCount,
  };

  await setStitchStateByBase(info.normalizedBase, state);
  return {
    status: 'saved',
    normalizedBase: info.normalizedBase,
    stitchCount,
    state,
  };
}

export {
  STITCH_STATE_SCHEMA_VERSION,
  countPatchStitches,
  hasAnyStitchMeta,
  getStitchStateByBase,
  setStitchStateByBase,
  getStitchPatchSnapshotForBase,
  findBestStitchPatchSnapshotForPresetName,
  recordStitchPatchSnapshot,
  syncStitchPatchSnapshot,
  normalizeSnapshotPatch,
};

async function findBestStitchPatchSnapshotForPresetName(presetName, options = {}) {
  const { threshold = 0.82 } = options;

  const targetName = String(presetName ?? '').trim();
  if (!targetName) return null;

  const targetInfo = extractPresetVersionInfo(targetName);
  if (!targetInfo?.normalizedBase) return null;

  let snapshots = [];
  try {
    snapshots = await SnapshotStorage.getAllSnapshots();
  } catch {
    snapshots = [];
  }

  let best = null;

  for (const snap of snapshots) {
    const candidateName = String(snap?.presetName ?? '').trim();
    if (!candidateName) continue;

    const patch = normalizeSnapshotPatch(snap?.patch);
    if (!patch || typeof patch !== 'object') continue;

    if (countPatchStitches(patch) === 0) continue;

    const match = arePresetsSameDifferentVersion(targetName, candidateName, { threshold });
    if (!match?.match) continue;

    const similarity = typeof match.similarity === 'number' ? match.similarity : 0;
    const updatedAt = typeof snap?.updatedAt === 'number' ? snap.updatedAt : 0;

    if (!best || similarity > best.similarity || (similarity === best.similarity && updatedAt > best.updatedAt)) {
      best = {
        normalizedBase: String(snap?.normalizedBase ?? '').trim(),
        presetName: candidateName,
        patch,
        similarity,
        updatedAt,
      };
    }
  }

  if (!best?.normalizedBase) return null;

  return {
    base: best.normalizedBase,
    presetName: best.presetName,
    patch: best.patch,
    similarity: best.similarity,
  };
}
