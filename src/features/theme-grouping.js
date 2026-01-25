// UI主题分组功能
import { debounce, getJQuery } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';
import { getPresetTransferSettingsNode, trySaveSillyTavernSettings } from '../core/pt-extension-settings.js';
import { bindSelect2AutoClose } from './preset-list-grouping.js';

const STORAGE_KEY = 'pt-theme-grouping-state';
const EXTENSION_SETTINGS_KEY = 'themeGroupingState';
const openResultsObservers = new WeakMap();
const lastRegroupAt = new WeakMap();
const batchSelections = new WeakMap();

function getThemeBatchSelection(selectEl) {
  let set = batchSelections.get(selectEl);
  if (!set) {
    set = new Set();
    batchSelections.set(selectEl, set);
  }
  return set;
}

function clearThemeBatchSelection(selectEl) {
  const set = batchSelections.get(selectEl);
  if (!set || set.size === 0) return;
  set.clear();

  try {
    const $ = getJQuery();
    const $results = getOpenSelect2ResultsRoot(selectEl);
    if ($results?.length) {
      $results.find('.pt-theme-batch-toggle').attr('aria-checked', 'false');
      $results.find('li.pt-theme-batch-selected').removeClass('pt-theme-batch-selected');
    }
  } catch {
    /* ignore */
  }
}

function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function readSharedStateRaw() {
  try {
    const { node } = getPresetTransferSettingsNode();
    if (!node) return null;
    return node[EXTENSION_SETTINGS_KEY] ?? null;
  } catch {
    return null;
  }
}

function writeSharedStateRaw(value) {
  try {
    const { context, node } = getPresetTransferSettingsNode({ create: true });
    if (!node) return false;
    node[EXTENSION_SETTINGS_KEY] = value;
    trySaveSillyTavernSettings(context);
    return true;
  } catch {
    return false;
  }
}

function normalizeThemeGroupStateForStorage(raw) {
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

function parseMaybeJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') return raw;
  return null;
}

function sanitizeThemeLabel(raw) {
  return String(raw ?? '')
    .replace(/[?⋮]/g, '')
    .trim();
}

function getThemesOptionMaps(selectEl) {
  const $ = getJQuery();
  const $select = $(selectEl);
  const valueToText = new Map();
  const textToValue = new Map();

  $select.find('option').each((_, opt) => {
    const value = String($(opt).val() ?? '').trim();
    const text = String($(opt).text() ?? '').trim();
    if (!value || !text) return;

    valueToText.set(value, text);
    if (!textToValue.has(text)) {
      textToValue.set(text, value);
    }
  });

  return { valueToText, textToValue };
}

function getThemeLabelFromResultItem(li) {
  if (!li) return '';

  try {
    const clone = li.cloneNode(true);
    clone.querySelectorAll?.('.pt-theme-menu, .pt-theme-batch-toggle')?.forEach?.((el) => el.remove());
    return sanitizeThemeLabel(clone.textContent);
  } catch {
    return sanitizeThemeLabel(li.textContent);
  }
}

function resolveThemeValueFromResultItem(li, selectEl, maps) {
  const $ = getJQuery();
  const $li = $(li);

  const existing = String($li.attr('data-pt-theme') ?? '').trim();
  if (existing) return existing;

  // Some Select2 builds set aria-label/data-select2-id to the option value; accept only if known.
  const ariaLabel = String($li.attr('aria-label') ?? '').trim();
  if (ariaLabel && maps.valueToText.has(ariaLabel)) return ariaLabel;

  const select2Id = String($li.attr('data-select2-id') ?? '').trim();
  if (select2Id && maps.valueToText.has(select2Id)) return select2Id;

  const label = getThemeLabelFromResultItem(li);
  const mapped = maps.textToValue.get(label);
  if (mapped) return mapped;

  // Fallback to sanitized text (keeps UI functional even if mapping fails).
  return label || sanitizeThemeLabel($li.text());
}

function normalizeThemeKey(raw, { maps, aliases }) {
  const key = String(raw ?? '').trim();
  if (!key) return null;

  if (aliases?.has?.(key)) return aliases.get(key);
  if (maps?.valueToText?.has?.(key)) return key;

  const cleaned = sanitizeThemeLabel(key);
  if (aliases?.has?.(cleaned)) return aliases.get(cleaned);

  const byText = maps?.textToValue?.get?.(key) ?? maps?.textToValue?.get?.(cleaned);
  if (byText) return byText;

  return cleaned || key;
}

function normalizeThemeGroupState(groupState, { maps, aliases }) {
  const next = {
    groups: groupState?.groups && typeof groupState.groups === 'object' ? groupState.groups : {},
    order: Array.isArray(groupState?.order) ? groupState.order : [],
    collapsed: groupState?.collapsed && typeof groupState.collapsed === 'object' ? groupState.collapsed : {},
  };

  let changed = false;

  const newGroups = {};
  for (const [groupName, members] of Object.entries(next.groups)) {
    const rawMembers = Array.isArray(members) ? members : [];
    const normalized = [];
    const seen = new Set();
    for (const m of rawMembers) {
      const resolved = normalizeThemeKey(m, { maps, aliases });
      if (!resolved || seen.has(resolved)) {
        if (resolved) changed = true;
        continue;
      }
      seen.add(resolved);
      normalized.push(resolved);
      if (String(m ?? '') !== resolved) changed = true;
    }
    newGroups[groupName] = normalized;
    if (!Array.isArray(members)) changed = true;
  }

  const newOrder = [];
  for (const token of next.order) {
    const t = String(token ?? '').trim();
    if (!t) {
      changed = true;
      continue;
    }
    if (t.startsWith('g:')) {
      newOrder.push(t);
      continue;
    }
    if (t.startsWith('t:')) {
      const rawKey = t.slice(2);
      const resolved = normalizeThemeKey(rawKey, { maps, aliases });
      if (!resolved) {
        changed = true;
        continue;
      }
      const resolvedToken = `t:${resolved}`;
      newOrder.push(resolvedToken);
      if (resolvedToken !== t) changed = true;
      continue;
    }
    // Drop unknown tokens.
    changed = true;
  }

  next.groups = newGroups;
  next.order = newOrder;

  return { state: next, changed };
}

function getOrCreateCollapseState(selectEl) {
  if (!getOrCreateCollapseState._map) {
    getOrCreateCollapseState._map = new WeakMap();
  }
  const map = getOrCreateCollapseState._map;
  if (map.has(selectEl)) return map.get(selectEl);
  const state = { groupExpanded: new Map() };
  map.set(selectEl, state);
  return state;
}

function loadThemeGroupState() {
  // Prefer SillyTavern's server-synced extensionSettings (cross-device).
  try {
    const rawShared = readSharedStateRaw();
    const parsedShared = parseMaybeJson(rawShared);
    if (parsedShared) {
      const normalized = normalizeThemeGroupStateForStorage(parsedShared);
      // Keep legacy localStorage for backwards-compatibility.
      safeLocalStorageSet(STORAGE_KEY, JSON.stringify(normalized));
      return normalized;
    }
  } catch {
    // fall back to localStorage
  }

  try {
    const raw = safeLocalStorageGet(STORAGE_KEY);
    if (!raw) return { groups: {}, order: [], collapsed: {} };
    const parsed = JSON.parse(raw);
    const normalized = normalizeThemeGroupStateForStorage(parsed);

    // One-time migration: localStorage -> extensionSettings (best effort).
    writeSharedStateRaw(normalized);

    return normalized;
  } catch {
    return { groups: {}, order: [], collapsed: {} };
  }
}

function saveThemeGroupState(state) {
  const normalized = normalizeThemeGroupStateForStorage(state);

  // Prefer server-synced settings so grouping is shared across devices.
  writeSharedStateRaw(normalized);

  // Keep legacy localStorage for backwards-compatibility.
  safeLocalStorageSet(STORAGE_KEY, JSON.stringify(normalized));
}

