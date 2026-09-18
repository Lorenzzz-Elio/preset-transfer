import { PT } from '../core/api-compat.js';
import { getCurrentApiInfo, getParentWindow, getSillyTavernContext } from '../core/utils.js';
import {
  arePresetsSameDifferentVersion,
  compareVersions,
  extractPresetVersionInfo,
  normalizeVersion,
} from '../core/preset-name-utils.js';
import { getPresetTransferSettingsNode } from '../core/pt-extension-settings.js';
import { getDefaultSettings } from '../settings/settings-manager.js';
import { getPresetDataFromManager, switchToPreset } from '../preset/preset-manager.js';
import { extractStitchPatch, applyStitchPatch } from '../preset/stitch-patch.js';
import {
  countPatchStitches,
  findBestStitchPatchSnapshotForPresetName,
  getStitchPatchSnapshotForBase,
  hasAnyStitchMeta,
  recordStitchPatchSnapshot,
  syncStitchPatchSnapshot,
} from './preset-stitch-state.js';

const SKIP_AUTO_MIGRATE_KEY = '__ptPresetTransferSkipAutoMigrateUntilByPresetName';
const SKIP_AUTO_MIGRATE_DEFAULT_TTL_MS = 60 * 1000;

function loadAutomationSettings() {
  const defaults = getDefaultSettings();
  let sharedRaw = null;
  try {
    const { node } = getPresetTransferSettingsNode();
    const shared = node?.transferToolsSettings;
    if (shared && typeof shared === 'object') {
      sharedRaw = shared;
    }
  } catch {
    // ignore
  }
  return sharedRaw ? { ...defaults, ...sharedRaw } : defaults;
}

function getSkipAutoMigrateStore() {
  const pw = typeof getParentWindow === 'function' ? getParentWindow() : window;
  const store = pw?.[SKIP_AUTO_MIGRATE_KEY];
  if (store && typeof store === 'object') return store;
  const next = {};
  if (pw && typeof pw === 'object') {
    pw[SKIP_AUTO_MIGRATE_KEY] = next;
  }
  return next;
}

function markSkipAutoMigrateForPresetName(presetName, ttlMs = SKIP_AUTO_MIGRATE_DEFAULT_TTL_MS) {
  const name = String(presetName ?? '').trim();
  if (!name) return false;
  const ttl = Math.max(1000, Number(ttlMs) || SKIP_AUTO_MIGRATE_DEFAULT_TTL_MS);
  const store = getSkipAutoMigrateStore();
  store[name] = Date.now() + ttl;
  return true;
}

function shouldSkipAutoMigrateForPresetName(presetName) {
  const name = String(presetName ?? '').trim();
  if (!name) return false;
  const store = getSkipAutoMigrateStore();
  const until = store[name];
  if (typeof until !== 'number') return false;
  if (Date.now() <= until) return true;
  delete store[name];
  return false;
}

async function getUsableSnapshotPatchForPresetName(presetName) {
  const info = extractPresetVersionInfo(presetName);
  if (!info?.normalizedBase) return null;

  const patch = await getStitchPatchSnapshotForBase(info.normalizedBase);
  if (patch && countPatchStitches(patch) > 0) {
    return { base: info.normalizedBase, patch };
  }

  if (!info?.version) return null;

  // Base name may change across versions (e.g., adding/removing "Beta").
  // Fall back to fuzzy matching against snapshot metadata.
  const fuzzy = await findBestStitchPatchSnapshotForPresetName(presetName);
  if (fuzzy?.patch && countPatchStitches(fuzzy.patch) > 0) {
    return { base: fuzzy.base, patch: fuzzy.patch };
  }

  return null;
}

function ensurePresetManagerSavePresetWrapped(presetManager) {
  if (!presetManager || typeof presetManager !== 'object') return false;
  if (presetManager.__ptSavePresetWrapped) return true;

  const original = presetManager.savePreset;
  if (typeof original !== 'function') return false;

  presetManager.__ptSavePresetWrapped = true;
  presetManager.__ptSavePresetOriginal = original;

  presetManager.savePreset = async function (...args) {
    const result = await original.apply(this, args);
    try {
      const [presetName, presetData] = args;
      await syncStitchPatchSnapshot(presetName, presetData);
    } catch {
      /* ignore */
    }
    return result;
  };

  return true;
}

