// Native Regex scripts grouping (global scripts list) - UI logic

import { PT } from '../core/api-compat.js';
import { debounce, ensureViewportCssVars, escapeAttr, getJQuery, getParentWindow } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';
import {
  addRegexScriptGroupingFromMembers,
  getAllRegexScriptGroupings,
  getRegexScriptGroupingGroupedIdSet,
  removeRegexScriptGrouping,
  setRegexScriptGroupingMembersBulk,
  updateRegexScriptGrouping,
} from '../features/regex-script-grouping.js';
import {
  bindRegexBulkGroupButton,
  clearRegexBulkSelection,
  ensureRegexBulkGroupButtonInjected,
  getSelectedGlobalRegexIds,
  removeRegexBulkGroupButton,
  unbindRegexBulkGroupButton,
} from './regex-bulk-group-button.js';

const HEADER_CLASS = 'pt-regex-group-header';
const REGEX_GROUP_BUNDLE_TYPE = 'preset_transfer_regex_group_bundle';
const REGEX_GROUP_BUNDLE_FILE_PREFIX = 'pt-regex-group-';

let uiEnabled = false;
let domObserver = null;
let listObserver = null;
let themeObserver = null;
let observedListNode = null;
let applyQueued = false;
let isApplying = false;
let lastAppliedSignature = null;
let lastThemeSignature = null;
let isSorting = false;
let applyAfterSort = false;
let toggleReapplyBound = false;

function findRegexListContainer() {
  const $ = getJQuery();
  return $('#saved_regex_scripts');
}

function findRegexPanelContainer() {
  const $ = getJQuery();
  const panel = $('#regex_container');
  if (panel.length) return panel;
  return $('#extensions_settings, #extensions_settings2').first();
}

function escapeCssId(value) {
  try {
    return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value;
  } catch {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }
}

function ensureRegexGroupingStyles() {
  const $ = getJQuery();
  if ($('#pt-regex-grouping-styles').length) return;
  $('head').append(`
    <style id="pt-regex-grouping-styles">
      .pt-regex-grouping-root .pt-regex-in-group { box-shadow: inset 3px 0 0 var(--pt-accent); }
      .pt-regex-grouping-root .${HEADER_CLASS} {
        user-select: none;
        border: 1px solid var(--pt-border);
        background: var(--pt-section-bg);
        color: var(--pt-text);
      }
      .pt-regex-grouping-root .${HEADER_CLASS} .pt-regex-group-actions { margin-left: auto; gap: 4px; align-items: center; }
      .pt-regex-grouping-root .${HEADER_CLASS} .pt-regex-group-actions .menu_button {
        padding: 2px 6px;
        min-width: 28px;
        line-height: 1;
      }
      .pt-regex-grouping-root .${HEADER_CLASS} .pt-regex-group-actions .menu_button i,
      .pt-regex-grouping-root .${HEADER_CLASS} .pt-regex-group-actions .menu_button span {
        pointer-events: none;
      }
      .pt-regex-grouping-root .${HEADER_CLASS} .pt-regex-group-enable-toggle { margin: 0; }
    </style>
  `);
}

function getOrderedIds($list) {
  return $list
    .children('.regex-script-label')
    .toArray()
    .map((el) => el?.id)
    .filter(Boolean);
}

function cleanupGroupingUi($list) {
  $list.find(`.${HEADER_CLASS}`).remove();
  $list.find('.regex-script-label').each(function () {
    this.classList.remove('pt-regex-in-group');
    this.removeAttribute('data-pt-group-id');
    this.style.removeProperty('display');
  });
  $list.removeClass('pt-regex-grouping-root');
  $list[0]?.style?.removeProperty?.('--pt-accent');
  $list[0]?.style?.removeProperty?.('--pt-danger');
  $list[0]?.style?.removeProperty?.('--pt-border');
  $list[0]?.style?.removeProperty?.('--pt-section-bg');
  $list[0]?.style?.removeProperty?.('--pt-bg');
  $list[0]?.style?.removeProperty?.('--pt-text');
}

function applyThemeVars($list) {
  const vars = CommonStyles.getVars();
  $list.addClass('pt-regex-grouping-root');
  $list[0].style.setProperty('--pt-accent', vars.accentColor);
  $list[0].style.setProperty('--pt-danger', vars.dangerColor);
  $list[0].style.setProperty('--pt-border', vars.borderColor);
  $list[0].style.setProperty('--pt-section-bg', vars.sectionBg);
  $list[0].style.setProperty('--pt-bg', vars.bgColor);
  $list[0].style.setProperty('--pt-text', vars.textColor);
}

function createGroupHeader(group, count, collapsed, { anyDisabled = false } = {}) {
  const name = group?.name || '分组';
  const toggleIcon = collapsed ? 'fa-chevron-right' : 'fa-chevron-down';
  const checkedAttr = anyDisabled ? 'checked' : '';
  return $(`
    <div class="${HEADER_CLASS} flex-container flexnowrap" data-pt-group-id="${escapeAttr(group.id)}" style="
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      margin: 6px 0;
      border-radius: 8px;
    ">
      <span class="drag-handle menu-handle" title="拖动分组">&#9776;</span>
      <span class="pt-regex-group-toggle menu_button" style="padding: 2px 8px;" title="展开/收起">
        <i class="fa-solid ${toggleIcon}"></i>
      </span>
      <span class="pt-regex-group-name flexGrow overflow-hidden" style="font-weight: 600;">${name}</span>
      <span class="pt-regex-group-count" style="opacity: .75; font-size: 12px; white-space: nowrap;">${count}</span>
      <div class="pt-regex-group-actions flex-container flexnowrap">
        <label class="checkbox flex-container pt-regex-group-enable-toggle" title="启用/禁用分组">
          <input type="checkbox" class="disable_regex pt-regex-group-disable" ${checkedAttr} />
          <span class="regex-toggle-on fa-solid fa-toggle-on" title="禁用分组"></span>
          <span class="regex-toggle-off fa-solid fa-toggle-off" title="启用分组"></span>
        </label>
        <div class="pt-regex-group-rename menu_button" title="重命名"><i class="fa-solid fa-pencil"></i></div>
        <div class="pt-regex-group-export menu_button" title="导出分组"><i class="fa-solid fa-file-export"></i></div>
        <div class="pt-regex-group-delete menu_button" title="删除分组并删除组内所有正则"><i class="fa-solid fa-trash"></i></div>
        <div class="pt-regex-group-ungroup menu_button" title="取消分组"><i class="fa-solid fa-xmark"></i></div>
      </div>
    </div>
  `);
}

