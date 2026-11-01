// 预设条目分组功能 - UI逻辑

import { PT } from '../core/api-compat.js';
import { debounce, getJQuery, getSillyTavernContext } from '../core/utils.js';
import { notify } from '../core/notify.js';
import {
  getAllPresetGroupings,
  addPresetGrouping,
  updatePresetGrouping,
  removePresetGrouping,
  reassignPresetGroupingMembers,
} from '../features/entry-grouping.js';
import { CommonStyles } from '../styles/common-styles.js';
import { showGroupInputDialog } from './batch-group-dialogs.js';
import { addToggleAllButtonToGroupHeader, toggleAllEntriesInGroup } from './entry-group-toggle-button.js';
import { moreHorizontalIcon } from './icons.js';

const GROUP_SELECT_BTN_CLASS = 'pt-entry-group-select-btn';
const GROUP_INPUT_DIALOG_ID = 'pt-entry-grouping-input-dialog';

// 分组选择状态
let isGroupSelectMode = false;
let selectedIdentifiers = [];
let selectedPresetName = null;
let drawerObserver = null;
let observedDrawerNode = null;
let boundCaptureListNode = null;

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
  setGroupSelectionMode(false, { silent: true });
  entryGroupingEnabled = false;
  teardownThemeReapplyListener();
  teardownDrawerCloseObserver();
  teardownGroupSelectionButtonListeners();
  unbindListCaptureClick();

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
  sortDragState = null;

  try {
    const $ = getJQuery();
    $(`.${GROUP_SELECT_BTN_CLASS}`).remove();
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

// 辅助函数：清空当前选中的条目（保留选择模式状态）
function clearSelectedEntries() {
  selectedIdentifiers = [];
  syncSelectionModeUi();
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
  panelContainer[0].style.setProperty('--pt-theme-font-size', vars.themeFontSize);
  panelContainer[0].style.setProperty('--pt-entry-more-bg', vars.bgColor);
  panelContainer[0].style.setProperty('--pt-entry-more-border', vars.borderColor);
  panelContainer[0].style.setProperty('--pt-entry-more-text', vars.textColor);
  panelContainer[0].style.setProperty('--pt-entry-more-hover-bg', vars.sectionBg);
  panelContainer[0].style.setProperty('--pt-entry-more-radius', vars.borderRadiusSmall);
  panelContainer[0].style.setProperty('--pt-entry-more-padding-y', 'calc(var(--pt-theme-font-size) * 0.5)');
  panelContainer[0].style.setProperty('--pt-entry-more-padding-x', 'calc(var(--pt-theme-font-size) * 0.625)');
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
  setupGroupSelectionButtonListeners();

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
    ensureGroupSelectButtonInjected();

    const groupingUiExists = hasGroupingUi(listContainer);

    const preItems = listContainer.find('li[data-pm-identifier]').toArray();
    if (preItems.length === 0) {
      bindGroupSelectionEvents();
      return;
    }

    const preOrderedIdentifiers = preItems
      .map((el) => el.getAttribute('data-pm-identifier'))
      .filter(Boolean);
    const preUnique = new Set(preOrderedIdentifiers);
    if (preUnique.size !== preOrderedIdentifiers.length) {
      console.warn('EntryGrouping: duplicate data-pm-identifier detected; skipping grouping.');
      bindGroupSelectionEvents();
      return;
    }

    const preGroupings = getAllPresetGroupings(presetName, preOrderedIdentifiers);
    const signature = computeGroupingSignature(presetName, preOrderedIdentifiers, preGroupings);

    if (preGroupings.length === 0) {
      if (groupingUiExists) cleanupGroupingUi(listContainer);
      lastAppliedGroupingSignature = signature;
      lastAppliedGroupingPreset = presetName;
      lastAppliedGroupingListNode = listContainer[0];
      bindGroupSelectionEvents();
      return;
    }

    if (
      groupingUiExists
      && lastAppliedGroupingSignature === signature
      && lastAppliedGroupingPreset === presetName
      && lastAppliedGroupingListNode === listContainer[0]
    ) {
      bindGroupSelectionEvents();
      return;
    }

    // 保存当前展开状态
    listContainer.find('.pt-entry-group-header, .entry-group-header').each(function () {
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
      bindGroupSelectionEvents();
      return;
    }

    const orderedIdentifiers = items
      .map((el) => el.getAttribute('data-pm-identifier'))
      .filter(Boolean);
    const unique = new Set(orderedIdentifiers);
    if (unique.size !== orderedIdentifiers.length) {
      console.warn('EntryGrouping: duplicate data-pm-identifier detected; skipping grouping.');
      bindGroupSelectionEvents();
      return;
    }

    const groupings = getAllPresetGroupings(presetName, orderedIdentifiers);
    if (groupings.length === 0) {
      bindGroupSelectionEvents();
      return;
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
      bindGroupSelectionEvents();
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

    bindGroupSelectionEvents();
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
      <button type="button" class="menu_button pt-icon-btn pt-entry-group-more-btn" title="更多" aria-label="更多">
        <span class="pt-entry-group-more-icon" aria-hidden="true">${moreHorizontalIcon(14)}</span>
      </button>
    </div>
  `);
  groupHeader.find('.pt-entry-group-name').text(grouping.name || '分组');

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

  groupHeader.on('click', (e) => {
    if ($(e.target).closest('button, input, select, label, .menu_button, .pt-entry-group-more-btn, .pt-entry-group-toggle-all-btn').length) {
      return;
    }
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
      --pt-theme-font-size: ${vars.themeFontSize};
      --pt-entry-more-text: ${vars.textColor};">
      <button type="button" class="pt-entry-group-more-action pt-entry-group-rename-action">重命名分组</button>
      <button type="button" class="pt-entry-group-more-action pt-entry-group-delete-action" style="
        border-top: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));">解除分组</button>
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

  menu.on('touchstart touchend pointerdown mousedown click', (e) => e.stopPropagation());

  menu.find('.pt-entry-group-rename-action').on('click', () => {
    closePresetGroupHeaderMenu();
    showGroupInputDialog({
      dialogId: GROUP_INPUT_DIALOG_ID,
      title: '请输入新的分组名称',
      placeholder: '分组名称',
      defaultValue: grouping?.name || '分组',
      container: findPanelContainer(),
      onConfirm: async (newName) => {
        if (newName === grouping?.name) return;
        await updatePresetGrouping(
          presetName,
          groupIndex,
          grouping?.memberIdentifiers,
          null,
          newName,
          getOrderedIdentifiersFromList(),
        );
        applyGroupingToList();
        scheduleApplyGrouping(200);
        notify.success('分组名称已更新');
      },
    });
  });

  menu.find('.pt-entry-group-delete-action').on('click', async () => {
    closePresetGroupHeaderMenu();
    if (!confirm('确定要解除这个分组吗？')) return;
    await removePresetGrouping(presetName, groupIndex, getOrderedIdentifiersFromList());
    clearSelectedEntries();
    applyGroupingToList();
    scheduleApplyGrouping(200);
    notify.success('分组已解除');
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

// 查找底栏中的“插入提示词”按钮（fa-chain）
function findInsertPromptButton(panelContainer) {
  const $ = getJQuery();
  const $scope = panelContainer?.length ? panelContainer : $(document);
  let $btn = $scope
    .find('.completion_prompt_manager_footer a.menu_button.fa-chain, [class$="prompt_manager_footer"] a.menu_button.fa-chain')
    .first();
  if (!$btn.length) {
    $btn = $scope.find('a.menu_button[data-i18n="[title]Insert prompt"]').first();
  }
  return $btn;
}

// 在“插入提示词”按钮左侧注入分组选择按钮
function ensureGroupSelectButtonInjected() {
  if (!entryGroupingEnabled) return false;
  const $ = getJQuery();
  const panelContainer = findPanelContainer();
  const $insertBtn = findInsertPromptButton(panelContainer);
  if (!$insertBtn.length) return false;

  const $footer = $insertBtn.parent();
  if ($footer.find(`.${GROUP_SELECT_BTN_CLASS}`).length) {
    return true;
  }

  const $groupBtn = $(
    `<a class="menu_button fa-object-group fa-solid fa-fw interactable ${GROUP_SELECT_BTN_CLASS}" title="创建条目分组" tabindex="0" role="button" aria-pressed="false"></a>`,
  );
  $insertBtn.before($groupBtn);
  return true;
}

// 切换或设置分组选择模式
function setGroupSelectionMode(nextMode, { silent = false } = {}) {
  const normalized = !!nextMode && entryGroupingEnabled;
  const changed = isGroupSelectMode !== normalized;
  isGroupSelectMode = normalized;
  selectedIdentifiers = [];
  selectedPresetName = PT.API.getLoadedPresetName?.() || null;

  if (!isGroupSelectMode) {
    const $ = getJQuery();
    $(`#${GROUP_INPUT_DIALOG_ID}`).remove();
  }

  syncSelectionModeUi();

  if (changed && !silent) {
    if (isGroupSelectMode) {
      notify.info('已进入分组选择模式：请点击条目进行选择，选中两个条目后创建分组');
    } else {
      notify.info('已退出分组选择模式');
    }
  }
}

// 同步分组选择模式的按钮与条目视觉状态
function syncSelectionModeUi() {
  const $ = getJQuery();
  const listContainer = findListContainer();
  const panelContainer = findPanelContainer();
  const presetName = PT.API.getLoadedPresetName?.();

  if (isGroupSelectMode && presetName && selectedPresetName && selectedPresetName !== presetName) {
    selectedIdentifiers = [];
    selectedPresetName = presetName;
  }

  const $buttons = $(`.${GROUP_SELECT_BTN_CLASS}`);
  $buttons.toggleClass('is-active', isGroupSelectMode);
  $buttons.attr('aria-pressed', isGroupSelectMode ? 'true' : 'false');
  $buttons.attr('title', isGroupSelectMode ? '退出分组选择模式' : '创建条目分组');

  if (!listContainer.length) return;

  listContainer.toggleClass('pt-entry-group-selecting', isGroupSelectMode);
  if (panelContainer.length) {
    panelContainer.toggleClass('pt-entry-group-selecting-panel', isGroupSelectMode);
  }

  try {
    if (typeof listContainer.sortable === 'function' && listContainer.data('ui-sortable')) {
      listContainer.sortable('option', 'disabled', isGroupSelectMode);
    }
  } catch {
    /* ignore */
  }

  const $items = listContainer.find('li[data-pm-identifier]');
  $items.removeClass('pt-entry-group-item-selected pt-entry-group-item-in-range pt-entry-group-item-disabled');

  if (!isGroupSelectMode || !presetName) return;

  const orderedIdentifiers = getOrderedIdentifiersFromList();
  const groupedIdentifiers = getGroupedIdentifierSet(presetName, orderedIdentifiers);

  selectedIdentifiers = selectedIdentifiers.filter(
    (id) => orderedIdentifiers.includes(id) && !groupedIdentifiers.has(id),
  );

  const selectedSet = new Set(selectedIdentifiers);
  const rangeSet = new Set();

  if (selectedIdentifiers.length >= 2) {
    const idxA = orderedIdentifiers.indexOf(selectedIdentifiers[0]);
    const idxB = orderedIdentifiers.indexOf(selectedIdentifiers[1]);
    if (idxA !== -1 && idxB !== -1) {
      const start = Math.min(idxA, idxB);
      const end = Math.max(idxA, idxB);
      for (let i = start; i <= end; i += 1) {
        rangeSet.add(orderedIdentifiers[i]);
      }
    }
  }

  $items.each(function () {
    const $item = $(this);
    const id = String($item.attr('data-pm-identifier') ?? '').trim();
    if (!id) return;

    if (groupedIdentifiers.has(id)) {
      $item.addClass('pt-entry-group-item-disabled');
      return;
    }

    if (selectedSet.has(id)) {
      $item.addClass('pt-entry-group-item-selected');
    } else if (rangeSet.has(id)) {
      $item.addClass('pt-entry-group-item-in-range');
    }
  });
}

// 捕获阶段拦截列表内条目点击，防止在选择模式下触发原生弹窗或开关
function handleListCaptureClick(e) {
  if (!entryGroupingEnabled || !isGroupSelectMode) return;
  const target = e.target;
  if (!(target instanceof Element)) return;

  if (target.closest('.pt-entry-group-header, .entry-group-header, .pt-entry-group-more-menu')) {
    return;
  }

  const itemEl = target.closest('li[data-pm-identifier]');
  if (!itemEl) return;

  e.preventDefault();
  e.stopPropagation();
  if (typeof e.stopImmediatePropagation === 'function') {
    e.stopImmediatePropagation();
  }

  const $ = getJQuery();
  handleEntrySelectionClick($(itemEl));
}

function unbindListCaptureClick() {
  if (boundCaptureListNode) {
    try {
      boundCaptureListNode.removeEventListener('click', handleListCaptureClick, true);
    } catch {
      /* ignore */
    }
    boundCaptureListNode = null;
  }
}

function bindListCaptureClick() {
  const listContainer = findListContainer();
  const listNode = listContainer[0] || null;
  if (boundCaptureListNode === listNode) return;

  unbindListCaptureClick();
  if (listNode) {
    listNode.addEventListener('click', handleListCaptureClick, true);
    boundCaptureListNode = listNode;
  }
}

function teardownDrawerCloseObserver() {
  if (drawerObserver) {
    try {
      drawerObserver.disconnect();
    } catch {
      /* ignore */
    }
    drawerObserver = null;
  }
  observedDrawerNode = null;
}

// 监听左侧预设面板关闭，关闭时自动退出选择模式
function setupDrawerCloseObserver() {
  const $ = getJQuery();
  const listContainer = findListContainer();
  const $drawer = listContainer.length ? listContainer.closest('.drawer-content') : $('#left-nav-panel');
  const drawerNode = $drawer[0] || null;

  if (!drawerNode) return;
  if (drawerObserver && observedDrawerNode === drawerNode) return;

  teardownDrawerCloseObserver();

  drawerObserver = new MutationObserver((mutations) => {
    if (!isGroupSelectMode) return;
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && (mutation.attributeName === 'class' || mutation.attributeName === 'style')) {
        if ($(drawerNode).hasClass('closedDrawer') || !$(drawerNode).is(':visible')) {
          setGroupSelectionMode(false, { silent: true });
          break;
        }
      }
    }
  });

  drawerObserver.observe(drawerNode, {
    attributes: true,
    attributeFilter: ['class', 'style'],
  });
  observedDrawerNode = drawerNode;
}

