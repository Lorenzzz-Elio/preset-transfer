import { CommonStyles } from '../styles/common-styles.js';

function getWorldbookBatchManageModalStyles(vars) {
  return `
    #batch-delete-modal {
      --pt-font-size: ${vars.fontSize};
      ${CommonStyles.getModalBaseStyles()}
    }
    #batch-delete-modal .batch-delete-modal-content {
      ${CommonStyles.getModalContentStyles()}
    }
    #batch-delete-modal .modal-header {
      text-align: center; margin-bottom: ${vars.margin};
      padding-bottom: ${vars.paddingSmall}; border-bottom: 1px solid ${vars.borderColor};
    }
    #batch-delete-modal .modal-header h3 {
      margin: 0 0 8px 0; font-size: ${vars.fontSizeLarge}; font-weight: 700;
    }
    #batch-delete-modal .modal-header p {
      margin: 0; font-size: ${vars.fontSizeMedium}; color: ${vars.tipColor};
    }
    #batch-delete-modal .preset-search {
      margin-bottom: ${vars.paddingSmall};
    }
    #batch-delete-modal #preset-search {
      width: 100%; padding: ${vars.paddingSmall}; background: ${vars.inputBg};
      color: ${vars.textColor}; border: 1px solid ${vars.inputBorder};
      border-radius: ${vars.borderRadiusSmall}; font-size: ${vars.fontSizeMedium}; box-sizing: border-box;
    }
    #batch-delete-modal .preset-list {
      max-height: 300px; overflow-y: auto; border: 1px solid ${vars.borderColor};
      border-radius: ${vars.borderRadiusSmall}; background: ${vars.inputBg}; padding: 8px;
    }
    #batch-delete-modal .preset-item {
      display: flex; align-items: center; padding: 8px 12px;
      border-radius: 6px; cursor: pointer; transition: background 0.2s ease;
      margin-bottom: 4px;
    }
    #batch-delete-modal .preset-item:hover:not(:has(input:disabled)) {
      background: ${vars.sectionBg};
    }
    #batch-delete-modal .preset-item input {
      margin-right: 12px; transform: scale(1.2);
    }
    #batch-delete-modal .preset-item input:disabled {
      opacity: 0.5;
    }
    #batch-delete-modal .preset-name {
      flex: 1; font-weight: 500;
    }
    #batch-delete-modal .current-badge {
      background: #f59e0b; color: white; padding: 2px 8px;
      border-radius: ${vars.borderRadiusMedium}; font-size: ${vars.fontSizeSmall}; font-weight: 600;
    }

    #batch-delete-modal .pt-wb-top-group {
      border: 1px solid ${vars.borderColor};
      border-radius: ${vars.borderRadiusSmall};
      margin-bottom: 10px;
      overflow: hidden;
      background: ${vars.inputBg};
    }
    #batch-delete-modal .pt-wb-top-group-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      background: ${vars.sectionBg};
      border-bottom: 1px solid ${vars.borderColor};
      font-weight: 600;
      user-select: none;
    }
    #batch-delete-modal .pt-wb-top-group-header,
    #batch-delete-modal .pt-wb-subgroup-header {
      cursor: pointer;
    }
    #batch-delete-modal .pt-wb-header-left {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    #batch-delete-modal .pt-wb-header-right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
    }
    #batch-delete-modal .pt-wb-drag-handle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      min-width: 18px;
      height: 18px;
      color: ${vars.tipColor};
      opacity: 0.85;
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
    }
    #batch-delete-modal .pt-wb-drag-handle:hover {
      opacity: 1;
    }
    #batch-delete-modal.pt-dragging {
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
    }
    #batch-delete-modal.pt-dragging * {
      user-select: none;
      -webkit-user-select: none;
    }
    #batch-delete-modal.pt-dragging .pt-wb-drag-handle {
      cursor: grabbing;
    }
    #batch-delete-modal.pt-dragging .preset-item,
    #batch-delete-modal.pt-dragging .pt-wb-subgroup-header {
      cursor: grabbing !important;
    }
    #batch-delete-modal .pt-wb-subgroup-menu.menu_button {
      min-width: 0;
      width: auto;
      padding: 2px 10px;
      line-height: 1.1;
      font-size: ${vars.fontSizeSmall};
    }
    #batch-delete-modal .pt-wb-topgroup-menu.menu_button {
      min-width: 0;
      width: auto;
      padding: 2px 10px;
      line-height: 1.1;
      font-size: ${vars.fontSizeSmall};
    }
    #batch-delete-modal .pt-wb-item {
      gap: 8px;
    }
    #batch-delete-modal .pt-wb-drag-placeholder {
      border: 1px dashed ${vars.borderColor};
      background: ${vars.bgColor};
      border-radius: 6px;
      margin-bottom: 4px;
    }
    #batch-delete-modal .pt-wb-drag-source-hidden {
      display: none !important;
    }
    .pt-wb-drag-ghost {
      opacity: 0.95;
      background: ${vars.sectionBg};
      border: 1px solid ${vars.borderColor};
      border-radius: ${vars.borderRadiusSmall};
      box-shadow: 0 10px 32px rgba(0,0,0,0.35);
    }
    #batch-delete-modal .pt-wb-ungrouped-list {
      border-top: 0;
      margin-top: 0;
      padding-top: 0;
    }
    #batch-delete-modal .pt-wb-caret {
      display: inline-block;
      width: 0;
      height: 0;
      border-top: 5px solid transparent;
      border-bottom: 5px solid transparent;
      border-left: 7px solid ${vars.tipColor};
      transform: rotate(90deg);
      transition: transform 0.15s ease;
    }
    #batch-delete-modal .pt-wb-top-group.is-collapsed .pt-wb-caret,
    #batch-delete-modal .pt-wb-subgroup.is-collapsed .pt-wb-caret {
      transform: rotate(0deg);
    }
    #batch-delete-modal .pt-wb-top-group.is-collapsed > .pt-wb-top-group-body,
    #batch-delete-modal .pt-wb-subgroup.is-collapsed > .pt-wb-subgroup-body {
      display: none;
    }
    #batch-delete-modal .pt-wb-top-group-body {
      padding: 6px;
    }
    #batch-delete-modal .pt-wb-subgroup {
      border: 1px solid ${vars.borderColor};
      border-radius: ${vars.borderRadiusSmall};
      margin-bottom: 8px;
      overflow: hidden;
      background: ${vars.bgColor};
    }
    #batch-delete-modal .pt-wb-subgroup-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      background: ${vars.subBg};
      border-bottom: 1px solid ${vars.borderColor};
      font-weight: 600;
    }
    #batch-delete-modal .pt-wb-ungrouped-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      background: ${vars.subBg};
      border-bottom: 1px solid ${vars.borderColor};
    }
    #batch-delete-modal .pt-wb-ungrouped-title {
      font-weight: 600;
      opacity: 0.9;
    }
    #batch-delete-modal .pt-wb-ungrouped-block {
      border: 1px solid ${vars.borderColor};
      border-radius: ${vars.borderRadiusSmall};
      margin-bottom: 8px;
      overflow: hidden;
      background: ${vars.inputBg};
    }
    #batch-delete-modal .pt-wb-ungrouped-list {
      padding: 6px;
    }
    #batch-delete-modal .pt-wb-subgroup-body {
      padding: 6px;
    }
    #batch-delete-modal .pt-wb-subgroup-body .preset-item {
      margin-bottom: 4px;
    }
    #batch-delete-modal .pt-wb-count {
      color: ${vars.tipColor};
      font-weight: 500;
    }
    #batch-delete-modal .pt-wb-ungrouped {
      background: ${vars.inputBg};
    }

    #batch-delete-modal .batch-actions {
      display: flex; align-items: center; gap: ${vars.gap}; margin: ${vars.paddingSmall} 0;
      padding: ${vars.paddingSmall}; background: ${vars.sectionBg}; border-radius: ${vars.borderRadiusSmall};
    }
    #batch-delete-modal .batch-actions button {
      padding: ${vars.buttonPaddingSmall};
      background: ${vars.accentMutedColor};
      border: none;
      color: ${vars.textColor};
      border-radius: 6px;
      cursor: pointer;
      font-size: ${vars.fontSizeSmall};
      font-weight: 600;
      transition: background 0.2s ease, opacity 0.2s ease;
    }
    #batch-delete-modal .batch-actions button:hover {
      opacity: 0.9;
    }
    #batch-delete-modal #selected-count {
      margin-left: auto; font-size: ${vars.fontSizeMedium}; font-weight: 600;
      color: ${vars.tipColor};
    }
    #batch-delete-modal .modal-actions {
      display: flex; gap: ${vars.gap}; justify-content: center; margin-top: ${vars.margin};
    }
    #batch-delete-modal .modal-actions button {
      padding: ${vars.buttonPadding};
      border: none;
      border-radius: ${vars.buttonRadius};
      font-size: ${vars.fontSizeMedium};
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      background: ${vars.accentMutedColor};
      color: ${vars.textColor};
    }
    #batch-delete-modal #execute-batch-group {
      background: ${vars.accentColor};
    }
    #batch-delete-modal #execute-batch-group:hover:not(:disabled) {
      opacity: 0.9;
    }
    #batch-delete-modal #execute-batch-group:disabled {
      background: ${vars.borderColor};
      color: ${vars.tipColor};
      cursor: not-allowed;
    }
    #batch-delete-modal #execute-batch-delete {
      background: ${vars.dangerColor};
    }
    #batch-delete-modal #execute-batch-delete:hover:not(:disabled) {
      opacity: 0.9;
    }
    #batch-delete-modal #execute-batch-delete:disabled {
      background: ${vars.borderColor};
      color: ${vars.tipColor};
      cursor: not-allowed;
    }
    #batch-delete-modal #cancel-batch-delete {
      background: ${vars.accentMutedColor};
      color: ${vars.textColor};
    }
    #batch-delete-modal #cancel-batch-delete:hover {
      opacity: 0.9;
    }
  `;
}

export { getWorldbookBatchManageModalStyles };
