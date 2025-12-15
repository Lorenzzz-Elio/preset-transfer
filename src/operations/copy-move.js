import { getJQuery } from '../core/utils.js';
import { getPresetDataFromManager } from '../preset/preset-manager.js';
import { getOrCreateDummyCharacterPromptOrder } from '../ui/edit-modal.js';
import { getSelectedEntries, loadAndDisplayEntries } from '../display/entry-display.js';
import { getPresetNameForSide } from '../batch/batch-modifications.js';
import { getActiveTransferAdapter } from '../transfer/transfer-context.js';
// ==================== 新增功能模块 ====================

// QuickCopy模块已移除 - 复制功能已被"在此处新建"功能替代

// 简单的重命名函数，用于替代QuickCopy.generateCopyName
function generateCopyName(originalName) {
  const copyPattern = /^(.+?)\s*(?:\(副本\s*(\d*)\))?$/;
  const match = originalName.match(copyPattern);

  if (match) {
    const baseName = match[1];
    const copyNum = match[2] ? parseInt(match[2]) + 1 : 1;
    return `${baseName} (副本${copyNum > 1 ? copyNum : ''})`;
  }
  return `${originalName} (副本)`;
}

// 生成唯一标识符
function generateIdentifier() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

let worldInfoModulePromise = null;

async function getWorldInfoModule() {
  if (!worldInfoModulePromise) {
    worldInfoModulePromise = import('/scripts/world-info.js');
  }
  return await worldInfoModulePromise;
}

function getFreeUidFallback(targetData) {
  const entriesObj = targetData?.entries && typeof targetData.entries === 'object' ? targetData.entries : {};
  const used = new Set(Object.values(entriesObj).map(e => Number(e?.uid)).filter(Number.isFinite));
  let uid = 0;
  while (used.has(uid)) uid += 1;
  return uid;
}

function cloneWorldEntry(sourceEntry) {
  const clone = JSON.parse(JSON.stringify(sourceEntry ?? {}));
  delete clone.uid;
  return clone;
}

async function copyWorldbookEntries(side, apiInfo) {
  const $ = getJQuery();
  const selectedEntries = getSelectedEntries(side);
  const worldbookName = getPresetNameForSide(side);
  const autoEnable = $('#auto-enable-entry').prop('checked');

  if (selectedEntries.length === 0) {
    alert('请选择要复制的条目');
    return;
  }

  if (!worldbookName) {
    alert('无法确定目标世界书');
    return;
  }

  const mod = await getWorldInfoModule();
  if (typeof mod.loadWorldInfo !== 'function' || typeof mod.saveWorldInfo !== 'function') {
    throw new Error('World Info module missing loadWorldInfo/saveWorldInfo');
  }

  const data = await mod.loadWorldInfo(worldbookName);
  if (!data || typeof data !== 'object') {
    throw new Error(`无法加载世界书: ${worldbookName}`);
  }

  if (!data.entries || typeof data.entries !== 'object') {
    data.entries = {};
  }

  const getFreeWorldEntryUid =
    typeof mod.getFreeWorldEntryUid === 'function' ? mod.getFreeWorldEntryUid : null;

  const existingComments = new Set(Object.values(data.entries).map(e => String(e?.comment ?? '')));
  const makeUniqueComment = (base) => {
    const normalizedBase = String(base ?? '').trim();
    const root = normalizedBase ? `${normalizedBase} 副本` : '副本';
    if (!existingComments.has(root)) {
      existingComments.add(root);
      return root;
    }

    let index = 2;
    while (existingComments.has(`${root}${index}`)) {
      index += 1;
    }
    const next = `${root}${index}`;
    existingComments.add(next);
    return next;
  };

  for (const item of selectedEntries) {
    const uid = item?.raw?.uid ?? Number(item?.identifier);
    const src = item?.raw ?? (Number.isFinite(uid) ? data.entries[String(uid)] : null);
    if (!src) continue;

    const clone = cloneWorldEntry(src);
    clone.comment = makeUniqueComment(clone.comment ?? '');
    if (autoEnable) {
      clone.disable = false;
    }

    const newUid = getFreeWorldEntryUid ? getFreeWorldEntryUid(data) : getFreeUidFallback(data);
    data.entries[String(newUid)] = { uid: newUid, ...clone };
  }

  await mod.saveWorldInfo(worldbookName, data, true);
  loadAndDisplayEntries(apiInfo);
}