// Group management functions
export function createGroup(groupName) {
  const state = loadThemeGroupState();
  if (!groupName || state.groups[groupName]) return false;
  state.groups[groupName] = [];
  state.collapsed[groupName] = false;
  const groupToken = `g:${groupName}`;
  state.order = Array.isArray(state.order) ? state.order.filter((item) => item !== groupToken) : [];
  state.order.unshift(groupToken);
  saveThemeGroupState(state);
  return true;
}

export function deleteGroup(groupName) {
  const state = loadThemeGroupState();
  if (!state.groups[groupName]) return false;
  delete state.groups[groupName];
  delete state.collapsed[groupName];
  state.order = state.order.filter(item => item !== `g:${groupName}`);
  saveThemeGroupState(state);
  return true;
}

export function renameGroup(oldName, newName) {
  const state = loadThemeGroupState();
  if (!newName || oldName === newName || !state.groups[oldName] || state.groups[newName]) return false;
  state.groups[newName] = state.groups[oldName];
  state.collapsed[newName] = state.collapsed[oldName];
  delete state.groups[oldName];
  delete state.collapsed[oldName];
  state.order = state.order.map(item => item === `g:${oldName}` ? `g:${newName}` : item);
  saveThemeGroupState(state);
  return true;
}

export function addThemeToGroup(themeName, groupName) {
  const state = loadThemeGroupState();
  if (!state.groups[groupName]) return false;
  // Remove from all groups first
  for (const members of Object.values(state.groups)) {
    const idx = members.indexOf(themeName);
    if (idx !== -1) members.splice(idx, 1);
  }
  // Add to target group
  if (!state.groups[groupName].includes(themeName)) {
    state.groups[groupName].push(themeName);
  }
  // Remove from order if exists
  state.order = state.order.filter(item => item !== `t:${themeName}`);
  saveThemeGroupState(state);
  return true;
}

export function removeThemeFromGroup(themeName) {
  const state = loadThemeGroupState();
  for (const members of Object.values(state.groups)) {
    const idx = members.indexOf(themeName);
    if (idx !== -1) members.splice(idx, 1);
  }
  // Add to order if not exists
  if (!state.order.includes(`t:${themeName}`)) {
    state.order.push(`t:${themeName}`);
  }
  saveThemeGroupState(state);
  return true;
}

function applyThemeVarsToElement(el) {
  if (!el) return;
  const vars = CommonStyles.getVars();
  el.style.setProperty('--pt-section-bg', vars.sectionBg);
  el.style.setProperty('--pt-border', vars.borderColor);
  el.style.setProperty('--pt-text', vars.textColor);
  el.style.setProperty('--pt-tip', vars.tipColor);
}

function isSelect2Initialized($el) {
  return !!$el?.data?.('select2') || $el?.hasClass?.('select2-hidden-accessible');
}

function getOpenSelect2ResultsRoot(selectEl) {
  const $ = getJQuery();
  const $select = $(selectEl);
  const instance = $select.data('select2');
  const $dropdown = instance?.$dropdown ? $(instance.$dropdown) : $('.select2-container--open .select2-dropdown').first();
  if (!$dropdown?.length) return null;
  return $dropdown.find('.select2-results__options').first();
}

function clearInjectedGroups($results) {
  $results.find('.pt-theme-group').remove();
  $results.off('.pt-theme-grouping');
}

function getSelect2SearchValue() {
  const $ = getJQuery();
  const $input = $('.select2-container--open .select2-search__field').first();
  return String($input.val() ?? '').trim();
}

