import { ensureViewportCssVars, getJQuery } from '../core/utils.js';
import {
  addWorldbookEntryGrouping,
  getAllWorldbookEntryGroupings,
  removeWorldbookEntryGrouping,
  updateWorldbookEntryGrouping,
} from '../features/worldbook-entry-grouping.js';
import { CommonStyles } from '../styles/common-styles.js';

const tempMarks = { start: null, end: null };

let enabled = false;
let retryTimer = null;
let listObserver = null;
let applyGroupingTimer = null;
let applyGroupingQueued = false;
let isApplyingGrouping = false;
let lastAppliedSignature = null;
let lastAppliedListNode = null;

const groupExpandStates = new Map();

function getCurrentWorldbookName() {
  const $ = getJQuery();
  const $select = $('#world_editor_select');
  if (!$select.length) return null;
  const value = String($select.val() ?? '').trim();
  if (!value) return null;
  const $opt = $select.find('option:selected');
  const text = String($opt?.text?.() ?? '').trim();
  return text || null;
}

function findListContainer() {
  const $ = getJQuery();
  return $('#world_popup_entries_list');
}

function findPanelContainer() {
  const $ = getJQuery();
  const $list = findListContainer();
  const $panel = $list.closest('#world_popup');
  if ($panel.length) return $panel;
  return $('body');
}

function applyThemeVarsToContainer($container) {
  if (!$container?.length) return;
  const vars = CommonStyles.getVars();
  $container.addClass('pt-entry-grouping-root');
  const el = $container[0];
  el.style.setProperty('--pt-section-bg', vars.sectionBg);
  el.style.setProperty('--pt-border', vars.borderColor);
  el.style.setProperty('--pt-text', vars.textColor);
  el.style.setProperty('--pt-tip', vars.tipColor);
}

function resetTempMarks() {
  tempMarks.start = null;
  tempMarks.end = null;
}

function getUidFromWorldEntryEl(el) {
  const $ = getJQuery();
  const $el = $(el);
  const dataUid = $el.data('uid');
  if (dataUid != null && String(dataUid).trim()) return String(dataUid).trim();
  const attrUid = $el.attr('uid');
  if (attrUid != null && String(attrUid).trim()) return String(attrUid).trim();
  const dataAttrUid = $el.attr('data-uid');
  if (dataAttrUid != null && String(dataAttrUid).trim()) return String(dataAttrUid).trim();
  return '';
}

function getOrderedUidsFromList() {
  const $ = getJQuery();
  const listContainer = findListContainer();
  if (!listContainer.length) return [];
  const uids = [];
  const seen = new Set();

  listContainer.find('.world_entry').each(function () {
    const uid = getUidFromWorldEntryEl(this);
    if (!uid || seen.has(uid)) return;
    seen.add(uid);
    uids.push(uid);
  });

  return uids;
}

function computeSignature(worldbookName, orderedUids, groupings) {
  const listKey = orderedUids.join('\u001f');
  const groupingKey = (Array.isArray(groupings) ? groupings : [])
    .map((g) => [
      g?.id ?? '',
      g?.name ?? '',
      g?.startUid ?? '',
      g?.endUid ?? '',
      g?.mode ?? '',
      g?.unresolved ? '1' : '0',
      typeof g?.legacyStartIndex === 'number' ? String(g.legacyStartIndex) : '',
      typeof g?.legacyEndIndex === 'number' ? String(g.legacyEndIndex) : '',
    ].join('\u001e'))
    .join('\u001d');

  return `${worldbookName}\u001c${listKey}\u001c${groupingKey}`;
}

function cleanupGroupingUi($list) {
  if (!$list?.length) return;
  $list.find('.pt-wi-entry-group-header').remove();
  $list.find('.world_entry').each(function () {
    this.style.removeProperty('display');
    this.removeAttribute('data-pt-wi-group');
  });
}

function applyGroupVisibility($list, groupId, isExpanded) {
  if (!$list?.length) return;
  $list.find(`.world_entry[data-pt-wi-group="${groupId}"]`).each(function () {
    this.style.display = isExpanded ? '' : 'none';
  });
}

