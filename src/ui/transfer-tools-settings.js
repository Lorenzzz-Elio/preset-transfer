import { PT } from '../core/api-compat.js';
import { getJQuery } from '../core/utils.js';
import { getCssVar } from '../core/color-utils.js';
import { exportPresetBundle, importPresetBundle } from '../features/import-export.js';
import {
  createSnapshotManagementPanel,
  initSnapshotManagementPanel,
} from './snapshot-management-panel.js';
import {
  getPresetAutomationSettings,
  setPresetAutoMigrateOnImportEnabled,
} from '../features/preset-stitch-settings.js';
import {
  applyTransferToolFeatureToggles,
  getTransferToolFeatureFlags,
  setEntryGroupingEnabled,
  setEntryMoreBtnEnabled,
  setEntryStatesPanelEnabled,
  setRegexBindingFeatureEnabled,
  setRegexScriptGroupingEnabled,
  setWorldbookEntryGroupingEnabled,
  setWorldbookCommonEnabled,
  setWorldbookGroupingEnabled,
  setThemeGroupingEnabled,
  setPresetListGroupingEnabled,
} from '../features/feature-toggles.js';

const CONTAINER_ID = 'preset-transfer-extension-settings';

const TRANSFER_TOOLS_TAB_STORAGE_KEY = 'preset-transfer-transfer-tools-active-tab';
const TRANSFER_TOOLS_TAB_KEYS = ['features', 'snapshots', 'io'];

function getSettingsHost() {
  const $ = getJQuery();
  const left = $('#extensions_settings');
  if (left.length) return left;
  const right = $('#extensions_settings2');
  return right;
}

function getCurrentPresetName() {
  try {
    return PT.API.getLoadedPresetName?.() ?? null;
  } catch {
    return null;
  }
}

function initPresetChangeAutoRefresh() {
  const parentWindow = window.parent && window.parent !== window ? window.parent : window;
  if (parentWindow.__ptTransferToolsPresetRefreshBound) return;
  parentWindow.__ptTransferToolsPresetRefreshBound = true;

  const refresh = () => {
    try {
      setTimeout(() => syncPresetAutomationUi(), 0);
    } catch {
      /* ignore */
    }
  };

  try {
    PT.API.eventOn?.('preset_changed', refresh);
    PT.API.eventOn?.('oai_preset_changed_after', refresh);
  } catch {
    /* ignore */
  }
}

function normalizeTransferToolsTabKey(value) {
  const key = String(value ?? '').trim();
  return TRANSFER_TOOLS_TAB_KEYS.includes(key) ? key : 'features';
}

function getSavedTransferToolsTabKey() {
  try {
    return normalizeTransferToolsTabKey(localStorage.getItem(TRANSFER_TOOLS_TAB_STORAGE_KEY));
  } catch {
    return 'features';
  }
}

function setSavedTransferToolsTabKey(value) {
  try {
    localStorage.setItem(TRANSFER_TOOLS_TAB_STORAGE_KEY, normalizeTransferToolsTabKey(value));
  } catch {
    /* ignore */
  }
}

function applyTransferToolsTabKey(tabKey, { persist = true } = {}) {
  const $ = getJQuery();
  const $root = $(`#${CONTAINER_ID}`);
  if (!$root.length) return;

  const nextKey = normalizeTransferToolsTabKey(tabKey);
  $root.attr('data-pt-transfer-tools-tab', nextKey);

  $root.find('.pt-transfer-tools-tab').each(function () {
    const $tab = $(this);
    const key = normalizeTransferToolsTabKey($tab.data('ptTab'));
    const isActive = key === nextKey;
    $tab.toggleClass('is-active', isActive);
    $tab.attr('aria-selected', isActive ? 'true' : 'false');
    $tab.attr('tabindex', isActive ? '0' : '-1');
  });

  $root.find('.pt-transfer-tools-panel').each(function () {
    const $panel = $(this);
    const key = normalizeTransferToolsTabKey($panel.data('ptTabPanel'));
    const isActive = key === nextKey;
    $panel.toggleClass('is-hidden', !isActive);
    $panel.attr('aria-hidden', isActive ? 'false' : 'true');
  });

  if (persist) setSavedTransferToolsTabKey(nextKey);
}

