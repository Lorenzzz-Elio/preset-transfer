import { getJQuery } from '../core/utils.js';
import { getActiveTransferAdapter } from '../transfer/transfer-context.js';

function normalizeWorldbookDisplayMode(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 'default';
  if (raw === 'include_disabled') return 'default';
  if (raw === 'default' || raw === 'wb_constant' || raw === 'wb_keyword') return raw;
  return 'default';
}
function applyStoredSettings() {
  const $ = getJQuery();
  const settings = loadTransferSettings();
  const adapter = (() => {
    try {
      return getActiveTransferAdapter();
    } catch {
      return null;
    }
  })();
  const isWorldbook = adapter?.id === 'worldbook';

  $('#auto-close-modal').prop('checked', settings.autoCloseModal);
  $('#auto-enable-entry').prop('checked', settings.autoEnableEntry);
  $('#left-display-mode').val(isWorldbook ? normalizeWorldbookDisplayMode(settings.leftDisplayMode) : settings.leftDisplayMode);
  $('#right-display-mode').val(isWorldbook ? normalizeWorldbookDisplayMode(settings.rightDisplayMode) : settings.rightDisplayMode);
  $('#single-display-mode').val(isWorldbook ? normalizeWorldbookDisplayMode(settings.singleDisplayMode) : settings.singleDisplayMode);

  if (isWorldbook) {
    const allowed = new Set(['default', 'wb_constant', 'wb_keyword']);
    const ensureValid = (selector) => {
      const current = String($(selector).val() ?? '').trim();
      if (!allowed.has(current)) $(selector).val('default');
    };
    ensureValid('#left-display-mode');
    ensureValid('#right-display-mode');
    ensureValid('#single-display-mode');
  }
}

function saveCurrentSettings() {
  const $ = getJQuery();
  const settings = {
    autoCloseModal: $('#auto-close-modal').prop('checked'),
    autoEnableEntry: $('#auto-enable-entry').prop('checked'),
    leftDisplayMode: $('#left-display-mode').val(),
    rightDisplayMode: $('#right-display-mode').val(),
    singleDisplayMode: $('#single-display-mode').val(),
  };
  saveTransferSettings(settings);
}


export {
  applyStoredSettings,
  saveCurrentSettings
};
