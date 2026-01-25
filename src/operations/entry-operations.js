import { getJQuery } from '../core/utils.js';
import { NEW_FIELD_DEFAULTS } from '../core/constants.js';
import { getSelectedEntries, loadAndDisplayEntries } from '../display/entry-display.js';
import { getActiveTransferAdapter } from '../transfer/transfer-context.js';
import { createWorldbookEditEntryModal } from '../worldbook/edit-modal.js';
import { openWorldbookBatchEditModal } from '../worldbook/batch-edit-modal.js';
import { performTransfer } from './core-operations.js';
import { getPresetDataFromManager, getPromptEntries } from '../preset/preset-manager.js';
import { ensureNewVersionFields } from '../preset/new-version-fields.js';

let worldInfoModulePromise = null;

async function getWorldInfoModule() {
  if (!worldInfoModulePromise) {
    worldInfoModulePromise = import('/scripts/world-info.js');
  }
  return await worldInfoModulePromise;
}

function getFreeWorldEntryUidFallback(data) {
  const entriesObj = data?.entries && typeof data.entries === 'object' ? data.entries : {};
  const used = new Set(Object.values(entriesObj).map(e => Number(e?.uid)).filter(Number.isFinite));
  let uid = 0;
  while (used.has(uid)) uid += 1;
  return uid;
}

function cloneDeepFallback(value) {
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch {
    // ignore
  }
  return JSON.parse(JSON.stringify(value));
}

