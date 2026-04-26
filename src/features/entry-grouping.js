// 预设条目分组功能 - 核心逻辑

import { PT } from '../core/api-compat.js';
import { getCurrentApiInfo } from '../core/utils.js';

const DEFAULT_GROUP_NAME = '分组';
const DEFAULT_MODE = 'inclusive';
const pendingMigrationWrites = new Map();

function createGroupId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return `pt-eg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`);
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readGroupName(entry) {
  return entry?.name || entry?.groupName || DEFAULT_GROUP_NAME;
}

function computeLegacyGroupingSignature(entry) {
  if (!isPlainObject(entry)) return '';

  if (isMemberGrouping(entry)) {
    return [
      'members',
      readGroupName(entry),
      entry?.mode || DEFAULT_MODE,
      normalizeMemberIdentifiers(entry.memberIdentifiers ?? entry.memberIds ?? entry.members).join('\u001f'),
    ].join('\u001e');
  }

  if (isLegacyIndexGrouping(entry)) {
    return [
      'legacy-index',
      readGroupName(entry),
      entry?.mode || DEFAULT_MODE,
      String(entry?.startIndex ?? ''),
      String(entry?.endIndex ?? ''),
    ].join('\u001e');
  }

  if (isIdentifierAnchorGrouping(entry)) {
    return [
      'anchors',
      readGroupName(entry),
      entry?.mode || DEFAULT_MODE,
      String(entry?.startIdentifier ?? ''),
      String(entry?.endIdentifier ?? ''),
      String(entry?.legacyStartIndex ?? ''),
      String(entry?.legacyEndIndex ?? ''),
    ].join('\u001e');
  }

  const legacyStartIndex = entry?.legacyStartIndex;
  const legacyEndIndex = entry?.legacyEndIndex;
  if (typeof legacyStartIndex === 'number' || typeof legacyEndIndex === 'number') {
    return [
      'legacy-unresolved-index',
      readGroupName(entry),
      entry?.mode || DEFAULT_MODE,
      String(legacyStartIndex ?? ''),
      String(legacyEndIndex ?? ''),
      String(entry?.startIdentifier ?? ''),
      String(entry?.endIdentifier ?? ''),
    ].join('\u001e');
  }

  return [
    'fallback',
    readGroupName(entry),
    entry?.mode || DEFAULT_MODE,
    JSON.stringify(entry),
  ].join('\u001e');
}

function hashGroupingSignature(signature) {
  let hash = 0;
  const text = String(signature ?? '');
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash * 31) + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function resolveGroupingId(entry) {
  const existingId = typeof entry?.id === 'string' ? entry.id.trim() : '';
  if (existingId) return existingId;
  return `pt-eg-legacy-${hashGroupingSignature(computeLegacyGroupingSignature(entry))}`;
}

function normalizeMemberIdentifiers(list) {
  const out = [];
  const seen = new Set();
  for (const raw of asArray(list)) {
    const identifier = String(raw ?? '').trim();
    if (!identifier || seen.has(identifier)) continue;
    seen.add(identifier);
    out.push(identifier);
  }
  return out;
}

function isMemberGrouping(entry) {
  return Array.isArray(entry?.memberIdentifiers)
    || Array.isArray(entry?.memberIds)
    || Array.isArray(entry?.members);
}

function isLegacyIndexGrouping(entry) {
  return typeof entry?.startIndex === 'number' && typeof entry?.endIndex === 'number';
}

function isIdentifierAnchorGrouping(entry) {
  return typeof entry?.startIdentifier === 'string' || typeof entry?.endIdentifier === 'string';
}

function resolveMemberIdentifiersFromAnchors(startIdentifier, endIdentifier, orderedIdentifiers) {
  if (!Array.isArray(orderedIdentifiers) || orderedIdentifiers.length === 0) return null;
  if (typeof startIdentifier !== 'string' || typeof endIdentifier !== 'string') return null;

  const startIndex = orderedIdentifiers.indexOf(startIdentifier);
  const endIndex = orderedIdentifiers.indexOf(endIdentifier);
  if (startIndex === -1 || endIndex === -1) return null;

  const start = Math.min(startIndex, endIndex);
  const end = Math.max(startIndex, endIndex);
  return normalizeMemberIdentifiers(orderedIdentifiers.slice(start, end + 1));
}

