import { getPresetTransferSettingsNode, trySaveSillyTavernSettings } from './pt-extension-settings.js';

const WORLDBOOK_GROUPS_STORAGE_KEY = 'preset-transfer-worldbook-batch-groups-v1';
const EXTENSION_SETTINGS_KEY = 'worldbookGroupingState';

// Legacy token used by v3 state to place an "Ungrouped" block.
const LEGACY_UNGROUPED_TOKEN = '__ungrouped__';

// v4: a single, mixed order list where groups and standalone worldbooks can interleave.
const GROUP_TOKEN_PREFIX = 'g:';
const ITEM_TOKEN_PREFIX = 'w:';

function groupToken(name) {
  const trimmed = String(name ?? '').trim();
  return trimmed ? `${GROUP_TOKEN_PREFIX}${trimmed}` : '';
}

function itemToken(name) {
  const trimmed = String(name ?? '').trim();
  return trimmed ? `${ITEM_TOKEN_PREFIX}${trimmed}` : '';
}

function parseOrderToken(raw) {
  const token = String(raw ?? '').trim();
  if (!token) return { type: 'empty', value: '' };
  if (token === LEGACY_UNGROUPED_TOKEN) return { type: 'legacy_ungrouped', value: LEGACY_UNGROUPED_TOKEN };
  if (token.startsWith(GROUP_TOKEN_PREFIX)) return { type: 'group', value: token.slice(GROUP_TOKEN_PREFIX.length).trim() };
  if (token.startsWith(ITEM_TOKEN_PREFIX)) return { type: 'item', value: token.slice(ITEM_TOKEN_PREFIX.length).trim() };
  return { type: 'legacy_group', value: token };
}

function normalizeMembers(members) {
  const arr = Array.isArray(members) ? members : [];
  const out = [];
  const seen = new Set();
  for (const m of arr) {
    const t = String(m ?? '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function getDefaultWorldbookGroupState() {
  return {
    version: 4,
    prefs: {
      titles: {
        bound: '\u5df2\u7ed1\u5b9a\u89d2\u8272',
        unbound: '\u672a\u7ed1\u5b9a\u89d2\u8272',
      },
      enabled: {
        bound: true,
        unbound: true,
      },
      bootstrappedDefaultGroups: false,
    },
    // Kept for backward compatibility with v3 persisted state.
    binding: {
      bound: { order: [], groups: {} },
      unbound: { order: [], groups: {} },
    },
    flat: { order: [], groups: {} },
  };
}

function normalizeBucket(bucket) {
  const b = bucket && typeof bucket === 'object' ? bucket : {};
  const rawOrder = Array.isArray(b.order) ? b.order.filter((x) => typeof x === 'string' && x.trim()) : [];
  const rawGroups = b.groups && typeof b.groups === 'object' ? b.groups : {};

  const groups = {};
  for (const [name, members] of Object.entries(rawGroups)) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) continue;
    const normalized = normalizeMembers(members);
    if (!normalized.length) continue;
    groups[trimmed] = normalized;
  }

  const existingGroupNames = new Set(Object.keys(groups));
  const order = [];
  const seenGroups = new Set();
  const seenItems = new Set();

  for (const raw of rawOrder) {
    const parsed = parseOrderToken(raw);
    if (parsed.type === 'empty' || parsed.type === 'legacy_ungrouped') continue;

    if (parsed.type === 'group' || parsed.type === 'legacy_group') {
      const name = String(parsed.value ?? '').trim();
      if (!name || !existingGroupNames.has(name) || seenGroups.has(name)) continue;
      seenGroups.add(name);
      order.push(groupToken(name));
      continue;
    }

    if (parsed.type === 'item') {
      const name = String(parsed.value ?? '').trim();
      if (!name || seenItems.has(name)) continue;
      seenItems.add(name);
      order.push(itemToken(name));
    }
  }

  for (const name of existingGroupNames) {
    if (seenGroups.has(name)) continue;
    order.push(groupToken(name));
  }

  return { order, groups };
}