async function createNewWorldbookEntry(apiInfo, side) {
  const $ = getJQuery();
  const adapter = getActiveTransferAdapter();

  if (adapter?.id !== 'worldbook') {
    startNewEntryMode(apiInfo, side);
    return;
  }

  let worldbookName;
  if (side === 'single') {
    worldbookName = window.singlePresetName || $('#left-preset').val() || $('#right-preset').val();
  } else {
    worldbookName = $(`#${side}-preset`).val();
  }
  if (!worldbookName) {
    alert('请先选择世界书');
    return;
  }

  const autoEnable = $('#auto-enable-entry').prop('checked');

  try {
    const mod = await getWorldInfoModule();
    if (typeof mod.loadWorldInfo !== 'function') {
      throw new Error('World Info module missing loadWorldInfo');
    }
    if (typeof mod.saveWorldInfo !== 'function') {
      throw new Error('World Info module missing saveWorldInfo');
    }

    const data = await mod.loadWorldInfo(worldbookName);
    if (!data.entries || typeof data.entries !== 'object') {
      data.entries = {};
    }

    let newEntry = null;

    if (typeof mod.createWorldInfoEntry === 'function') {
      newEntry = mod.createWorldInfoEntry(worldbookName, data);
    }

    if (!newEntry || !Number.isFinite(Number(newEntry.uid))) {
      const getFreeWorldEntryUid = typeof mod.getFreeWorldEntryUid === 'function' ? mod.getFreeWorldEntryUid : null;
      const uid = getFreeWorldEntryUid ? getFreeWorldEntryUid(data) : getFreeWorldEntryUidFallback(data);
      if (!Number.isInteger(uid)) {
        throw new Error('无法为新条目分配 UID');
      }

      const baseTemplate =
        mod.newWorldInfoEntryTemplate && typeof mod.newWorldInfoEntryTemplate === 'object'
          ? mod.newWorldInfoEntryTemplate
          : {
              key: [],
              keysecondary: [],
              comment: '',
              content: '',
              constant: false,
              selective: true,
              selectiveLogic: 0,
              order: 100,
              position: 0,
              disable: false,
              depth: 4,
              triggers: [],
            };

      newEntry = { uid, ...cloneDeepFallback(baseTemplate) };
      data.entries[String(uid)] = newEntry;
    }

    if (!autoEnable) {
      newEntry.disable = true;
    }

    await mod.saveWorldInfo(worldbookName, data, true);
    await loadAndDisplayEntries(apiInfo);

    createWorldbookEditEntryModal(apiInfo, worldbookName, {
      identifier: String(newEntry.uid),
      name: String(newEntry.comment ?? ''),
      content: String(newEntry.content ?? ''),
      raw: newEntry,
    });
  } catch (error) {
    console.error('新建世界书条目失败:', error);
    alert('新建世界书条目失败: ' + error.message);
  }
}
async function startTransferMode(apiInfo, fromSide, toSide) {
  const $ = getJQuery();
  const adapter = getActiveTransferAdapter();
  const selectedEntries = getSelectedEntries(fromSide);

  // 过滤掉 marker 类型的条目
  const transferableEntries = selectedEntries.filter(entry => !entry.marker);

  if (transferableEntries.length === 0 && selectedEntries.length > 0) {
    alert('选中的条目都是 Marker 类型，无法转移（Marker 条目没有实际内容）');
    return;
  }

  if (transferableEntries.length < selectedEntries.length) {
    const markerCount = selectedEntries.length - transferableEntries.length;
    alert(`已自动排除 ${markerCount} 个 Marker 类型的条目，它们不能转移`);
  }

  let sourceContainer =
    fromSide === 'favorites'
      ? String(window.ptFavoriteContainerName ?? '').trim()
      : fromSide === 'single'
      ? String(window.singlePresetName ?? '').trim()
      : String($(`#${fromSide}-preset`).val() ?? '').trim();

  if (transferableEntries.length === 0) {
    alert('请至少选择一个条目进行转移');
    return;
  }

  // 从收藏面板转移时，收集所有源预设
  if (fromSide === 'favorites') {
    const sourceNames = new Set(
      transferableEntries.map(entry => String(entry?.ptFavoriteContainer ?? '').trim()).filter(Boolean),
    );
    if (sourceNames.size === 0) {
      alert('无法确定源预设');
      return;
    }
    // 如果只有一个源预设，使用它；否则保持为空，后续按条目分别处理
    if (sourceNames.size === 1) {
      sourceContainer = Array.from(sourceNames)[0];
    } else {
      sourceContainer = ''; // 多个源预设
    }
  }

  // 不支持插入位置的适配器：需要预先确定目标
  if (!adapter.capabilities.supportsInsertPosition) {
    if (!toSide) {
      alert('请先选择目标预设');
      return;
    }
    const toPreset = toSide === 'single' ? window.singlePresetName : $(`#${toSide}-preset`).val();
    if (!toPreset) {
      alert('请选择目标预设');
      return;
    }

    const fromPreset = sourceContainer;
    const displayMode = $(`#${toSide}-display-mode`).val();
    const autoEnable = $('#auto-enable-entry').prop('checked');

    try {
      await performTransfer(apiInfo, fromPreset, toPreset, transferableEntries, null, autoEnable, displayMode);

      if ($('#auto-close-modal').prop('checked')) {
        $('#preset-transfer-modal').remove();
        return;
      }

      await loadAndDisplayEntries(apiInfo);
    } catch (error) {
      console.error('转移失败:', error);
      alert('转移失败: ' + error.message);
    }
    return;
  }

  // 支持插入位置的适配器：设置转移模式，等待用户点击
  window.transferMode = {
    apiInfo: apiInfo,
    fromSide: fromSide,
    toSide: toSide,
    selectedEntries: transferableEntries,
    sourceContainer: sourceContainer,
  };

  // 更新UI提示
  if (toSide) {
    alert(`转移模式已激活！请点击${toSide === 'left' ? '左侧' : toSide === 'right' ? '右侧' : '目标'}面板中的条目来选择插入位置。`);
    $(`#${toSide}-side`).addClass('transfer-target');
  } else {
    alert('转移模式已激活！请点击目标面板中的条目来选择插入位置。');
    $('#left-side, #right-side, #single-container').addClass('transfer-target');
  }

  if (fromSide !== 'favorites') {
    $(`#${fromSide}-side`).addClass('transfer-source');
  }
}

function startNewEntryMode(apiInfo, side) {
  const $ = getJQuery();
  let presetName;

  if (side === 'single') {
    presetName = window.singlePresetName;
  } else {
    presetName = $(`#${side}-preset`).val();
  }

  if (!presetName) {
    alert('请先选择预设');
    return;
  }

  // 设置新建模式
  window.newEntryMode = {
    apiInfo: apiInfo,
    side: side,
    presetName: presetName,
  };

  // 更新UI提示
  let sideText = side === 'single' ? '当前' : side === 'left' ? '左侧' : '右侧';
  alert(`新建模式已激活！请点击${sideText}面板中的条目来选择插入位置。`);

  // 高亮当前面板
  $(`#${side}-side`).addClass('new-entry-target');
}