async function regroupOpenSelect2Results(selectEl) {
  const $ = getJQuery();
  const $results = getOpenSelect2ResultsRoot(selectEl);
  if (!$results?.length) return;

  const now = Date.now();
  const last = lastRegroupAt.get(selectEl) ?? 0;
  if (now - last < 40) return;
  lastRegroupAt.set(selectEl, now);

  applyThemeVarsToElement($results[0]);
  $results.addClass('pt-theme-grouping-results');

  const state = getOrCreateCollapseState(selectEl);
  const searchValue = getSelect2SearchValue();
  const forceExpandAll = searchValue.length > 0;

  const observer = openResultsObservers.get(selectEl);
  if (observer) observer.disconnect();

  try {
    const maps = getThemesOptionMaps(selectEl);
    const optionItems = $results
      .find('li.select2-results__option[aria-selected], li.select2-results__option[role="treeitem"], li.select2-results__option[role="option"]')
      .detach()
      .toArray();

    clearInjectedGroups($results);

    if (!optionItems.length) return;

    // Legacy aliases (best-effort): allow mapping from visible labels to option values.
    const aliases = new Map();
    for (const li of optionItems) {
      const label = getThemeLabelFromResultItem(li);
      const mapped = maps.textToValue.get(label);
      if (mapped) aliases.set(label, mapped);
    }

    const byValue = new Map();
    const orderValues = [];
    for (const li of optionItems) {
      const $li = $(li);
      // Avoid duplicating injected menu icons across re-renders.
      $li.find('.pt-theme-menu, .pt-theme-batch-toggle').remove();
      $li.removeClass('pt-theme-batch-selected');
      $li.removeAttr('data-pt-theme data-pt-theme-text');
      const value = resolveThemeValueFromResultItem(li, selectEl, maps);
      if (!value) continue;
      byValue.set(value, li);
      orderValues.push(value);
    }

    let groupState = loadThemeGroupState();
    const normalized = normalizeThemeGroupState(groupState, { maps, aliases });
    if (normalized.changed) {
      groupState = normalized.state;
      saveThemeGroupState(groupState);
    } else {
      groupState = normalized.state;
    }
    const groups = groupState.groups || {};
    const collapsed = groupState.collapsed || {};

    const batchSelection = getThemeBatchSelection(selectEl);

    const createCollapsibleGroupNode = ({ groupKey, title, count, children, expanded }) => {
      const group = document.createElement('li');
      group.className = 'select2-results__option select2-results__option--group pt-theme-group';
      group.setAttribute('role', 'group');
      group.setAttribute('data-pt-group', groupKey);

      const strong = document.createElement('strong');
      strong.className = 'select2-results__group';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'pt-theme-group-title';
      titleSpan.textContent = title;

      const countSpan = document.createElement('span');
      countSpan.className = 'pt-theme-group-count';
      countSpan.textContent = `(${count})`;

      const menuIcon = document.createElement('span');
      menuIcon.className = 'pt-theme-group-menu';
      menuIcon.textContent = '⋮';
      menuIcon.setAttribute('data-group-name', title);

      strong.appendChild(titleSpan);
      strong.appendChild(countSpan);
      strong.appendChild(menuIcon);

      const list = document.createElement('ul');
      list.className = 'select2-results__options select2-results__options--nested';
      list.setAttribute('role', 'none');

      group.classList.toggle('is-expanded', expanded);
      list.style.display = expanded ? '' : 'none';

      for (const child of children) list.appendChild(child);

      group.appendChild(strong);
      group.appendChild(list);
      return group;
    };

    const groupedValues = new Set();
    for (const members of Object.values(groups)) {
      for (const v of members) groupedValues.add(v);
    }
    const ungroupedValues = orderValues.filter(v => !groupedValues.has(v));

    // Build nodes using order array
    const nodes = [];
    const groupNodes = new Map();
    const order = groupState.order || [];

    // Create group nodes
    for (const [groupName, members] of Object.entries(groups)) {
      const groupKey = encodeURIComponent(groupName);
      const isCollapsed = collapsed[groupName] || false;
      const expanded = forceExpandAll || !isCollapsed;

      const children = members.map(v => {
        const li = byValue.get(v);
        if (!li) return null;
        const $li = $(li);
        $li.attr('data-pt-theme', v);
        if (maps.valueToText.has(v)) {
          $li.attr('data-pt-theme-text', maps.valueToText.get(v));
        }
        const isBatchSelected = batchSelection.has(v);
        $li.toggleClass('pt-theme-batch-selected', isBatchSelected);
        const batchToggle = document.createElement('span');
        batchToggle.className = 'pt-theme-batch-toggle';
        batchToggle.setAttribute('role', 'checkbox');
        batchToggle.setAttribute('aria-checked', isBatchSelected ? 'true' : 'false');
        $li.append(batchToggle);
        // Add menu icon to theme option
        const menuIcon = document.createElement('span');
        menuIcon.className = 'pt-theme-menu';
        menuIcon.textContent = '⋮';
        menuIcon.setAttribute('data-theme-name', v);
        menuIcon.setAttribute('data-current-group', groupName);
        $li.append(menuIcon);
        return li;
      }).filter(Boolean);

      const groupNode = createCollapsibleGroupNode({
        groupKey,
        title: groupName,
        count: children.length,
        children,
        expanded,
      });
      groupNodes.set(groupName, groupNode);
    }

    // Add nodes in order
    for (const item of order) {
      if (item.startsWith('g:')) {
        const groupName = item.substring(2);
        const node = groupNodes.get(groupName);
        if (node) {
          nodes.push(node);
          groupNodes.delete(groupName);
        }
      } else if (item.startsWith('t:')) {
        const themeValue = item.substring(2);
        if (!groupedValues.has(themeValue)) {
          const li = byValue.get(themeValue);
          if (li) {
            const $li = $(li);
             $li.attr('data-pt-theme', themeValue);
             if (maps.valueToText.has(themeValue)) {
               $li.attr('data-pt-theme-text', maps.valueToText.get(themeValue));
             }
             const isBatchSelected = batchSelection.has(themeValue);
             $li.toggleClass('pt-theme-batch-selected', isBatchSelected);
             const batchToggle = document.createElement('span');
             batchToggle.className = 'pt-theme-batch-toggle';
             batchToggle.setAttribute('role', 'checkbox');
             batchToggle.setAttribute('aria-checked', isBatchSelected ? 'true' : 'false');
             $li.append(batchToggle);
             // Add menu icon to ungrouped theme
             const menuIcon = document.createElement('span');
             menuIcon.className = 'pt-theme-menu';
            menuIcon.textContent = '⋮';
            menuIcon.setAttribute('data-theme-name', themeValue);
            $li.append(menuIcon);
            nodes.push(li);
          }
        }
      }
    }

    // Add remaining groups not in order
    for (const [groupName, node] of groupNodes) {
      nodes.push(node);
    }

    // Add remaining ungrouped themes not in order
    for (const value of ungroupedValues) {
      if (!order.includes(`t:${value}`)) {
        const li = byValue.get(value);
        if (!li) continue;
        const $li = $(li);
        $li.attr('data-pt-theme', value);
        if (maps.valueToText.has(value)) {
          $li.attr('data-pt-theme-text', maps.valueToText.get(value));
        }
        const isBatchSelected = batchSelection.has(value);
        $li.toggleClass('pt-theme-batch-selected', isBatchSelected);
        const batchToggle = document.createElement('span');
        batchToggle.className = 'pt-theme-batch-toggle';
        batchToggle.setAttribute('role', 'checkbox');
        batchToggle.setAttribute('aria-checked', isBatchSelected ? 'true' : 'false');
        $li.append(batchToggle);
        // Add menu icon to ungrouped theme
        const menuIcon = document.createElement('span');
        menuIcon.className = 'pt-theme-menu';
        menuIcon.textContent = '⋮';
        menuIcon.setAttribute('data-theme-name', value);
        $li.append(menuIcon);
        nodes.push(li);
      }
    }

    const fragment = document.createDocumentFragment();
    for (const node of nodes) fragment.appendChild(node);

    $results.empty().append(fragment);

    $results.on('mousedown.pt-theme-grouping mouseup.pt-theme-grouping touchstart.pt-theme-grouping touchend.pt-theme-grouping pointerdown.pt-theme-grouping pointerup.pt-theme-grouping', '.pt-theme-batch-toggle', function(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return false;
    });

    $results.on('click.pt-theme-grouping', '.pt-theme-batch-toggle', function(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const $li = $(this).closest('li.select2-results__option');
      const themeValue = String($li.attr('data-pt-theme') ?? '').trim();
      if (!themeValue) return false;

      const selected = getThemeBatchSelection(selectEl);
      if (selected.has(themeValue)) {
        selected.delete(themeValue);
      } else {
        selected.add(themeValue);
      }

      const isSelected = selected.has(themeValue);
      $(this).attr('aria-checked', isSelected ? 'true' : 'false');
      $li.toggleClass('pt-theme-batch-selected', isSelected);
      return false;
    });

    $results.on('click.pt-theme-grouping', '.pt-theme-group > .select2-results__group', function(e) {
      e.preventDefault();
      e.stopPropagation();

      const $group = $(this).closest('.pt-theme-group');
      const groupKey = String($group.attr('data-pt-group') ?? '');
      if (!groupKey) return;
      if (getSelect2SearchValue()) return;

      const nextExpanded = !$group.hasClass('is-expanded');
      $group.toggleClass('is-expanded', nextExpanded);
      $group.children('ul.select2-results__options--nested').first().css('display', nextExpanded ? '' : 'none');

      const groupName = decodeURIComponent(groupKey);
      const groupState = loadThemeGroupState();
      groupState.collapsed = groupState.collapsed || {};
      groupState.collapsed[groupName] = !nextExpanded;
      saveThemeGroupState(groupState);
    });

    // Context menu handlers
    $results.on('mousedown.pt-theme-grouping touchstart.pt-theme-grouping', '.pt-theme-group-menu, .pt-theme-menu', function(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const $icon = $(this);
      const groupName = $icon.attr('data-group-name');
      const themeName = $icon.attr('data-theme-name');
      const currentGroup = $icon.attr('data-current-group');

      if (groupName) {
        showGroupMenu($icon, groupName, selectEl);
      } else if (themeName) {
        showThemeMenu($icon, themeName, currentGroup, selectEl);
      }
      return false;
    });

    $results.on('click.pt-theme-grouping mouseup.pt-theme-grouping', '.pt-theme-group-menu, .pt-theme-menu', function(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return false;
    });
  } finally {
    if (observer) observer.observe($results[0], { childList: true, subtree: true });
  }
}

function showThemeMenu($icon, themeName, currentGroup, selectEl) {
  const $ = getJQuery();
  $('.pt-theme-context-menu').remove();

  const $menu = $('<div>').addClass('pt-theme-context-menu');
  const groupState = loadThemeGroupState();
  const batchSelection = getThemeBatchSelection(selectEl);
  const shouldUseBatch = batchSelection.size > 0 && batchSelection.has(themeName);
  const themesToOperate = shouldUseBatch ? Array.from(batchSelection) : [themeName];

  // Move to group submenu
  const $moveToSubmenu = $('<div>').addClass('pt-menu-item pt-submenu').text('移动到...');
  const $submenuList = $('<div>').addClass('pt-submenu-list');

  for (const groupName of Object.keys(groupState.groups)) {
    if (shouldUseBatch || groupName !== currentGroup) {
      const $item = $('<div>')
        .addClass('pt-menu-item')
        .text(groupName)
        .on('click', (e) => {
          e.stopPropagation();
          for (const theme of themesToOperate) {
            addThemeToGroup(theme, groupName);
          }
          if (shouldUseBatch) {
            clearThemeBatchSelection(selectEl);
          }
          $('.pt-theme-context-menu').remove();
          void regroupOpenSelect2Results(selectEl);
        });
      $submenuList.append($item);
    }
  }

  $moveToSubmenu.append($submenuList);
  $moveToSubmenu.on('click', function(e) {
    e.stopPropagation();
    $(this).toggleClass('pt-submenu-open');
  });

  $menu.append($moveToSubmenu);

  // Remove from group
  if (currentGroup) {
    const $removeItem = $('<div>')
      .addClass('pt-menu-item')
      .text('移出分组')
      .on('click', () => {
        for (const theme of themesToOperate) {
          removeThemeFromGroup(theme);
        }
        if (shouldUseBatch) {
          clearThemeBatchSelection(selectEl);
        }
        $('.pt-theme-context-menu').remove();
        void regroupOpenSelect2Results(selectEl);
      });
    $menu.append($removeItem);
  }

  const iconOffset = $icon.offset();
  $menu.css({
    position: 'fixed',
    top: iconOffset.top + $icon.outerHeight(),
    left: iconOffset.left - 150,
  });

  $('body').append($menu);
  $menu.on('click', function(e) {
    if ($(e.target).hasClass('pt-menu-item') || $(e.target).closest('.pt-menu-item').length) return;
    e.stopPropagation();
  });

  // Prevent all events from bubbling
  $menu.on('mousedown mouseup touchstart touchend', function(e) {
    e.stopPropagation();
  });

  setTimeout(() => {
    $(document).one('click', () => $('.pt-theme-context-menu').remove());
  }, 0);
}

