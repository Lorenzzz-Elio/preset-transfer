import {
  debounce,
  ensureViewportCssVars,
  getJQuery,
  getSillyTavernContext,
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
import { renderWorldbookGroupedListParts } from './batch-list-render.js';
import { getWorldbookBatchManageModalHtml } from './batch-modal-template.js';
import { getWorldbookBatchManageModalStyles } from './batch-modal-styles.js';
import { showGroupActionsDialog, showGroupInputDialog, showTopGroupActionsDialog } from '../ui/batch-group-dialogs.js';

const GROUP_DIALOG_ID = 'pt-worldbook-batch-group-dialog';
const GROUP_ACTIONS_DIALOG_ID = 'pt-worldbook-batch-group-actions-dialog';

async function createWorldbookBatchManageModal() {
  const $ = getJQuery();
  let isClosed = false;

  const areSetsEqual = (a, b) => {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  };

  const closeModal = () => {
    isClosed = true;
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
  isClosed = false;
  ensureViewportCssVars();

  const vars = CommonStyles.getVars();
  $('body').append(
    getWorldbookBatchManageModalHtml({
      listHtml: '<div class="pt-wb-batch-loading">正在加载世界书列表...</div>',
    }),
  );

  const styles = getWorldbookBatchManageModalStyles(vars);
  $('head').append(`<style id="batch-delete-modal-styles">${styles}</style>`);

  let worldbookNames = [];
  let boundSet = new Set();
  let groupState = normalizeWorldbookGroupState(loadWorldbookGroupState());

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

  let listRenderToken = 0;
  const rerenderWorldbookList = ({ preserveChecked = true } = {}) => {
    const checked = new Set();
    if (preserveChecked) {
      $('#preset-list input[type="checkbox"]:checked').each(function () {
        checked.add(String($(this).val() ?? ''));
      });
    }

    const listEl = $('#preset-list')[0];
    if (!listEl) return;

    listRenderToken += 1;
    const token = String(listRenderToken);
    listEl.dataset.ptWbListRenderToken = token;
    listEl.innerHTML = '';

    const parts = renderWorldbookGroupedListParts({ worldbookNames, boundSet, groupState });
    if (!parts.length) {
      listEl.innerHTML = '<div class="pt-wb-batch-empty">暂无世界书</div>';
      applyCollapseState();
      applyWorldbookSearchFilter();
      updateSelectedCount();
      return;
    }

    const CHUNK_SIZE = 12;
    let idx = 0;

    const appendChunk = () => {
      if (isClosed) return;
      if (listEl.dataset.ptWbListRenderToken !== token) return;

      const end = Math.min(parts.length, idx + CHUNK_SIZE);
      const chunkHtml = parts.slice(idx, end).join('');
      idx = end;
      if (chunkHtml) listEl.insertAdjacentHTML('beforeend', chunkHtml);

      if (idx < parts.length) {
        requestAnimationFrame(appendChunk);
        return;
      }

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

    requestAnimationFrame(appendChunk);
  };

  let selectRenderToken = 0;
  const populateWorldbookSelectOptions = async ($select, names, { placeholder, selectedValue } = {}) => {
    const el = $select?.[0];
    if (!el) return;

    const doc = el.ownerDocument || document;
    const normalized = (Array.isArray(names) ? names : [])
      .map((n) => String(n ?? '').trim())
      .filter(Boolean);

    el.innerHTML = '';
    const placeholderOpt = doc.createElement('option');
    placeholderOpt.value = '';
    placeholderOpt.textContent = String(placeholder ?? '请选择世界书');
    el.appendChild(placeholderOpt);

    if (!normalized.length) {
      el.value = '';
      return;
    }

    const CHUNK_THRESHOLD = 60;
    const CHUNK_SIZE = 40;

    const makeOption = (value, text) => {
      const opt = doc.createElement('option');
      opt.value = value;
      opt.textContent = text;
      return opt;
    };

    const applySelectedValue = () => {
      const selected = String(selectedValue ?? '').trim();
      if (selected && normalized.includes(selected)) el.value = selected;
      else el.value = '';
    };

    if (normalized.length <= CHUNK_THRESHOLD) {
      const frag = doc.createDocumentFragment();
      for (const name of normalized) frag.appendChild(makeOption(name, name));
      el.appendChild(frag);
      applySelectedValue();
      return;
    }

    selectRenderToken += 1;
    const token = String(selectRenderToken);
    el.dataset.ptWbSelectRenderToken = token;

    let idx = 0;
    await new Promise((resolve) => {
      const appendChunk = () => {
        if (el.dataset.ptWbSelectRenderToken !== token) return resolve();

        const frag = doc.createDocumentFragment();
        const end = Math.min(normalized.length, idx + CHUNK_SIZE);
        for (; idx < end; idx += 1) {
          const name = normalized[idx];
          frag.appendChild(makeOption(name, name));
        }
        el.appendChild(frag);

        if (idx < normalized.length) {
          requestAnimationFrame(appendChunk);
          return;
        }

        applySelectedValue();
        resolve();
      };

      requestAnimationFrame(appendChunk);
    });
  };

  const refreshBoundSetInBackground = async () => {
    try {
      const ctx = getSillyTavernContext();
      const characters = Array.isArray(ctx?.characters) ? ctx.characters : [];
      const hasShallow = characters.some((c) => c?.shallow);
      if (!hasShallow) return;
    } catch {
      // ignore
    }

    try {
      const next = await computeCharacterLinkedWorldbooks({ unshallow: true });
      if (isClosed) return;
      if (areSetsEqual(boundSet, next)) return;
      boundSet = next;
      rerenderWorldbookList({ preserveChecked: true });
    } catch {
      // ignore
    }
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
        dialogId: GROUP_DIALOG_ID,
        actionsDialogId: GROUP_ACTIONS_DIALOG_ID,
        title: `分组：${String(currentTitle || '').trim() || topId}`,
        groupingEnabled,
        onRename: () => {
          showGroupInputDialog({
            dialogId: GROUP_DIALOG_ID,
            actionsDialogId: GROUP_ACTIONS_DIALOG_ID,
            dialogId: GROUP_DIALOG_ID,
            actionsDialogId: GROUP_ACTIONS_DIALOG_ID,
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
        dialogId: GROUP_DIALOG_ID,
        actionsDialogId: GROUP_ACTIONS_DIALOG_ID,
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
      dialogId: GROUP_DIALOG_ID,
      actionsDialogId: GROUP_ACTIONS_DIALOG_ID,
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

      rerenderWorldbookList({ preserveChecked: false });

      const leftSelect = $('#left-preset');
      const rightSelect = $('#right-preset');
      const currentLeft = leftSelect.val();
      const currentRight = rightSelect.val();

      await Promise.all([
        populateWorldbookSelectOptions(leftSelect, worldbookNames, { placeholder: '请选择世界书', selectedValue: currentLeft }),
        populateWorldbookSelectOptions(rightSelect, worldbookNames, { placeholder: '请选择世界书', selectedValue: currentRight }),
      ]);

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

  try {
    // Allow the modal to paint before doing heavier work.
    await new Promise((r) => requestAnimationFrame(r));
    if (isClosed) return;

    worldbookNames = await listWorldbooks();
    if (isClosed) return;

    boundSet = await computeCharacterLinkedWorldbooks();
    if (isClosed) return;

    const existingNamesSet = new Set(worldbookNames.map((x) => String(x ?? '').trim()).filter(Boolean));
    groupState = pruneWorldbookGroupState(groupState, existingNamesSet);
    saveWorldbookGroupState(groupState);

    rerenderWorldbookList({ preserveChecked: false });

    // If characters are loaded in shallow mode (lazyLoadCharacters), refresh bindings progressively.
    setTimeout(() => void refreshBoundSetInBackground(), 0);
  } catch (error) {
    console.error('批量管理世界书加载失败:', error);
    closeModal();
    throw error;
  }
}

export {
  batchDeleteWorldbooks,
  createWorldbookBatchManageModal,
  createWorldbookBatchManageModal as createWorldbookBatchDeleteModal,
};
