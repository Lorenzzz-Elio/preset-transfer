import { PT } from '../core/api-compat.js';
import { loadTransferSettings, saveTransferSettings } from '../settings/settings-manager.js';
import { init as startGlobalPresetListener, stop as stopGlobalPresetListener } from './global-listener.js';
import {
  getRegexBindingEnabled,
  setRegexBindingEnabled,
  getPresetRegexBindings,
  getDefaultRegexBindings,
  switchPresetRegexes,
} from './regex-binding.js';
import * as NativePanel from '../ui/native-panel.js';
import * as EntryGroupingUI from '../ui/entry-grouping-ui.js';
import * as RegexScriptGroupingUI from '../ui/regex-script-grouping-ui.js';
import * as WorldbookEntryGroupingUI from '../ui/worldbook-entry-grouping-ui.js';
import { unhookPresetSaveToProtectExtensions } from './entry-states.js';
import * as WorldbookGrouping from './worldbook-grouping.js';
import { setWorldbookCommonFeatureActive } from './worldbook-common-integration.js';

function getCurrentPresetName() {
  try {
    return PT.API.getLoadedPresetName?.() ?? null;
  } catch {
    return null;
  }
}

export function getTransferToolFeatureFlags() {
  const settings = loadTransferSettings();
  return {
    entryStatesPanelEnabled: settings.entryStatesPanelEnabled !== false,
    entryGroupingEnabled: settings.entryGroupingEnabled !== false,
    worldbookEntryGroupingEnabled: settings.worldbookEntryGroupingEnabled !== false,
    worldbookGroupingEnabled: settings.worldbookGroupingEnabled !== false,
    worldbookCommonEnabled: settings.worldbookCommonEnabled !== false,
    regexScriptGroupingEnabled: settings.regexScriptGroupingEnabled === true,
    regexBindingEnabled: getRegexBindingEnabled() !== false,
  };
}

export function setEntryStatesPanelEnabled(enabled) {
  const settings = loadTransferSettings();
  settings.entryStatesPanelEnabled = !!enabled;
  saveTransferSettings(settings);
}

export function setEntryGroupingEnabled(enabled) {
  const settings = loadTransferSettings();
  settings.entryGroupingEnabled = !!enabled;
  saveTransferSettings(settings);
}

export function setWorldbookEntryGroupingEnabled(enabled) {
  const settings = loadTransferSettings();
  settings.worldbookEntryGroupingEnabled = !!enabled;
  saveTransferSettings(settings);
}

export function setWorldbookGroupingEnabled(enabled) {
  const settings = loadTransferSettings();
  settings.worldbookGroupingEnabled = !!enabled;
  saveTransferSettings(settings);
}

export function setWorldbookCommonEnabled(enabled) {
  const settings = loadTransferSettings();
  settings.worldbookCommonEnabled = !!enabled;
  saveTransferSettings(settings);
}

export function setRegexScriptGroupingEnabled(enabled) {
  const settings = loadTransferSettings();
  settings.regexScriptGroupingEnabled = !!enabled;
  saveTransferSettings(settings);
}

export async function setRegexBindingFeatureEnabled(enabled) {
  const nextValue = !!enabled;
  const prevValue = getRegexBindingEnabled() !== false;
  if (nextValue === prevValue) return;

  setRegexBindingEnabled(nextValue);
  localStorage.setItem('preset-transfer-regex-binding-enabled', String(nextValue));

  // Apply effect immediately for the current preset to match legacy toggle behavior.
  try {
    const currentPreset = getCurrentPresetName();
    if (currentPreset) {
      if (nextValue) {
        await switchPresetRegexes(null, currentPreset);
      } else {
        const currentBindings = getPresetRegexBindings(currentPreset);
        await switchPresetRegexes(currentPreset, null, {
          fromBindings: currentBindings,
          toBindings: getDefaultRegexBindings(),
        });
      }
    }
  } catch {
    /* ignore */
  }
}

export function applyTransferToolFeatureToggles() {
  const flags = getTransferToolFeatureFlags();

  // Native preset-side panels
  NativePanel.syncNativePanelsWithFeatureFlags?.(flags);

  // Preset switch listener (needed for regex binding and native panels).
  if (flags.entryStatesPanelEnabled || flags.regexBindingEnabled) {
    startGlobalPresetListener();
  } else {
    stopGlobalPresetListener();
    unhookPresetSaveToProtectExtensions?.();
  }

  // Entry grouping UI
  if (flags.entryGroupingEnabled) {
    EntryGroupingUI.initEntryGrouping?.();
  } else {
    EntryGroupingUI.destroyEntryGrouping?.();
  }

  // Native Regex scripts grouping UI
  if (flags.regexScriptGroupingEnabled) {
    RegexScriptGroupingUI.initRegexScriptGroupingUi?.();
  } else {
    RegexScriptGroupingUI.destroyRegexScriptGroupingUi?.();
  }

  // Worldbook entry grouping UI (World Info editor entries list)
  if (flags.worldbookEntryGroupingEnabled) {
    WorldbookEntryGroupingUI.initWorldbookEntryGroupingUi?.();
  } else {
    WorldbookEntryGroupingUI.destroyWorldbookEntryGroupingUi?.();
  }

  // Worldbook dropdown grouping (Worlds/Lorebooks panel)
  if (flags.worldbookGroupingEnabled) {
    WorldbookGrouping.initWorldbookGrouping?.();
  } else {
    WorldbookGrouping.destroyWorldbookGrouping?.();
  }

  // Worldbook common favorites (World Info entry header + panel)
  void setWorldbookCommonFeatureActive(!!flags.worldbookCommonEnabled);
}
