import {
  debounce,
  ensureViewportCssVars,
  escapeHtml,
  getJQuery,
} from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';
import { bindWorldbookBatchOrderDnd, unbindWorldbookBatchOrderDnd } from '../core/worldbook-order-dnd.js';
import { batchDeleteWorldbooks, computeCharacterLinkedWorldbooks, listWorldbooks } from '../core/worldbook-api.js';
import {
  assignWorldbooksToGroup,
  dissolveWorldbookGroupInBucket,
  loadWorldbookGroupState,
  normalizeWorldbookGroupState,
  pruneWorldbookGroupState,
  removeWorldbooksFromAllGroups,
  renameWorldbookGroupInBucket,
  saveWorldbookGroupState,
} from '../core/worldbook-group-state.js';
import { renderWorldbookGroupedList } from './batch-list-render.js';
import { getWorldbookBatchManageModalHtml } from './batch-modal-template.js';
import { getWorldbookBatchManageModalStyles } from './batch-modal-styles.js';

const GROUP_DIALOG_ID = 'pt-worldbook-batch-group-dialog';
const GROUP_ACTIONS_DIALOG_ID = 'pt-worldbook-batch-group-actions-dialog';
function showGroupInputDialog({ title, placeholder, defaultValue, confirmLabel = '确定', onConfirm, onUngroup }) {
  const $ = getJQuery();
  const vars = CommonStyles.getVars();
  ensureViewportCssVars();

  $(`#${GROUP_DIALOG_ID}`).remove();
  $(`#${GROUP_ACTIONS_DIALOG_ID}`).remove();

  const dialog = $(`
    <div id="${GROUP_DIALOG_ID}" style="
      position: fixed; top: 0; left: 0; width: 100vw;
      height: 100vh; height: 100dvh; height: calc(var(--pt-vh, 1vh) * 100);
      background: rgba(0,0,0,0.5); z-index: 10005;
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      padding-top: calc(16px + env(safe-area-inset-top));
      padding-bottom: calc(16px + env(safe-area-inset-bottom));">
      <div style="
        background: ${vars.bgColor}; padding: 20px; border-radius: 12px;
        width: min(520px, 92vw); box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <div style="font-weight: 600; margin-bottom: 12px; white-space: nowrap;">${escapeHtml(String(title ?? ''))}</div>
        <input type="text" class="pt-dialog-input" value="${escapeHtml(String(defaultValue ?? ''))}" placeholder="${escapeHtml(
          String(placeholder ?? ''),
        )}" style="
          width: 100%; padding: 8px; border: 1px solid ${vars.borderColor};
          border-radius: 6px; background: ${vars.inputBg}; color: ${vars.textColor};
          margin-bottom: 12px; box-sizing: border-box;">
        <div style="display: flex; flex-direction: row; gap: 8px; justify-content: flex-end; flex-wrap: wrap;">
          <button class="pt-dialog-cancel menu_button" style="padding: 6px 16px; white-space: nowrap;">取消</button>
          ${onUngroup ? `<button class="pt-dialog-ungroup menu_button" style="padding: 6px 16px; white-space: nowrap;">取消分组</button>` : ''}
          <button class="pt-dialog-confirm menu_button" style="padding: 6px 16px; white-space: nowrap;">${escapeHtml(
            String(confirmLabel),
          )}</button>
        </div>
      </div>
    </div>
  `);

  $('body').append(dialog);

  dialog.on('pointerdown mousedown click', (e) => e.stopPropagation());
  dialog.children().first().on('pointerdown mousedown click', (e) => e.stopPropagation());

  const $input = dialog.find('.pt-dialog-input');
  $input.focus().select();

  const closeDialog = () => dialog.remove();
  const confirmDialog = () => {
    const value = String($input.val() ?? '').trim();
    if (!value) return;
    closeDialog();
    onConfirm?.(value);
  };
  const ungroupDialog = () => {
    closeDialog();
    onUngroup?.();
  };

  dialog.find('.pt-dialog-cancel').on('click', closeDialog);
  dialog.find('.pt-dialog-confirm').on('click', confirmDialog);
  dialog.find('.pt-dialog-ungroup').on('click', ungroupDialog);
  $input.on('keypress', (e) => {
    if (e.key === 'Enter') confirmDialog();
  });
}

