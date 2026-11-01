import { ensureViewportCssVars, getJQuery } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';
import { notify } from '../core/notify.js';
function showFindReplaceDialog() {
  const $ = getJQuery();
  ensureViewportCssVars();
  // 使用公共样式管理器 - 查找替换模态框简化完成喵~
  const vars = CommonStyles.getVars();

  // 移除已存在的对话框
  $('#find-replace-modal').remove();

  const modalHtml = `
    <div id="find-replace-modal" style="--pt-font-size: ${vars.fontSize}; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; height: 100dvh; height: calc(var(--pt-vh, 1vh) * 100); background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px); z-index: 10003; display: flex; align-items: center; justify-content: center; padding: ${vars.margin}; padding-top: calc(${vars.margin} + env(safe-area-inset-top)); padding-bottom: calc(${vars.margin} + env(safe-area-inset-bottom));">
      <div style="background: ${vars.bgColor}; border-radius: ${vars.borderRadius}; padding: ${vars.padding}; max-width: 500px; width: 100%; color: ${vars.textColor}; box-shadow: 0 20px 40px rgba(0,0,0,0.1);">
        <div style="text-align: center; margin-bottom: ${vars.margin}; padding-bottom: ${vars.paddingSmall}; border-bottom: 1px solid ${vars.borderColor};">
          <h3 style="margin: 0 0 8px 0; font-size: ${vars.fontSizeLarge}; font-weight: 700;">🔍 替换</h3>
          <p style="margin: 0; font-size: ${vars.fontSizeMedium}; color: ${vars.tipColor};">在当前条目内容中查找并替换文本</p>
        </div>

        <div style="margin-bottom: ${vars.margin};">
          <div style="margin-bottom: ${vars.paddingSmall};">
            <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: ${vars.fontSizeMedium};">查找文本</label>
            <input type="text" id="single-find" placeholder="要查找的文本" style="width: 100%; padding: ${vars.paddingSmall}; background: ${vars.inputBg}; color: ${vars.textColor}; border: 1px solid ${vars.inputBorder}; border-radius: 6px; box-sizing: border-box; font-size: ${vars.fontSizeMedium};">
          </div>
          <div style="margin-bottom: ${vars.paddingSmall};">
            <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: ${vars.fontSizeMedium};">替换为</label>
            <input type="text" id="single-replace" placeholder="替换后的文本" style="width: 100%; padding: ${vars.paddingSmall}; background: ${vars.inputBg}; color: ${vars.textColor}; border: 1px solid ${vars.inputBorder}; border-radius: 6px; box-sizing: border-box; font-size: ${vars.fontSizeMedium};">
          </div>
          <div style="margin-bottom: ${vars.paddingSmall};">
            <label style="display: flex; align-items: center; gap: 8px; font-size: ${vars.fontSizeMedium}; cursor: pointer;">
              <input type="checkbox" id="case-sensitive">
              区分大小写
            </label>
          </div>
        </div>

        <div style="display: flex; gap: ${vars.gap}; justify-content: center;">
          <button id="apply-find-replace" style="padding: ${vars.buttonPadding}; background: ${vars.accentColor}; color: ${vars.textColor}; border: 1px solid ${vars.borderColor}; border-radius: ${vars.buttonRadius}; font-size: ${vars.fontSizeMedium}; font-weight: 700; cursor: pointer;">✅ 替换</button>
          <button id="cancel-find-replace" style="padding: ${vars.buttonPadding}; background: ${vars.accentMutedColor}; color: ${vars.textColor}; border: 1px solid ${vars.borderColor}; border-radius: ${vars.buttonRadius}; font-size: ${vars.fontSizeMedium}; font-weight: 600; cursor: pointer;">❌ 取消</button>
        </div>
      </div>
    </div>
    `;
  
    $('body').append(modalHtml);
    $('#apply-find-replace').text('替换');
    $('#cancel-find-replace').text('取消');

  // 绑定事件
  $('#apply-find-replace').on('click', () => {
    const findText = $('#single-find').val();
    const replaceText = $('#single-replace').val();
    const caseSensitive = $('#case-sensitive').is(':checked');

    if (!findText) {
      notify.warning('请输入要查找的文本');
      return;
    }

    // 执行查找替换，但不关闭对话框
    applyFindReplaceToCurrentEntry(findText, replaceText, caseSensitive);
    // 不自动关闭对话框，让用户可以继续替换
  });

  $('#cancel-find-replace').on('click', () => {
    $('#find-replace-modal').remove();
  });

  // 点击背景关闭
  $('#find-replace-modal').on('click', function (e) {
    if (e.target === this) {
      $(this).remove();
    }
  });

  // 自动聚焦到查找输入框
  setTimeout(() => {
    $('#single-find').focus();
  }, 100);
}

// 对当前编辑的条目应用查找替换
function applyFindReplaceToCurrentEntry(findText, replaceText, caseSensitive) {
  const $ = getJQuery();
  const contentTextarea = $('#edit-entry-content');

  if (!contentTextarea.length) {
    notify.warning('未找到内容编辑区域');
    return;
  }

  let content = contentTextarea.val();
  let replacedCount = 0;

  if (caseSensitive) {
    // 区分大小写的替换
    const regex = new RegExp(escapeRegExp(findText), 'g');
    content = content.replace(regex, match => {
      replacedCount++;
      return replaceText;
    });
  } else {
    // 不区分大小写的替换
    const regex = new RegExp(escapeRegExp(findText), 'gi');
    content = content.replace(regex, match => {
      replacedCount++;
      return replaceText;
    });
  }

  // 更新文本区域的内容
  contentTextarea.val(content);

  // 显示替换结果
  if (replacedCount > 0) {
    notify.success(`成功替换 ${replacedCount} 处文本`);
  } else {
    notify.info('未找到要替换的文本');
  }
}

// 转义正则表达式特殊字符
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


export {
  showFindReplaceDialog,
  applyFindReplaceToCurrentEntry,
  escapeRegExp
};