function normalizeWorldbookGroupState(state) {
  const next = state && typeof state === 'object' ? state : {};
  const defaultState = getDefaultWorldbookGroupState();

  const prefs = next.prefs && typeof next.prefs === 'object' ? next.prefs : {};
  const titles = prefs.titles && typeof prefs.titles === 'object' ? prefs.titles : {};
  const enabled = prefs.enabled && typeof prefs.enabled === 'object' ? prefs.enabled : {};
  const bootstrappedDefaultGroups =
    typeof prefs.bootstrappedDefaultGroups === 'boolean' ? prefs.bootstrappedDefaultGroups : false;

  const legacyMode = prefs.mode === 'flat' ? 'flat' : 'binding';
  const defaultEnabled = legacyMode === 'flat' ? { bound: false, unbound: false } : { bound: true, unbound: true };

  const rawBinding =
    next.binding && typeof next.binding === 'object'
      ? next.binding
      : next.bound || next.unbound
      ? { bound: next.bound, unbound: next.unbound }
      : defaultState.binding;

  return {
    version: 4,
    prefs: {
      titles: {
        bound: typeof titles.bound === 'string' && titles.bound.trim() ? titles.bound.trim() : defaultState.prefs.titles.bound,
        unbound:
          typeof titles.unbound === 'string' && titles.unbound.trim()
            ? titles.unbound.trim()
            : defaultState.prefs.titles.unbound,
      },
      enabled: {
        bound: typeof enabled.bound === 'boolean' ? enabled.bound : defaultEnabled.bound,
        unbound: typeof enabled.unbound === 'boolean' ? enabled.unbound : defaultEnabled.unbound,
      },
      bootstrappedDefaultGroups,
    },
    binding: {
      bound: normalizeBucket(rawBinding?.bound),
      unbound: normalizeBucket(rawBinding?.unbound),
    },
    flat: normalizeBucket(next.flat),
  };
}

function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function readSharedStateRaw() {
  try {
    const { node } = getPresetTransferSettingsNode();
    if (!node) return null;
    return node[EXTENSION_SETTINGS_KEY] ?? null;
  } catch {
    return null;
  }
}

function writeSharedStateRaw(value) {
  try {
    const { context, node } = getPresetTransferSettingsNode({ create: true });
    if (!node) return false;
    node[EXTENSION_SETTINGS_KEY] = value;
    trySaveSillyTavernSettings(context);
    return true;
  } catch {
    return false;
  }
}

function loadWorldbookGroupState() {
  try {
    const rawShared = readSharedStateRaw();
    if (rawShared) {
      const parsed =
        typeof rawShared === 'string'
          ? JSON.parse(rawShared)
          : rawShared && typeof rawShared === 'object'
          ? rawShared
          : null;
      if (parsed) return normalizeWorldbookGroupState(parsed);
    }
  } catch {
    // fall back to localStorage
  }

  try {
    const raw = safeLocalStorageGet(WORLDBOOK_GROUPS_STORAGE_KEY);
    if (!raw) return getDefaultWorldbookGroupState();
    const parsed = JSON.parse(raw);
    const normalized = normalizeWorldbookGroupState(parsed);
    // One-time migration: localStorage -> extensionSettings.
    writeSharedStateRaw(normalized);
    return normalized;
  } catch {
    return getDefaultWorldbookGroupState();
  }
}

function saveWorldbookGroupState(state) {
  const normalized = normalizeWorldbookGroupState(state);

  // Prefer server-synced settings so grouping is shared across browsers.
  const storedShared = writeSharedStateRaw(normalized);

  // Keep legacy localStorage for backwards-compatibility.
  safeLocalStorageSet(WORLDBOOK_GROUPS_STORAGE_KEY, JSON.stringify(normalized));

  return storedShared;
}

function pruneWorldbookGroupState(state, existingNamesSet) {
  const next = normalizeWorldbookGroupState(state);

  const pruneBucket = (bucket) => {
    const groups = {};
    for (const [name, members] of Object.entries(bucket.groups || {})) {
      const filtered = normalizeMembers(members).filter((x) => existingNamesSet.has(x));
      if (!filtered.length) continue;
      groups[name] = filtered;
    }

    const grouped = new Set();
    for (const members of Object.values(groups)) {
      for (const n of members) grouped.add(n);
    }

    const order = [];
    const seenGroup = new Set();
    const seenItem = new Set();

    for (const raw of Array.isArray(bucket.order) ? bucket.order : []) {
      const parsed = parseOrderToken(raw);
      if (parsed.type === 'empty' || parsed.type === 'legacy_ungrouped') continue;

      if (parsed.type === 'group' || parsed.type === 'legacy_group') {
        const name = String(parsed.value ?? '').trim();
        if (!name || !groups[name] || seenGroup.has(name)) continue;
        seenGroup.add(name);
        order.push(groupToken(name));
        continue;
      }

      if (parsed.type === 'item') {
        const name = String(parsed.value ?? '').trim();
        if (!name || seenItem.has(name) || !existingNamesSet.has(name) || grouped.has(name)) continue;
        seenItem.add(name);
        order.push(itemToken(name));
      }
    }

    for (const name of Object.keys(groups)) {
      if (seenGroup.has(name)) continue;
      order.push(groupToken(name));
    }

    return { order, groups };
  };

  next.binding.bound = pruneBucket(next.binding.bound);
  next.binding.unbound = pruneBucket(next.binding.unbound);
  next.flat = pruneBucket(next.flat);
  return next;
}