function showGroupActionsDialog({ title, onRename, onDissolve }) {
  const $ = getJQuery();
  const vars = CommonStyles.getVars();
  ensureViewportCssVars();

  $(`#${GROUP_ACTIONS_DIALOG_ID}`).remove();
  $(`#${GROUP_DIALOG_ID}`).remove();

  const dialog = $(`
    <div id="${GROUP_ACTIONS_DIALOG_ID}" style="
      position: fixed; top: 0; left: 0; width: 100vw;
      height: 100vh; height: 100dvh; height: calc(var(--pt-vh, 1vh) * 100);
      background: rgba(0,0,0,0.5); z-index: 10005;
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      padding-top: calc(16px + env(safe-area-inset-top));
      padding-bottom: calc(16px + env(safe-area-inset-bottom));">
      <div style="
        background: ${vars.bgColor}; padding: 20px; border-radius: 12px;
        width: min(520px, 92vw); box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <div style="font-weight: 600; margin-bottom: 12px;">${escapeHtml(String(title ?? ''))}</div>
        <div style="display: flex; flex-direction: row; gap: 8px; justify-content: flex-end; flex-wrap: wrap;">
          <button class="pt-actions-cancel menu_button" style="padding: 6px 16px; white-space: nowrap;">取消</button>
          <button class="pt-actions-dissolve menu_button" style="padding: 6px 16px; white-space: nowrap;">取消分组</button>
          <button class="pt-actions-rename menu_button" style="padding: 6px 16px; white-space: nowrap;">重命名</button>
        </div>
      </div>
    </div>
  `);

  $('body').append(dialog);

  const closeDialog = () => dialog.remove();
  dialog.on('click', function (e) {
    if (e.target === this) closeDialog();
  });
  dialog.children().first().on('pointerdown mousedown click', (e) => e.stopPropagation());

  dialog.find('.pt-actions-cancel').on('click', closeDialog);
  dialog.find('.pt-actions-rename').on('click', () => {
    closeDialog();
    onRename?.();
  });
  dialog.find('.pt-actions-dissolve').on('click', () => {
    closeDialog();
    onDissolve?.();
  });
}

function showTopGroupActionsDialog({ title, groupingEnabled, onRename, onToggleGrouping }) {
  const $ = getJQuery();
  const vars = CommonStyles.getVars();
  ensureViewportCssVars();

  $(`#${GROUP_ACTIONS_DIALOG_ID}`).remove();
  $(`#${GROUP_DIALOG_ID}`).remove();

  const toggleLabel = groupingEnabled ? '取消分组' : '显示分组';

  const dialog = $(`
    <div id="${GROUP_ACTIONS_DIALOG_ID}" style="
      position: fixed; top: 0; left: 0; width: 100vw;
      height: 100vh; height: 100dvh; height: calc(var(--pt-vh, 1vh) * 100);
      background: rgba(0,0,0,0.5); z-index: 10005;
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      padding-top: calc(16px + env(safe-area-inset-top));
      padding-bottom: calc(16px + env(safe-area-inset-bottom));">
      <div style="
        background: ${vars.bgColor}; padding: 20px; border-radius: 12px;
        width: min(520px, 92vw); box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <div style="font-weight: 600; margin-bottom: 12px;">${escapeHtml(String(title ?? ''))}</div>
        <div style="display: flex; flex-direction: row; gap: 8px; justify-content: flex-end; flex-wrap: wrap;">
          <button class="pt-actions-cancel menu_button" style="padding: 6px 16px; white-space: nowrap;">取消</button>
          <button class="pt-actions-toggle menu_button" style="padding: 6px 16px; white-space: nowrap;">${toggleLabel}</button>
          <button class="pt-actions-rename menu_button" style="padding: 6px 16px; white-space: nowrap;">重命名</button>
        </div>
      </div>
    </div>
  `);

  $('body').append(dialog);

  const closeDialog = () => dialog.remove();
  dialog.on('click', function (e) {
    if (e.target === this) closeDialog();
  });
  dialog.children().first().on('pointerdown mousedown click', (e) => e.stopPropagation());

  dialog.find('.pt-actions-cancel').on('click', closeDialog);
  dialog.find('.pt-actions-rename').on('click', () => {
    closeDialog();
    onRename?.();
  });
  dialog.find('.pt-actions-toggle').on('click', () => {
    closeDialog();
    onToggleGrouping?.();
  });
}

