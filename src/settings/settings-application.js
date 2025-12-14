import { getJQuery } from '../core/utils.js';
function applyStoredSettings() {
  const $ = getJQuery();
  const settings = loadTransferSettings();

  $('#auto-close-modal').prop('checked', settings.autoCloseModal);
  $('#auto-enable-entry').prop('checked', settings.autoEnableEntry);
  $('#left-display-mode').val(settings.leftDisplayMode);
  $('#right-display-mode').val(settings.rightDisplayMode);
  $('#single-display-mode').val(settings.singleDisplayMode);
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
