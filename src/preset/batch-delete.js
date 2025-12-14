import { getCurrentApiInfo, getJQuery, debounce } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';
async function batchDeletePresets(presetNames) {
  const results = [];
  const errors = [];
  const apiInfo = getCurrentApiInfo();

  for (const presetName of presetNames) {
    try {
      // 使用正确的删除方法
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

function createBatchDeleteModal(apiInfo) {
  const $ = getJQuery();
  const currentApiInfo = getCurrentApiInfo();
  const effectiveApiInfo = currentApiInfo || apiInfo;
  if (!effectiveApiInfo) {
    alert('无法获取当前API信息，请确保 SillyTavern 已正确加载');
    return;
  }

  // 移除已存在的模态框
  $('#batch-delete-modal').remove();

  // 使用公共样式管理器 - 简化了很多重复代码喵~
  const vars = CommonStyles.getVars();

  const modalHtml = `
    <div id="batch-delete-modal">
      <div class="batch-delete-modal-content">
        <div class="modal-header">
          <h3>批量删除预设</h3>
          <p>选择要删除的预设，此操作不可撤销！</p>
        </div>
        <div class="preset-list-container">
          <div class="preset-search">
            <input type="text" id="preset-search" placeholder="搜索预设...">
          </div>
          <div class="preset-list" id="preset-list">
            ${effectiveApiInfo.presetNames
              .map(
                name => `
              <label class="preset-item">
                <input type="checkbox" value="${name}" ${name === 'in_use' ? 'disabled' : ''}>
                <span class="preset-name">${name}</span>
                ${name === 'in_use' ? '<span class="current-badge">当前使用</span>' : ''}
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
          <button id="execute-batch-delete" disabled>删除选中预设</button>
          <button id="cancel-batch-delete">❌ 取消</button>
        </div>
      </div>
    </div>
  `;

  $('body').append(modalHtml);

  // Ensure cancel button has no emoji
  $('#cancel-batch-delete').text('取消');

  // 使用公共样式管理器生成样式 - 大幅简化代码喵~
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
    #batch-delete-modal .preset-item input:disabled {
      opacity: 0.5;
    }
    #batch-delete-modal .preset-name {
      flex: 1; font-weight: 500;
    }
    #batch-delete-modal .current-badge {
      background: #f59e0b; color: white; padding: 2px 8px;
      border-radius: ${vars.borderRadiusMedium}; font-size: ${vars.fontSizeSmall}; font-weight: 600;
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

  // 绑定事件
  bindBatchDeleteEvents();
}

function bindBatchDeleteEvents() {
  const $ = getJQuery();

  function applyPresetSearchFilter() {
    const searchTerm = $('#preset-search').val().toLowerCase();
    $('#preset-list .preset-item').each(function () {
      const presetName = $(this).find('.preset-name').text().toLowerCase();
      const matches = presetName.includes(searchTerm);
      $(this).toggle(matches);
    });
  }

  // 更新选中计数
  function updateSelectedCount() {
    const selected = $('#preset-list input[type="checkbox"]:checked:not(:disabled)').length;
    $('#selected-count').text(`已选择: ${selected}`);
    $('#execute-batch-delete').prop('disabled', selected === 0);
  }

  // 搜索功能 (添加防抖优化)
  const debouncedPresetSearch = debounce(applyPresetSearchFilter, 300);

  $('#preset-search').on('input', debouncedPresetSearch);

  // 全选/全不选
  $('#select-all-presets').on('click', function () {
    $('#preset-list input[type="checkbox"]:not(:disabled):visible').prop('checked', true);
    updateSelectedCount();
  });

  $('#select-none-presets').on('click', function () {
    $('#preset-list input[type="checkbox"]:visible').prop('checked', false);
    updateSelectedCount();
  });

  // 复选框变化
  $('#preset-list').on('change', 'input[type="checkbox"]', updateSelectedCount);

  // 执行批量删除
  $('#execute-batch-delete').on('click', async function () {
    const selectedPresets = [];
    $('#preset-list input[type="checkbox"]:checked:not(:disabled)').each(function () {
      selectedPresets.push($(this).val());
    });

    if (selectedPresets.length === 0) {
      alert('请选择要删除的预设');
      return;
    }

    const confirmMessage = `确定要删除以下 ${
      selectedPresets.length
    } 个预设吗？此操作不可撤销！\n\n${selectedPresets.join('\n')}`;
    if (!confirm(confirmMessage)) {
      return;
    }

    const $button = $(this);
    const originalText = $button.text();
    $button.prop('disabled', true).text('删除中...');

    try {
      const { results, errors } = await batchDeletePresets(selectedPresets);

      // 只在有错误时显示提示
      if (errors.length > 0) {
        const failCount = results.filter(r => !r.success).length;
        alert(`删除完成，但有 ${failCount} 个失败:\n${errors.join('\n')}`);
      }

      // 刷新主界面的预设列表
      const refreshedApiInfo = getCurrentApiInfo();
      if (refreshedApiInfo) {
        // 刷新当前批量删除面板的列表（不自动关闭）
        const preservedSearch = $('#preset-search').val();
        const newPresetItems = refreshedApiInfo.presetNames
          .map(
            name => `
              <label class="preset-item">
                <input type="checkbox" value="${name}" ${name === 'in_use' ? 'disabled' : ''}>
                <span class="preset-name">${name}</span>
                ${name === 'in_use' ? '<span class="current-badge">当前使用</span>' : ''}
              </label>
            `,
          )
          .join('');
        $('#preset-list').html(newPresetItems);
        $('#preset-search').val(preservedSearch);
        applyPresetSearchFilter();
        updateSelectedCount();

        // 更新预设下拉框
        const leftSelect = $('#left-preset');
        const rightSelect = $('#right-preset');
        const currentLeft = leftSelect.val();
        const currentRight = rightSelect.val();

        // 重新填充选项
        const newOptions = refreshedApiInfo.presetNames.map(name => `<option value="${name}">${name}</option>`).join('');
        leftSelect.html('<option value="">请选择预设</option>' + newOptions);
        rightSelect.html('<option value="">请选择预设</option>' + newOptions);

        // 恢复选择（如果预设仍然存在）
        if (refreshedApiInfo.presetNames.includes(currentLeft)) {
          leftSelect.val(currentLeft);
        }
        if (refreshedApiInfo.presetNames.includes(currentRight)) {
          rightSelect.val(currentRight);
        }

        leftSelect.trigger('change');
        rightSelect.trigger('change');
      }
    } catch (error) {
      console.error('批量删除失败:', error);
      alert('批量删除失败: ' + error.message);
    } finally {
      $button.prop('disabled', false).text(originalText);
    }
  });

  // 取消按钮
  $('#cancel-batch-delete').on('click', function () {
    $('#batch-delete-modal').remove();
    $('#batch-delete-modal-styles').remove();
  });

  // 点击背景关闭
  $('#batch-delete-modal').on('click', function (e) {
    if (e.target === this) {
      $(this).remove();
      $('#batch-delete-modal-styles').remove();
    }
  });

  // ESC键关闭
  $(document).on('keydown.batch-delete', function (e) {
    if (e.key === 'Escape') {
      $('#batch-delete-modal').remove();
      $('#batch-delete-modal-styles').remove();
      $(document).off('keydown.batch-delete');
    }
  });

  // 初始化计数
  updateSelectedCount();
}

export {
  batchDeletePresets,
  createBatchDeleteModal,
  bindBatchDeleteEvents
};
