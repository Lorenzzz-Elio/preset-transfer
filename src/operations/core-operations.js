import { ensureUniqueIdentifier } from '../core/utils.js';
import { NEW_FIELD_DEFAULTS } from '../core/constants.js';
import { getPresetDataFromManager } from '../preset/preset-manager.js';
import { batchTransferWithNewFields } from '../preset/new-version-fields.js';
import { getTargetPromptsList, getOrCreateDummyCharacterPromptOrder } from '../ui/edit-modal.js';
async function performInsertNewEntry(
  apiInfo,
  targetPreset,
  newEntry,
  insertPosition,
  autoEnable,
  displayMode = 'default',
) {
  const targetData = getPresetDataFromManager(apiInfo, targetPreset);
  if (!targetData) throw new Error('无法获取目标预设数据');

  if (!targetData.prompts) targetData.prompts = [];
  const characterPromptOrder = getOrCreateDummyCharacterPromptOrder(targetData);

  // The newEntry object from the modal already has all the correct fields.
  // We just need to assign a new identifier and clean up the temporary flag.
  const newPrompt = {
    ...newEntry,
    identifier: ensureUniqueIdentifier(targetData, newEntry.identifier),
    // 确保新版本字段存在且有正确的默认值
    injection_order: newEntry.injection_order ?? NEW_FIELD_DEFAULTS.injection_order,
    injection_trigger: Array.isArray(newEntry.injection_trigger)
      ? [...newEntry.injection_trigger]
      : [...NEW_FIELD_DEFAULTS.injection_trigger],
    // 确保其他必要字段存在
    forbid_overrides: newEntry.forbid_overrides || false,
    system_prompt: newEntry.system_prompt || false,
    marker: newEntry.marker || false,
  };
  delete newPrompt.isNewEntry;

  targetData.prompts.push(newPrompt);
  const newOrderEntry = { identifier: newPrompt.identifier, enabled: autoEnable };

  if (insertPosition === 'top') {
    characterPromptOrder.order.unshift(newOrderEntry);
  } else if (insertPosition.startsWith('after-')) {
    const afterIndex = parseInt(insertPosition.replace('after-', ''));
    // 使用 'include_disabled' 模式获取完整的参考列表，确保位置计算的一致性
    const referencePromptList = getTargetPromptsList(targetPreset, 'include_disabled');

    if (afterIndex >= 0 && afterIndex < referencePromptList.length) {
      const targetPrompt = referencePromptList[afterIndex];
      const orderIndex = characterPromptOrder.order.findIndex(e => e.identifier === targetPrompt.identifier);
      if (orderIndex !== -1) {
        characterPromptOrder.order.splice(orderIndex + 1, 0, newOrderEntry);
      } else {
        // 如果找不到目标条目，插入到末尾
        characterPromptOrder.order.push(newOrderEntry);
      }
    } else {
      // 索引超出范围，插入到末尾
      characterPromptOrder.order.push(newOrderEntry);
    }
  } else {
    // 默认插入到末尾
    characterPromptOrder.order.push(newOrderEntry);
  }

  await apiInfo.presetManager.savePreset(targetPreset, targetData);
  console.log(`新条目 "${newEntry.name}" 已成功插入到预设 "${targetPreset}"`);
}

