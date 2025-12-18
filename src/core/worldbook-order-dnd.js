const DRAG_THRESHOLD_PX = 4;
const LONG_PRESS_MS = 500;
const DRAGGING_CLASS = 'pt-dragging';
const GROUP_TOKEN_PREFIX = 'g:';
const ITEM_TOKEN_PREFIX = 'w:';

function isPrimaryPointerDown(e) {
  if (!e) return false;
  if (e.isPrimary === false) return false;

  // Mouse: primary button only. Touch/Pen: button may be -1/undefined.
  if (e.pointerType !== 'touch' && e.pointerType !== 'pen') {
    if (e.button != null && e.button !== 0) return false;
  }

  return true;
}

function decodeGroupKey(encoded) {
  const raw = String(encoded ?? '').trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function getMidY(el) {
  const rect = el.getBoundingClientRect();
  return rect.top + rect.height / 2;
}

function closestWithin(el, selector, rootEl) {
  if (!el) return null;
  const found = el.closest?.(selector) ?? null;
  if (!found) return null;
  if (!rootEl) return found;
  return rootEl.contains(found) ? found : null;
}

function isDragHandle(targetEl, rootEl) {
  return Boolean(closestWithin(targetEl, '.pt-wb-drag-handle', rootEl));
}

function isTouchPointer(e) {
  return e?.pointerType === 'touch' || e?.pointerType === 'pen';
}

function createPlaceholderFromRect(doc, rect) {
  const ph = doc.createElement('div');
  ph.className = 'pt-wb-drag-placeholder';
  ph.style.height = `${Math.max(8, rect.height)}px`;
  ph.style.width = `${Math.max(40, rect.width)}px`;
  return ph;
}

function prepareDragGhost(el, rect, offsetX, offsetY) {
  el.classList.add('pt-wb-drag-ghost');
  el.style.position = 'fixed';
  el.style.boxSizing = 'border-box';
  el.style.width = `${rect.width}px`;
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.zIndex = '2147483647';
  el.style.pointerEvents = 'none';

  return (clientX, clientY) => {
    el.style.left = `${clientX - offsetX}px`;
    el.style.top = `${clientY - offsetY}px`;
  };
}

function getBucketContainer(rootEl, bucketId) {
  void bucketId;
  return rootEl.querySelector('#preset-list') || rootEl;
}

function getTopLevelBlocksInBucket(containerEl, bucketId, excludeEl) {
  if (!containerEl || !bucketId) return [];
  const blocks = [];
  for (const el of Array.from(containerEl.children || [])) {
    if (!el || el === excludeEl) continue;
    if (String(el.getAttribute?.('data-pt-bucket') ?? '').trim() !== bucketId) continue;
    if (el.classList?.contains?.('pt-wb-subgroup') || el.classList?.contains?.('pt-wb-item')) blocks.push(el);
  }
  return blocks;
}

function readDomBucketOrder(rootEl, bucketId) {
  const container = getBucketContainer(rootEl, bucketId);
  const blocks = getTopLevelBlocksInBucket(container, bucketId, null);
  const order = [];
  const seen = new Set();
  for (const el of blocks) {
    if (el.classList?.contains?.('pt-wb-subgroup')) {
      const name = decodeGroupKey(el.getAttribute('data-pt-sub'));
      const token = name ? `${GROUP_TOKEN_PREFIX}${name}` : '';
      if (!token || seen.has(token)) continue;
      seen.add(token);
      order.push(token);
      continue;
    }

    if (el.classList?.contains?.('pt-wb-item')) {
      const name = String(el.getAttribute('data-pt-name') ?? '').trim();
      const token = name ? `${ITEM_TOKEN_PREFIX}${name}` : '';
      if (!token || seen.has(token)) continue;
      seen.add(token);
      order.push(token);
    }
  }
  return order;
}

function readDomItemOrder(containerEl) {
  if (!containerEl) return [];
  return Array.from(containerEl.querySelectorAll('.pt-wb-item'))
    .map((el) => String(el.getAttribute('data-pt-name') ?? '').trim())
    .filter(Boolean);
}

function findDragSourceFromPointerDown({ rootEl, targetEl }) {
  // Never start a drag from buttons (group menus, etc).
  if (closestWithin(targetEl, 'button', rootEl)) return null;

  // Drag handles: work for both items and groups.
  if (isDragHandle(targetEl, rootEl)) {
    const itemEl = closestWithin(targetEl, '.pt-wb-item', rootEl);
    if (itemEl) return { type: 'item', sourceEl: itemEl };

    const groupEl = closestWithin(targetEl, '.pt-wb-subgroup', rootEl);
    if (groupEl) return { type: 'group', sourceEl: groupEl };
  }

  const itemEl = closestWithin(targetEl, '.pt-wb-item', rootEl);
  if (itemEl) {
    // Don't treat checkbox interactions as drag.
    if (targetEl?.matches?.('input[type="checkbox"]') || closestWithin(targetEl, 'input[type="checkbox"]', itemEl)) {
      return null;
    }

    return { type: 'item', sourceEl: itemEl };
  }

  // Allow dragging groups by their header area (click still toggles collapse).
  const groupHeaderEl = closestWithin(targetEl, '.pt-wb-subgroup-header', rootEl);
  if (!groupHeaderEl) return null;

  const groupEl = closestWithin(groupHeaderEl, '.pt-wb-subgroup', rootEl);
  if (!groupEl) return null;

  return { type: 'group', sourceEl: groupEl };
}

function getBucketIdForSource(sourceEl) {
  if (!sourceEl) return '';
  return (
    String(sourceEl.getAttribute?.('data-pt-bucket') ?? '').trim() ||
    String(sourceEl.closest?.('[data-pt-bucket]')?.getAttribute?.('data-pt-bucket') ?? '').trim()
  );
}

function getGroupNameForItem(itemEl) {
  const groupEl = itemEl?.closest?.('.pt-wb-subgroup');
  if (!groupEl) return '';
  const raw = decodeGroupKey(groupEl.getAttribute?.('data-pt-sub'));
  return raw && raw !== '__ungrouped__' ? raw : '';
}

export function bindWorldbookBatchOrderDnd({
  rootEl,
  isSearchActive,
  onBucketOrderChange,
  onGroupOrderChange,
  onGroupItemOrderChange,
}) {
  if (!rootEl) return;
  if (typeof rootEl.__ptWorldbookOrderDndCleanup === 'function') return;

  const doc = rootEl.ownerDocument || document;
  const win = doc.defaultView || window;

  const onBucketOrderChangeSafe =
    typeof onBucketOrderChange === 'function' ? onBucketOrderChange : typeof onGroupOrderChange === 'function' ? onGroupOrderChange : null;
  const onGroupItemOrderChangeSafe = typeof onGroupItemOrderChange === 'function' ? onGroupItemOrderChange : null;

  let active = null;
  let longPressTimer = null;
  let safetyTimer = null;
  let clickSuppressorRemove = null;
  let clickSuppressorTimeout = null;

  const clearLongPressTimer = () => {
    if (!longPressTimer) return;
    clearTimeout(longPressTimer);
    longPressTimer = null;
  };

  const clearSafetyTimer = () => {
    if (!safetyTimer) return;
    clearTimeout(safetyTimer);
    safetyTimer = null;
  };

  const clearClickSuppressor = () => {
    if (clickSuppressorRemove) clickSuppressorRemove();
    clickSuppressorRemove = null;

    if (clickSuppressorTimeout) {
      clearTimeout(clickSuppressorTimeout);
      clickSuppressorTimeout = null;
    }
  };

  const installOneShotClickSuppressor = () => {
    if (clickSuppressorRemove) return;

    const handler = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      clearClickSuppressor();
    };

    doc.addEventListener('click', handler, true);
    clickSuppressorRemove = () => doc.removeEventListener('click', handler, true);

    clickSuppressorTimeout = setTimeout(() => {
      clearClickSuppressor();
    }, 1200);
  };

  const removeDocListeners = () => {
    doc.removeEventListener('pointermove', onPointerMove, true);
    doc.removeEventListener('pointerup', onPointerUp, true);
    doc.removeEventListener('pointercancel', onPointerCancel, true);
    win.removeEventListener('blur', onBlur, true);
    doc.removeEventListener('visibilitychange', onVisibilityChange, true);

    clearLongPressTimer();
    clearSafetyTimer();
  };

  const addDocListeners = () => {
    doc.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
    doc.addEventListener('pointerup', onPointerUp, { capture: true, passive: false });
    doc.addEventListener('pointercancel', onPointerCancel, { capture: true, passive: false });
    win.addEventListener('blur', onBlur, { capture: true, passive: true });
    doc.addEventListener('visibilitychange', onVisibilityChange, { capture: true, passive: true });
  };

  const cleanupDragDom = ({ ctx, commit }) => {
    if (!ctx) return;

    try {
      ctx.sourceEl?.classList?.remove?.('pt-wb-drag-source-hidden');
    } catch {
      // ignore
    }

    try {
      ctx.ghostEl?.remove?.();
    } catch {
      // ignore
    }

    try {
      if (commit && ctx.placeholderEl && ctx.sourceEl) {
        ctx.placeholderEl.replaceWith(ctx.sourceEl);
      } else {
        ctx.placeholderEl?.remove?.();
      }
    } catch {
      // ignore
    }
  };

  const startDrag = (pointerEvent) => {
    const ctx = active;
    if (!ctx || ctx.started) return;

    const { sourceEl } = ctx;
    if (!sourceEl?.isConnected) {
      finish({ commit: false });
      return;
    }

    ctx.started = true;
    clearLongPressTimer();
    clearSafetyTimer();
    installOneShotClickSuppressor();

    try {
      sourceEl?.setPointerCapture?.(pointerEvent.pointerId);
    } catch {
      // ignore
    }

    try {
      rootEl.classList.add(DRAGGING_CLASS);
    } catch {
      // ignore
    }

    // Absolute last-resort: ensure we never leave a drag ghost stuck forever.
    safetyTimer = setTimeout(() => {
      if (!active || !active.started) return;
      finish({ commit: false });
    }, 12000);

    const rect = sourceEl.getBoundingClientRect();
    const offsetX = pointerEvent.clientX - rect.left;
    const offsetY = pointerEvent.clientY - rect.top;

    ctx.placeholderEl = createPlaceholderFromRect(doc, rect);
    try {
      sourceEl.parentNode?.insertBefore(ctx.placeholderEl, sourceEl.nextSibling);
    } catch {
      // ignore
    }

    const ghostEl = sourceEl.cloneNode(true);
    doc.body.appendChild(ghostEl);
    ctx.ghostEl = ghostEl;
    ctx.moveGhost = prepareDragGhost(ghostEl, rect, offsetX, offsetY);

    sourceEl.classList.add('pt-wb-drag-source-hidden');
    ctx.moveGhost(pointerEvent.clientX, pointerEvent.clientY);
  };

  const updateGroupPlaceholder = (pointerEvent) => {
    const ctx = active;
    if (!ctx?.placeholderEl) return;
    const bucketId = ctx.bucketId;
    if (!bucketId) return;

    const container = ctx.containerEl;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const inside =
      pointerEvent.clientX >= rect.left &&
      pointerEvent.clientX <= rect.right &&
      pointerEvent.clientY >= rect.top &&
      pointerEvent.clientY <= rect.bottom;
    if (!inside) return;

    const blocks = getTopLevelBlocksInBucket(container, bucketId, ctx.sourceEl);

    const before = blocks.find((el) => pointerEvent.clientY < getMidY(el)) || null;
    if (before) {
      container.insertBefore(ctx.placeholderEl, before);
      return;
    }

    container.appendChild(ctx.placeholderEl);
  };

  const updateItemPlaceholder = (pointerEvent) => {
    const ctx = active;
    if (!ctx?.placeholderEl) return;
    const container = ctx.containerEl;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const inside =
      pointerEvent.clientX >= rect.left &&
      pointerEvent.clientX <= rect.right &&
      pointerEvent.clientY >= rect.top &&
      pointerEvent.clientY <= rect.bottom;
    if (!inside) return;

    const siblings = ctx.isBucketRootContainer
      ? getTopLevelBlocksInBucket(container, ctx.bucketId, ctx.sourceEl)
      : Array.from(container.querySelectorAll('.pt-wb-item')).filter((el) => el && el !== ctx.sourceEl);
    const before = siblings.find((el) => pointerEvent.clientY < getMidY(el)) || null;
    if (before) {
      container.insertBefore(ctx.placeholderEl, before);
      return;
    }

    container.appendChild(ctx.placeholderEl);
  };

  const commitDrag = (ctx) => {
    if (!ctx?.started) return;

    if (ctx.type === 'group' || (ctx.type === 'item' && ctx.isBucketRootContainer)) {
      const order = readDomBucketOrder(rootEl, ctx.bucketId);
      onBucketOrderChangeSafe?.({ bucketId: ctx.bucketId, order });
      return;
    }

    const order = readDomItemOrder(ctx.containerEl);
    if (ctx.groupName) {
      onGroupItemOrderChangeSafe?.({ bucketId: ctx.bucketId, groupName: ctx.groupName, itemOrder: order });
    }
  };

  const finish = ({ commit }) => {
    const ctx = active;
    active = null;
    removeDocListeners();

    if (!ctx) return;

    cleanupDragDom({ ctx, commit });

    try {
      rootEl.classList.remove(DRAGGING_CLASS);
    } catch {
      // ignore
    }

    if (!ctx.started) return;

    if (commit) commitDrag(ctx);
  };

  function onBlur() {
    finish({ commit: false });
  }

  function onVisibilityChange() {
    if (doc.hidden) finish({ commit: false });
  }

  const onPointerMove = (e) => {
    if (!active) return;
    if (e.pointerId != null && e.pointerId !== active.pointerId) return;
    if (!rootEl.isConnected) {
      finish({ commit: false });
      return;
    }

    const dx = e.clientX - active.startX;
    const dy = e.clientY - active.startY;
    const movedEnough = dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;

    if (!active.started) {
      if (!movedEnough) return;

      // Touch scrolling: if the user moves without long-pressing, treat it as scroll.
      // Exception: if the pointer started from an explicit drag handle, always allow drag.
      if (active.isTouch && !active.fromHandle) {
        finish({ commit: false });
        return;
      }

      startDrag(e);
      if (!active?.started) return;
    }

    if (e.cancelable) e.preventDefault();
    active.moveGhost?.(e.clientX, e.clientY);

    if (active.type === 'group') updateGroupPlaceholder(e);
    else updateItemPlaceholder(e);
  };

  function onPointerUp(e) {
    if (!active) return;
    if (e.pointerId != null && e.pointerId !== active.pointerId) return;

    if (active.started && e.cancelable) e.preventDefault();
    finish({ commit: !!active.started });
  }

  function onPointerCancel(e) {
    if (!active) return;
    if (e.pointerId != null && e.pointerId !== active.pointerId) return;
    finish({ commit: false });
  }

  const onPointerDown = (e) => {
    if (active) return;
    if (!isPrimaryPointerDown(e)) return;
    if (typeof isSearchActive === 'function' && isSearchActive()) return;

    const found = findDragSourceFromPointerDown({ rootEl, targetEl: e.target });
    if (!found) return;

    const { type, sourceEl } = found;
    const bucketId = getBucketIdForSource(sourceEl);
    if (!bucketId) return;

    const fromHandle = isDragHandle(e.target, rootEl);
    const isTouch = isTouchPointer(e);
    const bucketRootEl = getBucketContainer(rootEl, bucketId);
    const containerEl =
      type === 'group' ? bucketRootEl : sourceEl.closest('.pt-wb-subgroup-body') || sourceEl.parentElement || bucketRootEl;

    active = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      isTouch,
      fromHandle,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
      type,
      bucketId,
      groupName: type === 'item' ? getGroupNameForItem(sourceEl) : '',
      bucketRootEl,
      containerEl,
      isBucketRootContainer: containerEl === bucketRootEl,
      sourceEl,
      placeholderEl: null,
      ghostEl: null,
      moveGhost: null,
    };

    addDocListeners();

    if (fromHandle && e.cancelable) e.preventDefault();

    if (active.isTouch) {
      if (!fromHandle) {
        longPressTimer = setTimeout(() => {
          if (!active || active.started) return;
          startDrag(e);
        }, LONG_PRESS_MS);
      }
    }
  };

  const cleanupAll = () => {
    finish({ commit: false });
    clearClickSuppressor();
    rootEl.removeEventListener('pointerdown', onPointerDown, true);

    try {
      rootEl.classList.remove(DRAGGING_CLASS);
    } catch {
      // ignore
    }

    // Best-effort cleanup for any leftover ghosts/placeholders.
    try {
      doc.querySelectorAll('.pt-wb-drag-ghost, .pt-wb-drag-placeholder').forEach((el) => el.remove());
    } catch {
      // ignore
    }

    delete rootEl.__ptWorldbookOrderDndCleanup;
  };

  rootEl.__ptWorldbookOrderDndCleanup = cleanupAll;
  rootEl.addEventListener('pointerdown', onPointerDown, true);
}

export function unbindWorldbookBatchOrderDnd(rootEl) {
  if (!rootEl) return;
  rootEl.__ptWorldbookOrderDndCleanup?.();
}
