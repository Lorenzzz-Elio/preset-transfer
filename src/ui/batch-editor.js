import { notify } from '../core/notify.js';
import { ensureViewportCssVars, escapeRegExp, getJQuery } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';
import {
  formatEntriesToTextBlock,
  applyTextBlockToEntries,
} from '../batch/batch-text-format.js';

const BatchEditor = {
  // 批量查找替换（不区分大小写）
  findReplace(entries, findText, replaceText) {
    if (!findText) return entries;
    const regex = new RegExp(escapeRegExp(findText), 'gi');
    return entries.map(entry => {
      const content = String(entry.content ?? '');
      return {
        ...entry,
        content: content.replace(regex, replaceText ?? ''),
      };
    });
  },

  // 批量重命名
  batchRename(entries, pattern) {
    if (!pattern) return entries;
    return entries.map((entry, index) => ({
      ...entry,
      name: pattern
        .replace(/{original}/gi, entry.name ?? '')
        .replace(/{index}/gi, (index + 1).toString()),
    }));
  },

  // 显示批量编辑对话框
  showBatchEditDialog(selectedEntries, onApply) {
    const $ = getJQuery();
    const vars = CommonStyles.getVars();
    ensureViewportCssVars();

    // 移除已存在的对话框
    $('#batch-edit-modal').remove();

    const initialTextBlock = formatEntriesToTextBlock(selectedEntries);

    const modalHtml = `
      <div id="batch-edit-modal" style="--pt-font-size: ${vars.fontSize}; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; height: 100dvh; height: calc(var(--pt-vh, 1vh) * 100); background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px); z-index: 10002; display: flex; align-items: center; justify-content: center; padding: ${vars.margin}; padding-top: calc(${vars.margin} + env(safe-area-inset-top)); padding-bottom: calc(${vars.margin} + env(safe-area-inset-bottom));">
        <div style="background: ${vars.bgColor}; border-radius: ${vars.borderRadius}; padding: ${vars.padding}; max-width: 600px; width: 100%; max-height: ${vars.maxHeight}; max-height: 80dvh; max-height: calc(var(--pt-vh, 1vh) * 80); overflow-y: auto; color: ${vars.textColor}; box-shadow: 0 20px 40px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: ${vars.margin}; padding-bottom: ${vars.paddingSmall}; border-bottom: 1px solid ${vars.borderColor};">
            <h3 style="margin: 0 0 8px 0; font-size: ${vars.fontSizeLarge}; font-weight: 700;">批量编辑条目</h3>
            <p style="margin: 0; font-size: ${vars.fontSizeMedium}; color: ${vars.tipColor};">选中了 ${selectedEntries.length} 个条目</p>
          </div>

          <div style="margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <h4 style="margin: 0; font-size: var(--pt-font-size); font-weight: 600;">内容编辑</h4>
              <span style="font-size: ${vars.fontSizeSmall}; color: ${vars.tipColor};">以 === 条目: 名称 === 分隔</span>
            </div>
            <textarea id="batch-content-block" rows="10" placeholder="条目内容文本块..." style="width: 100%; min-height: 200px; max-height: 45vh; padding: 8px 12px; background: ${vars.inputBg}; color: ${vars.textColor}; border: 1px solid ${vars.inputBorder}; border-radius: 6px; resize: vertical; box-sizing: border-box; font-size: ${vars.fontSizeMedium}; line-height: 1.4; font-family: monospace, inherit;"></textarea>
          </div>

          <div style="margin-bottom: 20px;">
            <h4 style="margin: 0 0 12px 0; font-size: var(--pt-font-size); font-weight: 600;">查找与替换</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: ${vars.fontSizeMedium};">查找文本</label>
                <input type="text" id="batch-find" placeholder="要替换的文本" style="width: 100%; padding: 8px 12px; background: ${vars.inputBg}; color: ${vars.textColor}; border: 1px solid ${vars.inputBorder}; border-radius: 6px; box-sizing: border-box; font-size: ${vars.fontSizeMedium};">
              </div>
              <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: ${vars.fontSizeMedium};">替换为</label>
                <input type="text" id="batch-replace" placeholder="替换后的文本" style="width: 100%; padding: 8px 12px; background: ${vars.inputBg}; color: ${vars.textColor}; border: 1px solid ${vars.inputBorder}; border-radius: 6px; box-sizing: border-box; font-size: ${vars.fontSizeMedium};">
              </div>
            </div>
          </div>

          <div style="margin-bottom: 20px;">
            <h4 style="margin: 0 0 12px 0; font-size: var(--pt-font-size); font-weight: 600;">批量重命名</h4>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: ${vars.fontSizeMedium};">重命名模式</label>
              <input type="text" id="batch-rename-pattern" placeholder="例如: {original}_修改版 或 条目{index}" style="width: 100%; padding: 8px 12px; background: ${vars.inputBg}; color: ${vars.textColor}; border: 1px solid ${vars.inputBorder}; border-radius: 6px; box-sizing: border-box; font-size: ${vars.fontSizeMedium};">
              <div style="margin-top: 4px; font-size: ${vars.fontSizeSmall}; color: ${vars.tipColor};">
                可用变量: {original}=原名称, {index}=序号
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 12px; justify-content: center;">
            <button id="apply-batch-edit" style="padding: calc(var(--pt-font-size) * 0.75) calc(var(--pt-font-size) * 1.5); background: ${vars.sectionBg}; color: ${vars.textColor}; border: 1px solid ${vars.borderColor}; border-radius: 8px; font-size: ${vars.fontSizeMedium}; font-weight: 600; cursor: pointer;">应用</button>
            <button id="cancel-batch-edit" style="padding: calc(var(--pt-font-size) * 0.75) calc(var(--pt-font-size) * 1.5); background: ${vars.sectionBg}; color: ${vars.textColor}; border: 1px solid ${vars.borderColor}; border-radius: 8px; font-size: ${vars.fontSizeMedium}; font-weight: 600; cursor: pointer;">取消</button>
          </div>
        </div>
      </div>
    `;

    $('body').append(modalHtml);

    // 填充长文本初始内容
    $('#batch-content-block').val(initialTextBlock);

    // 绑定事件
    $('#apply-batch-edit').on('click', async () => {
      const textBlock = $('#batch-content-block').val();
      const findText = $('#batch-find').val();
      const replaceText = $('#batch-replace').val();
      const renamePattern = $('#batch-rename-pattern').val().trim();

      const modifications = { textBlock, findText, replaceText, renamePattern };

      const $btn = $('#apply-batch-edit');
      const originalText = $btn.text();
      $btn.prop('disabled', true).text('应用中...');

      try {
        const success = await onApply(modifications);
        if (success !== false) {
          $('#batch-edit-modal').remove();
        }
      } catch (err) {
        console.error('批量修改失败:', err);
        notify.error('批量修改失败: ' + (err?.message ?? err));
      } finally {
        $btn.prop('disabled', false).text(originalText);
      }
    });

    $('#cancel-batch-edit').on('click', () => {
      $('#batch-edit-modal').remove();
    });

    // 点击背景关闭
    $('#batch-edit-modal').on('click', function (e) {
      if (e.target === this) {
        $(this).remove();
      }
    });
  },

  // 应用批量修改
  applyBatchModifications(entries, modifications) {
    let result = [...entries];

    // 1. 应用长文本编辑（applyTextBlockToEntries 内部自行处理空/无效输入）
    if (modifications?.textBlock) {
      result = applyTextBlockToEntries(result, modifications.textBlock);
    }

    // 2. 应用查找替换（不区分大小写）
    if (modifications?.findText && modifications?.replaceText !== undefined) {
      result = this.findReplace(result, modifications.findText, modifications.replaceText);
    }

    // 3. 应用批量重命名
    if (modifications?.renamePattern) {
      result = this.batchRename(result, modifications.renamePattern);
    }

    return result;
  },
};

export {
  BatchEditor
};