function resolveGroupingMemberIdentifiers(startIdentifierOrMembers, endIdentifier, orderedIdentifiers) {
  if (Array.isArray(startIdentifierOrMembers)) {
    return normalizeMemberIdentifiers(startIdentifierOrMembers);
  }

  return resolveMemberIdentifiersFromAnchors(startIdentifierOrMembers, endIdentifier, orderedIdentifiers);
}

function normalizeForRead(entry, orderedIdentifiers) {
  if (!isPlainObject(entry)) return null;

  if (isMemberGrouping(entry)) {
    const memberIdentifiers = normalizeMemberIdentifiers(entry.memberIdentifiers ?? entry.memberIds ?? entry.members);
    if (memberIdentifiers.length === 0) return null;

    return {
      id: resolveGroupingId(entry),
      name: readGroupName(entry),
      memberIdentifiers,
      mode: entry.mode || DEFAULT_MODE,
    };
  }

  if (isLegacyIndexGrouping(entry)) {
    const startIdentifier = Array.isArray(orderedIdentifiers) ? orderedIdentifiers[entry.startIndex] : null;
    const endIdentifier = Array.isArray(orderedIdentifiers) ? orderedIdentifiers[entry.endIndex] : null;
    const memberIdentifiers = resolveMemberIdentifiersFromAnchors(startIdentifier, endIdentifier, orderedIdentifiers);
    if (memberIdentifiers && memberIdentifiers.length > 0) {
      return {
        id: resolveGroupingId(entry),
        name: readGroupName(entry),
        memberIdentifiers,
        mode: entry.mode || DEFAULT_MODE,
      };
    }

    return {
      id: resolveGroupingId(entry),
      name: readGroupName(entry),
      mode: entry.mode || DEFAULT_MODE,
      unresolved: true,
      legacyStartIndex: entry.startIndex,
      legacyEndIndex: entry.endIndex,
    };
  }

  if (isIdentifierAnchorGrouping(entry)) {
    const startIdentifier = typeof entry.startIdentifier === 'string' ? entry.startIdentifier : null;
    const endIdentifier = typeof entry.endIdentifier === 'string' ? entry.endIdentifier : null;
    const memberIdentifiers = resolveMemberIdentifiersFromAnchors(startIdentifier, endIdentifier, orderedIdentifiers);
    if (memberIdentifiers && memberIdentifiers.length > 0) {
      return {
        id: resolveGroupingId(entry),
        name: readGroupName(entry),
        memberIdentifiers,
        mode: entry.mode || DEFAULT_MODE,
      };
    }

    return {
      id: resolveGroupingId(entry),
      name: readGroupName(entry),
      mode: entry.mode || DEFAULT_MODE,
      unresolved: true,
      startIdentifier,
      endIdentifier,
      legacyStartIndex: entry.legacyStartIndex,
      legacyEndIndex: entry.legacyEndIndex,
    };
  }

  const legacyStartIndex = typeof entry?.legacyStartIndex === 'number' ? entry.legacyStartIndex : null;
  const legacyEndIndex = typeof entry?.legacyEndIndex === 'number' ? entry.legacyEndIndex : null;
  if (legacyStartIndex !== null || legacyEndIndex !== null) {
    return {
      id: resolveGroupingId(entry),
      name: readGroupName(entry),
      mode: entry.mode || DEFAULT_MODE,
      unresolved: true,
      legacyStartIndex,
      legacyEndIndex,
      startIdentifier: typeof entry?.startIdentifier === 'string' ? entry.startIdentifier : null,
      endIdentifier: typeof entry?.endIdentifier === 'string' ? entry.endIdentifier : null,
    };
  }

  return null;
}

