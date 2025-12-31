import { getJQuery } from './utils.js';
import { integrateIntoExtensionsMenu, waitForExtensionsMenu } from './extensions-menu.js';

export async function initPresetTransferIntegration(deps = {}) {
  const {
    MainUI,
    Theme,
    checkForExtensionUpdate,
    initTransferToolsSettingsPanel,
    applyTransferToolFeatureToggles,
    initPresetStitchAutomation,
    initExportSanitizer,
    retryDelayMs = 3000,
  } = deps;

  try {
    console.log('预设转移工具开始初始化...');

    // Check for updates once per page load (no git operations here; only HTTP fetch).
    // If an update is available, the UI will show an update button when the modal is opened.
    checkForExtensionUpdate?.().catch(() => {});

    // Sanitize exports (strip migration metadata) for both native and extension exports.
    try {
      initExportSanitizer?.();
    } catch (e) {
      console.warn('初始化导出清理钩子失败:', e);
    }

    // Wait for extensions menu and jQuery to be ready
    await waitForExtensionsMenu();

    // Integrate into extensions menu
    integrateIntoExtensionsMenu({ MainUI });

    // Init theme settings (best-effort)
    try {
      Theme?.initializeThemeSettings?.();
    } catch (error) {
      console.log('主题初始化跳过：', error?.message);
    }

    // Inject “Transfer Tools” panel into the extensions settings page (best-effort)
    try {
      let settingsPanelAttempts = 0;
      const tryInitSettingsPanel = () => {
        settingsPanelAttempts++;
        const ok = initTransferToolsSettingsPanel?.();
        if (ok) return;
        if (settingsPanelAttempts < 10) setTimeout(tryInitSettingsPanel, 500);
      };
      tryInitSettingsPanel();
    } catch (e) {
      console.warn('注入转移工具设置面板失败:', e);
    }

    // Apply feature toggles (best-effort): native panel / preset listener / entry grouping
    try {
      applyTransferToolFeatureToggles?.();
    } catch (e) {
      console.warn('应用功能开关失败:', e);
    }

    // Preset stitch automation (import migration + optional git auto update)
    try {
      initPresetStitchAutomation?.();
    } catch (e) {
      console.warn('初始化预设缝合自动化失败:', e);
    }

    console.log('预设转移工具初始化完成');
  } catch (error) {
    console.error('初始化失败:', error);
    setTimeout(() => initPresetTransferIntegration(deps), retryDelayMs);
  }
}

export function startPresetTransferIntegration(deps = {}) {
  const start = async () => {
    await initPresetTransferIntegration(deps);
  };

  try {
    const $ = getJQuery?.() ?? window.jQuery;
    if (typeof $ === 'function') {
      $(start);
      return;
    }
  } catch {
    // fall back to DOMContentLoaded
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
    return;
  }

  void start();
}
