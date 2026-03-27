// 预设条目分组功能 - UI逻辑

import { PT } from '../core/api-compat.js';
import { debounce, getJQuery, getSillyTavernContext } from '../core/utils.js';
import {
  getAllPresetGroupings,
  addPresetGrouping,
  updatePresetGrouping,
  removePresetGrouping,
  reassignPresetGroupingMembers,
} from '../features/entry-grouping.js';
import { CommonStyles } from '../styles/common-styles.js';
import { addToggleAllButtonToGroupHeader, toggleAllEntriesInGroup } from './entry-group-toggle-button.js';
import { moreHorizontalIcon } from './icons.js';

// 临时标记状态
const tempMarks = { start: null, end: null };

// MutationObserver 实例
let listObserver = null;
let applyGroupingTimer = null;
let isApplyingGrouping = false;
let observedListNode = null;
let panelObserver = null;
let observedPanelNode = null;
let zeroResolvedRetryPreset = null;
let zeroResolvedRetryCount = 0;

// 保存分组展开状态（key: presetName-groupIndex, value: boolean）
const groupExpandStates = new Map();

// Avoid unnecessary re-wrapping (which causes visible flicker) by skipping regroup
// when the list identifiers + grouping config haven't changed.
let lastAppliedGroupingSignature = null;
let lastAppliedGroupingPreset = null;
let lastAppliedGroupingListNode = null;
let applyGroupingQueued = false;
let promptManagerHookInstalled = false;
let entryGroupingEnabled = true;
let themeObserver = null;
let settingsUpdatedUnsubscribe = null;
let themeRefreshTimeouts = [];
let lastUnresolvedGroupingWarningKey = null;
let sortDragState = null;

function computeGroupingSignature(presetName, orderedIdentifiers, groupings) {
  const listKey = orderedIdentifiers.join('\u001f');
  const groupingKey = groupings
    .map((g) => [
      g?.id ?? '',
      g?.name ?? '',
      Array.isArray(g?.memberIdentifiers) ? g.memberIdentifiers.join('\u001a') : '',
      g?.mode ?? '',
      g?.unresolved ? '1' : '0',
      typeof g?.legacyStartIndex === 'number' ? String(g.legacyStartIndex) : '',
      typeof g?.legacyEndIndex === 'number' ? String(g.legacyEndIndex) : '',
    ].join('\u001e'))
    .join('\u001d');

  return `${presetName}\u001c${listKey}\u001c${groupingKey}`;
}

function computeUnresolvedGroupingWarningKey(presetName, groupings) {
  const unresolvedKey = groupings
    .filter((g) => g?.unresolved)
    .map((g, index) => [
      g?.id ?? '',
      g?.name ?? '',
      g?.mode ?? '',
      typeof g?.startIdentifier === 'string' ? g.startIdentifier : '',
      typeof g?.endIdentifier === 'string' ? g.endIdentifier : '',
      typeof g?.legacyStartIndex === 'number' ? String(g.legacyStartIndex) : '',
      typeof g?.legacyEndIndex === 'number' ? String(g.legacyEndIndex) : '',
      String(index),
    ].join('\u001e'))
    .join('\u001d');

  return unresolvedKey ? `${presetName}\u001c${unresolvedKey}` : null;
}

function getGroupStateKey(presetName, grouping, fallbackIndex) {
  const groupId = String(grouping?.id ?? '').trim();
  return `${presetName}-${groupId || fallbackIndex}`;
}

function hasGroupingUi(listContainer) {
  return !!listContainer.find('.pt-entry-group-header, .entry-group-header').length;
}

function cleanupGroupingUi(listContainer) {
  listContainer.find('li[data-pm-identifier]').removeAttr('data-pt-group-id');
  listContainer.find('.pt-entry-group-wrapper, .entry-group-wrapper').contents().unwrap();
  listContainer.find('.pt-entry-group-header, .entry-group-header').remove();
}

function findListItemByIdentifier(listContainer, identifier) {
  const $ = getJQuery();
  return listContainer
    .find('li[data-pm-identifier]')
    .filter(function () {
      return String($(this).attr('data-pm-identifier') ?? '').trim() === String(identifier ?? '').trim();
    })
    .first();
}

function readNeighborContext($node, direction = 'prev') {
  const $ = getJQuery();
  const method = direction === 'next' ? 'nextAll' : 'prevAll';
  const $neighbor = $node[method](
    '.pt-entry-group-wrapper, .entry-group-wrapper, .pt-entry-group-header, .entry-group-header, li[data-pm-identifier]',
  ).first();
  if (!$neighbor.length) return { groupId: null, identifier: null };

  if ($neighbor.is('.pt-entry-group-header, .entry-group-header')) {
    const id = String($neighbor.attr('data-pt-group-id') ?? '').trim();
    return { groupId: id || null, identifier: null };
  }

  if ($neighbor.is('.pt-entry-group-wrapper, .entry-group-wrapper')) {
    const id = String($neighbor.attr('data-pt-group-id') ?? '').trim();
    const $items = $neighbor.find('li[data-pm-identifier]');
    const $targetItem = direction === 'next' ? $items.first() : $items.last();
    const identifier = String($targetItem.attr('data-pm-identifier') ?? '').trim();
    return {
      groupId: id || null,
      identifier: identifier || null,
    };
  }

  const id = String($neighbor.attr('data-pt-group-id') ?? '').trim();
  const identifier = String($neighbor.attr('data-pm-identifier') ?? '').trim();
  return {
    groupId: id || null,
    identifier: identifier || null,
  };
}