function normalizeForWrite(entry, orderedIdentifiers) {
  if (!isPlainObject(entry)) return null;

  if (isMemberGrouping(entry)) {
    const memberIdentifiers = normalizeMemberIdentifiers(entry.memberIdentifiers ?? entry.memberIds ?? entry.members);
    if (memberIdentifiers.length === 0) return null;

    return {
      id: resolveGroupingId(entry),
      name: readGroupName(entry),
      memberIdentifiers,
      mode: entry.mode || DEFAULT_MODE,
    };
  }

  if (isLegacyIndexGrouping(entry)) {
    const startIdentifier = Array.isArray(orderedIdentifiers) ? orderedIdentifiers[entry.startIndex] : null;
    const endIdentifier = Array.isArray(orderedIdentifiers) ? orderedIdentifiers[entry.endIndex] : null;
    const memberIdentifiers = resolveMemberIdentifiersFromAnchors(startIdentifier, endIdentifier, orderedIdentifiers);

    if (memberIdentifiers && memberIdentifiers.length > 0) {
      return {
        id: resolveGroupingId(entry),
        name: readGroupName(entry),
        memberIdentifiers,
        mode: entry.mode || DEFAULT_MODE,
      };
    }

    return {
      id: resolveGroupingId(entry),
      name: readGroupName(entry),
      mode: entry.mode || DEFAULT_MODE,
      startIndex: entry.startIndex,
      endIndex: entry.endIndex,
    };
  }

  if (isIdentifierAnchorGrouping(entry)) {
    const startIdentifier = typeof entry.startIdentifier === 'string' ? entry.startIdentifier : null;
    const endIdentifier = typeof entry.endIdentifier === 'string' ? entry.endIdentifier : null;
    const memberIdentifiers = resolveMemberIdentifiersFromAnchors(startIdentifier, endIdentifier, orderedIdentifiers);

    if (memberIdentifiers && memberIdentifiers.length > 0) {
      return {
        id: resolveGroupingId(entry),
        name: readGroupName(entry),
        memberIdentifiers,
        mode: entry.mode || DEFAULT_MODE,
      };
    }

    return {
      id: resolveGroupingId(entry),
      name: readGroupName(entry),
      mode: entry.mode || DEFAULT_MODE,
      startIdentifier,
      endIdentifier,
      legacyStartIndex: entry.legacyStartIndex,
      legacyEndIndex: entry.legacyEndIndex,
    };
  }

  const legacyStartIndex = typeof entry?.legacyStartIndex === 'number' ? entry.legacyStartIndex : null;
  const legacyEndIndex = typeof entry?.legacyEndIndex === 'number' ? entry.legacyEndIndex : null;
  const startIdentifier = typeof entry?.startIdentifier === 'string' ? entry.startIdentifier : null;
  const endIdentifier = typeof entry?.endIdentifier === 'string' ? entry.endIdentifier : null;
  if (legacyStartIndex !== null || legacyEndIndex !== null || startIdentifier || endIdentifier) {
    return {
      id: resolveGroupingId(entry),
      name: readGroupName(entry),
      mode: entry.mode || DEFAULT_MODE,
      ...(startIdentifier ? { startIdentifier } : {}),
      ...(endIdentifier ? { endIdentifier } : {}),
      ...(legacyStartIndex !== null && !startIdentifier && !endIdentifier ? { startIndex: legacyStartIndex } : {}),
      ...(legacyEndIndex !== null && !startIdentifier && !endIdentifier ? { endIndex: legacyEndIndex } : {}),
      ...(legacyStartIndex !== null && (startIdentifier || endIdentifier) ? { legacyStartIndex } : {}),
      ...(legacyEndIndex !== null && (startIdentifier || endIdentifier) ? { legacyEndIndex } : {}),
    };
  }

  return null;
}

function getWritableGroupings(rawGroupings, orderedIdentifiers) {
  return asArray(rawGroupings)
    .map((entry) => normalizeForWrite(entry, orderedIdentifiers))
    .filter(Boolean);
}

