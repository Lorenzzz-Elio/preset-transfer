import { getJQuery, getParentWindow } from '../core/utils.js';
import * as DragDropCore from '../features/drag-drop-core.js';
import * as DragDropUI from '../ui/drag-drop-ui.js';

let activeDragContext = null;
let autoScrollTimer = null;
let longPressTimer = null;
let lastPointerX = 0;
let lastPointerY = 0;

function clearTimers() {
  if (autoScrollTimer) {
    clearInterval(autoScrollTimer);
    autoScrollTimer = null;
  }
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function stopAutoScroll() {
  if (autoScrollTimer) {
    clearInterval(autoScrollTimer);
    autoScrollTimer = null;
  }
}

function updateAutoScroll(hit) {
  const $ = getJQuery();
  if (!hit || !hit.side) {
    stopAutoScroll();
    return;
  }

  const container = DragDropUI.getListContainer(hit.side);
  if (!container) {
    stopAutoScroll();
    return;
  }

  const edgeZone = 40;

  if (!autoScrollTimer) {
    autoScrollTimer = setInterval(() => {
      const currentContainer = DragDropUI.getListContainer(hit.side);
      if (!currentContainer) {
        stopAutoScroll();
        return;
      }

      const rect = currentContainer.getBoundingClientRect();
      if (rect.height <= 0) {
        stopAutoScroll();
        return;
      }

      let direction = 0;
      if (lastPointerY < rect.top + edgeZone) {
        direction = -1;
      } else if (lastPointerY > rect.bottom - edgeZone) {
        direction = 1;
      }

      if (!direction) {
        stopAutoScroll();
        return;
      }

      const distance = direction === -1 ? rect.top + edgeZone - lastPointerY : lastPointerY - (rect.bottom - edgeZone);

      const ratio = Math.min(1, Math.max(0.1, Math.abs(distance) / edgeZone));
      const minSpeed = 4;
      const maxSpeed = 20;
      const delta = minSpeed + (maxSpeed - minSpeed) * ratio;

      currentContainer.scrollTop += direction * delta;

      // Re-run hit test so the drop indicator stays in sync while auto-scrolling.
      const newHit = DragDropUI.hitTestDropTarget(lastPointerX, lastPointerY);
      DragDropCore.updateDropTarget(newHit);
      DragDropUI.updateDropIndicator(newHit);
    }, 16);
  }
}

function cancelPendingDrag(parentDoc) {
  const $doc = parentDoc ? parentDoc : getParentWindow().document;
  const $ = getJQuery();

  clearTimers();
  DragDropCore.cancelDrag();
  DragDropUI.clearDropIndicator();
  DragDropUI.clearDragSources();

  if ($) {
    $('#preset-transfer-modal').removeClass('pt-dragging');
    $($doc).off('.presetTransferDrag');
  }

  activeDragContext = null;
}

function initDragDrop(apiInfo) {
  const $ = getJQuery();
  if (!$) return;

  const parentWindow = getParentWindow();
  const parentDoc = parentWindow.document;

  // Register list containers for hit-testing and auto-scroll.
  ['left', 'right', 'single'].forEach(side => {
    const list = $(`#${side}-entries-list`);
    if (list.length) {
      DragDropUI.registerListContainer(side, list[0]);
    }
  });

  const entriesContainer = $('#entries-container');
  if (!entriesContainer.length) return;

  function startDrag() {
    if (!activeDragContext || activeDragContext.started) return;

    activeDragContext.started = true;
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }

    const { apiInfo: ctxApiInfo, side, itemElement } = activeDragContext;
    const result = DragDropCore.beginDragFromItem({
      apiInfo: ctxApiInfo,
      side,
      itemElement,
    });

    if (!result || !result.dragEntries || result.dragEntries.length === 0) {
      cancelPendingDrag(parentDoc);
      return;
    }

    $('#preset-transfer-modal').addClass('pt-dragging');
    DragDropUI.createDragPreview(itemElement, result.dragEntries.length, lastPointerX, lastPointerY);
    // 震动反馈
    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
  }

  function onPointerMove(e) {
    if (!activeDragContext) return;
    if (e.pointerId != null && e.pointerId !== activeDragContext.pointerId) {
      return;
    }

    lastPointerX = e.clientX;
    lastPointerY = e.clientY;

    const dx = e.clientX - activeDragContext.startX;
    const dy = e.clientY - activeDragContext.startY;
    const distSq = dx * dx + dy * dy;

    const MOVE_THRESHOLD = 4 * 4;

    if (!activeDragContext.started) {
      if (distSq > MOVE_THRESHOLD) {
        // 如果移动超过阈值，且尚未开始拖拽（长按未触发），则认为是滚动操作，取消拖拽等待
        if (activeDragContext.isTouch) {
          cancelPendingDrag(parentDoc);
          return;
        } else {
          // 鼠标直接拖拽
          startDrag();
        }
      } else {
        return;
      }
    }

    // While dragging, prevent default to avoid accidental text selection / scrolling.
    if (e.cancelable) {
      e.preventDefault();
    }

    DragDropUI.moveDragPreview(e.clientX, e.clientY);

    const hit = DragDropUI.hitTestDropTarget(e.clientX, e.clientY);
    DragDropCore.updateDropTarget(hit);
    DragDropUI.updateDropIndicator(hit);
    updateAutoScroll(hit);
  }

  async function onPointerUp(e) {
    if (!activeDragContext) return;
    if (e.pointerId != null && e.pointerId !== activeDragContext.pointerId) {
      return;
    }

    const $parentDoc = $(parentDoc);
    $parentDoc.off('pointermove.presetTransferDrag pointerup.presetTransferDrag pointercancel.presetTransferDrag');

    clearTimers();

    const wasStarted = activeDragContext.started;
    activeDragContext = null;

    if (!wasStarted) {
      DragDropCore.cancelDrag();
      DragDropUI.clearDropIndicator();
      DragDropUI.clearDragSources();
      DragDropUI.clearDragPreview();
      return;
    }

    e.preventDefault();

    try {
      await DragDropCore.commitDrag();
    } finally {
      $('#preset-transfer-modal').removeClass('pt-dragging');
      DragDropUI.clearDropIndicator();
      DragDropUI.clearDragSources();
      DragDropUI.clearDragPreview();
    }
  }

  entriesContainer.off('pointerdown.presetTransferDrag').on('pointerdown.presetTransferDrag', '.entry-item', e => {
    const $target = $(e.target);

    // Ignore checkboxes and the "create here" button; they have their own interactions.
    if ($target.is('.entry-checkbox') || $target.is('.create-here-btn')) {
      return;
    }

    const $item = $(e.currentTarget);

    // Skip placeholder position items.
    if ($item.hasClass('position-item')) {
      return;
    }

    const side = $item.data('side');
    if (!side) {
      return;
    }

    // Only handle primary mouse button, touch, or pen.
    if (e.button != null && e.button !== 0 && e.pointerType !== 'touch' && e.pointerType !== 'pen') {
      return;
    }

    lastPointerX = e.clientX;
    lastPointerY = e.clientY;

    const isTouch = e.pointerType === 'touch' || e.pointerType === 'pen';

    activeDragContext = {
      apiInfo,
      side,
      itemElement: e.currentTarget,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
      isTouch,
    };

    if (isTouch) {
      // 移动端长按触发
      longPressTimer = setTimeout(() => {
        if (activeDragContext && !activeDragContext.started) {
          startDrag();
        }
      }, 500);
    }

    const $parentDoc = $(parentDoc);
    $parentDoc
      .off('pointermove.presetTransferDrag pointerup.presetTransferDrag pointercancel.presetTransferDrag')
      .on('pointermove.presetTransferDrag', onPointerMove)
      .on('pointerup.presetTransferDrag pointercancel.presetTransferDrag', onPointerUp);
  });
}

export { initDragDrop };