function readNeighborGroupId($node, direction = 'prev') {
  return readNeighborContext($node, direction).groupId;
}

function getPointerClientPosition(event) {
  const source = event?.originalEvent ?? event;
  const touch = source?.changedTouches?.[0] ?? source?.touches?.[0] ?? null;
  const clientX = touch?.clientX ?? source?.clientX;
  const clientY = touch?.clientY ?? source?.clientY;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  return { clientX, clientY };
}

function inferExplicitGroupDropContext(event, $item) {
  const $ = getJQuery();
  const point = getPointerClientPosition(event);
  if (!point || typeof document.elementsFromPoint !== 'function') return null;

  const elements = document.elementsFromPoint(point.clientX, point.clientY) || [];
  for (const el of elements) {
    if (!(el instanceof Element)) continue;
    if ($item?.length && ($item[0] === el || $item[0].contains(el))) continue;

    const $el = $(el);
    const $groupItem = $el.closest('li[data-pm-identifier][data-pt-group-id]');
    if ($groupItem.length) {
      const groupId = String($groupItem.attr('data-pt-group-id') ?? '').trim();
      const identifier = String($groupItem.attr('data-pm-identifier') ?? '').trim();
      if (groupId) {
        return {
          targetGroupId: groupId,
          targetIdentifier: identifier || null,
        };
      }
    }

    const $wrapper = $el.closest('.pt-entry-group-wrapper, .entry-group-wrapper');
    if ($wrapper.length) {
      const groupId = String($wrapper.attr('data-pt-group-id') ?? '').trim();
      const $items = $wrapper.find('li[data-pm-identifier]');
      const identifier = String($items.last().attr('data-pm-identifier') ?? $items.first().attr('data-pm-identifier') ?? '').trim();
      if (groupId) {
        return {
          targetGroupId: groupId,
          targetIdentifier: identifier || null,
        };
      }
    }

    const $header = $el.closest('.pt-entry-group-header, .entry-group-header');
    if ($header.length) {
      const groupId = String($header.attr('data-pt-group-id') ?? '').trim();
      if (groupId) {
        return {
          targetGroupId: groupId,
          targetIdentifier: null,
        };
      }
    }
  }

  return null;
}

function inferMoveTargetContext($item, event = null) {
  if (!$item?.length) return { targetGroupId: null, targetIdentifier: null };

  const explicitDropContext = inferExplicitGroupDropContext(event, $item);
  if (explicitDropContext) return explicitDropContext;

  const parent = $item.parent();
  if (parent.is('.pt-entry-group-wrapper, .entry-group-wrapper')) {
    const groupId = String(
      parent.attr('data-pt-group-id') ?? parent.prev('.pt-entry-group-header, .entry-group-header').attr('data-pt-group-id') ?? '',
    ).trim();
    const $siblings = parent.find('li[data-pm-identifier]').not($item);
    const targetIdentifier = String(
      $siblings.last().attr('data-pm-identifier') ?? $siblings.first().attr('data-pm-identifier') ?? '',
    ).trim();
    if (groupId || targetIdentifier) {
      return {
        targetGroupId: groupId || null,
        targetIdentifier: targetIdentifier || null,
      };
    }
  }

  return { targetGroupId: null, targetIdentifier: null };
}

function destroyEntryGrouping() {
  entryGroupingEnabled = false;
  teardownThemeReapplyListener();

  try {
    if (applyGroupingTimer) {
      clearTimeout(applyGroupingTimer);
      applyGroupingTimer = null;
    }
  } catch {
    /* ignore */
  }

  try {
    if (listObserver) {
      listObserver.disconnect();
      listObserver = null;
    }
    if (panelObserver) {
      panelObserver.disconnect();
      panelObserver = null;
    }
  } catch {
    /* ignore */
  }

  observedListNode = null;
  observedPanelNode = null;
  isApplyingGrouping = false;
  applyGroupingQueued = false;
  lastAppliedGroupingSignature = null;
  lastAppliedGroupingPreset = null;
  lastAppliedGroupingListNode = null;
  lastUnresolvedGroupingWarningKey = null;
  sortDragState = null;

  try {
    const listContainer = findListContainer();
    if (listContainer?.length) cleanupGroupingUi(listContainer);
  } catch {
    /* ignore */
  }
}

function queueApplyGrouping() {
  if (!entryGroupingEnabled) return;
  if (applyGroupingQueued) return;
  applyGroupingQueued = true;

  Promise.resolve().then(() => {
    applyGroupingQueued = false;

    const currentList = findListContainer();
    if (!listObserver || (currentList.length && observedListNode !== currentList[0])) {
      setupListObserver();
    }
    applyGroupingToList();
  });
}

function nodeHasGroupingUi(node) {
  if (!node || node.nodeType !== 1) return false;
  const el = node;
  if (
    el.classList?.contains('pt-entry-group-wrapper')
    || el.classList?.contains('pt-entry-group-header')
    || el.classList?.contains('entry-group-wrapper')
    || el.classList?.contains('entry-group-header')
  ) {
    return true;
  }
  if (typeof el.querySelector !== 'function') return false;
  return !!el.querySelector('.pt-entry-group-wrapper,.pt-entry-group-header,.entry-group-wrapper,.entry-group-header');
}

