// 转移界面中的分组显示功能
// 允许在转移界面显示分组，并支持一键转移整个分组

import { getJQuery } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';
import { getAllPresetGroupings } from '../features/entry-grouping.js';

/**
 * 在转移界面中显示分组
 * @param {Array} entries - 条目数组
 * @param {string} side - 侧边标识 ('left', 'right', 'single')
 * @param {string} presetName - 预设名称
 * @returns {Object} - 包含分组信息的对象 { groups, ungroupedEntries }
 */
export function organizeEntriesIntoGroups(entries, side, presetName) {
  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    return { groups: [], ungroupedEntries: entries || [] };
  }

  if (!presetName) {
    return { groups: [], ungroupedEntries: entries };
  }

  // 获取预设的分组配置
  const orderedIdentifiers = entries.map(e => e.identifier).filter(Boolean);
  const groupings = getAllPresetGroupings(presetName, orderedIdentifiers);

  if (!groupings || groupings.length === 0) {
    return { groups: [], ungroupedEntries: entries };
  }

  const groups = [];
  const groupedIdentifiers = new Set();

  // 处理每个分组
  for (const grouping of groupings) {
    if (grouping.unresolved) continue;

    const { startIdentifier, endIdentifier, name } = grouping;

    // 找到起始和结束位置
    const startIndex = entries.findIndex(e => e.identifier === startIdentifier);
    const endIndex = entries.findIndex(e => e.identifier === endIdentifier);

    if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) continue;

    // 提取分组内的条目
    const groupEntries = entries.slice(startIndex, endIndex + 1);

    // 标记已分组的条目
    groupEntries.forEach(e => {
      if (e.identifier) groupedIdentifiers.add(e.identifier);
    });

    groups.push({
      name: name || '分组',
      entries: groupEntries,
      startIndex,
      endIndex,
      grouping,
    });
  }

  // 未分组的条目
  const ungroupedEntries = entries.filter(e => !groupedIdentifiers.has(e.identifier));

  return { groups, ungroupedEntries };
}

/**
 * 渲染分组头部（在转移界面中）
 * @param {Object} group - 分组对象
 * @param {string} side - 侧边标识
 * @returns {string} - HTML字符串
 */
