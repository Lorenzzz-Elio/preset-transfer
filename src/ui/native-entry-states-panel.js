import { PT } from '../core/api-compat.js';
import { getJQuery, escapeHtml } from '../core/utils.js';
import {
  getEntryStatesGroupByPrefix,
  setEntryStatesGroupByPrefix,
  getPresetEntryStates,
  getCurrentEntryStates,
  saveCurrentEntryStatesAsVersion,
  applyEntryStates,
  deleteEntryStatesVersion,
  renameEntryStatesVersion,
} from '../features/entry-states.js';

// 本地缓存一份条目状态偏好，避免直接依赖未声明的全局变量
let entryStatesGroupByPrefix = getEntryStatesGroupByPrefix();

function removeNativeEntryStatesPanel() {
  const $ = getJQuery();
  $('#st-native-entry-states-panel').remove();
}

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
        #st-native-entry-states-panel .version-actions { display: flex; gap: 6px; align-items: center; flex-wrap: nowrap; }
        #st-native-entry-states-panel .current-version { font-weight: 600; }

        #st-native-entry-states-panel .apply-version-btn { white-space: nowrap; min-width: 3.5em; padding: 2px 10px; font-size: 11px; line-height: 1.2; }
        #st-native-entry-states-panel .pt-icon-btn { display: inline-flex; align-items: center; justify-content: center; min-width: 34px; padding: 4px 8px; line-height: 1; font-size: 14px; }
        #st-native-entry-states-panel .pt-icon-btn i,
        #st-native-entry-states-panel .pt-icon-btn span { pointer-events: none; }
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
            <button class="menu_button apply-version-btn" title="应用此状态">应用</button>
            <button class="menu_button pt-icon-btn rename-version-btn" title="编辑" aria-label="编辑">
              <span title="edit" class="fa-solid fa-pencil"></span>
            </button>
            <button class="menu_button pt-icon-btn delete-version-btn" title="删除" aria-label="删除">
              <i class="fa-fw fa-solid fa-trash-can"></i>
            </button>
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
  } catch (e) {
    console.warn('更新条目状态管理面板失败:', e);
  }
}

export {
  ensureNativeEntryStatesPanelInjected,
  removeNativeEntryStatesPanel,
  updateNativeEntryStatesPanel,
  renderNativeEntryStatesContent,
  bindNativeEntryStatesPanelEvents,
  bindNativeEntryStatesMainPanelEvents,
};