async function installPromptManagerHook() {
  if (promptManagerHookInstalled) return;
  promptManagerHookInstalled = true;

  try {
    const mod = await import('/scripts/PromptManager.js');
    const PromptManager = mod?.PromptManager;
    if (!PromptManager?.prototype) return;

    // Prevent double-patching (across hot reloads / multiple init calls).
    if (PromptManager.prototype.__ptEntryGroupingHooked) return;

    const originalMakeDraggable = PromptManager.prototype.makeDraggable;
    if (typeof originalMakeDraggable !== 'function') return;

    PromptManager.prototype.makeDraggable = function (...args) {
      const result = originalMakeDraggable.apply(this, args);
      try {
        // PromptManager re-renders asynchronously on toggle. Hooking here makes regroup run
        // right after the list finishes rendering, so the group header doesn't flash.
        scheduleApplyGrouping(0);
      } catch {
        /* ignore */
      }
      return result;
    };

    PromptManager.prototype.__ptEntryGroupingHooked = true;
  } catch (error) {
    console.warn('EntryGrouping: failed to hook PromptManager; falling back to observers only.', error);
  }
}

// 辅助函数：查找列表容器
function findListContainer() {
  const $ = getJQuery();
  let container = $('#openai_prompt_manager_list');
  if (!container.length) container = $('[id$="prompt_manager_list"]').first();
  if (!container.length) container = $('ul[id*="prompt_manager"]').first();
  return container;
}

// 辅助函数：查找面板容器
function findPanelContainer() {
  const listContainer = findListContainer();
  return listContainer.closest('.range-block');
}

// 辅助函数：重置临时标记
function resetTempMarks() {
  tempMarks.start = null;
  tempMarks.end = null;
}

function getOrderedIdentifiersFromList() {
  const listContainer = findListContainer();
  if (!listContainer.length) return [];
  return listContainer
    .find('li[data-pm-identifier]')
    .toArray()
    .map((el) => el.getAttribute('data-pm-identifier'))
    .filter(Boolean);
}

function getGroupedIdentifierSet(presetName, orderedIdentifiers) {
  const groupings = getAllPresetGroupings(presetName, orderedIdentifiers);
  const grouped = new Set();

  for (const g of groupings) {
    if (g?.unresolved) continue;
    if (!Array.isArray(g.memberIdentifiers) || g.memberIdentifiers.length === 0) continue;
    for (const id of g.memberIdentifiers) {
      if (id) grouped.add(id);
    }
  }

  return grouped;
}

function applyEntryGroupingThemeVars() {
  const panelContainer = findPanelContainer();
  if (!panelContainer.length) return;

  const vars = CommonStyles.getVars();
  panelContainer.addClass('pt-entry-grouping-root');
  panelContainer[0].style.setProperty('--pt-bg', vars.bgColor);
  panelContainer[0].style.setProperty('--pt-border', vars.borderColor);
  panelContainer[0].style.setProperty('--pt-section-bg', vars.sectionBg);
  panelContainer[0].style.setProperty('--pt-text', vars.textColor);
  panelContainer[0].style.setProperty('--pt-tip', vars.tipColor);
  panelContainer[0].style.setProperty('--pt-danger', vars.dangerColor);
}

// Detect list mutations that matter for grouping. Some SillyTavern renders remove/insert
// wrapper elements (which contain <li>) as a subtree, so we must look inside nodes too.
function nodeHasPromptManagerItems(node) {
  if (!node || node.nodeType !== 1) return false;
  const el = node;
  if (el.tagName === 'LI' && el.hasAttribute('data-pm-identifier')) return true;
  if (
    el.classList?.contains('pt-entry-group-wrapper')
    || el.classList?.contains('pt-entry-group-header')
    // Back-compat: old class names
    || el.classList?.contains('entry-group-wrapper')
    || el.classList?.contains('entry-group-header')
  ) {
    return true;
  }
  return typeof el.querySelector === 'function' && !!el.querySelector('li[data-pm-identifier]');
}

function isRelevantListMutation(mutation) {
  if (mutation.type === 'childList') {
    return Array.from(mutation.addedNodes).some(nodeHasPromptManagerItems)
      || Array.from(mutation.removedNodes).some(nodeHasPromptManagerItems);
  }

  // Some prompt manager updates reuse the same <li> nodes and only swap identifiers.
  // In that case childList mutations won't fire, so we also listen for identifier changes.
  if (mutation.type === 'attributes') {
    return mutation.attributeName === 'data-pm-identifier'
      && mutation.target?.nodeType === 1
      && mutation.target?.tagName === 'LI';
  }

  return false;
}

function scheduleApplyGrouping(delay = 150) {
  if (!entryGroupingEnabled) return;
  if (applyGroupingTimer) clearTimeout(applyGroupingTimer);
  if (delay <= 0) {
    applyGroupingTimer = null;
    queueApplyGrouping();
    return;
  }
  applyGroupingTimer = setTimeout(() => {
    // The list node may be replaced by the host UI; refresh the observer before applying.
    const currentList = findListContainer();
    if (!listObserver || (currentList.length && observedListNode !== currentList[0])) {
      setupListObserver();
    }
    applyGroupingToList();
    applyGroupingTimer = null;
  }, delay);
}

function clearThemeRefreshTimeouts() {
  if (!themeRefreshTimeouts.length) return;
  themeRefreshTimeouts.forEach((t) => clearTimeout(t));
  themeRefreshTimeouts = [];
}