function setupGroupSelectionButtonListeners() {
  const $ = getJQuery();
  $(document)
    .off('click.pt-entry-group-select-btn', `.${GROUP_SELECT_BTN_CLASS}`)
    .on('click.pt-entry-group-select-btn', `.${GROUP_SELECT_BTN_CLASS}`, (e) => {
      e.preventDefault();
      e.stopPropagation();
      setGroupSelectionMode(!isGroupSelectMode);
    })
    .off('keydown.pt-entry-group-select-btn', `.${GROUP_SELECT_BTN_CLASS}`)
    .on('keydown.pt-entry-group-select-btn', `.${GROUP_SELECT_BTN_CLASS}`, (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        setGroupSelectionMode(!isGroupSelectMode);
      }
    })
    .off('keydown.pt-entry-grouping-esc')
    .on('keydown.pt-entry-grouping-esc', (e) => {
      if (e.key === 'Escape' && isGroupSelectMode && !$(`#${GROUP_INPUT_DIALOG_ID}`).length) {
        setGroupSelectionMode(false);
      }
    });
}

function teardownGroupSelectionButtonListeners() {
  const $ = getJQuery();
  $(document)
    .off('click.pt-entry-group-select-btn', `.${GROUP_SELECT_BTN_CLASS}`)
    .off('keydown.pt-entry-group-select-btn', `.${GROUP_SELECT_BTN_CLASS}`)
    .off('keydown.pt-entry-grouping-esc');
}

