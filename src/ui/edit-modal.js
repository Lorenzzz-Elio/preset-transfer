import { ensureViewportCssVars, getJQuery, getCurrentApiInfo, getDeviceInfo } from '../core/utils.js';
import { getPresetDataFromManager, getOrderedPromptEntries } from '../preset/preset-manager.js';
import { createEntryWithNewFields, ensureNewVersionFields } from '../preset/new-version-fields.js';
import { loadAndDisplayEntries } from '../display/entry-display.js';
import { performInsertNewEntry } from '../operations/core-operations.js';
import { showCompareModal } from './compare-modal.js';
import { showFindReplaceDialog } from '../operations/find-replace.js';
import { CommonStyles } from '../styles/common-styles.js';
import { TRIGGER_TYPES, TRIGGER_TYPE_LABELS } from '../core/constants.js';
import { deleteSelectedEntries, getTargetPromptsList, getOrCreateDummyCharacterPromptOrder } from './edit-modal-operations.js';

function createEditEntryModal(
  apiInfo,
  presetName,
  entry,
  insertPosition = null,
  autoEnable = false,
  side = null,
  entryIndex = null,
  displayMode = 'default',
  fromCompare = false,
) {
  const $ = getJQuery();
  const { isMobile, isSmallScreen, isPortrait } = getDeviceInfo();
  ensureViewportCssVars();

  // 移除已存在的编辑模态框
  $('#edit-entry-modal').remove();

  const isNewEntry = entry.isNewEntry || false;
  const modalTitle = isNewEntry ? '新建条目' : '编辑条目';
  const modalIcon = isNewEntry ? '✨' : '✏️';
  const vars = CommonStyles.getVars();

  // 如果是新建条目，使用默认值；如果是编辑，使用现有值
  const entryData = isNewEntry ? createEntryWithNewFields({ name: '新提示词' }) : ensureNewVersionFields(entry);

  const currentPosition = entryData.injection_position;
  // 使用宽松比较处理 '1' (字符串) 和 1 (数字) 的情况，并处理 null/undefined/空字符串
  const isRelative = currentPosition == 'relative' || currentPosition == null || currentPosition === '';
  const isChat = currentPosition == '1' || currentPosition == 'absolute';

  const positionOptions = [
    { value: 'relative', label: '相对', selected: isRelative },
    { value: '1', label: '聊天中', selected: isChat },
  ];

  const modalHtml = `
        <div id="edit-entry-modal">
            <div class="edit-modal-content">
                <div class="edit-modal-header">
                    <div>
                        <h2>${modalTitle}</h2>
                    </div>
                    <div class="preset-info">预设: ${presetName}</div>
                    <div class="edit-tip" style="margin-top: 8px; font-size: ${
                      isMobile ? 'calc(var(--pt-font-size) * 0.75)' : 'calc(var(--pt-font-size) * 0.6875)'
                    }; color: ${vars.tipColor}; text-align: center; opacity: 0.8;">
                        提示：只能通过点击"取消"按钮关闭此界面，避免误触
                    </div>
                </div>
                <div class="edit-form">
                    <div class="form-field">
                        <label for="edit-entry-name">
                            <span>条目名称</span>
                        </label>
                        <input type="text" id="edit-entry-name" value="${entryData.name}" placeholder="输入条目名称...">
                    </div>
                    <div class="form-field">
                        <label for="edit-entry-role">
                            <span>角色</span>
                        </label>
                        <select id="edit-entry-role">
                            <option value="system" ${entryData.role === 'system' ? 'selected' : ''}>系统</option>
                            <option value="user" ${entryData.role === 'user' ? 'selected' : ''}>用户</option>
                            <option value="assistant" ${
                              entryData.role === 'assistant' ? 'selected' : ''
                            }>AI助手</option>
                        </select>
                    </div>
                    <div class="form-field">
                        <label for="edit-entry-position">
                            <span>注入位置</span>
                        </label>
                        <select id="edit-entry-position">
                            ${positionOptions
                              .map(
                                opt =>
                                  `<option value="${opt.value}" ${opt.selected ? 'selected' : ''}>${
                                    opt.label
                                  }</option>`,
                              )
                              .join('')}
                        </select>
                    </div>
                    <div class="form-field" id="depth-field" style="display: ${isChat ? 'block' : 'none'};">
                        <label for="edit-entry-depth">
                            <span>注入深度</span>
                        </label>
                        <input type="number" id="edit-entry-depth" value="${
                          entryData.injection_depth
                        }" min="0" max="100">
                    </div>
                    <div class="form-field">
                        <label for="edit-entry-content">
                            <span>内容</span>
                        </label>
                        <textarea id="edit-entry-content" rows="8" placeholder="输入条目内容...">${
                          entryData.content
                        }</textarea>
                    </div>
                     <div class="form-field ai-assistant-section">
                        <label>
                            <span>AI 辅助</span>
                        </label>
                        <div class="ai-controls">
                             <select id="ai-style-entry-selector">
                                <option value="">使用当前条目作为参考</option>
                            </select>
                            <textarea id="ai-additional-prompt" placeholder="（可选）输入附加提示词，如“不要修改getvar::”或“将所有年份改为2024”..."></textarea>
                            <div class="ai-buttons-container">
                                <button id="ai-convert-btn" class="ai-btn" disabled>格式转换</button>
                                <button id="ai-create-btn" class="ai-btn" disabled>辅助创作</button>
                            </div>
                        </div>
                    </div>
                    <div class="form-field">
                        <label for="edit-entry-order">
                            <span>注入顺序</span>
                        </label>
                        <input type="number" id="edit-entry-order" value="${entryData.injection_order}">
                    </div>
                    <div class="form-field">
                        <label>
                            <span>触发条件 (不选则为总是触发)</span>
                        </label>
                        <div id="edit-entry-triggers" class="trigger-container">
                            ${TRIGGER_TYPES.map(
                              trigger => `
                                <label class="trigger-label">
                                    <input type="checkbox" class="trigger-checkbox" value="${trigger}" ${
                                entryData.injection_trigger.includes(trigger) ? 'checked' : ''
                              }>
                                    <span>${TRIGGER_TYPE_LABELS[trigger] || trigger}</span>
                                </label>
                            `,
                            ).join('')}
                        </div>
                    </div>
                </div>
                <div class="edit-modal-actions">
                    <button id="save-entry-changes">${isNewEntry ? '创建条目' : '保存'}</button>
                    <button id="find-replace-btn">替换</button>
                    <button id="cancel-edit">❌ 取消</button>
                </div>
            </div>
        </div>
    `;

  $('body').append(modalHtml);
  const editModalEl = $('#edit-entry-modal')[0];
  if (editModalEl) {
    editModalEl.style.setProperty('--pt-font-size', vars.fontSize);
  }

  // Remove decorative icon and emoji from the header/cancel button
  const headerRow = $('#edit-entry-modal .edit-modal-header > div').first();
  headerRow.find('span').first().remove();
  $('#cancel-edit').text('取消');
  $('#edit-entry-modal').data({
    apiInfo,
    presetName,
    entry,
    insertPosition,
    autoEnable,
    side,
    displayMode,
    fromCompare,
  });
  applyEditModalStyles(isMobile, isSmallScreen, isPortrait);
  bindEditModalEvents(apiInfo, presetName, entry, insertPosition, autoEnable, side, displayMode, fromCompare);
}

