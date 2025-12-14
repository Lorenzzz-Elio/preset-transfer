import { PT } from '../core/api-compat.js';
import { getJQuery } from '../core/utils.js';
import {
  getRegexBindingEnabled,
  setRegexBindingEnabled,
  getPresetRegexBindings,
  getAllAvailableRegexes,
} from '../features/regex-binding.js';

function ensureNativeRegexPanelInjected() {
  const $ = getJQuery();
  const container = $('#openai_api-presets');
  if (!container.length) return false;
  if ($('#st-native-regex-panel').length) return true;

  if (!$('#st-native-regex-styles').length) {
    $('head').append(`
      <style id="st-native-regex-styles">
        #st-native-regex-panel { margin-top: 10px; }
        #st-native-regex-panel .header { display: flex; align-items: center; gap: 8px; padding: 8px 0; }
        #st-native-regex-panel .header .title { font-weight: 600; }
        #st-native-regex-panel .rb-group { margin-bottom: 8px; }
        #st-native-regex-panel .rb-group-title { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px 10px; user-select: none; }
        #st-native-regex-panel .rb-group-toggle { width: 16px; text-align: center; }
        #st-native-regex-panel .rb-group-name { flex: 1; }
        #st-native-regex-panel .rb-group-count { opacity: 0.7; font-size: 12px; }
        #st-native-regex-panel .rb-group-content.collapsed { display: none; }
        #st-native-regex-panel .rb-label { display: flex; align-items: center; gap: 8px; padding: 6px 10px; }
        #st-native-regex-panel .rb-label .name { flex: 1; }
        #st-native-regex-panel .rb-label .badge { padding: 2px 6px; border-radius: 3px; font-size: 11px; white-space: nowrap; }
        #st-native-regex-panel .rb-label.unbound .badge { opacity: 0.6; }
        #st-native-regex-panel .rb-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
        #st-native-regex-panel .rb-toolbar input { flex: 1; min-width: 160px; }
        #st-native-regex-panel .rb-toolbar button, #st-native-regex-panel .rb-group-batch-btn { white-space: nowrap; }
        #st-native-regex-panel .content::-webkit-scrollbar { display: none; }
        #st-native-regex-panel .content { scrollbar-width: none; -ms-overflow-style: none; }
      </style>
    `);
  }

  const html = `
    <div id="st-native-regex-panel">
      <div class="header" style="display: flex; align-items: center; gap: 4px;">
        <button id="st-regex-toggle" class="menu_button" title="展开/折叠">▶</button>
        <span class="title">正则绑定</span>
        <div style="flex:1;"></div>
        <button id="export-preset-bundle" class="menu_button" style="font-size: 11px; padding: 2px 6px; display: inline-block; white-space: nowrap;" title="导出预设+正则包">导出预设</button>
        <button id="import-preset-bundle" class="menu_button" style="font-size: 11px; padding: 2px 6px; display: inline-block; white-space: nowrap;" title="导入预设+正则包">导入预设</button>
        <input type="file" id="import-preset-bundle-file" accept=".json" style="display: none;">
        <button id="regex-binding-switch" class="menu_button" title="开启/关闭正则绑定功能">${
          getRegexBindingEnabled() ? '●' : '○'
        }</button>
      </div>
      <div class="content" style="display:none; max-height:50vh; overflow:auto; padding:10px;">
        <div id="st-regex-binding-status" style="opacity: .9;">加载中...</div>
      </div>
    </div>`;

  container.append(html);
  bindNativeRegexPanelEvents();
  const current = PT.API.getLoadedPresetName?.();
  if (current) updateNativeRegexPanel(current);
  return true;
}

function renderNativeRegexBindingContent(presetName) {
  const $ = getJQuery();
  const panel = $('#st-native-regex-panel');
  if (!panel.length) return;
  const bindings = getPresetRegexBindings(presetName);
  const allRegexes = getAllAvailableRegexes();
  const comp = renderRegexListComponent({ regexes: allRegexes, bindings });
  panel.find('.content').html(comp.html);
}

function bindNativeRegexPanelEvents() {
  const $ = getJQuery();

  $('#st-regex-toggle')
    .off('click')
    .on('click', function () {
      const content = $('#st-native-regex-panel .content');
      const isVisible = content.is(':visible');
      content.toggle();
      $(this).text(isVisible ? '▶' : '▼');
      if (!isVisible) {
        const current = PT.API.getLoadedPresetName?.();
        if (current) updateNativeRegexPanel(current);
      }
    });

  $('#regex-binding-switch')
    .off('click')
    .on('click', function () {
      const enabled = !getRegexBindingEnabled();
      setRegexBindingEnabled(enabled);
      $(this).text(enabled ? '●' : '○');
    });
}

function updateNativeRegexPanel(presetName) {
  renderNativeRegexBindingContent(presetName);
}

function initNativeRegexPanelIntegration() {
  const $ = getJQuery();
  $(document).on('preset_loaded', (e, presetName) => {
    updateNativeRegexPanel(presetName);
  });
}

export { ensureNativeRegexPanelInjected, updateNativeRegexPanel, initNativeRegexPanelIntegration };