function buildGroupedUidsSetFromDom($list) {
  const grouped = new Set();
  if (!$list?.length) return grouped;
  $list.find('.world_entry[data-pt-wi-group]').each(function () {
    const uid = getUidFromWorldEntryEl(this);
    if (uid) grouped.add(uid);
  });
  return grouped;
}

function queueApplyGrouping() {
  if (!enabled) return;
  if (applyGroupingQueued) return;
  applyGroupingQueued = true;

  Promise.resolve().then(() => {
    applyGroupingQueued = false;
    void applyGroupingToList();
  });
}

async function applyGroupingToList() {
  if (!enabled) return;
  if (isApplyingGrouping) return;

  const $ = getJQuery();
  const $list = findListContainer();
  if (!$list.length) return;

  const worldbookName = getCurrentWorldbookName();
  if (!worldbookName) {
    cleanupGroupingUi($list);
    return;
  }

  const orderedUids = getOrderedUidsFromList();
  if (!orderedUids.length) {
    cleanupGroupingUi($list);
    return;
  }

  isApplyingGrouping = true;
  try {
    applyThemeVarsToContainer($list);

    const groupings = await getAllWorldbookEntryGroupings(worldbookName, orderedUids);
    const signature = computeSignature(worldbookName, orderedUids, groupings);
    if (signature === lastAppliedSignature && lastAppliedListNode === $list[0]) return;
    lastAppliedSignature = signature;
    lastAppliedListNode = $list[0];

    cleanupGroupingUi($list);

    const uidToEl = new Map();
    $list.find('.world_entry').each(function () {
      const uid = getUidFromWorldEntryEl(this);
      if (!uid || uidToEl.has(uid)) return;
      uidToEl.set(uid, this);
    });

    for (let i = 0; i < groupings.length; i++) {
      const grouping = groupings[i];
      const groupId = String(grouping?.id ?? '').trim() || `pt-wi-eg-${i}`;
      const startUid = String(grouping?.startUid ?? '').trim();
      const endUid = String(grouping?.endUid ?? '').trim();
      if (!startUid || !endUid) continue;

      const startIndex = orderedUids.indexOf(startUid);
      const endIndex = orderedUids.indexOf(endUid);
      if (startIndex === -1 || endIndex === -1) continue;

      const start = Math.min(startIndex, endIndex);
      const end = Math.max(startIndex, endIndex);
      const memberUids = orderedUids.slice(start, end + 1);
      if (!memberUids.length) continue;

      const firstUid = memberUids[0];
      const firstEl = uidToEl.get(firstUid);
      if (!firstEl) continue;

      for (const uid of memberUids) {
        const el = uidToEl.get(uid);
        if (!el) continue;
        el.setAttribute('data-pt-wi-group', groupId);
      }

      const stateKey = `${worldbookName}::${groupId}`;
      const shouldExpand = groupExpandStates.get(stateKey) === true;

      const $header = $(`
        <div class="pt-entry-group-header pt-wi-entry-group-header${shouldExpand ? ' is-expanded' : ''}">
          <span class="pt-entry-group-toggle" aria-hidden="true"></span>
          <span class="pt-entry-group-name"></span>
          <span class="pt-entry-group-count"></span>
          <button type="button" class="menu_button pt-icon-btn pt-entry-group-edit-btn" title="编辑分组" aria-label="编辑分组">
            <span title="edit" class="fa-solid fa-pencil"></span>
          </button>
          <button type="button" class="menu_button pt-icon-btn pt-entry-group-clear-btn" title="删除分组" aria-label="删除分组">
            <i class="fa-fw fa-solid fa-trash-can"></i>
          </button>
        </div>
      `);

      $header.find('.pt-entry-group-name').text(grouping?.name || '分组');
      $header.find('.pt-entry-group-count').text(String(memberUids.length));

      $header
        .data('group-index', i)
        .attr('data-pt-wi-group', groupId);

      $(firstEl).before($header);

      applyGroupVisibility($list, groupId, shouldExpand);

      $header.find('.pt-entry-group-toggle, .pt-entry-group-name, .pt-entry-group-count').on('click', () => {
        const nextExpanded = !$header.hasClass('is-expanded');
        $header.toggleClass('is-expanded', nextExpanded);
        applyGroupVisibility($list, groupId, nextExpanded);
        groupExpandStates.set(stateKey, nextExpanded);
      });

      $header.find('.pt-entry-group-edit-btn').on('click', (e) => {
        e.stopPropagation();
        showInputDialog('请输入分组名称', grouping?.name || '分组', async (newName) => {
          if (String(newName ?? '') === String(grouping?.name ?? '')) return;
          await updateWorldbookEntryGrouping(
            worldbookName,
            i,
            grouping?.startUid,
            grouping?.endUid,
            newName,
            getOrderedUidsFromList(),
          );
          setTimeout(() => queueApplyGrouping(), 200);
          if (window.toastr) toastr.success('分组名称已更新');
        });
      });

      $header.find('.pt-entry-group-clear-btn').on('click', async (e) => {
        e.stopPropagation();
        if (!confirm('确定要取消这个分组吗？')) return;
        await removeWorldbookEntryGrouping(worldbookName, i, getOrderedUidsFromList());
        resetTempMarks();
        setTimeout(() => queueApplyGrouping(), 200);
        if (window.toastr) toastr.success('分组已取消');
      });
    }

    bindTripleClickEvents();
  } finally {
    isApplyingGrouping = false;
  }
}