function showThemeGroupFilterMenu($icon, selectEl) {
  const $ = getJQuery();
  $('.pt-theme-context-menu').remove();
  return;

  const groupState = loadThemeGroupState();
  const groups = Object.keys(groupState.groups || {}).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const selected = new Set(Array.isArray(groupState.filterGroups) ? groupState.filterGroups : []);
  let includeUngrouped = groupState.filterIncludeUngrouped !== false;

  const $menu = $('<div>').addClass('pt-theme-context-menu pt-theme-filter-menu');
  applyThemeVarsToElement($menu[0]);

  if (!groups.length) {
    $menu.append($('<div>').addClass('pt-menu-item').text('暂无分组'));
  } else {
    for (const groupName of groups) {
      const $item = $('<div>').addClass('pt-menu-item pt-theme-filter-item');
      const $checkbox = $('<input>')
        .attr('type', 'checkbox')
        .attr('data-pt-group', groupName)
        .addClass('pt-theme-filter-checkbox')
        .prop('checked', selected.has(groupName))
        .on('change', function () {
          const next = new Set(selected);
          if ($(this).prop('checked')) next.add(groupName);
          else next.delete(groupName);
          const nextState = setThemeGroupFilter(Array.from(next), { includeUngrouped });
          selected.clear();
          (nextState.filterGroups || []).forEach((g) => selected.add(g));
          void regroupOpenSelect2Results(selectEl);
        });
      const $label = $('<span>').addClass('pt-theme-filter-label').text(groupName);
      $item.append($checkbox, $label);
      $menu.append($item);
    }

    $menu.append($('<div>').addClass('pt-menu-sep'));

    const $includeUngrouped = $('<div>').addClass('pt-menu-item pt-theme-filter-item');
    const $includeCheckbox = $('<input>')
      .attr('type', 'checkbox')
      .attr('data-pt-ungrouped', '1')
      .addClass('pt-theme-filter-checkbox')
      .prop('checked', includeUngrouped)
      .on('change', function () {
        const nextInclude = $(this).prop('checked');
        includeUngrouped = nextInclude;
        setThemeGroupFilter(Array.from(selected), { includeUngrouped: nextInclude });
        void regroupOpenSelect2Results(selectEl);
      });
    $includeUngrouped.append($includeCheckbox, $('<span>').addClass('pt-theme-filter-label').text('包含未分组'));
    $menu.append($includeUngrouped);

    const $clearItem = $('<div>')
      .addClass('pt-menu-item')
      .text('清除筛选')
      .on('click', () => {
        const nextState = setThemeGroupFilter([], { includeUngrouped: FILTER_INCLUDE_UNGROUPED_DEFAULT });
        selected.clear();
        (nextState.filterGroups || []).forEach((g) => selected.add(g));
        includeUngrouped = nextState.filterIncludeUngrouped !== false;
        $menu.find('input.pt-theme-filter-checkbox[data-pt-group]').prop('checked', false);
        $menu.find('input.pt-theme-filter-checkbox[data-pt-ungrouped]').prop('checked', includeUngrouped);
        void regroupOpenSelect2Results(selectEl);
      });
    $menu.append($clearItem);
  }

  const iconOffset = $icon.offset();
  const viewportHeight = window?.innerHeight || 800;
  $menu.css({
    position: 'fixed',
    top: iconOffset.top + $icon.outerHeight(),
    left: Math.max(8, iconOffset.left - 140),
    maxHeight: Math.max(160, Math.min(0.6 * viewportHeight, 420)),
    overflowY: 'auto',
  });

  $('body').append($menu);
  $menu.on('click', function (e) {
    if ($(e.target).hasClass('pt-menu-item') || $(e.target).closest('.pt-menu-item').length) return;
    e.stopPropagation();
  });

  $menu.on('mousedown mouseup touchstart touchend', function (e) {
    e.stopPropagation();
  });

  setTimeout(() => {
    $(document).one('click', () => $('.pt-theme-context-menu').remove());
  }, 0);
}

function showGroupMenu($icon, groupName, selectEl) {
  const $ = getJQuery();
  $('.pt-theme-context-menu').remove();

  const $menu = $('<div>').addClass('pt-theme-context-menu');

  const $renameItem = $('<div>')
    .addClass('pt-menu-item')
    .text('重命名')
    .on('click', () => {
      const newName = prompt('输入新的分组名称:', groupName);
      if (newName && renameGroup(groupName, newName)) {
        $('.pt-theme-context-menu').remove();
        void regroupOpenSelect2Results(selectEl);
      }
    });

  const $deleteItem = $('<div>')
    .addClass('pt-menu-item')
    .text('删除分组')
    .on('click', () => {
      if (confirm(`确定要删除分组"${groupName}"吗?主题将移至未分组。`)) {
        deleteGroup(groupName);
        $('.pt-theme-context-menu').remove();
        void regroupOpenSelect2Results(selectEl);
      }
    });

  $menu.append($renameItem).append($deleteItem);

  const iconOffset = $icon.offset();
  $menu.css({
    position: 'fixed',
    top: iconOffset.top + $icon.outerHeight(),
    left: iconOffset.left - 100,
  });

  $('body').append($menu);
  $menu.on('click', function(e) {
    if ($(e.target).hasClass('pt-menu-item') || $(e.target).closest('.pt-menu-item').length) return;
    e.stopPropagation();
  });

  // Prevent all events from bubbling
  $menu.on('mousedown mouseup touchstart touchend', function(e) {
    e.stopPropagation();
  });

  setTimeout(() => {
    $(document).one('click', () => $('.pt-theme-context-menu').remove());
  }, 0);
}