function bindGroupSelectionEvents() {
  ensureGroupSelectButtonInjected();
  bindListCaptureClick();
  setupDrawerCloseObserver();
  syncSelectionModeUi();
}

// 处理在选择模式下点击某个条目
function handleEntrySelectionClick($item) {
  const presetName = PT.API.getLoadedPresetName?.();
  if (!presetName) return;

  const identifier = String($item.attr('data-pm-identifier') ?? '').trim();
  if (!identifier) return;

  if (selectedPresetName && selectedPresetName !== presetName) {
    selectedIdentifiers = [];
  }
  selectedPresetName = presetName;

  // 再次点击已选中的条目则取消选中
  const existingIndex = selectedIdentifiers.indexOf(identifier);
  if (existingIndex !== -1) {
    selectedIdentifiers.splice(existingIndex, 1);
    syncSelectionModeUi();
    return;
  }

  const orderedIdentifiers = getOrderedIdentifiersFromList();
  const groupedIdentifiers = getGroupedIdentifierSet(presetName, orderedIdentifiers);
  if (groupedIdentifiers.has(identifier)) {
    notify.info('该条目已在分组中，不能再次分组');
    return;
  }

  if (selectedIdentifiers.length >= 2) {
    selectedIdentifiers = [identifier];
    syncSelectionModeUi();
    return;
  }

  if (selectedIdentifiers.length === 0) {
    selectedIdentifiers = [identifier];
    syncSelectionModeUi();
    return;
  }

  // 选中第二个条目，计算闭区间并弹出命名弹窗
  const firstIdentifier = selectedIdentifiers[0];
  const secondIdentifier = identifier;
  const startIndex = orderedIdentifiers.indexOf(firstIdentifier);
  const endIndex = orderedIdentifiers.indexOf(secondIdentifier);

  if (startIndex === -1 || endIndex === -1) {
    clearSelectedEntries();
    notify.error('分组锚点无法解析，请重试');
    return;
  }

  const start = Math.min(startIndex, endIndex);
  const end = Math.max(startIndex, endIndex);
  const hasOverlap = orderedIdentifiers.slice(start, end + 1).some((id) => groupedIdentifiers.has(id));
  if (hasOverlap) {
    clearSelectedEntries();
    notify.error('选择范围包含已分组条目，请重新选择未分组的范围');
    return;
  }

  selectedIdentifiers = [firstIdentifier, secondIdentifier];
  syncSelectionModeUi();

  showGroupInputDialog({
    dialogId: GROUP_INPUT_DIALOG_ID,
    title: '请输入分组名称',
    placeholder: '分组名称',
    defaultValue: '分组',
    container: findPanelContainer(),
    onConfirm: async (groupName) => {
      const currentOrdered = getOrderedIdentifiersFromList();
      await addPresetGrouping(
        presetName,
        firstIdentifier,
        secondIdentifier,
        groupName,
        currentOrdered,
      );
      clearSelectedEntries();
      applyGroupingToList();
      scheduleApplyGrouping(200);
      notify.success('分组已创建');
    },
    onCancel: () => {
      clearSelectedEntries();
    },
  });
}

export {
  initEntryGrouping,
  destroyEntryGrouping,
  applyGroupingToList,
};