function applyEditModalStyles(isMobile, isSmallScreen, isPortrait) {
  const $ = getJQuery();
  const vars = CommonStyles.getVars();
  const styles = `
        #edit-entry-modal {
            --pt-font-size: ${vars.fontSize};
            ${CommonStyles.getModalBaseStyles()}
            align-items: ${vars.isMobile ? 'flex-start' : 'center'};
            ${vars.isMobile ? 'padding-top: 20px;' : ''}
        }
        #edit-entry-modal .edit-modal-content {
            background: ${vars.bgColor}; border-radius: ${vars.isMobile ? vars.borderRadius : '20px'};
            padding: ${vars.isSmallScreen ? vars.padding : vars.isMobile ? vars.paddingLarge : '32px'};
            max-width: ${vars.isSmallScreen ? '95vw' : vars.isMobile ? '90vw' : vars.maxWidth};
            width: ${vars.isSmallScreen ? '95vw' : vars.isMobile ? '90vw' : '90%'};
            max-height: ${vars.isMobile ? '90vh' : '85vh'};
            max-height: ${vars.isMobile ? '90dvh' : '85dvh'};
            max-height: ${vars.isMobile ? 'calc(var(--pt-vh, 1vh) * 90)' : 'calc(var(--pt-vh, 1vh) * 85)'};
            overflow-y: auto; color: ${vars.textColor};
            ${vars.isMobile ? '-webkit-overflow-scrolling: touch;' : ''}
        }
        #edit-entry-modal .edit-modal-header {
            margin-bottom: ${vars.isMobile ? vars.padding : vars.paddingLarge};
            padding-bottom: ${vars.isMobile ? '18px' : '22px'}; border-bottom: 1px solid ${vars.borderColor};
        }
        #edit-entry-modal .edit-modal-header > div:first-child {
            gap: ${vars.gap}; padding: ${vars.isMobile ? '8px 0' : '12px 0'};
        }
        #edit-entry-modal .edit-modal-header span {
            font-size: ${vars.isSmallScreen ? '1.75em' : vars.isMobile ? '2em' : '2.25em'};
        }
        #edit-entry-modal .edit-modal-header h2 {
            font-size: ${vars.isSmallScreen ? '1.375em' : vars.isMobile ? '1.5em' : '1.75em'};
            color: ${vars.textColor};
        }
        #edit-entry-modal .preset-info {
            font-size: ${vars.fontSizeMedium};
            color: ${vars.tipColor};
        }
        #edit-entry-modal .edit-form {
            gap: ${vars.isMobile ? vars.margin : '18px'};
        }
        #edit-entry-modal .form-field label {
            font-size: ${vars.isMobile ? vars.fontSize : vars.fontSizeMedium};
            color: ${vars.textColor};
        }
        #edit-entry-modal .form-field input, #edit-entry-modal .form-field select, #edit-entry-modal .form-field textarea {
            padding: ${vars.isMobile ? '14px 16px' : '12px 14px'};
            background: ${vars.inputBg}; color: ${vars.textColor}; border: 1px solid ${vars.inputBorder};
            border-radius: ${vars.borderRadiusSmall}; font-size: ${vars.fontSizeMedium};
        }
        #edit-entry-modal .trigger-container {
            background: ${vars.inputBg};
            border-radius: ${vars.borderRadiusSmall}; border: 1px solid ${vars.inputBorder};
        }
        #edit-entry-modal .ai-assistant-section {
            padding: ${vars.isMobile ? vars.paddingSmall : '15px'};
            margin-top: ${vars.isMobile ? '8px' : '10px'};
            background: ${vars.sectionBg};
            border: 1px solid ${vars.borderColor};
            border-radius: ${vars.borderRadiusSmall};
        }
        #edit-entry-modal .ai-controls {
            gap: ${vars.isMobile ? '8px' : '10px'};
        }
        #edit-entry-modal .ai-buttons-container {
            gap: ${vars.isMobile ? '8px' : '10px'};
            margin-top: ${vars.isMobile ? '8px' : '10px'};
        }
        #edit-entry-modal .ai-btn {
            background-color: ${vars.sectionBg};
            border: 1px solid ${vars.borderColor};
            padding: ${vars.isMobile ? '8px 12px' : '10px 15px'};
            font-size: ${vars.fontSizeMedium};
            min-height: ${vars.isMobile ? '40px' : '44px'};
        }
        #edit-entry-modal #ai-style-entry-selector {
            padding: ${vars.isMobile ? '10px 12px' : '12px 15px'};
            font-size: ${vars.fontSizeMedium};
            border: 1px solid ${vars.borderColor};
            background: ${vars.inputBg};
            color: ${vars.textColor};
        }
        #edit-entry-modal #ai-additional-prompt {
            padding: ${vars.isMobile ? '10px 12px' : '12px 15px'};
            font-size: ${vars.fontSizeMedium};
            border: 1px solid ${vars.borderColor};
            background: ${vars.inputBg};
            color: ${vars.textColor};
            min-height: ${vars.isMobile ? '80px' : '100px'};
        }
        #edit-entry-modal .ai-assistant-section label {
            font-size: ${vars.isMobile ? vars.fontSizeMedium : vars.fontSize};
            margin-bottom: ${vars.isMobile ? '8px' : '10px'};
        }
        #edit-entry-modal .trigger-label {
            background-color: ${vars.sectionBg};
        }
        #edit-entry-modal .trigger-label:hover {
            background-color: ${vars.borderColor};
        }
        #edit-entry-modal .trigger-label span {
            font-size: ${vars.fontSizeMedium};
            color: ${vars.textColor};
        }
        #edit-entry-modal .trigger-label span::before {
            border: 2px solid ${vars.inputBorder};
            background-color: ${vars.inputBg};
        }
        #edit-entry-modal .edit-modal-actions {
            gap: ${isMobile ? '8px' : '16px'};
            margin-top: ${isMobile ? '20px' : '28px'};
            padding-top: ${isMobile ? '16px' : '24px'};
        }
        #edit-entry-modal .edit-modal-actions button {
            padding: ${
              isMobile
                ? 'calc(var(--pt-font-size) * 0.75) calc(var(--pt-font-size) * 1.0)'
                : 'calc(var(--pt-font-size) * 0.75) calc(var(--pt-font-size) * 1.375)'
            };
            min-height: ${isMobile ? 'calc(var(--pt-font-size) * 2.5)' : 'calc(var(--pt-font-size) * 2.25)'};
            flex: ${isMobile ? '1' : '0'};
        }
        #edit-entry-modal #save-entry-changes,
        #edit-entry-modal #cancel-edit,
        #edit-entry-modal #find-replace-btn {
            min-width: ${isMobile ? 'auto' : 'calc(var(--pt-font-size) * 8)'};
        }
    `;

  if (!$('#edit-entry-modal-styles').length) {
    $('head').append(`<style id="edit-entry-modal-styles">${styles}</style>`);
  }

  const cssLink = document.createElement('link');
  cssLink.rel = 'stylesheet';
  cssLink.href = './scripts/extensions/third-party/preset-transfer/src/styles/edit-modal.css';
  if (!document.querySelector(`link[href="${cssLink.href}"]`)) {
    document.head.appendChild(cssLink);
  }
}