async function createWorldbookBatchManageModal() {
  const $ = getJQuery();

  const closeModal = () => {
    try {
      unbindWorldbookBatchOrderDnd($('#batch-delete-modal')[0]);
    } catch {
      // ignore
    }
    $('#batch-delete-modal').remove();
    $('#batch-delete-modal-styles').remove();
    $(`#${GROUP_DIALOG_ID}`).remove();
    $(`#${GROUP_ACTIONS_DIALOG_ID}`).remove();
    $(document).off('keydown.batch-delete');
  };

  closeModal();

  const vars = CommonStyles.getVars();
  let worldbookNames = await listWorldbooks();
  const boundSet = await computeCharacterLinkedWorldbooks();

  const existingNamesSet = new Set(worldbookNames.map((x) => String(x ?? '').trim()).filter(Boolean));
  let groupState = normalizeWorldbookGroupState(loadWorldbookGroupState());

  groupState = pruneWorldbookGroupState(groupState, existingNamesSet);
  saveWorldbookGroupState(groupState);

  const listHtml = renderWorldbookGroupedList({ worldbookNames, boundSet, groupState });
  $('body').append(getWorldbookBatchManageModalHtml({ listHtml }));

  const styles = getWorldbookBatchManageModalStyles(vars);
  $('head').append(`<style id="batch-delete-modal-styles">${styles}</style>`);

  const escapeAttr = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const expandedGroups = new Set();

  const isSearchActive = () => Boolean(String($('#preset-search').val() ?? '').trim());

  const applyCollapseState = () => {
    $('#preset-list .pt-wb-subgroup').each(function () {
      const key = String($(this).attr('data-pt-sub') ?? '');
      if (!key) return;
      $(this).toggleClass('is-collapsed', !expandedGroups.has(key));
    });
  };

  const applyWorldbookSearchFilter = () => {
    const searchTerm = String($('#preset-search').val() ?? '').toLowerCase().trim();
    const hasSearch = Boolean(searchTerm);

    if (hasSearch) {
      $('#preset-list .pt-wb-subgroup').removeClass('is-collapsed');
    } else {
      applyCollapseState();
      $('#preset-list .pt-wb-subgroup').show();
    }

    $('#preset-list .pt-wb-item').each(function () {
      const name = $(this).find('.preset-name').text().toLowerCase();
      $(this).toggle(!hasSearch || name.includes(searchTerm));
    });

    if (hasSearch) {
      $('#preset-list .pt-wb-subgroup').each(function () {
        const hasVisibleItems = $(this).find('.pt-wb-item:visible').length > 0;
        $(this).toggle(hasVisibleItems);
      });
    }
  };

  const updateSelectedCount = () => {
    const selected = $('#preset-list input[type="checkbox"]:checked:not(:disabled)').length;
    $('#selected-count').text(`已选择: ${selected}`);
    $('#execute-batch-group').prop('disabled', selected === 0);
    $('#execute-batch-delete').prop('disabled', selected === 0);
  };

  const rerenderWorldbookList = ({ preserveChecked = true } = {}) => {
    const checked = new Set();
    if (preserveChecked) {
      $('#preset-list input[type="checkbox"]:checked').each(function () {
        checked.add(String($(this).val() ?? ''));
      });
    }

    $('#preset-list').html(renderWorldbookGroupedList({ worldbookNames, boundSet, groupState }));

    if (preserveChecked && checked.size) {
      $('#preset-list input[type="checkbox"]').each(function () {
        if (checked.has(String($(this).val() ?? ''))) {
          $(this).prop('checked', true);
        }
      });
    }

    applyCollapseState();
    applyWorldbookSearchFilter();
    updateSelectedCount();
  };

  const getSelectedWorldbooks = () => {
    const selected = [];
    $('#preset-list input[type="checkbox"]:checked:not(:disabled)').each(function () {
      selected.push(String($(this).val() ?? ''));
    });
    return selected;
  };

  const getBucketRef = (bucketId) => {
    if (bucketId === 'flat') return groupState.flat;
    return null;
  };

  const debouncedSearch = debounce(applyWorldbookSearchFilter, 300);
  $('#preset-search').on('input', debouncedSearch);

  $('#select-all-presets').on('click', function () {
    $('#preset-list input[type="checkbox"]:not(:disabled):visible').prop('checked', true);
    updateSelectedCount();
  });

  $('#select-none-presets').on('click', function () {
    $('#preset-list input[type="checkbox"]:visible').prop('checked', false);
    updateSelectedCount();
  });

  $('#preset-list').on('change', 'input[type="checkbox"]', updateSelectedCount);
  $('#preset-list').on('click', '.pt-wb-drag-handle', function (e) {
    e.preventDefault();
    e.stopPropagation();
  });

  const toggleSubGroup = (groupEl) => {
    const $group = $(groupEl);
    if ($group.children('.pt-wb-subgroup-header').length === 0) return;
    const key = String($group.attr('data-pt-sub') ?? '');
    if (!key) return;

    const nextExpanded = $group.hasClass('is-collapsed');
    $group.toggleClass('is-collapsed', !nextExpanded);
    if (nextExpanded) expandedGroups.add(key);
    else expandedGroups.delete(key);
  };

  $('#preset-list')
    .on('click', '.pt-wb-topgroup-menu-disabled', function (e) {
      e.preventDefault();
      e.stopPropagation();

      const $top = $(this).closest('.pt-wb-top-group');
      const topId = String($top.attr('data-pt-top') ?? '');
      if (!topId) return;

      const current = normalizeWorldbookGroupState(groupState);
      const titles = current.prefs?.titles ?? {};
      const enabled = current.prefs?.enabled ?? { bound: true, unbound: true };

      const currentTitle =
        topId === 'bound'
          ? titles.bound
          : topId === 'unbound'
          ? titles.unbound
          : '';

      const groupingEnabled = topId === 'bound' ? enabled.bound !== false : topId === 'unbound' ? enabled.unbound !== false : true;

      showTopGroupActionsDialog({
        title: `分组：${String(currentTitle || '').trim() || topId}`,
        groupingEnabled,
        onRename: () => {
          showGroupInputDialog({
            title: '重命名分组标题',
            placeholder: '输入新的标题',
            defaultValue: String(currentTitle || '').trim(),
            confirmLabel: '重命名',
            onConfirm: (newTitle) => {
              groupState = renameTopGroupTitle(groupState, topId, newTitle);
              saveWorldbookGroupState(groupState);
              rerenderWorldbookList({ preserveChecked: true });
            },
          });
        },
        onToggleGrouping: () => {
          groupState = setTopGroupEnabled(groupState, topId, !groupingEnabled);
          saveWorldbookGroupState(groupState);
          rerenderWorldbookList({ preserveChecked: true });
        },
      });
    })
    .on('click', '.pt-wb-subgroup-menu', function (e) {
      e.preventDefault();
      e.stopPropagation();

      const $subgroup = $(this).closest('.pt-wb-subgroup');
      const bucketId = String($subgroup.attr('data-pt-bucket') ?? '');
      const encodedKey = String($subgroup.attr('data-pt-sub') ?? '');
      if (!bucketId || !encodedKey || encodedKey === '__ungrouped__') return;

      let groupName = '';
      try {
        groupName = decodeURIComponent(encodedKey);
      } catch {
        groupName = String($subgroup.find('.pt-wb-subgroup-title').first().text() ?? '').trim();
      }
      if (!groupName) return;

      showGroupActionsDialog({
        title: `分组：${groupName}`,
        onRename: () => {
          showGroupInputDialog({
            title: '重命名分组',
            placeholder: '输入新分组名',
            defaultValue: groupName,
            confirmLabel: '重命名',
            onConfirm: (newName) => {
              const trimmedNew = String(newName ?? '').trim();
              if (!trimmedNew) return;
              const newKey = encodeURIComponent(trimmedNew);

              groupState = renameWorldbookGroupInBucket(groupState, bucketId, groupName, trimmedNew);
              saveWorldbookGroupState(groupState);

              if (expandedGroups.has(encodedKey)) {
                expandedGroups.delete(encodedKey);
                expandedGroups.add(newKey);
              }

              rerenderWorldbookList({ preserveChecked: true });
            },
          });
        },
        onDissolve: () => {
          groupState = dissolveWorldbookGroupInBucket(groupState, bucketId, groupName);
          saveWorldbookGroupState(groupState);

          expandedGroups.delete(encodedKey);

          rerenderWorldbookList({ preserveChecked: true });
        },
      });
    })
    .on('click', '.pt-wb-subgroup-header', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (isSearchActive()) return;
      toggleSubGroup($(this).closest('.pt-wb-subgroup')[0]);
    })
    .on('keydown', '.pt-wb-subgroup-header', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      if (isSearchActive()) return;
      toggleSubGroup($(this).closest('.pt-wb-subgroup')[0]);
    });

  $('#execute-batch-group').on('click', function () {
    const selectedWorldbooks = getSelectedWorldbooks();
    if (!selectedWorldbooks.length) return;

    showGroupInputDialog({
      title: `设置分组（${selectedWorldbooks.length}）`,
      placeholder: '输入分组名称（新建或追加到已有）',
      defaultValue: '',
      confirmLabel: '分组',
      onConfirm: (groupName) => {
        groupState = assignWorldbooksToGroup(groupState, { worldbookNames: selectedWorldbooks, groupName, boundSet });
        saveWorldbookGroupState(groupState);
        rerenderWorldbookList({ preserveChecked: false });
      },
      onUngroup: () => {
        groupState = removeWorldbooksFromAllGroups(groupState, selectedWorldbooks);
        saveWorldbookGroupState(groupState);
        rerenderWorldbookList({ preserveChecked: false });
      },
    });
  });

  $('#execute-batch-delete').on('click', async function () {
    const selectedWorldbooks = getSelectedWorldbooks();
    if (!selectedWorldbooks.length) {
      alert('请选择要删除的世界书');
      return;
    }

    const confirmMessage = `确定要删除以下 ${selectedWorldbooks.length} 个世界书吗？此操作不可撤销！\n\n${selectedWorldbooks.join(
      '\n',
    )}`;
    if (!confirm(confirmMessage)) return;

    const $button = $(this);
    const originalText = $button.text();
    $button.prop('disabled', true).text('删除中...');

    try {
      const { results, errors } = await batchDeleteWorldbooks(selectedWorldbooks);

      if (errors.length > 0) {
        const failCount = results.filter((r) => !r.success).length;
        alert(`删除完成，但有 ${failCount} 个失败:\n${errors.join('\n')}`);
      }

      worldbookNames = await listWorldbooks();
      const refreshedNamesSet = new Set(worldbookNames.map((x) => String(x ?? '').trim()).filter(Boolean));
      groupState = pruneWorldbookGroupState(groupState, refreshedNamesSet);
      saveWorldbookGroupState(groupState);

      const preservedSearch = $('#preset-search').val();
      rerenderWorldbookList({ preserveChecked: false });
      $('#preset-search').val(preservedSearch);
      applyWorldbookSearchFilter();

      const leftSelect = $('#left-preset');
      const rightSelect = $('#right-preset');
      const currentLeft = leftSelect.val();
      const currentRight = rightSelect.val();

      const newOptions = worldbookNames
        .map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`)
        .join('');
      leftSelect.html('<option value="">请选择世界书</option>' + newOptions);
      rightSelect.html('<option value="">请选择世界书</option>' + newOptions);

      if (worldbookNames.includes(currentLeft)) leftSelect.val(currentLeft);
      if (worldbookNames.includes(currentRight)) rightSelect.val(currentRight);

      leftSelect.trigger('change');
      rightSelect.trigger('change');
    } catch (error) {
      console.error('批量删除失败:', error);
      alert('批量删除失败: ' + (error?.message ?? error));
    } finally {
      $button.prop('disabled', false).text(originalText);
    }
  });

  $('#cancel-batch-delete').on('click', closeModal);

  $('#batch-delete-modal').on('click', function (e) {
    if (e.target === this) closeModal();
  });

  $(document).on('keydown.batch-delete', function (e) {
    if (e.key === 'Escape') closeModal();
  });

  bindWorldbookBatchOrderDnd({
    rootEl: $('#batch-delete-modal')[0],
    isSearchActive,
    onBucketOrderChange: ({ bucketId, order }) => {
      if (!bucketId || !Array.isArray(order)) return;
      groupState = normalizeWorldbookGroupState(groupState);
      const bucket = getBucketRef(bucketId);
      if (!bucket) return;
      bucket.order = order.slice();
      saveWorldbookGroupState(groupState);
    },
    onGroupItemOrderChange: ({ bucketId, groupName, itemOrder }) => {
      if (!bucketId || !groupName || !Array.isArray(itemOrder)) return;
      groupState = normalizeWorldbookGroupState(groupState);
      const bucket = getBucketRef(bucketId);
      if (!bucket) return;
      if (!bucket.groups || typeof bucket.groups !== 'object') bucket.groups = {};
      bucket.groups[groupName] = itemOrder.slice();
      saveWorldbookGroupState(groupState);
    },
  });

  rerenderWorldbookList({ preserveChecked: false });
}

export {
  batchDeleteWorldbooks,
  createWorldbookBatchManageModal,
  createWorldbookBatchManageModal as createWorldbookBatchDeleteModal,
};