async function executeTransferToPosition(apiInfo, fromSide, toSide, targetPosition) {
  const $ = getJQuery();
  const selectedEntries = window.transferMode.selectedEntries;
  const sourceContainer = window.transferMode?.sourceContainer;

  let toPreset;
  let displayMode;
  if (toSide === 'single') {
    toPreset = window.singlePresetName;
    displayMode = $('#single-display-mode').val();
  } else {
    toPreset = $(`#${toSide}-preset`).val();
    displayMode = $(`#${toSide}-display-mode`).val();
  }

  try {
    if (!toPreset) {
      throw new Error('请选择目标预设');
    }

    // 构建插入位置
    let insertPosition;
    if (typeof targetPosition === 'string') {
      insertPosition = targetPosition; // 'top' 或 'bottom'
    } else {
      insertPosition = `after-${targetPosition}`;
    }

    const autoEnable = $('#auto-enable-entry').prop('checked');

    // 处理多源预设情况（从收藏面板转移）
    if (fromSide === 'favorites' && !sourceContainer) {
      // 按源预设分组
      const entriesBySource = new Map();
      for (const entry of selectedEntries) {
        const source = String(entry?.ptFavoriteContainer ?? '').trim();
        if (!source) continue;
        if (!entriesBySource.has(source)) {
          entriesBySource.set(source, []);
        }
        entriesBySource.get(source).push(entry);
      }

      // 串行转移每组（避免并发写入同一目标文件导致数据丢失）
      const errors = [];
      for (const [source, entries] of entriesBySource) {
        try {
          await performTransfer(apiInfo, source, toPreset, entries, insertPosition, autoEnable, displayMode);
        } catch (error) {
          errors.push({ source, error });
        }
      }

      // 如果有部分失败，报告但不阻止后续操作
      if (errors.length > 0) {
        const errorMsg = errors.map(e => `从 ${e.source}: ${e.error.message}`).join('\n');
        console.error('部分转移失败:', errors);
        alert(`部分转移失败:\n${errorMsg}`);
      }
    } else {
      // 单源预设情况
      const fromPreset = sourceContainer || (fromSide ? $(`#${fromSide}-preset`).val() : '');
      if (!fromPreset) {
        throw new Error('请选择源预设');
      }
      await performTransfer(apiInfo, fromPreset, toPreset, selectedEntries, insertPosition, autoEnable, displayMode);
    }

    // 转移成功
    console.log(`成功转移 ${selectedEntries.length} 个条目`);

    // 检查是否需要自动关闭模态框
    if ($('#auto-close-modal').prop('checked')) {
      $('#preset-transfer-modal').remove();
      return;
    }

    // 刷新界面
    await loadAndDisplayEntries(apiInfo);
  } catch (error) {
    console.error('转移失败:', error);
    alert('转移失败: ' + error.message);
  } finally {
    // 重置转移模式
    window.transferMode = null;
    $('.transfer-target, .transfer-source').removeClass('transfer-target transfer-source');
  }
}

function executeNewEntryAtPosition(apiInfo, side, targetPosition) {
  const $ = getJQuery();
  let presetName;
  let displayMode;

  if (side === 'single') {
    presetName = window.singlePresetName;
    displayMode = $('#single-display-mode').val();
  } else {
    presetName = window.newEntryMode.presetName;
    displayMode = $(`#${side}-display-mode`).val();
  }

  // 构建插入位置
  let insertPosition;
  if (typeof targetPosition === 'string') {
    insertPosition = targetPosition; // 'top' 或 'bottom'
  } else {
    insertPosition = `after-${targetPosition}`;
  }

  const defaultEntry = {
    name: '新提示词',
    content: '',
    role: 'system',
    injection_depth: 4,
    injection_position: null, // Default to relative
    forbid_overrides: false,
    system_prompt: false,
    marker: false,
    injection_order: NEW_FIELD_DEFAULTS.injection_order,
    injection_trigger: [...NEW_FIELD_DEFAULTS.injection_trigger],
    isNewEntry: true,
  };

  // 重置新建模式
  window.newEntryMode = null;
  $('.new-entry-target').removeClass('new-entry-target');

  // 打开编辑模态框
  const autoEnable = $('#auto-enable-entry').prop('checked');
  createEditEntryModal(apiInfo, presetName, defaultEntry, insertPosition, autoEnable, side, null, displayMode);
}

// HTML转义函数

