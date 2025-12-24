import { debounce, getJQuery, getParentWindow, getSillyTavernContext } from './utils.js';
import { CommonStyles } from '../styles/common-styles.js';
import { computeCharacterLinkedWorldbooks } from './worldbook-api.js';
import { loadWorldbookGroupState, normalizeWorldbookGroupState } from './worldbook-group-state.js';

const openResultsObservers = new WeakMap();
const lastRegroupAt = new WeakMap();
const unshallowRefreshState = new WeakMap();
const openDropdownShields = new WeakMap();
const UI_STYLE_ID = 'pt-worldbook-grouping-ui-styles';
const WORLD_EDITOR_DROPDOWN_WIDTH = '470px';
const WORLD_EDITOR_DROPDOWN_CLASS = 'pt-world-editor-dropdown';

function getOrCreateCollapseState(selectEl) {
  if (!getOrCreateCollapseState._map) {
    getOrCreateCollapseState._map = new WeakMap();
  }
  const map = getOrCreateCollapseState._map;
  if (map.has(selectEl)) return map.get(selectEl);
  const state = {
    groupExpanded: new Map(),
  };
  map.set(selectEl, state);
  return state;
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

function injectWorldbookGroupingUiStyles() {
  const doc = getParentWindow()?.document ?? document;
  if (!doc?.head || doc.getElementById(UI_STYLE_ID)) return;

  const style = doc.createElement('style');
  style.id = UI_STYLE_ID;
  style.textContent = `
    .select2-dropdown.${WORLD_EDITOR_DROPDOWN_CLASS} {
      width: ${WORLD_EDITOR_DROPDOWN_WIDTH} !important;
      max-width: calc(100vw - 20px) !important;
      box-sizing: border-box;
    }
    @media (max-width: 540px) {
      .select2-container--open .select2-dropdown.${WORLD_EDITOR_DROPDOWN_CLASS} {
        position: fixed !important;
        left: 10px !important;
        right: 10px !important;
        width: auto !important;
        transform: none !important;
      }
    }

    /* World editor: remove the single-select clear (x) icon */
    #world_editor_select + span.select2-container .select2-selection__clear {
      display: none !important;
    }
    /* Global world selector: remove the clear (x) icon */
    #world_info + span.select2-container .select2-selection__clear {
      display: none !important;
    }

    .select2-results .pt-wb-group > .select2-results__group {
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      user-select: none;
    }
    .select2-results .pt-wb-group[data-pt-collapsible="0"] > .select2-results__group {
      cursor: default;
    }
    .select2-results .pt-wb-group > .select2-results__group::before {
      content: "\\25B6";
      transform: rotate(90deg);
      transition: transform 0.15s ease;
      opacity: 0.85;
    }
    .select2-results .pt-wb-group[data-pt-collapsible="0"] > .select2-results__group::before {
      display: none;
    }
    .select2-results .pt-wb-group:not(.is-expanded) > .select2-results__group::before {
      transform: rotate(0deg);
    }
    .select2-results .pt-wb-group > .select2-results__group .pt-wb-group-title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .select2-results .pt-wb-group > .select2-results__group .pt-wb-group-count {
      flex: 0 0 auto;
      margin-left: auto;
      color: var(--pt-tip, inherit);
      font-weight: 500;
    }
    .select2-results .pt-wb-group.pt-wb-subgroup > .select2-results__group {
      font-weight: 600;
      opacity: 0.95;
    }
    .select2-results .pt-wb-group.pt-wb-subgroup .select2-results__options--nested .select2-results__option {
      padding-left: 3em;
    }
  `;
  doc.head.appendChild(style);
}

function removeWorldbookGroupingUiStyles() {
  const doc = getParentWindow()?.document ?? document;
  doc?.getElementById?.(UI_STYLE_ID)?.remove?.();
}

function ensureWorldEditorSelect2($select) {
  const $ = getJQuery();
  if (typeof $.fn?.select2 !== 'function') return false;
  if (isSelect2Initialized($select)) return true;

  const placeholder = $select.find('option[value=""]').text() || undefined;
  const dropdownParent = $select.closest('body');
  $select.select2({
    width: 'resolve',
    placeholder,
    allowClear: false,
    dropdownCssClass: WORLD_EDITOR_DROPDOWN_CLASS,
    dropdownParent,
  });
  $select.data('ptWorldbookGroupingSelect2Injected', true);
  return true;
}

function ensureGlobalWorldSelect2($select) {
  const $ = getJQuery();
  if (typeof $.fn?.select2 !== 'function') return false;
  if (isSelect2Initialized($select)) return true;

  const dropdownParent = $select.closest('body');
  $select.select2({
    width: '100%',
    placeholder: undefined,
    allowClear: false,
    closeOnSelect: false,
    dropdownParent,
  });
  $select.data('ptWorldbookGroupingSelect2Injected', true);
  return true;
}

function clearInjectedGroups($results) {
  $results.find('.pt-wb-group').remove();
  $results.off('click.pt-wb-grouping');
}

function getOpenSelect2ResultsRoot(selectEl) {
  const $ = getJQuery();
  const $select = $(selectEl);
  const instance = $select.data('select2');
  const $dropdown = instance?.$dropdown ? $(instance.$dropdown) : $('.select2-container--open .select2-dropdown').first();
  if (!$dropdown?.length) return null;
  return $dropdown.find('.select2-results__options').first();
}

function getSelect2DropdownElement(selectEl) {
  const $ = getJQuery();
  const $select = $(selectEl);
  const instance = $select.data('select2');
  const raw = instance?.$dropdown;
  if (!raw) return null;
  const $dropdown = $(raw);
  if (!$dropdown.length) return null;
  if ($dropdown.hasClass('select2-dropdown')) return $dropdown[0];
  return $dropdown.find('.select2-dropdown').first()[0] || null;
}

function applyWorldEditorDropdownMobileClamp(selectEl) {
  if (!selectEl || selectEl.id !== 'world_editor_select') return;
  const dropdownEl = getSelect2DropdownElement(selectEl);
  if (!dropdownEl) return;

  // Ensure the dropdown gets our styling even if Select2 was initialized elsewhere.
  dropdownEl.classList?.add?.(WORLD_EDITOR_DROPDOWN_CLASS);

  const win = getParentWindow();
  const isSmall = (win?.innerWidth ?? window.innerWidth) <= 540;
  if (!isSmall) return;

  dropdownEl.style.setProperty('position', 'fixed', 'important');
  dropdownEl.style.setProperty('left', '10px', 'important');
  dropdownEl.style.setProperty('right', '10px', 'important');
  dropdownEl.style.setProperty('width', 'auto', 'important');
  dropdownEl.style.setProperty('max-width', 'calc(100vw - 20px)', 'important');
  dropdownEl.style.setProperty('transform', 'none', 'important');
}

function clearWorldEditorDropdownMobileClamp(selectEl) {
  if (!selectEl || selectEl.id !== 'world_editor_select') return;
  const dropdownEl = getSelect2DropdownElement(selectEl);
  if (!dropdownEl) return;
  dropdownEl.style.removeProperty('position');
  dropdownEl.style.removeProperty('left');
  dropdownEl.style.removeProperty('right');
  dropdownEl.style.removeProperty('width');
  dropdownEl.style.removeProperty('max-width');
  dropdownEl.style.removeProperty('transform');
}

function isCoarsePointer() {
  const win = getParentWindow();
  try {
    if (typeof win?.matchMedia === 'function') {
      return !!win.matchMedia('(pointer: coarse)').matches;
    }
  } catch {
    // ignore
  }
  return Boolean(win?.navigator?.maxTouchPoints) || (win?.innerWidth ?? window.innerWidth) <= 768;
}

function installOpenDropdownInteractionShield(selectEl) {
  if (!selectEl || selectEl.id !== 'world_editor_select') return;
  if (!isCoarsePointer()) return;

  const $ = getJQuery();
  const dropdownEl = getSelect2DropdownElement(selectEl);
  if (!dropdownEl) return;

  const existing = openDropdownShields.get(selectEl);
  if (existing?.dropdownEl === dropdownEl) return;

  const events = 'touchstart.pt-wb-shield pointerdown.pt-wb-shield mousedown.pt-wb-shield click.pt-wb-shield';
  const stopBubble = (e) => e.stopPropagation();

  const $dropdown = $(dropdownEl);
  $dropdown.off(events).on(events, stopBubble);
  $dropdown.find('.select2-search').off(events).on(events, stopBubble);
  $dropdown.find('.select2-search__field').off(events).on(events, stopBubble);
  $dropdown.find('.select2-results').off(events).on(events, stopBubble);

  openDropdownShields.set(selectEl, { dropdownEl, events });
}

function uninstallOpenDropdownInteractionShield(selectEl) {
  const st = openDropdownShields.get(selectEl);
  if (!st?.dropdownEl) return;

  const $ = getJQuery();
  const $dropdown = $(st.dropdownEl);
  $dropdown.off(st.events);
  $dropdown.find('.select2-search').off(st.events);
  $dropdown.find('.select2-search__field').off(st.events);
  $dropdown.find('.select2-results').off(st.events);

  openDropdownShields.delete(selectEl);
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

  const boundSet = await computeCharacterLinkedWorldbooks();
  const state = getOrCreateCollapseState(selectEl);
  const searchValue = getSelect2SearchValue();
  const forceExpandAll = searchValue.length > 0;

  // In `lazyLoadCharacters` mode, the character list is shallow and doesn't include `extensions.world`.
  // Kick off an async refresh once per open dropdown to populate cache and regroup without blocking UI.
  try {
    const ctx = getSillyTavernContext();
    const characters = Array.isArray(ctx?.characters) ? ctx.characters : [];
    const hasShallow = characters.some((c) => c?.shallow);
    if (hasShallow) {
      const st = unshallowRefreshState.get(selectEl) ?? { inFlight: false, done: false };
      if (!st.inFlight && !st.done) {
        st.inFlight = true;
        unshallowRefreshState.set(selectEl, st);

        void computeCharacterLinkedWorldbooks({ unshallow: true })
          .catch(() => null)
          .then(() => {
            st.inFlight = false;
            st.done = true;
            unshallowRefreshState.set(selectEl, st);

            // Only regroup if the dropdown is still open for this select.
            const $stillOpen = getOpenSelect2ResultsRoot(selectEl);
            if ($stillOpen?.length) {
              void regroupOpenSelect2Results(selectEl);
            }
          });
      }
    }
  } catch {
    // ignore
  }

  const observer = openResultsObservers.get(selectEl);
  if (observer) observer.disconnect();

  try {
    const excludedNames = new Set(
      $(selectEl)
        .find('option[value=""]')
        .map((_, o) => String(o.textContent ?? '').trim())
        .get()
        .filter(Boolean),
    );

    const optionItems = $results
      .find(
        'li.select2-results__option[aria-selected], li.select2-results__option[role="treeitem"], li.select2-results__option[role="option"]',
      )
      .detach()
      .toArray();

    clearInjectedGroups($results);

    if (!optionItems.length) return;

    const pinnedItems = [];
    const byName = new Map();
    const orderNames = [];
    for (const li of optionItems) {
      const name = String($(li).text() ?? '').trim();
      if (!name) continue;
      if (excludedNames.has(name)) {
        pinnedItems.push(li);
        continue;
      }
      byName.set(name, li);
      orderNames.push(name);
    }

    let groupState = normalizeWorldbookGroupState(loadWorldbookGroupState());

    const createCollapsibleGroupNode = ({ groupKey, title, count, children, expanded }) => {
      const group = document.createElement('li');
      group.className = 'select2-results__option select2-results__option--group pt-wb-group pt-wb-subgroup';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', title);
      group.setAttribute('data-pt-level', 'group');
      group.setAttribute('data-pt-group', groupKey);
      group.setAttribute('data-pt-collapsible', '1');

      const strong = document.createElement('strong');
      strong.className = 'select2-results__group';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'pt-wb-group-title';
      titleSpan.textContent = title;

      const countSpan = document.createElement('span');
      countSpan.className = 'pt-wb-group-count';
      countSpan.textContent = `(${count})`;

      strong.appendChild(titleSpan);
      strong.appendChild(countSpan);

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

    const GROUP_TOKEN_PREFIX = 'g:';
    const ITEM_TOKEN_PREFIX = 'w:';
    const parseOrderToken = (raw) => {
      const token = String(raw ?? '').trim();
      if (!token) return { type: 'empty', value: '' };
      if (token.startsWith(GROUP_TOKEN_PREFIX)) return { type: 'group', value: token.slice(GROUP_TOKEN_PREFIX.length).trim() };
      if (token.startsWith(ITEM_TOKEN_PREFIX)) return { type: 'item', value: token.slice(ITEM_TOKEN_PREFIX.length).trim() };
      return { type: 'unknown', value: token };
    };

    const bucket = groupState.flat && typeof groupState.flat === 'object' ? groupState.flat : { order: [], groups: {} };
    const bucketGroups = bucket.groups && typeof bucket.groups === 'object' ? bucket.groups : {};

    const titles = groupState?.prefs?.titles ?? {};
    const enabled = groupState?.prefs?.enabled ?? {};

    const LEGACY_BOUND_TITLE = '\u5df2\u7ed1\u5b9a\u89d2\u8272';
    const LEGACY_UNBOUND_TITLE = '\u672a\u7ed1\u5b9a\u89d2\u8272';

    const boundTitle = String(titles?.bound ?? '').trim() || LEGACY_BOUND_TITLE;
    const unboundTitle = String(titles?.unbound ?? '').trim() || LEGACY_UNBOUND_TITLE;

    const boundEnabled = enabled?.bound !== false;
    const unboundEnabled = enabled?.unbound !== false;

    // Treat both the current titles and the legacy default titles as "auto groups" to avoid duplicate leftovers
    // when users rename titles or upgrade from older versions.
    const autoGroupNames = new Set([boundTitle, unboundTitle, LEGACY_BOUND_TITLE, LEGACY_UNBOUND_TITLE].filter(Boolean));
    const boundGroupNames = new Set([boundTitle, LEGACY_BOUND_TITLE].filter(Boolean));
    const unboundGroupNames = new Set([unboundTitle, LEGACY_UNBOUND_TITLE].filter(Boolean));

    const normalizeAutoGroupName = (rawName) => {
      const name = String(rawName ?? '').trim();
      if (!name) return '';
      if (!autoGroupNames.has(name)) return name;
      if (boundGroupNames.has(name)) return boundTitle;
      if (unboundGroupNames.has(name)) return unboundTitle;
      return name;
    };

    const normalizedGroups = {};
    const manualGroupedNames = new Set();

    for (const [name, members] of Object.entries(bucketGroups)) {
      const groupName = String(name ?? '').trim();
      if (!groupName || autoGroupNames.has(groupName)) continue;
      const filtered = (Array.isArray(members) ? members : [])
        .map((x) => String(x ?? '').trim())
        .filter((x) => byName.has(x));
      if (!filtered.length) continue;
      normalizedGroups[groupName] = filtered;
      for (const n of filtered) manualGroupedNames.add(n);
    }

    const normalizeExistingAutoMembers = ({ groupNames, shouldKeep }) => {
      const merged = [];
      const seen = new Set();

      for (const groupName of groupNames) {
        const members = bucketGroups[groupName];
        if (!Array.isArray(members)) continue;
        for (const raw of members) {
          const name = String(raw ?? '').trim();
          if (!name || seen.has(name) || !byName.has(name) || manualGroupedNames.has(name)) continue;
          if (!shouldKeep(name)) continue;
          seen.add(name);
          merged.push(name);
        }
      }

      return { merged, seen };
    };

    const buildAutoGroupMembers = ({ isBound, enabled: isEnabled }) => {
      if (!isEnabled) return [];

      const groupNamesToMerge = isBound
        ? [boundTitle, LEGACY_BOUND_TITLE, LEGACY_UNBOUND_TITLE, unboundTitle]
        : [unboundTitle, LEGACY_UNBOUND_TITLE, LEGACY_BOUND_TITLE, boundTitle];

      // Only keep members that still match the current binding status; this makes the group dynamic.
      const { merged, seen } = normalizeExistingAutoMembers({
        groupNames: groupNamesToMerge,
        shouldKeep: (name) => Boolean(boundSet?.has?.(name)) === isBound,
      });

      for (const name of orderNames) {
        if (!name || seen.has(name) || manualGroupedNames.has(name)) continue;
        const currentIsBound = Boolean(boundSet?.has?.(name));
        if (currentIsBound !== isBound) continue;
        seen.add(name);
        merged.push(name);
      }

      return merged;
    };

    const unboundAutoMembers = buildAutoGroupMembers({ isBound: false, enabled: unboundEnabled });
    const boundAutoMembers = buildAutoGroupMembers({ isBound: true, enabled: boundEnabled });

    if (unboundAutoMembers.length) normalizedGroups[unboundTitle] = unboundAutoMembers;
    if (boundAutoMembers.length) normalizedGroups[boundTitle] = boundAutoMembers;

    const autoGroupNamesByToken = new Set([unboundTitle, boundTitle, LEGACY_UNBOUND_TITLE, LEGACY_BOUND_TITLE].filter(Boolean));

    const groupedNames = new Set();
    for (const members of Object.values(normalizedGroups)) {
      for (const n of members) groupedNames.add(n);
    }
    const ungroupedNames = orderNames.filter((n) => !groupedNames.has(n));

    const renderedGroups = new Set();
    const renderedItems = new Set();
    const nodes = [];

    const order = Array.isArray(bucket.order) ? bucket.order : [];
    for (const raw of order) {
      const parsed = parseOrderToken(raw);
      if (parsed.type === 'group') {
        const groupName = normalizeAutoGroupName(parsed.value);
        const members = normalizedGroups[groupName];
        if (!groupName || !members || !members.length || renderedGroups.has(groupName)) continue;
        renderedGroups.add(groupName);

        const groupKey = encodeURIComponent(groupName);
        const expanded = forceExpandAll || (state.groupExpanded.has(groupKey) ? state.groupExpanded.get(groupKey) : false);
        nodes.push(
          createCollapsibleGroupNode({
            groupKey,
            title: groupName,
            count: members.length,
            children: members.map((n) => byName.get(n)).filter(Boolean),
            expanded,
          }),
        );
        continue;
      }

      if (parsed.type === 'item') {
        const name = String(parsed.value ?? '').trim();
        if (!name || renderedItems.has(name) || groupedNames.has(name)) continue;
        const li = byName.get(name);
        if (!li) continue;
        renderedItems.add(name);
        nodes.push(li);
      }
    }

    for (const groupName of Object.keys(normalizedGroups)) {
      if (renderedGroups.has(groupName)) continue;
      renderedGroups.add(groupName);

      const groupKey = encodeURIComponent(groupName);
      const expanded = forceExpandAll || (state.groupExpanded.has(groupKey) ? state.groupExpanded.get(groupKey) : false);
      nodes.push(
        createCollapsibleGroupNode({
          groupKey,
          title: groupName,
          count: normalizedGroups[groupName].length,
          children: normalizedGroups[groupName].map((n) => byName.get(n)).filter(Boolean),
          expanded,
        }),
      );
    }

    for (const name of ungroupedNames) {
      if (renderedItems.has(name)) continue;
      const li = byName.get(name);
      if (!li) continue;
      renderedItems.add(name);
      nodes.push(li);
    }

    const fragment = document.createDocumentFragment();
    for (const item of pinnedItems) fragment.appendChild(item);
    for (const node of nodes) fragment.appendChild(node);

    $results.empty().append(fragment);

    $results.on('click.pt-wb-grouping', '.pt-wb-group > .select2-results__group', function (e) {
      e.preventDefault();
      e.stopPropagation();

      const $group = $(this).closest('.pt-wb-group');
      const level = String($group.attr('data-pt-level') ?? '');
      const groupKey = String($group.attr('data-pt-group') ?? '');
      if (!level || !groupKey) return;
      if (getSelect2SearchValue()) return;
      if (String($group.attr('data-pt-collapsible') ?? '') !== '1') return;

      const nextExpanded = !$group.hasClass('is-expanded');
      $group.toggleClass('is-expanded', nextExpanded);
      $group.children('ul.select2-results__options--nested').first().css('display', nextExpanded ? '' : 'none');

      const collapseState = getOrCreateCollapseState(selectEl);
      if (level === 'group') collapseState.groupExpanded.set(groupKey, nextExpanded);
    });
  } finally {
    if (observer) observer.observe($results[0], { childList: true, subtree: true });
  }
}

function installSelect2GroupingHandlers(selectEl) {
  const $ = getJQuery();
  const $select = $(selectEl);

  if ($select.data('ptWorldbookGroupingBound')) return;
  $select.data('ptWorldbookGroupingBound', true);

  let closeOnHideTimer = null;
  const stopCloseOnHideMonitor = () => {
    if (!closeOnHideTimer) return;
    clearInterval(closeOnHideTimer);
    closeOnHideTimer = null;
  };

  const getSelect2Container = () => {
    const inst = $select.data('select2');
    const $container = inst?.$container ? $(inst.$container) : null;
    if ($container?.length) return $container;
    const $next = $select.next('.select2');
    return $next?.length ? $next : null;
  };

  const startCloseOnHideMonitor = () => {
    if (closeOnHideTimer) return;
    closeOnHideTimer = setInterval(() => {
      try {
        const $container = getSelect2Container();
        if (!$container?.length) return;
        if ($container.is(':visible')) return;
        if (typeof $select.select2 === 'function') $select.select2('close');
      } catch {
        // ignore
      }
    }, 200);
  };

  $select.data('ptWorldbookGroupingCloseMonitorStop', stopCloseOnHideMonitor);

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

  $select
    .off('select2:open.pt-wb-grouping')
    .on('select2:open.pt-wb-grouping', () => {
      applyWorldEditorDropdownMobileClamp(selectEl);
      installOpenDropdownInteractionShield(selectEl);
      startCloseOnHideMonitor();
      regroupDebounced();
      setTimeout(ensureObserver, 0);
    })
    .off('select2:close.pt-wb-grouping')
    .on('select2:close.pt-wb-grouping', () => {
      stopCloseOnHideMonitor();
      uninstallOpenDropdownInteractionShield(selectEl);
      const $results = getOpenSelect2ResultsRoot(selectEl);
      $results?.off?.('click.pt-wb-grouping');
      stopObserver();
      clearWorldEditorDropdownMobileClamp(selectEl);
    });
}

function uninstallSelect2GroupingHandlers(selectEl) {
  const $ = getJQuery();
  const $select = $(selectEl);
  const stopMonitor = $select.data('ptWorldbookGroupingCloseMonitorStop');
  if (typeof stopMonitor === 'function') stopMonitor();
  $select.removeData('ptWorldbookGroupingCloseMonitorStop');
  $select.removeData('ptWorldbookGroupingBound');
  $select.off('.pt-wb-grouping');
  uninstallOpenDropdownInteractionShield(selectEl);
  const observer = openResultsObservers.get(selectEl);
  if (observer) observer.disconnect();
  openResultsObservers.delete(selectEl);
}

function findWorldbookSelects() {
  const $ = getJQuery();
  return {
    $globalWorldSelect: $('#world_info'),
    $worldEditorSelect: $('#world_editor_select'),
  };
}

let enabled = false;
let retryTimer = null;

async function tryInit() {
  const $ = getJQuery();
  if (!$?.fn) return false;

  try {
    const { $globalWorldSelect, $worldEditorSelect } = findWorldbookSelects();
    if (!$globalWorldSelect.length || !$worldEditorSelect.length) return false;

    injectWorldbookGroupingUiStyles();

    applyThemeVarsToElement($globalWorldSelect[0]);
    applyThemeVarsToElement($worldEditorSelect[0]);

    const globalOk = ensureGlobalWorldSelect2($globalWorldSelect);
    const editorOk = ensureWorldEditorSelect2($worldEditorSelect);
    if (!globalOk || !editorOk) return false;

    installSelect2GroupingHandlers($globalWorldSelect[0]);
    installSelect2GroupingHandlers($worldEditorSelect[0]);

    return true;
  } catch {
    return false;
  }
}

export function initWorldbookGroupingUi() {
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

export function destroyWorldbookGroupingUi() {
  enabled = false;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  removeWorldbookGroupingUiStyles();

  const { $globalWorldSelect, $worldEditorSelect } = findWorldbookSelects();
  if ($globalWorldSelect?.length) {
    uninstallSelect2GroupingHandlers($globalWorldSelect[0]);
    const injected = !!$globalWorldSelect.data('ptWorldbookGroupingSelect2Injected');
    if (injected && isSelect2Initialized($globalWorldSelect) && typeof $globalWorldSelect.select2 === 'function') {
      try {
        $globalWorldSelect.select2('destroy');
      } catch {
        // ignore
      }
    }
    $globalWorldSelect.removeData('ptWorldbookGroupingSelect2Injected');
  }
  if ($worldEditorSelect?.length) {
    uninstallSelect2GroupingHandlers($worldEditorSelect[0]);
    const injected = !!$worldEditorSelect.data('ptWorldbookGroupingSelect2Injected');
    if (injected && isSelect2Initialized($worldEditorSelect) && typeof $worldEditorSelect.select2 === 'function') {
      try {
        $worldEditorSelect.select2('destroy');
      } catch {
        // ignore
      }
    }
    $worldEditorSelect.removeData('ptWorldbookGroupingSelect2Injected');
  }
}