function triggerGroupingRefreshBurst() {
  if (!entryGroupingEnabled) return;

  // If the user toggles beautify/theme and immediately opens the preset panel,
  // the prompt list may finish rendering asynchronously. Grouping UI won't re-apply
  // unless we see a relevant DOM mutation, so do a short burst of regroup attempts.
  clearThemeRefreshTimeouts();
  scheduleApplyGrouping(0);
  [120, 420, 900, 1800].forEach((delay) => {
    themeRefreshTimeouts.push(setTimeout(() => scheduleApplyGrouping(0), delay));
  });
}

function teardownThemeReapplyListener() {
  clearThemeRefreshTimeouts();

  try {
    if (themeObserver) {
      themeObserver.disconnect();
      themeObserver = null;
    }
  } catch {
    /* ignore */
  }

  try {
    settingsUpdatedUnsubscribe?.();
  } catch {
    /* ignore */
  }
  settingsUpdatedUnsubscribe = null;
}

function setupThemeReapplyListener() {
  teardownThemeReapplyListener();

  // 1) Prefer SillyTavern SETTINGS_UPDATED (covers most UI preset/theme/beautify switches).
  try {
    const context = getSillyTavernContext();
    const eventSource = context?.eventSource;
    const settingsEvent = context?.eventTypes?.SETTINGS_UPDATED;
    if (eventSource?.on && settingsEvent) {
      const handler = () => triggerGroupingRefreshBurst();
      eventSource.on(settingsEvent, handler);
      settingsUpdatedUnsubscribe = () => {
        try {
          eventSource.removeListener?.(settingsEvent, handler);
        } catch {
          /* ignore */
        }
      };
    }
  } catch {
    /* ignore */
  }

  // 2) Fallback: observe root/body class/style changes (SmartTheme / beautify can be pure CSS vars).
  const root = document.documentElement;
  const body = document.body;
  if (!root || !body) return;

  const debounced = debounce(() => triggerGroupingRefreshBurst(), 200);
  themeObserver = new MutationObserver((mutations) => {
    if (!entryGroupingEnabled) return;
    if (isApplyingGrouping) return;
    if (mutations.some((m) => m.type === 'attributes' && (m.attributeName === 'style' || m.attributeName === 'class'))) {
      debounced();
    }
  });

  themeObserver.observe(root, { attributes: true, attributeFilter: ['style', 'class'] });
  themeObserver.observe(body, { attributes: true, attributeFilter: ['style', 'class'] });
}

function setupToggleReapplyListener() {
  const $ = getJQuery();
  // Re-apply grouping after toggling enabled/disabled since the host may re-render the whole list.
  $(document)
    .off('click.pt-entry-grouping-toggle')
    .on('click.pt-entry-grouping-toggle', '.prompt-manager-toggle-action', () => {
      // Apply ASAP (usually a no-op due to signature check) + delayed fallback for host async rerenders.
      scheduleApplyGrouping(0);
      setTimeout(() => scheduleApplyGrouping(0), 200);
    });
}

function nodeHasPromptManagerList(node) {
  if (!node || node.nodeType !== 1) return false;
  const el = node;

  // Ignore our injected UI nodes.
  if (el.classList?.contains('pt-entry-group-header') || el.classList?.contains('pt-entry-group-wrapper')) return false;

  const id = el.id || '';
  if (id === 'openai_prompt_manager_list') return true;
  if (id.endsWith('prompt_manager_list')) return true;
  if (id.includes('prompt_manager') && el.tagName === 'UL') return true;

  if (typeof el.querySelector !== 'function') return false;
  return !!el.querySelector('#openai_prompt_manager_list,[id$="prompt_manager_list"],ul[id*="prompt_manager"]');
}

function isRelevantPanelMutation(mutation) {
  if (mutation.type !== 'childList') return false;
  return Array.from(mutation.addedNodes).some(nodeHasPromptManagerList)
    || Array.from(mutation.removedNodes).some(nodeHasPromptManagerList);
}

function setupPanelObserver() {
  const panelNode = document.body;
  if (!panelNode) return;
  if (panelObserver && observedPanelNode === panelNode) return;

  if (panelObserver) {
    panelObserver.disconnect();
    panelObserver = null;
    observedPanelNode = null;
  }

  panelObserver = new MutationObserver((mutations) => {
    if (isApplyingGrouping) return;
    if (mutations.some(isRelevantPanelMutation)) {
      scheduleApplyGrouping(0);
      setTimeout(() => scheduleApplyGrouping(0), 150);
    }
  });

  panelObserver.observe(panelNode, { childList: true, subtree: true });
  observedPanelNode = panelNode;
}

// 初始化分组功能
function initEntryGrouping() {
  entryGroupingEnabled = true;
  installPromptManagerHook();
  setupPanelObserver();
  setupThemeReapplyListener();

  // 设置 MutationObserver 监听列表变化
  setupListObserver();
  setupToggleReapplyListener();

  // 初始应用分组（避免首次进入时列表还未渲染）
  scheduleApplyGrouping(600);
  scheduleApplyGrouping(1800);
}