function bindTripleClickEvents() {
  const $ = getJQuery();
  const $list = findListContainer();
  if (!$list.length) return;

  $list.find('.world_entry').off('click.pt-wi-entry-grouping');

  const items = $list.find('.world_entry');
  let clickCount = 0;
  let clickTimer = null;
  let lastClickedIndex = -1;

  const resetClickState = () => {
    clickCount = 0;
    lastClickedIndex = -1;
  };

  items.each(function (index) {
    const $item = $(this);
    $item.on('click.pt-wi-entry-grouping', function (e) {
      const $target = $(e.target);

      if (
        $target.is('input,textarea,select,button,a')
        || $target.closest('input,textarea,select,button,a').length
        || $target.closest('.drag-handle,.inline-drawer-toggle,.inline-drawer-icon,.menu_button,.delete_world_info_entry,.duplicate_world_info_entry').length
      ) {
        return;
      }

      if (clickTimer) clearTimeout(clickTimer);

      if (lastClickedIndex === index) {
        clickCount++;
        if (clickCount >= 3) {
          resetClickState();
          e.preventDefault();
          e.stopPropagation();
          showGroupingMenu($item, e.clientX, e.clientY);
          return;
        }
      } else {
        clickCount = 1;
        lastClickedIndex = index;
      }

      clickTimer = setTimeout(resetClickState, 1000);
    });
  });
}

function showInputDialog(title, defaultValue, callback) {
  const $ = getJQuery();
  const vars = CommonStyles.getVars();
  ensureViewportCssVars();

  const dialog = $(`
    <div class="entry-grouping-input-dialog" style="
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; height: 100dvh; height: calc(var(--pt-vh, 1vh) * 100);
      background: rgba(0,0,0,0.5); z-index: 10005;
      display: flex; align-items: center; justify-content: center;
      padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom);">
      <div style="
        background: ${vars.bgColor}; padding: 20px; border-radius: 12px;
        min-width: 300px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <div style="font-weight: 600; margin-bottom: 12px; white-space: nowrap;">${title}</div>
        <input type="text" class="dialog-input" value="${String(defaultValue ?? '')}" style="
          width: 100%; padding: 8px; border: 1px solid ${vars.borderColor};
          border-radius: 6px; background: ${vars.inputBg}; color: ${vars.textColor};
          margin-bottom: 12px;">
        <div style="display: flex; flex-direction: row; gap: 8px; justify-content: flex-end;">
          <button type="button" class="dialog-cancel menu_button" style="padding: 6px 16px; white-space: nowrap;">取消</button>
          <button type="button" class="dialog-confirm menu_button" style="padding: 6px 16px; white-space: nowrap;">确定</button>
        </div>
      </div>
    </div>
  `);

  const $panel = findPanelContainer();
  ($panel.length ? $panel : $('body')).append(dialog);

  dialog.on('pointerdown mousedown click', (e) => e.stopPropagation());
  dialog.children().first().on('pointerdown mousedown click', (e) => e.stopPropagation());
  dialog.find('.dialog-input').focus().select();

  const closeDialog = (shouldCallback) => {
    const value = String(dialog.find('.dialog-input').val() ?? '').trim();
    dialog.remove();
    if (shouldCallback && value) callback(value);
  };

  dialog.find('.dialog-confirm').on('click', () => closeDialog(true));
  dialog.find('.dialog-cancel').on('click', () => closeDialog(false));
  dialog.find('.dialog-input').on('keypress', (e) => {
    if (e.key === 'Enter') closeDialog(true);
  });
}

