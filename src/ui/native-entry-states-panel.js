// Native “Entry States” side panel for SillyTavern presets.
// Only responsible for DOM rendering and event binding.

import { PT } from '../core/api-compat.js';
import { getJQuery, escapeHtml } from '../core/utils.js';
import {
  getEntryStatesSaveWorldBindings,
  setEntryStatesSaveWorldBindings,
  getEntryStatesGroupByPrefix,
  setEntryStatesGroupByPrefix,
  getPresetEntryStates,
  getCurrentEntryStates,
  saveCurrentEntryStatesAsVersion,
  applyEntryStates,
  deleteEntryStatesVersion,
  renameEntryStatesVersion,
  hookPresetSaveToProtectExtensions,
} from '../features/entry-states.js';

// Local cached switches so we can reflect current state in the UI.
let entryStatesSaveWorldBindings = getEntryStatesSaveWorldBindings();
let entryStatesGroupByPrefix = getEntryStatesGroupByPrefix();

function ensureNativeEntryStatesPanelInjected() {
  const $ = getJQuery();
  const container = $('#openai_api-presets');
  if (!container.length) return false;
  if ($('#st-native-entry-states-panel').length) return true;

  // Minimal styling that follows SillyTavern’s native look.
  if (!$('#st-native-entry-states-styles').length) {
    $('head').append(`
      <style id="st-native-entry-states-styles">
        #st-native-entry-states-panel { margin-top: 10px; }
        #st-native-entry-states-panel .header { display: flex; align-items: center; gap: 8px; padding: 8px 0; }
        #st-native-entry-states-panel .header .title { font-weight: 600; }
        #st-native-entry-states-panel .version-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; margin-bottom: 4px; border-radius: 6px; }
        #st-native-entry-states-panel .version-item:hover { background: rgba(0,0,0,0.05); }
        #st-native-entry-states-panel .version-name { flex: 1; font-weight: 500; }
        #st-native-entry-states-panel .version-date { font-size: 11px; opacity: 0.7; }
        #st-native-entry-states-panel .version-actions { display: flex; gap: 4px; }
        #st-native-entry-states-panel .current-version { font-weight: 600; }
      </style>
    `);
  }

  const html = `
    <div id="st-native-entry-states-panel">
      <div class="header" style="display:flex;align-items:center;gap:4px;">
        <button id="st-entry-states-toggle" class="menu_button" title="展开/折叠">▼</button>
        <span class="title">条目状态</span>
        <div style="flex:1;"></div>
        <button
          id="save-current-entry-states"
          class="menu_button"
          style="font-size:11px;padding:2px 6px;display:inline-block;white-space:nowrap;"
          title="保存当前条目状态"
        >保存</button>
        <button
          id="entry-states-group-toggle"
          class="menu_button"
          style="font-size:11px;padding:2px 6px;display:inline-block;white-space:nowrap;"
          title="按名称前缀分组显示"
        >${entryStatesGroupByPrefix ? '分组:开' : '分组:关'}</button>
        <button
          id="entry-states-switch"
          class="menu_button"
          title="开 / 关闭世界书绑定功能"
        >${entryStatesSaveWorldBindings ? '保护扩展:开' : '保护扩展:关'}</button>
      </div>
      <div class="content" style="display:none;max-height:50vh;overflow:auto;padding:10px;">
        <div id="st-entry-states-status" style="opacity:.9;">加载中...</div>
      </div>
    </div>`;

  container.append(html);
  bindNativeEntryStatesMainPanelEvents();

  const current = PT.API.getLoadedPresetName?.();
  if (current) updateNativeEntryStatesPanel(current);
  return true;
}

function renderNativeEntryStatesContent(presetName) {
  const $ = getJQuery();
  const panel = $('#st-native-entry-states-panel');
  if (!panel.length) return;

  const statesConfig = getPresetEntryStates(presetName);
  const currentStates = getCurrentEntryStates(presetName);
  const statusDiv = $('#st-entry-states-status');

  if (!statesConfig?.versions || statesConfig.versions.length === 0) {
    statusDiv.html('<div style="opacity:0.6;">暂无保存的版本</div>');
    return;
  }

  let html = '';
  const versions = statesConfig.versions
    .slice()
    .sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
    });

  if (entryStatesGroupByPrefix) {
    const grouped = {};
    versions.forEach(v => {
      const prefix = (v.name || '').split('_')[0] || '其它';
      if (!grouped[prefix]) grouped[prefix] = [];
      grouped[prefix].push(v);
    });

    Object.keys(grouped)
      .sort()
      .forEach(prefix => {
        html += `<div style="margin-top:12px;"><strong>${escapeHtml(prefix)}</strong></div>`;
        grouped[prefix].forEach(v => {
          html += renderVersionItem(v, currentStates, statesConfig.currentVersion);
        });
      });
  } else {
    versions.forEach(v => {
      html += renderVersionItem(v, currentStates, statesConfig.currentVersion);
    });
  }

  statusDiv.html(html);
  bindNativeEntryStatesPanelEvents(presetName);
}