function bindEditModalEvents(
  apiInfo,
  presetName,
  originalEntry,
  insertPosition = null,
  autoEnable = false,
  side = null,
  displayMode = 'default',
  fromCompare = false,
) {
  const $ = getJQuery();
  const modal = $('#edit-entry-modal');
  const isNewEntry = originalEntry.isNewEntry || false;

  // 自动加载当前预设的条目
  try {
    const presetData = getPresetDataFromManager(apiInfo, presetName);
    // 使用 getOrderedPromptEntries 获取完整、有序的条目列表
    const entries = getOrderedPromptEntries(presetData, 'include_disabled');
    const $entrySelector = $('#ai-style-entry-selector');
    if (entries.length > 0) {
      entries.forEach(entry => {
        $entrySelector.append(
          $('<option>', {
            value: entry.identifier,
            text: entry.name,
          }),
        );
      });
    }
  } catch (error) {
    console.error('加载参考条目失败:', error);
  }

  // AI辅助按钮始终启用，因为可以使用当前条目作为参考
  $('#ai-convert-btn, #ai-create-btn').prop('disabled', false);

  const handleAIAssist = async task => {
    const entryIdentifier = $('#ai-style-entry-selector').val();
    let referenceEntry;

    if (entryIdentifier) {
      // 使用选择的参考条目
      const presetData = getPresetDataFromManager(apiInfo, presetName);
      referenceEntry = presetData.prompts.find(p => p.identifier === entryIdentifier);

      if (!referenceEntry) {
        alert('找不到指定的参考条目。');
        return;
      }
    } else {
      // 使用当前正在编辑的条目作为参考
      referenceEntry = {
        name: $('#edit-entry-name').val() || '当前条目',
        content: $('#edit-entry-content').val() || '',
        role: $('#edit-entry-role').val() || 'system',
      };

      if (!referenceEntry.content.trim()) {
        alert('当前条目内容为空，请输入内容或选择参考条目。');
        return;
      }
    }

    const sourceEntry = {
      name: $('#edit-entry-name').val(),
      content: $('#edit-entry-content').val(),
    };
    const additionalPrompt = $('#ai-additional-prompt').val();

    try {
      const result = await callAIAssistant(apiInfo, task, sourceEntry, referenceEntry, additionalPrompt);
      $('#edit-entry-name').val(result.name);
      $('#edit-entry-content').val(result.content);
      console.log(`AI ${task === 'convert' ? '格式转换' : '辅助创作'}完成`);
    } catch (error) {
      // 错误已在 callAIAssistant 中提示
    }
  };

  $('#ai-convert-btn').on('click', () => handleAIAssist('convert'));
  $('#ai-create-btn').on('click', () => handleAIAssist('create'));

  // 位置选择变化时显示/隐藏深度字段
  $('#edit-entry-position').on('change', function () {
    const position = $(this).val();
    const depthField = $('#depth-field');
    if (position === 'relative') {
      depthField.hide();
    } else {
      depthField.show();
    }
  });

  $('#save-entry-changes').on('click', async () => {
    try {
      const positionValue = $('#edit-entry-position').val(); // string 'relative' or '1'

      const updatedEntry = {
        ...originalEntry,
        name: $('#edit-entry-name').val().trim(),
        role: $('#edit-entry-role').val(),
        content: $('#edit-entry-content').val(),
        injection_order: parseInt($('#edit-entry-order').val(), 10) || 100,
        injection_trigger: $('#edit-entry-triggers .trigger-checkbox:checked')
          .map(function () {
            return $(this).val();
          })
          .get(),
      };

      if (positionValue === 'relative') {
        updatedEntry.injection_position = null; // Tavern expects null/undefined for relative
        updatedEntry.injection_depth = 4; // Default depth for relative
      } else {
        // For 'in-chat', position should be the number 1
        updatedEntry.injection_position = 1;
        const depthValue = parseInt($('#edit-entry-depth').val(), 10);
        updatedEntry.injection_depth = isNaN(depthValue) ? 4 : depthValue;
      }

      if (!updatedEntry.name) {
        alert('请输入条目名称');
        return;
      }

      const buttonText = isNewEntry ? '创建中...' : '保存中...';
      $('#save-entry-changes').prop('disabled', true).text(buttonText);

      if (isNewEntry) {
        // 新建条目，使用指定的插入位置
        const actualInsertPosition = insertPosition || 'bottom';
        await performInsertNewEntry(apiInfo, presetName, updatedEntry, actualInsertPosition, autoEnable, displayMode);
        // 成功创建，无需弹窗提示

        if ($('#auto-close-modal').prop('checked')) {
          $('#preset-transfer-modal').remove();
        }
      } else {
        // 编辑现有条目
        await saveEntryChanges(apiInfo, presetName, originalEntry, updatedEntry);
        console.log('条目已成功更新');
      }

      modal.remove();

      // 如果来自比较界面，重新显示比较模态框
      if (fromCompare) {
        const compareModal = $('#compare-modal');
        if (compareModal.length) {
          compareModal.show();
          // 重新打开比较模态框以显示更新后的状态
          setTimeout(() => {
            showCompareModal(apiInfo);
          }, 100);
        }
      }

      // 刷新主界面的条目列表
      if ($('#preset-transfer-modal').length) {
        if (side) {
          // 双侧模式
          loadAndDisplayEntries(apiInfo);
        } else {
          // 原有模式（如果还在使用）
          loadAndDisplayEntries(apiInfo);
        }
      }
    } catch (error) {
      console.error(isNewEntry ? '创建条目失败:' : '保存条目失败:', error);
      alert((isNewEntry ? '创建失败: ' : '保存失败: ') + error.message);
      const originalText = isNewEntry ? '创建条目' : '保存';
      $('#save-entry-changes').prop('disabled', false).text(originalText);
    }
  });

  // 查找替换按钮事件
  $('#find-replace-btn').on('click', () => {
    showFindReplaceDialog();
  });

  $('#cancel-edit').on('click', () => {
    modal.remove();

    // 如果来自比较界面，重新显示比较模态框
    if (fromCompare) {
      const compareModal = $('#compare-modal');
      if (compareModal.length) {
        compareModal.show();
      }
    }
  });

  // 添加提示信息，告知用户只能通过取消按钮关闭
  console.log('编辑/新建界面已打开，只能通过点击"取消"按钮关闭，避免误触');

  // 移动端处理
  if (getDeviceInfo().isMobile) {
    const originalOverflow = $('body').css('overflow');
    $('body').css('overflow', 'hidden');
    modal.on('remove', () => $('body').css('overflow', originalOverflow));
  }

  modal.css('display', 'flex');
}

// 显示单个条目的查找替换对话框

export {
  deleteSelectedEntries,
  getTargetPromptsList,
  getOrCreateDummyCharacterPromptOrder,
  createEditEntryModal,
  applyEditModalStyles,
  bindEditModalEvents
};
