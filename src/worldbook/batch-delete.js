import { debounce, getJQuery } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';

let worldInfoModulePromise = null;

async function getWorldInfoModule() {
  if (!worldInfoModulePromise) {
    worldInfoModulePromise = import('/scripts/world-info.js');
  }
  return await worldInfoModulePromise;
}

async function listWorldbooks() {
  const mod = await getWorldInfoModule();
  if (typeof mod.updateWorldInfoList === 'function') {
    await mod.updateWorldInfoList();
  }
  return Array.isArray(mod.world_names) ? mod.world_names.slice() : [];
}

async function batchDeleteWorldbooks(worldbookNames) {
  const results = [];
  const errors = [];
  const mod = await getWorldInfoModule();

  if (typeof mod.deleteWorldInfo !== 'function') {
    throw new Error('World Info module missing deleteWorldInfo');
  }

  for (const name of worldbookNames) {
    try {
      const success = await mod.deleteWorldInfo(name);
      results.push({ name, success });
      if (!success) {
        errors.push(`世界书 "${name}" 删除失败`);
      }
    } catch (error) {
      errors.push(`世界书 "${name}": ${error.message}`);
      results.push({ name, success: false });
    }
  }

  return { results, errors };
}

async function createWorldbookBatchDeleteModal() {
  const $ = getJQuery();

  $('#batch-delete-modal').remove();
  $('#batch-delete-modal-styles').remove();

  const vars = CommonStyles.getVars();
  const worldbookNames = await listWorldbooks();

  const modalHtml = `
    <div id="batch-delete-modal">
      <div class="batch-delete-modal-content">
        <div class="modal-header">
          <h3>批量删除世界书</h3>
          <p>选择要删除的世界书，此操作不可撤销</p>
        </div>
        <div class="preset-list-container">
          <div class="preset-search">
            <input type="text" id="preset-search" placeholder="搜索世界书...">
          </div>
          <div class="preset-list" id="preset-list">
            ${worldbookNames
              .map(
                name => `
              <label class="preset-item">
                <input type="checkbox" value="${name}">
                <span class="preset-name">${name}</span>
              </label>
            `,
              )
              .join('')}
          </div>
        </div>
        <div class="batch-actions">
          <button id="select-all-presets">全选</button>
          <button id="select-none-presets">全不选</button>
          <span id="selected-count">已选择: 0</span>
        </div>
        <div class="modal-actions">
          <button id="execute-batch-delete" disabled>删除选中世界书</button>
          <button id="cancel-batch-delete">取消</button>
        </div>
      </div>
    </div>
  `;

  $('body').append(modalHtml);

  $('#cancel-batch-delete').text('取消');

  const styles = `
    #batch-delete-modal {
      --pt-font-size: ${vars.fontSize};
      ${CommonStyles.getModalBaseStyles()}
    }
    #batch-delete-modal .batch-delete-modal-content {
      ${CommonStyles.getModalContentStyles()}
    }
    #batch-delete-modal .modal-header {
      text-align: center; margin-bottom: ${vars.margin};
      padding-bottom: ${vars.paddingSmall}; border-bottom: 1px solid ${vars.borderColor};
    }
    #batch-delete-modal .modal-header h3 {
      margin: 0 0 8px 0; font-size: ${vars.fontSizeLarge}; font-weight: 700;
    }
    #batch-delete-modal .modal-header p {
      margin: 0; font-size: ${vars.fontSizeMedium}; color: ${vars.tipColor};
    }
    #batch-delete-modal .preset-search {
      margin-bottom: ${vars.paddingSmall};
    }
    #batch-delete-modal #preset-search {
      width: 100%; padding: ${vars.paddingSmall}; background: ${vars.inputBg};
      color: ${vars.textColor}; border: 1px solid ${vars.inputBorder};
      border-radius: ${vars.borderRadiusSmall}; font-size: ${vars.fontSizeMedium}; box-sizing: border-box;
    }
    #batch-delete-modal .preset-list {
      max-height: 300px; overflow-y: auto; border: 1px solid ${vars.borderColor};
      border-radius: ${vars.borderRadiusSmall}; background: ${vars.inputBg}; padding: 8px;
    }
    #batch-delete-modal .preset-item {
      display: flex; align-items: center; padding: 8px 12px;
      border-radius: 6px; cursor: pointer; transition: background 0.2s ease;
      margin-bottom: 4px;
    }
    #batch-delete-modal .preset-item:hover:not(:has(input:disabled)) {
      background: ${vars.sectionBg};
    }
    #batch-delete-modal .preset-item input {
      margin-right: 12px; transform: scale(1.2);
    }
    #batch-delete-modal .preset-name {
      flex: 1; font-weight: 500;
    }
    #batch-delete-modal .batch-actions {
      display: flex; align-items: center; gap: ${vars.gap}; margin: ${vars.paddingSmall} 0;
      padding: ${vars.paddingSmall}; background: ${vars.sectionBg}; border-radius: ${vars.borderRadiusSmall};
    }
    #batch-delete-modal .batch-actions button {
      padding: ${vars.buttonPaddingSmall};
      background: ${vars.accentMutedColor};
      border: none;
      color: ${vars.textColor};
      border-radius: 6px;
      cursor: pointer;
      font-size: ${vars.fontSizeSmall};
      font-weight: 600;
      transition: background 0.2s ease, opacity 0.2s ease;
    }
    #batch-delete-modal .batch-actions button:hover {
      opacity: 0.9;
    }
    #batch-delete-modal #selected-count {
      margin-left: auto; font-size: ${vars.fontSizeMedium}; font-weight: 600;
      color: ${vars.tipColor};
    }
    #batch-delete-modal .modal-actions {
      display: flex; gap: ${vars.gap}; justify-content: center; margin-top: ${vars.margin};
    }
    #batch-delete-modal .modal-actions button {
      padding: ${vars.buttonPadding};
      border: none;
      border-radius: ${vars.buttonRadius};
      font-size: ${vars.fontSizeMedium};
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      background: ${vars.accentMutedColor};
      color: ${vars.textColor};
    }
    #batch-delete-modal #execute-batch-delete {
      background: ${vars.dangerColor};
    }
    #batch-delete-modal #execute-batch-delete:hover:not(:disabled) {
      opacity: 0.9;
    }
    #batch-delete-modal #execute-batch-delete:disabled {
      background: ${vars.borderColor};
      color: ${vars.tipColor};
      cursor: not-allowed;
    }
    #batch-delete-modal #cancel-batch-delete {
      background: ${vars.accentMutedColor};
      color: ${vars.textColor};
    }
    #batch-delete-modal #cancel-batch-delete:hover {
      opacity: 0.9;
    }
  `;

  $('head').append(`<style id="batch-delete-modal-styles">${styles}</style>`);

  function applyWorldbookSearchFilter() {
    const searchTerm = $('#preset-search').val().toLowerCase();
    $('#preset-list .preset-item').each(function () {
      const name = $(this).find('.preset-name').text().toLowerCase();
      $(this).toggle(name.includes(searchTerm));
    });
  }

  function updateSelectedCount() {
    const selected = $('#preset-list input[type="checkbox"]:checked:not(:disabled)').length;
    $('#selected-count').text(`已选择: ${selected}`);
    $('#execute-batch-delete').prop('disabled', selected === 0);
  }

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

  $('#execute-batch-delete').on('click', async function () {
    const selectedWorldbooks = [];
    $('#preset-list input[type="checkbox"]:checked:not(:disabled)').each(function () {
      selectedWorldbooks.push($(this).val());
    });

    if (selectedWorldbooks.length === 0) {
      alert('请选择要删除的世界书');
      return;
    }

    const confirmMessage = `确定要删除以下 ${
      selectedWorldbooks.length
    } 个世界书吗？此操作不可撤销！\n\n${selectedWorldbooks.join('\n')}`;
    if (!confirm(confirmMessage)) {
      return;
    }

    const $button = $(this);
    const originalText = $button.text();
    $button.prop('disabled', true).text('删除中...');

    try {
      const { results, errors } = await batchDeleteWorldbooks(selectedWorldbooks);

      if (errors.length > 0) {
        const failCount = results.filter(r => !r.success).length;
        alert(`删除完成，但有 ${failCount} 个失败:\n${errors.join('\n')}`);
      }

      const refreshedWorldbookNames = await listWorldbooks();
      const preservedSearch = $('#preset-search').val();

      const newItems = refreshedWorldbookNames
        .map(
          name => `
            <label class="preset-item">
              <input type="checkbox" value="${name}">
              <span class="preset-name">${name}</span>
            </label>
          `,
        )
        .join('');
      $('#preset-list').html(newItems);
      $('#preset-search').val(preservedSearch);
      applyWorldbookSearchFilter();
      updateSelectedCount();

      const leftSelect = $('#left-preset');
      const rightSelect = $('#right-preset');
      const currentLeft = leftSelect.val();
      const currentRight = rightSelect.val();

      const newOptions = refreshedWorldbookNames.map(name => `<option value="${name}">${name}</option>`).join('');
      leftSelect.html('<option value="">请选择世界书</option>' + newOptions);
      rightSelect.html('<option value="">请选择世界书</option>' + newOptions);

      if (refreshedWorldbookNames.includes(currentLeft)) {
        leftSelect.val(currentLeft);
      }
      if (refreshedWorldbookNames.includes(currentRight)) {
        rightSelect.val(currentRight);
      }

      leftSelect.trigger('change');
      rightSelect.trigger('change');
    } catch (error) {
      console.error('批量删除失败:', error);
      alert('批量删除失败: ' + error.message);
    } finally {
      $button.prop('disabled', false).text(originalText);
    }
  });

  $('#cancel-batch-delete').on('click', function () {
    $('#batch-delete-modal').remove();
    $('#batch-delete-modal-styles').remove();
  });

  $('#batch-delete-modal').on('click', function (e) {
    if (e.target === this) {
      $(this).remove();
      $('#batch-delete-modal-styles').remove();
    }
  });

  $(document).on('keydown.batch-delete', function (e) {
    if (e.key === 'Escape') {
      $('#batch-delete-modal').remove();
      $('#batch-delete-modal-styles').remove();
      $(document).off('keydown.batch-delete');
    }
  });

  updateSelectedCount();
}

export { batchDeleteWorldbooks, createWorldbookBatchDeleteModal };