// 设置 MutationObserver 监听列表变化
function setupListObserver() {
  // 清理旧的 observer
  if (listObserver) {
    listObserver.disconnect();
    listObserver = null;
    observedListNode = null;
  }

  const listContainer = findListContainer();
  if (!listContainer.length) {
    // 如果列表还没渲染，稍后重试
    setTimeout(() => setupListObserver(), 1000);
    return;
  }

  // 创建 MutationObserver 监听列表内容变化
  listObserver = new MutationObserver((mutations) => {
    // 如果正在应用分组，忽略变化（避免递归触发）
    if (isApplyingGrouping) return;

    if (mutations.some(isRelevantListMutation)) {
      // 使用防抖避免频繁触发
      const touchesGroupingUi = mutations.some((mutation) => {
        if (mutation.type !== 'childList') return false;
        return Array.from(mutation.removedNodes).some(nodeHasGroupingUi)
          || Array.from(mutation.addedNodes).some(nodeHasGroupingUi);
      });

      if (touchesGroupingUi) {
        scheduleApplyGrouping(0);
        setTimeout(() => scheduleApplyGrouping(0), 150);
      } else {
        scheduleApplyGrouping(150);
      }
    }
  });

  // 开始监听
  listObserver.observe(listContainer[0], {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-pm-identifier'],
  });

  listContainer
    .off('sortstart.pt-entry-grouping sortstop.pt-entry-grouping')
    .on('sortstart.pt-entry-grouping', function (_event, ui) {
      const $item = ui?.item;
      const identifier = String($item?.attr?.('data-pm-identifier') ?? '').trim();
      if (!identifier) {
        sortDragState = null;
        return;
      }

      sortDragState = {
        identifier,
        presetName: PT.API.getLoadedPresetName?.(),
      };
    })
    .on('sortstop.pt-entry-grouping', function (_event, ui) {
      const state = sortDragState;
      sortDragState = null;

      const fallbackIdentifier = String(ui?.item?.attr?.('data-pm-identifier') ?? '').trim();
      const movedIdentifier = String(state?.identifier ?? fallbackIdentifier).trim();
      const presetName = String(state?.presetName ?? PT.API.getLoadedPresetName?.() ?? '').trim();
      const immediateTargetContext = inferMoveTargetContext(ui?.item, _event);
      const orderedIdentifiers = getOrderedIdentifiersFromList();
      if (!movedIdentifier || !presetName) {
        scheduleApplyGrouping(0);
        return;
      }

      setTimeout(async () => {
        await reassignPresetGroupingMembers(
          presetName,
          [movedIdentifier],
          orderedIdentifiers,
          {
            targetGroupId: immediateTargetContext.targetGroupId,
            targetIdentifier: immediateTargetContext.targetIdentifier,
          },
        );

        scheduleApplyGrouping(0);
      }, 0);
    });

  observedListNode = listContainer[0];
}

// 应用分组到条目列表
function applyGroupingToList() {
  if (!entryGroupingEnabled) return;
  const $ = getJQuery();
  const presetName = PT.API.getLoadedPresetName?.();
  if (!presetName) return;

  const listContainer = findListContainer();
  if (!listContainer.length) return;

  // 设置标志位，防止 MutationObserver 递归触发
  isApplyingGrouping = true;

  try {
    applyEntryGroupingThemeVars();

    const groupingUiExists = hasGroupingUi(listContainer);

    const preItems = listContainer.find('li[data-pm-identifier]').toArray();
    if (preItems.length === 0) {
      return;
    }

    const preOrderedIdentifiers = preItems
      .map((el) => el.getAttribute('data-pm-identifier'))
      .filter(Boolean);
    const preUnique = new Set(preOrderedIdentifiers);
    if (preUnique.size !== preOrderedIdentifiers.length) {
      console.warn('EntryGrouping: duplicate data-pm-identifier detected; skipping grouping.');
      bindTripleClickEvents();
      return;
    }

    const preGroupings = getAllPresetGroupings(presetName, preOrderedIdentifiers);
    const signature = computeGroupingSignature(presetName, preOrderedIdentifiers, preGroupings);

    if (preGroupings.length === 0) {
      if (groupingUiExists) cleanupGroupingUi(listContainer);
      lastAppliedGroupingSignature = signature;
      lastAppliedGroupingPreset = presetName;
      lastAppliedGroupingListNode = listContainer[0];
      bindTripleClickEvents();
      return;
    }

    if (
      groupingUiExists
      && lastAppliedGroupingSignature === signature
      && lastAppliedGroupingPreset === presetName
      && lastAppliedGroupingListNode === listContainer[0]
    ) {
      bindTripleClickEvents();
      return;
    }

    // 保存当前展开状态
    listContainer.find('.pt-entry-group-header, .entry-group-header').each(function() {
      const $header = $(this);
      const groupIndex = $header.data('group-index');
      const groupId = String($header.attr('data-pt-group-id') ?? '').trim();
      const wrapper = $header.next('.pt-entry-group-wrapper, .entry-group-wrapper');
      const isExpanded = wrapper.is(':visible');
      if (groupIndex !== undefined) {
        groupExpandStates.set(`${presetName}-${groupId || groupIndex}`, isExpanded);
      }
    });

    // 清理之前的分组UI
    cleanupGroupingUi(listContainer);

    const items = listContainer.find('li[data-pm-identifier]').toArray();
    if (items.length === 0) {
      return;
    }

    const orderedIdentifiers = items
      .map((el) => el.getAttribute('data-pm-identifier'))
      .filter(Boolean);
    const unique = new Set(orderedIdentifiers);
    if (unique.size !== orderedIdentifiers.length) {
      console.warn('EntryGrouping: duplicate data-pm-identifier detected; skipping grouping.');
      bindTripleClickEvents();
      return;
    }

    const groupings = getAllPresetGroupings(presetName, orderedIdentifiers);
    if (groupings.length === 0) {
      bindTripleClickEvents();
      return;
    }

    const unresolvedCount = groupings.filter((g) => g?.unresolved).length;
    if (unresolvedCount && window.toastr) {
      const unresolvedWarningKey = computeUnresolvedGroupingWarningKey(presetName, groupings);
      if (unresolvedWarningKey && lastUnresolvedGroupingWarningKey !== unresolvedWarningKey) {
        lastUnresolvedGroupingWarningKey = unresolvedWarningKey;
        toastr.warning(`有 ${unresolvedCount} 个旧分组无法解析（已跳过）`);
      }
    } else if (!unresolvedCount) {
      lastUnresolvedGroupingWarningKey = null;
    }

    const resolvedGroupings = groupings
      .map((g, index) => ({ ...g, originalIndex: index }))
      .filter((g) => !g.unresolved && Array.isArray(g.memberIdentifiers) && g.memberIdentifiers.length > 0)
      .map((g) => {
        const memberSet = new Set(g.memberIdentifiers.map(String));
        const resolvedMembers = orderedIdentifiers.filter((id) => memberSet.has(String(id)));
        if (resolvedMembers.length === 0) return null;
        const anchorIndex = orderedIdentifiers.indexOf(resolvedMembers[0]);
        return { ...g, memberIdentifiers: resolvedMembers, anchorIndex };
      })
      .filter(Boolean)
      // 按照 start/end 的较小索引排序，从后往前应用（避免索引变化）
      .sort((a, b) => (a.anchorIndex ?? Number.MAX_SAFE_INTEGER) - (b.anchorIndex ?? Number.MAX_SAFE_INTEGER));
    // Heuristic: if the preset has groupings but none can be resolved against current list identifiers,
    // it's likely the host list is still showing a previous preset; retry after it finishes updating.
    if (resolvedGroupings.length === 0) {
      if (zeroResolvedRetryPreset !== presetName) {
        zeroResolvedRetryPreset = presetName;
        zeroResolvedRetryCount = 0;
      }

      if (zeroResolvedRetryCount < 3) {
        zeroResolvedRetryCount += 1;
        setTimeout(() => scheduleApplyGrouping(0), 450);
        setTimeout(() => scheduleApplyGrouping(0), 1200);
      }
      bindTripleClickEvents();
      return;
    }
    zeroResolvedRetryPreset = null;
    zeroResolvedRetryCount = 0;

    // 创建所有分组UI
    for (const grouping of resolvedGroupings) {
      const groupItems = grouping.memberIdentifiers
        .map((identifier) => listContainer.find(`li[data-pm-identifier="${identifier}"]`).first()[0])
        .filter(Boolean);

      if (groupItems.length === 0) continue;

      createGroupUI(groupItems, grouping, presetName, grouping.originalIndex);
    }

    lastAppliedGroupingSignature = signature;
    lastAppliedGroupingPreset = presetName;
    lastAppliedGroupingListNode = listContainer[0];

    bindTripleClickEvents();
  } finally {
    // 确保标志位被重置
    setTimeout(() => {
      isApplyingGrouping = false;
    }, 0);
  }
}

