function getWorldbookBatchManageModalHtml({
  listHtml,
  title = '批量管理世界书',
  description = '勾选世界书后可分组或删除',
  searchPlaceholder = '搜索世界书...',
  groupLabel = '分组',
  deleteLabel = '删除',
  cancelLabel = '取消',
} = {}) {
  return `
    <div id="batch-delete-modal">
      <div class="batch-delete-modal-content">
        <div class="modal-header">
          <h3>${String(title ?? '')}</h3>
          <p>${String(description ?? '')}</p>
        </div>
        <div class="preset-list-container">
          <div class="preset-search">
            <input type="text" id="preset-search" placeholder="${String(searchPlaceholder ?? '')}">
          </div>
          <div class="preset-list" id="preset-list">
            ${listHtml || ''}
          </div>
        </div>
        <div class="batch-actions">
          <button id="select-all-presets">全选</button>
          <button id="select-none-presets">全不选</button>
          <span id="selected-count">已选择: 0</span>
        </div>
        <div class="modal-actions">
          <button id="execute-batch-group" disabled>${String(groupLabel ?? '')}</button>
          <button id="execute-batch-delete" disabled>${String(deleteLabel ?? '')}</button>
          <button id="cancel-batch-delete">${String(cancelLabel ?? '')}</button>
        </div>
      </div>
    </div>
  `;
}

export { getWorldbookBatchManageModalHtml };