function renderVersionItem(version, currentStates, currentVersionId) {
  const isCurrent = version.id === currentVersionId;
  const date = version.createdAt ? new Date(version.createdAt).toLocaleString('zh-CN') : '';

  return `
    <div class="version-item ${isCurrent ? 'current-version' : ''}" data-version-id="${escapeHtml(version.id)}">
      <span class="version-name">${escapeHtml(version.name)}</span>
      <span class="version-date">${date}</span>
      <div class="version-actions">
        <button class="menu_button apply-entry-states" title="应用">▶</button>
        <button class="menu_button rename-entry-states" title="重命名">✏️</button>
        <button class="menu_button delete-entry-states" title="删除">🗑️</button>
      </div>
    </div>`;
}

function bindNativeEntryStatesPanelEvents(presetName) {
  const $ = getJQuery();

  $('.apply-entry-states')
    .off('click')
    .on('click', function () {
      const versionId = $(this).closest('.version-item').data('version-id');
      applyEntryStates(presetName, versionId);
      updateNativeEntryStatesPanel(presetName);
    });

  $('.rename-entry-states')
    .off('click')
    .on('click', function () {
      const versionId = $(this).closest('.version-item').data('version-id');
      const versionName = $(this).closest('.version-item').find('.version-name').text();
      const newName = prompt('输入新名称:', versionName);
      if (newName && newName !== versionName) {
        renameEntryStatesVersion(presetName, versionId, newName);
        updateNativeEntryStatesPanel(presetName);
      }
    });

  $('.delete-entry-states')
    .off('click')
    .on('click', function () {
      const versionId = $(this).closest('.version-item').data('version-id');
      const versionName = $(this).closest('.version-item').find('.version-name').text();
      if (confirm(`确定删除版本 "${versionName}"?`)) {
        deleteEntryStatesVersion(presetName, versionId);
        updateNativeEntryStatesPanel(presetName);
      }
    });
}

function bindNativeEntryStatesMainPanelEvents() {
  const $ = getJQuery();

  $('#st-entry-states-toggle')
    .off('click')
    .on('click', function () {
      const content = $('#st-native-entry-states-panel .content');
      const isVisible = content.is(':visible');
      content.toggle();
      $(this).text(isVisible ? '▶' : '▼');
      if (!isVisible) {
        const current = PT.API.getLoadedPresetName?.();
        if (current) updateNativeEntryStatesPanel(current);
      }
    });

  $('#save-current-entry-states')
    .off('click')
    .on('click', function () {
      const presetName = PT.API.getLoadedPresetName?.();
      if (!presetName) {
        alert('请先选择一个预设');
        return;
      }
      const versionName = prompt('输入版本名称:');
      if (versionName) {
        saveCurrentEntryStatesAsVersion(presetName, versionName);
        updateNativeEntryStatesPanel(presetName);
      }
    });

  $('#entry-states-group-toggle')
    .off('click')
    .on('click', function () {
      entryStatesGroupByPrefix = !entryStatesGroupByPrefix;
      setEntryStatesGroupByPrefix(entryStatesGroupByPrefix);
      $(this).text(entryStatesGroupByPrefix ? '分组:开' : '分组:关');
      const current = PT.API.getLoadedPresetName?.();
      if (current) updateNativeEntryStatesPanel(current);
    });

  $('#entry-states-switch')
    .off('click')
    .on('click', function () {
      entryStatesSaveWorldBindings = !entryStatesSaveWorldBindings;
      setEntryStatesSaveWorldBindings(entryStatesSaveWorldBindings);
      $(this).text(entryStatesSaveWorldBindings ? '保护扩展:开' : '保护扩展:关');
      if (entryStatesSaveWorldBindings) {
        hookPresetSaveToProtectExtensions();
      }
    });
}

function updateNativeEntryStatesPanel(presetName) {
  renderNativeEntryStatesContent(presetName);
}

export { ensureNativeEntryStatesPanelInjected, updateNativeEntryStatesPanel };