function ensureKnownPresetManagersSavePresetWrapped() {
  const context = getSillyTavernContext();
  if (!context?.getPresetManager) return false;

  const presetManagerKeys = [
    'openai',
    'instruct',
    'context',
    'sysprompt',
    'textgenerationwebui',
    'reasoning',
    'kobold',
    'novel',
  ];

  let wrappedAny = false;
  for (const key of presetManagerKeys) {
    try {
      const manager = context.getPresetManager(key);
      if (manager && ensurePresetManagerSavePresetWrapped(manager)) {
        wrappedAny = true;
      }
    } catch {
      /* ignore */
    }
  }

  return wrappedAny;
}

function getApiInfoForPresetManager(presetManagerKey) {
  const context = getSillyTavernContext();
  const presetManager = context?.getPresetManager?.(presetManagerKey);
  if (!presetManager) return null;

  ensurePresetManagerSavePresetWrapped(presetManager);

  const { preset_names } = presetManager.getPresetList();
  const presetNames = Array.isArray(preset_names) ? preset_names : Object.keys(preset_names || {});

  return {
    apiType: presetManagerKey,
    presetManager,
    presetNames,
    context,
  };
}

function findBestSourcePreset(apiInfo, targetPresetName) {
  const candidates = Array.isArray(apiInfo?.presetNames) ? apiInfo.presetNames : [];
  const targetInfo = extractPresetVersionInfo(targetPresetName);
  if (!targetInfo?.version) return null;

  let best = null;

  for (const name of candidates) {
    if (!name || name === targetPresetName) continue;
    const match = arePresetsSameDifferentVersion(targetPresetName, name).match;
    if (!match) continue;

    let data;
    try {
      data = getPresetDataFromManager(apiInfo, name);
    } catch {
      continue;
    }
    if (!hasAnyStitchMeta(data)) continue;

    const info = extractPresetVersionInfo(name);
    if (!info?.version) continue;

    if (!best) {
      best = { name, version: info.version };
      continue;
    }

    if (compareVersions(info.version, best.version) > 0) {
      best = { name, version: info.version };
    }
  }

  return best?.name ?? null;
}


function confirmStitchMigration(message) {
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    return window.confirm(String(message ?? ''));
  }
  return true;
}

async function applyStitchesToData(apiInfo, sourcePresetName, targetData, options = {}) {
  const { toastPrefix = '', showSuccessToast = true, showNoOpToast = false, insertedEnabled } = options;

  const sourceData = getPresetDataFromManager(apiInfo, sourcePresetName);
  const patch = extractStitchPatch(sourceData);
  const stitchCount = countPatchStitches(patch);

  if (stitchCount === 0) {
    if (showNoOpToast && window.toastr) {
      window.toastr.info(`${toastPrefix}未检测到可迁移的缝合条目`);
    }
    return { stitchCount: 0, applied: null };
  }

  const applied = applyStitchPatch(targetData, patch, { insertedEnabled });

  if (showSuccessToast && window.toastr) {
    window.toastr.success(
      `${toastPrefix}缝合已迁移：${stitchCount} 条（新增 ${applied.addedPrompts}，更新 ${applied.updatedPrompts}）`,
    );
  }

  return { stitchCount, applied };
}

