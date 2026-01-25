import { ensureViewportCssVars, escapeHtml, getJQuery } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';

function clearExistingDialogs(dialogId, actionsDialogId) {
  const $ = getJQuery();
  if (dialogId) $(`#${dialogId}`).remove();
  if (actionsDialogId) $(`#${actionsDialogId}`).remove();
}

export function showGroupInputDialog({
  dialogId = 'pt-batch-group-dialog',
  actionsDialogId = 'pt-batch-group-actions-dialog',
  title,
  placeholder,
  defaultValue,
  confirmLabel = '确定',
  onConfirm,
  onUngroup,
} = {}) {
  const $ = getJQuery();
  const vars = CommonStyles.getVars();
  ensureViewportCssVars();

  clearExistingDialogs(dialogId, actionsDialogId);

  const dialog = $(`
    <div id="${dialogId}" style="
      position: fixed; top: 0; left: 0; width: 100vw;
      height: 100vh; height: 100dvh; height: calc(var(--pt-vh, 1vh) * 100);
      background: rgba(0,0,0,0.5); z-index: 10005;
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      padding-top: calc(16px + env(safe-area-inset-top));
      padding-bottom: calc(16px + env(safe-area-inset-bottom));">
      <div style="
        background: ${vars.bgColor}; padding: 20px; border-radius: 12px;
        width: min(520px, 92vw); box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <div style="font-weight: 600; margin-bottom: 12px; white-space: nowrap;">${escapeHtml(String(title ?? ''))}</div>
        <input type="text" class="pt-dialog-input" value="${escapeHtml(String(defaultValue ?? ''))}" placeholder="${escapeHtml(
          String(placeholder ?? ''),
        )}" style="
          width: 100%; padding: 8px; border: 1px solid ${vars.borderColor};
          border-radius: 6px; background: ${vars.inputBg}; color: ${vars.textColor};
          margin-bottom: 12px; box-sizing: border-box;">
        <div style="display: flex; flex-direction: row; gap: 8px; justify-content: flex-end; flex-wrap: wrap;">
          <button class="pt-dialog-cancel menu_button" style="padding: 6px 16px; white-space: nowrap;">取消</button>
          ${onUngroup ? `<button class="pt-dialog-ungroup menu_button" style="padding: 6px 16px; white-space: nowrap;">取消分组</button>` : ''}
          <button class="pt-dialog-confirm menu_button" style="padding: 6px 16px; white-space: nowrap;">${escapeHtml(
            String(confirmLabel),
          )}</button>
        </div>
      </div>
    </div>
  `);

  $('body').append(dialog);

  dialog.on('pointerdown mousedown click', (e) => e.stopPropagation());
  dialog.children().first().on('pointerdown mousedown click', (e) => e.stopPropagation());

  const $input = dialog.find('.pt-dialog-input');
  $input.focus().select();

  const closeDialog = () => dialog.remove();
  const confirmDialog = () => {
    const value = String($input.val() ?? '').trim();
    if (!value) return;
    closeDialog();
    onConfirm?.(value);
  };
  const ungroupDialog = () => {
    closeDialog();
    onUngroup?.();
  };

  dialog.find('.pt-dialog-cancel').on('click', closeDialog);
  dialog.find('.pt-dialog-confirm').on('click', confirmDialog);
  dialog.find('.pt-dialog-ungroup').on('click', ungroupDialog);
  $input.on('keypress', (e) => {
    if (e.key === 'Enter') confirmDialog();
  });
}

