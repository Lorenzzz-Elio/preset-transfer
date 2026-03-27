import { escapeAttr, getJQuery } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';
import { getAllPresetGroupings } from '../features/entry-grouping.js';

const transferGroupExpandStates = new Map();
const transferListScrollStates = new Map();

function getTransferListStateKey(side, presetName) {
  return `${String(side ?? '').trim()}::${String(presetName ?? '').trim()}`;
}

function getTransferGroupStateKey(side, presetName, group, fallbackIndex = 0) {
  const groupId = String(group?.grouping?.id ?? group?.id ?? '').trim();
  const groupName = String(group?.name ?? group?.groupName ?? '').trim();
  return `${getTransferListStateKey(side, presetName)}::${groupId || groupName || fallbackIndex}`;
}

export function rememberTransferPanelState($listContainer, side, presetName) {
  const $ = getJQuery();

  if (!$listContainer?.length || !presetName) return;

  transferListScrollStates.set(getTransferListStateKey(side, presetName), $listContainer.scrollTop());

  $listContainer.find(`.pt-transfer-group-header[data-side="${side}"]`).each(function (index) {
    const $header = $(this);
    const stateKey = String($header.attr('data-group-key') ?? '').trim()
      || getTransferGroupStateKey(side, presetName, {
        id: $header.attr('data-group-id'),
        groupName: $header.attr('data-group-name'),
      }, index);
    transferGroupExpandStates.set(stateKey, $header.next('.pt-transfer-group-container').is(':visible'));
  });
}

export function restoreTransferPanelScrollState($listContainer, side, presetName) {
  if (!$listContainer?.length || !presetName) return;

  const savedScrollTop = transferListScrollStates.get(getTransferListStateKey(side, presetName));
  if (!Number.isFinite(savedScrollTop)) return;

  const applyScroll = () => {
    const node = $listContainer[0];
    if (!node) return;
    const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
    $listContainer.scrollTop(Math.min(savedScrollTop, maxScrollTop));
  };

  applyScroll();
  requestAnimationFrame(applyScroll);
  setTimeout(applyScroll, 80);
}

/**
 * Build transfer-panel grouping data from the preset's entry grouping config.
 * Group membership is resolved from explicit memberIdentifiers so it stays valid
 * even after the storage format migrated away from start/end anchors.
 */
export function organizeEntriesIntoGroups(entries, side, presetName) {
  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    return { groups: [], ungroupedEntries: entries || [] };
  }

  if (!presetName) {
    return { groups: [], ungroupedEntries: entries };
  }

  const orderedIdentifiers = entries.map((entry) => entry.identifier).filter(Boolean);
  const groupings = getAllPresetGroupings(presetName, orderedIdentifiers);

  if (!groupings || groupings.length === 0) {
    return { groups: [], ungroupedEntries: entries };
  }

  const groups = [];
  const groupedIdentifiers = new Set();

  for (const grouping of groupings) {
    if (grouping?.unresolved) continue;

    const memberIdentifiers = Array.isArray(grouping?.memberIdentifiers)
      ? grouping.memberIdentifiers.map((id) => String(id ?? '').trim()).filter(Boolean)
      : [];

    if (memberIdentifiers.length === 0) continue;

    const memberSet = new Set(memberIdentifiers);
    const groupEntries = entries.filter((entry) => memberSet.has(String(entry?.identifier ?? '').trim()));

    if (groupEntries.length === 0) continue;

    const entryIdentifiers = groupEntries
      .map((entry) => String(entry?.identifier ?? '').trim())
      .filter(Boolean);

    for (const identifier of entryIdentifiers) {
      groupedIdentifiers.add(identifier);
    }

    const anchorIdentifier = entryIdentifiers[0] || '';
    const anchorIndex = anchorIdentifier
      ? entries.findIndex((entry) => String(entry?.identifier ?? '').trim() === anchorIdentifier)
      : -1;

    groups.push({
      name: grouping?.name || '分组',
      entries: groupEntries,
      entryIdentifiers,
      anchorIndex,
      grouping,
    });
  }

  groups.sort((a, b) => {
    const left = a.anchorIndex === -1 ? Number.MAX_SAFE_INTEGER : a.anchorIndex;
    const right = b.anchorIndex === -1 ? Number.MAX_SAFE_INTEGER : b.anchorIndex;
    return left - right;
  });

  const ungroupedEntries = entries.filter(
    (entry) => !groupedIdentifiers.has(String(entry?.identifier ?? '').trim()),
  );

  return { groups, ungroupedEntries };
}

