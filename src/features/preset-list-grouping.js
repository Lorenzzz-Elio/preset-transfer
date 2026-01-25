// 预设列表分组功能
// 类似主题分组和世界书分组，为预设列表添加分组功能
// 使用 select2 库，不带搜索功能

import { getJQuery } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';
import { getPresetTransferSettingsNode, trySaveSillyTavernSettings } from '../core/pt-extension-settings.js';

const STORAGE_KEY = 'pt-preset-list-grouping-state';
const EXTENSION_SETTINGS_KEY = 'presetListGroupingState';
const GROUP_TOKEN_PREFIX = 'g:';
const ITEM_TOKEN_PREFIX = 'p:';
const boundContainers = new Set(); // 用于跟踪已绑定的容器

function closeOpenSelect2InDrawer(drawer) {
  const $ = getJQuery();
  if (!$ || !drawer) return;
  const $drawer = $(drawer);
  const $openSelects = $drawer.find('select.select2-hidden-accessible').filter((_, el) => {
    const instance = $(el).data('select2');
    return typeof instance?.isOpen === 'function' && instance.isOpen();
  });

  $openSelects.each((_, el) => {
    if (typeof $(el).select2 === 'function') {
      $(el).select2('close');
    }
  });
}

/**
 * 为指定容器绑定 select2 自动关闭逻辑
 * @param {string} containerId - 容器的 ID（如 'left-nav-panel' 或 'preset-transfer-modal'）
 * @param {Object} options - 可选配置
 * @param {string} options.requiredClass - 容器必须具有的类名（可选）
 */
export function bindSelect2AutoClose(containerId, options = {}) {
  if (boundContainers.has(containerId) || typeof document === 'undefined') return;
  boundContainers.add(containerId);

  const { requiredClass } = options;

  const handler = (event) => {
    const container = document.getElementById(containerId);
    if (!container) return;

    // 如果指定了必需的类名，检查容器是否具有该类
    if (requiredClass && !container.classList.contains(requiredClass)) return;

    const target = event?.target;
    const inContainer = target instanceof Element && container.contains(target);
    const inDropdown = target instanceof Element && target.closest('.select2-container, .select2-dropdown');

    // 只有在容器内滚动，但不在下拉菜单内时，才关闭 select2
    if (!inContainer) return; // 不在容器内，不处理
    if (inDropdown) return; // 在下拉菜单内，不关闭（允许滚动）
    closeOpenSelect2InDrawer(container); // 在容器内但不在下拉菜单内，关闭
  };

  // 监听 wheel 和 touchmove 事件(用于检测滚动手势)
  document.addEventListener('wheel', handler, { capture: true, passive: true });
  document.addEventListener('touchmove', handler, { capture: true, passive: true });

  // 监听 scroll 事件(用于检测实际的滚动行为)
  // 使用 capture 阶段捕获所有滚动事件
  document.addEventListener('scroll', handler, { capture: true, passive: true });
}

/**
 * 从存储中加载预设列表分组状态
 * @returns {Object} - 分组状态对象 { groups: {}, order: [], collapsed: {} }
 */
export function loadPresetListGroupState() {
  // 优先使用 SillyTavern 的服务器同步设置
  try {
    const { node } = getPresetTransferSettingsNode();
    const shared = node?.[EXTENSION_SETTINGS_KEY];
    if (shared && typeof shared === 'object') {
      return normalizeGroupState(shared);
    }
  } catch {
    // 回退到 localStorage
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { groups: {}, order: [], collapsed: {} };
    const parsed = JSON.parse(raw);
    return normalizeGroupState(parsed);
  } catch {
    return { groups: {}, order: [], collapsed: {} };
  }
}

/**
 * 保存预设列表分组状态到存储
 * @param {Object} state - 分组状态对象
 */
export function savePresetListGroupState(state) {
  const normalized = normalizeGroupState(state);

  // 优先保存到服务器同步设置
  try {
    const { context, node } = getPresetTransferSettingsNode({ create: true });
    if (node) {
      node[EXTENSION_SETTINGS_KEY] = normalized;
      trySaveSillyTavernSettings(context);
    }
  } catch {
    // 忽略错误
  }

  // 保留 localStorage 以向后兼容
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // 忽略错误
  }
}