export function renderGroupHeaderForTransfer(group, side) {
  const vars = CommonStyles.getVars();
  const { isMobile } = vars;

  return `
    <div class="pt-transfer-group-header" data-side="${side}" data-group-name="${group.name}" style="
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

/**
 * 渲染分组容器（包含分组内的条目）
 * @param {Object} group - 分组对象
 * @param {string} side - 侧边标识
 * @returns {string} - HTML字符串
 */
export function renderGroupContainerForTransfer(group, side) {
  return `
    <div class="pt-transfer-group-container" data-side="${side}" data-group-name="${group.name}" style="
      display: none;
      margin-bottom: 6px;
    ">
      <!-- 分组内的条目将在这里渲染 -->
    </div>
  `;
}

/**
 * 绑定分组相关的事件
 * @param {jQuery} $listContainer - 列表容器
 */
export function bindGroupEventsForTransfer($listContainer) {
  const $ = getJQuery();

  if (!$listContainer || !$listContainer.length) return;

  // 折叠/展开分组
  $listContainer.off('click.pt-group-toggle', '.pt-transfer-group-header').on('click.pt-group-toggle', '.pt-transfer-group-header', function(e) {
    // 如果点击的是复选框，不触发折叠/展开
    if ($(e.target).hasClass('group-checkbox')) return;

    const $header = $(this);
    const groupName = $header.data('group-name');
    const side = $header.data('side');
    const $container = $listContainer.find(`.pt-transfer-group-container[data-side="${side}"][data-group-name="${groupName}"]`);
    const $icon = $header.find('.pt-group-toggle-icon');

    if ($container.is(':visible')) {
      $container.slideUp(200);
      $icon.css('transform', 'rotate(0deg)');
    } else {
      $container.slideDown(200);
      $icon.css('transform', 'rotate(90deg)');
    }
  });

  // 分组复选框变化时，同步选中/取消选中分组内的所有条目
  $listContainer.off('change.pt-group-checkbox', '.pt-transfer-group-header .group-checkbox').on('change.pt-group-checkbox', '.pt-transfer-group-header .group-checkbox', function(e) {
    e.stopPropagation();

    const $checkbox = $(this);
    const $header = $checkbox.closest('.pt-transfer-group-header');
    const groupName = $header.data('group-name');
    const side = $header.data('side');
    const isChecked = $checkbox.prop('checked');

    // 找到分组容器内的所有条目复选框
    const $container = $listContainer.find(`.pt-transfer-group-container[data-side="${side}"][data-group-name="${groupName}"]`);
    const $entryCheckboxes = $container.find('.entry-checkbox');

    // 同步选中状态
    $entryCheckboxes.prop('checked', isChecked);

    // 触发选中数量更新
    if (typeof window.updateSelectionCount === 'function') {
      window.updateSelectionCount();
    }
  });

  // 分组内条目复选框变化时，更新分组复选框状态
  $listContainer.off('change.pt-entry-in-group', '.pt-transfer-group-container .entry-checkbox').on('change.pt-entry-in-group', '.pt-transfer-group-container .entry-checkbox', function() {
    const $entryCheckbox = $(this);
    const $container = $entryCheckbox.closest('.pt-transfer-group-container');
    const groupName = $container.data('group-name');
    const side = $container.data('side');

    // 找到对应的分组头部复选框
    const $groupHeader = $listContainer.find(`.pt-transfer-group-header[data-side="${side}"][data-group-name="${groupName}"]`);
    const $groupCheckbox = $groupHeader.find('.group-checkbox');

    // 检查分组内所有条目的选中状态
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

/**
 * 获取选中的分组（包括分组内的所有条目）
 * @param {string} side - 侧边标识
 * @param {jQuery} $listContainer - 列表容器（可选）
 * @returns {Array} - 选中的分组数组
 */
export function getSelectedGroups(side, $listContainer) {
  const $ = getJQuery();

  if (!$listContainer) {
    $listContainer = $(`#${side}-entries-list`);
  }

  if (!$listContainer || !$listContainer.length) return [];

  const selectedGroups = [];

  $listContainer.find(`.pt-transfer-group-header[data-side="${side}"] .group-checkbox:checked`).each(function() {
    const $checkbox = $(this);
    const $header = $checkbox.closest('.pt-transfer-group-header');
    const groupName = $header.data('group-name');

    // 获取分组内的所有条目
    const $container = $listContainer.find(`.pt-transfer-group-container[data-side="${side}"][data-group-name="${groupName}"]`);
    const entries = [];

    $container.find('.entry-item').each(function() {
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

/**
 * 在现有的条目列表中应用分组显示
 * 这个函数会重新组织已渲染的条目，将它们按分组包装
 * @param {jQuery} $listContainer - 列表容器
 * @param {Array} entries - 条目数组
 * @param {string} side - 侧边标识
 * @param {string} presetName - 预设名称
 */
export function applyGroupDisplayToRenderedEntries($listContainer, entries, side, presetName) {
  const $ = getJQuery();

  if (!$listContainer || !$listContainer.length) return;
  if (!entries || !Array.isArray(entries) || entries.length === 0) return;
  if (!presetName) return;

  // 获取分组信息
  const { groups, ungroupedEntries } = organizeEntriesIntoGroups(entries, side, presetName);

  if (groups.length === 0) return;

  // 为每个分组创建头部和容器
  for (const group of groups) {
    const { startIndex, endIndex } = group;

    // 找到分组的第一个条目元素
    const $firstEntry = $listContainer.find(`.entry-item[data-side="${side}"][data-index="${startIndex}"]`);

    if (!$firstEntry.length) continue;

    // 插入分组头部
    const groupHeaderHtml = renderGroupHeaderForTransfer(group, side);
    $firstEntry.before(groupHeaderHtml);

    // 创建分组容器
    const groupContainerHtml = renderGroupContainerForTransfer(group, side);
    const $groupHeader = $firstEntry.prev('.pt-transfer-group-header');
    $groupHeader.after(groupContainerHtml);

    // 将分组内的条目移动到容器中
    const $groupContainer = $groupHeader.next('.pt-transfer-group-container');

    for (let i = startIndex; i <= endIndex; i++) {
      const $entry = $listContainer.find(`.entry-item[data-side="${side}"][data-index="${i}"]`);
      if ($entry.length) {
        $groupContainer.append($entry);
      }
    }
  }

  // 绑定事件
  bindGroupEventsForTransfer($listContainer);
}