function computeSignature(orderedIds, groupings) {
  const listKey = Array.isArray(orderedIds) ? orderedIds.join('\u001f') : '';
  const groupingKey = Array.isArray(groupings)
    ? groupings
      .map((g) => [
        g?.id ?? '',
        g?.name ?? '',
        Array.isArray(g?.memberIds) ? g.memberIds.join('\u001a') : '',
        g?.collapsed ? '1' : '0',
        g?.unresolved ? '1' : '0',
      ].join('\u001e'))
      .join('\u001d')
    : '';
  return `${listKey}\u001c${groupingKey}`;
}

function pauseListObserver() {
  try {
    listObserver?.disconnect?.();
  } catch {
    /* ignore */
  }
}

function resumeListObserver() {
  if (!listObserver || !observedListNode) return;
  try {
    listObserver.observe(observedListNode, { childList: true });
  } catch {
    /* ignore */
  }
}

function computeThemeSignature() {
  try {
    const vars = CommonStyles.getVars();
    return [
      vars.accentColor,
      vars.accentMutedColor,
      vars.borderColor,
      vars.sectionBg,
      vars.bgColor,
      vars.textColor,
      vars.tipColor,
      vars.inputBg,
      vars.inputBorder,
      vars.dangerColor,
      vars.fontSize,
      vars.fontSizeSmall,
      vars.fontSizeMedium,
    ]
      .map((x) => String(x ?? ''))
      .join('|');
  } catch {
    return '';
  }
}

function setupThemeObserver() {
  const parentWindow = getParentWindow();
  const ParentObserver = parentWindow && parentWindow !== window ? parentWindow.MutationObserver : null;
  const Observer = ParentObserver || window.MutationObserver;
  if (typeof Observer !== 'function') return;
  if (themeObserver) return;

  const doc = parentWindow.document;
  if (!doc?.documentElement) return;

  lastThemeSignature = computeThemeSignature();

  themeObserver = new Observer(
    debounce(() => {
      if (!uiEnabled) return;
      const next = computeThemeSignature();
      if (!next || next === lastThemeSignature) return;
      lastThemeSignature = next;

      const $list = findRegexListContainer();
      if ($list.length) {
        ensureRegexGroupingStyles();
        applyThemeVars($list);
      }
    }, 120),
  );

  try {
    themeObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  } catch {
    /* ignore */
  }
  try {
    if (doc.body) themeObserver.observe(doc.body, { attributes: true, attributeFilter: ['class', 'style'] });
  } catch {
    /* ignore */
  }
  try {
    if (doc.head) themeObserver.observe(doc.head, { childList: true, subtree: true });
  } catch {
    /* ignore */
  }
}

function teardownThemeObserver() {
  if (!themeObserver) return;
  try {
    themeObserver.disconnect();
  } catch {
    /* ignore */
  }
  themeObserver = null;
  lastThemeSignature = null;
}

function buildGroupingMaps(orderedIds) {
  const groupings = getAllRegexScriptGroupings(orderedIds);
  const membersByGroupId = new Map();
  const idToGroupId = new Map();

  for (const g of groupings) {
    if (g?.unresolved) continue;
    const groupId = String(g?.id ?? '');
    if (!groupId) continue;
    const members = Array.isArray(g?.memberIds) ? g.memberIds.map(String).filter(Boolean) : [];
    if (members.length === 0) continue;
    membersByGroupId.set(groupId, members);
    for (const id of members) idToGroupId.set(String(id), groupId);
  }

  return { membersByGroupId, idToGroupId };
}

function getNeighborGroupIds($item) {
  const $ = getJQuery();
  const $el = $item?.length ? $item : $();
  if (!$el.length) return { prevGroupId: null, nextGroupId: null };

  const $prev = $el.prevAll(`.${HEADER_CLASS}, .regex-script-label`).first();
  const $next = $el.nextAll(`.${HEADER_CLASS}, .regex-script-label`).first();

  const prevGroupId = (() => {
    if (!$prev.length) return null;
    if ($prev.hasClass(HEADER_CLASS)) {
      const id = String($prev.data('pt-group-id') ?? $prev.attr('data-pt-group-id') ?? '');
      return id || null;
    }
    const id = String($prev.attr('data-pt-group-id') ?? '');
    return id || null;
  })();

  const nextGroupId = (() => {
    if (!$next.length) return null;
    if ($next.hasClass(HEADER_CLASS)) return null;
    const id = String($next.attr('data-pt-group-id') ?? '');
    return id || null;
  })();

  return { prevGroupId, nextGroupId };
}

function updateGroupingAfterRegexMove($list, movedId) {
  const $ = getJQuery();
  const id = String(movedId ?? '');
  if (!id) return;

  const $root = $list?.length ? $list : findRegexListContainer();
  if (!$root.length) return;

  const orderedIds = getOrderedIds($root);
  const { membersByGroupId, idToGroupId } = buildGroupingMaps(orderedIds);
  const oldGroupId = idToGroupId.get(id) ?? null;

  const $item = $root.children(`#${escapeCssId(id)}`).first();
  if (!$item.length) return;
  const { prevGroupId, nextGroupId } = getNeighborGroupIds($item);

  const newGroupId =
    prevGroupId && nextGroupId ? (prevGroupId === nextGroupId ? prevGroupId : null) : prevGroupId || nextGroupId || null;

  if (newGroupId === oldGroupId) return;

  const patches = [];

  if (oldGroupId) {
    const set = new Set(membersByGroupId.get(oldGroupId) ?? []);
    set.delete(id);
    patches.push({ id: oldGroupId, memberIds: orderedIds.filter((x) => set.has(String(x))) });
  }

  if (newGroupId) {
    const set = new Set(membersByGroupId.get(newGroupId) ?? []);
    set.add(id);
    patches.push({ id: newGroupId, memberIds: orderedIds.filter((x) => set.has(String(x))) });
  }

  if (patches.length === 0) return;
  void setRegexScriptGroupingMembersBulk(patches);
}