function renderPanel() {
  const themeAccentColor = getCssVar('--SmartThemeEmColor', 'currentColor');
  return `
    <div id="${CONTAINER_ID}" class="extension_container">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>转移工具</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          <div class="flex-container flexFlowColumn flexGap5">
            <div class="pt-transfer-tools-tabbar" role="tablist" aria-label="转移工具标签页">
              <button
                id="pt-transfer-tools-tab-features"
                type="button"
                class="pt-transfer-tools-tab menu_button"
                role="tab"
                aria-controls="pt-transfer-tools-panel-features"
                data-pt-tab="features"
              >功能</button>
              <button
                id="pt-transfer-tools-tab-snapshots"
                type="button"
                class="pt-transfer-tools-tab menu_button"
                role="tab"
                aria-controls="pt-transfer-tools-panel-snapshots"
                data-pt-tab="snapshots"
              >快照管理</button>
              <button
                id="pt-transfer-tools-tab-io"
                type="button"
                class="pt-transfer-tools-tab menu_button"
                role="tab"
                aria-controls="pt-transfer-tools-panel-io"
                data-pt-tab="io"
              >导出导入</button>
            </div>

            <div
              id="pt-transfer-tools-panel-features"
              class="pt-transfer-tools-panel"
              role="tabpanel"
              aria-labelledby="pt-transfer-tools-tab-features"
              data-pt-tab-panel="features"
            >
              <div class="pt-transfer-tools-card flex-container flexFlowColumn flexGap5">
                <div class="pt-transfer-tools-card-title">功能开关</div>
                <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-entry-states-panel">
                  <input id="pt-enable-entry-states-panel" type="checkbox" style="accent-color: ${themeAccentColor};" />
                  <small>条目状态</small>
                </label>
                <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-regex-binding">
                  <input id="pt-enable-regex-binding" type="checkbox" style="accent-color: ${themeAccentColor};" />
                  <small>预设正则</small>
                </label>
                <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-regex-script-grouping">
                  <input id="pt-enable-regex-script-grouping" type="checkbox" style="accent-color: ${themeAccentColor};" />
                  <small>正则分组</small>
                </label>
                <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-entry-grouping">
                  <input id="pt-enable-entry-grouping" type="checkbox" style="accent-color: ${themeAccentColor};" />
                  <small>条目分组</small>
                </label>
                <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-entry-more-btn">
                  <input id="pt-enable-entry-more-btn" type="checkbox" style="accent-color: ${themeAccentColor};" />
                  <small>条目更多操作</small>
                </label>
                <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-worldbook-grouping">
                  <input id="pt-enable-worldbook-grouping" type="checkbox" style="accent-color: ${themeAccentColor};" />
                  <small>世界书分组查看</small>
                </label>
                <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-worldbook-entry-grouping">
                  <input id="pt-enable-worldbook-entry-grouping" type="checkbox" style="accent-color: ${themeAccentColor};" />
                  <small>世界书条目分组</small>
                </label>
                <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-worldbook-common">
                  <input id="pt-enable-worldbook-common" type="checkbox" style="accent-color: ${themeAccentColor};" />
                  <small>世界书常用</small>
                </label>
                <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-theme-grouping">
                  <input id="pt-enable-theme-grouping" type="checkbox" style="accent-color: ${themeAccentColor};" />
                  <small>UI主题分组</small>
                </label>
                <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-preset-list-grouping">
                  <input id="pt-enable-preset-list-grouping" type="checkbox" style="accent-color: ${themeAccentColor};" />
                  <small>AI响应预设分组</small>
                </label>
                <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-preset-auto-migrate-import">
                  <input id="pt-enable-preset-auto-migrate-import" type="checkbox" style="accent-color: ${themeAccentColor};" />
                  <small>导入新版本后自动迁移缝合</small>
                </label>
              </div>
            </div>

            <div
              id="pt-transfer-tools-panel-snapshots"
              class="pt-transfer-tools-panel is-hidden"
              role="tabpanel"
              aria-labelledby="pt-transfer-tools-tab-snapshots"
              data-pt-tab-panel="snapshots"
            >
              <!-- 快照管理面板内容将在这里动态插入 -->
            </div>

            <div
              id="pt-transfer-tools-panel-io"
              class="pt-transfer-tools-panel is-hidden"
              role="tabpanel"
              aria-labelledby="pt-transfer-tools-tab-io"
              data-pt-tab-panel="io"
            >
              <div class="pt-transfer-tools-card flex-container flexFlowColumn flexGap5">
                <div class="pt-transfer-tools-card-title">导出导入</div>
                <div class="flex-container flexGap5 alignItemsCenter wide100p" style="flex-wrap: wrap;">
                  <button id="pt-export-preset-bundle" class="menu_button" style="white-space: nowrap;">导出预设包</button>
                  <button id="pt-import-preset-bundle" class="menu_button" style="white-space: nowrap;">导入预设包</button>
                  <input type="file" id="pt-import-preset-bundle-file" accept=".json" style="display: none;">
                </div>
                <label class="checkbox_label alignItemsCenter flexGap5" for="pt-export-global-worldbooks">
                  <input id="pt-export-global-worldbooks" type="checkbox" style="accent-color: ${themeAccentColor};" />
                  <small>同时导出全局世界书</small>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function syncUiFromFlags(flags) {
  const $ = getJQuery();
  $('#pt-enable-entry-states-panel').prop('checked', !!flags.entryStatesPanelEnabled);
  $('#pt-enable-regex-binding').prop('checked', !!flags.regexBindingEnabled);
  $('#pt-enable-regex-script-grouping').prop('checked', !!flags.regexScriptGroupingEnabled);
  $('#pt-enable-entry-grouping').prop('checked', !!flags.entryGroupingEnabled);
  $('#pt-enable-entry-more-btn').prop('checked', !!flags.entryMoreBtnEnabled);
  $('#pt-enable-worldbook-grouping').prop('checked', !!flags.worldbookGroupingEnabled);
  $('#pt-enable-worldbook-entry-grouping').prop('checked', !!flags.worldbookEntryGroupingEnabled);
  $('#pt-enable-worldbook-common').prop('checked', !!flags.worldbookCommonEnabled);
  $('#pt-enable-theme-grouping').prop('checked', !!flags.themeGroupingEnabled);
  $('#pt-enable-preset-list-grouping').prop('checked', !!flags.presetListGroupingEnabled);
}

function syncPresetAutomationUi() {
  const $ = getJQuery();
  const settings = getPresetAutomationSettings();
  $('#pt-enable-preset-auto-migrate-import').prop('checked', !!settings.presetAutoMigrateOnImportEnabled);
}

function bindEvents() {
  const $ = getJQuery();

  const $root = $(`#${CONTAINER_ID}`);
  if ($root.length) {
    $root
      .off('click.pt-transfer-tools-tabs')
      .on('click.pt-transfer-tools-tabs', '.pt-transfer-tools-tab', function (e) {
        e.preventDefault();
        applyTransferToolsTabKey($(this).data('ptTab'), { persist: true });
      });

    applyTransferToolsTabKey(getSavedTransferToolsTabKey(), { persist: false });
  }

  $('#pt-enable-entry-states-panel')
    .off('input.pt')
    .on('input.pt', function () {
      setEntryStatesPanelEnabled($(this).prop('checked'));
      applyTransferToolFeatureToggles();
    });

  $('#pt-enable-entry-grouping')
    .off('input.pt')
    .on('input.pt', function () {
      setEntryGroupingEnabled($(this).prop('checked'));
      applyTransferToolFeatureToggles();
    });

  $('#pt-enable-entry-more-btn')
    .off('input.pt')
    .on('input.pt', function () {
      setEntryMoreBtnEnabled($(this).prop('checked'));
      applyTransferToolFeatureToggles();
    });

  $('#pt-enable-worldbook-grouping')
    .off('input.pt')
    .on('input.pt', function () {
      setWorldbookGroupingEnabled($(this).prop('checked'));
      applyTransferToolFeatureToggles();
    });

  $('#pt-enable-worldbook-entry-grouping')
    .off('input.pt')
    .on('input.pt', function () {
      setWorldbookEntryGroupingEnabled($(this).prop('checked'));
      applyTransferToolFeatureToggles();
    });

  $('#pt-enable-worldbook-common')
    .off('input.pt')
    .on('input.pt', function () {
      setWorldbookCommonEnabled($(this).prop('checked'));
      applyTransferToolFeatureToggles();
    });

  $('#pt-enable-theme-grouping')
    .off('input.pt')
    .on('input.pt', function () {
      setThemeGroupingEnabled($(this).prop('checked'));
      applyTransferToolFeatureToggles();
    });

  $('#pt-enable-regex-binding')
    .off('input.pt')
    .on('input.pt', async function () {
      await setRegexBindingFeatureEnabled($(this).prop('checked'));
      applyTransferToolFeatureToggles();
    });

  $('#pt-enable-regex-script-grouping')
    .off('input.pt')
    .on('input.pt', function () {
      setRegexScriptGroupingEnabled($(this).prop('checked'));
      applyTransferToolFeatureToggles();
    });

  $('#pt-enable-preset-list-grouping')
    .off('input.pt')
    .on('input.pt', function () {
      setPresetListGroupingEnabled($(this).prop('checked'));
      applyTransferToolFeatureToggles();
    });

  $('#pt-enable-preset-auto-migrate-import')
    .off('input.pt')
    .on('input.pt', function () {
      setPresetAutoMigrateOnImportEnabled($(this).prop('checked'));
    });

  $('#pt-export-preset-bundle')
    .off('click.pt')
    .on('click.pt', async function () {
      try {
        const presetName = getCurrentPresetName();
        if (!presetName) {
          if (window.toastr) toastr.error('请先选择一个预设');
          return;
        }
        const includeGlobalWorldbooks = $('#pt-export-global-worldbooks').prop('checked');
        await exportPresetBundle(presetName, { includeGlobalWorldbooks });
      } catch (e) {
        console.error('导出预设包失败', e);
        if (window.toastr) toastr.error('导出失败: ' + (e?.message ?? e));
      }
    });

  $('#pt-import-preset-bundle')
    .off('click.pt')
    .on('click.pt', function () {
      $('#pt-import-preset-bundle-file').trigger('click');
    });

  $('#pt-import-preset-bundle-file')
    .off('change.pt')
    .on('change.pt', async function (e) {
      const file = e?.target?.files?.[0];
      if (!file) return;
      try {
        await importPresetBundle(file);
      } catch (err) {
        console.error('导入预设包失败', err);
        if (window.toastr) toastr.error('导入失败: ' + (err?.message ?? err));
      } finally {
        $(this).val('');
      }
    });
}

export function initTransferToolsSettingsPanel() {
  const $ = getJQuery();
  const host = getSettingsHost();
  if (!host?.length) return false;
  if ($(`#${CONTAINER_ID}`).length) return true;

  host.append(renderPanel());

  // 插入快照管理面板内容
  $('#pt-transfer-tools-panel-snapshots').html(createSnapshotManagementPanel());

  const flags = getTransferToolFeatureFlags();
  syncUiFromFlags(flags);
  syncPresetAutomationUi();
  bindEvents();
  initPresetChangeAutoRefresh();

  // 初始化快照管理面板
  initSnapshotManagementPanel().catch(err => {
    console.error('[PresetTransfer] 初始化快照管理面板失败:', err);
  });

  return true;
}
