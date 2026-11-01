/**
 * preset-data-pure.js
 * 纯函数核心层：预设数据的迁移、覆盖、插入、删除与排序计算
 * 无 DOM 依赖、无全局状态依赖、无弹窗/网络调用副作用，可直接进行脱机自动化单元测试。
 */

import { NEW_FIELD_DEFAULTS } from './constants.js';
import { ensureUniqueIdentifier, generateUUID } from './utils.js';
import { batchTransferWithNewFields, ensureNewVersionFields } from '../preset/new-version-fields.js';
import { ensureStitchMeta } from '../preset/stitch-meta.js';

export const DUMMY_CHARACTER_ID = 100001;

export const DEFAULT_PROMPT_ORDER = [
  { identifier: 'main', enabled: true },
  { identifier: 'worldInfoBefore', enabled: true },
  { identifier: 'personaDescription', enabled: true },
  { identifier: 'charDescription', enabled: true },
  { identifier: 'charPersonality', enabled: true },
  { identifier: 'scenario', enabled: true },
  { identifier: 'enhanceDefinitions', enabled: false },
  { identifier: 'nsfw', enabled: true },
  { identifier: 'worldInfoAfter', enabled: true },
  { identifier: 'dialogueExamples', enabled: true },
  { identifier: 'chatHistory', enabled: true },
  { identifier: 'jailbreak', enabled: true },
];

/**
 * 获取或创建虚拟角色的 prompt_order 对象
 * @param {Object} presetData 预设数据对象
 * @returns {Object} characterPromptOrder
 */
export function getOrCreateDummyCharacterPromptOrder(presetData) {
  if (!presetData || typeof presetData !== 'object') {
    throw new Error('presetData 必须为对象');
  }
  if (!Array.isArray(presetData.prompt_order)) {
    presetData.prompt_order = [];
  }
  let characterPromptOrder = presetData.prompt_order.find(
    order => order && order.character_id === DUMMY_CHARACTER_ID,
  );
  if (!characterPromptOrder) {
    characterPromptOrder = {
      character_id: DUMMY_CHARACTER_ID,
      order: DEFAULT_PROMPT_ORDER.map(item => ({ ...item })),
    };
    presetData.prompt_order.push(characterPromptOrder);
  }
  if (!Array.isArray(characterPromptOrder.order)) {
    characterPromptOrder.order = [];
  }
  return characterPromptOrder;
}

/**
 * 在目标预设中覆盖同名条目的数据（保留原 identifier）
 * @param {Object} targetPresetData 目标预设数据
 * @param {string} entryName 条目名称
 * @param {Object} sourceEntryData 源条目数据
 * @returns {{ targetData: Object, updatedPrompt: Object }}
 */
export function applyCopyEntryToPreset(targetPresetData, entryName, sourceEntryData) {
  if (!targetPresetData || !Array.isArray(targetPresetData.prompts)) {
    throw new Error('目标预设数据无效或缺少 prompts 数组');
  }

  const targetPromptIndex = targetPresetData.prompts.findIndex(
    p => p && p.name === entryName && !p.system_prompt && !p.marker,
  );

  if (targetPromptIndex === -1) {
    throw new Error(`在预设中未找到目标条目 "${entryName}"`);
  }

  const originalIdentifier = targetPresetData.prompts[targetPromptIndex].identifier;
  const newPromptData = ensureNewVersionFields(sourceEntryData);

  targetPresetData.prompts[targetPromptIndex] = {
    ...newPromptData,
    identifier: originalIdentifier,
  };

  return {
    targetData: targetPresetData,
    updatedPrompt: targetPresetData.prompts[targetPromptIndex],
  };
}

/**
 * 单条新条目插入预设
 * @param {Object} targetData 目标预设数据
 * @param {Object} newEntry 新条目数据
 * @param {string|null} insertPosition 插入位置 ('top', 'bottom', 'after-N')
 * @param {boolean} autoEnable 是否自动启用
 * @param {Object} options 选项（如 referencePromptList, targetIdentifier）
 * @returns {{ targetData: Object, stitchedPrompt: Object, newOrderEntry: Object, resolvedTargetIdentifier: string|null }}
 */