function patchRegexSortableForGrouping($list) {
  try {
    if (!$list?.length) return;
    if (typeof $list.sortable !== 'function') return;

    const handle = '.regex-script-label, .drag-handle';
    $list.sortable('option', 'handle', handle);
    $list.sortable('option', 'items', '> :visible');

    // Undo legacy "cancel header drag" rules, since we now use `handle` to match native regex drag feel.
    const currentCancel = String($list.sortable('option', 'cancel') ?? '').trim();
    if (currentCancel) {
      const parts = currentCancel
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .filter((x) => x !== `.${HEADER_CLASS}` && x !== `.${HEADER_CLASS} *`);
      $list.sortable('option', 'cancel', parts.join(', '));
    }

    const existingStart = $list.sortable('option', 'start');
    if (!existingStart?.__ptRegexGroupingStartWrapped) {
      const wrappedStart = function (event, ui) {
        isSorting = true;
        applyAfterSort = false;
        pauseListObserver();
        try {
          const $ = getJQuery();
          const $item = ui?.item;
          const el = $item?.get?.(0);
          if (el?.classList?.contains?.(HEADER_CLASS)) {
            const groupId = String($item.data('pt-group-id') ?? '');
            const orderedIds = getOrderedIds($list);
            const memberIds = getGroupMemberIds(groupId, orderedIds);

            const memberEls = memberIds
              .map((id) => $list.children(`#${escapeCssId(id)}`).first()[0])
              .filter(Boolean);
            const $members = $(memberEls);

            $item.data('__ptGroupDragMembers', $members);
            try {
              const detached = Object.create(null);
              $list
                .children('.regex-script-label[data-pt-group-id]')
                .each(function () {
                  if (this.style.display !== 'none') return;
                  const id = String($(this).data('pt-group-id') ?? '');
                  if (!id || id === groupId) return;
                  (detached[id] || (detached[id] = [])).push(this);
                });

              const ids = Object.keys(detached);
              if (ids.length) {
                for (const id of ids) {
                  const $nodes = $(detached[id]);
                  $nodes.detach();
                  detached[id] = $nodes;
                }
                $item.data('__ptDetachedCollapsedMembers', detached);
              }
            } catch {
              /* ignore */
            }

            let height = 0;
            try {
              const parentWindow = getParentWindow();
              const styleWindow = parentWindow && parentWindow !== window ? parentWindow : window;

              const headerRect = el.getBoundingClientRect();
              const headerStyle = styleWindow.getComputedStyle(el);
              const headerMarginTop = parseFloat(headerStyle.marginTop) || 0;
              const headerMarginBottom = parseFloat(headerStyle.marginBottom) || 0;

              height = headerRect.height + headerMarginTop + headerMarginBottom;

              const visibleMembers = memberEls.filter((node) => {
                try {
                  const rect = node.getBoundingClientRect();
                  if (!(rect.width || rect.height)) return false;
                  return styleWindow.getComputedStyle(node).display !== 'none';
                } catch {
                  return false;
                }
              });

              if (visibleMembers.length > 0) {
                const lastEl = visibleMembers[visibleMembers.length - 1];
                const lastRect = lastEl.getBoundingClientRect();
                const lastStyle = styleWindow.getComputedStyle(lastEl);
                const lastMarginBottom = parseFloat(lastStyle.marginBottom) || 0;
                height = (lastRect.bottom - headerRect.top) + headerMarginTop + lastMarginBottom;
              }
            } catch {
              const headerHeight =
                typeof $item.outerHeight === 'function'
                  ? $item.outerHeight(true)
                  : el.getBoundingClientRect().height;
              const membersHeight = memberEls.reduce((sum, node) => {
                try {
                  const h = typeof $(node).outerHeight === 'function' ? $(node).outerHeight(true) : 0;
                  return sum + Number(h ?? node?.getBoundingClientRect?.().height ?? 0);
                } catch {
                  return sum;
                }
              }, 0);
              height = Math.max(0, Number(headerHeight ?? 0) + Number(membersHeight ?? 0));
            }

            $members.detach();
            try {
              ui?.placeholder?.height?.(Math.max(0, Number(height ?? 0)));
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* ignore */
        }

        if (typeof existingStart === 'function') {
          return existingStart.call(this, event, ui);
        }
      };

      wrappedStart.__ptRegexGroupingStartWrapped = true;
      wrappedStart.__ptOriginalStart = existingStart;
      $list.sortable('option', 'start', wrappedStart);
    }

    const existingStop = $list.sortable('option', 'stop');
    if (!existingStop?.__ptRegexGroupingStopWrapped) {
      const wrappedStop = function (event, ui) {
        const finalize = () => {
          isSorting = false;
          resumeListObserver();
          applyAfterSort = false;
          queueApplyGrouping();
        };

        try {
          const $ = getJQuery();
          const $item = ui?.item;
          const el = $item?.get?.(0);

           if (el?.classList?.contains?.(HEADER_CLASS)) {
            try {
              const detached = $item.data('__ptDetachedCollapsedMembers');
              if (detached && typeof detached === 'object') {
                $list
                  .children(`.${HEADER_CLASS}`)
                  .each(function () {
                    const id = String($(this).data('pt-group-id') ?? '');
                    const $nodes = detached[id];
                    if ($nodes?.length) {
                      $(this).after($nodes);
                      delete detached[id];
                    }
                  });

                for (const id in detached) {
                  const $nodes = detached[id];
                  if ($nodes?.length) {
                    $list.append($nodes);
                  }
                }
              }
              $item?.removeData?.('__ptDetachedCollapsedMembers');
            } catch {
              /* ignore */
            }

            const $members = $item.data('__ptGroupDragMembers');
            if ($members?.length) {
              $item.after($members);
            }
            $item?.removeData?.('__ptGroupDragMembers');
          } else if (el?.classList?.contains?.('regex-script-label')) {
            const movedId = String($item.attr('id') ?? '');
            updateGroupingAfterRegexMove($list, movedId);
          }
        } catch {
          /* ignore */
        }

        if (typeof existingStop === 'function') {
          try {
            const result = existingStop.call(this, event, ui);
            if (result && typeof result.finally === 'function') {
              result.finally(finalize);
              return result;
            }
          } catch {
            /* ignore */
          }
        }

        finalize();
      };

      wrappedStop.__ptRegexGroupingStopWrapped = true;
      wrappedStop.__ptOriginalStop = existingStop;
      $list.sortable('option', 'stop', wrappedStop);
    }
  } catch {
    /* ignore */
  }
}

function applyGroupingToList() {
  if (!uiEnabled) return;
  if (isApplying) return;
  if (isSorting) return;
  const $ = getJQuery();
  const $list = findRegexListContainer();
  if (!$list.length) return;

  isApplying = true;
  try {
    const orderedIds = getOrderedIds($list);
    const groupings = getAllRegexScriptGroupings(orderedIds);
    const signature = computeSignature(orderedIds, groupings);

    ensureRegexGroupingStyles();
    applyThemeVars($list);

    patchRegexSortableForGrouping($list);

    const expectedGroupCount = groupings.filter((g) => !g.unresolved && Array.isArray(g.memberIds) && g.memberIds.length > 0).length;
    const currentHeaderCount = $list.children(`.${HEADER_CLASS}`).length;

    if (signature === lastAppliedSignature && (expectedGroupCount === 0 || currentHeaderCount >= expectedGroupCount)) {
      updateExistingGroupHeaderCounts($list, groupings);
      return;
    }

    pauseListObserver();
    cleanupGroupingUi($list);
    applyThemeVars($list);

    const resolvedGroupings = groupings
      .filter((g) => !g.unresolved && Array.isArray(g.memberIds) && g.memberIds.length > 0)
      .sort((a, b) => (a.anchorIndex ?? 1e9) - (b.anchorIndex ?? 1e9));

    for (const g of resolvedGroupings) {
      const memberIds = g.memberIds.map(String).filter(Boolean);
      const firstId = memberIds[0];
      const $first = $list.children(`#${escapeCssId(firstId)}`).first();
      if (!$first.length) continue;

      const collapsed = !!g.collapsed;
      const $header = createGroupHeader(g, String(memberIds.length), collapsed);
      $first.before($header);

      let enabledCount = 0;
      let headerMarkedDisabled = false;
      for (const id of memberIds) {
        const $row = $list.children(`#${escapeCssId(id)}`).first();
        if (!$row.length) continue;
        $row.attr('data-pt-group-id', g.id);
        $row.addClass('pt-regex-in-group');

        let rowDisabled = false;
        try {
          rowDisabled = !!$row.find('input.disable_regex').first().prop('checked');
        } catch {
          /* ignore */
        }

        if (!rowDisabled) enabledCount += 1;

        if (!headerMarkedDisabled && rowDisabled) {
          headerMarkedDisabled = true;
          $header.find('.pt-regex-group-disable').prop('checked', true);
        }

        if (collapsed) {
          $row[0].style.display = 'none';
        }
      }

      try {
        $header.find('.pt-regex-group-count').text(`(${enabledCount}/${memberIds.length})`);
      } catch {
        /* ignore */
      }
    }

    lastAppliedSignature = signature;
  } finally {
    resumeListObserver();
    isApplying = false;
  }
}

function updateExistingGroupHeaderCounts($list, groupings) {
  const $ = getJQuery();
  const $root = $list?.length ? $list : findRegexListContainer();
  if (!$root.length) return;

  const headersById = new Map();
  $root.children(`.${HEADER_CLASS}`).each(function () {
    const groupId = String($(this).data('pt-group-id') ?? '');
    if (groupId) headersById.set(groupId, $(this));
  });
  if (headersById.size === 0) return;

  const resolved = Array.isArray(groupings)
    ? groupings.filter((g) => !g?.unresolved && Array.isArray(g?.memberIds) && g.memberIds.length > 0)
    : [];

  for (const g of resolved) {
    const groupId = String(g?.id ?? '');
    if (!groupId) continue;
    const $header = headersById.get(groupId);
    if (!$header?.length) continue;

    const memberIds = g.memberIds.map(String).filter(Boolean);
    if (memberIds.length === 0) continue;

    let enabledCount = 0;
    let anyDisabled = false;

    for (const id of memberIds) {
      const $row = $root.children(`#${escapeCssId(id)}`).first();
      if (!$row.length) continue;

      let rowDisabled = false;
      try {
        rowDisabled = !!$row.find('input.disable_regex').first().prop('checked');
      } catch {
        /* ignore */
      }

      if (!rowDisabled) enabledCount += 1;
      else anyDisabled = true;
    }

    try {
      $header.find('.pt-regex-group-count').text(`(${enabledCount}/${memberIds.length})`);
    } catch {
      /* ignore */
    }
    try {
      $header.find('.pt-regex-group-disable').prop('checked', anyDisabled);
    } catch {
      /* ignore */
    }
  }
}

function queueApplyGrouping() {
  if (!uiEnabled) return;
  if (isSorting) {
    applyAfterSort = true;
    return;
  }
  if (applyQueued) return;
  applyQueued = true;
  Promise.resolve().then(() => {
    applyQueued = false;
    applyGroupingToList();
    installRegexGroupImportInterceptor();
  });
}

function showInputDialog(title, defaultValue, callback) {
  const $ = getJQuery();
  const vars = CommonStyles.getVars();
  ensureViewportCssVars();

  const dialog = $(`
    <div class="pt-regex-grouping-input-dialog" style="
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; height: 100dvh; height: calc(var(--pt-vh, 1vh) * 100);
      background: rgba(0,0,0,0.5); z-index: 10005;
      display: flex; align-items: center; justify-content: center;
      padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom);">
      <div style="
        background: ${vars.bgColor}; padding: 20px; border-radius: 12px;
        min-width: min(320px, 90vw); box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <div style="font-weight: 600; margin-bottom: 12px; white-space: nowrap;">${title}</div>
        <input type="text" class="dialog-input" value="${String(defaultValue ?? '').replace(/\"/g, '&quot;')}" style="
          width: 100%; padding: 8px; border: 1px solid ${vars.borderColor};
          border-radius: 6px; background: ${vars.inputBg}; color: ${vars.textColor};
          margin-bottom: 12px;">
        <div style="display: flex; flex-direction: row; gap: 8px; justify-content: flex-end;">
          <button class="dialog-cancel menu_button" style="padding: 6px 16px; white-space: nowrap;">取消</button>
          <button class="dialog-confirm menu_button" style="padding: 6px 16px; white-space: nowrap;">确定</button>
        </div>
      </div>
    </div>
  `);

  const panelContainer = findRegexPanelContainer();
  (panelContainer.length ? panelContainer : $('body')).append(dialog);

  dialog.on('pointerdown mousedown click', (e) => e.stopPropagation());
  dialog.children().first().on('pointerdown mousedown click', (e) => e.stopPropagation());
  dialog.find('.dialog-input').focus().select();

  const closeDialog = (shouldCallback) => {
    const value = String(dialog.find('.dialog-input').val() ?? '');
    dialog.remove();
    if (shouldCallback) callback(value);
  };

  dialog.find('.dialog-confirm').on('click', () => closeDialog(true));
  dialog.find('.dialog-cancel').on('click', () => closeDialog(false));
  dialog.find('.dialog-input').on('keypress', (e) => {
    if (e.key === 'Enter') closeDialog(true);
  });
}

function showConfirmDialog(title, body, callback, options = {}) {
  const $ = getJQuery();
  const vars = CommonStyles.getVars();
  ensureViewportCssVars();

  const okText = String(options?.okText ?? '确定');
  const cancelText = String(options?.cancelText ?? '取消');

  const dialog = $(`
    <div class="pt-regex-grouping-confirm-dialog" style="
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; height: 100dvh; height: calc(var(--pt-vh, 1vh) * 100);
      background: rgba(0,0,0,0.5); z-index: 10005;
      display: flex; align-items: center; justify-content: center;
      padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom);">
      <div style="
        background: ${vars.bgColor}; padding: 20px; border-radius: 12px;
        min-width: min(360px, 90vw); box-shadow: 0 4px 20px rgba(0,0,0,0.3); color: ${vars.textColor};">
        <div style="font-weight: 700; margin-bottom: 10px;">${title}</div>
        <div style="opacity: .9; margin-bottom: 14px;">${body}</div>
        <div style="display: flex; flex-direction: row; gap: 8px; justify-content: flex-end;">
          <button class="dialog-cancel menu_button" style="padding: 6px 16px; white-space: nowrap;">${cancelText}</button>
          <button class="dialog-confirm menu_button" style="padding: 6px 16px; white-space: nowrap;">${okText}</button>
        </div>
      </div>
    </div>
  `);

  const panelContainer = findRegexPanelContainer();
  (panelContainer.length ? panelContainer : $('body')).append(dialog);

  dialog.on('pointerdown mousedown click', (e) => e.stopPropagation());
  dialog.children().first().on('pointerdown mousedown click', (e) => e.stopPropagation());

  const closeDialog = (value) => {
    dialog.remove();
    callback(!!value);
  };

  dialog.find('.dialog-confirm').on('click', () => closeDialog(true));
  dialog.find('.dialog-cancel').on('click', () => closeDialog(false));
}

function getGroupMemberIds(groupId, orderedIds) {
  const id = String(groupId ?? '');
  if (!id) return [];
  const groupings = getAllRegexScriptGroupings(orderedIds);
  const g = groupings.find((x) => x?.id === id && !x?.unresolved);
  if (!g) return [];

  if (Array.isArray(g.memberIds) && g.memberIds.length) {
    return g.memberIds.map(String).filter(Boolean);
  }

  return [];
}

function findNativeRegexImportInput() {
  const parentWindow = getParentWindow();
  const doc = parentWindow?.document ?? document;
  return doc?.querySelector?.('#import_regex_file') ?? null;
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = (e) => resolve(String(e?.target?.result ?? ''));
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    } catch (e) {
      reject(e);
    }
  });
}

