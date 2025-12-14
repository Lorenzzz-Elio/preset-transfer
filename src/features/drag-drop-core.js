import { getJQuery } from '../core/utils.js';
import { getSelectedEntries } from '../display/entry-display.js';
import { getPresetNameForSide } from '../batch/batch-modifications.js';
import { getTargetPromptsList } from '../ui/edit-modal.js';
import { executeTransferToPosition } from '../operations/entry-operations.js';
import { executeMoveToPositionWithEntries } from '../operations/copy-move.js';
import * as DragDropUI from '../ui/drag-drop-ui.js';

// 当前拖拽状态
let dragState = null;

function getEntriesForSide(side) {
  if (side === 'left') {
    return window.leftEntries || [];
  }
  if (side === 'right') {
    return window.rightEntries || [];
  }
  if (side === 'single') {
    return window.singleEntries || [];
  }
  return [];
}

function resolveEntryFromItem(side, $item) {
  const entries = getEntriesForSide(side);
  if (!Array.isArray(entries) || !entries.length) return null;

  const identifier = $item.data('identifier');
  const index = parseInt($item.data('index'), 10);

  if (identifier) {
    const byId = entries.find(e => e.identifier === identifier);
    if (byId) return byId;
  }

  if (!Number.isNaN(index) && index >= 0 && index < entries.length) {
    return entries[index];
  }

  return null;
}

/**
 * 从某个条目开始拖拽。
 * 根据当前勾选状态决定是拖动“全部已勾选”还是仅拖动该条目。
 */
function beginDragFromItem({ apiInfo, side, itemElement }) {
  const $ = getJQuery();
  if (!$ || !itemElement) return null;

  const $item = $(itemElement);
  const checkbox = $item.find('.entry-checkbox');
  const isItemChecked = checkbox.prop('checked');

  const selectedEntries = getSelectedEntries(side);

  let dragEntries = [];

  if (selectedEntries.length > 0 && isItemChecked) {
    // 已经有选中，并且当前条目在选中集合中 -> 拖动所有已选条目
    dragEntries = selectedEntries.slice();
  } else {
    // 否则只拖动当前条目本身（不改变勾选状态）
    const entry = resolveEntryFromItem(side, $item);
    if (!entry) return null;
    dragEntries = [entry];
  }

  if (!dragEntries.length) return null;

  dragState = {
    apiInfo,
    fromSide: side,
    dragEntries,
    dropTarget: null,
  };

  const identifiers = dragEntries.map(e => e.identifier).filter(Boolean);
  DragDropUI.markDragSources(side, identifiers);

  return {
    side,
    dragEntries,
  };
}

function updateDropTarget(target) {
  if (!dragState) return;
  dragState.dropTarget = target && target.side ? target : null;
}

function cancelDrag() {
  dragState = null;
}

function getCurrentState() {
  return dragState;
}

function computeTransferTargetIndex(toSide, target) {
  const $ = getJQuery();
  if (!$ || !target || !target.position) return null;

  if (target.position === 'top') return 'top';
  if (target.position === 'bottom') return 'bottom';

  const refEl = target.referenceElement;
  if (!refEl) return null;

  const $ref = $(refEl);

  const presetName =
    toSide === 'single'
      ? window.singlePresetName
      : toSide === 'left'
      ? $('#left-preset').val()
      : $('#right-preset').val();

  if (!presetName) return null;

  const identifier = $ref.data('identifier');
  const fallbackIndex = parseInt($ref.data('index'), 10);

  const fullList = getTargetPromptsList(presetName, 'include_disabled');
  let realIndex = -1;

  if (identifier && Array.isArray(fullList)) {
    realIndex = fullList.findIndex(e => e.identifier === identifier);
  }

  if (realIndex >= 0) return realIndex;
  if (!Number.isNaN(fallbackIndex) && fallbackIndex >= 0) return fallbackIndex;

  return null;
}

/**
 * 在 pointerup 时提交拖拽结果。
 * 返回 true 表示执行了移动/转移；false 表示无效 drop（例如拖到列表外）。
 */
async function commitDrag() {
  const state = dragState;
  dragState = null;

  if (!state || !state.dropTarget || !state.dropTarget.side) {
    return false;
  }

  const { apiInfo, fromSide, dragEntries } = state;
  const target = state.dropTarget;
  const toSide = target.side;

  // 同侧拖拽 -> 排序
  if (toSide === fromSide) {
    const presetName = getPresetNameForSide(fromSide);
    if (!presetName) return false;

    let targetIdentifier = null;
    let targetIndex = null;

    if (target.position === 'top') {
      targetIndex = 'top';
    } else if (target.position === 'bottom') {
      targetIndex = 'bottom';
    } else {
      const $ = getJQuery();
      const $ref = $(target.referenceElement);
      targetIdentifier = $ref.data('identifier') || null;
      targetIndex = null;
    }

    await executeMoveToPositionWithEntries(
      apiInfo,
      fromSide,
      presetName,
      dragEntries,
      targetIdentifier,
      targetIndex,
    );

    return true;
  }

  // 跨侧拖拽：目前仅支持 left <-> right
  const crossValid =
    (fromSide === 'left' && toSide === 'right') || (fromSide === 'right' && toSide === 'left');

  if (!crossValid) {
    return false;
  }

  const $ = getJQuery();
  const fromPreset = fromSide === 'left' ? $('#left-preset').val() : $('#right-preset').val();
  const toPreset = toSide === 'left' ? $('#left-preset').val() : $('#right-preset').val();

  if (!fromPreset || !toPreset) {
    // 目标预设未选择，视为无效 drop
    return false;
  }

  const positionArg = computeTransferTargetIndex(toSide, target);
  if (positionArg === null) {
    return false;
  }

  // 复用现有 executeTransferToPosition 逻辑，只临时设置 transferMode
  window.transferMode = {
    apiInfo,
    fromSide,
    toSide,
    selectedEntries: dragEntries,
  };

  await executeTransferToPosition(apiInfo, fromSide, toSide, positionArg);

  return true;
}

export { beginDragFromItem, updateDropTarget, cancelDrag, commitDrag, getCurrentState };