function syncEntryGroupingToActiveSettings(apiInfo, presetName, groupings) {
  try {
    const presetManager = apiInfo?.presetManager;
    if (!presetManager) return;

    const selectedPresetName = presetManager.getSelectedPresetName?.();
    if (!selectedPresetName || selectedPresetName !== presetName) return;

    const settings = presetManager.getPresetList?.()?.settings;
    if (!isPlainObject(settings)) return;

    if (!isPlainObject(settings.extensions)) settings.extensions = {};
    settings.extensions.entryGrouping = groupings;
  } catch (error) {
    console.warn('同步当前预设分组扩展数据失败:', error);
  }
}

function queuePersistPresetGroupingMigration(presetName, groupings) {
  const name = String(presetName ?? '').trim();
  if (!name || !Array.isArray(groupings) || groupings.length === 0) return;

  const signature = `${name}\u001f${JSON.stringify(groupings)}`;
  if (pendingMigrationWrites.get(name) === signature) return;
  pendingMigrationWrites.set(name, signature);

  Promise.resolve().then(async () => {
    if (pendingMigrationWrites.get(name) !== signature) return;

    try {
      const apiInfo = getCurrentApiInfo?.();
      if (apiInfo?.presetManager) {
        const presetObj = apiInfo.presetManager.getCompletionPresetByName(name);
        if (presetObj) {
          if (!presetObj.extensions) presetObj.extensions = {};
          presetObj.extensions.entryGrouping = groupings;
          syncEntryGroupingToActiveSettings(apiInfo, name, groupings);

          const cachedPreset = PT.API.getPreset(name);
          if (cachedPreset) {
            if (!cachedPreset.extensions) cachedPreset.extensions = {};
            cachedPreset.extensions.entryGrouping = groupings;
          }

          await apiInfo.presetManager.savePreset(name, presetObj, { skipUpdate: true });
          return;
        }
      }

      const preset = PT.API.getPreset(name);
      if (!preset) return;
      if (!preset.extensions) preset.extensions = {};
      preset.extensions.entryGrouping = groupings;
      await PT.API.replacePreset(name, preset);
    } catch (error) {
      console.warn(`持久化预设 "${name}" 的分组迁移失败:`, error);
    } finally {
      if (pendingMigrationWrites.get(name) === signature) {
        pendingMigrationWrites.delete(name);
      }
    }
  });
}

// 获取预设的所有分组配置。旧的 start/end 锚点方案会在内存中转换成显式成员列表，
// 这样后续调整条目顺序时不再受创建分组时的起止锚点限制。
function orderMemberIdentifiers(memberIdentifiers, orderedIdentifiers) {
  const normalizedMembers = normalizeMemberIdentifiers(memberIdentifiers);
  if (normalizedMembers.length === 0) return [];

  const normalizedOrder = normalizeMemberIdentifiers(orderedIdentifiers);
  if (normalizedOrder.length === 0) return normalizedMembers;

  const orderedSet = new Set(normalizedOrder);
  const memberSet = new Set(normalizedMembers);
  const ordered = normalizedOrder.filter((identifier) => memberSet.has(identifier));
  const missing = normalizedMembers.filter((identifier) => !orderedSet.has(identifier));
  return [...ordered, ...missing];
}

async function persistPresetGroupings(presetName, groupings) {
  const name = String(presetName ?? '').trim();
  if (!name) return false;

  const normalizedGroupings = getWritableGroupings(groupings, []);
  const apiInfo = getCurrentApiInfo?.();

  if (apiInfo?.presetManager) {
    const presetObj = apiInfo.presetManager.getCompletionPresetByName(name);
    if (!presetObj) throw new Error(`Preset "${name}" not found`);

    if (!presetObj.extensions) presetObj.extensions = {};
    presetObj.extensions.entryGrouping = normalizedGroupings;
    syncEntryGroupingToActiveSettings(apiInfo, name, normalizedGroupings);

    const cachedPreset = PT.API.getPreset(name);
    if (cachedPreset) {
      if (!cachedPreset.extensions) cachedPreset.extensions = {};
      cachedPreset.extensions.entryGrouping = normalizedGroupings;
    }

    await apiInfo.presetManager.savePreset(name, presetObj, { skipUpdate: true });
    return true;
  }

  const preset = PT.API.getPreset(name);
  if (!preset) throw new Error(`Preset "${name}" not found`);
  if (!preset.extensions) preset.extensions = {};
  preset.extensions.entryGrouping = normalizedGroupings;

  await PT.API.replacePreset(name, preset);
  return true;
}

