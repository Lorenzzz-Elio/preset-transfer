// 预设条目分组功能 - 核心逻辑

import { PT } from '../core/api-compat.js';
import { getCurrentApiInfo } from '../core/utils.js';

const DEFAULT_GROUP_NAME = '分组';
const DEFAULT_MODE = 'inclusive';

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

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readGroupName(entry) {
  return entry?.name || entry?.groupName || DEFAULT_GROUP_NAME;
}

function isLegacyIndexGrouping(entry) {
  return typeof entry?.startIndex === 'number' && typeof entry?.endIndex === 'number';
}

function isIdentifierAnchorGrouping(entry) {
  return typeof entry?.startIdentifier === 'string' || typeof entry?.endIdentifier === 'string';
}

function normalizeForRead(entry, orderedIdentifiers) {
  if (!isPlainObject(entry)) return null;

  if (isLegacyIndexGrouping(entry)) {
    const startIdentifier = Array.isArray(orderedIdentifiers) ? orderedIdentifiers[entry.startIndex] : null;
    const endIdentifier = Array.isArray(orderedIdentifiers) ? orderedIdentifiers[entry.endIndex] : null;
    if (typeof startIdentifier === 'string' && typeof endIdentifier === 'string') {
      return {
        id: typeof entry.id === 'string' ? entry.id : createGroupId(),
        name: readGroupName(entry),
        startIdentifier,
        endIdentifier,
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

  if (isIdentifierAnchorGrouping(entry)) {
    const startIdentifier = typeof entry.startIdentifier === 'string' ? entry.startIdentifier : null;
    const endIdentifier = typeof entry.endIdentifier === 'string' ? entry.endIdentifier : null;
    if (startIdentifier && endIdentifier) {
      return {
        id: typeof entry.id === 'string' ? entry.id : createGroupId(),
        name: readGroupName(entry),
        startIdentifier,
        endIdentifier,
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

function normalizeForWrite(entry, orderedIdentifiers) {
  if (!isPlainObject(entry)) return null;

  // Already v2-ish format: normalize keys and fill id/name.
  if (isIdentifierAnchorGrouping(entry)) {
    const normalized = {
      id: typeof entry.id === 'string' ? entry.id : createGroupId(),
      name: readGroupName(entry),
      mode: entry.mode || DEFAULT_MODE,
    };

    if (typeof entry.startIdentifier === 'string') normalized.startIdentifier = entry.startIdentifier;
    if (typeof entry.endIdentifier === 'string') normalized.endIdentifier = entry.endIdentifier;

    if (entry.unresolved) normalized.unresolved = true;
    if (typeof entry.legacyStartIndex === 'number') normalized.legacyStartIndex = entry.legacyStartIndex;
    if (typeof entry.legacyEndIndex === 'number') normalized.legacyEndIndex = entry.legacyEndIndex;

    return normalized;
  }

  // Legacy index-range -> identifier anchors (best-effort).
  if (isLegacyIndexGrouping(entry)) {
    const startIdentifier = Array.isArray(orderedIdentifiers) ? orderedIdentifiers[entry.startIndex] : null;
    const endIdentifier = Array.isArray(orderedIdentifiers) ? orderedIdentifiers[entry.endIndex] : null;

    if (typeof startIdentifier === 'string' && typeof endIdentifier === 'string') {
      return {
        id: typeof entry.id === 'string' ? entry.id : createGroupId(),
        name: readGroupName(entry),
        startIdentifier,
        endIdentifier,
        mode: entry.mode || DEFAULT_MODE,
      };
    }

    // Keep as unresolved (v2 placeholder) to avoid writing index-range entries back.
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

// 获取预设的所有分组配置（会在内存中兼容/转换旧格式；写入时只写 v2 标识符格式）
function getAllPresetGroupings(presetName, orderedIdentifiers) {
  try {
    const preset = PT.API.getPreset(presetName);
    if (!preset || !preset.extensions) return [];

    const grouping = preset.extensions.entryGrouping;
    if (!grouping) return [];

    return asArray(grouping)
      .map((entry) => normalizeForRead(entry, orderedIdentifiers))
      .filter(Boolean);
  } catch (error) {
    console.warn(`获取预设 "${presetName}" 的分组配置失败`, error);
    return [];
  }
}

// 添加新分组（startIdentifier/endIdentifier 为 li[data-pm-identifier] 的稳定标识）
async function addPresetGrouping(presetName, startIdentifier, endIdentifier, groupName, orderedIdentifiers) {
  try {
    if (typeof startIdentifier !== 'string' || typeof endIdentifier !== 'string') {
      throw new Error('Invalid identifier anchors');
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
        startIdentifier,
        endIdentifier,
        mode: DEFAULT_MODE,
      });
      presetObj.extensions.entryGrouping = groupings;

      // Keep current active settings (e.g. oai_settings) in sync so that
      // SillyTavern's "Update current preset" won't overwrite the new grouping.
      syncEntryGroupingToActiveSettings(apiInfo, presetName, groupings);

      // Update cache first to prevent flash
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
      startIdentifier,
      endIdentifier,
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

// 更新指定分组
async function updatePresetGrouping(presetName, groupIndex, startIdentifier, endIdentifier, groupName, orderedIdentifiers) {
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
      groupings[groupIndex] = {
        id: existing.id || createGroupId(),
        name: groupName || existing.name || DEFAULT_GROUP_NAME,
        startIdentifier: typeof startIdentifier === 'string' ? startIdentifier : existing.startIdentifier,
        endIdentifier: typeof endIdentifier === 'string' ? endIdentifier : existing.endIdentifier,
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
    groupings[groupIndex] = {
      id: existing.id || createGroupId(),
      name: groupName || existing.name || DEFAULT_GROUP_NAME,
      startIdentifier: typeof startIdentifier === 'string' ? startIdentifier : existing.startIdentifier,
      endIdentifier: typeof endIdentifier === 'string' ? endIdentifier : existing.endIdentifier,
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
  addPresetGrouping,
  updatePresetGrouping,
  removePresetGrouping,
};
