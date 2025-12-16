import { CommonStyles } from '../styles/common-styles.js';

function applyStyles(isMobile, isSmallScreen, isPortrait) {
  const vars = CommonStyles.getVars();

  const styles = `
        #preset-transfer-modal {
            --pt-font-size: ${vars.fontSize};
            ${CommonStyles.getModalBaseStyles({ maxWidth: '1000px' })}
            align-items: ${vars.isMobile ? 'flex-start' : 'center'};
            ${vars.isMobile ? 'padding-top: 20px;' : ''}
        }
        #preset-transfer-modal .transfer-modal-content {
            background: ${vars.bgColor}; border-radius: ${vars.isMobile ? vars.borderRadius : '20px'};
            padding: ${vars.isSmallScreen ? vars.padding : vars.isMobile ? '20px' : '32px'};
            padding-bottom: calc(${vars.isSmallScreen ? vars.padding : vars.isMobile ? '20px' : '32px'} + env(safe-area-inset-bottom));
            max-width: ${vars.isSmallScreen ? '95vw' : vars.isMobile ? '95vw' : '1000px'};
            width: ${vars.isSmallScreen ? '95vw' : vars.isMobile ? '95vw' : '90%'};
            max-height: ${vars.isMobile ? '90vh' : '85vh'};
            max-height: ${vars.isMobile ? '90dvh' : '85dvh'};
            max-height: ${vars.isMobile ? 'calc(var(--pt-vh, 1vh) * 90)' : 'calc(var(--pt-vh, 1vh) * 85)'};
            color: ${vars.textColor};
            ${vars.isMobile ? '-webkit-overflow-scrolling: touch;' : ''}
        }
        #preset-transfer-modal .modal-header {
            margin-bottom: ${isMobile ? '24px' : '28px'};
            padding-bottom: ${isMobile ? '18px' : '22px'}; border-bottom: 1px solid ${vars.borderColor};
        }
        #preset-transfer-modal .theme-toggle-btn {
            width: ${isMobile ? '32px' : '36px'}; height: ${isMobile ? '32px' : '36px'};
            font-size: ${isMobile ? 'calc(var(--pt-font-size) * 0.875)' : 'var(--pt-font-size)'};
        }
        #preset-transfer-modal .font-size-control {
            position: ${isMobile ? 'static' : 'absolute'};
            ${isMobile ? '' : 'left: 0;'}
            ${isMobile ? '' : 'top: 42px;'}
            gap: ${isMobile ? '8px' : '8px'};
            ${isMobile ? 'background: transparent;' : 'background: rgba(0,0,0, 0.1);'}
            border-radius: ${isMobile ? '0' : '20px'};
            ${isMobile ? 'padding: 0; margin-top: 8px;' : 'padding: 6px 12px;'}
            ${
              isMobile
                ? ''
                : 'backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); box-shadow: 0 2px 8px rgba(0,0,0,0.1);'
            }
            ${isMobile ? 'transform: none; height: auto;' : 'transform: scale(1); height: 32px;'}
            width: ${isMobile ? '100%' : 'auto'};
            justify-content: ${isMobile ? 'center' : 'flex-start'};
        }
        #preset-transfer-modal .font-size-control label {
            font-size: ${isMobile ? 'calc(var(--pt-font-size) * 0.875)' : 'var(--pt-font-size)'};
        }
        #preset-transfer-modal #font-size-display {
            font-size: ${
              isMobile ? 'calc(var(--pt-font-size) * 0.625)' : 'calc(var(--pt-font-size) * 0.75)'
            }; font-weight: 600; color: ${vars.textColor};
            min-width: ${isMobile ? '28px' : '32px'}; text-align: center;
        }
        #preset-transfer-modal .modal-header > div:first-of-type {
            padding: ${isMobile ? '8px 0' : '12px 0'};
        }
        #preset-transfer-modal .modal-header h2 {
            /* Title slightly bigger than body text, but not overwhelming.
               !important is needed to override the global base font-size rule
               applied to all elements inside the modal. */
            font-size: ${
              isSmallScreen
                ? 'calc(var(--pt-font-size) * 1.3125)' // half of 2.625
                : isMobile
                ? 'calc(var(--pt-font-size) * 1.5)' // half of 3.0
                : 'calc(var(--pt-font-size) * 1.6875)' // half of 3.375
            } !important;
            color: ${vars.textColor};
        }
        #preset-transfer-modal .version-info {
            color: ${vars.tipColor};
        }
        #preset-transfer-modal .version-info .author {
            color: ${vars.tipColor};
            /* Keep the version text smaller than the main title */
            font-size: ${
              isSmallScreen
                ? 'calc(var(--pt-font-size) * 0.625)'
                : isMobile
                ? 'calc(var(--pt-font-size) * 0.6875)'
                : 'calc(var(--pt-font-size) * 0.8125)'
            };
        }
        #preset-transfer-modal .preset-selection {
            display: ${isMobile ? 'flex' : 'grid'};
            ${isMobile ? 'flex-direction: column;' : 'grid-template-columns: 1fr 1fr;'}
            gap: ${isMobile ? '18px' : '22px'}; margin-bottom: ${isMobile ? '24px' : '28px'};
        }
        #preset-transfer-modal .preset-field {
            padding: ${isMobile ? '20px' : '24px'}; background: ${vars.sectionBg};
            border: 1px solid ${vars.borderColor};
        }
        #preset-transfer-modal .get-current-btn {
            padding: 0;
            width: ${isMobile ? '42px' : '46px'};
            height: ${isMobile ? '42px' : '46px'};
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 8px;
            flex-shrink: 0;
        }
        #preset-transfer-modal .get-current-btn svg {
            width: 20px;
            height: 20px;
            stroke: currentColor;
        }
        #preset-transfer-modal .preset-field label {
            margin-bottom: 14px; font-size: ${isMobile ? 'var(--pt-font-size)' : 'calc(var(--pt-font-size) * 0.9375)'};
            color: ${vars.textColor};
        }
        #preset-transfer-modal .preset-field label span:first-child span {
            background: ${vars.inputBg}; border: 1px solid ${vars.borderColor};
            color: ${vars.textColor}; font-size: ${vars.fontSizeSmall};
        }
        #preset-transfer-modal .preset-field label span:last-child {
            color: ${vars.tipColor}; font-size: ${
    isMobile ? 'calc(var(--pt-font-size) * 0.8125)' : 'calc(var(--pt-font-size) * 0.75)'
  }; margin-top: 4px;
        }
        #preset-transfer-modal .preset-input-group {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        #preset-transfer-modal select {
            padding: ${isMobile ? '14px 16px' : '12px 14px'};
            background: ${vars.inputBg}; color: ${vars.textColor}; border: 1px solid ${vars.inputBorder};
            font-size: ${isMobile ? 'calc(var(--pt-font-size) * 0.9375)' : 'calc(var(--pt-font-size) * 0.875)'};
        }
        #preset-transfer-modal .action-section {
            gap: 20px; margin-bottom: 25px;
        }
        #preset-transfer-modal #load-entries {
            padding: 14px 26px;
            font-size: calc(var(--pt-font-size) * 0.9375);
            min-width: 150px;
        }
        #preset-transfer-modal .preset-update-slot {
            display: flex;
            justify-content: flex-start;
            align-items: center;
            margin-bottom: 14px;
        }
        #preset-transfer-modal #preset-update-to-right,
        #preset-transfer-modal #preset-update-to-left {
            padding: ${isMobile ? '12px 16px' : '10px 14px'};
            font-size: ${isMobile ? 'calc(var(--pt-font-size) * 0.875)' : 'calc(var(--pt-font-size) * 0.8125)'};
            min-width: auto;
            border-radius: 10px;
            border: 1px solid ${vars.borderColor};
            background: ${vars.inputBg};
            color: ${vars.textColor};
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.15s ease, transform 0.05s ease;
        }
        #preset-transfer-modal #preset-update-to-right:hover,
        #preset-transfer-modal #preset-update-to-left:hover {
            opacity: 0.92;
        }
        #preset-transfer-modal #preset-update-to-right:active,
        #preset-transfer-modal #preset-update-to-left:active {
            transform: translateY(1px);
        }
        #preset-transfer-modal #preset-update-to-right:disabled,
        #preset-transfer-modal #preset-update-to-left:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        #preset-transfer-modal #batch-delete-presets {
            padding: 14px 26px;
            font-size: calc(var(--pt-font-size) * 0.9375);
            min-width: 150px;
        }
        #preset-transfer-modal .auto-switch-label {
            gap: 12px; color: ${vars.textColor};
            font-size: calc(var(--pt-font-size) * 0.875);
        }
        #preset-transfer-modal .auto-switch-label input {
            ${isMobile ? 'transform: scale(1.4);' : 'transform: scale(1.2);'}
        }
        #preset-transfer-modal .entries-header {
            margin-bottom: ${isMobile ? '20px' : '25px'}; padding: ${isMobile ? '18px' : '22px'};
            background: ${vars.sectionBg}; border: 1px solid ${vars.borderColor};
        }
        #preset-transfer-modal .entries-header h4 {
            color: ${vars.textColor}; font-size: ${
    isMobile ? 'calc(var(--pt-font-size) * 1.125)' : 'calc(var(--pt-font-size) * 1.0625)'
  };
        }
        #preset-transfer-modal .entries-header p {
            font-size: ${isMobile ? 'calc(var(--pt-font-size) * 0.875)' : 'calc(var(--pt-font-size) * 0.8125)'};
            color: ${vars.tipColor};
        }
        #preset-transfer-modal #left-entry-search,
        #preset-transfer-modal #left-entry-search-inline,
        #preset-transfer-modal #right-entry-search-inline {
            padding: ${isMobile ? '14px 18px' : '12px 16px'};
            background: ${vars.inputBg}; color: ${vars.textColor}; border: 1px solid ${vars.inputBorder};
            font-size: ${isMobile ? 'calc(var(--pt-font-size) * 0.9375)' : 'calc(var(--pt-font-size) * 0.875)'};
        }
        #preset-transfer-modal .display-option-label {
            color: ${vars.textColor};
            font-size: ${isMobile ? 'calc(var(--pt-font-size) * 0.75)' : 'calc(var(--pt-font-size) * 0.6875)'};
            margin-left: ${isMobile ? '0px' : '6px'};
        }
        #preset-transfer-modal .display-option-label input {
            ${isMobile ? 'transform: scale(1.1);' : 'transform: scale(1.0);'}
        }
        #preset-transfer-modal #entry-search {
            padding: ${isMobile ? '14px 18px' : '12px 16px'};
            background: ${vars.inputBg}; color: ${vars.textColor}; border: 1px solid ${vars.inputBorder};
            font-size: ${isMobile ? 'calc(var(--pt-font-size) * 0.9375)' : 'calc(var(--pt-font-size) * 0.875)'};
        }
        #preset-transfer-modal .search-input-wrapper input[type="text"] {
            padding-right: ${isMobile ? '56px' : '54px'};
        }
        #preset-transfer-modal .pt-search-settings-btn {
            right: ${isMobile ? '12px' : '10px'};
            width: ${isMobile ? '38px' : '34px'};
            height: ${isMobile ? '34px' : '30px'};
        }
        #preset-transfer-modal .pt-search-settings-popover {
            right: ${isMobile ? '12px' : '10px'};
            font-size: ${isMobile ? 'calc(var(--pt-font-size) * 0.8125)' : 'calc(var(--pt-font-size) * 0.75)'};
        }
        #preset-transfer-modal .selection-controls {
            display: ${isMobile ? 'grid' : 'flex'};
            ${isMobile ? 'grid-template-columns: 1fr 1fr; grid-gap: 10px;' : 'flex-wrap: wrap; gap: 10px;'}
        }
        #preset-transfer-modal .selection-btn {
            padding: ${isMobile ? '12px 18px' : '10px 16px'};
            font-size: ${isMobile ? 'calc(var(--pt-font-size) * 0.875)' : 'calc(var(--pt-font-size) * 0.8125)'};
        }
        #preset-transfer-modal .selection-btn .btn-icon {
            font-size: ${isMobile ? 'var(--pt-font-size)' : 'calc(var(--pt-font-size) * 0.875)'};
            width: ${isMobile ? '20px' : '18px'}; height: ${isMobile ? '20px' : '18px'};
        }
        #preset-transfer-modal #select-all { ${isMobile && isPortrait ? '' : 'min-width: 90px;'} }
        #preset-transfer-modal #select-none { ${isMobile && isPortrait ? '' : 'min-width: 90px;'} }
        #preset-transfer-modal #select-new { ${isMobile && isPortrait ? 'grid-column: 1 / -1;' : 'min-width: 100px;'} }
        #preset-transfer-modal #selection-count {
            ${
              isMobile && isPortrait
                ? 'grid-column: 1 / -1; text-align: center; margin-top: 10px;'
                : 'margin-left: auto;'
            }
            color: ${vars.tipColor}; font-size: ${
    isMobile ? 'calc(var(--pt-font-size) * 0.875)' : 'calc(var(--pt-font-size) * 0.8125)'
  };
        }
        #preset-transfer-modal .dual-entries-container {
            display: ${isMobile ? 'flex' : 'grid'};
            ${isMobile ? 'flex-direction: column;' : 'grid-template-columns: 1fr 1fr;'}
            gap: ${isMobile ? '8px' : '20px'}; margin-bottom: ${isMobile ? '20px' : '25px'};
            ${!isMobile ? 'align-items: start;' : ''}
        }
        #preset-transfer-modal .single-entries-container {
            margin-bottom: ${isMobile ? '20px' : '25px'};
        }
        #preset-transfer-modal .single-side {
            border: 1px solid ${vars.borderColor}; background: ${vars.sectionBg};
            padding: ${isMobile ? '16px' : '18px'};
        }
        #preset-transfer-modal .entries-side {
            border: 1px solid ${vars.borderColor}; background: ${vars.sectionBg};
            padding: ${isMobile ? '16px' : '18px'};
        }
        #preset-transfer-modal .side-header {
            margin-bottom: ${isMobile ? '14px' : '16px'}; padding-bottom: ${isMobile ? '12px' : '14px'};
            border-bottom: 1px solid ${vars.borderColor};
        }
        #preset-transfer-modal .side-header h5 {
            margin: 0 0 ${isMobile ? '10px' : '12px'} 0; font-size: ${
    isMobile ? 'var(--pt-font-size)' : 'calc(var(--pt-font-size) * 0.9375)'
  };
            color: ${vars.textColor};
        }
        #preset-transfer-modal .side-controls {
            gap: ${isMobile ? '6px' : '10px'};
            margin-top: ${isMobile ? '6px' : '8px'};
            margin-bottom: ${isMobile ? '12px' : '10px'};
            min-height: ${isMobile ? 'auto' : '140px'};
        }
        #preset-transfer-modal .control-row {
            display: ${isMobile ? 'grid' : 'flex'};
            ${isMobile ? 'grid-template-columns: 1fr 1fr; grid-gap: 6px;' : 'gap: 10px; flex-wrap: wrap;'}
        }
        #preset-transfer-modal .display-options {
            margin-top: ${isMobile ? '8px' : '6px'};
        }
        #preset-transfer-modal .display-mode-select {
            padding: ${isMobile ? '8px 10px' : '6px 8px'};
            background: ${vars.inputBg}; color: ${vars.textColor}; border: 1px solid ${vars.inputBorder};
            font-size: ${isMobile ? 'calc(var(--pt-font-size) * 0.75)' : 'calc(var(--pt-font-size) * 0.6875)'};
        }
        #preset-transfer-modal .selection-count {
            font-size: ${
              isMobile ? 'calc(var(--pt-font-size) * 0.8125)' : 'calc(var(--pt-font-size) * 0.75)'
            }; color: ${vars.tipColor};
        }
        #preset-transfer-modal .entries-list {
            min-height: ${isSmallScreen ? '240px' : isMobile ? '320px' : '300px'};
            max-height: ${isSmallScreen ? '380px' : isMobile ? '480px' : '450px'};
            border: 1px solid ${vars.borderColor};
            background: ${vars.inputBg}; padding: ${isMobile ? '12px' : '12px'};
        }
        #preset-transfer-modal .side-actions {
            margin-top: ${isMobile ? '16px' : '14px'}; gap: ${isMobile ? '12px' : '10px'};
        }
        #preset-transfer-modal .side-actions button {
            padding: ${isMobile ? '10px 14px' : '8px 12px'};
            ${isMobile ? 'min-width: 70px;' : 'min-width: 65px;'}
        }
        #preset-transfer-modal .side-controls .selection-btn {
            padding: ${isMobile ? '6px 8px' : '4px 8px'};
            font-size: calc(var(--pt-font-size) * 0.625);
            ${isMobile ? 'min-width: 50px;' : ''}
        }
        #preset-transfer-modal .jump-btn {
            right: ${isMobile ? '12px' : '8px'};
            width: ${isMobile ? '32px' : '28px'};
            height: ${isMobile ? '32px' : '28px'};
        }
        #preset-transfer-modal .jump-btn .jump-icon {
            font-size: ${isMobile ? 'var(--pt-font-size)' : 'calc(var(--pt-font-size) * 0.875)'};
        }
        #preset-transfer-modal #insert-position-section {
            margin: ${isMobile ? '20px 0' : '25px 0'}; padding: ${isMobile ? '20px' : '24px'};
        }
        #preset-transfer-modal #insert-position-section label {
            font-size: ${isMobile ? 'var(--pt-font-size)' : 'calc(var(--pt-font-size) * 0.9375)'};
        }
        #preset-transfer-modal #insert-position-section p {
            font-size: ${isMobile ? 'calc(var(--pt-font-size) * 0.875)' : 'calc(var(--pt-font-size) * 0.8125)'};
        }
        #preset-transfer-modal .modal-actions {
            gap: ${isMobile ? '10px' : '14px'}; margin-top: ${isMobile ? '20px' : '25px'};
            padding: ${isMobile ? '20px 0' : '24px 0'}; border-top: 1px solid ${vars.borderColor};
        }
        #preset-transfer-modal .modal-actions button {
            padding: ${isMobile ? '14px 20px' : '12px 20px'};
        }
        #preset-transfer-modal #execute-transfer { ${isMobile ? '' : 'min-width: 130px;'} }
        #preset-transfer-modal #execute-delete { ${isMobile ? '' : 'min-width: 130px;'} }
        #preset-transfer-modal #edit-entry { ${isMobile ? '' : 'min-width: 130px;'} }
        #preset-transfer-modal #close-modal { ${isMobile ? '' : 'min-width: 90px;'} }
    `;
  const $style = $('#preset-transfer-styles');
  if ($style.length) {
    $style.text(styles);
  } else {
    $('head').append(`<style id="preset-transfer-styles">${styles}</style>`);
  }

  const cssLink = document.createElement('link');
  cssLink.rel = 'stylesheet';
  cssLink.href = './scripts/extensions/third-party/preset-transfer/src/styles/styles-application.css';
  if (!document.querySelector(`link[href="${cssLink.href}"]`)) {
    document.head.appendChild(cssLink);
  }

  const modal = $('#preset-transfer-modal');
  if (modal.length) {
    modal[0].style.cssText = `
       --pt-accent-color: ${vars.accentColor};
       --pt-accent-color-muted: ${vars.accentMutedColor || vars.accentColor};
       --pt-danger-color: ${vars.accentColor};
       --pt-border-color: ${vars.borderColor};
       --pt-body-color: ${vars.textColor};
       --pt-quote-color: ${vars.tipColor};
       --pt-scrollbar-track-color: ${vars.sectionBg};
       --pt-scrollbar-thumb-color: ${vars.borderColor};
       --pt-scrollbar-thumb-hover-color: ${vars.tipColor};
       --pt-entry-hover-border: ${vars.borderColor};
       --pt-entry-hover-shadow: rgba(0,0,0,0.1);
       --pt-entry-active-shadow: rgba(0,0,0,0.05);
       --pt-input-focus-border: ${vars.inputBorder};
       --pt-input-focus-shadow: rgba(0, 0, 0, 0.18);
   `;
  }

}

export { applyStyles };
