import { getPresetTransferSettingsNode, trySaveSillyTavernSettings } from '../core/pt-extension-settings.js';

const STORAGE_KEY = 'preset-transfer-settings';
const EXTENSION_SETTINGS_KEY = 'transferToolsSettings';
const UPDATED_AT_KEY = '__ptSavedAt';

function getUpdatedAt(value) {
  const raw = value?.[UPDATED_AT_KEY];
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function hasNonDefaultPrefs(value) {
  if (!value || typeof value !== 'object') return false;
  const defaults = getDefaultSettings();
  const keys = [
    'autoCloseModal',
    'autoEnableEntry',
    'leftDisplayMode',
    'rightDisplayMode',
    'singleDisplayMode',
    'entryStatesPanelEnabled',
    'entryGroupingEnabled',
    'worldbookEntryGroupingEnabled',
    'worldbookGroupingEnabled',
    'worldbookCommonEnabled',
    'regexScriptGroupingEnabled',
    'presetAutoMigrateOnImportEnabled',
    'presetGitAutoUpdateEnabled',
  ];
  return keys.some((key) => Object.prototype.hasOwnProperty.call(value, key) && value[key] !== defaults[key]);
}

function getDefaultSettings() {
  return {
    autoCloseModal: true,
    autoEnableEntry: true,
    leftDisplayMode: 'default',
    rightDisplayMode: 'default',
    singleDisplayMode: 'default',
    entryStatesPanelEnabled: true,
    entryGroupingEnabled: true,
    worldbookEntryGroupingEnabled: true,
    worldbookGroupingEnabled: true,
    worldbookCommonEnabled: false,
    regexScriptGroupingEnabled: true,
    // Preset stitches automation
    presetAutoMigrateOnImportEnabled: true,
    presetGitAutoUpdateEnabled: false,
    presetGitSources: {},
    // Per-base stitch snapshot (single source-of-truth)
    presetStitchStateByBase: {},
    worldbookCommonAutoGlobalBooks: [],
    worldbookCharacterWorldCache: { version: 1, byAvatar: {} },
  };
}

function saveTransferSettings(settings) {
  const nextSettings = { ...getDefaultSettings(), ...(settings && typeof settings === 'object' ? settings : {}) };
  nextSettings[UPDATED_AT_KEY] = Date.now();

  // Prefer SillyTavern's server-synced extensionSettings (cross-browser).
  try {
    const { context, node } = getPresetTransferSettingsNode({ create: true });
    if (node) {
      node[EXTENSION_SETTINGS_KEY] = nextSettings;
      trySaveSillyTavernSettings(context);
    }
  } catch {
    // ignore
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSettings));
  } catch (error) {
    console.warn('保存设置失败:', error);
  }
}

function loadTransferSettings() {
  const defaults = getDefaultSettings();

  let sharedRaw = null;
  try {
    const { node } = getPresetTransferSettingsNode();
    const shared = node?.[EXTENSION_SETTINGS_KEY];
    if (shared && typeof shared === 'object') {
      sharedRaw = shared;
    }
  } catch {
    // ignore
  }

  let localRaw = null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') {
        localRaw = parsed;
      }
    }
  } catch (error) {
    console.warn('加载设置失败，使用默认设置:', error);
  }

  const sharedMerged = sharedRaw ? { ...defaults, ...sharedRaw } : null;
  const localMerged = localRaw ? { ...defaults, ...localRaw } : null;

  if (sharedMerged && localMerged) {
    const sharedAt = getUpdatedAt(sharedRaw);
    const localAt = getUpdatedAt(localRaw);

    if (localAt > sharedAt) {
      try {
        const { context, node } = getPresetTransferSettingsNode({ create: true });
        if (node) {
          node[EXTENSION_SETTINGS_KEY] = localMerged;
          trySaveSillyTavernSettings(context);
        }
      } catch {
        // ignore
      }
      return localMerged;
    }

    if (sharedAt > localAt) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sharedMerged));
      } catch {
        // ignore
      }
      return sharedMerged;
    }

    // Backward-compatible tie-break for older settings without timestamps.
    const sharedCustom = hasNonDefaultPrefs(sharedRaw);
    const localCustom = hasNonDefaultPrefs(localRaw);

    if (localCustom && !sharedCustom) {
      try {
        const { context, node } = getPresetTransferSettingsNode({ create: true });
        if (node) {
          node[EXTENSION_SETTINGS_KEY] = localMerged;
          trySaveSillyTavernSettings(context);
        }
      } catch {
        // ignore
      }
      return localMerged;
    }

    if (sharedCustom && !localCustom) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sharedMerged));
      } catch {
        // ignore
      }
      return sharedMerged;
    }

    return sharedMerged;
  }

  if (sharedMerged) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sharedMerged));
    } catch {
      // ignore
    }
    return sharedMerged;
  }

  if (localMerged) {
    // Best-effort migration: localStorage -> extensionSettings.
    try {
      const { context, node } = getPresetTransferSettingsNode({ create: true });
      if (node && (!node[EXTENSION_SETTINGS_KEY] || typeof node[EXTENSION_SETTINGS_KEY] !== 'object')) {
        node[EXTENSION_SETTINGS_KEY] = localMerged;
        trySaveSillyTavernSettings(context);
      }
    } catch {
      // ignore
    }
    return localMerged;
  }

  return defaults;
}

export {
  getDefaultSettings,
  saveTransferSettings,
  loadTransferSettings,
  STORAGE_KEY
};
