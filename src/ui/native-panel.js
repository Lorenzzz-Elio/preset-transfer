import { PT } from '../core/api-compat.js';
import { getJQuery, escapeHtml, debounce } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';
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
import {
  getRegexBindingEnabled,
  setRegexBindingEnabled,
  getPresetRegexBindings,
  getAllAvailableRegexes,
  savePresetRegexBindings,
  getDefaultRegexBindings,
  switchPresetRegexes,
} from '../features/regex-binding.js';

// 本地缓存一份条目状态偏好，避免直接依赖未声明的全局变量
let entryStatesSaveWorldBindings = getEntryStatesSaveWorldBindings();
let entryStatesGroupByPrefix = getEntryStatesGroupByPrefix();
function ensureNativeEntryStatesPanelInjected() {
  const $ = getJQuery();
  const container = $('#openai_api-presets');
  if (!container.length) return false;
  if ($('#st-native-entry-states-panel').length) return true;

  // 使用酒馆原生样式类，最小化自定义CSS
  if (!$('#st-native-entry-states-styles').length) {
    $('head').append(`
      <style id="st-native-entry-states-styles">
        /* 简化样式 - 跟随酒馆美化主题 */
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
      <div class="header" style="display: flex; align-items: center; gap: 4px;">
        <button id="st-entry-states-toggle" class="menu_button" title="展开/折叠">▶</button>
        <span class="title">条目状态</span>
        <div style="flex:1;"></div>
        <button id="save-current-entry-states" class="menu_button" style="font-size: 11px; padding: 2px 6px; display: inline-block; white-space: nowrap;" title="保存当前条目状态">保存</button>
        <button id="entry-states-group-toggle" class="menu_button" style="font-size: 11px; padding: 2px 6px; display: inline-block; white-space: nowrap;" title="按名称前缀分组显示">${
          entryStatesGroupByPrefix ? '分组:开' : '分组:关'
        }</button>
        <button id="entry-states-switch" class="menu_button" title="开启/关闭世界书绑定功能">${
          entryStatesSaveWorldBindings ? '●' : '○'
        }</button>
      </div>
      <div class="content" style="display:none; max-height:50vh; overflow:auto; padding:10px;">
        <div id="st-entry-states-status" style="opacity: .9;">加载中...</div>
      </div>
    </div>`;

  container.append(html);
  bindNativeEntryStatesMainPanelEvents();
  const current = PT.API.getLoadedPresetName?.();
  if (current) updateNativeEntryStatesPanel(current);
  return true;
}

// 渲染条目状态管理内容
function renderNativeEntryStatesContent(presetName) {
  const $ = getJQuery();
  const panel = $('#st-native-entry-states-panel');
  if (!panel.length) return;

  const statesConfig = getPresetEntryStates(presetName);
  const currentStates = getCurrentEntryStates(presetName);
  const entryCount = Object.keys(currentStates).length;
  const enabledCount = Object.values(currentStates).filter(Boolean).length;

  const formatWorldBindingsSummary = worldBindings => {
    if (!Array.isArray(worldBindings)) {
      return '<div class="version-world" style="font-size: 12px; opacity: 0.75;">世界书: 未保存</div>';
    }
    if (worldBindings.length === 0) {
      return '<div class="version-world" style="font-size: 12px; opacity: 0.75;">世界书: 无</div>';
    }
    const display = worldBindings.map(name => escapeHtml(name)).join('、');
    return `<div class="version-world" style="font-size: 12px; opacity: 0.75;">世界书: ${display}</div>`;
  };

  let html = `
    <div style="margin-bottom: 12px; padding: 8px; background: rgba(0,0,0,0.05); border-radius: 6px;">
      <div style="font-weight: 600; margin-bottom: 4px;">当前状态</div>
      <div style="font-size: 12px; opacity: 0.8;">
        共 ${entryCount} 个条目，已开启 ${enabledCount} 个
      </div>
    </div>
  `;

  if (statesConfig.versions.length === 0) {
    html += `
      <div style="text-align: center; padding: 20px; opacity: 0.6;">
        <div>暂无保存的状态版本</div>
        <div style="font-size: 11px; margin-top: 4px;">点击"保存"按钮保存当前状态</div>
      </div>
    `;
  } else {
    html += '<div style="margin-bottom: 8px; font-weight: 600;">已保存的状态版本</div>';

    const renderVersionItem = version => {
      const isCurrent = version.id === statesConfig.currentVersion;
      const date = new Date(version.createdAt).toLocaleDateString();
      const versionEntryCount = Object.keys(version.states).length;
      const versionEnabledCount = Object.values(version.states).filter(Boolean).length;
      const summaryHtml = formatWorldBindingsSummary(version.worldBindings);
      return `
        <div class="version-item ${isCurrent ? 'current-version' : ''}" data-version-id="${
        version.id
      }" style="display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:6px; background: rgba(0,0,0,0.03); margin-bottom:6px;">
          <div style="flex: 1;">
            <div class="version-name">${escapeHtml(version.name)}</div>
            <div class="version-date" style="opacity:.8; font-size:12px;">${date} · ${versionEnabledCount}/${versionEntryCount} 开启</div>
            ${summaryHtml}
          </div>
          <div class="version-actions" style="display:flex; gap:6px;">
            <button class="menu_button apply-version-btn" style="font-size: 10px; padding: 1px 4px;" title="应用此状态">应用</button>
            <button class="menu_button rename-version-btn" style="font-size: 10px; padding: 1px 4px;" title="重命名">✏️</button>
            <button class="menu_button delete-version-btn" style="font-size: 10px; padding: 1px 4px;" title="删除">🗑️</button>
          </div>
        </div>`;
    };
    if (entryStatesGroupByPrefix) {
      const getGroupName = name => {
        const m = (name || '').match(/^(【[^】]+】|[^-\[\]_.:：]+[-\[\]_.:：])/);
        let g = m ? m[1].replace(/[-\[\]_.:：]$/, '').replace(/^【|】$/g, '') : '未分组';
        g = (g || '未分组').replace(/['"\\]/g, '').trim();
        return g.length ? g : '未分组';
      };
      const groups = new Map();
      statesConfig.versions.forEach(v => {
        const g = getGroupName(v.name || '');
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(v);
      });
      html += '<div id="es-groups">';
      for (const [gname, list] of groups.entries()) {
        html += `
          <div class="es-group" data-group="${escapeHtml(gname)}">
            <div class="es-group-title" style="display:flex; align-items:center; gap:8px; cursor:pointer; padding:6px 8px;">
              <span class="es-group-toggle" style="width:16px; text-align:center;">▶</span>
              <span class="es-group-name" style="flex:1;">${escapeHtml(gname)}</span>
              <span class="es-group-count" style="opacity:.7; font-size:12px;">${list.length}</span>
            </div>
            <div class="es-group-content" style="display:none;">`;
        list.forEach(v => {
          html += renderVersionItem(v);
        });
        html += '</div></div>';
      }
      html += '</div>';
    } else {
      statesConfig.versions.forEach(v => {
        html += renderVersionItem(v);
      });
    }
  }

  panel.find('.content').html(html);
}

// 绑定条目状态管理面板事件
function bindNativeEntryStatesPanelEvents(presetName) {
  const $ = getJQuery();
  const panel = $('#st-native-entry-states-panel');
  if (!panel.length) return;

  // 分组折叠/展开
  panel.off('click', '.es-group-title').on('click', '.es-group-title', function () {
    const group = $(this).closest('.es-group');
    const content = group.find('.es-group-content').first();
    const toggle = $(this).find('.es-group-toggle');
    const isCollapsed = !content.is(':visible');
    content.slideToggle(120);
    toggle.text(isCollapsed ? '▼' : '▶');
  });

  // 应用状态版本
  panel.off('click', '.apply-version-btn').on('click', '.apply-version-btn', async function (e) {
    e.stopPropagation();
    const versionId = $(this).closest('.version-item').data('version-id');
    const currentPreset = PT.API.getLoadedPresetName?.();

    if (!currentPreset) {
      if (window.toastr) toastr.error('请先选择一个预设');
      return;
    }

    try {
      await applyEntryStates(currentPreset, versionId);
      updateNativeEntryStatesPanel(currentPreset);
      renderNativeEntryStatesContent(currentPreset);
      if (window.toastr) toastr.success('状态已应用');
    } catch (error) {
      console.error('应用状态失败:', error);
      if (window.toastr) toastr.error('应用状态失败: ' + error.message);
    }
  });

  // 重命名状态版本
  panel.off('click', '.rename-version-btn').on('click', '.rename-version-btn', async function (e) {
    e.stopPropagation();
    const versionId = $(this).closest('.version-item').data('version-id');
    const currentName = $(this).closest('.version-item').find('.version-name').text();
    const currentPreset = PT.API.getLoadedPresetName?.();

    const newName = prompt('请输入新名称:', currentName);
    if (!newName || newName === currentName) return;

    try {
      await renameEntryStatesVersion(currentPreset, versionId, newName);
      renderNativeEntryStatesContent(currentPreset);
      if (window.toastr) toastr.success('重命名成功');
    } catch (error) {
      console.error('重命名失败:', error);
      if (window.toastr) toastr.error('重命名失败: ' + error.message);
    }
  });

  // 删除状态版本
  panel.off('click', '.delete-version-btn').on('click', '.delete-version-btn', async function (e) {
    e.stopPropagation();
    const versionId = $(this).closest('.version-item').data('version-id');
    const versionName = $(this).closest('.version-item').find('.version-name').text();
    const currentPreset = PT.API.getLoadedPresetName?.();

    if (!confirm(`确定要删除状态版本"${versionName}"吗？`)) return;

    try {
      await deleteEntryStatesVersion(currentPreset, versionId);
      renderNativeEntryStatesContent(currentPreset);
      updateNativeEntryStatesPanel(currentPreset);
      if (window.toastr) toastr.success('删除成功');
    } catch (error) {
      console.error('删除失败:', error);
      if (window.toastr) toastr.error('删除失败: ' + error.message);
    }
  });
}

// 绑定条目状态管理主面板事件
function bindNativeEntryStatesMainPanelEvents() {
  const $ = getJQuery();
  const panel = $('#st-native-entry-states-panel');
  if (!panel.length) return;

  // 折叠/展开按钮
  $('#st-entry-states-toggle')
    .off('click')
    .on('click', function () {
      const $content = panel.find('.content');
      const wasOpen = $content.is(':visible');
      $content.slideToggle(150);
      $(this).text(wasOpen ? '▶' : '▼');
      if (!wasOpen) {
        try {
          const presetName = PT.API.getLoadedPresetName?.();
          if (presetName) {
            renderNativeEntryStatesContent(presetName);
            bindNativeEntryStatesPanelEvents(presetName);
          } else {
            panel.find('#st-entry-states-status').text('未检测到当前预设');
          }
        } catch (e) {
          console.error('[EntryStatesPanel] 展开面板失败:', e);
          if (window.toastr) toastr.error('打开状态管理界面失败: ' + e.message);
        }
      }
    });

  // 保存当前状态按钮
  $('#save-current-entry-states')
    .off('click')
    .on('click', async function () {
      try {
        const currentPreset = PT.API.getLoadedPresetName?.();
        if (!currentPreset) {
          if (window.toastr) toastr.error('请先选择一个预设');
          return;
        }

        const versionName = prompt('请输入状态版本名称:', '新状态版本');
        if (!versionName) return;

        await saveCurrentEntryStatesAsVersion(currentPreset, versionName);
        updateNativeEntryStatesPanel(currentPreset);
        renderNativeEntryStatesContent(currentPreset);
        if (window.toastr) toastr.success('状态已保存');
      } catch (e) {
        console.error('保存状态失败:', e);
        if (window.toastr) toastr.error('保存状态失败: ' + e.message);
      }
    });

  // 分组开关按钮
  $('#entry-states-group-toggle')
    .off('click')
    .on('click', function () {
      entryStatesGroupByPrefix = !entryStatesGroupByPrefix;
      setEntryStatesGroupByPrefix(entryStatesGroupByPrefix);
      localStorage.setItem('preset-transfer-entry-states-group', entryStatesGroupByPrefix);
      $(this).text(entryStatesGroupByPrefix ? '分组:开' : '分组:关');
      const presetName = PT.API.getLoadedPresetName?.();
      if (presetName) renderNativeEntryStatesContent(presetName);
    });

  // 功能开关按钮
  $('#entry-states-switch')
    .off('click')
    .on('click', function () {
      entryStatesSaveWorldBindings = !entryStatesSaveWorldBindings;
      setEntryStatesSaveWorldBindings(entryStatesSaveWorldBindings);
      localStorage.setItem('preset-transfer-entry-states-save-world-bindings', entryStatesSaveWorldBindings);
      $(this).text(entryStatesSaveWorldBindings ? '●' : '○');
      if (window.toastr) {
        toastr.info(entryStatesSaveWorldBindings ? '已开启世界书绑定功能，将在保存与应用时同步' : '已关闭世界书绑定功能，将忽略世界书同步');
      }
    });
}

// 更新条目状态管理面板状态显示
function updateNativeEntryStatesPanel(presetName) {
  try {
    const $ = getJQuery();
    const panel = $('#st-native-entry-states-panel');

    if (!panel.length) return;
    const statesConfig = getPresetEntryStates(presetName);
    const count = Array.isArray(statesConfig.versions) ? statesConfig.versions.length : 0;
    panel.find('#st-entry-states-status').text(`预设: ${presetName}（已保存 ${count} 个状态版本）`);

    // 更新开关按钮状态
    panel.find('#entry-states-switch').text(entryStatesSaveWorldBindings ? '●' : '○');
  } catch (e) {
    console.warn('更新条目状态管理面板失败:', e);
  }
}

// 在原生页面中注入“正则绑定/切换”折叠面板（默认折叠）
function ensureNativeRegexPanelInjected() {
  const $ = getJQuery();
  const container = $('#openai_api-presets');
  if (!container.length) return false;
  if ($('#st-native-regex-panel').length) return true;

  // 使用酒馆原生样式类，最小化自定义CSS - 完全跟随美化主题
  if (!$('#st-native-regex-styles').length) {
    $('head').append(`
      <style id="st-native-regex-styles">
        /* 简化样式 - 跟随酒馆美化主题 */
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
        #st-native-regex-panel .rb-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
        #st-native-regex-panel .rb-toolbar input { flex: 1; min-width: 160px; }
        #st-native-regex-panel .rb-toolbar button, #st-native-regex-panel .rb-group-batch-btn { white-space: nowrap; }
        /* 预设正则列表（仅显示已绑定项，用于控制开关） */
        #st-native-regex-panel .preset-regex-toolbar { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
        #st-native-regex-panel .preset-regex-toolbar input { flex: 1; min-width: 160px; }
        #st-native-regex-panel .preset-regex-list .pr-row { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 6px; }
        #st-native-regex-panel .preset-regex-list .pr-row:hover { background: rgba(0,0,0,0.05); }
        #st-native-regex-panel .preset-regex-list .pr-name { flex: 1; }
        #st-native-regex-panel .preset-regex-list .pr-state { opacity: 0.7; font-size: 12px; min-width: 4em; text-align: right; }
        #st-native-regex-panel .preset-regex-list .pr-toggle-wrap { display: flex; align-items: center; }
        #st-native-regex-panel .preset-regex-list input.pr-toggle { display: none !important; }
        #st-native-regex-panel .preset-regex-list .pr-toggle-off { cursor: pointer; opacity: 0.5; filter: grayscale(0.5); transition: opacity var(--animation-duration-2x) ease-in-out; }
        #st-native-regex-panel .preset-regex-list .pr-toggle-off:hover { opacity: 1; filter: none; }
        #st-native-regex-panel .preset-regex-list .pr-toggle-on { cursor: pointer; }
        #st-native-regex-panel .preset-regex-list .pr-toggle:checked ~ .pr-toggle-on { display: inline-block; }
        #st-native-regex-panel .preset-regex-list .pr-toggle:checked ~ .pr-toggle-off { display: none; }
        #st-native-regex-panel .preset-regex-list .pr-toggle:not(:checked) ~ .pr-toggle-on { display: none; }
        #st-native-regex-panel .preset-regex-list .pr-toggle:not(:checked) ~ .pr-toggle-off { display: inline-block; }
        #st-native-regex-panel .preset-regex-empty { opacity: 0.75; padding: 10px; }

        /* 绑定管理弹窗复用同一套布局（不再出现竖排/无法折叠） */
        #pt-preset-regex-binding-modal {
          position: fixed;
          inset: 0;
          z-index: 10050;
          background: rgba(0, 0, 0, 0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          width: 100vw;
          height: 100vh;
          height: 100dvh;
          overflow: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
        }
        #pt-preset-regex-binding-modal .inner {
          width: min(1000px, 96vw);
          max-height: 80vh;
          max-height: 80dvh;
          max-height: min(80dvh, 900px);
          overflow: hidden;
          background: var(--pt-modal-bg);
          color: var(--pt-modal-text);
          border: 1px solid var(--pt-modal-border);
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
        }
        #pt-preset-regex-binding-modal .header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          border-bottom: 1px solid var(--pt-modal-border);
        }
        #pt-preset-regex-binding-modal .header .title {
          flex: 1;
          min-width: 0;
          font-weight: 600;
        }
        #pt-preset-regex-binding-modal .content {
          max-height: calc(80vh - 54px);
          max-height: calc(80dvh - 54px);
          max-height: calc(min(80dvh, 900px) - 54px);
          overflow: auto;
          padding: 10px;
          -webkit-overflow-scrolling: touch;
        }
        @media (max-width: 640px), (max-height: 560px) {
          #pt-preset-regex-binding-modal {
            align-items: flex-start;
            padding-top: 12px;
            padding-top: calc(12px + env(safe-area-inset-top));
            padding-bottom: 12px;
            padding-bottom: calc(12px + env(safe-area-inset-bottom));
            padding-left: 12px;
            padding-right: 12px;
          }
          #pt-preset-regex-binding-modal .inner {
            width: 100%;
            max-height: calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
          }
          #pt-preset-regex-binding-modal .content {
            max-height: calc(100dvh - 24px - 54px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
          }
        }
        #pt-preset-regex-binding-modal .rb-group { margin-bottom: 8px; }
        #pt-preset-regex-binding-modal .rb-group-title { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px 10px; user-select: none; }
        #pt-preset-regex-binding-modal .rb-group-toggle { width: 16px; text-align: center; }
        #pt-preset-regex-binding-modal .rb-group-name { flex: 1; }
        #pt-preset-regex-binding-modal .rb-group-count { opacity: 0.7; font-size: 12px; }
        #pt-preset-regex-binding-modal .rb-group-content.collapsed { display: none; }
        #pt-preset-regex-binding-modal .rb-label { display: flex; align-items: center; gap: 8px; padding: 6px 10px; }
        #pt-preset-regex-binding-modal .rb-label .name { flex: 1; }
        #pt-preset-regex-binding-modal .rb-label .badge { padding: 2px 6px; border-radius: 3px; font-size: 11px; white-space: nowrap; }
        #pt-preset-regex-binding-modal .rb-label.unbound .badge { opacity: 0.6; }
        #pt-preset-regex-binding-modal .rb-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
        #pt-preset-regex-binding-modal .rb-toolbar input { flex: 1; min-width: 160px; }
        #pt-preset-regex-binding-modal .rb-toolbar button, #pt-preset-regex-binding-modal .rb-group-batch-btn { white-space: nowrap; }
        /* 隐藏滚动条 */
        #st-native-regex-panel .content::-webkit-scrollbar { display: none; }
        #st-native-regex-panel .content { scrollbar-width: none; -ms-overflow-style: none; }
      </style>
    `);
  }

  const html = `
    <div id="st-native-regex-panel">
      <div class="header" style="display: flex; align-items: center; gap: 4px;">
        <button id="st-regex-toggle" class="menu_button" title="展开/折叠">▶</button>
        <span class="title">预设正则</span>
        <div style="flex:1;"></div>
        <button id="preset-regex-manage" class="menu_button" style="font-size: 11px; padding: 2px 6px; display: inline-block; white-space: nowrap;" title="选择要绑定到当前预设的正则">绑定管理</button>
        <button id="export-preset-bundle" class="menu_button" style="font-size: 11px; padding: 2px 6px; display: inline-block; white-space: nowrap;" title="导出预设+正则包">导出预设</button>
        <button id="import-preset-bundle" class="menu_button" style="font-size: 11px; padding: 2px 6px; display: inline-block; white-space: nowrap;" title="导入预设+正则包">导入预设</button>
        <input type="file" id="import-preset-bundle-file" accept=".json" style="display: none;">
        <button id="regex-binding-switch" class="menu_button" title="开启/关闭正则绑定功能">${
          getRegexBindingEnabled() ? '●' : '○'
        }</button>
      </div>
      <div class="content" style="display:none; max-height:50vh; overflow:auto; padding:10px;">
        <div id="st-regex-binding-status" style="opacity: .9;">加载中...</div>
        <div class="preset-regex-toolbar">
          <input id="preset-regex-search" class="text_pole" placeholder="搜索当前预设绑定的正则..." />
        </div>
        <div class="preset-regex-list" id="preset-regex-list"></div>
      </div>
    </div>`;

  container.append(html);
  bindNativeRegexPanelEvents();
  const current = PT.API.getLoadedPresetName?.();
  if (current) updateNativeRegexPanel(current);
  return true;
}

function renderNativePresetRegexContent(presetName) {
  const $ = getJQuery();
  const panel = $('#st-native-regex-panel');
  if (!panel.length) return;

  const bindings = getPresetRegexBindings(presetName);
  const allRegexes = getAllAvailableRegexes();
  const order = new Map(allRegexes.map((r, idx) => [String(r.id), idx]));
  const regexById = new Map(allRegexes.map(r => [String(r.id), r]));

  const term = (panel.find('#preset-regex-search').val() || '').toLowerCase();
  const bound = Array.isArray(bindings.bound) ? bindings.bound.slice() : [];

  const rows = bound
    .filter(item => item && item.id != null)
    .map(item => ({ id: String(item.id), enabled: !!item.enabled }))
    .filter(item => regexById.has(item.id))
    .sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9))
    .filter(item => {
      if (!term) return true;
      const r = regexById.get(item.id);
      const name = (r?.script_name || String(item.id)).toLowerCase();
      return name.includes(term);
    })
    .map(item => {
      const r = regexById.get(item.id);
      const safeName = escapeHtml(r?.script_name || String(item.id));
      const actualState = r?.enabled ? '已启用' : '未启用';
      return `
        <div class="pr-row" data-id="${escapeHtml(item.id)}">
          <label class="pr-toggle-wrap checkbox flex-container" title="启用/禁用（仅影响该预设）">
            <input type="checkbox" class="pr-toggle" ${item.enabled ? 'checked' : ''} />
            <span class="pr-toggle-on fa-solid fa-toggle-on fa-lg" title="点击禁用"></span>
            <span class="pr-toggle-off fa-solid fa-toggle-off fa-lg" title="点击启用"></span>
          </label>
          <span class="pr-name">${safeName}</span>
          <span class="pr-state">${actualState}</span>
        </div>`;
    })
    .join('');

  panel.find('#preset-regex-list').html(rows || `<div class="preset-regex-empty">当前预设未绑定任何正则。</div>`);
}

function bindNativePresetRegexPanelEvents(presetName) {
  const $ = getJQuery();
  const panel = $('#st-native-regex-panel');
  if (!panel.length) return;

  const debouncedSearch = debounce(() => renderNativePresetRegexContent(presetName), 250);
  panel.find('#preset-regex-search').off('input').on('input', debouncedSearch);

  panel
    .find('#preset-regex-list')
    .off('change', '.pr-toggle')
    .on('change', '.pr-toggle', async function () {
      const $row = $(this).closest('.pr-row');
      const id = String($row.data('id'));
      const enabled = $(this).is(':checked');

      const beforeBindings = getPresetRegexBindings(presetName);
      const nextBindings = {
        bound: (beforeBindings.bound || []).map(x => ({ id: x.id, enabled: x.enabled })),
      };

      const idx = nextBindings.bound.findIndex(x => String(x.id) === id);
      if (idx >= 0) nextBindings.bound[idx].enabled = enabled;

      const ok = await savePresetRegexBindings(presetName, nextBindings);
      if (!ok) {
        if (window.toastr) toastr.error('保存失败');
        renderNativePresetRegexContent(presetName);
        return;
      }

      if (getRegexBindingEnabled()) {
        try {
          await switchPresetRegexes(presetName, presetName, { fromBindings: beforeBindings, toBindings: nextBindings });
          // 等待一小段时间确保正则状态已更新
          await new Promise(r => setTimeout(r, 100));
        } catch (e) {
          console.warn('应用预设正则开关失败:', e);
        }
      }

      renderNativePresetRegexContent(presetName);
    });
}

function renderNativeRegexBindingContent(presetName, $root) {
  const $ = getJQuery();
  const $container = $root && $root.length ? $root : $('#pt-preset-regex-binding-modal');
  if (!$container.length) return;
  const bindings = getPresetRegexBindings(presetName);
  const allRegexes = getAllAvailableRegexes();
  const comp = renderRegexListComponent({ regexes: allRegexes, bindings });
  $container.find('.content').html(comp.html);
}

function bindNativeRegexBindingPanelEvents(presetName, $root, { onSaved } = {}) {
  const $ = getJQuery();
  const $container = $root && $root.length ? $root : $('#pt-preset-regex-binding-modal');
  if (!$container.length) return;
  const $groups = $container.find('#rb-groups');

  // 分组折叠/展开

  // 分组折叠/展开（标题行点击）
  $groups
    .off('click', '.rb-group-title')
    .on('click', '.rb-group-title', function (e) {
      // 点击批量设置按钮不折叠
      if ($(e.target).closest('.rb-group-batch-btn').length) return;
      const $title = $(this);
      const $content = $title.next('.rb-group-content');
      const $toggle = $title.find('.rb-group-toggle');
      const collapsed = $content.hasClass('collapsed');
      $content.toggleClass('collapsed', !collapsed);
      $toggle.text(collapsed ? '▼' : '▶');
    });

  // 组级批量设置按钮
  $groups
    .off('click', '.rb-group-batch-btn')
    .on('click', '.rb-group-batch-btn', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const $group = $(this).closest('.rb-group');
      const $rows = $group.find('.regex-row');
      // 简化批量操作
      const actions = [
        { fn: $rows => $rows.find('.rb-exclusive').prop('checked', true) },
        { fn: $rows => $rows.find('.rb-exclusive').prop('checked', false) },
      ];
      const choice = window.prompt('1=全选绑定, 2=全取消绑定');
      const idx = { 1: 0, 2: 1 }[choice?.trim?.()] ?? -1;
       if (idx >= 0) {
         actions[idx].fn($rows);

        // 同步标签
        $rows.find('.rb-label').each(function () {
          const checked = $(this).find('.rb-exclusive').is(':checked');
          $(this)
            .toggleClass('bound', checked)
            .toggleClass('unbound', !checked)
            .find('.badge')
            .text(checked ? '已绑定' : '未绑定')
            .toggleClass('menu_button', checked);
        });
      }
    });

  // 单项绑定/解绑：同步 badge、样式与"开关状态"可编辑性
  $groups
    .off('change', '.rb-exclusive')
    .on('change', '.rb-exclusive', function () {
      const $label = $(this).closest('.rb-label');
      const checked = $(this).is(':checked');

      $label
        .toggleClass('bound', checked)
        .toggleClass('unbound', !checked)
        .find('.badge')
        .text(checked ? '已绑定' : '未绑定')
        .toggleClass('menu_button', checked);
    });

  // 搜索过滤 + 筛选
  const applyRegexListFilter = () => {
    const term = ($container.find('#rb-search').val() || '').toLowerCase();
    const mode = $container.find('#rb-filter').val();
    $container.find('#rb-groups .rb-group').each(function () {
      let anyVisible = false;
      $(this)
        .find('.regex-row')
        .each(function () {
          const name = $(this).find('.name').text().toLowerCase();
          const isBound = $(this).find('.rb-exclusive').is(':checked');
          const matchTerm = !term || name.includes(term);
          const matchMode =
            mode === 'all' ||
            (mode === 'bound' && isBound) ||
            (mode === 'unbound' && !isBound);
          const visible = matchTerm && matchMode;
          $(this).toggle(visible);
          anyVisible = anyVisible || visible;
        });
      $(this).toggle(anyVisible);
    });
  };
  // 添加防抖优化的正则搜索
  const debouncedRegexSearch = debounce(applyRegexListFilter, 300);
  $container.find('#rb-search').off('input').on('input', debouncedRegexSearch);
  $container.find('#rb-filter').off('change').on('change', applyRegexListFilter);

  // 保存绑定（直接写入 preset）
  $container.find('#rb-save')
    .off('click')
    .on('click', async function () {
      try {
        const beforeBindings = getPresetRegexBindings(presetName);
        const beforeStates = beforeBindings?.states && typeof beforeBindings.states === 'object' ? beforeBindings.states : {};
        const bound = [];
        $container.find('#rb-groups .regex-row').each(function () {
          const id = String($(this).data('id'));
          const isExclusive = $(this).find('.rb-exclusive').is(':checked');
          if (!isExclusive) return;
          const enabled = Object.prototype.hasOwnProperty.call(beforeStates, id) ? !!beforeStates[id] : true;
          bound.push({ id, enabled });
        });
        const nextBindings = { bound };
        const ok = await savePresetRegexBindings(presetName, nextBindings);
        if (ok) {
          updateNativeRegexPanel(presetName);

          // 立即刷新正则启用禁用状态
          if (getRegexBindingEnabled()) {
            try {
              await switchPresetRegexes(presetName, presetName, { fromBindings: beforeBindings, toBindings: nextBindings });
              // 等待一小段时间确保正则状态已更新
              await new Promise(r => setTimeout(r, 100));
              if (window.toastr) toastr.success('正则绑定配置已保存并生效');
            } catch (switchError) {
              console.error('应用正则绑定失败:', switchError);
              if (window.toastr) toastr.warning('正则绑定配置已保存，但应用失败: ' + switchError.message);
            }
          } else {
            if (window.toastr) toastr.info('已保存（正则绑定功能当前为关闭状态，未立即生效）');
          }

          // 重新渲染界面以显示最新的启用禁用状态
          renderNativeRegexBindingContent(presetName, $container);
          bindNativeRegexBindingPanelEvents(presetName, $container, { onSaved });
          if (typeof onSaved === 'function') onSaved();
        } else {
          if (window.toastr) toastr.error('保存失败');
        }
      } catch (e) {
        console.error('保存绑定失败:', e);
        if (window.toastr) toastr.error('保存失败: ' + e.message);
      }
    });
}

function openPresetRegexBindingManager(presetName) {
  const $ = getJQuery();
  const vars = CommonStyles.getVars();

  $('#pt-preset-regex-binding-modal').remove();

  const $modal = $(`
    <div id="pt-preset-regex-binding-modal" style="
      --pt-modal-bg: ${vars.bgColor};
      --pt-modal-text: ${vars.textColor};
      --pt-modal-border: ${vars.borderColor};
    ">
      <div class="inner">
        <div class="header">
          <div style="flex:1; font-weight: 600;">绑定管理：${escapeHtml(presetName)}</div>
          <button id="pt-preset-regex-binding-save" class="menu_button" style="white-space:nowrap;">保存</button>
          <button id="pt-preset-regex-binding-close" class="menu_button" style="white-space:nowrap;">关闭</button>
        </div>
        <div class="content"></div>
      </div>
    </div>
  `);

  $('body').append($modal);

  $modal.on('click', function (e) {
    if (e.target === this) $(this).remove();
  });
  $modal.find('#pt-preset-regex-binding-save').on('click', () => $modal.find('#rb-save').trigger('click'));
  $modal.find('#pt-preset-regex-binding-close').on('click', () => $modal.remove());

  renderNativeRegexBindingContent(presetName, $modal);
  bindNativeRegexBindingPanelEvents(presetName, $modal, {
    onSaved: () => {
      updateNativeRegexPanel(presetName);
      renderNativePresetRegexContent(presetName);
    },
  });

  // Save is available in the fixed header; keep the toolbar clean.
  $modal.find('#rb-save').hide();
}

function bindNativeRegexPanelEvents() {
  const $ = getJQuery();
  const panel = $('#st-native-regex-panel');
  if (!panel.length) return;

  // 导出预设包按钮事件
  $('#export-preset-bundle')
    .off('click')
    .on('click', async function () {
      try {
        const currentPreset = PT.API.getLoadedPresetName?.();
        if (!currentPreset) {
          if (window.toastr) toastr.error('请先选择一个预设');
          return;
        }
        await exportPresetBundle(currentPreset);
      } catch (e) {
        console.error('导出预设包失败:', e);
        if (window.toastr) toastr.error('导出失败: ' + e.message);
      }
    });

  // 导入预设包按钮事件
  $('#import-preset-bundle')
    .off('click')
    .on('click', function () {
      $('#import-preset-bundle-file').trigger('click');
    });

  // 文件选择事件
  $('#import-preset-bundle-file')
    .off('change')
    .on('change', async function (e) {
      const file = e.target.files[0];
      if (!file) return;

      try {
        await importPresetBundle(file);
      } catch (e) {
        console.error('导入预设包失败:', e);
        if (window.toastr) toastr.error('导入失败: ' + e.message);
      }

      // 清空文件选择
      $(this).val('');
    });

  $('#st-regex-toggle')
    .off('click')
    .on('click', function () {
      const $content = panel.find('.content');
      const wasOpen = $content.is(':visible');
      $content.slideToggle(150);
      $(this).text(wasOpen ? '▶' : '▼');
      if (!wasOpen) {
        try {
          const presetName = PT.API.getLoadedPresetName?.();
          if (presetName) {
            updateNativeRegexPanel(presetName);
          } else {
            panel.find('#st-regex-binding-status').text('未检测到当前预设');
          }
        } catch (e) {
          console.error('[RegexPanel] 展开面板失败:', e);
          if (window.toastr) toastr.error('打开绑定界面失败: ' + e.message);
        }
      }
    });

  $('#preset-regex-manage')
    .off('click')
    .on('click', function () {
      try {
        const presetName = PT.API.getLoadedPresetName?.();
        if (!presetName) {
          if (window.toastr) toastr.error('请先选择一个预设');
          return;
        }
        openPresetRegexBindingManager(presetName);
      } catch (e) {
        console.error('打开绑定管理失败:', e);
      }
    });

  // 正则绑定开关按钮事件
  $('#regex-binding-switch')
    .off('click')
    .on('click', function () {
      const newValue = !getRegexBindingEnabled();
      setRegexBindingEnabled(newValue);
      localStorage.setItem('preset-transfer-regex-binding-enabled', newValue);
      $(this).text(newValue ? '●' : '○');

      // Toggle effect immediately for the current preset.
      try {
        const currentPreset = PT.API.getLoadedPresetName?.();
        if (currentPreset) {
          if (newValue) {
            switchPresetRegexes(null, currentPreset).catch(() => {});
          } else {
            const currentBindings = getPresetRegexBindings(currentPreset);
            switchPresetRegexes(currentPreset, null, {
              fromBindings: currentBindings,
              toBindings: getDefaultRegexBindings(),
            }).catch(() => {});
          }
        }
      } catch {
        /* ignore */
      }
      if (window.toastr) {
        toastr.info(`正则绑定功能已${newValue ? '开启' : '关闭'}`);
      }
    });
}

function updateNativeRegexPanel(presetName) {
  try {
    const $ = getJQuery();
    const panel = $('#st-native-regex-panel');

    if (!panel.length) return;
    const bindings = getPresetRegexBindings(presetName);
    const count = Array.isArray(bindings.bound) ? bindings.bound.length : Array.isArray(bindings.exclusive) ? bindings.exclusive.length : 0;
    panel.find('#st-regex-binding-status').text(`预设: ${presetName}（已绑定 ${count} 个正则）`);

    // 更新开关按钮状态
    panel.find('#regex-binding-switch').text(getRegexBindingEnabled() ? '●' : '○');

    // 刷新“预设正则”列表，并确保开关事件绑定到当前预设名（即使面板未展开也无妨）
    try {
      renderNativePresetRegexContent(presetName);
      bindNativePresetRegexPanelEvents(presetName);
    } catch {
      /* ignore */
    }
  } catch (e) {
    console.warn('更新原生正则面板失败:', e);
  }
}

function initNativeRegexPanelIntegration() {
  // 先安装Hook（只需要安装一次）
  hookPresetSaveToProtectExtensions();

  // 尝试立即注入；若容器未就绪，稍后重试几次
  let attempts = 0;
  const tryInject = () => {
    attempts++;
    // 先注入条目状态管理面板，再注入正则绑定面板
    const entryStatesInjected = ensureNativeEntryStatesPanelInjected();
    const regexInjected = ensureNativeRegexPanelInjected();

    if (entryStatesInjected && regexInjected) return;
    if (attempts < 10) setTimeout(tryInject, 500);
  };
  tryInject();
}

// 主题相关功能
// 这里导出的函数会通过 index.js 挂到 window.PresetTransfer.NativePanel 中
export {
  // 条目状态面板
  ensureNativeEntryStatesPanelInjected,
  updateNativeEntryStatesPanel,
  renderNativeEntryStatesContent,
  bindNativeEntryStatesPanelEvents,
  bindNativeEntryStatesMainPanelEvents,
  // 正则绑定面板
  ensureNativeRegexPanelInjected,
  updateNativeRegexPanel,
  initNativeRegexPanelIntegration,
  renderNativePresetRegexContent,
  bindNativePresetRegexPanelEvents,
  openPresetRegexBindingManager,
  renderNativeRegexBindingContent,
  bindNativeRegexBindingPanelEvents,
  bindNativeRegexPanelEvents,
};
