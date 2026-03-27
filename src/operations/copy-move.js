import { getJQuery } from '../core/utils.js';
import { getPresetDataFromManager } from '../preset/preset-manager.js';
import { assignNewStitchMeta } from '../preset/stitch-meta.js';
import { getOrCreateDummyCharacterPromptOrder } from '../preset/prompt-order-utils.js';
import { getSelectedEntries, loadAndDisplayEntries } from '../display/entry-display.js';
import { getPresetNameForSide } from '../batch/batch-modifications.js';
import { getActiveTransferAdapter } from '../transfer/transfer-context.js';
import { getPresetGroupingIdForIdentifier, reassignPresetGroupingMembers } from '../features/entry-grouping.js';
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
async function duplicatePresetEntries(apiInfo, presetName, sourceEntries, options = {}) {
  const { refreshDisplay = true } = options;

  if (!apiInfo?.presetManager) {
    throw new Error('Preset manager is not available.');
  }

  if (!presetName) {
    throw new Error('Preset name is required.');
  }

  const normalizedEntries = Array.isArray(sourceEntries)
    ? sourceEntries.filter((entry) => entry?.identifier)
    : [];

  if (normalizedEntries.length === 0) {
    throw new Error('No valid entries were provided for duplication.');
  }

  const presetData = getPresetDataFromManager(apiInfo, presetName);
  if (!presetData.prompts) presetData.prompts = [];

  const characterPromptOrder = getOrCreateDummyCharacterPromptOrder(presetData);
  const orderedIdentifiersBeforeCopy = characterPromptOrder.order
    .map((item) => String(item?.identifier ?? '').trim())
    .filter(Boolean);
  const orderMap = new Map(characterPromptOrder.order.map((item, index) => [item.identifier, index]));
  const copiedEntries = [];
  const copiedIdentifiersByGroup = new Map();

  const recordCopiedIdentifierGroup = (sourceIdentifier, copiedIdentifier) => {
    const sourceGroupId = getPresetGroupingIdForIdentifier(
      presetName,
      sourceIdentifier,
      orderedIdentifiersBeforeCopy,
    );
    if (!sourceGroupId || !copiedIdentifier) return;

    if (!copiedIdentifiersByGroup.has(sourceGroupId)) {
      copiedIdentifiersByGroup.set(sourceGroupId, []);
    }

    copiedIdentifiersByGroup.get(sourceGroupId).push(copiedIdentifier);
  };

  const appendCopiedEntry = (entry, insertIndex = null) => {
    const copiedEntry = assignNewStitchMeta({
      ...entry,
      identifier: generateIdentifier(),
      name: generateCopyName(entry.name),
    });

    presetData.prompts.push(copiedEntry);

    if (typeof insertIndex === 'number' && insertIndex >= 0) {
      characterPromptOrder.order.splice(insertIndex + 1, 0, {
        identifier: copiedEntry.identifier,
        enabled: true,
      });
    } else {
      characterPromptOrder.order.push({
        identifier: copiedEntry.identifier,
        enabled: true,
      });
    }

    recordCopiedIdentifierGroup(entry.identifier, copiedEntry.identifier);
    copiedEntries.push(copiedEntry);
  };

  const orderedEntries = normalizedEntries
    .map((entry) => ({
      entry,
      orderIndex: orderMap.get(entry.identifier),
    }))
    .filter((item) => item.orderIndex !== undefined)
    .sort((a, b) => b.orderIndex - a.orderIndex);

  for (const { entry, orderIndex } of orderedEntries) {
    appendCopiedEntry(entry, orderIndex);
  }

  for (const entry of normalizedEntries) {
    if (orderMap.get(entry.identifier) !== undefined) continue;
    appendCopiedEntry(entry);
  }

  await apiInfo.presetManager.savePreset(presetName, presetData);

  if (copiedIdentifiersByGroup.size > 0) {
    const orderedIdentifiers = characterPromptOrder.order
      .map((item) => String(item?.identifier ?? '').trim())
      .filter(Boolean);

    for (const [targetGroupId, copiedIdentifiers] of copiedIdentifiersByGroup.entries()) {
      await reassignPresetGroupingMembers(presetName, copiedIdentifiers, orderedIdentifiers, {
        targetGroupId,
      });
    }
  }

  if (refreshDisplay) {
    loadAndDisplayEntries(apiInfo);
  }

  return copiedEntries;
}

async function simpleCopyEntries(side, apiInfo) {
  const $ = getJQuery();
  const adapter = getActiveTransferAdapter();
  if (adapter.id === 'worldbook') {
    try {
      await copyWorldbookEntries(side, apiInfo);
    } catch (error) {
      console.error('\u590d\u5236\u5931\u8d25:', error);
      alert('\u590d\u5236\u5931\u8d25: ' + error.message);
    }
    return;
  }

  const selectedEntries = getSelectedEntries(side);
  const presetName = getPresetNameForSide(side);

  if (selectedEntries.length === 0) {
    alert('\u8bf7\u9009\u62e9\u8981\u590d\u5236\u7684\u6761\u76ee');
    return;
  }

  if (!presetName) {
    alert('\u65e0\u6cd5\u786e\u5b9a\u76ee\u6807\u9884\u8bbe');
    return;
  }

  try {
    await duplicatePresetEntries(apiInfo, presetName, selectedEntries);

    console.log(`\u6210\u529f\u590d\u5236 ${selectedEntries.length} \u4e2a\u6761\u76ee`);
  } catch (error) {
    console.error('\u590d\u5236\u5931\u8d25:', error);
    alert('\u590d\u5236\u5931\u8d25: ' + error.message);
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
async function applyMoveToPosition(apiInfo, presetName, selectedEntries, targetIdentifier, targetIndex, options = {}) {
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
  await reassignPresetGroupingMembers(
    presetName,
    selectedEntries.map(entry => entry?.identifier),
    characterPromptOrder.order.map(entry => String(entry?.identifier ?? '').trim()).filter(Boolean),
    {
      targetIdentifier: targetIndex === 'top' || targetIndex === 'bottom' ? null : targetIdentifier,
      targetGroupId: String(options?.targetGroupId ?? '').trim(),
    },
  );
  console.log(
    `成功移动 ${selectedEntries.length} 个条目到${
      targetIndex === 'top' ? '顶部' : targetIndex === 'bottom' ? '底部' : '指定位置'
    }`,
  );

  // 刷新界面
  loadAndDisplayEntries(apiInfo);
}

// 供“移动模式”（点击选位置）使用，保留 moveMode / UI 状态处理
async function executeMoveToPosition(apiInfo, side, targetIdentifier, targetIndex, options = {}) {
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
    await applyMoveToPosition(apiInfo, presetName, selectedEntries, targetIdentifier, targetIndex, options);
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
  options = {},
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

    await applyMoveToPosition(apiInfo, presetName, selectedEntries, targetIdentifier, targetIndex, options);
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
  duplicatePresetEntries,
  simpleCopyEntries,
  startMoveMode,
  executeMoveToPosition,
  executeMoveToPositionWithEntries,
};