function createUuid() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function importRegexGroupBundleFile(file) {
  const fileName = String(file?.name ?? '');
  if (!fileName) return false;

  let bundle = null;
  try {
    bundle = JSON.parse(await readFileAsText(file));
  } catch (e) {
    console.warn('[RegexGrouping] invalid JSON:', e);
    if (window.toastr) toastr.error('正则组文件解析失败（JSON 无效）');
    return false;
  }

  if (!bundle || typeof bundle !== 'object' || bundle.type !== REGEX_GROUP_BUNDLE_TYPE) {
    if (window.toastr) toastr.error('不是有效的 Preset Transfer 正则组文件');
    return false;
  }

  const regexes = Array.isArray(bundle.regexes) ? bundle.regexes : [];
  if (regexes.length === 0) {
    if (window.toastr) toastr.warning('正则组文件为空');
    return false;
  }

  const groupNameRaw = String(bundle?.group?.name ?? bundle?.metadata?.groupName ?? '分组');
  const groupName = groupNameRaw.trim() || '分组';
  const collapsed = !!bundle?.group?.collapsed;

  const memberIdsRaw = Array.isArray(bundle?.grouping?.memberIds)
    ? bundle.grouping.memberIds.map(String).filter(Boolean)
    : regexes.map((r) => String(r?.id ?? '')).filter(Boolean);

  const idMap = new Map();
  const importedRegexes = regexes.map((r) => {
    const oldId = String(r?.id ?? '');
    const newId = createUuid();
    if (oldId) idMap.set(oldId, newId);
    return { ...r, id: newId };
  });

  try {
    await PT.API.updateTavernRegexesWith((existing) => {
      const list = Array.isArray(existing) ? existing : [];
      return [...list, ...importedRegexes];
    });
  } catch (e) {
    console.warn('[RegexGrouping] import regexes failed:', e);
    if (window.toastr) toastr.error('导入正则失败');
    return false;
  }

  const mappedMemberIds =
    memberIdsRaw.length > 0
      ? memberIdsRaw.map((id) => idMap.get(String(id)) || '').filter(Boolean)
      : importedRegexes.map((r) => String(r?.id ?? '')).filter(Boolean);
  if (mappedMemberIds.length > 0) {
    const ok = await addRegexScriptGroupingFromMembers(mappedMemberIds, groupName, { collapsed });
    if (!ok) {
      if (window.toastr) toastr.warning('正则已导入，但创建分组失败（可能与已有分组冲突）');
      return true;
    }
  }

  if (window.toastr) toastr.success('正则组已导入');
  return true;
}

