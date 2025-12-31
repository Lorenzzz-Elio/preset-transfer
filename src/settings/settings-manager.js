import { getPresetTransferSettingsNode, trySaveSillyTavernSettings } from '../core/pt-extension-settings.js';

const STORAGE_KEY = 'preset-transfer-settings';
const EXTENSION_SETTINGS_KEY = 'transferToolsSettings';

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
    worldbookCommonEnabled: true,
    regexScriptGroupingEnabled: false,
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
  // Prefer SillyTavern's server-synced extensionSettings (cross-browser).
  try {
    const { node } = getPresetTransferSettingsNode();
    const shared = node?.[EXTENSION_SETTINGS_KEY];
    if (shared && typeof shared === 'object') {
      return { ...getDefaultSettings(), ...shared };
    }
  } catch {
    // ignore
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return getDefaultSettings();

    const parsed = JSON.parse(saved);
    const merged = { ...getDefaultSettings(), ...(parsed && typeof parsed === 'object' ? parsed : {}) };

    // One-time migration: localStorage -> extensionSettings.
    try {
      const { context, node } = getPresetTransferSettingsNode({ create: true });
      if (node && (!node[EXTENSION_SETTINGS_KEY] || typeof node[EXTENSION_SETTINGS_KEY] !== 'object')) {
        node[EXTENSION_SETTINGS_KEY] = merged;
        trySaveSillyTavernSettings(context);
      }
    } catch {
      // ignore
    }

    return merged;
  } catch (error) {
    console.warn('加载设置失败，使用默认设置:', error);
    return getDefaultSettings();
  }
}

export {
  getDefaultSettings,
  saveTransferSettings,
  loadTransferSettings,
  STORAGE_KEY
};