export function renderGroupHeaderForTransfer(group, side, options = {}) {
  const vars = CommonStyles.getVars();
  const { isMobile } = vars;
  const isExpanded = options.isExpanded === true;
  const groupStateKey = String(options.groupStateKey ?? '').trim();
  const groupId = String(group?.grouping?.id ?? '').trim();

  return `
    <div class="pt-transfer-group-header" data-side="${escapeAttr(side)}" data-group-id="${escapeAttr(groupId)}" data-group-name="${escapeAttr(group.name)}" data-group-key="${escapeAttr(groupStateKey)}" style="
      background: ${vars.sectionBg};
      border: 1px solid ${vars.borderColor};
      border-radius: 8px;
      padding: ${isMobile ? '10px 12px' : '12px 14px'};
      margin-bottom: ${isMobile ? '8px' : '6px'};
      display: flex;
      align-items: center;
      cursor: pointer;
      transition: all 0.2s ease;
    ">
      <input type="checkbox" class="group-checkbox" style="
        margin-right: ${isMobile ? '8px' : '10px'};
        width: ${isMobile ? '16px' : '16px'};
        height: ${isMobile ? '16px' : '16px'};
        accent-color: ${vars.accentColor};
        cursor: pointer;
        position: relative;
        z-index: 10;
      ">
      <span class="pt-group-toggle-icon" style="
        margin-right: 8px;
        font-size: ${isMobile ? '12px' : '14px'};
        color: ${vars.textColor};
        transition: transform 0.2s ease;
        transform: rotate(${isExpanded ? '90deg' : '0deg'});
      ">▶</span>
      <div style="flex: 1;">
        <span class="pt-group-name" style="
          font-weight: 600;
          color: ${vars.textColor};
          font-size: ${isMobile ? 'calc(var(--pt-font-size) * 0.8125)' : 'calc(var(--pt-font-size) * 0.875)'};
        ">${group.name}</span>
        <span class="pt-group-count" style="
          margin-left: 8px;
          color: ${vars.tipColor};
          font-size: ${isMobile ? 'calc(var(--pt-font-size) * 0.75)' : 'calc(var(--pt-font-size) * 0.8125)'};
        ">(${group.entries.length})</span>
      </div>
    </div>
  `;
}

export function renderGroupContainerForTransfer(group, side, options = {}) {
  const isExpanded = options.isExpanded === true;
  const groupStateKey = String(options.groupStateKey ?? '').trim();
  const groupId = String(group?.grouping?.id ?? '').trim();

  return `
    <div class="pt-transfer-group-container" data-side="${escapeAttr(side)}" data-group-id="${escapeAttr(groupId)}" data-group-name="${escapeAttr(group.name)}" data-group-key="${escapeAttr(groupStateKey)}" style="
      display: ${isExpanded ? 'block' : 'none'};
      margin-bottom: 6px;
    ">
    </div>
  `;
}