async function reassignPresetGroupingMembers(presetName, entryIdentifiers, orderedIdentifiers, options = {}) {
  try {
    const name = String(presetName ?? '').trim();
    const movedIdentifiers = normalizeMemberIdentifiers(entryIdentifiers);
    if (!name || movedIdentifiers.length === 0) return false;

    const targetIdentifier = String(options?.targetIdentifier ?? '').trim();
    const requestedGroupId = String(options?.targetGroupId ?? '').trim();
    const groupings = getWritableGroupings(getAllPresetGroupings(name, orderedIdentifiers), orderedIdentifiers);
    if (groupings.length === 0) return false;

    const requestedGroupExists = requestedGroupId
      ? groupings.some((grouping) => String(grouping?.id ?? '').trim() === requestedGroupId)
      : false;
    const fallbackGroupId = targetIdentifier
      ? String(
        groupings.find((grouping) => normalizeMemberIdentifiers(grouping?.memberIdentifiers).includes(targetIdentifier))?.id ?? '',
      ).trim()
      : '';
    const targetGroupId = requestedGroupExists ? requestedGroupId : fallbackGroupId;

    let changed = false;
    const nextGroupings = [];

    for (const grouping of groupings) {
      const beforeMembers = normalizeMemberIdentifiers(grouping?.memberIdentifiers);
      const memberSet = new Set(beforeMembers);

      for (const identifier of movedIdentifiers) {
        memberSet.delete(identifier);
      }

      if (targetGroupId && String(grouping?.id ?? '').trim() === targetGroupId) {
        for (const identifier of movedIdentifiers) {
          memberSet.add(identifier);
        }
      }

      const nextMembers = orderMemberIdentifiers(Array.from(memberSet), orderedIdentifiers);
      if (nextMembers.length === 0) {
        if (beforeMembers.length > 0) changed = true;
        continue;
      }

      if (!changed && nextMembers.join('\u001f') !== beforeMembers.join('\u001f')) {
        changed = true;
      }

      nextGroupings.push({
        ...grouping,
        memberIdentifiers: nextMembers,
      });
    }

    if (!changed) return false;
    await persistPresetGroupings(name, nextGroupings);
    return true;
  } catch (error) {
    console.error('重新分配预设分组成员失败:', error);
    return false;
  }
}

function getPresetGroupingIdForIdentifier(presetName, entryIdentifier, orderedIdentifiers) {
  try {
    const name = String(presetName ?? '').trim();
    const identifier = String(entryIdentifier ?? '').trim();
    if (!name || !identifier) return null;

    const groupings = getAllPresetGroupings(name, orderedIdentifiers);
    const targetGrouping = groupings.find(
      (grouping) => !grouping?.unresolved && normalizeMemberIdentifiers(grouping?.memberIdentifiers).includes(identifier),
    );
    const groupId = String(targetGrouping?.id ?? '').trim();
    return groupId || null;
  } catch (error) {
    console.warn(`获取预设 "${presetName}" 条目 "${entryIdentifier}" 的分组失败:`, error);
    return null;
  }
}

function getAllPresetGroupings(presetName, orderedIdentifiers) {
  try {
    const preset = PT.API.getPreset(presetName);
    if (!preset || !preset.extensions) return [];

    const grouping = preset.extensions.entryGrouping;
    if (!grouping) return [];

    const rawGroupings = asArray(grouping);
    const normalized = rawGroupings
      .map((entry) => normalizeForRead(entry, orderedIdentifiers))
      .filter(Boolean);

    const writableGroupings = getWritableGroupings(rawGroupings, orderedIdentifiers);
    const rawSignature = stableSerialize(rawGroupings);
    const writableSignature = stableSerialize(writableGroupings);
    const shouldMigrate =
      writableGroupings.length === normalized.length
      && rawSignature !== writableSignature;

    if (shouldMigrate) {
      preset.extensions.entryGrouping = writableGroupings;
      queuePersistPresetGroupingMigration(presetName, writableGroupings);
    }

    return normalized;
  } catch (error) {
    console.warn(`获取预设 "${presetName}" 的分组配置失败:`, error);
    return [];
  }
}