async function applyStitchesPatchToPreset(apiInfo, patch, targetPresetName, options = {}) {
  const { switchToTarget = false, toastPrefix = '', showSuccessToast = true, showNoOpToast = false, insertedEnabled } =
    options;

  const targetData = getPresetDataFromManager(apiInfo, targetPresetName);
  const stitchCount = countPatchStitches(patch);

  if (stitchCount === 0) {
    if (showNoOpToast && window.toastr) window.toastr.info(`${toastPrefix}未检测到可迁移的缝合条目`);
    return { stitchCount: 0, applied: null };
  }

  const applied = applyStitchPatch(targetData, patch, { insertedEnabled });

  await apiInfo.presetManager.savePreset(targetPresetName, targetData);

  if (showSuccessToast && window.toastr) {
    window.toastr.success(
      `${toastPrefix}缝合已迁移：${stitchCount} 条（新增 ${applied.addedPrompts}，更新 ${applied.updatedPrompts}）`,
    );
  }

  if (switchToTarget) {
    try {
      await switchToPreset(apiInfo, targetPresetName);
    } catch {
      /* ignore */
    }
  }

  return { stitchCount, applied };
}

async function migrateStitches(apiInfo, sourcePresetName, targetPresetName, options = {}) {
  const { switchToTarget = false, toastPrefix = '', insertedEnabled } = options;

  const targetData = getPresetDataFromManager(apiInfo, targetPresetName);
  const result = await applyStitchesToData(apiInfo, sourcePresetName, targetData, {
    toastPrefix,
    showSuccessToast: true,
    showNoOpToast: false,
    insertedEnabled,
  });

  if (result.stitchCount === 0) {
    return result;
  }

  await apiInfo.presetManager.savePreset(targetPresetName, targetData);

  if (switchToTarget) {
    try {
      await switchToPreset(apiInfo, targetPresetName);
    } catch {
      /* ignore */
    }
  }

  return result;
}


async function maybeAutoMigrateOnImport(apiInfo, newPresetName) {
  const settings = loadAutomationSettings();
  const enabled = settings.presetAutoMigrateOnImportEnabled === true;
  if (!enabled) return false;

  if (shouldSkipAutoMigrateForPresetName(newPresetName)) return false;

  const info = extractPresetVersionInfo(newPresetName);
  if (!info?.version) return false;

  const snapshot = await getUsableSnapshotPatchForPresetName(newPresetName);
  if (snapshot?.patch) {
    const stitchCount = countPatchStitches(snapshot.patch);
    if (stitchCount > 0) {
      const ok = confirmStitchMigration(
        `检测到预设“${newPresetName}”可迁移 ${stitchCount} 条缝合（来源：快照）。\n\n是否执行自动迁移？\n\n【确定】迁移\n【取消】跳过（不修改该预设）`,
      );
      if (!ok) {
        if (window.toastr) window.toastr.info('[导入自动] 已取消缝合迁移');
        return true;
      }
    }
    await applyStitchesPatchToPreset(apiInfo, snapshot.patch, newPresetName, {
      switchToTarget: false,
      toastPrefix: '[导入自动] ',
      showSuccessToast: true,
      showNoOpToast: false,
      insertedEnabled: false,
    });
    return true;
  }

  const sourcePresetName = findBestSourcePreset(apiInfo, newPresetName);
  if (!sourcePresetName) return false;

  try {
    const sourceData = getPresetDataFromManager(apiInfo, sourcePresetName);
    const patch = extractStitchPatch(sourceData);
    const stitchCount = countPatchStitches(patch);
    if (stitchCount > 0) {
      const ok = confirmStitchMigration(
        `检测到预设“${newPresetName}”可迁移 ${stitchCount} 条缝合（来源：${sourcePresetName}）。\n\n是否执行自动迁移？\n\n【确定】迁移\n【取消】跳过（不修改该预设）`,
      );
      if (!ok) {
        if (window.toastr) window.toastr.info('[导入自动] 已取消缝合迁移');
        return true;
      }
    }
  } catch {
    // If we fail to pre-calc stitch count, fall back to existing behavior.
  }

  await migrateStitches(apiInfo, sourcePresetName, newPresetName, {
    switchToTarget: false,
    toastPrefix: '[导入自动] ',
    insertedEnabled: false,
  });
  return true;
}

let state = {
  active: false,
  pollTimer: null,
  knownPresets: new Set(),
  processedImports: new Map(),
  importInProgress: new Set(),
};

