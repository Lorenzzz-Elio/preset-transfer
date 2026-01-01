import { escapeHtml } from '../core/utils.js';
import { normalizeWorldbookGroupState } from '../core/worldbook-group-state.js';

const GROUP_TOKEN_PREFIX = 'g:';
const ITEM_TOKEN_PREFIX = 'w:';

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

function buildWorldbookItemHtml(name, bucketId) {
  const safeText = escapeHtml(String(name ?? ''));
  const safeValue = escapeAttr(name);
  const safeBucket = escapeAttr(bucketId);

  return `
    <label class="preset-item pt-wb-item" data-pt-bucket="${safeBucket}" data-pt-name="${safeValue}">
      <span class="pt-wb-drag-handle" aria-hidden="true">&#8942;&#8942;</span>
      <input type="checkbox" value="${safeValue}">
      <span class="preset-name">${safeText}</span>
    </label>
  `;
}

function buildGroupHtml({ bucketId, groupName, members }) {
  const safeBucket = escapeAttr(bucketId);
  const encodedGroup = encodeURIComponent(groupName);

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
        ${members.map((n) => buildWorldbookItemHtml(n, bucketId)).join('')}
      </div>
    </div>
  `;
}

function renderWorldbookGroupedListParts({ worldbookNames, boundSet, groupState }) {
  const state = normalizeWorldbookGroupState(groupState);
  const bucketId = 'flat';
  const bucket = state.flat || { order: [], groups: {} };

  const names = Array.isArray(worldbookNames) ? worldbookNames : [];
  const normalizedNames = [];
  const seenNames = new Set();
  for (const name of names) {
    const t = String(name ?? '').trim();
    if (!t || seenNames.has(t)) continue;
    seenNames.add(t);
    normalizedNames.push(t);
  }
  const existingNamesSet = new Set(normalizedNames);

  const titles = state?.prefs?.titles ?? {};
  const enabled = state?.prefs?.enabled ?? {};

  const LEGACY_BOUND_TITLE = '\u5df2\u7ed1\u5b9a\u89d2\u8272';
  const LEGACY_UNBOUND_TITLE = '\u672a\u7ed1\u5b9a\u89d2\u8272';

  const boundTitle = String(titles?.bound ?? '').trim() || LEGACY_BOUND_TITLE;
  const unboundTitle = String(titles?.unbound ?? '').trim() || LEGACY_UNBOUND_TITLE;

  const boundEnabled = enabled?.bound !== false;
  const unboundEnabled = enabled?.unbound !== false;

  const groups = bucket.groups && typeof bucket.groups === 'object' ? bucket.groups : {};
  const normalizedGroups = {};

  const autoGroupNames = new Set([boundTitle, unboundTitle, LEGACY_BOUND_TITLE, LEGACY_UNBOUND_TITLE].filter(Boolean));
  const boundGroupNames = new Set([boundTitle, LEGACY_BOUND_TITLE].filter(Boolean));
  const unboundGroupNames = new Set([unboundTitle, LEGACY_UNBOUND_TITLE].filter(Boolean));

  const normalizeAutoGroupName = (rawName) => {
    const name = String(rawName ?? '').trim();
    if (!name) return '';
    if (!autoGroupNames.has(name)) return name;
    if (boundGroupNames.has(name)) return boundTitle;
    if (unboundGroupNames.has(name)) return unboundTitle;
    return name;
  };
  const manualGroupedNames = new Set();

  for (const [name, members] of Object.entries(groups)) {
    const groupName = String(name ?? '').trim();
    if (!groupName || autoGroupNames.has(groupName)) continue;
    const filtered = (Array.isArray(members) ? members : [])
      .map((x) => String(x ?? '').trim())
      .filter((x) => existingNamesSet.has(x));
    if (!filtered.length) continue;
    normalizedGroups[groupName] = filtered;
    for (const n of filtered) manualGroupedNames.add(n);
  }

  const normalizeExistingAutoMembers = ({ groupNames, shouldKeep }) => {
    const merged = [];
    const seen = new Set();

    for (const groupName of groupNames) {
      const members = groups[groupName];
      if (!Array.isArray(members)) continue;
      for (const raw of members) {
        const name = String(raw ?? '').trim();
        if (!name || seen.has(name) || !existingNamesSet.has(name) || manualGroupedNames.has(name)) continue;
        if (!shouldKeep(name)) continue;
        seen.add(name);
        merged.push(name);
      }
    }

    return { merged, seen };
  };

  const buildAutoGroupMembers = ({ isBound, enabled: isEnabled }) => {
    if (!isEnabled) return [];

    const groupNamesToMerge = isBound
      ? [boundTitle, LEGACY_BOUND_TITLE, LEGACY_UNBOUND_TITLE, unboundTitle]
      : [unboundTitle, LEGACY_UNBOUND_TITLE, LEGACY_BOUND_TITLE, boundTitle];

    const { merged, seen } = normalizeExistingAutoMembers({
      groupNames: groupNamesToMerge,
      shouldKeep: (name) => Boolean(boundSet?.has?.(name)) === isBound,
    });

    for (const name of normalizedNames) {
      if (!name || seen.has(name) || manualGroupedNames.has(name)) continue;
      const currentIsBound = Boolean(boundSet?.has?.(name));
      if (currentIsBound !== isBound) continue;
      seen.add(name);
      merged.push(name);
    }

    return merged;
  };

  const unboundAutoMembers = buildAutoGroupMembers({ isBound: false, enabled: unboundEnabled });
  const boundAutoMembers = buildAutoGroupMembers({ isBound: true, enabled: boundEnabled });

  if (unboundAutoMembers.length) normalizedGroups[unboundTitle] = unboundAutoMembers;
  if (boundAutoMembers.length) normalizedGroups[boundTitle] = boundAutoMembers;

  const grouped = new Set();
  for (const members of Object.values(normalizedGroups)) {
    for (const n of members) grouped.add(n);
  }

  const ungroupedNames = normalizedNames.filter((n) => !grouped.has(n));

  const renderedGroups = new Set();
  const renderedItems = new Set();
  const htmlParts = [];

  const order = Array.isArray(bucket.order) ? bucket.order : [];

  for (const raw of order) {
    const parsed = parseOrderToken(raw);
    if (parsed.type === 'group') {
      const groupName = normalizeAutoGroupName(parsed.value);
      const members = normalizedGroups[groupName];
      if (!groupName || !members || !members.length || renderedGroups.has(groupName)) continue;
      renderedGroups.add(groupName);
      htmlParts.push(buildGroupHtml({ bucketId, groupName, members }));
      continue;
    }

    if (parsed.type === 'item') {
      const name = String(parsed.value ?? '').trim();
      if (!name || renderedItems.has(name) || !existingNamesSet.has(name) || grouped.has(name)) continue;
      renderedItems.add(name);
      htmlParts.push(buildWorldbookItemHtml(name, bucketId));
    }
  }

  for (const groupName of Object.keys(normalizedGroups)) {
    if (renderedGroups.has(groupName)) continue;
    renderedGroups.add(groupName);
    htmlParts.push(buildGroupHtml({ bucketId, groupName, members: normalizedGroups[groupName] }));
  }

  for (const name of ungroupedNames) {
    if (renderedItems.has(name)) continue;
    renderedItems.add(name);
    htmlParts.push(buildWorldbookItemHtml(name, bucketId));
  }

  return htmlParts;
}

function renderWorldbookGroupedList(params) {
  return renderWorldbookGroupedListParts(params).join('');
}

export { renderWorldbookGroupedList, renderWorldbookGroupedListParts };
