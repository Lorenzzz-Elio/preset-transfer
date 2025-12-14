import { ensureViewportCssVars, getJQuery } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';
import { ensureNewVersionFields } from '../preset/new-version-fields.js';

function updateCompareButton() {
  const $ = getJQuery();
  const leftPreset = $('#left-preset').val();
  const rightPreset = $('#right-preset').val();

  const canCompare = leftPreset && rightPreset && leftPreset !== rightPreset;
  $('#compare-entries').prop('disabled', !canCompare);
}

function shouldHighlightPositionDifference(leftPosition, rightPosition) {
  const normalizePosition = pos => pos || 'relative';
  const left = normalizePosition(leftPosition);
  const right = normalizePosition(rightPosition);

  if (left === 'relative' && right === 'relative') {
    return false;
  }

  return left !== right;
}

function showConfirmDialog(message, onConfirm) {
  const $ = getJQuery();
  ensureViewportCssVars();
  $('#confirm-dialog-modal').remove();

  const vars = CommonStyles.getVars();

  const modalHtml = `
    <div id="confirm-dialog-modal" style="--pt-font-size:${vars.fontSize};position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;height:calc(var(--pt-vh, 1vh) * 100);background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);z-index:10010;display:flex;align-items:center;justify-content:center;padding:20px;padding-top:calc(20px + env(safe-area-inset-top));padding-bottom:calc(20px + env(safe-area-inset-bottom));animation:pt-fadeIn .2s ease-out">
        <div style="background:${vars.bgColor};border-radius:16px;padding:24px;max-width:400px;width:90%;color:${vars.textColor};box-shadow:0 10px 30px rgba(0,0,0,0.15);border:1px solid ${vars.borderColor};animation:pt-slideUp .2s ease-out">
            <div style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid ${vars.borderColor}">
                <h4 style="margin:0;font-size:calc(var(--pt-font-size) * 1.125);font-weight:700;color:${vars.textColor};display:flex;align-items:center;gap:8px">确认操作</h4>
            </div>
            <div style="margin:0;font-size:calc(var(--pt-font-size) * 0.9375);line-height:1.6;color:${vars.tipColor}">${message}</div>
            <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:24px">
                <button id="confirm-dialog-ok" style="padding:10px 18px;border-radius:8px;cursor:pointer;font-size:${vars.fontSizeMedium};font-weight:600;transition:all .2s ease;background:${vars.inputBg};color:${vars.textColor};border:1px solid ${vars.inputBorder}">确认</button>
                <button id="confirm-dialog-cancel" style="padding:10px 18px;border-radius:8px;cursor:pointer;font-size:${vars.fontSizeMedium};font-weight:600;transition:all .2s ease;background:${vars.inputBg};color:${vars.textColor};border:1px solid ${vars.inputBorder}">取消</button>
            </div>
        </div>
    </div>`;

  $('body').append(modalHtml);

  $('#confirm-dialog-ok').on('click', function () {
    $(this).prop('disabled', true).text('处理中...');
    onConfirm();
    $('#confirm-dialog-modal').remove();
  });

  $('#confirm-dialog-cancel').on('click', () => $('#confirm-dialog-modal').remove());
}

function isEntryDifferent(leftEntry, rightEntry) {
  const left = ensureNewVersionFields(leftEntry);
  const right = ensureNewVersionFields(rightEntry);

  const normalizePosition = pos => pos || 'relative';
  const leftPos = normalizePosition(left.injection_position);
  const rightPos = normalizePosition(right.injection_position);

  const positionDifferent =
    leftPos === 'relative' && rightPos === 'relative' ? false : leftPos !== rightPos;

  const triggersDifferent =
    JSON.stringify([...(left.injection_trigger || [])].sort()) !==
    JSON.stringify([...(right.injection_trigger || [])].sort());

  return (
    left.content !== right.content ||
    left.role !== right.role ||
    positionDifferent ||
    left.injection_depth !== right.injection_depth ||
    left.forbid_overrides !== right.forbid_overrides ||
    left.injection_order !== right.injection_order ||
    triggersDifferent
  );
}

export {
  updateCompareButton,
  shouldHighlightPositionDifference,
  showConfirmDialog,
  isEntryDifferent
};