export function bindGroupEventsForTransfer($listContainer) {
  const $ = getJQuery();

  if (!$listContainer || !$listContainer.length) return;

  $listContainer
    .off('click.pt-group-toggle', '.pt-transfer-group-header')
    .on('click.pt-group-toggle', '.pt-transfer-group-header', function (e) {
      if ($(e.target).hasClass('group-checkbox')) return;

      const $header = $(this);
      const stateKey = String($header.attr('data-group-key') ?? '').trim();
      const $container = $header.next('.pt-transfer-group-container');
      const $icon = $header.find('.pt-group-toggle-icon');
      const willExpand = !$container.is(':visible');

      if (willExpand) {
        $container.slideDown(200);
        $icon.css('transform', 'rotate(90deg)');
      } else {
        $container.slideUp(200);
        $icon.css('transform', 'rotate(0deg)');
      }

      if (stateKey) transferGroupExpandStates.set(stateKey, willExpand);
    });

  $listContainer
    .off('change.pt-group-checkbox', '.pt-transfer-group-header .group-checkbox')
    .on('change.pt-group-checkbox', '.pt-transfer-group-header .group-checkbox', function (e) {
      e.stopPropagation();

      const $checkbox = $(this);
      const $header = $checkbox.closest('.pt-transfer-group-header');
      const isChecked = $checkbox.prop('checked');

      const $container = $header.next('.pt-transfer-group-container');
      const $entryCheckboxes = $container.find('.entry-checkbox');

      $entryCheckboxes.prop('checked', isChecked);

      if (typeof window.updateSelectionCount === 'function') {
        window.updateSelectionCount();
      }
    });

  $listContainer
    .off('change.pt-entry-in-group', '.pt-transfer-group-container .entry-checkbox')
    .on('change.pt-entry-in-group', '.pt-transfer-group-container .entry-checkbox', function () {
      const $entryCheckbox = $(this);
      const $container = $entryCheckbox.closest('.pt-transfer-group-container');
      const $groupHeader = $container.prev('.pt-transfer-group-header');
      const $groupCheckbox = $groupHeader.find('.group-checkbox');
      const $allEntryCheckboxes = $container.find('.entry-checkbox');
      const checkedCount = $allEntryCheckboxes.filter(':checked').length;
      const totalCount = $allEntryCheckboxes.length;

      if (checkedCount === 0) {
        $groupCheckbox.prop('checked', false);
        $groupCheckbox.prop('indeterminate', false);
      } else if (checkedCount === totalCount) {
        $groupCheckbox.prop('checked', true);
        $groupCheckbox.prop('indeterminate', false);
      } else {
        $groupCheckbox.prop('checked', false);
        $groupCheckbox.prop('indeterminate', true);
      }
    });
}

export function getSelectedGroups(side, $listContainer) {
  const $ = getJQuery();

  if (!$listContainer) {
    $listContainer = $(`#${side}-entries-list`);
  }

  if (!$listContainer || !$listContainer.length) return [];

  const selectedGroups = [];

  $listContainer.find(`.pt-transfer-group-header[data-side="${side}"] .group-checkbox:checked`).each(function () {
    const $checkbox = $(this);
    const $header = $checkbox.closest('.pt-transfer-group-header');
    const groupName = $header.data('group-name');
    const $container = $header.next('.pt-transfer-group-container');
    const entries = [];

    $container.find('.entry-item').each(function () {
      const $item = $(this);
      const index = parseInt($item.data('index'));
      const identifier = $item.data('identifier');
      entries.push({ index, identifier });
    });

    selectedGroups.push({
      name: groupName,
      entries,
    });
  });

  return selectedGroups;
}

function findRenderedEntryByIdentifier($listContainer, side, identifier) {
  const $ = getJQuery();

  return $listContainer
    .find(`.entry-item[data-side="${side}"]`)
    .filter(function () {
      return String($(this).attr('data-identifier') ?? '').trim() === String(identifier ?? '').trim();
    })
    .first();
}

/**
 * Wrap already-rendered entry rows into transfer-panel groups.
 */
export function applyGroupDisplayToRenderedEntries($listContainer, entries, side, presetName) {
  if (!$listContainer || !$listContainer.length) return;
  if (!entries || !Array.isArray(entries) || entries.length === 0) return;
  if (!presetName) return;

  const { groups } = organizeEntriesIntoGroups(entries, side, presetName);

  if (groups.length === 0) return;

  for (const [groupIndex, group] of groups.entries()) {
    const entryIdentifiers = Array.isArray(group.entryIdentifiers) ? group.entryIdentifiers : [];
    const firstIdentifier = entryIdentifiers[0];

    if (!firstIdentifier) continue;

    const $firstEntry = findRenderedEntryByIdentifier($listContainer, side, firstIdentifier);
    if (!$firstEntry.length) continue;

    const groupStateKey = getTransferGroupStateKey(side, presetName, group, groupIndex);
    const isExpanded = transferGroupExpandStates.get(groupStateKey) === true;

    const groupHeaderHtml = renderGroupHeaderForTransfer(group, side, { groupStateKey, isExpanded });
    $firstEntry.before(groupHeaderHtml);

    const groupContainerHtml = renderGroupContainerForTransfer(group, side, { groupStateKey, isExpanded });
    const $groupHeader = $firstEntry.prev('.pt-transfer-group-header');
    $groupHeader.after(groupContainerHtml);

    const $groupContainer = $groupHeader.next('.pt-transfer-group-container');

    for (const identifier of entryIdentifiers) {
      const $entry = findRenderedEntryByIdentifier($listContainer, side, identifier);
      if ($entry.length) {
        $groupContainer.append($entry);
      }
    }
  }

  bindGroupEventsForTransfer($listContainer);
}
