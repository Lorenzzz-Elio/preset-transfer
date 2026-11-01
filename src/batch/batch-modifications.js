import { getJQuery } from '../core/utils.js';
import { getPresetDataFromManager } from '../preset/preset-manager.js';
import { loadAndDisplayEntries } from '../display/entry-display.js';
import { BatchEditor } from '../ui/batch-editor.js';
import { notify } from '../core/notify.js';
import { applyUpdateEntriesInPreset } from '../core/preset-data-pure.js';
import { syncNativePromptManagerIfActive } from '../preset/native-sync.js';
function getSelectedEntriesForSide(side) {
  const $ = getJQuery();
  const selectedEntries = [];

  $(`#${side}-entries-list .entry-checkbox:checked`).each(function () {
    const $entryItem = $(this).closest('.entry-item');
    const index = parseInt($entryItem.data('index'));
    const identifier = $entryItem.data('identifier');

    // 根据侧获取对应的条目数据
    let entries;
    if (side === 'left') {
      entries = window.leftEntries || [];
    } else if (side === 'right') {
      entries = window.rightEntries || [];
    } else if (side === 'single') {
      entries = window.singleEntries || [];
    }

    // 优先使用identifier查找，否则使用index
    let entry;
    if (identifier) {
      entry = entries.find(e => e.identifier === identifier);
    }
    if (!entry && !isNaN(index) && index >= 0 && index < entries.length) {
      entry = entries[index];
    }

    if (entry) {
      selectedEntries.push(entry);
    }
  });

  return selectedEntries;
}

// 获取指定侧的预设名称
function getPresetNameForSide(side) {
  const $ = getJQuery();

  if (side === 'left') {
    return $('#left-preset').val();
  } else if (side === 'right') {
    return $('#right-preset').val();
  } else if (side === 'single') {
    return window.singlePresetName || $('#left-preset').val() || $('#right-preset').val();
  }

  return null;
}

// 应用批量修改到指定侧
async function applyBatchModificationsToSide(side, selectedEntries, modifications, apiInfo) {
  try {
    const presetName = getPresetNameForSide(side);
    if (!presetName) {
      notify.warning('无法确定目标预设');
      return false;
    }

    // 应用批量修改
    const modifiedEntries = BatchEditor.applyBatchModifications(selectedEntries, modifications);

    // 获取预设数据
    const presetData = getPresetDataFromManager(apiInfo, presetName);

    // 复用核心纯函数：基于原生 identifier 精准更新预设条目并保留其他字段
    applyUpdateEntriesInPreset(presetData, modifiedEntries);

    // 保存预设
    await apiInfo.presetManager.savePreset(presetName, presetData, { skipUpdate: true });
    await syncNativePromptManagerIfActive(apiInfo, presetName, presetData);

    notify.success(`已对 ${selectedEntries.length} 个条目应用批量修改`);

    // 刷新界面
    loadAndDisplayEntries(apiInfo, side);
    return true;
  } catch (error) {
    console.error('批量修改失败:', error);
    notify.error('批量修改失败: ' + error.message);
    return false;
  }
}


export {
  getSelectedEntriesForSide,
  getPresetNameForSide,
  applyBatchModificationsToSide,
};