export function applyInsertEntryToPreset(targetData, newEntry, insertPosition, autoEnable, options = {}) {
  if (!targetData) throw new Error('无法获取目标预设数据');
  if (!Array.isArray(targetData.prompts)) targetData.prompts = [];

  const characterPromptOrder = getOrCreateDummyCharacterPromptOrder(targetData);

  const newPrompt = {
    ...newEntry,
    identifier: ensureUniqueIdentifier(targetData, newEntry.identifier || generateUUID()),
    injection_order: newEntry.injection_order ?? NEW_FIELD_DEFAULTS.injection_order,
    injection_trigger: Array.isArray(newEntry.injection_trigger)
      ? [...newEntry.injection_trigger]
      : [...NEW_FIELD_DEFAULTS.injection_trigger],
    forbid_overrides: Boolean(newEntry.forbid_overrides),
    system_prompt: Boolean(newEntry.system_prompt),
    marker: Boolean(newEntry.marker),
  };
  delete newPrompt.isNewEntry;

  const stitchedPrompt = ensureStitchMeta(newPrompt);
  targetData.prompts.push(stitchedPrompt);

  const newOrderEntry = { identifier: stitchedPrompt.identifier, enabled: Boolean(autoEnable) };
  let resolvedTargetIdentifier = String(options?.targetIdentifier ?? '').trim() || null;
  const referencePromptList = Array.isArray(options?.referencePromptList) ? options.referencePromptList : null;

  if (insertPosition === 'top') {
    characterPromptOrder.order.unshift(newOrderEntry);
  } else if (typeof insertPosition === 'string' && insertPosition.startsWith('after-')) {
    const afterIndex = parseInt(insertPosition.replace('after-', ''), 10);
    if (referencePromptList && afterIndex >= 0 && afterIndex < referencePromptList.length) {
      const targetPrompt = referencePromptList[afterIndex];
      resolvedTargetIdentifier = String(targetPrompt?.identifier ?? '').trim() || null;
      const orderIndex = characterPromptOrder.order.findIndex(e => e.identifier === targetPrompt.identifier);
      if (orderIndex !== -1) {
        characterPromptOrder.order.splice(orderIndex + 1, 0, newOrderEntry);
      } else {
        characterPromptOrder.order.push(newOrderEntry);
      }
    } else {
      characterPromptOrder.order.push(newOrderEntry);
    }
  } else {
    characterPromptOrder.order.push(newOrderEntry);
  }

  return {
    targetData,
    stitchedPrompt,
    newOrderEntry,
    resolvedTargetIdentifier,
  };
}

/**
 * 批量迁移条目到预设
 * @param {Object} targetData 目标预设数据
 * @param {Array} selectedEntries 选中的待迁移条目数组
 * @param {string|null} insertPosition 插入位置 ('top', 'bottom', 'after-N')
 * @param {boolean} autoEnable 是否自动启用
 * @param {Object} options 选项（如 referencePromptList, targetIdentifier, targetGroupId, selectedGroups）
 * @returns {{ targetData: Object, insertedOrderEntries: Array, transferredIdentifierMap: Map, resolvedTargetIdentifier: string|null }}
 */
export function applyTransferEntriesToPreset(targetData, selectedEntries, insertPosition, autoEnable, options = {}) {
  if (!targetData) throw new Error('无法获取目标预设数据');
  if (!Array.isArray(targetData.prompts)) targetData.prompts = [];

  const characterPromptOrder = getOrCreateDummyCharacterPromptOrder(targetData);
  const targetPromptMap = new Map(targetData.prompts.map((p, i) => [p.name, i]));
  const insertedOrderEntries = [];
  const transferredIdentifierMap = new Map();
  let resolvedTargetIdentifier = String(options?.targetIdentifier ?? '').trim() || null;
  const referencePromptList = Array.isArray(options?.referencePromptList) ? options.referencePromptList : null;

  const entriesToTransfer = batchTransferWithNewFields(selectedEntries);

  entriesToTransfer.forEach((entry, index) => {
    const sourceIdentifier = String(selectedEntries?.[index]?.identifier ?? entry?.identifier ?? '').trim();

    if (targetPromptMap.has(entry.name)) {
      const targetIndex = targetPromptMap.get(entry.name);
      const existingIdentifier = targetData.prompts[targetIndex].identifier;
      targetData.prompts[targetIndex] = {
        ...targetData.prompts[targetIndex],
        ...entry,
        identifier: existingIdentifier,
        injection_order: entry.injection_order ?? NEW_FIELD_DEFAULTS.injection_order,
        injection_trigger: Array.isArray(entry.injection_trigger)
          ? [...entry.injection_trigger]
          : [...NEW_FIELD_DEFAULTS.injection_trigger],
      };

      const existingOrderEntry = characterPromptOrder.order.find(o => o.identifier === existingIdentifier);
      if (!existingOrderEntry) {
        insertedOrderEntries.push({ identifier: existingIdentifier, enabled: Boolean(autoEnable) });
      }

      if (sourceIdentifier) {
        transferredIdentifierMap.set(sourceIdentifier, existingIdentifier);
      }
    } else {
      const newPrompt = {
        ...entry,
        identifier: ensureUniqueIdentifier(targetData, entry.identifier || generateUUID()),
        injection_order: entry.injection_order ?? NEW_FIELD_DEFAULTS.injection_order,
        injection_trigger: Array.isArray(entry.injection_trigger)
          ? [...entry.injection_trigger]
          : [...NEW_FIELD_DEFAULTS.injection_trigger],
      };
      const stitchedPrompt = ensureStitchMeta(newPrompt);
      targetData.prompts.push(stitchedPrompt);
      insertedOrderEntries.push({ identifier: stitchedPrompt.identifier, enabled: Boolean(autoEnable) });
      if (sourceIdentifier) {
        transferredIdentifierMap.set(sourceIdentifier, stitchedPrompt.identifier);
      }
    }
  });

  if (insertedOrderEntries.length > 0) {
    if (insertPosition === 'top') {
      characterPromptOrder.order.unshift(...insertedOrderEntries);
    } else if (typeof insertPosition === 'string' && insertPosition.startsWith('after-')) {
      const afterIndex = parseInt(insertPosition.replace('after-', ''), 10);
      if (referencePromptList && afterIndex >= 0 && afterIndex < referencePromptList.length) {
        const targetPrompt = referencePromptList[afterIndex];
        resolvedTargetIdentifier = String(targetPrompt?.identifier ?? '').trim() || null;
        const orderIndex = characterPromptOrder.order.findIndex(e => e.identifier === targetPrompt.identifier);
        if (orderIndex !== -1) {
          characterPromptOrder.order.splice(orderIndex + 1, 0, ...insertedOrderEntries);
        } else {
          characterPromptOrder.order.push(...insertedOrderEntries);
        }
      } else {
        characterPromptOrder.order.push(...insertedOrderEntries);
      }
    } else {
      characterPromptOrder.order.push(...insertedOrderEntries);
    }
  }

  return {
    targetData,
    insertedOrderEntries,
    transferredIdentifierMap,
    resolvedTargetIdentifier,
  };
}

