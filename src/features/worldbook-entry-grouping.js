import { getWorldInfoModule } from '../core/worldbook-api.js';

const DEFAULT_GROUP_NAME = '分组';
const DEFAULT_MODE = 'inclusive';

function createGroupId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return `pt-wi-eg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readGroupName(entry) {
  return entry?.name || entry?.groupName || DEFAULT_GROUP_NAME;
}

function isLegacyIndexGrouping(entry) {
  return typeof entry?.startIndex === 'number' && typeof entry?.endIndex === 'number';
}

function isUidAnchorGrouping(entry) {
  return (
    typeof entry?.startUid === 'string'
    || typeof entry?.endUid === 'string'
    || typeof entry?.startUid === 'number'
    || typeof entry?.endUid === 'number'
  );
}

function normalizeForRead(entry, orderedUids) {
  if (!isPlainObject(entry)) return null;

  if (isLegacyIndexGrouping(entry)) {
    const startUid = Array.isArray(orderedUids) ? orderedUids[entry.startIndex] : null;
    const endUid = Array.isArray(orderedUids) ? orderedUids[entry.endIndex] : null;
    if (typeof startUid === 'string' && typeof endUid === 'string') {
      return {
        id: typeof entry.id === 'string' ? entry.id : createGroupId(),
        name: readGroupName(entry),
        startUid,
        endUid,
        mode: entry.mode || DEFAULT_MODE,
      };
    }

    return {
      id: typeof entry.id === 'string' ? entry.id : createGroupId(),
      name: readGroupName(entry),
      mode: entry.mode || DEFAULT_MODE,
      unresolved: true,
      legacyStartIndex: entry.startIndex,
      legacyEndIndex: entry.endIndex,
    };
  }

  if (isUidAnchorGrouping(entry)) {
    const startUid = entry.startUid != null ? String(entry.startUid).trim() : null;
    const endUid = entry.endUid != null ? String(entry.endUid).trim() : null;
    if (startUid && endUid) {
      return {
        id: typeof entry.id === 'string' ? entry.id : createGroupId(),
        name: readGroupName(entry),
        startUid,
        endUid,
        mode: entry.mode || DEFAULT_MODE,
      };
    }

    return {
      id: typeof entry.id === 'string' ? entry.id : createGroupId(),
      name: readGroupName(entry),
      mode: entry.mode || DEFAULT_MODE,
      unresolved: true,
      legacyStartIndex: entry.legacyStartIndex,
      legacyEndIndex: entry.legacyEndIndex,
    };
  }

  return null;
}

function normalizeForWrite(entry, orderedUids) {
  if (!isPlainObject(entry)) return null;

  if (isUidAnchorGrouping(entry)) {
    const normalized = {
      id: typeof entry.id === 'string' ? entry.id : createGroupId(),
      name: readGroupName(entry),
      mode: entry.mode || DEFAULT_MODE,
    };

    if (entry.startUid != null) normalized.startUid = String(entry.startUid).trim();
    if (entry.endUid != null) normalized.endUid = String(entry.endUid).trim();

    if (entry.unresolved) normalized.unresolved = true;
    if (typeof entry.legacyStartIndex === 'number') normalized.legacyStartIndex = entry.legacyStartIndex;
    if (typeof entry.legacyEndIndex === 'number') normalized.legacyEndIndex = entry.legacyEndIndex;

    return normalized;
  }

  if (isLegacyIndexGrouping(entry)) {
    const startUid = Array.isArray(orderedUids) ? orderedUids[entry.startIndex] : null;
    const endUid = Array.isArray(orderedUids) ? orderedUids[entry.endIndex] : null;

    if (typeof startUid === 'string' && typeof endUid === 'string') {
      return {
        id: typeof entry.id === 'string' ? entry.id : createGroupId(),
        name: readGroupName(entry),
        startUid,
        endUid,
        mode: entry.mode || DEFAULT_MODE,
      };
    }

    return {
      id: typeof entry.id === 'string' ? entry.id : createGroupId(),
      name: readGroupName(entry),
      mode: entry.mode || DEFAULT_MODE,
      unresolved: true,
      legacyStartIndex: entry.startIndex,
      legacyEndIndex: entry.endIndex,
    };
  }

  return null;
}

function getWritableGroupings(rawGroupings, orderedUids) {
  return asArray(rawGroupings)
    .map((entry) => normalizeForWrite(entry, orderedUids))
    .filter(Boolean);
}

function ensureWorldbookExtensions(data) {
  if (!data || typeof data !== 'object') return null;
  if (!data.extensions || typeof data.extensions !== 'object') data.extensions = {};
  if (!data.extensions.presetTransfer || typeof data.extensions.presetTransfer !== 'object') {
    data.extensions.presetTransfer = {};
  }
  return data.extensions.presetTransfer;
}

function readRawGroupingsFromWorldbookData(data) {
  return data?.extensions?.presetTransfer?.worldbookEntryGrouping;
}

function writeRawGroupingsToWorldbookData(data, groupings) {
  const ext = ensureWorldbookExtensions(data);
  if (!ext) return false;
  ext.worldbookEntryGrouping = groupings;
  return true;
}

export async function getAllWorldbookEntryGroupings(worldbookName, orderedUids) {
  try {
    const mod = await getWorldInfoModule();
    if (typeof mod.loadWorldInfo !== 'function') {
      throw new Error('World Info module missing loadWorldInfo');
    }

    const data = await mod.loadWorldInfo(worldbookName);
    const raw = readRawGroupingsFromWorldbookData(data);
    return asArray(raw)
      .map((entry) => normalizeForRead(entry, orderedUids))
      .filter(Boolean);
  } catch (error) {
    console.error('读取世界书条目分组失败:', error);
    return [];
  }
}

export async function addWorldbookEntryGrouping(worldbookName, startUid, endUid, groupName, orderedUids) {
  try {
    const mod = await getWorldInfoModule();
    if (typeof mod.loadWorldInfo !== 'function' || typeof mod.saveWorldInfo !== 'function') {
      throw new Error('World Info module missing loadWorldInfo/saveWorldInfo');
    }

    const data = await mod.loadWorldInfo(worldbookName);
    const existing = readRawGroupingsFromWorldbookData(data);
    const groupings = getWritableGroupings(existing, orderedUids);

    groupings.push({
      id: createGroupId(),
      name: groupName || DEFAULT_GROUP_NAME,
      startUid: String(startUid ?? '').trim(),
      endUid: String(endUid ?? '').trim(),
      mode: DEFAULT_MODE,
    });

    writeRawGroupingsToWorldbookData(data, groupings);
    await mod.saveWorldInfo(worldbookName, data, true);
    return true;
  } catch (error) {
    console.error('添加世界书条目分组失败:', error);
    return false;
  }
}

export async function updateWorldbookEntryGrouping(
  worldbookName,
  groupIndex,
  startUid,
  endUid,
  groupName,
  orderedUids,
) {
  try {
    const mod = await getWorldInfoModule();
    if (typeof mod.loadWorldInfo !== 'function' || typeof mod.saveWorldInfo !== 'function') {
      throw new Error('World Info module missing loadWorldInfo/saveWorldInfo');
    }

    const data = await mod.loadWorldInfo(worldbookName);
    const existing = readRawGroupingsFromWorldbookData(data);
    const groupings = getWritableGroupings(existing, orderedUids);
    if (groupIndex < 0 || groupIndex >= groupings.length) {
      throw new Error(`Invalid group index: ${groupIndex}`);
    }

    const prev = groupings[groupIndex] || {};
    groupings[groupIndex] = {
      id: prev.id || createGroupId(),
      name: groupName || prev.name || DEFAULT_GROUP_NAME,
      startUid: startUid != null ? String(startUid).trim() : prev.startUid,
      endUid: endUid != null ? String(endUid).trim() : prev.endUid,
      mode: prev.mode || DEFAULT_MODE,
    };

    writeRawGroupingsToWorldbookData(data, groupings);
    await mod.saveWorldInfo(worldbookName, data, true);
    return true;
  } catch (error) {
    console.error('更新世界书条目分组失败:', error);
    return false;
  }
}

export async function removeWorldbookEntryGrouping(worldbookName, groupIndex, orderedUids) {
  try {
    const mod = await getWorldInfoModule();
    if (typeof mod.loadWorldInfo !== 'function' || typeof mod.saveWorldInfo !== 'function') {
      throw new Error('World Info module missing loadWorldInfo/saveWorldInfo');
    }

    const data = await mod.loadWorldInfo(worldbookName);
    const existing = readRawGroupingsFromWorldbookData(data);
    const groupings = getWritableGroupings(existing, orderedUids);
    if (groupIndex < 0 || groupIndex >= groupings.length) {
      throw new Error(`Invalid group index: ${groupIndex}`);
    }

    groupings.splice(groupIndex, 1);
    writeRawGroupingsToWorldbookData(data, groupings);
    await mod.saveWorldInfo(worldbookName, data, true);
    return true;
  } catch (error) {
    console.error('删除世界书条目分组失败:', error);
    return false;
  }
}

