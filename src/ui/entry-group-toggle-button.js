// 预设条目分组 - 一键开关分组内所有条目的功能
// 类似正则分组的批量开关功能

import { getJQuery } from '../core/utils.js';

/**
 * 为分组头部添加一键开关按钮
 * @param {jQuery} $groupHeader - 分组头部元素
 * @param {Array} groupItems - 分组内的条目元素数组
 * @param {Function} onToggle - 切换回调函数 (enabled: boolean) => Promise<void>
 */
export function addToggleAllButtonToGroupHeader($groupHeader, groupItems, onToggle) {
  const $ = getJQuery();

  // 检查是否已经添加过按钮
  if ($groupHeader.find('.pt-entry-group-toggle-all-btn').length) {
    return;
  }

  // 创建一键开关按钮（保持与条目开关一致的样式）
  const $toggleBtn = $(`
    <button type="button" class="pt-entry-group-toggle-all-btn"
            title="一键开关分组内所有条目"
            aria-label="一键开关分组内所有条目"
            style="margin-left: 4px;">
      <i class="fa-fw fa-solid fa-toggle-on"></i>
    </button>
  `);

  // 更新按钮状态（根据分组内条目的启用状态）
  const updateButtonState = () => {
    if (!groupItems || groupItems.length === 0) return;

    let enabledCount = 0;
    let totalCount = 0;

    groupItems.forEach(item => {
      const $item = $(item);
      const $toggle = $item.find('.prompt-manager-toggle-action');
      if ($toggle.length) {
        totalCount++;
        // 检查条目是否启用（通过检查toggle按钮的状态）
        const isEnabled = !$toggle.hasClass('disabled') && !$toggle.hasClass('fa-toggle-off');
        if (isEnabled) enabledCount++;
      }
    });

    // 更新按钮图标和状态
    const $icon = $toggleBtn.find('i');
    $toggleBtn.removeClass('is-mixed');
    if (enabledCount === 0) {
      // 全部禁用
      $icon.removeClass('fa-toggle-on').addClass('fa-toggle-off');
      $toggleBtn.attr('title', '一键启用分组内所有条目');
      $toggleBtn.attr('data-state', 'off');
    } else if (enabledCount === totalCount) {
      // 全部启用
      $icon.removeClass('fa-toggle-off').addClass('fa-toggle-on');
      $toggleBtn.attr('title', '一键禁用分组内所有条目');
      $toggleBtn.attr('data-state', 'on');
    } else {
      // 部分启用
      $icon.removeClass('fa-toggle-off').addClass('fa-toggle-on');
      $toggleBtn.attr('title', '一键开关分组内所有条目（当前部分启用）');
      $toggleBtn.attr('data-state', 'mixed');
      $toggleBtn.addClass('is-mixed');
    }
  };

  // 点击事件
  $toggleBtn.on('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();

    if (!groupItems || groupItems.length === 0) return;

    // 判断当前状态
    const currentState = $toggleBtn.attr('data-state');
    const shouldEnable = currentState === 'off' || currentState === 'mixed';

    try {
      // 禁用按钮防止重复点击
      $toggleBtn.prop('disabled', true);

      // 调用回调函数
      if (typeof onToggle === 'function') {
        await onToggle(shouldEnable, groupItems);
      }

      // 更新按钮状态
      updateButtonState();

    } catch (error) {
      console.error('[EntryGroupToggle] 切换失败:', error);
      if (window.toastr) {
        toastr.error('切换失败: ' + error.message);
      }
    } finally {
      $toggleBtn.prop('disabled', false);
    }
  });

  // 将按钮插入到编辑按钮之前
  const $editBtn = $groupHeader.find('.pt-entry-group-edit-btn');
  if ($editBtn.length) {
    $editBtn.before($toggleBtn);
  } else {
    $groupHeader.append($toggleBtn);
  }

  // 初始化按钮状态
  updateButtonState();

  return $toggleBtn;
}

/**
 * 切换分组内所有条目的启用状态
 * @param {boolean} enabled - 是否启用
 * @param {Array} groupItems - 分组内的条目元素数组
 */
export async function toggleAllEntriesInGroup(enabled, groupItems) {
  const $ = getJQuery();

  if (!groupItems || groupItems.length === 0) return;

  const identifiers = [];
  for (const item of groupItems) {
    const $item = $(item);
    const $toggle = $item.find('.prompt-manager-toggle-action');
    if (!$toggle.length) continue;

    const identifier = String($item.attr('data-pm-identifier') ?? '').trim();
    if (identifier) identifiers.push(identifier);
  }

  if (identifiers.length > 0) {
    const handled = await tryBulkToggleWithPromptManager(enabled, identifiers);
    if (handled) return;
  }

  // 遍历分组内的所有条目（兜底：逐个触发，但不再人工延迟）
  for (const item of groupItems) {
    const $item = $(item);
    const $toggle = $item.find('.prompt-manager-toggle-action');

    if (!$toggle.length) continue;

    // 检查当前状态
    const isCurrentlyEnabled = !$toggle.hasClass('disabled') && !$toggle.hasClass('fa-toggle-off');

    // 如果状态不同，则触发点击
    if (isCurrentlyEnabled !== enabled) {
      $toggle.trigger('click');
    }
  }
}

async function tryBulkToggleWithPromptManager(enabled, identifiers) {
  if (!Array.isArray(identifiers) || identifiers.length === 0) return false;

  try {
    const mod = await import('/scripts/openai.js');
    const promptManager = mod?.promptManager;
    if (!promptManager || typeof promptManager.getPromptOrderEntry !== 'function') return false;

    const activeCharacter = promptManager.activeCharacter;
    if (!activeCharacter) return false;

    const counts = promptManager.tokenHandler?.getCounts?.();
    let changed = false;

    for (const identifier of identifiers) {
      const entry = promptManager.getPromptOrderEntry(activeCharacter, identifier);
      if (!entry || entry.enabled === enabled) continue;
      entry.enabled = enabled;
      if (counts) counts[identifier] = null;
      changed = true;
    }

    if (changed) {
      promptManager.render?.(false);
      promptManager.saveServiceSettings?.();
    }

    return true;
  } catch (error) {
    console.warn('[EntryGroupToggle] Failed to bulk toggle via PromptManager:', error);
    return false;
  }
}

/**
 * 为所有分组头部添加一键开关按钮
 * @param {jQuery} $listContainer - 列表容器
 */
export function addToggleAllButtonsToAllGroups($listContainer) {
  const $ = getJQuery();

  if (!$listContainer || !$listContainer.length) return;

  // 查找所有分组头部
  $listContainer.find('.pt-entry-group-header').each(function() {
    const $header = $(this);
    const $wrapper = $header.next('.pt-entry-group-wrapper');

    if (!$wrapper.length) return;

    // 获取分组内的所有条目
    const groupItems = $wrapper.find('li[data-pm-identifier]').toArray();

    if (groupItems.length === 0) return;

    // 添加一键开关按钮
    addToggleAllButtonToGroupHeader($header, groupItems, async (enabled, items) => {
      await toggleAllEntriesInGroup(enabled, items);
    });
  });
}