function markImportProcessed(name) {
  if (!name) return;
  state.processedImports.set(String(name), Date.now());
}

function wasImportProcessedRecently(name, windowMs = 15000) {
  if (!name) return false;
  const key = String(name);
  const last = state.processedImports.get(key);
  if (!last) return false;

  const elapsed = Date.now() - last;
  if (elapsed > windowMs) {
    state.processedImports.delete(key);
    return false;
  }

  return true;
}

function refreshKnownPresets(apiInfo) {
  const names = Array.isArray(apiInfo?.presetNames) ? apiInfo.presetNames : [];
  state.knownPresets = new Set(names);
}

async function pollPresetList() {
  ensureKnownPresetManagersSavePresetWrapped();

  const settings = loadAutomationSettings();
  const wantImport = settings.presetAutoMigrateOnImportEnabled === true;
  if (!wantImport) return;

  const apiInfo = getCurrentApiInfo();
  if (!apiInfo) return;

  const names = Array.isArray(apiInfo.presetNames) ? apiInfo.presetNames : [];
  const current = new Set(names);

  const added = [];
  for (const name of current) {
    if (!state.knownPresets.has(name)) added.push(name);
  }

  if (added.length === 0) {
    state.knownPresets = current;
    return;
  }

  for (const name of added) {
    if (!name) continue;
    if (shouldSkipAutoMigrateForPresetName(name)) continue;
    if (wasImportProcessedRecently(name)) continue;
    if (state.importInProgress.has(name)) continue;
    state.importInProgress.add(name);
    try {
      await maybeAutoMigrateOnImport(apiInfo, name);
      markImportProcessed(name);
    } catch (error) {
      console.error('[PresetTransfer] 导入自动迁移失败:', error);
      if (window.toastr) window.toastr.error('[导入自动] 迁移失败: ' + (error?.message ?? error));
    } finally {
      state.importInProgress.delete(name);
    }
  }

  state.knownPresets = current;
}


function findSourcePresetForOaiImport(apiInfo, importingPresetName) {
  if (!apiInfo || !importingPresetName) return null;

  // Prefer overwriting scenario: reuse the existing preset with the same name as the source if it has stitches.
  try {
    const existing = getPresetDataFromManager(apiInfo, importingPresetName);
    if (hasAnyStitchMeta(existing)) {
      return importingPresetName;
    }
  } catch {
    // ignore
  }

  return findBestSourcePreset(apiInfo, importingPresetName);
}