export function showGroupActionsDialog({
  dialogId = 'pt-batch-group-dialog',
  actionsDialogId = 'pt-batch-group-actions-dialog',
  title,
  onRename,
  onDissolve,
} = {}) {
  const $ = getJQuery();
  const vars = CommonStyles.getVars();
  ensureViewportCssVars();

  clearExistingDialogs(dialogId, actionsDialogId);

  const dialog = $(`
    <div id="${actionsDialogId}" style="
      position: fixed; top: 0; left: 0; width: 100vw;
      height: 100vh; height: 100dvh; height: calc(var(--pt-vh, 1vh) * 100);
      background: rgba(0,0,0,0.5); z-index: 10005;
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      padding-top: calc(16px + env(safe-area-inset-top));
      padding-bottom: calc(16px + env(safe-area-inset-bottom));">
      <div style="
        background: ${vars.bgColor}; padding: 20px; border-radius: 12px;
        width: min(520px, 92vw); box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <div style="font-weight: 600; margin-bottom: 12px;">${escapeHtml(String(title ?? ''))}</div>
        <div style="display: flex; flex-direction: row; gap: 8px; justify-content: flex-end; flex-wrap: wrap;">
          <button class="pt-actions-cancel menu_button" style="padding: 6px 16px; white-space: nowrap;">取消</button>
          <button class="pt-actions-dissolve menu_button" style="padding: 6px 16px; white-space: nowrap;">取消分组</button>
          <button class="pt-actions-rename menu_button" style="padding: 6px 16px; white-space: nowrap;">重命名</button>
        </div>
      </div>
    </div>
  `);

  $('body').append(dialog);

  const closeDialog = () => dialog.remove();
  dialog.on('click', function (e) {
    if (e.target === this) closeDialog();
  });
  dialog.children().first().on('pointerdown mousedown click', (e) => e.stopPropagation());

  dialog.find('.pt-actions-cancel').on('click', closeDialog);
  dialog.find('.pt-actions-rename').on('click', () => {
    closeDialog();
    onRename?.();
  });
  dialog.find('.pt-actions-dissolve').on('click', () => {
    closeDialog();
    onDissolve?.();
  });
}

export function showTopGroupActionsDialog({
  dialogId = 'pt-batch-group-dialog',
  actionsDialogId = 'pt-batch-group-actions-dialog',
  title,
  groupingEnabled,
  onRename,
  onToggleGrouping,
} = {}) {
  const $ = getJQuery();
  const vars = CommonStyles.getVars();
  ensureViewportCssVars();

  clearExistingDialogs(dialogId, actionsDialogId);

  const toggleLabel = groupingEnabled ? '取消分组' : '显示分组';

  const dialog = $(`
    <div id="${actionsDialogId}" style="
      position: fixed; top: 0; left: 0; width: 100vw;
      height: 100vh; height: 100dvh; height: calc(var(--pt-vh, 1vh) * 100);
      background: rgba(0,0,0,0.5); z-index: 10005;
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      padding-top: calc(16px + env(safe-area-inset-top));
      padding-bottom: calc(16px + env(safe-area-inset-bottom));">
      <div style="
        background: ${vars.bgColor}; padding: 20px; border-radius: 12px;
        width: min(520px, 92vw); box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <div style="font-weight: 600; margin-bottom: 12px;">${escapeHtml(String(title ?? ''))}</div>
        <div style="display: flex; flex-direction: row; gap: 8px; justify-content: flex-end; flex-wrap: wrap;">
          <button class="pt-actions-cancel menu_button" style="padding: 6px 16px; white-space: nowrap;">取消</button>
          <button class="pt-actions-toggle menu_button" style="padding: 6px 16px; white-space: nowrap;">${toggleLabel}</button>
          <button class="pt-actions-rename menu_button" style="padding: 6px 16px; white-space: nowrap;">重命名</button>
        </div>
      </div>
    </div>
  `);

  $('body').append(dialog);

  const closeDialog = () => dialog.remove();
  dialog.on('click', function (e) {
    if (e.target === this) closeDialog();
  });
  dialog.children().first().on('pointerdown mousedown click', (e) => e.stopPropagation());

  dialog.find('.pt-actions-cancel').on('click', closeDialog);
  dialog.find('.pt-actions-rename').on('click', () => {
    closeDialog();
    onRename?.();
  });
  dialog.find('.pt-actions-toggle').on('click', () => {
    closeDialog();
    onToggleGrouping?.();
  });
}