// 添加新分组。写入时优先存为显式成员标识列表。
async function addPresetGrouping(presetName, startIdentifierOrMembers, endIdentifier, groupName, orderedIdentifiers) {
  try {
    const memberIdentifiers = resolveGroupingMemberIdentifiers(startIdentifierOrMembers, endIdentifier, orderedIdentifiers);
    if (!Array.isArray(memberIdentifiers) || memberIdentifiers.length === 0) {
      throw new Error('Invalid grouping members');
    }

    const apiInfo = getCurrentApiInfo?.();
    if (apiInfo && apiInfo.presetManager) {
      const presetObj = apiInfo.presetManager.getCompletionPresetByName(presetName);
      if (!presetObj) throw new Error(`Preset "${presetName}" not found`);

      if (!presetObj.extensions) presetObj.extensions = {};

      const groupings = getWritableGroupings(presetObj.extensions.entryGrouping, orderedIdentifiers);
      groupings.push({
        id: createGroupId(),
        name: groupName || DEFAULT_GROUP_NAME,
        memberIdentifiers,
        mode: DEFAULT_MODE,
      });
      presetObj.extensions.entryGrouping = groupings;

      syncEntryGroupingToActiveSettings(apiInfo, presetName, groupings);

      const cachedPreset = PT.API.getPreset(presetName);
      if (cachedPreset) {
        if (!cachedPreset.extensions) cachedPreset.extensions = {};
        cachedPreset.extensions.entryGrouping = groupings;
      }

      await apiInfo.presetManager.savePreset(presetName, presetObj, { skipUpdate: true });
      return true;
    }

    const preset = PT.API.getPreset(presetName);
    if (!preset) throw new Error(`Preset "${presetName}" not found`);
    if (!preset.extensions) preset.extensions = {};

    const groupings = getWritableGroupings(preset.extensions.entryGrouping, orderedIdentifiers);
    groupings.push({
      id: createGroupId(),
      name: groupName || DEFAULT_GROUP_NAME,
      memberIdentifiers,
      mode: DEFAULT_MODE,
    });
    preset.extensions.entryGrouping = groupings;

    await PT.API.replacePreset(presetName, preset);
    return true;
  } catch (error) {
    console.error('添加分组配置失败:', error);
    return false;
  }
}