function installRegexGroupImportInterceptor() {
  const input = findNativeRegexImportInput();
  if (!input || input.__ptRegexGroupImportBound) return;
  input.__ptRegexGroupImportBound = true;

  input.addEventListener(
    'change',
    (e) => {
      const files = Array.from(input.files || []);
      if (files.length === 0) return;

      const shouldIntercept = files.every((f) =>
        String(f?.name ?? '')
          .toLowerCase()
          .startsWith(REGEX_GROUP_BUNDLE_FILE_PREFIX),
      );

      if (!shouldIntercept) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();

      (async () => {
        for (const file of files) {
          await importRegexGroupBundleFile(file);
        }
        try {
          input.value = '';
        } catch {
          /* ignore */
        }
      })();
    },
    true,
  );
}

function isMemberSelectionContiguous(memberIds, orderedIds) {
  const indices = memberIds
    .map((id) => orderedIds.indexOf(String(id)))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b);

  if (indices.length !== memberIds.length) return null;
  if (indices.length <= 1) return true;

  return indices[indices.length - 1] - indices[0] + 1 === indices.length;
}

async function moveSelectedRegexScriptsTogether(memberIds) {
  const selectedSet = new Set(memberIds.map(String));
  if (selectedSet.size === 0) return;

  await PT.API.updateTavernRegexesWith((regexes) => {
    const list = Array.isArray(regexes) ? regexes : [];
    if (list.length === 0) return list;

    const selected = [];
    const others = [];
    let firstSelectedIndex = -1;

    for (let i = 0; i < list.length; i++) {
      const script = list[i];
      const id = String(script?.id ?? '');
      const isSelected = id && selectedSet.has(id);

      if (isSelected) {
        if (firstSelectedIndex === -1) firstSelectedIndex = i;
        selected.push(script);
      } else {
        others.push(script);
      }
    }

    if (selected.length === 0) return list;
    const insertAt = firstSelectedIndex < 0 ? 0 : Math.min(firstSelectedIndex, others.length);
    return [...others.slice(0, insertAt), ...selected, ...others.slice(insertAt)];
  });
}

