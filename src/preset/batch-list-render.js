import { escapeHtml } from '../core/utils.js';
import { normalizePresetListGroupState } from '../features/preset-list-grouping.js';

const GROUP_TOKEN_PREFIX = 'g:';
const ITEM_TOKEN_PREFIX = 'p:';

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseOrderToken(raw) {
  const token = String(raw ?? '').trim();
  if (!token) return { type: 'empty', value: '' };
  if (token.startsWith(GROUP_TOKEN_PREFIX)) return { type: 'group', value: token.slice(GROUP_TOKEN_PREFIX.length).trim() };
  if (token.startsWith(ITEM_TOKEN_PREFIX)) return { type: 'item', value: token.slice(ITEM_TOKEN_PREFIX.length).trim() };
  return { type: 'unknown', value: token };
}

function buildPresetItemHtml(name, bucketId, { disabled = false, badgeText = '' } = {}) {
  const safeText = escapeHtml(String(name ?? ''));
  const safeValue = escapeAttr(name);
  const safeBucket = escapeAttr(bucketId);
  const disabledAttr = disabled ? 'disabled' : '';
  const badgeHtml = badgeText ? `<span class="current-badge">${escapeHtml(badgeText)}</span>` : '';

  return `
    <label class="preset-item pt-wb-item" data-pt-bucket="${safeBucket}" data-pt-name="${safeValue}">
      <span class="pt-wb-drag-handle" aria-hidden="true">&#8942;&#8942;</span>
      <input type="checkbox" value="${safeValue}" ${disabledAttr}>
      <span class="preset-name">${safeText}</span>
      ${badgeHtml}
    </label>
  `;
}

function buildGroupHtml({ bucketId, groupName, members, disabledPresets }) {
  const safeBucket = escapeAttr(bucketId);
  const encodedGroup = encodeURIComponent(groupName);
  const disabledSet = disabledPresets instanceof Set ? disabledPresets : new Set();

  return `
    <div class="pt-wb-subgroup" data-pt-bucket="${safeBucket}" data-pt-sub="${encodedGroup}">
      <div class="pt-wb-subgroup-header" role="button" tabindex="0">
        <span class="pt-wb-header-left">
          <span class="pt-wb-drag-handle" aria-hidden="true">&#8942;&#8942;</span>
          <span class="pt-wb-caret" aria-hidden="true"></span>
          <span class="pt-wb-subgroup-title">${escapeHtml(groupName)}</span>
        </span>
        <span class="pt-wb-header-right">
          <span class="pt-wb-count">(${members.length})</span>
          <button type="button" class="menu_button pt-wb-subgroup-menu" title="分组操作" aria-label="分组操作">&#8230;</button>
        </span>
      </div>
      <div class="pt-wb-subgroup-body">
        ${members
          .map((name) =>
            buildPresetItemHtml(name, bucketId, {
              disabled: disabledSet.has(name),
              badgeText: name === 'in_use' ? '当前使用' : '',
            }),
          )
          .join('')}
      </div>
    </div>
  `;
}

function renderPresetGroupedListParts({ presetNames, groupState, disabledPresets } = {}) {
  const state = normalizePresetListGroupState(groupState);
  const bucketId = 'flat';
  const names = Array.isArray(presetNames) ? presetNames : [];

  const normalizedNames = [];
  const seenNames = new Set();
  for (const name of names) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed || seenNames.has(trimmed)) continue;
    seenNames.add(trimmed);
    normalizedNames.push(trimmed);
  }

  const existingNamesSet = new Set(normalizedNames);
  const groups = state.groups && typeof state.groups === 'object' ? state.groups : {};
  const normalizedGroups = {};
  const grouped = new Set();

  for (const [rawName, members] of Object.entries(groups)) {
    const groupName = String(rawName ?? '').trim();
    if (!groupName) continue;
    const filtered = (Array.isArray(members) ? members : [])
      .map((x) => String(x ?? '').trim())
      .filter((x) => existingNamesSet.has(x));
    normalizedGroups[groupName] = filtered;
    for (const name of filtered) grouped.add(name);
  }

  const ungroupedNames = normalizedNames.filter((n) => !grouped.has(n));
  const renderedGroups = new Set();
  const renderedItems = new Set();
  const htmlParts = [];

  const order = Array.isArray(state.order) ? state.order : [];
  for (const raw of order) {
    const parsed = parseOrderToken(raw);
    if (parsed.type === 'group') {
      const groupName = String(parsed.value ?? '').trim();
      if (!groupName || renderedGroups.has(groupName)) continue;
      const members = normalizedGroups[groupName] ?? [];
      renderedGroups.add(groupName);
      htmlParts.push(buildGroupHtml({ bucketId, groupName, members, disabledPresets }));
      continue;
    }

    if (parsed.type === 'item') {
      const name = String(parsed.value ?? '').trim();
      if (!name || renderedItems.has(name) || !existingNamesSet.has(name) || grouped.has(name)) continue;
      renderedItems.add(name);
      htmlParts.push(
        buildPresetItemHtml(name, bucketId, {
          disabled: disabledPresets instanceof Set ? disabledPresets.has(name) : false,
          badgeText: name === 'in_use' ? '当前使用' : '',
        }),
      );
    }
  }

  for (const groupName of Object.keys(normalizedGroups)) {
    if (renderedGroups.has(groupName)) continue;
    renderedGroups.add(groupName);
    htmlParts.push(buildGroupHtml({ bucketId, groupName, members: normalizedGroups[groupName], disabledPresets }));
  }

  for (const name of ungroupedNames) {
    if (renderedItems.has(name)) continue;
    renderedItems.add(name);
    htmlParts.push(
      buildPresetItemHtml(name, bucketId, {
        disabled: disabledPresets instanceof Set ? disabledPresets.has(name) : false,
        badgeText: name === 'in_use' ? '当前使用' : '',
      }),
    );
  }

  return htmlParts;
}

function renderPresetGroupedList(params) {
  return renderPresetGroupedListParts(params).join('');
}

export { renderPresetGroupedList, renderPresetGroupedListParts };