function showGroupingMenu($item, x, y) {
  const $ = getJQuery();
  const worldbookName = getCurrentWorldbookName();
  if (!worldbookName) return;

  const uid = getUidFromWorldEntryEl($item[0]);
  if (!uid) return;

  $('.entry-grouping-menu').remove();

  const vars = CommonStyles.getVars();
  const hasMarks = tempMarks.start !== null || tempMarks.end !== null;

  const menu = $(`
    <div class="entry-grouping-menu" style="
      position: fixed; left: ${x}px; top: ${y}px;
      background: ${vars.bgColor}; border: 1px solid ${vars.borderColor};
      border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10004; padding: 4px; min-width: 140px;">
      <div class="menu-item set-start" style="padding: 8px 12px; cursor: pointer; border-radius: 4px; font-size: 14px;">设为分组开始</div>
      <div class="menu-item set-end" style="padding: 8px 12px; cursor: pointer; border-radius: 4px; font-size: 14px;">设为分组结束</div>
      ${hasMarks ? '<div class="menu-item clear-marks" style="padding: 8px 12px; cursor: pointer; border-radius: 4px; font-size: 14px; color: #ef4444;">清除标记</div>' : ''}
    </div>
  `);

  const $panel = findPanelContainer();
  ($panel.length ? $panel : $('body')).append(menu);

  menu.on('pointerdown mousedown click', (e) => e.stopPropagation());

  const menuRect = menu[0].getBoundingClientRect();
  if (menuRect.right > window.innerWidth) menu.css('left', (x - menuRect.width) + 'px');
  if (menuRect.bottom > window.innerHeight) menu.css('top', (y - menuRect.height) + 'px');

  menu.find('.menu-item').hover(
    function () { $(this).css('background', vars.sectionBg); },
    function () { $(this).css('background', 'transparent'); },
  );

  const $list = findListContainer();
  const groupedUids = buildGroupedUidsSetFromDom($list);

  const handleMarkComplete = async (isStart) => {
    const otherMark = isStart ? tempMarks.end : tempMarks.start;
    if (otherMark !== null) {
      showInputDialog('请输入分组名称', '分组', async (groupName) => {
        const orderedUids = getOrderedUidsFromList();
        const startIndex = orderedUids.indexOf(tempMarks.start);
        const endIndex = orderedUids.indexOf(tempMarks.end);
        if (startIndex === -1 || endIndex === -1) {
          resetTempMarks();
          if (window.toastr) toastr.error('分组锚点无法解析，请重试');
          return;
        }

        const start = Math.min(startIndex, endIndex);
        const end = Math.max(startIndex, endIndex);
        const hasOverlap = orderedUids.slice(start, end + 1).some((id) => groupedUids.has(id));
        if (hasOverlap) {
          resetTempMarks();
          if (window.toastr) toastr.error('选择范围包含已分组条目，请重新选择未分组的范围');
          return;
        }

        await addWorldbookEntryGrouping(
          worldbookName,
          tempMarks.start,
          tempMarks.end,
          groupName,
          orderedUids,
        );
        resetTempMarks();
        setTimeout(() => queueApplyGrouping(), 200);
        if (window.toastr) toastr.success('分组已创建');
      });
    } else {
      if (window.toastr) {
        toastr.info(`已标记分组${isStart ? '开始' : '结束'}，请继续标记分组${isStart ? '结束' : '开始'}`);
      }
    }
  };

  menu.find('.set-start').on('click', (e) => {
    e.stopPropagation();
    if (groupedUids.has(uid)) {
      if (window.toastr) toastr.info('该条目已在分组中，不能作为分组起点');
      return;
    }
    tempMarks.start = uid;
    menu.remove();
    $(document).off('click.pt-wi-grouping-menu');
    void handleMarkComplete(true);
  });

  menu.find('.set-end').on('click', (e) => {
    e.stopPropagation();
    if (groupedUids.has(uid)) {
      if (window.toastr) toastr.info('该条目已在分组中，不能作为分组终点');
      return;
    }
    tempMarks.end = uid;
    menu.remove();
    $(document).off('click.pt-wi-grouping-menu');
    void handleMarkComplete(false);
  });

  menu.find('.clear-marks').on('click', (e) => {
    e.stopPropagation();
    resetTempMarks();
    menu.remove();
    $(document).off('click.pt-wi-grouping-menu');
    if (window.toastr) toastr.info('已清除临时标记');
  });

  setTimeout(() => {
    $(document).one('click.pt-wi-grouping-menu', (e) => {
      if (!$(e.target).closest('.entry-grouping-menu').length) {
        menu.remove();
        $(document).off('click.pt-wi-grouping-menu');
      }
    });
  }, 100);
}