async function handleBulkGroupButtonClick() {
  const $list = findRegexListContainer();
  if (!$list.length) return;

  const memberIds = getSelectedGlobalRegexIds();
  if (memberIds.length === 0) {
    if (window.toastr) toastr.warning('请先在 Bulk Edit 中勾选要分组的正则');
    return;
  }

  const orderedIds = getOrderedIds($list);
  const grouped = getRegexScriptGroupingGroupedIdSet(orderedIds);
  const hasOverlap = memberIds.some((id) => grouped.has(String(id)));
  if (hasOverlap) {
    if (window.toastr) toastr.warning('选中的正则包含已分组项，请先取消分组后再创建新分组');
    return;
  }

  showInputDialog('创建分组', '分组', async (groupNameRaw) => {
    const groupName = String(groupNameRaw ?? '').trim();
    if (!groupName) {
      if (window.toastr) toastr.warning('分组名称不能为空');
      return;
    }

    const createGroup = async () => {
      const ok = await addRegexScriptGroupingFromMembers(memberIds, groupName, { collapsed: true });
      if (!ok) {
        if (window.toastr) toastr.error('创建分组失败：所选正则可能与已有分组冲突');
        return false;
      }
      if (window.toastr) toastr.success('分组已创建');
      queueApplyGrouping();
      clearRegexBulkSelection();
      return true;
    };

    const contiguous = isMemberSelectionContiguous(memberIds, orderedIds);
    if (contiguous === null) {
      if (window.toastr) toastr.error('无法定位所选正则，请刷新后重试');
      return;
    }

    if (contiguous) {
      await createGroup();
      return;
    }

    try {
      await moveSelectedRegexScriptsTogether(memberIds);
    } catch (e) {
      console.warn('[RegexGrouping] move selected scripts failed:', e);
      if (window.toastr) toastr.error('移动所选正则失败');
      return;
    }
    await createGroup();

  });
}