// 创建分组UI
function createGroupUI(groupItems, grouping, presetName, groupIndex) {
  const $ = getJQuery();
  const $firstItem = $(groupItems[0]);
  if (!$firstItem.length) return;

  const stateKey = getGroupStateKey(presetName, grouping, groupIndex);
  const shouldExpand = groupExpandStates.get(stateKey) || false;

  const groupHeader = $(`
    <div class="pt-entry-group-header${shouldExpand ? ' is-expanded' : ''}" data-pt-group-id="${grouping.id || ''}">
      <span class="pt-entry-group-toggle" aria-hidden="true"></span>
      <span class="pt-entry-group-name"></span>
      <span class="pt-entry-group-count"></span>
      <button type="button" class="menu_button pt-icon-btn pt-entry-group-more-btn" title="\u66f4\u591a" aria-label="\u66f4\u591a">
        <span class="pt-entry-group-more-icon" aria-hidden="true">${moreHorizontalIcon(14)}</span>
      </button>
    </div>
  `);
  groupHeader.find('.pt-entry-group-name').text(grouping.name || '\u5206\u7ec4');

  const totalCount = groupItems.length;
  let enabledCount = 0;
  groupItems.forEach((item) => {
    const $item = $(item);
    const $toggle = $item.find('.prompt-manager-toggle-action');
    if (!$toggle.length) {
      enabledCount += 1;
      return;
    }

    const isEnabled = !$toggle.hasClass('disabled') && !$toggle.hasClass('fa-toggle-off');
    if (isEnabled) enabledCount += 1;
  });
  groupHeader.find('.pt-entry-group-count').text(`${enabledCount}/${totalCount}`);
  groupHeader.data('group-index', groupIndex);

  const groupWrapper = $(`<div class="pt-entry-group-wrapper${shouldExpand ? ' is-expanded' : ''}" data-pt-group-id="${grouping.id || ''}"></div>`);

  $firstItem.before(groupHeader);
  groupHeader.after(groupWrapper);
  groupItems.forEach((item) => {
    $(item).attr('data-pt-group-id', grouping.id || '');
    groupWrapper.append(item);
  });

  groupHeader.find('.pt-entry-group-toggle, .pt-entry-group-name, .pt-entry-group-count').on('click', () => {
    const wrapper = groupHeader.next('.pt-entry-group-wrapper');
    const willBeExpanded = !groupHeader.hasClass('is-expanded');
    groupHeader.toggleClass('is-expanded', willBeExpanded);
    wrapper.toggleClass('is-expanded', willBeExpanded);
    groupExpandStates.set(stateKey, willBeExpanded);
  });

  groupHeader.find('.pt-entry-group-more-btn').on('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showPresetGroupHeaderMenu(groupHeader, { presetName, groupIndex, grouping });
  });

  if (groupWrapper.length) {
    const groupItemElements = groupWrapper.find('li[data-pm-identifier]').toArray();
    if (groupItemElements.length > 0) {
      addToggleAllButtonToGroupHeader(groupHeader, groupItemElements, async (enabled, items) => {
        await toggleAllEntriesInGroup(enabled, items);
      });
    }
  }
}

