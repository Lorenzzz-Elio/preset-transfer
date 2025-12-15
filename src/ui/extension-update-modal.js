import { escapeHtml, getJQuery, getParentWindow } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';
import { UPDATE_EVENT_NAME, getExtensionUpdateState, updateExtensionViaServer } from '../features/extension-update.js';

const UPDATE_BUTTON_ID = 'preset-transfer-extension-update-btn';
const UPDATE_MODAL_ID = 'pt-extension-update-modal';

function getChangelogTextForDisplay(updateState) {
  const text = updateState?.changelog?.text;
  if (typeof text === 'string' && text.trim()) return text.trim();
  return '（未找到 CHANGELOG.md 或无法读取更新日志）';
}

function showExtensionUpdateModal(updateState) {
  const $ = getJQuery();
  const parentWindow = getParentWindow();
  const vars = CommonStyles.getVars();

  $(`#${UPDATE_MODAL_ID}`).remove();

  const localVersion = updateState?.local?.version || '?';
  const latestVersion = updateState?.remote?.version || '?';
  const changelog = escapeHtml(getChangelogTextForDisplay(updateState));

  const html = `
    <div id="${UPDATE_MODAL_ID}" style="
      --pt-font-size: ${vars.fontSize};
      ${CommonStyles.getModalBaseStyles({ maxWidth: '720px' })}
      z-index: 10020;
    ">
      <div style="
        background: ${vars.bgColor};
        border: 1px solid ${vars.borderColor};
        border-radius: ${vars.borderRadius};
        width: min(720px, 95vw);
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
          <div style="font-weight: 700; font-size: calc(var(--pt-font-size) * 1.125);">
            扩展更新
          </div>
          <button id="pt-extension-update-close" type="button" style="
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
          <div style="opacity: 0.9; font-size: calc(var(--pt-font-size) * 0.875); margin-bottom: 10px;">
            当前版本：<b>${escapeHtml(localVersion)}</b>　→　最新版本：<b>${escapeHtml(latestVersion)}</b>
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
          <div style="display:flex; gap: 10px; justify-content: flex-end; margin-top: 14px;">
            <button id="pt-extension-update-cancel" type="button" style="
              border: 1px solid ${vars.borderColor};
              background: ${vars.inputBg};
              color: ${vars.textColor};
              border-radius: 12px;
              padding: 10px 14px;
              cursor: pointer;
              font-weight: 700;
              font-size: calc(var(--pt-font-size) * 0.875);
            ">取消</button>
            <button id="pt-extension-update-confirm" type="button" style="
              border: 1px solid ${vars.borderColor};
              background: var(--pt-accent-color, ${vars.accentColor});
              color: var(--pt-body-color, ${vars.textColor});
              border-radius: 12px;
              padding: 10px 14px;
              cursor: pointer;
              font-weight: 800;
              font-size: calc(var(--pt-font-size) * 0.875);
            ">更新并刷新</button>
          </div>
          <div id="pt-extension-update-error" style="
            margin-top: 10px;
            color: ${vars.tipColor};
            font-size: calc(var(--pt-font-size) * 0.75);
            min-height: 1.2em;
          "></div>
        </div>
      </div>
    </div>
  `;

  $(parentWindow.document.body).append(html);

  function close() {
    $(`#${UPDATE_MODAL_ID}`).remove();
  }

  $(`#${UPDATE_MODAL_ID}`)
    .off('click.ptUpdateOverlay')
    .on('click.ptUpdateOverlay', function (e) {
      if (e.target && e.target.id === UPDATE_MODAL_ID) close();
    });

  $('#pt-extension-update-close, #pt-extension-update-cancel').off('click.ptUpdate').on('click.ptUpdate', close);

  $('#pt-extension-update-confirm')
    .off('click.ptUpdate')
    .on('click.ptUpdate', async function () {
      const btn = $(this);
      btn.prop('disabled', true).text('更新中...');
      $('#pt-extension-update-error').text('');
      try {
        await updateExtensionViaServer();
        parentWindow.location.reload();
      } catch (error) {
        btn.prop('disabled', false).text('更新并刷新');
        const message = error?.message || String(error);
        $('#pt-extension-update-error').text(message);
      }
    });
}

