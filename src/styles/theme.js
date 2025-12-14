import { getJQuery, getDeviceInfo, getCurrentApiInfo } from '../core/utils.js';
import { applyStyles } from '../ui/styles-application.js';
import { createEditEntryModal } from '../ui/edit-modal.js';
import { createCompareModal } from '../ui/compare-modal.js';
import { loadAndDisplayEntries } from '../display/entry-display.js';

// Theme helpers for the preset transfer tool.
// The extension now simply follows SillyTavern's theme via CSS variables,
// and does not change the global theme itself. The functions here are kept
// for backward compatibility and for manual "refresh" when the theme changes.

function isDarkTheme() {
  // Best-effort check based on the current background color.
  try {
    const $ = getJQuery();
    const bgColor =
      $('body').css('background-color') || $(':root').css('background-color') || $('html').css('background-color');
    if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)') {
      const rgb = bgColor.match(/\d+/g);
      if (rgb && rgb.length >= 3) {
        const brightness = (parseInt(rgb[0]) * 299 + parseInt(rgb[1]) * 587 + parseInt(rgb[2]) * 114) / 1000;
        return brightness < 128;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

function toggleTransferToolTheme() {
  // Deprecated: the preset transfer extension no longer toggles global themes.
  console.log('PresetTransfer: theme toggle is deprecated and now a no-op.');
}

function updateThemeButton() {
  // Deprecated: theme toggle button has been removed from the UI.
}

function updateModalTheme() {
  const $ = getJQuery();
  const modal = $('#preset-transfer-modal');
  if (!modal.length) return;

  const { isMobile, isSmallScreen, isPortrait } = getDeviceInfo();

  // --- Handle open sub-modals ---
  const compareModal = $('#compare-modal');
  let compareModalData = null;
  if (compareModal.length) {
    compareModalData = compareModal.data();
    compareModal.remove();
  }

  const editModal = $('#edit-entry-modal');
  let editModalData = null;
  if (editModal.length) {
    editModalData = editModal.data();
    editModal.remove();
  }
  // --- End handle sub-modals ---

  // Remove old inline styles
  $('#preset-transfer-styles').remove();
  $('#edit-entry-modal-styles').remove();
  $('#compare-modal-styles').remove();

  // Re-apply modal styles for the current theme
  applyStyles(isMobile, isSmallScreen, isPortrait);

  // --- Recreate sub-modals if they were open ---
  if (editModalData && editModalData.apiInfo) {
    createEditEntryModal(
      editModalData.apiInfo,
      editModalData.presetName,
      editModalData.entry,
      editModalData.insertPosition,
      editModalData.autoEnable,
      editModalData.side,
      null,
      editModalData.displayMode,
    );
  }

  if (compareModalData && compareModalData.apiInfo) {
    createCompareModal(
      compareModalData.apiInfo,
      compareModalData.leftPreset,
      compareModalData.rightPreset,
      compareModalData.commonEntries,
    );
  }
  // --- End recreate sub-modals ---

  // Re-apply font size from slider/localStorage
  const savedSize = localStorage.getItem('preset-transfer-font-size');
  if (savedSize) {
    const fontSize = parseInt(savedSize);
    $('#font-size-slider').val(fontSize);
    const modalEl = $('#preset-transfer-modal')[0];
    if (modalEl) {
      modalEl.style.setProperty('--pt-font-size', fontSize + 'px');
    }
    $('#font-size-display').text(fontSize + 'px');
  }

  // If entries are already loaded, reload them so they fully adopt the new styles.
  if ($('#entries-container').is(':visible')) {
    const apiInfo = getCurrentApiInfo();
    if (apiInfo) {
      loadAndDisplayEntries(apiInfo);
    }
  }
}

function initializeThemeSettings() {
  // No-op: SillyTavern itself manages global theme selection now.
}

export { isDarkTheme, toggleTransferToolTheme, updateThemeButton, updateModalTheme, initializeThemeSettings };