async function handleOaiPresetImportReady(payload) {
  const settings = loadAutomationSettings();
  const enabled = settings.presetAutoMigrateOnImportEnabled === true;
  if (!enabled) return;

  const presetName =
    typeof payload === 'string'
      ? payload
      : payload && typeof payload === 'object'
        ? payload.presetName || payload.name || payload.preset
        : null;
  const data = payload && typeof payload === 'object' ? payload.data : null;

  if (!presetName || !data || typeof data !== 'object') return;
  if (shouldSkipAutoMigrateForPresetName(presetName)) return;

  // Only run for versioned presets.
  const info = extractPresetVersionInfo(presetName);
  if (!info?.version) return;

  const apiInfo = getApiInfoForPresetManager('openai');
  if (!apiInfo) return;

  if (state.importInProgress.has(presetName)) return;
  state.importInProgress.add(presetName);

  try {
    const snapshot = await getUsableSnapshotPatchForPresetName(presetName);
    const patch = snapshot?.patch ?? null;

    let result = { stitchCount: 0, applied: null };
    let sourcePreset = snapshot?.base ? '[snapshot]' : null;

    if (patch) {
      const stitchCount = countPatchStitches(patch);
      if (stitchCount > 0) {
        const ok = confirmStitchMigration(
          `检测到导入的预设“${presetName}”可迁移 ${stitchCount} 条缝合（来源：快照）。\n\n是否执行自动迁移？\n\n【确定】迁移\n【取消】跳过（保持导入内容不变）`,
        );
        if (!ok) {
          if (window.toastr) window.toastr.info('[导入自动] 已取消缝合迁移');
          markImportProcessed(presetName);
          return;
        }
        const applied = applyStitchPatch(data, patch, { insertedEnabled: false });
        result = { stitchCount, applied };
      }
    } else {
      sourcePreset = findSourcePresetForOaiImport(apiInfo, presetName);
      if (!sourcePreset) {
        console.info('[PresetTransfer] 导入自动迁移：未找到缝合源预设:', presetName);
        if (window.toastr) window.toastr.info('[导入自动] 未找到可迁移的缝合源预设');
        markImportProcessed(presetName);
        return;
      }

      try {
        const sourceData = getPresetDataFromManager(apiInfo, sourcePreset);
        const sourcePatch = extractStitchPatch(sourceData);
        const stitchCount = countPatchStitches(sourcePatch);
        if (stitchCount > 0) {
          const ok = confirmStitchMigration(
            `检测到导入的预设“${presetName}”可迁移 ${stitchCount} 条缝合（来源：${sourcePreset}）。\n\n是否执行自动迁移？\n\n【确定】迁移\n【取消】跳过（保持导入内容不变）`,
          );
          if (!ok) {
            if (window.toastr) window.toastr.info('[导入自动] 已取消缝合迁移');
            markImportProcessed(presetName);
            return;
          }
        }
      } catch {
        // If we fail to pre-calc stitch count, fall back to existing behavior.
      }

      result = await applyStitchesToData(apiInfo, sourcePreset, data, {
        toastPrefix: '[导入自动] ',
        showSuccessToast: false,
        showNoOpToast: false,
        insertedEnabled: false,
      });
    }

    if (result.stitchCount === 0) {
      if (window.toastr) window.toastr.info('[导入自动] 未检测到可迁移的缝合条目');
      markImportProcessed(presetName);
      return;
    }

    // Persist a single source-of-truth snapshot for this base.
    recordStitchPatchSnapshot(presetName, data, { force: true });

    if (window.toastr) {
      window.toastr.success(
        `[导入自动] 缝合已迁移：${result.stitchCount} 条（新增 ${result.applied?.addedPrompts ?? 0}，更新 ${result.applied?.updatedPrompts ?? 0}）`,
      );
    }

    markImportProcessed(presetName);
    console.info('[PresetTransfer] 导入自动迁移完成:', {
      presetName,
      sourcePreset,
      stitchCount: result.stitchCount,
    });
  } catch (error) {
    console.error('[PresetTransfer] 导入自动迁移失败:', error);
    if (window.toastr) window.toastr.error('[导入自动] 迁移失败: ' + (error?.message ?? error));
  } finally {
    state.importInProgress.delete(presetName);
  }
}

function initPresetStitchAutomation() {
  if (state.active) return true;

  const apiInfo = getCurrentApiInfo();
  if (apiInfo) {
    refreshKnownPresets(apiInfo);
    ensurePresetManagerSavePresetWrapped(apiInfo.presetManager);
  }

  ensureKnownPresetManagersSavePresetWrapped();

  // Mark the currently loaded preset as "known" so import auto-migrate won't treat it as a new import on startup.
  try {
    const currentName = PT.API.getLoadedPresetName?.() ?? null;
    if (currentName) markSkipAutoMigrateForPresetName(String(currentName), 5000);
  } catch {
    /* ignore */
  }

  // Import/list watcher (polling, light-weight).
  state.pollTimer = setInterval(() => {
    void pollPresetList();
  }, 2000);

  // Best-effort event hooks; environments differ.
  try {
    PT.API.eventOn?.('oai_preset_import_ready', payload => void handleOaiPresetImportReady(payload));
  } catch {
    /* ignore */
  }

  state.active = true;
  return true;
}

export {
  initPresetStitchAutomation,
  migrateStitches,
  maybeAutoMigrateOnImport,
  ensurePresetManagerSavePresetWrapped,
  ensureKnownPresetManagersSavePresetWrapped,
};