async function exportGroupScripts(groupId) {
  const $ = getJQuery();
  const $list = findRegexListContainer();
  if (!$list.length) return;

  const orderedIds = getOrderedIds($list);
  const groupings = getAllRegexScriptGroupings(orderedIds);
  const g = groupings.find((x) => x?.id === groupId && !x?.unresolved && Array.isArray(x?.memberIds));
  if (!g?.memberIds?.length) return;

  const ids = g.memberIds.map(String).filter(Boolean);
  const all = PT.API.getTavernRegexes({ scope: 'global', enable_state: 'all' }) || [];
  const byId = new Map(all.map((r) => [String(r?.id ?? ''), r]));
  const scripts = ids.map((id) => byId.get(id)).filter(Boolean);
  if (scripts.length === 0) return;

  const safeName = String(g.name || 'group')
    .trim()
    .replace(/[\s.<>:\"/\\|?*\x00-\x1F\x7F]/g, '_')
    .slice(0, 80);

  const fileName = `pt-regex-group-${safeName || 'group'}.json`;
  const bundle = {
    type: 'preset_transfer_regex_group_bundle',
    version: 1,
    metadata: {
      exportTime: new Date().toISOString(),
      groupName: String(g?.name ?? ''),
      regexCount: scripts.length,
    },
    group: {
      name: String(g?.name ?? ''),
      collapsed: !!g?.collapsed,
    },
    grouping: {
      memberIds: ids.slice(),
    },
    regexes: scripts,
  };
  const fileData = JSON.stringify(bundle, null, 2);

  if (typeof download === 'function') {
    download(fileData, fileName, 'application/json');
    return;
  }

  const blob = new Blob([fileData], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function installHeaderEvents() {
  const $ = getJQuery();
  const $list = findRegexListContainer();
  if (!$list.length) return;

  $list.off('click.pt-regex-group-header');

  const setGroupDisabled = async (groupId, disabled) => {
    const orderedIds = getOrderedIds($list);
    const memberIds = getGroupMemberIds(groupId, orderedIds);
    if (memberIds.length === 0) return;

    const memberSet = new Set(memberIds.map(String));

    try {
      const current = PT.API.getTavernRegexes({ scope: 'global', enable_state: 'all' }) || [];
      const needsChange = current.some((r) => memberSet.has(String(r?.id ?? '')) && !!r?.disabled !== disabled);
      if (!needsChange) return;
    } catch {
      /* ignore */
    }

    try {
      await PT.API.updateTavernRegexesWith((regexes) => {
        const list = Array.isArray(regexes) ? regexes : [];
        for (const r of list) {
          if (!memberSet.has(String(r?.id ?? ''))) continue;
          r.disabled = disabled;
          r.enabled = !disabled;
        }
        return list;
      });
    } catch (err) {
      console.warn('[RegexGrouping] set group enable failed:', err);
    }
  };

  $list.on(
    'click.pt-regex-group-header',
    `.${HEADER_CLASS} .pt-regex-group-toggle, .${HEADER_CLASS} .pt-regex-group-name, .${HEADER_CLASS} .pt-regex-group-count`,
    async function (e) {
      e.preventDefault();
      e.stopPropagation();
      const $header = $(this).closest(`.${HEADER_CLASS}`);
      const groupId = String($header.data('pt-group-id') ?? '');
      if (!groupId) return;
      const orderedIds = getOrderedIds($list);
      const groupings = getAllRegexScriptGroupings(orderedIds);
      const g = groupings.find((x) => x?.id === groupId);
      const nextCollapsed = !(g?.collapsed ?? false);
      await updateRegexScriptGrouping(groupId, { collapsed: nextCollapsed });
      queueApplyGrouping();
    },
  );

  $list.on(
    'click.pt-regex-group-header',
    `.${HEADER_CLASS} .pt-regex-group-enable-toggle .regex-toggle-on`,
    async function (e) {
      e.preventDefault();
      e.stopPropagation();
      const $header = $(this).closest(`.${HEADER_CLASS}`);
      const groupId = String($header.data('pt-group-id') ?? '');
      if (!groupId) return;

      await setGroupDisabled(groupId, true);
      try {
        $header.find('.pt-regex-group-disable').prop('checked', true);
      } catch {
        /* ignore */
      }
      queueApplyGrouping();
      setTimeout(queueApplyGrouping, 120);
    },
  );

  $list.on(
    'click.pt-regex-group-header',
    `.${HEADER_CLASS} .pt-regex-group-enable-toggle .regex-toggle-off`,
    async function (e) {
      e.preventDefault();
      e.stopPropagation();
      const $header = $(this).closest(`.${HEADER_CLASS}`);
      const groupId = String($header.data('pt-group-id') ?? '');
      if (!groupId) return;

      await setGroupDisabled(groupId, false);
      try {
        $header.find('.pt-regex-group-disable').prop('checked', false);
      } catch {
        /* ignore */
      }
      queueApplyGrouping();
      setTimeout(queueApplyGrouping, 120);
    },
  );

  $list.on('click.pt-regex-group-header', `.${HEADER_CLASS} .pt-regex-group-rename`, async function (e) {
    e.preventDefault();
    e.stopPropagation();
    const $header = $(this).closest(`.${HEADER_CLASS}`);
    const groupId = String($header.data('pt-group-id') ?? '');
    if (!groupId) return;

    const orderedIds = getOrderedIds($list);
    const groupings = getAllRegexScriptGroupings(orderedIds);
    const g = groupings.find((x) => x?.id === groupId);
    showInputDialog('重命名分组', g?.name || '分组', async (newName) => {
      await updateRegexScriptGrouping(groupId, { name: newName });
      queueApplyGrouping();
    });
  });

  $list.on('click.pt-regex-group-header', `.${HEADER_CLASS} .pt-regex-group-delete`, async function (e) {
    e.preventDefault();
    e.stopPropagation();
    const $header = $(this).closest(`.${HEADER_CLASS}`);
    const groupId = String($header.data('pt-group-id') ?? '');
    if (!groupId) return;
    const name = String($header.find('.pt-regex-group-name').text() ?? '分组');
    showConfirmDialog('删除分组', `确定要删除分组“${name}”并删除组内所有正则吗？`, async (ok) => {
      if (!ok) return;

      const orderedIds = getOrderedIds($list);
      const memberIds = getGroupMemberIds(groupId, orderedIds);
      const memberSet = new Set(memberIds.map(String));

      try {
        await PT.API.updateTavernRegexesWith((regexes) => {
          const list = Array.isArray(regexes) ? regexes : [];
          return list.filter((r) => !memberSet.has(String(r?.id ?? '')));
        });
      } catch (err) {
        console.warn('[RegexGrouping] delete group scripts failed:', err);
      }

      await removeRegexScriptGrouping(groupId);
      queueApplyGrouping();
      if (window.toastr) toastr.success('已删除分组及其所有正则');
    }, { okText: '删除' });
  });

  $list.on('click.pt-regex-group-header', `.${HEADER_CLASS} .pt-regex-group-ungroup`, async function (e) {
    e.preventDefault();
    e.stopPropagation();
    const $header = $(this).closest(`.${HEADER_CLASS}`);
    const groupId = String($header.data('pt-group-id') ?? '');
    if (!groupId) return;

    await removeRegexScriptGrouping(groupId);
    queueApplyGrouping();
    if (window.toastr) toastr.info('已取消分组');
  });

  $list.on('click.pt-regex-group-header', `.${HEADER_CLASS} .pt-regex-group-export`, async function (e) {
    e.preventDefault();
    e.stopPropagation();
    const $header = $(this).closest(`.${HEADER_CLASS}`);
    const groupId = String($header.data('pt-group-id') ?? '');
    if (!groupId) return;
    await exportGroupScripts(groupId);
  });
}

function setupListObserver() {
  const $list = findRegexListContainer();
  if (!$list.length) return;

  if (listObserver) {
    try { listObserver.disconnect(); } catch { /* ignore */ }
    listObserver = null;
    observedListNode = null;
  }

  const parentWindow = getParentWindow();
  const ParentObserver = parentWindow && parentWindow !== window ? parentWindow.MutationObserver : null;
  const Observer = ParentObserver || window.MutationObserver;
  if (typeof Observer !== 'function') return;

  const nodeIsRelevant = (node) => {
    if (!node || node.nodeType !== 1) return false;
    const el = node;
    return el.classList?.contains?.('regex-script-label') || el.classList?.contains?.(HEADER_CLASS);
  };

  listObserver = new Observer((mutations) => {
    if (!uiEnabled) return;
    if (!Array.isArray(mutations) || mutations.length === 0) return;

    const relevant = mutations.some((m) => {
      if (m.type !== 'childList') return false;
      return Array.from(m.addedNodes).some(nodeIsRelevant) || Array.from(m.removedNodes).some(nodeIsRelevant);
    });
    if (!relevant) return;

    // Run regroup in the same render cycle (MutationObserver callbacks happen before paint),
    // matching the no-flicker behavior of the preset entry grouping UI.
    queueApplyGrouping();
  });
  observedListNode = $list[0];
  listObserver.observe(observedListNode, { childList: true });
}

function setupToggleReapplyListener() {
  if (toggleReapplyBound) return;
  toggleReapplyBound = true;

  try {
    const $ = getJQuery();
    const parentWindow = getParentWindow();
    const doc = parentWindow?.document ?? document;
    $(doc)
      .off('click.pt-regex-grouping-toggle')
      .on('click.pt-regex-grouping-toggle', '#regex_container .regex-toggle-on, #regex_container .regex-toggle-off', () => {
        // The host will rebuild the list asynchronously after toggle; try regroup ASAP and with a short fallback.
        queueApplyGrouping();
        setTimeout(queueApplyGrouping, 120);
      });
  } catch {
    /* ignore */
  }
}

function setupDomObserver() {
  const parentWindow = getParentWindow();
  const ParentObserver = parentWindow && parentWindow !== window ? parentWindow.MutationObserver : null;
  const Observer = ParentObserver || window.MutationObserver;
  if (typeof Observer !== 'function') return;
  if (domObserver) return;

  // Only observe the regex panel container to avoid reacting to chat DOM changes (performance).
  const target =
    parentWindow.document.getElementById('regex_container')
    || parentWindow.document.getElementById('extensions_settings')
    || parentWindow.document.getElementById('extensions_settings2');
  if (!target) return;

  domObserver = new Observer(
    debounce(() => {
      if (!uiEnabled) return;
      const $list = findRegexListContainer();
      if (!$list.length) return;
      if (observedListNode === $list[0]) return;
      setupListObserver();
      ensureRegexBulkGroupButtonInjected();
      installHeaderEvents();
      queueApplyGrouping();
    }, 200),
  );

  domObserver.observe(target, { childList: true, subtree: true });
}

export function initRegexScriptGroupingUi() {
  uiEnabled = true;
  setupDomObserver();
  setupThemeObserver();
  setupToggleReapplyListener();
  bindRegexBulkGroupButton(handleBulkGroupButtonClick);
  ensureRegexBulkGroupButtonInjected();

  const $list = findRegexListContainer();
  if ($list.length) {
    setupListObserver();
    installHeaderEvents();
    applyGroupingToList();
    installRegexGroupImportInterceptor();
  }
}

export function destroyRegexScriptGroupingUi() {
  uiEnabled = false;
  teardownThemeObserver();
  toggleReapplyBound = false;
  try {
    unbindRegexBulkGroupButton();
    removeRegexBulkGroupButton();
  } catch {
    /* ignore */
  }
  try {
    const $ = getJQuery();
    const parentWindow = getParentWindow();
    const doc = parentWindow?.document ?? document;
    $(doc).off('click.pt-regex-grouping-toggle');
  } catch {
    /* ignore */
  }
  try {
    const $list = findRegexListContainer();
    if ($list.length) {
      $list.off('click.pt-regex-group-header');
      cleanupGroupingUi($list);
    }
  } catch {
    /* ignore */
  }

  try {
    if (listObserver) listObserver.disconnect();
  } catch {
    /* ignore */
  }
  listObserver = null;
  observedListNode = null;

  try {
    if (domObserver) domObserver.disconnect();
  } catch {
    /* ignore */
  }
  domObserver = null;

  lastAppliedSignature = null;
}