async function copyEntryBetweenPresets(apiInfo, fromPreset, toPreset, entryData, entryName) {
  try {
    const toPresetData = getPresetDataFromManager(apiInfo, toPreset);
    const targetPromptIndex = toPresetData.prompts.findIndex(
      p => p && p.name === entryName && !p.system_prompt && !p.marker,
    );

    if (targetPromptIndex === -1) {
      throw new Error(`在预设 "${toPreset}" 中未找到目标条目 "${entryName}"`);
    }

    const originalIdentifier = toPresetData.prompts[targetPromptIndex].identifier;
    const newPromptData = ensureNewVersionFields(entryData);

    // Replace the old prompt object with the new one, preserving the identifier
    toPresetData.prompts[targetPromptIndex] = {
      ...newPromptData,
      identifier: originalIdentifier,
    };

    await apiInfo.presetManager.savePreset(toPreset, toPresetData);

    // 成功覆盖，无需弹窗提示

    // 刷新主界面和比较界面
    await loadAndDisplayEntries(apiInfo);
    const $ = getJQuery();
    $('#compare-modal').remove();
    // 重新打开比较模态框以显示更新后的状态
    const { showCompareModal } = await import('../ui/compare-modal.js');
    showCompareModal(apiInfo);
  } catch (error) {
    console.error('覆盖条目失败:', error);
    alert('覆盖条目失败: ' + error.message);
  }
}

function editEntryInPreset(apiInfo, presetName, entryData, entryName, fromCompare = false) {
  // 找到条目在预设中的索引
  const presetData = getPresetDataFromManager(apiInfo, presetName);
  const entries = getPromptEntries(presetData);
  const entryIndex = entries.findIndex(e => e.name === entryName);

  if (entryIndex === -1) {
    alert('条目未找到');
    return;
  }

  // 打开编辑模态框，传递来自比较界面的标记
  createEditEntryModal(apiInfo, presetName, entryData, null, false, null, entryIndex, 'default', fromCompare);
}

function editSelectedEntry(apiInfo, side) {
  const $ = getJQuery();
  const adapter = getActiveTransferAdapter();
  const selectedEntries = getSelectedEntries(side);
  let presetName, entries, displayMode;

  if (side === 'single') {
    presetName = window.singlePresetName;
    entries = window.singleEntries;
    displayMode = $('#single-display-mode').val();
  } else {
    presetName = $(`#${side}-preset`).val();
    entries = side === 'left' ? window.leftEntries : window.rightEntries;
    displayMode = $(`#${side}-display-mode`).val();
  }

  if (!presetName) {
    alert(`请先选择${adapter?.ui?.containerLabel ?? '预设'}`);
    return;
  }

  if (adapter.id === 'worldbook') {
    if (selectedEntries.length === 0) {
      alert('请选择要编辑的条目');
      return;
    }
    if (selectedEntries.length === 1) {
      createWorldbookEditEntryModal(apiInfo, presetName, selectedEntries[0]);
      return;
    }

    openWorldbookBatchEditModal(apiInfo, presetName, selectedEntries);
    return;
  }

  // 合并的编辑逻辑：根据选择数量自动决定是单独编辑还是批量编辑
  if (selectedEntries.length === 0) {
    alert('请选择要编辑的条目');
    return;
  } else if (selectedEntries.length === 1) {
    // 单独编辑
    const entry = selectedEntries[0];

    // 检查是否为 marker 类型条目
    if (entry.marker) {
      alert('Marker 类型的条目不能编辑内容，它们的内容来自其他地方（如世界书）');
      return;
    }

    const entryIndex = entries.findIndex(e => e.name === entry.name && e.content === entry.content);
    createEditEntryModal(apiInfo, presetName, entry, null, false, side, entryIndex, displayMode);
  } else {
    // 批量编辑（2个或以上）
    // 过滤掉 marker 类型的条目
    const editableEntries = selectedEntries.filter(entry => !entry.marker);

    if (editableEntries.length === 0) {
      alert('选中的条目都是 Marker 类型，无法编辑内容');
      return;
    }

    if (editableEntries.length < selectedEntries.length) {
      const markerCount = selectedEntries.length - editableEntries.length;
      alert(`已自动排除 ${markerCount} 个 Marker 类型的条目，它们不能编辑内容`);
    }

    BatchEditor.showBatchEditDialog(editableEntries, modifications => {
      applyBatchModificationsToSide(side, editableEntries, modifications, apiInfo);
    });
  }
}


export {
  startTransferMode,
  startNewEntryMode,
  executeTransferToPosition,
  executeNewEntryAtPosition,
  createNewWorldbookEntry,
  editEntryInPreset,
  editSelectedEntry,
  copyEntryBetweenPresets
};
