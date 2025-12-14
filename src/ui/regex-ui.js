import { PT } from '../core/api-compat.js';
import { getJQuery, escapeHtml } from '../core/utils.js';
import { getPresetRegexBindings, getAllAvailableRegexes } from '../features/regex-binding.js';
import { ensureNativeRegexPanelInjected, openPresetRegexBindingManager } from './native-panel.js';

function createRegexBindingModal(presetName) {
  try {
    const $ = getJQuery();
    ensureNativeRegexPanelInjected();
    const name = presetName || PT.API.getLoadedPresetName?.();
    if (name) {
      openPresetRegexBindingManager(name);
    }
  } catch (e) {
    console.warn('打开原生面板失败:', e);
  }
}

// 获取正则在当前绑定配置中的类型
function getCurrentRegexBindingType(regexId, bindings) {
  if (bindings.exclusive.includes(regexId)) return 'exclusive';
  return '';
}

// RegexList 组件：统一渲染与绑定（原生面板专用）
function renderRegexListComponent({ regexes, bindings }) {
  const getGroupName = name => {
    const m = (name || '').match(/^(【[^】]+】|[^-\[\]_.]+[-\[\]_.])/);
    let g = m ? m[1].replace(/[-\[\]_.]$/, '').replace(/^【|】$/g, '') : '未分组';
    g = (g || '未分组').replace(/['"\\]/g, '').trim();
    return g.length ? g : '未分组';
  };

  const groups = new Map();
  regexes.forEach(r => {
    const g = getGroupName(r.script_name || String(r.id));
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  });

  const renderItem = r => {
    const id = String(r.id);
    const checked = bindings.exclusive.includes(id);
    const safeId = String(r.id).replace(/"/g, '&quot;');
    const safeName = escapeHtml(r.script_name || String(r.id));
    const stateIcon = r.enabled ? '●' : '○'; // 性冷淡风格：实心圆/空心圆（当前实际状态）
    const labelClass = checked ? 'bound' : 'unbound';
    const badge = checked ? '<span class="badge menu_button">已绑定</span>' : '<span class="badge">未绑定</span>';
    return `
      <div class="regex-row" data-id="${safeId}">
        <label class="rb-label ${labelClass}">
          <input type="checkbox" class="rb-exclusive" ${checked ? 'checked' : ''} />
          <span class="name">${safeName}</span>
          ${badge}
          <span class="state">${stateIcon}</span>
        </label>
      </div>`;
  };

  const groupsHtml = Array.from(groups.entries())
    .map(([gName, items]) => {
      const boundCount = items.filter(r => bindings.exclusive.includes(String(r.id))).length;
      const total = items.length;
      const rows = items.map(renderItem).join('');
      return `
        <div class="rb-group" data-group="${escapeHtml(gName)}">
          <div class="rb-group-title">
            <span class="rb-group-toggle">▶</span>
            <span class="rb-group-name">${escapeHtml(gName)}</span>
            <span class="rb-group-count">${boundCount}/${total}</span>
            <button class="rb-group-batch-btn menu_button">批量</button>
          </div>
          <div class="rb-group-content collapsed">
            ${rows}
          </div>
        </div>`;
    })
    .join('');

  const toolbar = `
    <div class="rb-toolbar">
      <input id="rb-search" class="text_pole" placeholder="搜索..." />
      <select id="rb-filter" class="text_pole">
        <option value="all">全部</option>
        <option value="bound">已绑定</option>
        <option value="unbound">未绑定</option>
      </select>
      <button id="rb-save" class="menu_button">保存</button>
    </div>`;

  return { html: toolbar + `<div id="rb-groups" class="groups">${groupsHtml}</div>` };
}

// 更新预设的正则状态显示
function updatePresetRegexStatus(presetName) {
  const $ = getJQuery();
  const bindings = getPresetRegexBindings(presetName);
  const totalBindings = bindings.exclusive.length;

  // 更新按钮标题显示绑定数量
  const leftPreset = $('#left-preset').val();
  const rightPreset = $('#right-preset').val();

  // 左右侧旧按钮已移除，状态仅在面板内展示
}

// 在原生页面中注入"条目状态管理"折叠面板（默认折叠）

export {
  createRegexBindingModal,
  getCurrentRegexBindingType,
  renderRegexListComponent,
  updatePresetRegexStatus
};