function installSelect2GroupingHandlers(selectEl) {
  const $ = getJQuery();
  const $select = $(selectEl);

  if ($select.data('ptThemeGroupingBound')) return;
  $select.data('ptThemeGroupingBound', true);

  const regroupDebounced = debounce(() => {
    void regroupOpenSelect2Results(selectEl);
  }, 0);

  const ensureObserver = () => {
    const existing = openResultsObservers.get(selectEl);
    if (existing) return;
    const $results = getOpenSelect2ResultsRoot(selectEl);
    if (!$results?.length) return;
    const observer = new MutationObserver(() => regroupDebounced());
    observer.observe($results[0], { childList: true, subtree: true });
    openResultsObservers.set(selectEl, observer);
  };

  const stopObserver = () => {
    const observer = openResultsObservers.get(selectEl);
    if (observer) observer.disconnect();
    openResultsObservers.delete(selectEl);
  };

  // Theme switching can be heavy and may interrupt Select2's normal open/close lifecycle.
  // Keep cleanup aligned with SillyTavern's native "change -> applyTheme" flow to avoid UI leftovers.
  const cleanupAfterThemeChange = () => {
    try {
      $('.pt-theme-context-menu').remove();
    } catch {
      /* ignore */
    }

    clearThemeBatchSelection(selectEl);

    // If Select2 is still open for any reason, close it to match native UX.
    try {
      if (isSelect2Initialized($select) && $select.data('select2')?.isOpen?.()) {
        $select.select2('close');
      }
    } catch {
      /* ignore */
    }

    // Ensure our observers/handlers don't keep running while the theme is applying.
    stopObserver();
    unbindDragEvents();
    resetDragState();

    // Refresh theme-derived vars for the next open (some themes update async).
    try {
      applyThemeVarsToElement(selectEl);
    } catch {
      /* ignore */
    }
  };

  // Prevent Select2 dropdown clicks from closing the settings panel
  const preventSettingsPanelClose = (e) => {
    e.stopPropagation();
  };

  // Close Select2 when settings drawer closes
  const onDrawerClose = () => {
    if (isSelect2Initialized($select) && $select.data('select2')?.isOpen?.()) {
      $select.select2('close');
    }
  };

  $select
    .off('select2:open.pt-theme-grouping')
    .on('select2:open.pt-theme-grouping', () => {
      regroupDebounced();
      setTimeout(ensureObserver, 0);

      // Add event handlers to prevent settings panel from closing when interacting with dropdown
      setTimeout(() => {
        // Prevent clicks/touches on dropdown container from closing settings panel
        const $dropdown = $('.select2-container--open').first();
        if ($dropdown.length) {
          $dropdown.on('mousedown.pt-prevent-close click.pt-prevent-close touchstart.pt-prevent-close touchend.pt-prevent-close', preventSettingsPanelClose);
        }

        // Prevent clicks/touches on search field from closing settings panel
        const $searchField = $('.select2-container--open .select2-search__field');
        if ($searchField.length) {
          $searchField.on('mousedown.pt-prevent-close click.pt-prevent-close focus.pt-prevent-close touchstart.pt-prevent-close touchend.pt-prevent-close', preventSettingsPanelClose);
        }

        // Prevent clicks/touches on the entire dropdown area from closing settings panel
        const $dropdownArea = $('.select2-container--open .select2-dropdown');
        if ($dropdownArea.length) {
          $dropdownArea.on('mousedown.pt-prevent-close click.pt-prevent-close touchstart.pt-prevent-close touchend.pt-prevent-close', preventSettingsPanelClose);
        }
      }, 0);

      // Listen for drawer close to close Select2
      const $drawer = $select.closest('.openDrawer');
      if ($drawer.length) {
        $drawer.off('transitionend.pt-theme-grouping').on('transitionend.pt-theme-grouping', function() {
          if ($(this).hasClass('closedDrawer')) {
            onDrawerClose();
          }
        });
      }

      // Also use MutationObserver to detect class changes on drawer
      const drawerEl = $select.closest('.drawer-content')[0];
      if (drawerEl && !$select.data('ptDrawerObserver')) {
        const drawerObserver = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
              if ($(drawerEl).hasClass('closedDrawer')) {
                onDrawerClose();
              }
            }
          }
        });
        drawerObserver.observe(drawerEl, { attributes: true, attributeFilter: ['class'] });
        $select.data('ptDrawerObserver', drawerObserver);
      }

      // Listen for scroll events on drawer to close Select2
      const $drawerContent = $select.closest('.drawer-content');
      if ($drawerContent.length) {
        const scrollHandler = () => {
          if (isSelect2Initialized($select) && $select.data('select2')?.isOpen?.()) {
            $select.select2('close');
          }
        };
        $drawerContent.off('scroll.pt-theme-grouping').on('scroll.pt-theme-grouping', scrollHandler);
      }
    })
    .off('select2:close.pt-theme-grouping')
    .on('select2:close.pt-theme-grouping', () => {
      $('.pt-theme-context-menu').remove();
      clearThemeBatchSelection(selectEl);
      const $results = getOpenSelect2ResultsRoot(selectEl);
      $results?.off?.('.pt-theme-grouping');
      stopObserver();

      // Clean up event handlers
      $('.select2-container--open').off('.pt-prevent-close');
      $('.select2-container--open .select2-search__field').off('.pt-prevent-close');
      $('.select2-container--open .select2-dropdown').off('.pt-prevent-close');
    });

  // Also clean up on actual theme selection (change event) to prevent leftover UI in edge cases.
  // Use setTimeout to ensure SillyTavern's native applyTheme handler runs first.
  $select
    .off('change.pt-theme-grouping')
    .on('change.pt-theme-grouping', () => {
      setTimeout(() => cleanupAfterThemeChange(), 0);
      setTimeout(() => cleanupAfterThemeChange(), 120);
    });
}

function uninstallSelect2GroupingHandlers(selectEl) {
  const $ = getJQuery();
  const $select = $(selectEl);
  $select.removeData('ptThemeGroupingBound');
  $select.off('.pt-theme-grouping');
  const observer = openResultsObservers.get(selectEl);
  if (observer) observer.disconnect();
  openResultsObservers.delete(selectEl);

  // Clean up drawer observer
  const drawerObserver = $select.data('ptDrawerObserver');
  if (drawerObserver) {
    drawerObserver.disconnect();
    $select.removeData('ptDrawerObserver');
  }

  // Clean up drawer event handlers
  $select.closest('.drawer-content').off('.pt-theme-grouping');
}

let enabled = false;
let retryTimer = null;

function addCreateGroupButton(selectEl) {
  const $ = getJQuery();

  let $btn = $('#pt-create-theme-group-btn');
  if (!$btn.length) {
    $btn = $('<div>')
      .attr('id', 'pt-create-theme-group-btn')
      .attr('title', '新建主题分组')
      .addClass('menu_button margin0')
      .html('<i class="fa-solid fa-folder-plus"></i>')
      .on('click', () => {
        const groupName = prompt('输入分组名称:');
        if (!groupName || !groupName.trim()) return;

        const trimmedName = groupName.trim();
        if (createGroup(trimmedName)) {
          if (typeof toastr !== 'undefined') {
            toastr.success(`分组"${trimmedName}"已创建`, '创建成功');
          }
        } else {
          if (typeof toastr !== 'undefined') {
            toastr.error('该分组已存在或创建失败', '创建失败');
          }
        }
      });

    $('#ui-preset-save-button').after($btn);
  }

  let $filterBtn = $('#pt-theme-group-filter-btn');
  if (false && !$filterBtn.length) {
    $filterBtn = $('<div>')
      .attr('id', 'pt-theme-group-filter-btn')
      .attr('title', '筛选主题分组')
      .addClass('menu_button margin0')
      .html('<i class="fa-solid fa-filter"></i>')
      .on('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showThemeGroupFilterMenu($filterBtn, selectEl);
        return false;
      });

    $btn.after($filterBtn);
  }

  $('#pt-theme-group-filter-btn').remove();
}

async function tryInit() {
  const $ = getJQuery();
  if (!$?.fn?.select2) {
    console.log('[ThemeGrouping] Select2 not available');
    return false;
  }

  try {
    const $themesSelect = $('#themes');
    if (!$themesSelect.length) {
      console.log('[ThemeGrouping] #themes element not found');
      return false;
    }

    // Initialize Select2 if not already initialized
    if (!isSelect2Initialized($themesSelect)) {
      console.log('[ThemeGrouping] Initializing Select2 on #themes');
      $themesSelect.select2({
        width: '100%',
        minimumResultsForSearch: 5,
      });
    }

    applyThemeVarsToElement($themesSelect[0]);
    installSelect2GroupingHandlers($themesSelect[0]);
    initDragAndDrop($themesSelect[0]);
    addCreateGroupButton($themesSelect[0]);

    // 绑定滚动自动关闭逻辑
    bindSelect2AutoClose('dialogue_popup');

    console.log('[ThemeGrouping] Initialized successfully');
    return true;
  } catch (error) {
    console.error('[ThemeGrouping] Initialization error:', error);
    return false;
  }
}

export function initThemeGrouping() {
  if (enabled) return;
  enabled = true;

  console.log('[ThemeGrouping] Starting initialization');

  const attempt = async () => {
    if (!enabled) return;
    const ok = await tryInit();
    if (!ok) {
      retryTimer = setTimeout(attempt, 1000);
    } else {
      retryTimer = null;
    }
  };

  void attempt();
}

export function destroyThemeGrouping() {
  console.log('[ThemeGrouping] Destroying');
  enabled = false;

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  const $ = getJQuery();
  const $themesSelect = $('#themes');
  if ($themesSelect?.length) {
    uninstallSelect2GroupingHandlers($themesSelect[0]);
    $themesSelect.off('.theme-drag');
  }
}

