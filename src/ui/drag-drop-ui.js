import { getJQuery, getParentWindow, getDeviceInfo } from '../core/utils.js';

// Map side -> container element (entries list)
const listContainers = new Map();

let dragPreviewEl = null;
let currentDropIndicator = null; // { side, position, referenceElement }

/**
 * Register the scrollable list container for a given side.
 * Should be called once after the modal is created.
 */
function registerListContainer(side, element) {
  if (!element) return;
  listContainers.set(side, element);
}

function getListContainer(side) {
  return listContainers.get(side) || null;
}

/**
 * Add a visual mark on all source items that are part of the current drag.
 * This class is used both for styling and to exclude them from hit-testing.
 */
function markDragSources(side, identifiers) {
  const $ = getJQuery();
  const container = getListContainer(side);
  if (!$ || !container) return;

  const $container = $(container);
  $container.find('.entry-item').removeClass('pt-drag-source');

  if (!Array.isArray(identifiers) || identifiers.length === 0) return;

  const idSet = new Set(identifiers.filter(Boolean));
  $container
    .find('.entry-item')
    .each(function () {
      const $item = $(this);
      const id = $item.data('identifier');
      if (id && idSet.has(id)) {
        $item.addClass('pt-drag-source');
      }
    });
}

function clearDragSources() {
  const $ = getJQuery();
  if (!$) return;
  $('.entry-item.pt-drag-source').removeClass('pt-drag-source');
}

/**
 * Create a floating preview card that follows the pointer.
 */
function createDragPreview(sourceElement, count, clientX, clientY) {
  clearDragPreview();

  const parentWindow = getParentWindow();
  const doc = parentWindow.document;
  const isMobile = getDeviceInfo().isMobile;

  const preview = doc.createElement('div');
  preview.id = 'pt-drag-preview';
  preview.style.position = 'fixed';
  preview.style.zIndex = '99999';
  preview.style.pointerEvents = 'none';
  preview.style.transform = 'translate(-50%, -50%)';
  preview.style.minWidth = isMobile ? '120px' : '160px';
  preview.style.maxWidth = isMobile ? '200px' : '240px';
  preview.style.padding = isMobile ? '6px 8px' : '8px 10px';
  preview.style.borderRadius = '10px';
  preview.style.boxShadow = '0 12px 30px rgba(0, 0, 0, 0.4)';
  preview.style.fontSize = isMobile ? '11px' : '12px';
  preview.style.lineHeight = '1.3';
  preview.style.opacity = '0.96';
  preview.style.display = 'flex';
  preview.style.alignItems = 'center';
  preview.style.gap = '6px';
  preview.style.backdropFilter = 'blur(10px)';
  preview.style.WebkitBackdropFilter = 'blur(10px)';

  // Try to follow the current theme colors
  let bgColor = 'rgba(17, 24, 39, 0.92)';
  let textColor = '#f9fafb';
  let accentColor = '#6366f1';

  try {
    const sourceStyle = parentWindow.getComputedStyle(sourceElement);
    if (sourceStyle && sourceStyle.backgroundColor) {
      bgColor = sourceStyle.backgroundColor;
    }
    if (sourceStyle && sourceStyle.color) {
      textColor = sourceStyle.color;
    }

    const modalEl = doc.getElementById('preset-transfer-modal');
    if (modalEl) {
      const modalStyle = parentWindow.getComputedStyle(modalEl);
      const accent = modalStyle.getPropertyValue('--pt-accent-color');
      const bodyColor = modalStyle.getPropertyValue('--pt-body-color');
      if (accent && accent.trim()) {
        accentColor = accent.trim();
      }
      if (bodyColor && bodyColor.trim()) {
        textColor = bodyColor.trim();
      }
    }
  } catch {
    // Fallback to defaults above
  }

  preview.style.background = bgColor;
  preview.style.color = textColor;
  preview.style.border = `1px solid ${accentColor}`;

  const nameEl = sourceElement.querySelector('.entry-name');
  const title = nameEl ? nameEl.textContent.trim() : 'Entry';

  // Build a small accent dot + text + optional count badge
  const dot = doc.createElement('span');
  dot.style.display = 'inline-block';
  dot.style.width = '8px';
  dot.style.height = '8px';
  dot.style.borderRadius = '999px';
  dot.style.background = accentColor;

  const text = doc.createElement('span');
  text.style.flex = '1';
  text.style.whiteSpace = 'nowrap';
  text.style.overflow = 'hidden';
  text.style.textOverflow = 'ellipsis';
  text.textContent = title;

  preview.appendChild(dot);
  preview.appendChild(text);

  if (count > 1) {
    const badge = doc.createElement('span');
    badge.style.fontSize = isMobile ? '10px' : '11px';
    badge.style.opacity = '0.85';
    badge.textContent = `+${count - 1}`;
    preview.appendChild(badge);
  }

  doc.body.appendChild(preview);
  dragPreviewEl = preview;
  moveDragPreview(clientX, clientY);
}