// 简化的复制功能
async function simpleCopyEntries(side, apiInfo) {
  const $ = getJQuery();
  const adapter = getActiveTransferAdapter();
  if (adapter.id === 'worldbook') {
    try {
      await copyWorldbookEntries(side, apiInfo);
    } catch (error) {
      console.error('复制失败:', error);
      alert('复制失败: ' + error.message);
    }
    return;
  }

  const selectedEntries = getSelectedEntries(side);
  const presetName = getPresetNameForSide(side);

  if (selectedEntries.length === 0) {
    alert('请选择要复制的条目');
    return;
  }

  if (!presetName) {
    alert('无法确定目标预设');
    return;
  }

  try {
    const presetData = getPresetDataFromManager(apiInfo, presetName);
    if (!presetData.prompts) presetData.prompts = [];

    const characterPromptOrder = getOrCreateDummyCharacterPromptOrder(presetData);
    const orderMap = new Map(characterPromptOrder.order.map((o, i) => [o.identifier, i]));

    // 为每个选中的条目创建副本并插入到原条目下方
    // 按照order中的位置倒序处理，避免索引偏移问题
    const sortedEntries = selectedEntries
      .map(entry => ({
        entry,
        orderIndex: orderMap.get(entry.identifier),
      }))
      .filter(item => item.orderIndex !== undefined)
      .sort((a, b) => b.orderIndex - a.orderIndex); // 倒序排列

    // 处理有order位置的条目
    for (const { entry, orderIndex } of sortedEntries) {
      const copyEntry = {
        ...entry,
        identifier: generateIdentifier(),
        name: entry.name + '副本',
      };

      // 添加到prompts数组
      presetData.prompts.push(copyEntry);

      // 插入到原条目下方
      characterPromptOrder.order.splice(orderIndex + 1, 0, {
        identifier: copyEntry.identifier,
        enabled: true,
      });
    }

    // 处理没有order位置的条目（添加到末尾）
    for (const entry of selectedEntries) {
      if (orderMap.get(entry.identifier) === undefined) {
        const copyEntry = {
          ...entry,
          identifier: generateIdentifier(),
          name: entry.name + '副本',
        };

        presetData.prompts.push(copyEntry);
        characterPromptOrder.order.push({
          identifier: copyEntry.identifier,
          enabled: true,
        });
      }
    }

    await apiInfo.presetManager.savePreset(presetName, presetData);
    console.log(`成功复制 ${selectedEntries.length} 个条目`);

    // 刷新界面
    loadAndDisplayEntries(apiInfo);
  } catch (error) {
    console.error('复制失败:', error);
    alert('复制失败: ' + error.message);
  }
}

// 简化的移动功能
function startMoveMode(side, apiInfo) {
  const $ = getJQuery();
  const selectedEntries = getSelectedEntries(side);
  const presetName = getPresetNameForSide(side);

  if (selectedEntries.length === 0) {
    alert('请选择要移动的条目');
    return;
  }

  if (!presetName) {
    alert('无法确定预设');
    return;
  }

  // 设置移动模式
  window.moveMode = {
    apiInfo: apiInfo,
    side: side,
    presetName: presetName,
    selectedEntries: selectedEntries,
  };

  // 更新UI提示
  alert(
    `移动模式已激活！请点击${
      side === 'single' ? '预设' : side === 'left' ? '左侧' : '右侧'
    }面板中的条目来选择插入位置。`,
  );

  // 高亮目标面板
  $(`#${side}-side, #${side}-container`).addClass('move-target');
}

