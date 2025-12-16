import { PT } from '../core/api-compat.js';
import { getJQuery } from '../core/utils.js';
import { exportPresetBundle, importPresetBundle } from '../features/import-export.js';
import {
  applyTransferToolFeatureToggles,
  getTransferToolFeatureFlags,
  setEntryGroupingEnabled,
  setEntryStatesPanelEnabled,
  setRegexBindingFeatureEnabled,
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
              <button id="pt-export-preset-bundle" class="menu_button" style="white-space: nowrap;">导出预设正则包</button>
              <button id="pt-import-preset-bundle" class="menu_button" style="white-space: nowrap;">导入预设正则包</button>
              <input type="file" id="pt-import-preset-bundle-file" accept=".json" style="display: none;">
            </div>
            <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-entry-states-panel">
              <input id="pt-enable-entry-states-panel" type="checkbox" class="checkbox">
              <span>条目状态</span>
            </label>
            <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-regex-binding">
              <input id="pt-enable-regex-binding" type="checkbox" class="checkbox">
              <span>预设正则</span>
            </label>
            <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-entry-grouping">
              <input id="pt-enable-entry-grouping" type="checkbox" class="checkbox">
              <span>条目分组</span>
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
  $('#pt-enable-entry-grouping').prop('checked', !!flags.entryGroupingEnabled);
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

  $('#pt-enable-regex-binding')
    .off('input.pt')
    .on('input.pt', async function () {
      await setRegexBindingFeatureEnabled($(this).prop('checked'));
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
        await exportPresetBundle(presetName);
      } catch (e) {
        console.error('导出预设正则包失败', e);
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
        console.error('导入预设正则包失败', err);
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
