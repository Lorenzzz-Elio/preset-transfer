import { debounce, ensureViewportCssVars, getCurrentApiInfo, getJQuery } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';
import { bindWorldbookBatchOrderDnd, unbindWorldbookBatchOrderDnd } from '../core/worldbook-order-dnd.js';
import { getWorldbookBatchManageModalHtml } from '../worldbook/batch-modal-template.js';
import { getWorldbookBatchManageModalStyles } from '../worldbook/batch-modal-styles.js';
import {
  assignPresetsToGroup,
  deletePresetListGroupInState,
  loadPresetListGroupState,
  normalizePresetListGroupState,
  prunePresetListGroupState,
  removePresetsFromAllGroups,
  renamePresetListGroupInState,
  savePresetListGroupState,
  setPresetListGroupCollapsed,
  setPresetListGroupOrder,
} from '../features/preset-list-grouping.js';
import { renderPresetGroupedListParts } from './batch-list-render.js';
import { showGroupActionsDialog, showGroupInputDialog } from '../ui/batch-group-dialogs.js';

const GROUP_DIALOG_ID = 'pt-preset-batch-group-dialog';
const GROUP_ACTIONS_DIALOG_ID = 'pt-preset-batch-group-actions-dialog';

async function batchDeletePresets(presetNames) {
  const results = [];
  const errors = [];
  const apiInfo = getCurrentApiInfo();

  for (const presetName of presetNames) {
    try {
      const success = await apiInfo.presetManager.deletePreset(presetName);
      results.push({ name: presetName, success });
      if (!success) {
        errors.push(`预设 "${presetName}" 删除失败`);
      }
    } catch (error) {
      errors.push(`预设 "${presetName}": ${error.message}`);
      results.push({ name: presetName, success: false });
    }
  }

  return { results, errors };
}

