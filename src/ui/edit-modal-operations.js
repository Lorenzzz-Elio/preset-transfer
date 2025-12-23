import { escapeHtml, getJQuery, getCurrentApiInfo } from '../core/utils.js';
import { getPresetDataFromManager, getPromptEntries } from '../preset/preset-manager.js';
import { loadAndDisplayEntries, getSelectedEntries } from '../display/entry-display.js';
import { getActiveTransferAdapter } from '../transfer/transfer-context.js';
import { performDelete } from '../operations/core-operations.js';

async function deleteSelectedEntries(apiInfo, side) {
  const $ = getJQuery();
  const adapter = getActiveTransferAdapter();
  const containerLabel = adapter?.ui?.containerLabel ?? '预设';
  const selectedEntries = getSelectedEntries(side);
  let presetName;

  if (side === 'single') {
    presetName = window.singlePresetName;
  } else {
    presetName = $(`#${side}-preset`).val();
  }

  if (selectedEntries.length === 0) {
    alert('请至少选择一个条目进行删除');
    return;
  }

  if (!presetName) {
    alert(`请先选择${containerLabel}`);
    return;
  }

  showConfirmDialog(
    `确定要从${escapeHtml(containerLabel)} "${escapeHtml(presetName)}" 中删除 ${selectedEntries.length} 个条目吗？此操作不可撤销。`,
    async () => {
      try {
        const deleteButton = side === 'single' ? '#single-delete' : `#${side}-delete`;
        $(deleteButton).prop('disabled', true).text('删除中...');
        await performDelete(apiInfo, presetName, selectedEntries);
        console.log(`成功删除 ${selectedEntries.length} 个条目`);

        if ($('#auto-close-modal').prop('checked')) {
          $('#preset-transfer-modal').remove();
          return;
        }

        loadAndDisplayEntries(apiInfo);
      } catch (error) {
        console.error('删除失败:', error);
        alert('删除失败: ' + error.message);
      } finally {
        const deleteButton = side === 'single' ? '#single-delete' : `#${side}-delete`;
        $(deleteButton).prop('disabled', false).text('删除');
        updateSelectionCount();
      }
    },
  );
}

function getTargetPromptsList(targetPreset, displayMode = 'default') {
  try {
    const apiInfo = getCurrentApiInfo();
    if (!apiInfo) return [];
    const presetData = getPresetDataFromManager(apiInfo, targetPreset);
    if (!presetData) return [];

    if (!presetData.prompts || !Array.isArray(presetData.prompts)) {
      return [];
    }

    const dummyCharacterId = 100001;
    const characterPromptOrder = presetData.prompt_order?.find(order => order.character_id === dummyCharacterId);

    if (!characterPromptOrder) {
      return getPromptEntries(presetData);
    }

    const orderedEntries = [];
    const promptMap = new Map(presetData.prompts.map(p => [p.identifier, p]));

    characterPromptOrder.order.forEach(orderEntry => {
      const prompt = promptMap.get(orderEntry.identifier);
      if (prompt && !prompt.system_prompt && !prompt.marker && prompt.name && prompt.name.trim() !== '') {
        const entryWithStatus = {
          ...prompt,
          enabled: orderEntry.enabled,
          orderIndex: orderedEntries.length,
        };

        if (displayMode === 'default' && !orderEntry.enabled) {
          entryWithStatus.hiddenInDefaultMode = true;
        }

        orderedEntries.push(entryWithStatus);
      }
    });

    if (displayMode === 'default') {
      return orderedEntries.filter(entry => !entry.hiddenInDefaultMode);
    }

    return orderedEntries;
  } catch (error) {
    console.error('获取目标提示词列表失败:', error);
    return [];
  }
}

function getOrCreateDummyCharacterPromptOrder(presetData) {
  if (!presetData.prompt_order) {
    presetData.prompt_order = [];
  }
  const dummyCharacterId = 100001;
  let characterPromptOrder = presetData.prompt_order.find(order => order.character_id === dummyCharacterId);
  if (!characterPromptOrder) {
    characterPromptOrder = {
      character_id: dummyCharacterId,
      order: [
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
      ],
    };
    presetData.prompt_order.push(characterPromptOrder);
  }
  return characterPromptOrder;
}

export { deleteSelectedEntries, getTargetPromptsList, getOrCreateDummyCharacterPromptOrder };
