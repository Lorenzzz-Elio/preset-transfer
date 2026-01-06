import { extractPresetVersionInfo } from '../core/preset-name-utils.js';
import { loadTransferSettings } from '../settings/settings-manager.js';
import { extractStitchPatch } from '../preset/stitch-patch.js';
import { getStitchId } from '../preset/stitch-meta.js';
import * as SnapshotStorage from './snapshot-storage.js';

const STITCH_STATE_SCHEMA_VERSION = 1;

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
  return state && typeof state === 'object' ? state : null;
}

async function setStitchStateByBase(normalizedBase, state) {
  const key = String(normalizedBase ?? '').trim();
  if (!key) return false;

  return await SnapshotStorage.saveSnapshot(key, state);
}

function getStitchPatchSnapshotForBase(normalizedBase) {
  return getStitchStateByBase(normalizedBase).then(state => {
    const patch = state?.patch;
    if (!patch || typeof patch !== 'object') return null;
    return patch;
  }).catch(() => null);
}

async function recordStitchPatchSnapshot(presetName, presetData, options = {}) {
  const { now = Date.now(), force = false } = options;

  const settings = loadTransferSettings();
  if (settings.presetStitchSnapshotEnabled === false) return null;

  const name = String(presetName ?? '').trim();
  if (!name) return null;
  if (!presetData || typeof presetData !== 'object') return null;

  const info = extractPresetVersionInfo(name);
  if (!info?.normalizedBase || !info?.version) return null;

  if (!force && !hasAnyStitchMeta(presetData)) return null;

  const patch = extractStitchPatch(presetData, { compressForSnapshot: true });
  const stitchCount = countPatchStitches(patch);
  if (stitchCount === 0) return null;

  const state = {
    schema: STITCH_STATE_SCHEMA_VERSION,
    updatedAt: now,
    presetName: name,
    version: String(info.version),
    patch,
    stitchCount,
  };

  await setStitchStateByBase(info.normalizedBase, state);
  return state;
}

export {
  STITCH_STATE_SCHEMA_VERSION,
  countPatchStitches,
  hasAnyStitchMeta,
  getStitchStateByBase,
  setStitchStateByBase,
  getStitchPatchSnapshotForBase,
  recordStitchPatchSnapshot,
};