async function createPresetBatchManageModal(apiInfo) {
  const $ = getJQuery();
  const currentApiInfo = getCurrentApiInfo();
  const effectiveApiInfo = currentApiInfo || apiInfo;
  if (!effectiveApiInfo) {
    alert('无法获取当前API信息，请确保 SillyTavern 已正确加载');
    return;
  }

  let isClosed = false;

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
      listHtml: '<div class="pt-wb-batch-loading">正在加载预设列表...</div>',
      title: '批量管理预设',
      description: '勾选预设后可分组或删除',
      searchPlaceholder: '搜索预设...',
    }),
  );

  const styles = getWorldbookBatchManageModalStyles(vars);
  $('head').append(`<style id="batch-delete-modal-styles">${styles}</style>`);

  const disabledPresets = new Set(['in_use']);
  let presetNames = [];
  let groupState = normalizePresetListGroupState(loadPresetListGroupState());

  const normalizePresetNames = (names) => {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(names) ? names : []) {
      const trimmed = String(raw ?? '').trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
    return out;
  };

  const isSearchActive = () => Boolean(String($('#preset-search').val() ?? '').trim());

  const applyCollapseState = () => {
    $('#preset-list .pt-wb-subgroup').each(function () {
      const encoded = String($(this).attr('data-pt-sub') ?? '');
      if (!encoded) return;
      let groupName = '';
      try {
        groupName = decodeURIComponent(encoded);
      } catch {
        groupName = encoded;
      }
      if (!groupName) return;
      const collapsed = !!groupState.collapsed?.[groupName];
      $(this).toggleClass('is-collapsed', collapsed);
    });
  };

  const applyPresetSearchFilter = () => {
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
  const rerenderPresetList = ({ preserveChecked = true } = {}) => {
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
    listEl.dataset.ptPresetListRenderToken = token;
    listEl.innerHTML = '';

    const parts = renderPresetGroupedListParts({ presetNames, groupState, disabledPresets });
    if (!parts.length) {
      listEl.innerHTML = '<div class="pt-wb-batch-empty">暂无预设</div>';
      applyCollapseState();
      applyPresetSearchFilter();
      updateSelectedCount();
      return;
    }

    const CHUNK_SIZE = 12;
    let idx = 0;

    const appendChunk = () => {
      if (isClosed) return;
      if (listEl.dataset.ptPresetListRenderToken !== token) return;

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
      applyPresetSearchFilter();
      updateSelectedCount();
    };

    requestAnimationFrame(appendChunk);
  };

  let selectRenderToken = 0;
  const populatePresetSelectOptions = async ($select, names, { placeholder, selectedValue } = {}) => {
    const el = $select?.[0];
    if (!el) return;

    const doc = el.ownerDocument || document;
    const normalized = normalizePresetNames(names);

    el.innerHTML = '';
    const placeholderOpt = doc.createElement('option');
    placeholderOpt.value = '';
    placeholderOpt.textContent = String(placeholder ?? '请选择预设');
    el.appendChild(placeholderOpt);

    if (!normalized.length) {
      el.value = '';
      return;
    }

    const CHUNK_THRESHOLD = 900;
    const CHUNK_SIZE = 300;

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
    el.dataset.ptPresetSelectRenderToken = token;

    let idx = 0;
    await new Promise((resolve) => {
      const appendChunk = () => {
        if (el.dataset.ptPresetSelectRenderToken !== token) return resolve();

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

  const getSelectedPresets = () => {
    const selected = [];
    $('#preset-list input[type="checkbox"]:checked:not(:disabled)').each(function () {
      selected.push(String($(this).val() ?? ''));
    });
    return selected;
  };

  const debouncedSearch = debounce(applyPresetSearchFilter, 300);
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
    const encodedKey = String($group.attr('data-pt-sub') ?? '');
    if (!encodedKey) return;
    let groupName = '';
    try {
      groupName = decodeURIComponent(encodedKey);
    } catch {
      groupName = String($group.find('.pt-wb-subgroup-title').first().text() ?? '').trim();
    }
    if (!groupName) return;

    const nextCollapsed = !$group.hasClass('is-collapsed');
    $group.toggleClass('is-collapsed', nextCollapsed);

    groupState = setPresetListGroupCollapsed(groupState, groupName, nextCollapsed);
    savePresetListGroupState(groupState);
  };

  $('#preset-list')
    .on('click', '.pt-wb-subgroup-menu', function (e) {
      e.preventDefault();
      e.stopPropagation();

      const $subgroup = $(this).closest('.pt-wb-subgroup');
      const encodedKey = String($subgroup.attr('data-pt-sub') ?? '');
      if (!encodedKey) return;

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
            dialogId: GROUP_DIALOG_ID,
            actionsDialogId: GROUP_ACTIONS_DIALOG_ID,
            title: '重命名分组',
            placeholder: '输入新的分组名',
            defaultValue: groupName,
            confirmLabel: '重命名',
            onConfirm: (newName) => {
              const trimmed = String(newName ?? '').trim();
              if (!trimmed) return;
              groupState = renamePresetListGroupInState(groupState, groupName, trimmed);
              savePresetListGroupState(groupState);
              rerenderPresetList({ preserveChecked: true });
            },
          });
        },
        onDissolve: () => {
          groupState = deletePresetListGroupInState(groupState, groupName);
          savePresetListGroupState(groupState);
          rerenderPresetList({ preserveChecked: true });
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
    const selectedPresets = getSelectedPresets();
    if (!selectedPresets.length) return;

    showGroupInputDialog({
      dialogId: GROUP_DIALOG_ID,
      actionsDialogId: GROUP_ACTIONS_DIALOG_ID,
      title: `设置分组（${selectedPresets.length}）`,
      placeholder: '输入分组名称（新建或追加到已有）',
      defaultValue: '',
      confirmLabel: '分组',
      onConfirm: (groupName) => {
        groupState = assignPresetsToGroup(groupState, { presetNames: selectedPresets, groupName });
        savePresetListGroupState(groupState);
        rerenderPresetList({ preserveChecked: false });
      },
      onUngroup: () => {
        groupState = removePresetsFromAllGroups(groupState, selectedPresets);
        savePresetListGroupState(groupState);
        rerenderPresetList({ preserveChecked: false });
      },
    });
  });

  $('#execute-batch-delete').on('click', async function () {
    const selectedPresets = getSelectedPresets();
    if (!selectedPresets.length) {
      alert('请选择要删除的预设');
      return;
    }

    const confirmMessage = `确定要删除以下 ${selectedPresets.length} 个预设吗？此操作不可撤销！\n\n${selectedPresets.join('\n')}`;
    if (!confirm(confirmMessage)) return;

    const $button = $(this);
    const originalText = $button.text();
    $button.prop('disabled', true).text('删除中...');

    try {
      const { results, errors } = await batchDeletePresets(selectedPresets);

      if (errors.length > 0) {
        const failCount = results.filter((r) => !r.success).length;
        alert(`删除完成，但有 ${failCount} 个失败:\n${errors.join('\n')}`);
      }

      const refreshedApiInfo = getCurrentApiInfo();
      if (refreshedApiInfo) {
        presetNames = normalizePresetNames(refreshedApiInfo.presetNames);
        groupState = prunePresetListGroupState(groupState, new Set(presetNames));
        savePresetListGroupState(groupState);

        rerenderPresetList({ preserveChecked: false });

        const leftSelect = $('#left-preset');
        const rightSelect = $('#right-preset');
        const currentLeft = leftSelect.val();
        const currentRight = rightSelect.val();

        await Promise.all([
          populatePresetSelectOptions(leftSelect, presetNames, { placeholder: '请选择预设', selectedValue: currentLeft }),
          populatePresetSelectOptions(rightSelect, presetNames, { placeholder: '请选择预设', selectedValue: currentRight }),
        ]);

        leftSelect.trigger('change');
        rightSelect.trigger('change');
      }
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
    onBucketOrderChange: ({ order }) => {
      if (!Array.isArray(order)) return;
      const normalized = order.map((token) => (token.startsWith('w:') ? `p:${token.slice(2)}` : token));
      groupState = setPresetListGroupOrder(groupState, normalized);
      savePresetListGroupState(groupState);
    },
    onGroupItemOrderChange: ({ groupName, itemOrder }) => {
      if (!groupName || !Array.isArray(itemOrder)) return;
      groupState = normalizePresetListGroupState(groupState);
      if (!groupState.groups || typeof groupState.groups !== 'object') groupState.groups = {};
      groupState.groups[groupName] = itemOrder.slice();
      savePresetListGroupState(groupState);
    },
  });

  try {
    await new Promise((r) => requestAnimationFrame(r));
    if (isClosed) return;

    presetNames = normalizePresetNames(effectiveApiInfo.presetNames);
    groupState = prunePresetListGroupState(groupState, new Set(presetNames));
    savePresetListGroupState(groupState);

    rerenderPresetList({ preserveChecked: false });
  } catch (error) {
    console.error('批量管理预设加载失败:', error);
    closeModal();
    throw error;
  }
}

function bindBatchDeleteEvents() {
  console.warn('PresetTransfer: bindBatchDeleteEvents 已废弃，请使用 createPresetBatchManageModal。');
}

export {
  batchDeletePresets,
  createPresetBatchManageModal,
  createPresetBatchManageModal as createBatchDeleteModal,
  bindBatchDeleteEvents,
};
