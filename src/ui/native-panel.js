import { hookPresetSaveToProtectExtensions } from '../features/entry-states.js';
import {
  ensureNativeEntryStatesPanelInjected,
  removeNativeEntryStatesPanel,
  updateNativeEntryStatesPanel,
  renderNativeEntryStatesContent,
  bindNativeEntryStatesPanelEvents,
  bindNativeEntryStatesMainPanelEvents,
} from './native-entry-states-panel.js';
import {
  ensureNativeRegexPanelInjected,
  removeNativeRegexPanel,
  updateNativeRegexPanel,
  renderNativePresetRegexContent,
  bindNativePresetRegexPanelEvents,
  openPresetRegexBindingManager,
  renderNativeRegexBindingContent,
  bindNativeRegexBindingPanelEvents,
  bindNativeRegexPanelEvents,
} from './native-regex-panel.js';

// 原生侧边面板注入控制
let nativePanelInjectAttempts = 0;
let nativePanelInjectTimer = null;
let lastNativePanelFlags = { entryStatesPanelEnabled: true, regexBindingEnabled: true };

function scheduleNativePanelSync() {
  if (nativePanelInjectTimer) {
    clearTimeout(nativePanelInjectTimer);
    nativePanelInjectTimer = null;
  }

  nativePanelInjectAttempts = 0;

  const trySync = () => {
    nativePanelInjectAttempts++;

    const flags = lastNativePanelFlags || {};
    const wantEntryStates = !!flags.entryStatesPanelEnabled;
    const wantRegex = !!flags.regexBindingEnabled;

    if (!wantEntryStates) removeNativeEntryStatesPanel();
    if (!wantRegex) removeNativeRegexPanel();

    if (wantEntryStates || wantRegex) {
      hookPresetSaveToProtectExtensions();
    }

    const entryOk = !wantEntryStates || ensureNativeEntryStatesPanelInjected();
    const regexOk = !wantRegex || ensureNativeRegexPanelInjected();

    if ((entryOk && regexOk) || nativePanelInjectAttempts >= 10) return;

    nativePanelInjectTimer = setTimeout(trySync, 500);
  };

  trySync();
}

function initNativeRegexPanelIntegration() {
  scheduleNativePanelSync();
}

function syncNativePanelsWithFeatureFlags(flags) {
  lastNativePanelFlags = {
    entryStatesPanelEnabled: !!flags?.entryStatesPanelEnabled,
    regexBindingEnabled: !!flags?.regexBindingEnabled,
  };

  if (!lastNativePanelFlags.entryStatesPanelEnabled) removeNativeEntryStatesPanel();
  if (!lastNativePanelFlags.regexBindingEnabled) removeNativeRegexPanel();

  if (nativePanelInjectTimer) {
    clearTimeout(nativePanelInjectTimer);
    nativePanelInjectTimer = null;
  }

  if (lastNativePanelFlags.entryStatesPanelEnabled || lastNativePanelFlags.regexBindingEnabled) {
    scheduleNativePanelSync();
  }
}

// 主题相关功能
// 这里导出的函数会通过 index.js 挂到 window.PresetTransfer.NativePanel 中
export {
  // 条目状态面板
  ensureNativeEntryStatesPanelInjected,
  removeNativeEntryStatesPanel,
  updateNativeEntryStatesPanel,
  renderNativeEntryStatesContent,
  bindNativeEntryStatesPanelEvents,
  bindNativeEntryStatesMainPanelEvents,
  // 正则绑定面板
  ensureNativeRegexPanelInjected,
  removeNativeRegexPanel,
  updateNativeRegexPanel,
  initNativeRegexPanelIntegration,
  syncNativePanelsWithFeatureFlags,
  renderNativePresetRegexContent,
  bindNativePresetRegexPanelEvents,
  openPresetRegexBindingManager,
  renderNativeRegexBindingContent,
  bindNativeRegexBindingPanelEvents,
  bindNativeRegexPanelEvents,
};