// 内部共享的移动逻辑，与 UI 模式解耦
async function applyMoveToPosition(apiInfo, presetName, selectedEntries, targetIdentifier, targetIndex) {
  const presetData = getPresetDataFromManager(apiInfo, presetName);
  if (!presetData.prompts) presetData.prompts = [];

  const characterPromptOrder = getOrCreateDummyCharacterPromptOrder(presetData);

  // 移除选中条目的 order 条目
  const selectedIdentifiers = new Set(selectedEntries.map(e => e.identifier));
  characterPromptOrder.order = characterPromptOrder.order.filter(o => !selectedIdentifiers.has(o.identifier));

  // 确定插入位置
  let insertIndex;
  if (targetIndex === 'top') {
    insertIndex = 0; // 顶部
  } else if (targetIndex === 'bottom') {
    insertIndex = characterPromptOrder.order.length; // 底部
  } else {
    // 找到目标条目真实所在位置
    const targetOrderIndex = characterPromptOrder.order.findIndex(o => o.identifier === targetIdentifier);
    insertIndex = targetOrderIndex >= 0 ? targetOrderIndex + 1 : characterPromptOrder.order.length;
  }

  // 插入选中条目到目标位置
  const newOrderEntries = selectedEntries.map(entry => ({
    identifier: entry.identifier,
    enabled: true,
  }));

  characterPromptOrder.order.splice(insertIndex, 0, ...newOrderEntries);

  await apiInfo.presetManager.savePreset(presetName, presetData);
  console.log(
    `成功移动 ${selectedEntries.length} 个条目到${
      targetIndex === 'top' ? '顶部' : targetIndex === 'bottom' ? '底部' : '指定位置'
    }`,
  );

  // 刷新界面
  loadAndDisplayEntries(apiInfo);
}

// 供“移动模式”（点击选位置）使用，保留 moveMode / UI 状态处理
async function executeMoveToPosition(apiInfo, side, targetIdentifier, targetIndex) {
  const $ = getJQuery();
  let selectedEntries;
  let presetName;

  // 如果是从移动模式调用，使用 moveMode 的数据；否则直接获取
  if (window.moveMode) {
    selectedEntries = window.moveMode.selectedEntries;
    presetName = window.moveMode.presetName;
  } else {
    selectedEntries = getSelectedEntries(side);
    presetName = getPresetNameForSide(side);
  }

  try {
    await applyMoveToPosition(apiInfo, presetName, selectedEntries, targetIdentifier, targetIndex);
  } catch (error) {
    console.error('移动失败:', error);
    alert('移动失败: ' + error.message);
  } finally {
    // 重置移动模式
    window.moveMode = null;
    $('.move-target').removeClass('move-target');
  }
}

// 供拖拽系统直接调用：不使用 moveMode，不改 UI 状态
async function executeMoveToPositionWithEntries(
  apiInfo,
  side,
  presetName,
  selectedEntries,
  targetIdentifier,
  targetIndex,
) {
  try {
    if (!presetName) {
      console.warn('executeMoveToPositionWithEntries: missing presetName, skip move.');
      return;
    }
    if (!Array.isArray(selectedEntries) || selectedEntries.length === 0) {
      console.warn('executeMoveToPositionWithEntries: no entries to move.');
      return;
    }

    await applyMoveToPosition(apiInfo, presetName, selectedEntries, targetIdentifier, targetIndex);
  } catch (error) {
    console.error('移动失败:', error);
    if (window.toastr) {
      toastr.error('移动失败: ' + error.message);
    } else {
      alert('移动失败: ' + error.message);
    }
  }
}

export {
  generateCopyName,
  generateIdentifier,
  simpleCopyEntries,
  startMoveMode,
  executeMoveToPosition,
  executeMoveToPositionWithEntries,
};
