// 预设条目分组功能 - UI逻辑

import { PT } from '../core/api-compat.js';
import { debounce, ensureViewportCssVars, getJQuery, getSillyTavernContext } from '../core/utils.js';
import { getAllPresetGroupings, addPresetGrouping, updatePresetGrouping, removePresetGrouping } from '../features/entry-grouping.js';
import { CommonStyles } from '../styles/common-styles.js';

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

function computeGroupingSignature(presetName, orderedIdentifiers, groupings) {
  const listKey = orderedIdentifiers.join('\u001f');
  const groupingKey = groupings
    .map((g) => [
      g?.name ?? '',
      g?.startIdentifier ?? '',
      g?.endIdentifier ?? '',
      g?.mode ?? '',
      g?.unresolved ? '1' : '0',
      typeof g?.legacyStartIndex === 'number' ? String(g.legacyStartIndex) : '',
      typeof g?.legacyEndIndex === 'number' ? String(g.legacyEndIndex) : '',
    ].join('\u001e'))
    .join('\u001d');

  return `${presetName}\u001c${listKey}\u001c${groupingKey}`;
}

function hasGroupingUi(listContainer) {
  return !!listContainer.find('.pt-entry-group-header, .entry-group-header').length;
}

function cleanupGroupingUi(listContainer) {
  listContainer.find('.pt-entry-group-wrapper, .entry-group-wrapper').contents().unwrap();
  listContainer.find('.pt-entry-group-header, .entry-group-header').remove();
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
    if (typeof g.startIdentifier !== 'string' || typeof g.endIdentifier !== 'string') continue;
    const startIndex = orderedIdentifiers.indexOf(g.startIdentifier);
    const endIndex = orderedIdentifiers.indexOf(g.endIdentifier);
    if (startIndex === -1 || endIndex === -1) continue;

    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    for (let i = start; i <= end; i++) {
      const id = orderedIdentifiers[i];
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
      const wrapper = $header.next('.pt-entry-group-wrapper, .entry-group-wrapper');
      const isExpanded = wrapper.is(':visible');
      if (groupIndex !== undefined) {
        groupExpandStates.set(`${presetName}-${groupIndex}`, isExpanded);
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
      toastr.warning(`有 ${unresolvedCount} 个分组无法解析（已跳过）`);
    }

    const resolvedGroupings = groupings
      .map((g, index) => ({ ...g, originalIndex: index }))
      .filter((g) => !g.unresolved && typeof g.startIdentifier === 'string' && typeof g.endIdentifier === 'string')
      .map((g) => {
        const startIndex = orderedIdentifiers.indexOf(g.startIdentifier);
        const endIndex = orderedIdentifiers.indexOf(g.endIdentifier);
        if (startIndex === -1 || endIndex === -1) return null;
        return { ...g, startIndex, endIndex };
      })
      .filter(Boolean)
      // 按照 start/end 的较小索引排序，从后往前应用（避免索引变化）
      .sort((a, b) => Math.min(b.startIndex, b.endIndex) - Math.min(a.startIndex, a.endIndex));
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
      const start = Math.min(grouping.startIndex, grouping.endIndex);
      const end = Math.max(grouping.startIndex, grouping.endIndex);

      if (start < 0 || end >= items.length) continue;

      createGroupUI(items.slice(start, end + 1), grouping, presetName, grouping.originalIndex);
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

  // 检查是否应该展开（默认折叠）
  const stateKey = `${presetName}-${groupIndex}`;
  const shouldExpand = groupExpandStates.get(stateKey) || false;

  const groupHeader = $(`
    <div class="pt-entry-group-header${shouldExpand ? ' is-expanded' : ''}">
      <span class="pt-entry-group-toggle" aria-hidden="true"></span>
      <span class="pt-entry-group-name"></span>
      <span class="pt-entry-group-count"></span>
      <button class="menu_button pt-icon-btn pt-entry-group-edit-btn" title="编辑分组" aria-label="编辑分组">
        <span title="edit" class="fa-solid fa-pencil"></span>
      </button>
      <button class="menu_button pt-icon-btn pt-entry-group-clear-btn" title="删除分组" aria-label="删除分组">
        <i class="fa-fw fa-solid fa-trash-can"></i>
      </button>
    </div>
  `);
  groupHeader.find('.pt-entry-group-name').text(grouping.name || '分组');
  groupHeader.find('.pt-entry-group-count').text(String(groupItems.length));

  // 保存 groupIndex 到 header 的 data 属性
  groupHeader.data('group-index', groupIndex);

  const groupWrapper = $(`<div class="pt-entry-group-wrapper${shouldExpand ? ' is-expanded' : ''}"></div>`);

  $firstItem.before(groupHeader);
  $(groupItems).wrapAll(groupWrapper);

  // 折叠/展开
  groupHeader.find('.pt-entry-group-toggle, .pt-entry-group-name, .pt-entry-group-count').on('click', () => {
    const wrapper = groupHeader.next('.pt-entry-group-wrapper');
    const willBeExpanded = !groupHeader.hasClass('is-expanded');
    groupHeader.toggleClass('is-expanded', willBeExpanded);
    wrapper.toggleClass('is-expanded', willBeExpanded);
    groupExpandStates.set(stateKey, willBeExpanded);
  });

  // 编辑分组名称
  groupHeader.find('.pt-entry-group-edit-btn').on('click', (e) => {
    e.stopPropagation();
    showInputDialog('请输入分组名称', grouping.name || '分组', async (newName) => {
      if (newName !== grouping.name) {
        await updatePresetGrouping(
          presetName,
          groupIndex,
          grouping.startIdentifier,
          grouping.endIdentifier,
          newName,
          getOrderedIdentifiersFromList(),
        );
        setTimeout(() => applyGroupingToList(), 200);
        if (window.toastr) toastr.success('分组名称已更新');
      }
    });
  });

  // 清除分组
  groupHeader.find('.pt-entry-group-clear-btn').on('click', async (e) => {
    e.stopPropagation();
    if (confirm('确定要取消这个分组吗？')) {
      await removePresetGrouping(presetName, groupIndex, getOrderedIdentifiersFromList());
      resetTempMarks();
      setTimeout(() => applyGroupingToList(), 200);
      if (window.toastr) toastr.success('分组已取消');
    }
  });
}

// 绑定三连击事件
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
      if ($target.closest('.prompt-manager-toggle-action, .prompt-manager-edit-action, .prompt-manager-detach-action, .prompt-manager-inspect-action, .pt-entry-group-edit-btn, .pt-entry-group-clear-btn, .group-edit-btn, .group-clear-btn').length) {
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
        <input type="text" class="dialog-input" value="${defaultValue}" style="
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

  // Append into the native panel container to avoid triggering the host "click outside closes panel" logic.
  const panelContainer = findPanelContainer();
  (panelContainer.length ? panelContainer : $('body')).append(dialog);

  // Host panel close logic may be bound on mousedown/pointerdown, so stop early.
  dialog.on('pointerdown mousedown click', (e) => e.stopPropagation());
  dialog.children().first().on('pointerdown mousedown click', (e) => e.stopPropagation());
  dialog.find('.dialog-input').focus().select();

  const closeDialog = (shouldCallback) => {
    const value = dialog.find('.dialog-input').val();
    dialog.remove();
    if (shouldCallback && value) callback(value);
  };

  dialog.find('.dialog-confirm').on('click', () => closeDialog(true));
  dialog.find('.dialog-cancel').on('click', () => closeDialog(false));
  dialog.find('.dialog-input').on('keypress', (e) => {
    if (e.key === 'Enter') closeDialog(true);
  });
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
