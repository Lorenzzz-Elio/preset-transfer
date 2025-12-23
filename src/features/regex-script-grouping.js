import { getPresetTransferSettingsNode, trySaveSillyTavernSettings } from '../core/pt-extension-settings.js';

const STORAGE_KEY = 'preset-transfer-regex-script-groupings-v2';
const EXTENSION_SETTINGS_KEY = 'regexScriptGroupings';
const VERSION = 2;
const DEFAULT_GROUP_NAME = '分组';

function createGroupId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return `pt-rsg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeGroupForStore(entry) {
  if (!isPlainObject(entry)) return null;

  const id = typeof entry.id === 'string' && entry.id ? entry.id : createGroupId();
  const nameRaw = String(entry.name ?? entry.groupName ?? DEFAULT_GROUP_NAME);
  const name = nameRaw.trim() || DEFAULT_GROUP_NAME;
  const memberIds = Array.isArray(entry.memberIds)
    ? entry.memberIds.map(String).filter(Boolean)
    : Array.isArray(entry.members)
      ? entry.members.map(String).filter(Boolean)
      : null;
  if (!memberIds || memberIds.length === 0) return null;

  return {
    id,
    name,
    memberIds,
    collapsed: Object.prototype.hasOwnProperty.call(entry, 'collapsed') ? !!entry.collapsed : true,
  };
}

function loadRawStore() {
  // Prefer SillyTavern's server-synced extensionSettings (cross-browser).
  try {
    const { node } = getPresetTransferSettingsNode();
    const shared = node?.[EXTENSION_SETTINGS_KEY];
    if (shared && typeof shared === 'object') return shared;
  } catch {
    /* ignore */
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveRawStore(raw) {
  const next = raw && typeof raw === 'object' ? raw : { version: VERSION, groups: [] };

  try {
    const { context, node } = getPresetTransferSettingsNode({ create: true });
    if (node) {
      node[EXTENSION_SETTINGS_KEY] = next;
      trySaveSillyTavernSettings(context);
    }
  } catch {
    /* ignore */
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function resolveRange(orderedIds, startId, endId) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return null;
  const a = orderedIds.indexOf(startId);
  const b = orderedIds.indexOf(endId);
  if (a === -1 || b === -1) return null;
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

function getResolvedMemberIdsFromStore(group, orderedIds) {
  if (!group || !Array.isArray(group.memberIds) || group.memberIds.length === 0) return null;
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return [];
  const memberSet = new Set(group.memberIds.map(String));
  return orderedIds.filter((id) => memberSet.has(String(id)));
}

function getStoreGroupsNormalized() {
  const raw = loadRawStore();
  const groups = Array.isArray(raw?.groups) ? raw.groups : Array.isArray(raw) ? raw : [];
  return groups.map(normalizeGroupForStore).filter(Boolean);
}

function writeGroups(groups) {
  saveRawStore({ version: VERSION, groups: groups.map(normalizeGroupForStore).filter(Boolean) });
}

export function getAllRegexScriptGroupings(orderedIds) {
  const groups = getStoreGroupsNormalized();
  return groups.map((g) => {
    const members = getResolvedMemberIdsFromStore(g, orderedIds);
    const unresolved = !members || members.length === 0;
    const anchorIndex = !unresolved ? orderedIds.indexOf(members[0]) : -1;
    return { ...g, unresolved, memberIds: members ?? [], anchorIndex };
  });
}

export function getRegexScriptGroupingGroupedIdSet(orderedIds) {
  const out = new Set();
  const groups = getAllRegexScriptGroupings(orderedIds);
  for (const g of groups) {
    if (g.unresolved) continue;
    for (const id of Array.isArray(g.memberIds) ? g.memberIds : []) {
      if (id) out.add(String(id));
    }
  }
  return out;
}

export async function addRegexScriptGrouping(startId, endId, groupName, orderedIds) {
  try {
    if (typeof startId !== 'string' || typeof endId !== 'string') return false;
    const name = String(groupName ?? DEFAULT_GROUP_NAME).trim() || DEFAULT_GROUP_NAME;

    const groups = getStoreGroupsNormalized();
    const range = resolveRange(orderedIds, startId, endId);
    if (!range) return false;

    const grouped = getRegexScriptGroupingGroupedIdSet(orderedIds);
    const selectedMemberIds = orderedIds.slice(range.start, range.end + 1).map(String).filter(Boolean);
    const hasOverlap = selectedMemberIds.some((id) => grouped.has(id));
    if (hasOverlap) return false;

    groups.push({
      id: createGroupId(),
      name,
      memberIds: selectedMemberIds,
      collapsed: true,
    });
    writeGroups(groups);
    return true;
  } catch (e) {
    console.warn('[RegexGrouping] add group failed:', e);
    return false;
  }
}

export async function addRegexScriptGroupingFromMembers(memberIds, groupName, { collapsed = true } = {}) {
  try {
    const name = String(groupName ?? DEFAULT_GROUP_NAME).trim() || DEFAULT_GROUP_NAME;
    const ids = Array.isArray(memberIds) ? memberIds.map(String).filter(Boolean) : [];
    if (ids.length === 0) return false;

    const groups = getStoreGroupsNormalized();
    const existingMembers = new Set();
    for (const g of groups) {
      for (const id of Array.isArray(g.memberIds) ? g.memberIds : []) existingMembers.add(String(id));
    }
    const hasOverlap = ids.some((id) => existingMembers.has(String(id)));
    if (hasOverlap) return false;

    groups.push({
      id: createGroupId(),
      name,
      memberIds: ids,
      collapsed: !!collapsed,
    });
    writeGroups(groups);
    return true;
  } catch (e) {
    console.warn('[RegexGrouping] add group from members failed:', e);
    return false;
  }
}

export async function updateRegexScriptGrouping(groupId, patch = {}) {
  try {
    const id = String(groupId ?? '');
    if (!id) return false;

    const groups = getStoreGroupsNormalized();
    const idx = groups.findIndex((g) => g.id === id);
    if (idx === -1) return false;

    const next = { ...groups[idx] };
    if (typeof patch.name === 'string') next.name = patch.name.trim() || DEFAULT_GROUP_NAME;
    if (Array.isArray(patch.memberIds)) next.memberIds = patch.memberIds.map(String).filter(Boolean);
    if (typeof patch.collapsed === 'boolean') next.collapsed = patch.collapsed;

    const normalized = normalizeGroupForStore(next);
    if (!normalized) return false;

    groups[idx] = normalized;
    writeGroups(groups);
    return true;
  } catch (e) {
    console.warn('[RegexGrouping] update group failed:', e);
    return false;
  }
}

export async function removeRegexScriptGrouping(groupId) {
  try {
    const id = String(groupId ?? '');
    if (!id) return false;
    const groups = getStoreGroupsNormalized();
    const next = groups.filter((g) => g.id !== id);
    if (next.length === groups.length) return false;
    writeGroups(next);
    return true;
  } catch (e) {
    console.warn('[RegexGrouping] remove group failed:', e);
    return false;
  }
}

export async function setRegexScriptGroupingMembers(groupId, memberIds) {
  try {
    const id = String(groupId ?? '');
    if (!id) return false;

    const groups = getStoreGroupsNormalized();
    const idx = groups.findIndex((g) => g.id === id);
    if (idx === -1) return false;

    const nextMembers = Array.isArray(memberIds) ? memberIds.map(String).filter(Boolean) : [];
    if (nextMembers.length === 0) {
      writeGroups(groups.filter((g) => g.id !== id));
      return true;
    }

    groups[idx] = normalizeGroupForStore({ ...groups[idx], memberIds: nextMembers }) ?? groups[idx];
    writeGroups(groups);
    return true;
  } catch (e) {
    console.warn('[RegexGrouping] set group members failed:', e);
    return false;
  }
}

export async function setRegexScriptGroupingMembersBulk(patches = []) {
  try {
    const groups = getStoreGroupsNormalized();
    const byId = new Map(groups.map((g) => [g.id, g]));

    for (const patch of Array.isArray(patches) ? patches : []) {
      const id = String(patch?.id ?? patch?.groupId ?? '');
      if (!id) continue;
      const existing = byId.get(id);
      if (!existing) continue;

      const nextMembers = Array.isArray(patch?.memberIds) ? patch.memberIds.map(String).filter(Boolean) : [];
      if (nextMembers.length === 0) {
        byId.delete(id);
      } else {
        const updated = normalizeGroupForStore({ ...existing, memberIds: nextMembers });
        if (updated) byId.set(id, updated);
      }
    }

    writeGroups(Array.from(byId.values()));
    return true;
  } catch (e) {
    console.warn('[RegexGrouping] bulk set group members failed:', e);
    return false;
  }
}

export function exportRegexScriptGroupingsForBundle(exportedRegexIds, orderedIds) {
  const exportedSet = new Set(Array.isArray(exportedRegexIds) ? exportedRegexIds.map(String) : []);
  if (exportedSet.size === 0) return { version: VERSION, groups: [] };

  const groups = getStoreGroupsNormalized();
  const out = [];

  for (const g of groups) {
    const members = getResolvedMemberIdsFromStore(g, orderedIds);
    if (!members || members.length === 0) continue;
    const allIncluded = members.every((id) => exportedSet.has(String(id)));
    if (!allIncluded) continue;
    out.push({
      name: g.name,
      collapsed: !!g.collapsed,
      memberIds: members.map(String),
    });
  }

  return { version: VERSION, groups: out };
}

export async function importRegexScriptGroupingsFromBundle(bundleGroupings, idMap = []) {
  if (!bundleGroupings || typeof bundleGroupings !== 'object') return { imported: 0 };
  const groups = Array.isArray(bundleGroupings.groups) ? bundleGroupings.groups : [];
  if (groups.length === 0) return { imported: 0 };

  const map = new Map((Array.isArray(idMap) ? idMap : []).map((m) => [String(m?.oldId ?? ''), String(m?.newId ?? '')]));
  const existing = getStoreGroupsNormalized();

  let imported = 0;
  for (const g of groups) {
    const name = String(g?.name ?? DEFAULT_GROUP_NAME).trim() || DEFAULT_GROUP_NAME;
    const memberIds = Array.isArray(g?.memberIds) ? g.memberIds.map(String).filter(Boolean) : [];
    if (memberIds.length === 0) continue;

    const mappedMembers = memberIds.map((id) => map.get(id) || '').filter(Boolean);
    if (mappedMembers.length === 0) continue;

    existing.push({
      id: createGroupId(),
      name,
      memberIds: mappedMembers,
      collapsed: !!g?.collapsed,
    });
    imported += 1;
  }

  writeGroups(existing);
  return { imported };
}
