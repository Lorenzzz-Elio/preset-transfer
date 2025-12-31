import { escapeAttr, escapeHtml, getJQuery, getParentWindow } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';

const MODAL_ID = 'pt-preset-git-update-modal';

function getChangelogTextForDisplay(changelogText) {
  const text = String(changelogText ?? '').trim();
  return text || '（未能获取变更日志）';
}

function showPresetGitUpdateModal(options = {}) {
  const {
    title = '预设更新',
    presetLabel = '',
    localVersion = '?',
    remoteVersion = '?',
    changelogText = '',
    compareUrl = '',
    compareButtonText = '打开 GitHub 变更',
    confirmText = '更新并迁移',
    cancelText = '取消',
    showConfirm = true,
    showCancel = true,
  } = options;

  const $ = getJQuery();
  const parentWindow = getParentWindow();
  const vars = CommonStyles.getVars();
  const safeCompareUrl = String(compareUrl ?? '').trim();

  $(`#${MODAL_ID}`).remove();

  const changelog = escapeHtml(getChangelogTextForDisplay(changelogText));
  const safeTitle = escapeHtml(title);
  const safePreset = escapeHtml(presetLabel);
  const safeLocal = escapeHtml(String(localVersion));
  const safeRemote = escapeHtml(String(remoteVersion));

  const html = `
    <div id="${MODAL_ID}" style="
      --pt-font-size: ${vars.fontSize};
      ${CommonStyles.getModalBaseStyles({ maxWidth: '760px' })}
      z-index: 10025;
    ">
      <div style="
        background: ${vars.bgColor};
        border: 1px solid ${vars.borderColor};
        border-radius: ${vars.borderRadius};
        width: min(760px, 95vw);
        max-height: calc(var(--pt-vh, 1vh) * 85);
        overflow: hidden;
        box-shadow: 0 20px 50px rgba(0,0,0,0.35);
      ">
        <div style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 16px 18px;
          border-bottom: 1px solid ${vars.borderColor};
          background: ${vars.sectionBg};
          color: ${vars.textColor};
        ">
          <div style="font-weight: 800; font-size: calc(var(--pt-font-size) * 1.125);">
            ${safeTitle}
          </div>
          <button id="pt-preset-git-update-close" type="button" style="
            border: 1px solid ${vars.borderColor};
            background: ${vars.inputBg};
            color: ${vars.textColor};
            border-radius: 10px;
            padding: 6px 10px;
            cursor: pointer;
            font-size: calc(var(--pt-font-size) * 0.8125);
          ">关闭</button>
        </div>
        <div style="padding: 16px 18px; color: ${vars.textColor};">
          <div style="opacity: 0.95; font-size: calc(var(--pt-font-size) * 0.875); margin-bottom: 10px;">
            ${safePreset ? `<div style="margin-bottom: 6px;"><b>${safePreset}</b></div>` : ''}
            当前版本：<b>${safeLocal}</b>　→　最新版本：<b>${safeRemote}</b>
          </div>
          <div style="
            border: 1px solid ${vars.borderColor};
            background: ${vars.subBg};
            border-radius: 12px;
            padding: 12px 12px;
            max-height: calc(var(--pt-vh, 1vh) * 45);
            overflow: auto;
            white-space: pre-wrap;
            line-height: 1.55;
            font-size: calc(var(--pt-font-size) * 0.8125);
            color: ${vars.textColor};
          ">${changelog}</div>
          <div style="display:flex; gap: 10px; justify-content: space-between; align-items: center; margin-top: 14px;">
            <div style="display:flex; gap: 10px; align-items: center;">
              ${
                safeCompareUrl
                  ? `<a href="${escapeAttr(safeCompareUrl)}" target="_blank" rel="noopener noreferrer" style="
                    border: 1px solid ${vars.borderColor};
                    background: ${vars.inputBg};
                    color: ${vars.textColor};
                    border-radius: 12px;
                    padding: 10px 14px;
                    cursor: pointer;
                    font-weight: 700;
                    font-size: calc(var(--pt-font-size) * 0.875);
                    text-decoration: none;
                    display: inline-flex;
                    align-items: center;
                  ">${escapeHtml(compareButtonText)}</a>`
                  : ''
              }
            </div>
            <div style="display:flex; gap: 10px; justify-content: flex-end;">
              ${
                showCancel
                  ? `<button id="pt-preset-git-update-cancel" type="button" style="
                    border: 1px solid ${vars.borderColor};
                    background: ${vars.inputBg};
                    color: ${vars.textColor};
                    border-radius: 12px;
                    padding: 10px 14px;
                    cursor: pointer;
                    font-weight: 700;
                    font-size: calc(var(--pt-font-size) * 0.875);
                  ">${escapeHtml(cancelText)}</button>`
                  : ''
              }
              ${
                showConfirm
                  ? `<button id="pt-preset-git-update-confirm" type="button" style="
                    border: 1px solid ${vars.borderColor};
                    background: var(--pt-accent-color, ${vars.accentColor});
                    color: var(--pt-body-color, ${vars.textColor});
                    border-radius: 12px;
                    padding: 10px 14px;
                    cursor: pointer;
                    font-weight: 800;
                    font-size: calc(var(--pt-font-size) * 0.875);
                  ">${escapeHtml(confirmText)}</button>`
                  : ''
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  $(parentWindow.document.body).append(html);

  return new Promise(resolve => {
    let settled = false;

    function settle(value) {
      if (settled) return;
      settled = true;
      $(`#${MODAL_ID}`).remove();
      resolve(value);
    }

    $(`#${MODAL_ID}`)
      .off('click.ptPresetGitUpdateOverlay')
      .on('click.ptPresetGitUpdateOverlay', function (e) {
        if (e.target && e.target.id === MODAL_ID) settle(false);
      });

    $('#pt-preset-git-update-close, #pt-preset-git-update-cancel')
      .off('click.ptPresetGitUpdate')
      .on('click.ptPresetGitUpdate', () => settle(false));

    $('#pt-preset-git-update-confirm')
      .off('click.ptPresetGitUpdate')
      .on('click.ptPresetGitUpdate', () => settle(true));

    $(document).on('keydown.ptPresetGitUpdate', e => {
      if (e.key === 'Escape') settle(false);
    });

    // Best-effort cleanup if the modal is removed externally.
    $(`#${MODAL_ID}`).on('remove.ptPresetGitUpdate', () => {
      $(document).off('keydown.ptPresetGitUpdate');
      if (!settled) resolve(false);
    });
  });
}

export { showPresetGitUpdateModal };