function removeWorldbooksFromAllGroups(state, worldbookNames) {
  const next = normalizeWorldbookGroupState(state);
  const targets = new Set(
    (Array.isArray(worldbookNames) ? worldbookNames : [])
      .map((x) => String(x ?? '').trim())
      .filter(Boolean),
  );
  if (!targets.size) return next;

  const pruneBucket = (bucket) => {
    for (const [name, members] of Object.entries(bucket?.groups || {})) {
      if (!Array.isArray(members)) continue;
      bucket.groups[name] = members.filter((x) => !targets.has(String(x ?? '').trim()));
    }

    for (const [name, members] of Object.entries(bucket?.groups || {})) {
      if (!members || !members.length) delete bucket.groups[name];
    }

    bucket.order = (Array.isArray(bucket?.order) ? bucket.order : []).filter((raw) => {
      const parsed = parseOrderToken(raw);
      if (parsed.type === 'empty' || parsed.type === 'legacy_ungrouped') return false;

      if (parsed.type === 'group' || parsed.type === 'legacy_group') {
        const name = String(parsed.value ?? '').trim();
        return Boolean(name && (bucket.groups[name] || []).length > 0);
      }

      if (parsed.type === 'item') {
        const name = String(parsed.value ?? '').trim();
        return Boolean(name && !targets.has(name));
      }

      return false;
    });
  };

  pruneBucket(next.binding.bound);
  pruneBucket(next.binding.unbound);
  pruneBucket(next.flat);
  return normalizeWorldbookGroupState(next);
}

function assignWorldbooksToGroup(state, { worldbookNames, groupName, boundSet }) {
  void boundSet;
  const trimmedName = String(groupName ?? '').trim();
  if (!trimmedName) return normalizeWorldbookGroupState(state);

  let next = normalizeWorldbookGroupState(state);
  const normalizedTargets = (Array.isArray(worldbookNames) ? worldbookNames : [])
    .map((x) => String(x ?? '').trim())
    .filter(Boolean);
  if (!normalizedTargets.length) return next;

  next = removeWorldbooksFromAllGroups(next, normalizedTargets);

  const bucket = next.flat;
  if (!bucket.groups || typeof bucket.groups !== 'object') bucket.groups = {};
  if (!Array.isArray(bucket.order)) bucket.order = [];

  if (!Array.isArray(bucket.groups[trimmedName])) bucket.groups[trimmedName] = [];

  // Ensure the group exists in order (as a group token).
  const groupTok = groupToken(trimmedName);
  if (groupTok && !bucket.order.includes(groupTok)) bucket.order.push(groupTok);

  // Remove any standalone ordering for these items since they are now grouped.
  const toAssign = new Set(normalizedTargets);
  bucket.order = bucket.order.filter((raw) => {
    const parsed = parseOrderToken(raw);
    if (parsed.type !== 'item') return true;
    return !toAssign.has(String(parsed.value ?? '').trim());
  });

  // Ensure exclusivity: an item can only be in one group.
  for (const [name, members] of Object.entries(bucket.groups)) {
    if (!Array.isArray(members)) continue;
    if (name === trimmedName) continue;
    bucket.groups[name] = members.filter((x) => !toAssign.has(String(x ?? '').trim()));
  }

  // Append new members while preserving the existing in-group order.
  const merged = normalizeMembers(bucket.groups[trimmedName]);
  const seen = new Set(merged);
  for (const n of normalizedTargets) {
    if (seen.has(n)) continue;
    seen.add(n);
    merged.push(n);
  }
  bucket.groups[trimmedName] = merged;

  for (const [name, members] of Object.entries(bucket.groups)) {
    if (!members || !members.length) delete bucket.groups[name];
  }

  bucket.order = bucket.order.filter((raw) => {
    const parsed = parseOrderToken(raw);
    if (parsed.type === 'legacy_ungrouped' || parsed.type === 'empty') return false;
    if (parsed.type === 'group' || parsed.type === 'legacy_group') {
      const name = String(parsed.value ?? '').trim();
      return Boolean(name && (bucket.groups[name] || []).length > 0);
    }
    return true;
  });

  return normalizeWorldbookGroupState(next);
}

