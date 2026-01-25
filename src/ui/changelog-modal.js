import { escapeHtml, getJQuery, ensureViewportCssVars } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';
import { generateChangelog } from '../features/changelog-generator.js';

/**
 * 创建文档图标SVG
 */
function changelogIcon() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pt-icon pt-icon-changelog">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="16" y1="13" x2="8" y2="13"></line>
      <line x1="16" y1="17" x2="8" y2="17"></line>
      <polyline points="10 9 9 9 8 9"></polyline>
    </svg>
  `;
}

/**
 * 显示更新日志生成模态框
 */
async function showChangelogModal(leftData, rightData, leftPresetName, rightPresetName) {
  const $ = getJQuery();
  ensureViewportCssVars();

  // 移除已存在的模态框
  $('#changelog-modal').remove();

  const vars = CommonStyles.getVars();

  const modalHtml = `
    <div id="changelog-modal" style="--pt-font-size: ${vars.fontSize};">
      <div class="changelog-modal-content">
        <button class="close-changelog-btn" id="close-changelog-header">×</button>
        <div class="changelog-modal-scroll">
          <div class="changelog-modal-header">
            <h2>生成更新日志</h2>
            <div class="changelog-info">${escapeHtml(leftPresetName)} → ${escapeHtml(rightPresetName)}</div>
          </div>
          <div class="changelog-body">
            <div class="changelog-reference-section">
              <label for="changelog-reference">参考日志（可选）：</label>
              <textarea id="changelog-reference" placeholder="粘贴以往的更新日志作为格式和文风参考..."></textarea>
            </div>
            <div class="changelog-actions">
              <button id="generate-changelog-btn" class="changelog-btn primary">生成更新日志</button>
            </div>
            <div id="changelog-result-section" style="display: none;">
              <div class="changelog-result-header">
                <label>生成的更新日志：</label>
                <button id="copy-changelog-btn" class="changelog-btn secondary">复制</button>
              </div>
              <div id="changelog-result" class="changelog-result"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  $('body').append(modalHtml);
  applyChangelogModalStyles();
  bindChangelogModalEvents(leftData, rightData, leftPresetName, rightPresetName);

  $('#changelog-modal').css('display', 'flex');
}

/**
 * 应用模态框样式
 */
