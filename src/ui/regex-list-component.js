import { escapeAttr, escapeHtml } from '../core/utils.js';
import { getAllRegexScriptGroupings } from '../features/regex-script-grouping.js';

function groupRegexesByExtensionGroupings(regexes) {
  const list = Array.isArray(regexes) ? regexes : [];
  const orderedIds = list.map(r => String(r?.id ?? '')).filter(Boolean);
  const byId = new Map(list.map(r => [String(r?.id ?? ''), r]).filter(([id]) => id));

  const groups = [];
  const groupedIds = new Set();

  const groupings = getAllRegexScriptGroupings(orderedIds)
    .filter(g => !g?.unresolved)
    .filter(g => Array.isArray(g?.memberIds) && g.memberIds.length > 0);

  for (const g of groupings) {
    const memberIds = Array.isArray(g?.memberIds) ? g.memberIds.map(String).filter(Boolean) : [];
    if (memberIds.length === 0) continue;

    const items = memberIds.map(id => byId.get(id)).filter(Boolean);
    if (items.length === 0) continue;

    items.forEach(item => groupedIds.add(String(item?.id ?? '')));
    groups.push({
      id: String(g?.id ?? ''),
      name: String(g?.name ?? '分组').trim() || '分组',
      collapsed: Object.prototype.hasOwnProperty.call(g, 'collapsed') ? !!g.collapsed : true,
      items,
    });
  }

  const ungrouped = list.filter(r => !groupedIds.has(String(r?.id ?? '')));
  if (ungrouped.length) {
    groups.push({
      id: 'ungrouped',
      name: '未分组',
      collapsed: true,
      items: ungrouped,
    });
  }

  if (groups.length === 0 && list.length) {
    groups.push({
      id: 'ungrouped',
      name: '未分组',
      collapsed: true,
      items: list,
    });
  }

  return groups;
}

function renderRegexListComponent({ regexes = [], bindings = { exclusive: [] } } = {}) {
  const exclusive = Array.isArray(bindings?.exclusive) ? bindings.exclusive.map(String) : [];
  const groups = groupRegexesByExtensionGroupings(regexes);

  const renderItem = regex => {
    const id = String(regex?.id);
    const checked = exclusive.includes(id);
    const safeId = id.replace(/"/g, '&quot;');
    const safeName = escapeHtml(regex?.script_name || id);
    const stateIcon = regex?.enabled ? '●' : '○';
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

  const groupsHtml = groups
    .map((group) => {
      const items = Array.isArray(group?.items) ? group.items : [];
      const boundCount = items.filter(item => exclusive.includes(String(item?.id))).length;
      const total = items.length;
      const rows = items.map(renderItem).join('');
      const collapsed = !!group?.collapsed;
      const toggleIcon = collapsed ? '▶' : '▼';

      return `
        <div class="rb-group" data-group-id="${escapeAttr(group?.id ?? '')}" data-group="${escapeAttr(group?.name ?? '')}">
          <div class="rb-group-title">
            <span class="rb-group-toggle">${toggleIcon}</span>
            <span class="rb-group-name">${escapeHtml(group?.name ?? '未分组')}</span>
            <span class="rb-group-count">${boundCount}/${total}</span>
            <button class="rb-group-batch-btn menu_button">批量</button>
          </div>
          <div class="rb-group-content ${collapsed ? 'collapsed' : ''}">
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

export { renderRegexListComponent };
