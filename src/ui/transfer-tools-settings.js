import { PT } from '../core/api-compat.js';
import { getJQuery } from '../core/utils.js';
import { getCssVar } from '../core/color-utils.js';
import { exportPresetBundle, importPresetBundle } from '../features/import-export.js';
import {
  applyTransferToolFeatureToggles,
  getTransferToolFeatureFlags,
  setEntryGroupingEnabled,
  setEntryStatesPanelEnabled,
  setRegexBindingFeatureEnabled,
  setRegexScriptGroupingEnabled,
  setWorldbookEntryGroupingEnabled,
  setWorldbookCommonEnabled,
  setWorldbookGroupingEnabled,
} from '../features/feature-toggles.js';

const CONTAINER_ID = 'preset-transfer-extension-settings';

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
            <div class="flex-container flexGap5 alignItemsCenter wide100p" style="flex-wrap: wrap;">
              <button id="pt-export-preset-bundle" class="menu_button" style="white-space: nowrap;">导出预设包</button>
              <button id="pt-import-preset-bundle" class="menu_button" style="white-space: nowrap;">导入预设包</button>
              <input type="file" id="pt-import-preset-bundle-file" accept=".json" style="display: none;">
            </div>
            <label class="checkbox_label alignItemsCenter flexGap5" for="pt-export-global-worldbooks">
              <input id="pt-export-global-worldbooks" type="checkbox" style="accent-color: ${themeAccentColor};" />
              <small>同时导出全局世界书</small>
            </label>
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
  $('#pt-enable-worldbook-grouping').prop('checked', !!flags.worldbookGroupingEnabled);
  $('#pt-enable-worldbook-entry-grouping').prop('checked', !!flags.worldbookEntryGroupingEnabled);
  $('#pt-enable-worldbook-common').prop('checked', !!flags.worldbookCommonEnabled);
}

function bindEvents() {
  const $ = getJQuery();

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

  const flags = getTransferToolFeatureFlags();
  syncUiFromFlags(flags);
  bindEvents();

  return true;
}