function closePresetGroupHeaderMenu() {
  const $ = getJQuery();
  $('.pt-entry-group-more-menu').remove();
  $(document).off('.pt-entry-group-more-menu');
}

function showPresetGroupHeaderMenu($groupHeader, { presetName, groupIndex, grouping }) {
  const $ = getJQuery();
  const vars = CommonStyles.getVars();
  const $button = $groupHeader.find('.pt-entry-group-more-btn').first();
  if (!$button.length) return;

  const existing = $('.pt-entry-group-more-menu');
  if (existing.length) {
    const existingGroupId = String(existing.attr('data-pt-group-id') ?? '');
    const nextGroupId = String(grouping?.id ?? '');
    closePresetGroupHeaderMenu();
    if (existingGroupId && existingGroupId == nextGroupId) return;
  }

  const rect = $button[0].getBoundingClientRect();
  const menu = $(`
    <div class="pt-entry-group-more-menu" data-pt-group-id="${grouping?.id || ''}" style="
      position: fixed;
      left: ${rect.right}px;
      top: ${rect.bottom + 4}px;
      min-width: 132px;
      padding: 4px;
      border-radius: 8px;
      z-index: 10004;
      background: ${vars.bgColor};
      border: 1px solid ${vars.borderColor};
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      color: ${vars.textColor};">
      <button type="button" class="pt-entry-group-more-action pt-entry-group-rename-action" style="
        width: 100%;
        padding: 8px 10px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: inherit;
        text-align: left;
        cursor: pointer;">\u91cd\u547d\u540d\u5206\u7ec4</button>
      <button type="button" class="pt-entry-group-more-action pt-entry-group-delete-action" style="
        width: 100%;
        padding: 8px 10px;
        border: none;
        border-top: 1px solid ${vars.borderColor};
        border-radius: 6px;
        background: transparent;
        color: inherit;
        text-align: left;
        cursor: pointer;">\u89e3\u9664\u5206\u7ec4</button>
    </div>
  `);

  const panelContainer = findPanelContainer();
  (panelContainer.length ? panelContainer : $('body')).append(menu);

  const menuRect = menu[0].getBoundingClientRect();
  const nextLeft = Math.min(rect.right - menuRect.width, window.innerWidth - menuRect.width - 8);
  const nextTop = Math.min(rect.bottom + 4, window.innerHeight - menuRect.height - 8);
  menu.css({
    left: `${Math.max(8, nextLeft)}px`,
    top: `${Math.max(8, nextTop)}px`,
  });

  menu.on('pointerdown mousedown click', (e) => e.stopPropagation());
  menu.find('.pt-entry-group-more-action').hover(
    function () { $(this).css('background', vars.sectionBg); },
    function () { $(this).css('background', 'transparent'); },
  );

  menu.find('.pt-entry-group-rename-action').on('click', () => {
    closePresetGroupHeaderMenu();
    showInputDialog('\u8bf7\u8f93\u5165\u65b0\u7684\u5206\u7ec4\u540d\u79f0', grouping?.name || '\u5206\u7ec4', async (newName) => {
      if (newName === grouping?.name) return;
      await updatePresetGrouping(
        presetName,
        groupIndex,
        grouping?.memberIdentifiers,
        null,
        newName,
        getOrderedIdentifiersFromList(),
      );
      setTimeout(() => applyGroupingToList(), 200);
      if (window.toastr) toastr.success('\u5206\u7ec4\u540d\u79f0\u5df2\u66f4\u65b0');
    });
  });

  menu.find('.pt-entry-group-delete-action').on('click', async () => {
    closePresetGroupHeaderMenu();
    if (!confirm('\u786e\u5b9a\u8981\u89e3\u9664\u8fd9\u4e2a\u5206\u7ec4\u5417\uff1f')) return;
    await removePresetGrouping(presetName, groupIndex, getOrderedIdentifiersFromList());
    resetTempMarks();
    setTimeout(() => applyGroupingToList(), 200);
    if (window.toastr) toastr.success('\u5206\u7ec4\u5df2\u89e3\u9664');
  });

  setTimeout(() => {
    $(document)
      .off('pointerdown.pt-entry-group-more-menu mousedown.pt-entry-group-more-menu click.pt-entry-group-more-menu')
      .on('pointerdown.pt-entry-group-more-menu mousedown.pt-entry-group-more-menu click.pt-entry-group-more-menu', (e) => {
        if (!$(e.target).closest('.pt-entry-group-more-menu, .pt-entry-group-more-btn').length) {
          closePresetGroupHeaderMenu();
        }
      });
  }, 0);
}