/**
 * 规范化分组状态对象
 * @param {Object} raw - 原始状态对象
 * @returns {Object} - 规范化后的状态对象
 */
function normalizeGroupState(raw) {
  const state = raw && typeof raw === 'object' ? raw : {};

  const groups = {};
  const rawGroups = state.groups && typeof state.groups === 'object' ? state.groups : {};
  for (const [name, members] of Object.entries(rawGroups)) {
    const groupName = String(name ?? '').trim();
    if (!groupName) continue;

    const arr = Array.isArray(members) ? members : [];
    const out = [];
    const seen = new Set();
    for (const m of arr) {
      const t = String(m ?? '').trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    groups[groupName] = out;
  }

  const order = Array.isArray(state.order) ? state.order.map((t) => String(t ?? '').trim()).filter(Boolean) : [];

  const collapsed = {};
  const rawCollapsed = state.collapsed && typeof state.collapsed === 'object' ? state.collapsed : {};
  for (const [name, value] of Object.entries(rawCollapsed)) {
    const groupName = String(name ?? '').trim();
    if (!groupName) continue;
    collapsed[groupName] = !!value;
  }

  return { groups, order, collapsed };
}

export function normalizePresetListGroupState(raw) {
  return normalizeGroupState(raw);
}

function groupToken(name) {
  const trimmed = String(name ?? '').trim();
  return trimmed ? `${GROUP_TOKEN_PREFIX}${trimmed}` : '';
}

function itemToken(name) {
  const trimmed = String(name ?? '').trim();
  return trimmed ? `${ITEM_TOKEN_PREFIX}${trimmed}` : '';
}

function parseOrderToken(raw) {
  const token = String(raw ?? '').trim();
  if (!token) return { type: 'empty', value: '' };
  if (token.startsWith(GROUP_TOKEN_PREFIX)) return { type: 'group', value: token.slice(GROUP_TOKEN_PREFIX.length).trim() };
  if (token.startsWith(ITEM_TOKEN_PREFIX)) return { type: 'item', value: token.slice(ITEM_TOKEN_PREFIX.length).trim() };
  return { type: 'unknown', value: token };
}

function normalizeNameList(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const name = String(raw ?? '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function setPresetListGroupOrder(state, orderTokens) {
  const next = normalizeGroupState(state);
  const order = Array.isArray(orderTokens) ? orderTokens : [];
  const out = [];
  const seen = new Set();
  const groups = next.groups || {};
  const groupedNames = new Set();
  for (const members of Object.values(groups)) {
    for (const name of Array.isArray(members) ? members : []) {
      const trimmed = String(name ?? '').trim();
      if (trimmed) groupedNames.add(trimmed);
    }
  }

  for (const raw of order) {
    const parsed = parseOrderToken(raw);
    if (parsed.type === 'group') {
      const name = String(parsed.value ?? '').trim();
      const token = groupToken(name);
      if (!token || !groups[name] || seen.has(token)) continue;
      seen.add(token);
      out.push(token);
      continue;
    }

    if (parsed.type === 'item') {
      const name = String(parsed.value ?? '').trim();
      const token = itemToken(name);
      if (!token || groupedNames.has(name) || seen.has(token)) continue;
      seen.add(token);
      out.push(token);
    }
  }

  next.order = out;
  return normalizeGroupState(next);
}

export function setPresetListGroupCollapsed(state, groupName, collapsed) {
  const next = normalizeGroupState(state);
  const name = String(groupName ?? '').trim();
  if (!name) return next;
  if (!next.collapsed || typeof next.collapsed !== 'object') next.collapsed = {};
  next.collapsed[name] = !!collapsed;
  return normalizeGroupState(next);
}

export function prunePresetListGroupState(state, existingNamesSet) {
  const next = normalizeGroupState(state);
  const existing = new Set(
    Array.isArray(existingNamesSet)
      ? existingNamesSet.map((x) => String(x ?? '').trim()).filter(Boolean)
      : existingNamesSet instanceof Set
      ? Array.from(existingNamesSet).map((x) => String(x ?? '').trim()).filter(Boolean)
      : [],
  );

  const grouped = new Set();
  for (const [groupName, members] of Object.entries(next.groups || {})) {
    const filtered = normalizeNameList(members).filter((name) => existing.has(name));
    next.groups[groupName] = filtered;
    for (const name of filtered) grouped.add(name);
  }

  for (const name of Object.keys(next.collapsed || {})) {
    if (!next.groups[name]) delete next.collapsed[name];
  }

  const order = [];
  const seen = new Set();
  const rawOrder = Array.isArray(next.order) ? next.order : [];
  for (const raw of rawOrder) {
    const parsed = parseOrderToken(raw);
    if (parsed.type === 'group') {
      const name = String(parsed.value ?? '').trim();
      const token = groupToken(name);
      if (!token || !next.groups[name] || seen.has(token)) continue;
      seen.add(token);
      order.push(token);
      continue;
    }

    if (parsed.type === 'item') {
      const name = String(parsed.value ?? '').trim();
      const token = itemToken(name);
      if (!token || !existing.has(name) || grouped.has(name) || seen.has(token)) continue;
      seen.add(token);
      order.push(token);
    }
  }

  for (const groupName of Object.keys(next.groups || {})) {
    const token = groupToken(groupName);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    order.push(token);
  }

  next.order = order;
  return normalizeGroupState(next);
}

export function removePresetsFromAllGroups(state, presetNames) {
  const next = normalizeGroupState(state);
  const targets = new Set(normalizeNameList(presetNames));
  if (!targets.size) return next;

  for (const [groupName, members] of Object.entries(next.groups || {})) {
    if (!Array.isArray(members)) continue;
    next.groups[groupName] = members.filter((name) => !targets.has(String(name ?? '').trim()));
  }

  const grouped = new Set();
  for (const members of Object.values(next.groups || {})) {
    for (const name of Array.isArray(members) ? members : []) {
      const trimmed = String(name ?? '').trim();
      if (trimmed) grouped.add(trimmed);
    }
  }

  const order = Array.isArray(next.order) ? next.order.slice() : [];
  const tokens = new Set(order);
  for (const name of targets) {
    if (grouped.has(name)) continue;
    const token = itemToken(name);
    if (token && !tokens.has(token)) {
      tokens.add(token);
      order.push(token);
    }
  }

  next.order = order;
  return normalizeGroupState(next);
}

export function assignPresetsToGroup(state, { presetNames, groupName }) {
  const trimmedGroup = String(groupName ?? '').trim();
  if (!trimmedGroup) return normalizeGroupState(state);

  let next = normalizeGroupState(state);
  const targets = normalizeNameList(presetNames);
  if (!targets.length) return next;

  next = removePresetsFromAllGroups(next, targets);

  if (!next.groups || typeof next.groups !== 'object') next.groups = {};
  if (!Array.isArray(next.groups[trimmedGroup])) next.groups[trimmedGroup] = [];
  if (!next.collapsed || typeof next.collapsed !== 'object') next.collapsed = {};
  if (typeof next.collapsed[trimmedGroup] !== 'boolean') next.collapsed[trimmedGroup] = false;

  const existingMembers = normalizeNameList(next.groups[trimmedGroup]);
  const seen = new Set(existingMembers);
  for (const name of targets) {
    if (seen.has(name)) continue;
    seen.add(name);
    existingMembers.push(name);
  }
  next.groups[trimmedGroup] = existingMembers;

  const groupTok = groupToken(trimmedGroup);
  if (groupTok && !next.order.includes(groupTok)) next.order.push(groupTok);

  next.order = (Array.isArray(next.order) ? next.order : []).filter((raw) => {
    const parsed = parseOrderToken(raw);
    if (parsed.type !== 'item') return true;
    return !targets.includes(String(parsed.value ?? '').trim());
  });

  return normalizeGroupState(next);
}

export function renamePresetListGroupInState(state, oldName, newName) {
  const next = normalizeGroupState(state);
  const oldTrimmed = String(oldName ?? '').trim();
  const newTrimmed = String(newName ?? '').trim();
  if (!oldTrimmed || !newTrimmed || oldTrimmed === newTrimmed) return next;
  if (!next.groups[oldTrimmed] || next.groups[newTrimmed]) return next;

  const members = next.groups[oldTrimmed];
  next.groups[newTrimmed] = Array.isArray(members) ? members.slice() : [];
  delete next.groups[oldTrimmed];

  if (!next.collapsed || typeof next.collapsed !== 'object') next.collapsed = {};
  if (Object.prototype.hasOwnProperty.call(next.collapsed, oldTrimmed)) {
    next.collapsed[newTrimmed] = next.collapsed[oldTrimmed];
    delete next.collapsed[oldTrimmed];
  }

  const oldTok = groupToken(oldTrimmed);
  const newTok = groupToken(newTrimmed);
  next.order = (Array.isArray(next.order) ? next.order : []).map((raw) => {
    const parsed = parseOrderToken(raw);
    if (parsed.type === 'group' && String(parsed.value ?? '').trim() === oldTrimmed) return newTok;
    return raw;
  });

  if (newTok && !next.order.includes(newTok)) next.order.push(newTok);
  if (oldTok) next.order = next.order.filter((token) => token !== oldTok);

  return normalizeGroupState(next);
}

export function deletePresetListGroupInState(state, groupName) {
  const next = normalizeGroupState(state);
  const trimmed = String(groupName ?? '').trim();
  if (!trimmed || !next.groups[trimmed]) return next;

  const members = Array.isArray(next.groups[trimmed]) ? next.groups[trimmed] : [];
  delete next.groups[trimmed];
  if (next.collapsed && Object.prototype.hasOwnProperty.call(next.collapsed, trimmed)) {
    delete next.collapsed[trimmed];
  }

  const order = Array.isArray(next.order) ? next.order.slice() : [];
  const orderSet = new Set(order);
  for (const name of normalizeNameList(members)) {
    const token = itemToken(name);
    if (token && !orderSet.has(token)) {
      orderSet.add(token);
      order.push(token);
    }
  }

  const tok = groupToken(trimmed);
  next.order = order.filter((raw) => raw !== tok);

  return normalizeGroupState(next);
}

/**
 * 创建新分组
 * @param {string} groupName - 分组名称
 * @returns {boolean} - 是否成功
 */
export function createPresetListGroup(groupName) {
  const name = String(groupName ?? '').trim();
  if (!name) return false;

  const state = normalizeGroupState(loadPresetListGroupState());
  if (state.groups[name]) return false;

  state.groups[name] = [];
  state.collapsed[name] = false;
  const groupTok = groupToken(name);
  state.order = Array.isArray(state.order) ? state.order.filter((item) => item !== groupTok) : [];
  state.order.unshift(groupTok);

  savePresetListGroupState(normalizeGroupState(state));
  return true;
}

/**
 * 删除分组
 * @param {string} groupName - 分组名称
 * @returns {boolean} - 是否成功
 */
export function deletePresetListGroup(groupName) {
  const name = String(groupName ?? '').trim();
  if (!name) return false;

  const state = normalizeGroupState(loadPresetListGroupState());
  if (!state.groups[name]) return false;

  const next = deletePresetListGroupInState(state, name);
  savePresetListGroupState(next);
  return true;
}

/**
 * 重命名分组
 * @param {string} oldName - 旧名称
 * @param {string} newName - 新名称
 * @returns {boolean} - 是否成功
 */
export function renamePresetListGroup(oldName, newName) {
  const old = String(oldName ?? '').trim();
  const name = String(newName ?? '').trim();

  if (!name || old === name) return false;

  const state = normalizeGroupState(loadPresetListGroupState());
  if (!state.groups[old] || state.groups[name]) return false;

  const next = renamePresetListGroupInState(state, old, name);
  savePresetListGroupState(next);
  return true;
}

/**
 * 将预设添加到分组
 * @param {string} presetName - 预设名称
 * @param {string} groupName - 分组名称
 * @returns {boolean} - 是否成功
 */
export function addPresetToGroup(presetName, groupName) {
  const preset = String(presetName ?? '').trim();
  const group = String(groupName ?? '').trim();
  if (!preset || !group) return false;

  const state = normalizeGroupState(loadPresetListGroupState());
  if (!state.groups[group]) return false;

  const next = assignPresetsToGroup(state, { presetNames: [preset], groupName: group });
  savePresetListGroupState(next);
  return true;
}

/**
 * 从分组中移除预设
 * @param {string} presetName - 预设名称
 * @returns {boolean} - 是否成功
 */
export function removePresetFromGroup(presetName) {
  const preset = String(presetName ?? '').trim();
  if (!preset) return false;

  const state = normalizeGroupState(loadPresetListGroupState());
  const next = removePresetsFromAllGroups(state, [preset]);
  savePresetListGroupState(next);
  return true;
}

/**
 * 初始化预设列表分组功能
 * @param {string} selectSelector - select 元素的选择器
 */
export function initPresetListGrouping(selectSelector) {
  const $ = getJQuery();

  if (!$?.fn?.select2) {
    console.warn('[PresetListGrouping] Select2 not available');
    return false;
  }

  const $select = $(selectSelector);
  if (!$select.length) {
    console.warn('[PresetListGrouping] Select element not found:', selectSelector);
    return false;
  }

  // 初始化 Select2（不带搜索功能）
  if (!$select.data('select2')) {
    $select.select2({
      width: 'resolve', // 使用元素原有的宽度，而不是强制 100%
      minimumResultsForSearch: Infinity, // 禁用搜索
      dropdownAutoWidth: true,
      dropdownCssClass: 'pt-preset-list-dropdown',
    });
  }

  // 根据所在容器绑定相应的自动关闭逻辑
  const containerConfigs = [
    { id: 'left-nav-panel', requiredClass: 'openDrawer' },
    { id: 'preset-transfer-modal' },
    { id: 'dialogue_popup' }, // 用户设置界面（包含主题选择器）
    { id: 'world_popup' }, // 世界书弹窗
    { id: 'WIMultiSelector' }, // 世界书多选器
  ];

  for (const config of containerConfigs) {
    if ($select.closest(`#${config.id}`).length) {
      bindSelect2AutoClose(config.id, config.requiredClass ? { requiredClass: config.requiredClass } : {});
      break; // 找到第一个匹配的容器就停止
    }
  }

  // 应用主题变量
  const vars = CommonStyles.getVars();
  if ($select[0]) {
    $select[0].style.setProperty('--pt-section-bg', vars.sectionBg);
    $select[0].style.setProperty('--pt-border', vars.borderColor);
    $select[0].style.setProperty('--pt-text', vars.textColor);
    $select[0].style.setProperty('--pt-tip', vars.tipColor);
  }

  // 绑定事件处理器
  installPresetListGroupingHandlers($select[0]);

  console.log('[PresetListGrouping] Initialized successfully');
  return true;
}

/**
 * 安装事件处理器
 * @param {HTMLElement} selectEl - select 元素
 */
function installPresetListGroupingHandlers(selectEl) {
  const $ = getJQuery();
  const $select = $(selectEl);

  if ($select.data('ptPresetListGroupingBound')) return;
  $select.data('ptPresetListGroupingBound', true);

  $select
    .off('select2:open.pt-preset-list-grouping')
    .on('select2:open.pt-preset-list-grouping', () => {
      setTimeout(() => {
        regroupOpenSelect2Results(selectEl);

        // 确保滚动容器可以滚动
        const $drawer = $select.closest('.drawer-content');
        if ($drawer.length) {
          // 允许滚动事件传播
          const $dropdown = $('.select2-dropdown');
          if ($dropdown.length) {
            let lastTouchY = null;

            $dropdown.on('touchstart.pt-scroll', function(e) {
              const touch = e.originalEvent?.touches?.[0];
              lastTouchY = touch ? touch.clientY : null;
            });

            $dropdown.on('touchend.pt-scroll touchcancel.pt-scroll', function() {
              lastTouchY = null;
            });

            $dropdown.on('wheel.pt-scroll touchmove.pt-scroll', function(e) {
              // 只在下拉菜单内部滚动时阻止，否则允许传播到父容器
              const $target = $(e.target);
              const $results = $target.closest('.select2-results');

              if ($results.length) {
                // 在下拉菜单内部，检查是否可以滚动
                const canScrollDown = $results[0].scrollHeight > $results[0].clientHeight &&
                                     $results[0].scrollTop < $results[0].scrollHeight - $results[0].clientHeight;
                const canScrollUp = $results[0].scrollTop > 0;

                let delta = 0;
                if (e.type === 'touchmove') {
                  const touch = e.originalEvent?.touches?.[0];
                  if (!touch) return;
                  if (lastTouchY === null) {
                    lastTouchY = touch.clientY;
                    return;
                  }
                  delta = lastTouchY - touch.clientY;
                  lastTouchY = touch.clientY;
                } else {
                  delta = typeof e.originalEvent?.deltaY === 'number' ? e.originalEvent.deltaY : 0;
                }

                if (delta === 0) return;

                if ((delta > 0 && !canScrollDown) || (delta < 0 && !canScrollUp)) {
                  // 下拉菜单已经滚动到底部或顶部，允许事件传播到父容器
                  return true;
                }

                // 下拉菜单内部可以滚动，阻止传播
                e.stopPropagation();
              }
              // 不在下拉菜单内部，允许传播到父容器
            });
          }
        }
      }, 0);
    })
    .off('select2:close.pt-preset-list-grouping')
    .on('select2:close.pt-preset-list-grouping', () => {
      // 清理事件监听器
      $('.select2-dropdown').off('.pt-scroll');
    });
}

/**
 * 重新组织 Select2 下拉列表中的选项
 * @param {HTMLElement} selectEl - select 元素
 */
function regroupOpenSelect2Results(selectEl) {
  const $ = getJQuery();
  const $select = $(selectEl);
  const instance = $select.data('select2');
  const $dropdown = instance?.$dropdown ? $(instance.$dropdown) : $('.select2-container--open .select2-dropdown').first();

  if (!$dropdown?.length) return;

  const $results = $dropdown.find('.select2-results__options').first();
  if (!$results?.length) return;

  const state = normalizePresetListGroupState(loadPresetListGroupState());

  // 获取所有选项
  const optionItems = $results.find('li.select2-results__option').detach().toArray();

  if (!optionItems.length) return;

  // 构建预设名称到元素的映射
  const byPresetName = new Map();
  for (const li of optionItems) {
    const $li = $(li);
    const presetName = String($li.text() ?? '').trim();
    if (presetName) byPresetName.set(presetName, li);
  }

  // 构建已分组的预设集合
  const groupedPresets = new Set();
  const groupMembers = new Map();
  for (const [groupName, members] of Object.entries(state.groups || {})) {
    const normalized = normalizeNameList(members).filter((name) => byPresetName.has(name));
    groupMembers.set(groupName, normalized);
    for (const name of normalized) groupedPresets.add(name);
  }

  const nodes = [];
  const renderedGroups = new Set();
  const renderedItems = new Set();

  const renderGroup = (groupName) => {
    const name = String(groupName ?? '').trim();
    if (!name || renderedGroups.has(name)) return;
    renderedGroups.add(name);

    const members = groupMembers.get(name) || [];
    if (!members.length) return;

    const isCollapsed = state.collapsed?.[name] || false;
    const expanded = !isCollapsed;

    const group = document.createElement('li');
    group.className = 'select2-results__option select2-results__option--group pt-preset-list-group';
    group.setAttribute('role', 'group');
    group.setAttribute('data-pt-group', name);

    const strong = document.createElement('strong');
    strong.className = 'select2-results__group';
    strong.textContent = `${name} (${members.length})`;
    strong.style.cursor = 'pointer';

    const list = document.createElement('ul');
    list.className = 'select2-results__options select2-results__options--nested';
    list.setAttribute('role', 'none');
    list.style.display = expanded ? '' : 'none';

    for (const presetName of members) {
      const li = byPresetName.get(presetName);
      if (li) list.appendChild(li);
    }

    group.appendChild(strong);
    group.appendChild(list);
    nodes.push(group);

    $(strong).on('click', function (e) {
      e.preventDefault();
      e.stopPropagation();

      const nextExpanded = list.style.display === 'none';
      list.style.display = nextExpanded ? '' : 'none';

      const nextState = setPresetListGroupCollapsed(loadPresetListGroupState(), name, !nextExpanded);
      savePresetListGroupState(nextState);
    });
  };

  const renderItem = (presetName) => {
    const name = String(presetName ?? '').trim();
    if (!name || renderedItems.has(name)) return;
    const li = byPresetName.get(name);
    if (!li) return;
    renderedItems.add(name);
    nodes.push(li);
  };

  const order = Array.isArray(state.order) ? state.order : [];
  for (const raw of order) {
    const parsed = parseOrderToken(raw);
    if (parsed.type === 'group') {
      renderGroup(parsed.value);
      continue;
    }
    if (parsed.type === 'item') {
      if (groupedPresets.has(parsed.value)) continue;
      renderItem(parsed.value);
    }
  }

  for (const groupName of groupMembers.keys()) {
    renderGroup(groupName);
  }

  for (const [presetName] of byPresetName) {
    if (groupedPresets.has(presetName)) continue;
    renderItem(presetName);
  }

  // 清空并重新填充
  $results.empty();
  for (const node of nodes) $results.append(node);
}

let openAiGroupingObserver = null;
let openAiGroupingRetryTimer = null;
let openAiGroupingAttempts = 0;

export function initPresetListGroupingForOpenAiSettings({
  selector = '#settings_preset_openai',
  maxAttempts = 12,
  intervalMs = 500,
} = {}) {
  const tryInit = () => {
    const $ = getJQuery();
    if (!$?.fn?.select2) return false;
    const $select = $(selector);
    if (!$select.length) return false;

    const ok = initPresetListGrouping(selector);
    if (ok) {
      if (openAiGroupingObserver) {
        openAiGroupingObserver.disconnect();
        openAiGroupingObserver = null;
      }
      if (openAiGroupingRetryTimer) {
        clearTimeout(openAiGroupingRetryTimer);
        openAiGroupingRetryTimer = null;
      }
      openAiGroupingAttempts = 0;
    }
    return ok;
  };

  if (tryInit()) return true;

  if (!openAiGroupingObserver && typeof MutationObserver !== 'undefined') {
    openAiGroupingObserver = new MutationObserver(() => {
      if (tryInit()) return;
    });

    const root = document.documentElement || document.body;
    if (root) {
      openAiGroupingObserver.observe(root, { childList: true, subtree: true });
    }
  }

  if (!openAiGroupingRetryTimer) {
    openAiGroupingRetryTimer = setTimeout(function tick() {
      if (tryInit()) return;
      openAiGroupingAttempts += 1;
      if (openAiGroupingAttempts >= maxAttempts) {
        if (openAiGroupingRetryTimer) {
          clearTimeout(openAiGroupingRetryTimer);
          openAiGroupingRetryTimer = null;
        }
        return;
      }
      openAiGroupingRetryTimer = setTimeout(tick, intervalMs);
    }, intervalMs);
  }

  return false;
}

/**
 * 销毁预设列表分组功能
 * @param {string} selectSelector - select 元素的选择器
 */
export function destroyPresetListGrouping(selectSelector) {
  const $ = getJQuery();
  const $select = $(selectSelector);

  if (!$select.length) return;

  $select.removeData('ptPresetListGroupingBound');
  $select.off('.pt-preset-list-grouping');

  console.log('[PresetListGrouping] Destroyed');
}
