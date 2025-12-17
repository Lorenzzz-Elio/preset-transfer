import { escapeHtml } from '../core/utils.js';

function getGroupName(name) {
  const match = (name || '').match(/^(【[^】]+】|[^-\[\]_.]+[-\[\]_.])/);
  let group = match ? match[1].replace(/[-\[\]_.]$/, '').replace(/^【|】$/g, '') : '未分组';
  group = (group || '未分组').replace(/['"\\]/g, '').trim();
  return group.length ? group : '未分组';
}

function groupRegexes(regexes) {
  const groups = new Map();
  (regexes || []).forEach(regex => {
    const group = getGroupName(regex?.script_name || String(regex?.id));
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(regex);
  });
  return groups;
}

function renderRegexListComponent({ regexes = [], bindings = { exclusive: [] } } = {}) {
  const exclusive = Array.isArray(bindings?.exclusive) ? bindings.exclusive.map(String) : [];
  const groups = groupRegexes(regexes);

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

  const groupsHtml = Array.from(groups.entries())
    .map(([group, items]) => {
      const boundCount = items.filter(item => exclusive.includes(String(item?.id))).length;
      const total = items.length;
      const rows = items.map(renderItem).join('');
      return `
        <div class="rb-group" data-group="${escapeHtml(group)}">
          <div class="rb-group-title">
            <span class="rb-group-toggle">▶</span>
            <span class="rb-group-name">${escapeHtml(group)}</span>
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

export { renderRegexListComponent };