function setupListObserver() {
  const $list = findListContainer();
  if (!$list.length) return;

  if (listObserver) {
    try { listObserver.disconnect(); } catch { /* ignore */ }
    listObserver = null;
  }

  const observer = new MutationObserver(() => {
    if (!enabled) return;
    if (applyGroupingTimer) clearTimeout(applyGroupingTimer);
    applyGroupingTimer = setTimeout(() => queueApplyGrouping(), 50);
  });

  observer.observe($list[0], { childList: true, subtree: true });
  listObserver = observer;

  $list
    .off('sortstop.pt-wi-entry-grouping')
    .on('sortstop.pt-wi-entry-grouping', () => {
      setTimeout(() => queueApplyGrouping(), 0);
    });

  $('#world_editor_select')
    .off('change.pt-wi-entry-grouping')
    .on('change.pt-wi-entry-grouping', () => {
      setTimeout(() => queueApplyGrouping(), 0);
    });
}

async function tryInit() {
  const $ = getJQuery();
  if (!$?.fn) return false;

  const $list = findListContainer();
  if (!$list.length) return false;

  setupListObserver();
  setTimeout(() => queueApplyGrouping(), 0);
  return true;
}

export function initWorldbookEntryGroupingUi() {
  if (enabled) return;
  enabled = true;

  const attempt = async () => {
    if (!enabled) return;
    const ok = await tryInit();
    if (ok) return;
    retryTimer = setTimeout(attempt, 1000);
  };

  void attempt();
}

export function destroyWorldbookEntryGroupingUi() {
  enabled = false;

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  if (applyGroupingTimer) {
    clearTimeout(applyGroupingTimer);
    applyGroupingTimer = null;
  }

  if (listObserver) {
    try { listObserver.disconnect(); } catch { /* ignore */ }
    listObserver = null;
  }

  try {
    const $ = getJQuery();
    $('#world_editor_select').off('change.pt-wi-entry-grouping');
    const $list = findListContainer();
    if ($list?.length) {
      $list.off('sortstop.pt-wi-entry-grouping');
      $list.find('.world_entry').off('click.pt-wi-entry-grouping');
      cleanupGroupingUi($list);
      $list.removeClass('pt-entry-grouping-root');
    }
    $('.entry-grouping-menu').remove();
    $('.entry-grouping-input-dialog').remove();
  } catch {
    /* ignore */
  }

  applyGroupingQueued = false;
  isApplyingGrouping = false;
  lastAppliedSignature = null;
  lastAppliedListNode = null;
  resetTempMarks();
}

export {
  applyGroupingToList,
};