function bindTripleClickEvents() {
  const $ = getJQuery();
  const listContainer = findListContainer();
  if (!listContainer.length) return;

  // Clean up all previous grouping event handlers
  listContainer.find('li[data-pm-identifier]').off('click.grouping');

  const items = listContainer.find('li[data-pm-identifier]');
  let clickCount = 0;
  let clickTimer = null;
  let lastClickedIndex = -1;

  const resetClickState = () => {
    clickCount = 0;
    lastClickedIndex = -1;
  };

  items.each(function(index) {
    const $item = $(this);
    $item.on('click.grouping', function(e) {
      // 忽略按钮点击
      const $target = $(e.target);
      if ($target.closest('.prompt-manager-toggle-action, .prompt-manager-edit-action, .prompt-manager-detach-action, .prompt-manager-inspect-action, .pt-entry-more-btn, .pt-entry-more-menu, .pt-entry-group-more-btn, .pt-entry-group-more-menu, .group-edit-btn, .group-clear-btn').length) {
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

// 显示输入对话框
function showInputDialog(title, defaultValue, callback) {
  const value = globalThis.prompt?.(title, String(defaultValue ?? ''));
  if (value == null) return;
  const nextValue = String(value).trim();
  if (nextValue) callback(nextValue);
}

// 显示分组菜单
function showGroupingMenu($item, x, y) {
  const $ = getJQuery();
  const presetName = PT.API.getLoadedPresetName?.();
  if (!presetName) return;

  const identifier = $item.attr('data-pm-identifier');
  if (!identifier) return;

  $('.entry-grouping-menu').remove();

  const orderedIdentifiers = getOrderedIdentifiersFromList();
  const groupedIdentifiers = getGroupedIdentifierSet(presetName, orderedIdentifiers);
  if (groupedIdentifiers.has(identifier)) {
    if (window.toastr) toastr.info('该条目已在分组中，不能再次分组');
    return;
  }

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

  // 添加到面板内部
  const panelContainer = findPanelContainer();
  (panelContainer.length ? panelContainer : $('body')).append(menu);

  // 阻止事件冒泡
  menu.on('pointerdown mousedown click', (e) => e.stopPropagation());

  // 调整位置避免超出屏幕
  const menuRect = menu[0].getBoundingClientRect();
  if (menuRect.right > window.innerWidth) menu.css('left', (x - menuRect.width) + 'px');
  if (menuRect.bottom > window.innerHeight) menu.css('top', (y - menuRect.height) + 'px');

  // 悬停效果
  menu.find('.menu-item').hover(
    function() { $(this).css('background', vars.sectionBg); },
    function() { $(this).css('background', 'transparent'); }
  );

  // 处理标记完成后的逻辑
  const handleMarkComplete = async (isStart) => {
    const otherMark = isStart ? tempMarks.end : tempMarks.start;
    if (otherMark !== null) {
      showInputDialog('请输入分组名称', '分组', async (groupName) => {
        const startIndex = orderedIdentifiers.indexOf(tempMarks.start);
        const endIndex = orderedIdentifiers.indexOf(tempMarks.end);
        if (startIndex === -1 || endIndex === -1) {
          resetTempMarks();
          if (window.toastr) toastr.error('分组锚点无法解析，请重试');
          return;
        }

        // Disallow overlap: the new group cannot include any already-grouped entry.
        const start = Math.min(startIndex, endIndex);
        const end = Math.max(startIndex, endIndex);
        const hasOverlap = orderedIdentifiers.slice(start, end + 1).some((id) => groupedIdentifiers.has(id));
        if (hasOverlap) {
          resetTempMarks();
          if (window.toastr) toastr.error('选择范围包含已分组条目，请重新选择未分组的范围');
          return;
        }

        await addPresetGrouping(
          presetName,
          tempMarks.start,
          tempMarks.end,
          groupName,
          orderedIdentifiers,
        );
        resetTempMarks();
        setTimeout(() => applyGroupingToList(), 200);
        if (window.toastr) toastr.success('分组已创建');
      });
    } else {
      if (window.toastr) toastr.info(`已标记分组${isStart ? '开始' : '结束'}，请继续标记分组${isStart ? '结束' : '开始'}`);
    }
  };

  // 菜单项点击处理
  menu.find('.set-start').on('click', (e) => {
    e.stopPropagation();
    if (groupedIdentifiers.has(identifier)) {
      if (window.toastr) toastr.info('该条目已在分组中，不能作为分组起点');
      return;
    }
    tempMarks.start = identifier;
    menu.remove();
    $(document).off('click.grouping-menu');
    handleMarkComplete(true);
  });

  menu.find('.set-end').on('click', (e) => {
    e.stopPropagation();
    if (groupedIdentifiers.has(identifier)) {
      if (window.toastr) toastr.info('该条目已在分组中，不能作为分组终点');
      return;
    }
    tempMarks.end = identifier;
    menu.remove();
    $(document).off('click.grouping-menu');
    handleMarkComplete(false);
  });

  menu.find('.clear-marks').on('click', (e) => {
    e.stopPropagation();
    resetTempMarks();
    menu.remove();
    $(document).off('click.grouping-menu');
    if (window.toastr) toastr.info('已清除临时标记');
  });

  // 点击外部关闭菜单
  setTimeout(() => {
    $(document).one('click.grouping-menu', (e) => {
      if (!$(e.target).closest('.entry-grouping-menu').length) {
        menu.remove();
        $(document).off('click.grouping-menu');
      }
    });
  }, 100);
}

export {
  initEntryGrouping,
  destroyEntryGrouping,
  applyGroupingToList,
};