// Drag and drop functionality
let dragState = {
  isDragging: false,
  wasDragging: false,
  pointerType: null, // 'mouse' | 'touch'
  touchActive: false,
  touchArmed: false,
  armTolerance: 2,
  draggedTheme: null,
  draggedGroup: null,
  draggedThemeText: null,
  draggedElement: null,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  threshold: 8,
  longPressTimer: null,
  longPressDelay: 300,
  ghostElement: null,
};

let captureGuardsBound = false;
let dropTargetRafId = null;
let pendingDropTargetPoint = null;
let ignoreMouseUntil = 0;

function markIgnoreMouseEvents(durationMs = 1000) {
  ignoreMouseUntil = Date.now() + durationMs;
}

function isSyntheticMouseFromTouch(e) {
  const sourceCapabilities = e?.originalEvent?.sourceCapabilities || e?.sourceCapabilities;
  return !!sourceCapabilities?.firesTouchEvents;
}

function scheduleDropTargetUpdate(clientX, clientY) {
  pendingDropTargetPoint = { x: clientX, y: clientY };

  if (typeof requestAnimationFrame !== 'function') {
    updateDropTarget(clientX, clientY);
    return;
  }

  if (dropTargetRafId !== null) return;
  dropTargetRafId = requestAnimationFrame(() => {
    dropTargetRafId = null;
    const point = pendingDropTargetPoint;
    pendingDropTargetPoint = null;
    if (!point || !dragState.isDragging) return;
    updateDropTarget(point.x, point.y);
  });
}

function suppressEvent(e) {
  if (!e) return;
  if (typeof e.preventDefault === 'function') e.preventDefault();
  if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
  if (typeof e.stopPropagation === 'function') e.stopPropagation();
}

function getClientPoint(e) {
  if (!e) return { x: 0, y: 0 };

  // TouchEvent
  const touch = e.changedTouches?.[0] || e.touches?.[0];
  if (touch) return { x: touch.clientX, y: touch.clientY };

  // MouseEvent / PointerEvent
  return { x: e.clientX, y: e.clientY };
}

function onDocumentPointerEndCapture(e) {
  if (!dragState.isDragging) return;

  suppressEvent(e);

  const { x, y } = getClientPoint(e);
  finishDragging(x, y);

  // Mark that we just finished dragging to prevent click/selection
  dragState.wasDragging = true;
  setTimeout(() => {
    dragState.wasDragging = false;
  }, 150);

  // Prevent Select2 from selecting the item
  setTimeout(() => {
    const $ = getJQuery();
    $('.select2-results__option--highlighted').removeClass('select2-results__option--highlighted');
  }, 0);

  resetDragState({ preserveWasDragging: true });
}

function onDocumentClickCapture(e) {
  if (!dragState.isDragging && !dragState.wasDragging) return;
  suppressEvent(e);
}

function onThemeChangeCapture(e) {
  if (!dragState.isDragging) return;
  suppressEvent(e);
}

function onDocumentTouchMoveCapture(e) {
  // While touch drag is armed/active, prevent the dropdown from scrolling with the finger.
  if (!dragState.touchActive) return;
  if (!dragState.touchArmed && !dragState.isDragging) return;
  markIgnoreMouseEvents();
  if (e?.cancelable && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
}

function initDragAndDrop(selectEl) {
  const $ = getJQuery();
  const $select = $(selectEl);

  // Prevent Select2 from selecting a theme right after a drag operation.
  $select.off('select2:selecting.theme-drag').on('select2:selecting.theme-drag', (e) => {
    if (dragState.isDragging || dragState.wasDragging) {
      e.preventDefault();
    }
  });

  // Prevent theme selection when the user clicks the batch checkbox.
  $select.off('select2:selecting.pt-theme-batch').on('select2:selecting.pt-theme-batch', (e) => {
    const target = e?.params?.originalEvent?.target;
    if (!target) return;

    const $target = $(target);
    if ($target.hasClass('pt-theme-batch-toggle') || $target.closest('.pt-theme-batch-toggle').length) {
      e.preventDefault();
    }
  });

  if (selectEl?.addEventListener && !selectEl.__ptThemeGroupingChangeCaptureBound) {
    selectEl.__ptThemeGroupingChangeCaptureBound = true;
    selectEl.addEventListener('change', onThemeChangeCapture, true);
  }

  $select.on('select2:open.theme-drag', () => {
    setTimeout(() => bindDragEvents(), 100);
  });

  $select.on('select2:close.theme-drag', () => {
    unbindDragEvents();
    $('.pt-theme-context-menu').remove();
    resetDragState();
  });
}

function bindDragEvents() {
  const $ = getJQuery();
  const $results = $('.select2-container--open .select2-results').first();
  if (!$results.length) return;

  if (!captureGuardsBound) {
    captureGuardsBound = true;
    document.addEventListener('mouseup', onDocumentPointerEndCapture, true);
    document.addEventListener('touchend', onDocumentPointerEndCapture, true);
    document.addEventListener('touchcancel', onDocumentPointerEndCapture, true);
    document.addEventListener('click', onDocumentClickCapture, true);
    try {
      document.addEventListener('touchmove', onDocumentTouchMoveCapture, { capture: true, passive: false });
    } catch {
      document.addEventListener('touchmove', onDocumentTouchMoveCapture, true);
    }
  }

  $results.on('mousedown.theme-drag', '.select2-results__option:not(.pt-theme-group), .pt-theme-group > .select2-results__group', onPointerStart);
  $results.on('touchstart.theme-drag', '.select2-results__option:not(.pt-theme-group), .pt-theme-group > .select2-results__group', onPointerStart);

  // Prevent click after drag
  $results.on('click.theme-drag', '.select2-results__option', function(e) {
    if (dragState.wasDragging) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      dragState.wasDragging = false;
      return false;
    }
  });

  $(document).on('mousemove.theme-drag touchmove.theme-drag', onPointerMove);
  $(document).on('mouseup.theme-drag touchend.theme-drag touchcancel.theme-drag', onPointerEnd);
}

function unbindDragEvents() {
  const $ = getJQuery();
  $('.select2-results').off('.theme-drag');
  $(document).off('.theme-drag');
  if (captureGuardsBound) {
    captureGuardsBound = false;
    document.removeEventListener('mouseup', onDocumentPointerEndCapture, true);
    document.removeEventListener('touchend', onDocumentPointerEndCapture, true);
    document.removeEventListener('touchcancel', onDocumentPointerEndCapture, true);
    document.removeEventListener('click', onDocumentClickCapture, true);
    document.removeEventListener('touchmove', onDocumentTouchMoveCapture, true);
  }
  cleanupDragElements();
}