async function performTransfer(
  apiInfo,
  sourcePreset,
  targetPreset,
  selectedEntries,
  insertPosition,
  autoEnable,
  displayMode = 'default',
) {
  const sourceData = getPresetDataFromManager(apiInfo, sourcePreset);
  const targetData = getPresetDataFromManager(apiInfo, targetPreset);
  if (!sourceData || !targetData) throw new Error('无法获取预设数据');

  if (!targetData.prompts) targetData.prompts = [];
  const characterPromptOrder = getOrCreateDummyCharacterPromptOrder(targetData);

  const targetPromptMap = new Map(targetData.prompts.map((p, i) => [p.name, i]));
  const newOrderEntries = []; // 收集新的order条目

  const entriesToTransfer = batchTransferWithNewFields(selectedEntries);

  entriesToTransfer.forEach(entry => {
    if (targetPromptMap.has(entry.name)) {
      // 更新现有条目，确保保留所有字段
      const existingIndex = targetPromptMap.get(entry.name);
      const existingPrompt = targetData.prompts[existingIndex];

      // 合并条目，确保新版本字段被正确传输
      targetData.prompts[existingIndex] = {
        ...existingPrompt, // 保留现有的所有字段
        ...entry, // 覆盖传输的字段
        identifier: existingPrompt.identifier, // 保持原有的identifier
        // 确保关键字段不被意外覆盖
        system_prompt: existingPrompt.system_prompt || entry.system_prompt || false,
        marker: existingPrompt.marker || entry.marker || false,
      };

      const existingOrderEntry = characterPromptOrder.order.find(o => o.identifier === existingPrompt.identifier);
      if (existingOrderEntry) {
        // 对于现有条目，保持其原有的启用状态，不强制改变
        // existingOrderEntry.enabled 保持不变
      } else {
        // 如果在order中找不到，则添加并使用autoEnable设置
        characterPromptOrder.order.push({ identifier: existingPrompt.identifier, enabled: autoEnable });
      }
    } else {
      // 创建新条目，确保包含所有新版本字段
      const newPrompt = {
        ...entry,
        identifier: ensureUniqueIdentifier(targetData, entry.identifier),
        // 确保新版本字段存在
        injection_order: entry.injection_order ?? NEW_FIELD_DEFAULTS.injection_order,
        injection_trigger: Array.isArray(entry.injection_trigger)
          ? [...entry.injection_trigger]
          : [...NEW_FIELD_DEFAULTS.injection_trigger],
      };
      targetData.prompts.push(newPrompt);
      const newOrderEntry = { identifier: newPrompt.identifier, enabled: autoEnable };
      newOrderEntries.push(newOrderEntry);
    }
  });

  // 批量插入新条目，保持原始顺序
  if (newOrderEntries.length > 0) {
    if (insertPosition === 'top') {
      // 插入到顶部，保持原始顺序
      characterPromptOrder.order.unshift(...newOrderEntries);
    } else if (insertPosition.startsWith('after-')) {
      const afterIndex = parseInt(insertPosition.replace('after-', ''));
      // 始终使用完整列表来计算在prompt_order中的真实位置
      const referencePromptList = getTargetPromptsList(targetPreset, 'include_disabled');

      if (afterIndex >= 0 && afterIndex < referencePromptList.length) {
        const targetPrompt = referencePromptList[afterIndex];
        const orderIndex = characterPromptOrder.order.findIndex(e => e.identifier === targetPrompt.identifier);
        if (orderIndex !== -1) {
          characterPromptOrder.order.splice(orderIndex + 1, 0, ...newOrderEntries);
        } else {
          // 如果找不到目标条目，插入到末尾
          characterPromptOrder.order.push(...newOrderEntries);
        }
      } else {
        // 索引超出范围，插入到末尾
        characterPromptOrder.order.push(...newOrderEntries);
      }
    } else {
      // 默认插入到末尾
      characterPromptOrder.order.push(...newOrderEntries);
    }
  }
  await apiInfo.presetManager.savePreset(targetPreset, targetData);
  console.log('预设转移完成，新提示词已正确添加并启用');
}

async function performDelete(apiInfo, sourcePreset, selectedEntries) {
  const sourceData = getPresetDataFromManager(apiInfo, sourcePreset);
  if (!sourceData) throw new Error('无法获取源预设数据');
  if (!sourceData.prompts) sourceData.prompts = [];
  if (!sourceData.prompt_order) sourceData.prompt_order = [];

  const dummyCharacterId = 100001;
  let characterPromptOrder = sourceData.prompt_order.find(order => order.character_id === dummyCharacterId);
  if (!characterPromptOrder) {
    characterPromptOrder = { character_id: dummyCharacterId, order: [] };
    sourceData.prompt_order.push(characterPromptOrder);
  }

  const entriesToDelete = new Set(selectedEntries.map(entry => entry.name));
  sourceData.prompts = sourceData.prompts.filter(p => !(p && p.name && entriesToDelete.has(p.name)));
  characterPromptOrder.order = characterPromptOrder.order.filter(o => {
    if (o && o.identifier) {
      const matchingPrompt = selectedEntries.find(
        entry => o.identifier === entry.identifier || (entry.name && o.identifier.includes(entry.name)),
      );
      return !matchingPrompt;
    }
    return true;
  });
  await apiInfo.presetManager.savePreset(sourcePreset, sourceData);
  console.log(`预设删除完成，已删除 ${selectedEntries.length} 个条目`);
}


export {
  performInsertNewEntry,
  performTransfer,
  performDelete
};