function moveDragPreview(clientX, clientY) {
  if (!dragPreviewEl) return;
  dragPreviewEl.style.left = `${clientX}px`;
  dragPreviewEl.style.top = `${clientY}px`;
}

function clearDragPreview() {
  if (dragPreviewEl && dragPreviewEl.parentNode) {
    dragPreviewEl.parentNode.removeChild(dragPreviewEl);
  }
  dragPreviewEl = null;
}

/**
 * Hit-test all known list containers and compute a logical drop target.
 * Returns null if the pointer is not over any list.
 *
 * The returned object has shape:
 * { side, position: 'top'|'bottom'|'after', referenceElement }
 */
function hitTestDropTarget(clientX, clientY) {
  const $ = getJQuery();
  if (!$) return null;

  const sides = ['left', 'right', 'single'];

  for (const side of sides) {
    const container = getListContainer(side);
    if (!container) continue;

    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;

    const $container = $(container);

    // Real entry items only (skip top/bottom position items and current drag sources)
    const items = $container
      .find('.entry-item')
      .not('.position-item')
      .not('.pt-drag-source')
      .toArray();

    if (!items.length) {
      // Empty list: treat as bottom insert
      return {
        side,
        position: 'bottom',
        referenceElement: null,
      };
    }

    // Pointer is inside this list; determine position relative to items.
    for (let i = 0; i < items.length; i++) {
      const el = items[i];
      const itemRect = el.getBoundingClientRect();
      if (clientY >= itemRect.top && clientY <= itemRect.bottom) {
        const offset = clientY - itemRect.top;
        const half = itemRect.height / 2;

        if (offset < half) {
          // Top half：如果是第一条，则视为顶部；否则插入到前一条之后
          if (i === 0) {
            return {
              side,
              position: 'top',
              referenceElement: el,
            };
          }
          const prev = items[i - 1];
          return {
            side,
            position: 'after',
            referenceElement: prev,
          };
        }

        // Bottom half：插入到当前条目之后
        return {
          side,
          position: 'after',
          referenceElement: el,
        };
      }
    }

    // 不在任何条目矩形内部，落在第一个条目上方或最后一个条目下方
    const first = items[0];
    const last = items[items.length - 1];
    const firstRect = first.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();

    if (clientY < firstRect.top) {
      return {
        side,
        position: 'top',
        referenceElement: first,
      };
    }

    if (clientY > lastRect.bottom) {
      return {
        side,
        position: 'bottom',
        referenceElement: last,
      };
    }
  }

  return null;
}

/**
 * Update visual indicator for the current drop position.
 */
function updateDropIndicator(target) {
  const $ = getJQuery();
  if (!$) return;

  // Clear previous indicator
  if (currentDropIndicator && currentDropIndicator.referenceElement) {
    $(currentDropIndicator.referenceElement).removeClass(
      'pt-drop-target pt-drop-target-top pt-drop-target-after pt-drop-target-bottom',
    );
  }

  currentDropIndicator = null;

  if (!target || !target.side) {
    return;
  }

  const refEl = target.referenceElement;
  if (!refEl) {
    return;
  }

  const $ref = $(refEl);
  let positionClass = 'pt-drop-target-after';

  if (target.position === 'top') {
    positionClass = 'pt-drop-target-top';
  } else if (target.position === 'bottom') {
    positionClass = 'pt-drop-target-bottom';
  }

  $ref.addClass('pt-drop-target').addClass(positionClass);

  currentDropIndicator = target;
}

function clearDropIndicator() {
  updateDropIndicator(null);
}

export {
  registerListContainer,
  getListContainer,
  markDragSources,
  clearDragSources,
  createDragPreview,
  moveDragPreview,
  clearDragPreview,
  hitTestDropTarget,
  updateDropIndicator,
  clearDropIndicator,
};