function onPointerStart(e) {
  const $ = getJQuery();
  const $target = $(e.currentTarget);

  if ($(e.target).hasClass('pt-theme-menu') || $(e.target).hasClass('pt-theme-group-menu') || $(e.target).hasClass('pt-theme-batch-toggle')) return;

  const isTouch = e.type === 'touchstart';

  // Ignore synthetic mouse events that some browsers emit after touch input.
  if (!isTouch && (dragState.touchActive || Date.now() < ignoreMouseUntil || isSyntheticMouseFromTouch(e))) return;
  if (isTouch) markIgnoreMouseEvents();

  if (dragState.longPressTimer) {
    clearTimeout(dragState.longPressTimer);
    dragState.longPressTimer = null;
  }

  const clientX = isTouch ? e.originalEvent.touches[0].clientX : e.clientX;
  const clientY = isTouch ? e.originalEvent.touches[0].clientY : e.clientY;

  dragState.pointerType = isTouch ? 'touch' : 'mouse';
  dragState.touchActive = isTouch;
  dragState.touchArmed = false;
  dragState.startX = clientX;
  dragState.startY = clientY;
  dragState.lastX = clientX;
  dragState.lastY = clientY;

  const scheduleTouchArm = () => {
    if (!isTouch) return;
    dragState.longPressTimer = setTimeout(() => {
      dragState.longPressTimer = null;
      if (!dragState.touchActive || dragState.isDragging) return;

      // Only arm dragging if the finger stayed almost still during the long-press,
      // so normal scrolling doesn't accidentally start drag mode.
      const deltaX = Math.abs(dragState.lastX - dragState.startX);
      const deltaY = Math.abs(dragState.lastY - dragState.startY);
      if (deltaX > dragState.armTolerance || deltaY > dragState.armTolerance) return;

      dragState.touchArmed = true;
    }, dragState.longPressDelay);
  };

  // Check if dragging a group
  const $group = $target.closest('.pt-theme-group');
  if ($group.length && $target.hasClass('select2-results__group')) {
    const groupKey = $group.attr('data-pt-group');
    if (groupKey) {
      const groupName = decodeURIComponent(groupKey);
      dragState.draggedGroup = groupName;
      dragState.draggedThemeText = groupName;
      dragState.draggedElement = $group[0];

      scheduleTouchArm();
      return;
    }
  }

  // Dragging a theme
  if ($target.hasClass('pt-theme-group')) return;

  const themeText = sanitizeThemeLabel($target.attr('data-pt-theme-text') || $target.text());
  const dataValue = String($target.attr('data-pt-theme') ?? '').trim();

  // Get the actual theme value from the select element
  const $themesSelect = $('#themes');
  let themeValue = dataValue || null;
  if (!themeValue) {
    $themesSelect.find('option').each(function() {
      if ($(this).text() === themeText) {
        themeValue = $(this).val();
        return false; // break
      }
    });
  }

  dragState.draggedTheme = themeValue || themeText;
  dragState.draggedThemeText = themeText;
  dragState.draggedElement = $target[0];

  scheduleTouchArm();
}

function onPointerMove(e) {
  const $ = getJQuery();
  if (!dragState.draggedTheme && !dragState.draggedGroup) return;

  // Ignore synthetic mousemove events emitted during touch interactions.
  if (e.type === 'mousemove' && (dragState.touchActive || Date.now() < ignoreMouseUntil || isSyntheticMouseFromTouch(e))) return;

  const isTouchMove = e.type === 'touchmove';
  if (isTouchMove) markIgnoreMouseEvents();
  const clientX = isTouchMove ? e.originalEvent.touches[0].clientX : e.clientX;
  const clientY = isTouchMove ? e.originalEvent.touches[0].clientY : e.clientY;

  dragState.lastX = clientX;
  dragState.lastY = clientY;

  const deltaX = Math.abs(clientX - dragState.startX);
  const deltaY = Math.abs(clientY - dragState.startY);

  if (dragState.longPressTimer && (deltaX > dragState.threshold || deltaY > dragState.threshold)) {
    clearTimeout(dragState.longPressTimer);
    dragState.longPressTimer = null;
  }

  if (!dragState.isDragging) {
    if (e.type === 'mousemove' && (deltaX > dragState.threshold || deltaY > dragState.threshold)) {
      startDragging($(dragState.draggedElement), clientX, clientY);
    } else if (isTouchMove && dragState.touchArmed && (deltaX > dragState.threshold || deltaY > dragState.threshold)) {
      startDragging($(dragState.draggedElement), clientX, clientY);
    }
  }

  if (dragState.isDragging) {
    e.preventDefault();
    updateDragGhost(clientX, clientY);
    scheduleDropTargetUpdate(clientX, clientY);
  }
}

function onPointerEnd(e) {
  if (dragState.longPressTimer) {
    clearTimeout(dragState.longPressTimer);
    dragState.longPressTimer = null;
  }

  if (e.type === 'touchend' || e.type === 'touchcancel') markIgnoreMouseEvents();

  if (dragState.isDragging) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const isTouchEnd = e.type === 'touchend' || e.type === 'touchcancel';
    const touch = isTouchEnd ? e.originalEvent.changedTouches?.[0] || e.originalEvent.touches?.[0] : null;
    const clientX = touch ? touch.clientX : e.clientX ?? dragState.lastX ?? dragState.startX ?? 0;
    const clientY = touch ? touch.clientY : e.clientY ?? dragState.lastY ?? dragState.startY ?? 0;
    finishDragging(clientX, clientY);

    // Mark that we just finished dragging to prevent click
    dragState.wasDragging = true;
    setTimeout(() => {
      dragState.wasDragging = false;
    }, 100);

    // Prevent Select2 from selecting the item
    setTimeout(() => {
      const $ = getJQuery();
      $('.select2-results__option--highlighted').removeClass('select2-results__option--highlighted');
    }, 0);
  }

  resetDragState({ preserveWasDragging: true });
}

function startDragging($element, clientX, clientY) {
  const $ = getJQuery();
  if (dragState.isDragging) return;

  if (dragState.longPressTimer) {
    clearTimeout(dragState.longPressTimer);
    dragState.longPressTimer = null;
  }

  dragState.touchArmed = false;
  dragState.isDragging = true;

  if (dragState.ghostElement) {
    $(dragState.ghostElement).remove();
    dragState.ghostElement = null;
  }
  $('.pt-theme-drag-ghost').remove();

  const $ghost = $('<div>')
    .addClass('pt-theme-drag-ghost')
    .text(dragState.draggedThemeText || dragState.draggedTheme)
    .css({
      left: clientX + 10 + 'px',
      top: clientY + 10 + 'px',
      padding: '8px 12px',
      borderRadius: '4px',
      opacity: 0.9,
    });

  $('body').append($ghost);
  dragState.ghostElement = $ghost[0];

  // On touch devices, keep only one "ghost" (the floating preview) to avoid double visuals.
  if (dragState.pointerType !== 'touch') {
    $element.addClass('pt-theme-dragging');
  }
}

function updateDragGhost(clientX, clientY) {
  if (!dragState.ghostElement) return;
  $(dragState.ghostElement).css({
    left: clientX + 10 + 'px',
    top: clientY + 10 + 'px',
  });
}

function updateDropTarget(clientX, clientY) {
  const $ = getJQuery();
  $('.pt-theme-drop-target').removeClass('pt-theme-drop-target');

  const elements = document.elementsFromPoint(clientX, clientY);
  for (const el of elements) {
    const $el = $(el);
    if ($el.hasClass('select2-results__group') || $el.closest('.select2-results__group').length) {
      $el.closest('.pt-theme-group').addClass('pt-theme-drop-target');
      break;
    }
  }
}

function getGroupNameFromElement(el) {
  const $ = getJQuery();
  const $group = $(el).closest('.pt-theme-group');
  if (!$group.length) return null;
  const groupKey = String($group.attr('data-pt-group') ?? '').trim();
  if (!groupKey) return null;
  try {
    return decodeURIComponent(groupKey);
  } catch {
    return groupKey;
  }
}

function findDropThemeLi(elements) {
  const $ = getJQuery();
  for (const el of elements) {
    const $li = $(el).closest('li.select2-results__option');
    if (!$li.length) continue;
    if ($li.hasClass('pt-theme-group')) continue;
    if (dragState.draggedElement && $li[0] === dragState.draggedElement) continue;
    if ($li.hasClass('pt-theme-dragging')) continue;
    const themeValue = String($li.attr('data-pt-theme') ?? '').trim();
    if (!themeValue) continue;
    return $li;
  }
  return null;
}

function upsertThemeInGroup(themeValue, groupName, { beforeThemeValue = null } = {}) {
  const state = loadThemeGroupState();
  const groups = state.groups || {};
  const members = groups[groupName];
  if (!Array.isArray(members)) return false;

  const theme = String(themeValue ?? '').trim();
  if (!theme) return false;

  // Remove from all groups first.
  for (const m of Object.values(groups)) {
    if (!Array.isArray(m)) continue;
    for (;;) {
      const idx = m.indexOf(theme);
      if (idx === -1) break;
      m.splice(idx, 1);
    }
  }

  // Remove from order if exists (grouped themes are not rendered from order).
  state.order = Array.isArray(state.order) ? state.order.filter((t) => t !== `t:${theme}`) : [];

  const targetMembers = groups[groupName];
  if (!Array.isArray(targetMembers)) return false;

  const beforeKey = String(beforeThemeValue ?? '').trim();
  if (beforeKey && beforeKey !== theme) {
    const insertIndex = targetMembers.indexOf(beforeKey);
    if (insertIndex !== -1) {
      targetMembers.splice(insertIndex, 0, theme);
      saveThemeGroupState(state);
      return true;
    }
  }

  targetMembers.push(theme);
  saveThemeGroupState(state);
  return true;
}

