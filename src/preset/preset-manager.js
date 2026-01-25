import { PT } from '../core/api-compat.js';
import { getCurrentApiInfo, getJQuery } from '../core/utils.js';

function setCurrentPreset(side) {
  let currentPresetName = null;

  try {
    currentPresetName = PT.API.getLoadedPresetName?.() ?? null;
  } catch (e) {
    console.warn('统一API获取当前预设失败:', e);
    currentPresetName = null;
  }

  // 兜底：从预设管理器获取当前预设
  if (!currentPresetName) {
    try {
      const apiInfo = getCurrentApiInfo();
      if (apiInfo && apiInfo.presetManager) {
        const currentPreset = apiInfo.presetManager.getCompletionPresetByName('in_use');
        if (currentPreset && currentPreset.name && currentPreset.name !== 'in_use') {
          currentPresetName = currentPreset.name;
        }
      }
    } catch (e) {
      console.warn('从预设管理器获取预设名称失败:', e);
    }
  }

  const $ = getJQuery();
  const selectId = side === 'left' ? '#left-preset' : '#right-preset';
  const $select = $(selectId);

  if (!currentPresetName) {
    alert(
      '无法获取当前预设名称，请确保已选择预设。\n\n可能的原因：\n1. 当前没有加载任何预设\n2. 预设API不可用\n3. 需要刷新页面重新加载',
    );
    return;
  }

  // 检查预设是否存在于选项中
  const optionExists = $select.find(`option[value="${currentPresetName}"]`).length > 0;
  if (!optionExists) {
    alert(`当前预设"${currentPresetName}"不在可选列表中，可能需要刷新预设列表`);
    return;
  }

  // 记录之前的预设名称（用于正则切换）
  const previousPresetName = $select.val();

  // 设置选中的预设
  $select.val(currentPresetName).trigger('change');

  // 视觉反馈
  const button = $(`#get-current-${side}`);
  const originalHtml = button.html();

  // 保持按钮尺寸，显示对勾
  button.html(`
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  `);

  setTimeout(() => {
    button.html(originalHtml);
  }, 1000);
}

function getPresetDataFromManager(apiInfo, presetName) {
  try {
    const presetData = apiInfo.presetManager.getCompletionPresetByName(presetName);
    if (!presetData) {
      throw new Error(`预设 "${presetName}" 不存在`);
    }
    return presetData;
  } catch (error) {
    console.error('从预设管理器获取预设数据失败:', error);
    throw error;
  }
}

function getPromptEntries(presetData) {
  if (!presetData || !presetData.prompts || !Array.isArray(presetData.prompts)) {
    return [];
  }
  return presetData.prompts.filter(
    prompt => prompt && prompt.name && prompt.name.trim() !== '',
  );
}

function getOrderedPromptEntries(presetData, displayMode = 'default') {
  if (!presetData || !presetData.prompts || !Array.isArray(presetData.prompts)) {
    return [];
  }

  const dummyCharacterId = 100001;
  const characterPromptOrder = presetData.prompt_order?.find(order => order.character_id === dummyCharacterId);
  const orderMap = new Map(characterPromptOrder?.order.map(o => [o.identifier, o.enabled]));

  // 特殊处理：显示未插入提示词模式
  if (displayMode === 'show_uninserted') {
    const allPrompts = getPromptEntries(presetData);
    const insertedIdentifiers = new Set(characterPromptOrder?.order.map(o => o.identifier) || []);

    // 返回所有未在prompt_order中的条目
    return allPrompts
      .filter(prompt => !insertedIdentifiers.has(prompt.identifier))
      .map((entry, index) => ({
        ...entry,
        enabled: false,
        isUninserted: true,
        orderIndex: index,
      }));
  }

  // If no specific order is defined, fall back to returning all prompts.
  if (!characterPromptOrder) {
    return getPromptEntries(presetData).map(entry => ({ ...entry, enabled: false }));
  }

  const orderedEntries = [];
  const promptMap = new Map(presetData.prompts.map(p => [p.identifier, p]));

  characterPromptOrder.order.forEach(orderEntry => {
    // For 'default' mode, only process enabled entries.
    // For 'include_disabled' mode, process all entries in the order.
    if (displayMode === 'default' && !orderEntry.enabled) {
      return; // Skip disabled entries in default mode
    }

    if (promptMap.has(orderEntry.identifier)) {
      const prompt = promptMap.get(orderEntry.identifier);
      // Filter out empty names.
      if (prompt && prompt.name && prompt.name.trim() !== '') {
        orderedEntries.push({
          ...prompt,
          enabled: orderEntry.enabled, // Always include the enabled status
          orderIndex: orderedEntries.length,
        });
      }
    }
  });

  return orderedEntries;
}

function getNewEntries(leftPresetData, rightPresetData, side) {
  if (!leftPresetData || !rightPresetData) {
    return [];
  }

  const leftEntries = getPromptEntries(leftPresetData);
  const rightEntries = getPromptEntries(rightPresetData);

  // 创建名称映射
  const leftNames = new Set(leftEntries.map(e => e.name));
  const rightNames = new Set(rightEntries.map(e => e.name));

  if (side === 'left') {
    // 返回左侧独有的条目（右侧没有的）
    return leftEntries
      .filter(entry => !rightNames.has(entry.name))
      .map(entry => ({ ...entry, enabled: false, isNewEntry: true }));
  } else if (side === 'right') {
    // 返回右侧独有的条目（左侧没有的）
    return rightEntries
      .filter(entry => !leftNames.has(entry.name))
      .map(entry => ({ ...entry, enabled: false, isNewEntry: true }));
  }

  return [];
}

async function switchToPreset(apiInfo, presetName) {
  try {
    console.log(`切换到预设: ${presetName}`);
    const presetValue = apiInfo.presetManager.findPreset(presetName);
    if (!presetValue) throw new Error(`无法找到预设: ${presetName}`);
    apiInfo.presetManager.selectPreset(presetValue);
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log(`成功切换到预设: ${presetName}`);
  } catch (error) {
    console.error('切换预设失败:', error);
    throw error;
  }
}

export {
  getNewEntries,
  getOrderedPromptEntries,
  getPresetDataFromManager,
  getPromptEntries,
  setCurrentPreset,
  switchToPreset,
};