function ensureUpdateButtonStyles() {
  const $ = getJQuery();
  if ($('#preset-transfer-extension-update-style').length) return;
  const style = `
    #preset-transfer-modal .pt-header-mini-actions {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 6px;
    }
    #preset-transfer-modal .pt-extension-update-btn {
      width: 28px;
      height: 28px;
      border-radius: 999px;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--pt-accent-color-muted, rgba(0, 0, 0, 0.22));
      color: var(--pt-body-color);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 2px 8px rgba(0,0,0,0.35);
      transition: filter 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
    }
    #preset-transfer-modal .pt-extension-update-btn svg {
      width: 16px;
      height: 16px;
      stroke: currentColor;
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      opacity: 0.95;
    }
    #preset-transfer-modal .pt-extension-update-btn:hover {
      filter: brightness(1.05);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.45);
    }
    #preset-transfer-modal .pt-extension-update-btn:active {
      transform: translateY(0);
      box-shadow: 0 2px 8px rgba(0,0,0,0.35);
    }
    #preset-transfer-modal .pt-extension-update-btn.has-update {
      background: var(--pt-accent-color, rgba(0, 0, 0, 0.3));
      animation: pt-update-pulse 1.6s ease-in-out infinite;
    }
    @keyframes pt-update-pulse {
      0% { box-shadow: 0 2px 8px rgba(0,0,0,0.35); }
      50% { box-shadow: 0 0 0 2px var(--pt-accent-color, rgba(0,0,0,0.2)), 0 10px 22px rgba(0,0,0,0.35); }
      100% { box-shadow: 0 2px 8px rgba(0,0,0,0.35); }
    }
  `;
  $('head').append(`<style id="preset-transfer-extension-update-style">${style}</style>`);
}

function renderUpdateButton(modal) {
  const $ = getJQuery();
  const updateState = getExtensionUpdateState();

  const wrapper = modal.find('.font-size-wrapper');
  if (!wrapper.length) return;

  wrapper.find(`#${UPDATE_BUTTON_ID}`).remove();

  if (updateState.status !== 'update-available') return;

  ensureUpdateButtonStyles();

  const cloudDownloadSvg = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 17l4 4 4-4"></path>
      <path d="M12 12v9"></path>
      <path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"></path>
    </svg>
  `.trim();

  const btn = $(
    `<button id="${UPDATE_BUTTON_ID}" class="pt-extension-update-btn has-update" type="button" title="发现新版本，点击更新" aria-label="更新扩展">${cloudDownloadSvg}</button>`,
  );
  const actionsRow = wrapper.find('.pt-header-mini-actions');
  if (actionsRow.length) {
    actionsRow.append(btn);
  } else {
    wrapper.append(btn);
  }

  btn.off('click.ptUpdate').on('click.ptUpdate', function (e) {
    e.preventDefault();
    e.stopPropagation();
    showExtensionUpdateModal(updateState);
  });
}

function initExtensionUpdateUI(modal) {
  const $ = getJQuery();

  renderUpdateButton(modal);

  const parentWindow = getParentWindow();
  const handler = () => renderUpdateButton(modal);
  parentWindow.addEventListener(UPDATE_EVENT_NAME, handler);

  modal.on('remove.ptExtensionUpdate', () => {
    parentWindow.removeEventListener(UPDATE_EVENT_NAME, handler);
  });

  $(document).on('keydown.ptExtensionUpdate', e => {
    if (e.key === 'Escape') {
      $(`#${UPDATE_MODAL_ID}`).remove();
    }
  });

  modal.on('remove.ptExtensionUpdateEsc', () => {
    $(document).off('keydown.ptExtensionUpdate');
  });
}

export { initExtensionUpdateUI };