// 更新指定分组。未传新成员时保持当前成员列表不变，仅更新名称。
async function updatePresetGrouping(presetName, groupIndex, startIdentifierOrMembers, endIdentifier, groupName, orderedIdentifiers) {
  try {
    const apiInfo = getCurrentApiInfo?.();
    if (apiInfo && apiInfo.presetManager) {
      const presetObj = apiInfo.presetManager.getCompletionPresetByName(presetName);
      if (!presetObj) throw new Error(`Preset "${presetName}" not found`);
      if (!presetObj.extensions) presetObj.extensions = {};

      const groupings = getWritableGroupings(presetObj.extensions.entryGrouping, orderedIdentifiers);
      if (groupIndex < 0 || groupIndex >= groupings.length) {
        throw new Error(`Invalid group index: ${groupIndex}`);
      }

      const existing = groupings[groupIndex] || {};
      const memberIdentifiers = resolveGroupingMemberIdentifiers(startIdentifierOrMembers, endIdentifier, orderedIdentifiers);
      groupings[groupIndex] = {
        id: existing.id || createGroupId(),
        name: groupName || existing.name || DEFAULT_GROUP_NAME,
        memberIdentifiers:
          Array.isArray(memberIdentifiers) && memberIdentifiers.length > 0
            ? memberIdentifiers
            : normalizeMemberIdentifiers(existing.memberIdentifiers),
        mode: existing.mode || DEFAULT_MODE,
      };

      presetObj.extensions.entryGrouping = groupings;

      syncEntryGroupingToActiveSettings(apiInfo, presetName, groupings);

      const cachedPreset = PT.API.getPreset(presetName);
      if (cachedPreset) {
        if (!cachedPreset.extensions) cachedPreset.extensions = {};
        cachedPreset.extensions.entryGrouping = groupings;
      }

      await apiInfo.presetManager.savePreset(presetName, presetObj, { skipUpdate: true });
      return true;
    }

    const preset = PT.API.getPreset(presetName);
    if (!preset) throw new Error(`Preset "${presetName}" not found`);
    if (!preset.extensions) preset.extensions = {};

    const groupings = getWritableGroupings(preset.extensions.entryGrouping, orderedIdentifiers);
    if (groupIndex < 0 || groupIndex >= groupings.length) {
      throw new Error(`Invalid group index: ${groupIndex}`);
    }

    const existing = groupings[groupIndex] || {};
    const memberIdentifiers = resolveGroupingMemberIdentifiers(startIdentifierOrMembers, endIdentifier, orderedIdentifiers);
    groupings[groupIndex] = {
      id: existing.id || createGroupId(),
      name: groupName || existing.name || DEFAULT_GROUP_NAME,
      memberIdentifiers:
        Array.isArray(memberIdentifiers) && memberIdentifiers.length > 0
          ? memberIdentifiers
          : normalizeMemberIdentifiers(existing.memberIdentifiers),
      mode: existing.mode || DEFAULT_MODE,
    };

    preset.extensions.entryGrouping = groupings;
    await PT.API.replacePreset(presetName, preset);
    return true;
  } catch (error) {
    console.error('更新分组配置失败:', error);
    return false;
  }
}

// 删除指定分组
async function removePresetGrouping(presetName, groupIndex, orderedIdentifiers) {
  try {
    const apiInfo = getCurrentApiInfo?.();
    if (apiInfo && apiInfo.presetManager) {
      const presetObj = apiInfo.presetManager.getCompletionPresetByName(presetName);
      if (!presetObj) throw new Error(`Preset "${presetName}" not found`);
      if (!presetObj.extensions) presetObj.extensions = {};

      const groupings = getWritableGroupings(presetObj.extensions.entryGrouping, orderedIdentifiers);
      if (groupIndex < 0 || groupIndex >= groupings.length) {
        throw new Error(`Invalid group index: ${groupIndex}`);
      }

      groupings.splice(groupIndex, 1);
      presetObj.extensions.entryGrouping = groupings;

      syncEntryGroupingToActiveSettings(apiInfo, presetName, groupings);

      const cachedPreset = PT.API.getPreset(presetName);
      if (cachedPreset) {
        if (!cachedPreset.extensions) cachedPreset.extensions = {};
        cachedPreset.extensions.entryGrouping = groupings;
      }

      await apiInfo.presetManager.savePreset(presetName, presetObj, { skipUpdate: true });
      return true;
    }

    const preset = PT.API.getPreset(presetName);
    if (!preset) throw new Error(`Preset "${presetName}" not found`);
    if (!preset.extensions) preset.extensions = {};

    const groupings = getWritableGroupings(preset.extensions.entryGrouping, orderedIdentifiers);
    if (groupIndex < 0 || groupIndex >= groupings.length) {
      throw new Error(`Invalid group index: ${groupIndex}`);
    }

    groupings.splice(groupIndex, 1);
    preset.extensions.entryGrouping = groupings;

    await PT.API.replacePreset(presetName, preset);
    return true;
  } catch (error) {
    console.error('删除分组配置失败:', error);
    return false;
  }
}

export {
  getAllPresetGroupings,
  getPresetGroupingIdForIdentifier,
  addPresetGrouping,
  updatePresetGrouping,
  removePresetGrouping,
  reassignPresetGroupingMembers,
};