function dissolveWorldbookGroupInBucket(state, bucketId, groupName) {
  const trimmedOld = String(groupName ?? '').trim();
  if (!trimmedOld) return normalizeWorldbookGroupState(state);

  const next = normalizeWorldbookGroupState(state);
  const bucket =
    bucketId === 'bound'
      ? next.binding.bound
      : bucketId === 'unbound'
      ? next.binding.unbound
      : bucketId === 'flat'
      ? next.flat
      : null;
  if (!bucket) return next;

  delete bucket.groups[trimmedOld];
  const tok = groupToken(trimmedOld);
  bucket.order = (Array.isArray(bucket.order) ? bucket.order : []).filter((raw) => {
    const parsed = parseOrderToken(raw);
    if (parsed.type === 'legacy_ungrouped' || parsed.type === 'empty') return false;
    if (parsed.type === 'group' || parsed.type === 'legacy_group') {
      const name = String(parsed.value ?? '').trim();
      return Boolean(name && name !== trimmedOld && (bucket.groups[name] || []).length > 0);
    }
    return true;
  });
  if (tok) bucket.order = bucket.order.filter((x) => x !== tok);

  return normalizeWorldbookGroupState(next);
}

function renameWorldbookGroupInBucket(state, bucketId, oldName, newName) {
  const trimmedOld = String(oldName ?? '').trim();
  const trimmedNew = String(newName ?? '').trim();
  if (!trimmedOld || !trimmedNew || trimmedOld === trimmedNew) return normalizeWorldbookGroupState(state);

  const next = normalizeWorldbookGroupState(state);
  const bucket =
    bucketId === 'bound'
      ? next.binding.bound
      : bucketId === 'unbound'
      ? next.binding.unbound
      : bucketId === 'flat'
      ? next.flat
      : null;
  if (!bucket) return next;

  const oldMembers = Array.isArray(bucket.groups[trimmedOld]) ? bucket.groups[trimmedOld] : [];
  if (!oldMembers.length) return next;

  const newMembers = Array.isArray(bucket.groups[trimmedNew]) ? bucket.groups[trimmedNew] : [];
  bucket.groups[trimmedNew] = normalizeMembers([...newMembers, ...oldMembers]);
  delete bucket.groups[trimmedOld];

  const oldTok = groupToken(trimmedOld);
  const newTok = groupToken(trimmedNew);

  bucket.order = (Array.isArray(bucket.order) ? bucket.order : []).map((raw) => {
    const parsed = parseOrderToken(raw);
    if (parsed.type === 'group' || parsed.type === 'legacy_group') {
      const name = String(parsed.value ?? '').trim();
      if (name === trimmedOld) return newTok;
    }
    return raw;
  });

  // Ensure the new group is present in order.
  if (newTok && !bucket.order.includes(newTok)) bucket.order.push(newTok);
  if (oldTok) bucket.order = bucket.order.filter((x) => x !== oldTok);

  bucket.order = bucket.order.filter((raw) => {
    const parsed = parseOrderToken(raw);
    if (parsed.type === 'legacy_ungrouped' || parsed.type === 'empty') return false;
    if (parsed.type === 'group' || parsed.type === 'legacy_group') {
      const name = String(parsed.value ?? '').trim();
      return Boolean(name && (bucket.groups[name] || []).length > 0);
    }
    return true;
  });

  for (const [name, members] of Object.entries(bucket.groups || {})) {
    if (!members || !members.length) delete bucket.groups[name];
  }

  return normalizeWorldbookGroupState(next);
}

function renameTopGroupTitle(state, topGroupId, newTitle) {
  const next = normalizeWorldbookGroupState(state);
  const trimmed = String(newTitle ?? '').trim();
  if (!trimmed) return next;

  if (!next.prefs || typeof next.prefs !== 'object') next.prefs = {};
  if (!next.prefs.titles || typeof next.prefs.titles !== 'object') next.prefs.titles = {};

  if (topGroupId === 'bound') next.prefs.titles.bound = trimmed;
  if (topGroupId === 'unbound') next.prefs.titles.unbound = trimmed;

  return normalizeWorldbookGroupState(next);
}

function setTopGroupEnabled(state, topGroupId, enabled) {
  const next = normalizeWorldbookGroupState(state);
  if (!next.prefs || typeof next.prefs !== 'object') next.prefs = {};
  if (!next.prefs.enabled || typeof next.prefs.enabled !== 'object') {
    next.prefs.enabled = { bound: true, unbound: true };
  }

  const nextEnabled = typeof enabled === 'boolean' ? enabled : true;
  if (topGroupId === 'bound') next.prefs.enabled.bound = nextEnabled;
  if (topGroupId === 'unbound') next.prefs.enabled.unbound = nextEnabled;

  return normalizeWorldbookGroupState(next);
}

export {
  WORLDBOOK_GROUPS_STORAGE_KEY,
  getDefaultWorldbookGroupState,
  normalizeWorldbookGroupState,
  loadWorldbookGroupState,
  saveWorldbookGroupState,
  pruneWorldbookGroupState,
  assignWorldbooksToGroup,
  removeWorldbooksFromAllGroups,
  dissolveWorldbookGroupInBucket,
  renameWorldbookGroupInBucket,
  renameTopGroupTitle,
  setTopGroupEnabled,
};