/**
 * 从预设中删除条目
 * @param {Object} presetData 预设数据
 * @param {Array} selectedEntries 待删除的条目数组
 * @returns {{ presetData: Object, deletedCount: number }}
 */
export function applyDeleteEntriesFromPreset(presetData, selectedEntries) {
  if (!presetData) throw new Error('无法获取源预设数据');
  if (!Array.isArray(presetData.prompts)) presetData.prompts = [];
  if (!Array.isArray(presetData.prompt_order)) presetData.prompt_order = [];

  const dummyCharacterId = DUMMY_CHARACTER_ID;
  let characterPromptOrder = presetData.prompt_order.find(order => order.character_id === dummyCharacterId);
  if (!characterPromptOrder) {
    characterPromptOrder = { character_id: dummyCharacterId, order: [] };
    presetData.prompt_order.push(characterPromptOrder);
  }

  const namesToDelete = new Set(selectedEntries.map(entry => entry.name).filter(Boolean));
  const identifiersToDelete = new Set(selectedEntries.map(entry => entry.identifier).filter(Boolean));

  const prevCount = presetData.prompts.length;
  presetData.prompts = presetData.prompts.filter(p => !(p && p.name && namesToDelete.has(p.name)));
  const deletedCount = prevCount - presetData.prompts.length;

  characterPromptOrder.order = characterPromptOrder.order.filter(o => !identifiersToDelete.has(o.identifier));

  return {
    presetData,
    deletedCount,
  };
}

/**
 * 批量更新预设中的条目数据（基于条目原生唯一 identifier 进行精准更新并保留其他所有版本字段）
 * @param {Object} presetData - 预设数据对象
 * @param {Array<Object>} modifiedEntries - 已修改的条目列表
 * @returns {{ presetData: Object, updatedCount: number }} 更新后的预设数据与更新数量
 */
export function applyUpdateEntriesInPreset(presetData, modifiedEntries) {
  if (!presetData || !Array.isArray(presetData.prompts)) {
    throw new Error('预设数据无效或缺少 prompts 数组');
  }
  if (!Array.isArray(modifiedEntries) || modifiedEntries.length === 0) {
    return { presetData, updatedCount: 0 };
  }

  let updatedCount = 0;
  modifiedEntries.forEach(modifiedEntry => {
    if (!modifiedEntry || !modifiedEntry.identifier) return;
    const index = presetData.prompts.findIndex(p => p && p.identifier === modifiedEntry.identifier);
    if (index >= 0) {
      presetData.prompts[index] = {
        ...presetData.prompts[index],
        ...modifiedEntry,
      };
      updatedCount++;
    }
  });

  return { presetData, updatedCount };
}

