import { getJQuery } from '../core/utils.js';
import { getPresetDataFromManager } from '../preset/preset-manager.js';
import { loadAndDisplayEntries } from '../display/entry-display.js';
import { BatchEditor } from '../ui/batch-editor.js';
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
      alert('无法确定目标预设');
      return;
    }

    // 应用批量修改
    const modifiedEntries = BatchEditor.applyBatchModifications(selectedEntries, modifications);

    // 获取预设数据
    const presetData = getPresetDataFromManager(apiInfo, presetName);
    const allEntries = presetData.prompts || [];

    // 更新修改的条目
    modifiedEntries.forEach(modifiedEntry => {
      const index = allEntries.findIndex(e => e.identifier === modifiedEntry.identifier);
      if (index >= 0) {
        allEntries[index] = modifiedEntry;
      }
    });

    // 保存预设
    await apiInfo.presetManager.savePreset(presetName, presetData);

    if (window.toastr) {
      toastr.success(`已对 ${selectedEntries.length} 个条目应用批量修改`);
    } else {
      alert(`已对 ${selectedEntries.length} 个条目应用批量修改`);
    }

    // 刷新界面
    loadAndDisplayEntries(apiInfo);
  } catch (error) {
    console.error('批量修改失败:', error);
    if (window.toastr) {
      toastr.error('批量修改失败: ' + error.message);
    } else {
      alert('批量修改失败: ' + error.message);
    }
  }
}


export {
  getSelectedEntriesForSide,
  getPresetNameForSide,
  applyBatchModificationsToSide
};