function applyChangelogModalStyles() {
  const $ = getJQuery();
  const vars = CommonStyles.getVars();

  const styles = `
    #changelog-modal {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      height: 100dvh;
      height: calc(var(--pt-vh, 1vh) * 100);
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(8px);
      z-index: 10010;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    #changelog-modal .changelog-modal-content {
      position: relative;
      background: ${vars.bgColor};
      border-radius: 20px;
      padding: 32px;
      max-width: 700px;
      width: 90%;
      color: ${vars.textColor};
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
      border: 1px solid ${vars.borderColor};
    }

    #changelog-modal .changelog-modal-scroll {
      max-height: 85vh;
      max-height: 85dvh;
      max-height: calc(var(--pt-vh, 1vh) * 85);
      overflow-y: auto;
    }

    #changelog-modal .close-changelog-btn {
      position: absolute;
      top: 20px;
      right: 20px;
      background: none;
      border: none;
      font-size: calc(${vars.fontSize} * 1.5);
      color: ${vars.tipColor};
      cursor: pointer;
      padding: 5px;
      line-height: 1;
      transition: color 0.2s;
    }

    #changelog-modal .close-changelog-btn:hover {
      color: ${vars.textColor};
    }

    #changelog-modal .changelog-modal-header {
      margin-bottom: 24px;
      padding-bottom: 20px;
      border-bottom: 1px solid ${vars.borderColor};
    }

    #changelog-modal .changelog-modal-header h2 {
      margin: 0 0 8px 0;
      font-size: 1.5em;
      color: ${vars.textColor};
    }

    #changelog-modal .changelog-info {
      font-size: ${vars.fontSizeMedium};
      color: ${vars.tipColor};
    }

    #changelog-modal .changelog-body {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    #changelog-modal .changelog-reference-section label {
      display: block;
      margin-bottom: 8px;
      font-size: ${vars.fontSizeMedium};
      color: ${vars.textColor};
      font-weight: 500;
    }

    #changelog-modal #changelog-reference {
      width: 100%;
      min-height: 120px;
      padding: 12px;
      border: 1px solid ${vars.inputBorder};
      border-radius: 8px;
      background: ${vars.inputBg};
      color: ${vars.textColor};
      font-size: ${vars.fontSizeSmall};
      font-family: inherit;
      resize: vertical;
      box-sizing: border-box;
    }

    #changelog-modal .changelog-actions {
      display: flex;
      justify-content: center;
    }

    #changelog-modal .changelog-btn {
      padding: 10px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-size: ${vars.fontSizeMedium};
      font-weight: 600;
      transition: all 0.2s ease;
      border: 1px solid ${vars.inputBorder};
    }

    #changelog-modal .changelog-btn.primary {
      background: ${vars.inputBg};
      color: ${vars.textColor};
    }

    #changelog-modal .changelog-btn.primary:hover {
      opacity: 0.8;
    }

    #changelog-modal .changelog-btn.secondary {
      background: ${vars.sectionBg};
      color: ${vars.textColor};
      padding: 6px 12px;
      font-size: ${vars.fontSizeSmall};
    }

    #changelog-modal .changelog-btn.secondary:hover {
      opacity: 0.8;
    }

    #changelog-modal #changelog-result-section {
      margin-top: 20px;
    }

    #changelog-modal .changelog-result-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    #changelog-modal .changelog-result-header label {
      font-size: ${vars.fontSizeMedium};
      color: ${vars.textColor};
      font-weight: 500;
    }

    #changelog-modal .changelog-result {
      background: ${vars.subBg};
      padding: 16px;
      border: 1px solid ${vars.borderColor};
      border-radius: 8px;
      font-size: ${vars.fontSizeSmall};
      color: ${vars.textColor};
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.6;
      max-height: 400px;
      overflow-y: auto;
    }
  `;

  if (!$('#changelog-modal-styles').length) {
    $('head').append(`<style id="changelog-modal-styles">${styles}</style>`);
  }
}

/**
 * 绑定模态框事件
 */
function bindChangelogModalEvents(leftData, rightData, leftPresetName, rightPresetName) {
  const $ = getJQuery();
  const modal = $('#changelog-modal');

  // 关闭按钮
  $('#close-changelog-header').on('click', () => modal.remove());

  // 点击背景关闭
  modal.on('click', e => {
    if (e.target === modal[0]) {
      modal.remove();
    }
  });

  // ESC键关闭
  $(document).on('keydown.changelog-modal', e => {
    if (e.key === 'Escape') {
      modal.remove();
      $(document).off('keydown.changelog-modal');
    }
  });

  // 生成按钮
  $('#generate-changelog-btn').on('click', async function () {
    const $btn = $(this);
    const originalText = $btn.text();

    try {
      $btn.prop('disabled', true).text('生成中...');

      const referenceText = $('#changelog-reference').val().trim();
      const changelog = await generateChangelog(
        leftData,
        rightData,
        leftPresetName,
        rightPresetName,
        referenceText
      );

      $('#changelog-result').text(changelog);
      $('#changelog-result-section').show();

      if (window.toastr) {
        window.toastr.success('更新日志生成成功');
      }
    } catch (error) {
      console.error('生成更新日志失败:', error);
      if (window.toastr) {
        window.toastr.error('生成失败: ' + (error?.message || error));
      }
    } finally {
      $btn.prop('disabled', false).text(originalText);
    }
  });

  // 复制按钮
  $('#copy-changelog-btn').on('click', async function () {
    const $btn = $(this);
    const originalText = $btn.text();
    const changelog = $('#changelog-result').text();

    try {
      await navigator.clipboard.writeText(changelog);
      $btn.text('已复制！');

      if (window.toastr) {
        window.toastr.success('已复制到剪贴板');
      }

      setTimeout(() => {
        $btn.text(originalText);
      }, 2000);
    } catch (error) {
      console.error('复制失败:', error);
      if (window.toastr) {
        window.toastr.error('复制失败，请手动复制');
      }
    }
  });

  // 清理事件
  modal.on('remove', () => {
    $(document).off('keydown.changelog-modal');
  });
}

export { showChangelogModal, changelogIcon };