function finishDragging(clientX, clientY) {
  const $ = getJQuery();
  const elements = document.elementsFromPoint(clientX, clientY);

  // Ignore drops outside the open Select2 dropdown.
  const droppedInsideDropdown = elements.some((el) => $(el).closest('.select2-container--open').length);
  if (!droppedInsideDropdown) {
    cleanupDragElements();
    return;
  }

  let targetGroup = null;
  let insertBefore = null;

  const dropThemeLi = findDropThemeLi(elements);
  const dropThemeValue = dropThemeLi ? String(dropThemeLi.attr('data-pt-theme') ?? '').trim() : null;
  const dropThemeGroupName = dropThemeLi?.length ? getGroupNameFromElement(dropThemeLi[0]) : null;

  // Check if dropping on a group (only for themes, not for groups).
  if (dragState.draggedTheme && !dragState.draggedGroup) {
    targetGroup = dropThemeGroupName;
    if (!targetGroup) {
      for (const el of elements) {
        const name = getGroupNameFromElement(el);
        if (name) {
          targetGroup = name;
          break;
        }
      }
    }
  }

  // Check if dropping between items for reordering
  const $results = $('.select2-container--open .select2-results__options').first();
  if ($results.length && !targetGroup) {
    const items = $results.children('.select2-results__option, .pt-theme-group').toArray();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const $item = $(item);
      const rectSource = $item.hasClass('pt-theme-group')
        ? $item.children('.select2-results__group').first()[0] || item
        : item;
      const rect = rectSource.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      if (clientY < midY) {
        if ($item.hasClass('pt-theme-group')) {
          const groupKey = $item.attr('data-pt-group');
          if (groupKey) {
            insertBefore = `g:${decodeURIComponent(groupKey)}`;
          }
        } else {
          const themeValue = String($item.attr('data-pt-theme') ?? '').trim();
          if (themeValue) {
            insertBefore = `t:${themeValue}`;
          }
        }
        break;
      }
    }
  }

  if (targetGroup && dragState.draggedTheme) {
    const $themesSelect = $('#themes');
    const draggedValue = String(dragState.draggedTheme ?? '').trim();
    const draggedText = String(dragState.draggedThemeText ?? '').trim();
    let themeValue = null;

    // Prefer the stable option value (data-pt-theme).
    if (draggedValue) {
      $themesSelect.find('option').each(function() {
        const optVal = String($(this).val() ?? '').trim();
        if (optVal && optVal === draggedValue) {
          themeValue = optVal;
          return false;
        }
      });
    }

    // Fallback: resolve by visible label text.
    if (!themeValue && draggedText) {
      $themesSelect.find('option').each(function() {
        const $opt = $(this);
        const optVal = String($opt.val() ?? '').trim();
        const optText = String($opt.text() ?? '').trim();
        if (optVal && optText === draggedText) {
          themeValue = optVal;
          return false;
        }
      });
    }

    if (themeValue) {
      // If dropping on a specific theme inside an expanded group, reorder inside that group.
      if (dropThemeValue && dropThemeGroupName === targetGroup && dropThemeValue !== themeValue) {
        const rect = dropThemeLi?.[0]?.getBoundingClientRect?.();
        const after = rect ? clientY > rect.top + rect.height / 2 : false;
        let beforeThemeValue = dropThemeValue;

        if (after) {
          const $next = dropThemeLi
            .nextAll('li.select2-results__option')
            .not('.pt-theme-group')
            .filter((_, el) => !!String($(el).attr('data-pt-theme') ?? '').trim())
            .first();
          beforeThemeValue = $next.length ? String($next.attr('data-pt-theme') ?? '').trim() : null;
        }

        if (upsertThemeInGroup(themeValue, targetGroup, { beforeThemeValue })) {
          setTimeout(() => void regroupOpenSelect2Results($themesSelect[0]), 0);
        }
      } else {
        // Drop on group header/blank area: append to the group.
        if (addThemeToGroup(themeValue, targetGroup)) {
          setTimeout(() => void regroupOpenSelect2Results($themesSelect[0]), 0);
          if (typeof toastr !== 'undefined') {
            toastr.success(`已将主题添加到分组"${targetGroup}"`, '添加成功');
          }
        }
      }
    }
  } else if (dragState.draggedGroup || dragState.draggedTheme) {
    // Reorder theme or group (use current DOM order as the base so it works even if state.order is empty).
    const state = loadThemeGroupState();
    let draggedItem;

    if (dragState.draggedGroup) {
      draggedItem = `g:${dragState.draggedGroup}`;
    } else if (dragState.draggedTheme) {
      draggedItem = `t:${dragState.draggedTheme}`;
    }

    const $themesSelect = $('#themes');
    const maps = $themesSelect.length ? getThemesOptionMaps($themesSelect[0]) : { valueToText: new Map(), textToValue: new Map() };

    const currentTokens = [];
    if ($results.length) {
      const items = $results.children('.select2-results__option, .pt-theme-group').toArray();
      for (const item of items) {
        const $item = $(item);
        if ($item.hasClass('pt-theme-group')) {
          const groupKey = String($item.attr('data-pt-group') ?? '').trim();
          if (groupKey) {
            currentTokens.push(`g:${decodeURIComponent(groupKey)}`);
          }
          continue;
        }

        const directValue = String($item.attr('data-pt-theme') ?? '').trim();
        const labelValue = maps.textToValue.get(sanitizeThemeLabel($item.text()));
        const themeValue = directValue || labelValue;
        if (themeValue) currentTokens.push(`t:${themeValue}`);
      }
    }

    if (draggedItem) {
      const baseOrder = currentTokens.length ? currentTokens : Array.isArray(state.order) ? state.order.slice() : [];
      const nextOrder = baseOrder.filter((t) => t !== draggedItem);

      let insertIndex = insertBefore ? nextOrder.indexOf(insertBefore) : -1;
      if (insertIndex === -1) insertIndex = nextOrder.length;

      nextOrder.splice(insertIndex, 0, draggedItem);
      state.order = nextOrder;

      saveThemeGroupState(state);
      if ($themesSelect.length) {
        setTimeout(() => void regroupOpenSelect2Results($themesSelect[0]), 0);
      }
    }
  }

  cleanupDragElements();
}

function cleanupDragElements() {
  const $ = getJQuery();
  if (dragState.ghostElement) {
    $(dragState.ghostElement).remove();
    dragState.ghostElement = null;
  }
  if (dropTargetRafId !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(dropTargetRafId);
    dropTargetRafId = null;
  }
  pendingDropTargetPoint = null;
  $('.pt-theme-drag-ghost').remove();
  $('.pt-theme-dragging').removeClass('pt-theme-dragging');
  $('.pt-theme-drop-target').removeClass('pt-theme-drop-target');
}

function resetDragState({ preserveWasDragging = false } = {}) {
  if (dragState.longPressTimer) {
    clearTimeout(dragState.longPressTimer);
  }
  const nextWasDragging = preserveWasDragging ? !!dragState.wasDragging : false;
  dragState = {
    isDragging: false,
    wasDragging: nextWasDragging,
    pointerType: null,
    touchActive: false,
    touchArmed: false,
    armTolerance: 2,
    draggedTheme: null,
    draggedGroup: null,
    draggedThemeText: null,
    draggedElement: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    threshold: 8,
    longPressTimer: null,
    longPressDelay: 300,
    ghostElement: null,
  };
}
