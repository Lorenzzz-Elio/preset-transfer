import { debounce, getCurrentApiInfo, getDeviceInfo, getJQuery } from '../core/utils.js';
import { commitWorldbookPickTarget, loadAndDisplayEntries } from '../display/entry-display.js';
import { cancelGlobalSearch, closeAllPanels as closeAllGlobalSearchPanels, runGlobalSearch } from '../display/global-search.js';
import { filterDualEntries, filterSideEntries, toggleNewEntries } from '../display/search-filter.js';
import { updateSelectionCount } from '../display/ui-updates.js';
import { simpleCopyEntries, startMoveMode } from '../operations/copy-move.js';
import { createNewWorldbookEntry, editSelectedEntry, startTransferMode } from '../operations/entry-operations.js';
import { createBatchDeleteModal } from '../preset/batch-delete.js';
import { setCurrentPreset } from '../preset/preset-manager.js';
import { applyStoredSettings, saveCurrentSettings } from '../settings/settings-application.js';
import { getActiveTransferAdapter } from '../transfer/transfer-context.js';
import { showCompareModal } from '../ui/compare-modal.js';
import { deleteSelectedEntries } from '../ui/edit-modal.js';
import { initExtensionUpdateUI } from '../ui/extension-update-modal.js';
import { updatePresetRegexStatus } from '../ui/regex-ui.js';
import { createWorldbookBatchManageModal } from '../worldbook/batch-delete.js';
import { loadSearchSettings, updateSearchSettings } from '../settings/search-settings.js';
import { initDragDrop } from './drag-drop-events.js';
function bindTransferEvents(apiInfo, modal) {
  const $ = getJQuery();
  const leftSelect = $('#left-preset');
  const rightSelect = $('#right-preset');
  const loadBtn = $('#load-entries');
  ensureFontSizeStyles();
  initFontSizeUI();

  // Ensure font size UI styles are injected once so they override the older inline styles.
  function ensureFontSizeStyles() {
    if ($('#preset-transfer-font-size-style').length) {
      return;
    }
    const styleContent = `
      #preset-transfer-modal .modal-header {
        position: relative;
      }
      #preset-transfer-modal .font-size-wrapper {
        position: absolute;
        left: 10px;
        top: 10px;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
        z-index: 10;
      }
      #preset-transfer-modal .font-size-toggle {
        width: 28px;
        height: 28px;
        border-radius: 999px;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.22);
        color: var(--pt-body-color);
        font-weight: 600;
        font-size: calc(var(--pt-font-size) * 0.75);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
      }
      #preset-transfer-modal .font-size-toggle:hover {
        background: rgba(0, 0, 0, 0.3);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      }
      #preset-transfer-modal .font-size-toggle:active {
        transform: translateY(0);
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      }
      #preset-transfer-modal .font-size-control {
        position: static;
        left: auto;
        top: auto;
        transform: none;
        width: auto;
        height: auto;
        display: none;
        align-items: center;
        justify-content: flex-start;
        gap: 8px;
        padding: 8px 10px;
        background: var(--SmartThemeBlurTintColor, #111827);
        border-radius: 10px;
        border: 1px solid var(--pt-border-color);
        box-shadow: 0 8px 20px rgba(0,0,0,0.5);
      }
      #preset-transfer-modal .font-size-control.open {
        display: flex;
      }
      #preset-transfer-modal .font-size-control label {
        cursor: pointer;
        margin: 0;
        font-size: calc(var(--pt-font-size) * 0.75);
      }
      #preset-transfer-modal #font-size-display {
        font-size: calc(var(--pt-font-size) * 0.75);
        font-weight: 600;
        min-width: 36px;
        text-align: center;
      }
    `;
    $('head').append(`<style id="preset-transfer-font-size-style">${styleContent}</style>`);
  }

  // Turn the existing font-size slider block into a small button + popover.
  function initFontSizeUI() {
    const header = $('#preset-transfer-modal .modal-header');
    const control = header.find('.font-size-control');

    if (!header.length || !control.length) {
      return;
    }

    // Wrap the existing control so we can absolutely position the whole block.
    if (!header.find('.font-size-wrapper').length) {
      control.wrap('<div class="font-size-wrapper"></div>');
    }
    const wrapper = header.find('.font-size-wrapper');
    let actionsRow = wrapper.find('.pt-header-mini-actions');
    if (!actionsRow.length) {
      actionsRow = $('<div class="pt-header-mini-actions"></div>');
      wrapper.prepend(actionsRow);
    }

    let toggle = $('#font-size-toggle');
    if (!toggle.length) {
      toggle = $(
        '<button id="font-size-toggle" class="font-size-toggle" type="button" title="调节字体大小">Aa</button>',
      );
      actionsRow.append(toggle);
    } else if (!toggle.closest('.pt-header-mini-actions').length) {
      actionsRow.append(toggle);
    }

    // Hide the panel by default so it only shows when explicitly opened.
    control.removeClass('open').attr('aria-hidden', 'true').hide();

    toggle.off('click.presetTransferFontSize').on('click.presetTransferFontSize', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const isOpen = control.hasClass('open');
      if (isOpen) {
        control.removeClass('open').attr('aria-hidden', 'true').hide();
      } else {
        control.addClass('open').attr('aria-hidden', 'false').show();
      }
    });

    $(document)
      .off('click.presetTransferFontSize')
      .on('click.presetTransferFontSize', function (e) {
        const $target = $(e.target);
        if (!$target.closest('#preset-transfer-modal .font-size-wrapper').length) {
          control.removeClass('open').attr('aria-hidden', 'true').hide();
        }
      });

    // Clean up the global click handler when the modal is removed.
    modal.on('remove.fontSize', () => {
      $(document).off('click.presetTransferFontSize');
    });

    // Extension update button (only shown when an update is available).
    initExtensionUpdateUI(modal);
  }

  function applySearchSettingsToUI(settings) {
    const { globalSearch, includeContent } = settings || loadSearchSettings();

    $('.pt-search-settings-popover').each(function () {
      const $popover = $(this);
      $popover.find('.pt-search-opt-global').prop('checked', !!globalSearch);
      $popover.find('.pt-search-opt-content').prop('checked', !!includeContent);
    });
  }

  function openSearchSettingsPopover(context) {
    const $btn = $(`.pt-search-settings-btn[data-pt-search-context="${context}"]`);
    const $popover = $(`.pt-search-settings-popover[data-pt-search-context="${context}"]`);
    if (!$btn.length || !$popover.length) return;

    // Close others
    $('.pt-search-settings-popover').hide();
    $popover.show();
  }

  function closeSearchSettingsPopovers() {
    $('.pt-search-settings-popover').hide();
  }

  function getWrapperForContext(context) {
    if (context === 'left') return $('#left-entry-search-inline').closest('.search-input-wrapper');
    if (context === 'right') return $('#right-entry-search-inline').closest('.search-input-wrapper');
    return $('#entry-search').closest('.search-input-wrapper');
  }

  function routeSearch(context) {
    const settings = loadSearchSettings();
    const includeContent = !!settings.includeContent;
    const globalSearch = !!settings.globalSearch;

    const $input =
      context === 'left'
        ? $('#left-entry-search-inline')
        : context === 'right'
        ? $('#right-entry-search-inline')
        : $('#entry-search');

    const term = $input.val();
    const $wrapper = getWrapperForContext(context);

    if (globalSearch) {
      // Global search does not filter the existing list; keep list visible and show results panel.
      if (context === 'left') {
        filterSideEntries('left', '');
      } else if (context === 'right') {
        filterSideEntries('right', '');
      } else {
        // main search only exists in single-mode; use existing helper to clear jump buttons.
        filterDualEntries('');
      }

      runGlobalSearch({
        apiInfo,
        context,
        wrapperSelector: $wrapper,
        searchTerm: term,
        includeContent,
      });
      return;
    }

    // Local list filter
    cancelGlobalSearch();
    closeAllGlobalSearchPanels();

    if (context === 'left') {
      filterSideEntries('left', term);
    } else if (context === 'right') {
      filterSideEntries('right', term);
    } else {
      filterDualEntries(term);
    }
  }

  // 重置界面到初始状态的函数
  function resetInterface() {
    $('#entries-container, #single-container, #dual-container').hide();
    $('.search-section, .left-search-container, .right-search-container').hide();
    $('#left-entries-list, #right-entries-list, #single-entries-list').empty();
    $('#left-selection-count, #right-selection-count, #single-selection-count').text('');
    $('#entry-search, #left-entry-search-inline, #right-entry-search-inline').val('');
    cancelGlobalSearch();
    closeAllGlobalSearchPanels();
    closeSearchSettingsPopovers();
    window.ptWorldbookPickTarget = null;
    $('#left-side, #right-side').removeClass('transfer-target');
    // Reset the "show new" buttons (icon cleared, only文字“新增”保留)
    $('#left-show-new, #right-show-new').removeClass('showing-new').find('.btn-icon').text('');
    Object.assign(window, {
      leftEntries: [],
      rightEntries: [],
      singleEntries: [],
      leftPresetData: null,
      rightPresetData: null,
      singlePresetData: null,
    });
  }

  // 字体大小调节功能
  function adjustFontSize(size) {
    const targets = [
      '#preset-transfer-modal',
      '#edit-entry-modal',
      '#compare-modal',
      '#batch-delete-modal',
      '#batch-edit-modal',
      '#preview-modal',
      '#find-replace-modal',
      '#confirm-dialog-modal',
      '#conflict-resolution-dialog',
      '#ai-loading-overlay',
    ];

    targets.forEach(selector => {
      const el = $(selector)[0];
      if (el) el.style.setProperty('--pt-font-size', size + 'px');
    });

    $('#font-size-display').text(size + 'px');
    localStorage.setItem('preset-transfer-font-size', size);
  }

  function loadFontSize() {
    const savedSize = localStorage.getItem('preset-transfer-font-size');
    const fontSize = savedSize ? parseInt(savedSize) : 16;
    $('#font-size-slider').val(fontSize);
    adjustFontSize(fontSize);
  }

  // 初始化
  resetInterface();
  applyStoredSettings();
  loadFontSize();

  // 主题切换
  // $('#theme-toggle-btn').on('click', function (e) {
  //   e.preventDefault();
  //   e.stopPropagation();
  //   toggleTransferToolTheme();
  //   setTimeout(() => updateModalTheme(), 150);
  // });

  // 字体大小调节 (添加防抖优化)
  const debouncedFontSizeAdjust = debounce(function () {
    const size = parseInt($('#font-size-slider').val());
    adjustFontSize(size);
  }, 100); // 字体调节使用更短的防抖时间，保持响应性

  $('#font-size-slider').on('input', debouncedFontSizeAdjust);

  // 获取当前预设按钮事件
  $('#get-current-left').on('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    setCurrentPreset('left');
  });

  $('#get-current-right').on('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    setCurrentPreset('right');
  });

  // 预设选择变化时重置界面
  leftSelect.add(rightSelect).on('change', function () {
    const $this = $(this);
    const isLeftSelect = $this.is('#left-preset');
    const newPresetName = $this.val();

    // 获取之前的预设名称（用于正则切换）
    const previousPresetName = $this.data('previous-value');

    // 更新按钮状态
    loadBtn.prop('disabled', !leftSelect.val() && !rightSelect.val());
    resetInterface();
    saveCurrentSettings();

    // 更新正则绑定状态显示（全局监听器会处理正则切换）
    if (newPresetName) {
      updatePresetRegexStatus(newPresetName);
    }

    // 保存当前值作为下次的"之前值"
    $this.data('previous-value', newPresetName);
  });

  loadBtn.on('click', () => loadAndDisplayEntries(apiInfo));
  $('#batch-delete-presets').on('click', async () => {
    const currentApiInfo = getCurrentApiInfo();
    if (!currentApiInfo) {
      alert('无法获取当前API信息，请确保 SillyTavern 已正确加载');
      return;
    }

    const adapter = getActiveTransferAdapter();
    try {
      if (adapter.id === 'worldbook') {
        await createWorldbookBatchManageModal();
      } else {
        createBatchDeleteModal(currentApiInfo);
      }
    } catch (error) {
      const actionLabel = adapter.id === 'worldbook' ? '批量管理' : '批量删除';
      console.error(`${actionLabel}打开失败:`, error);
      alert(`${actionLabel}打开失败: ` + (error?.message ?? error));
    }
  });

  // 智能导入按钮事件

  // 添加防抖优化的条目搜索
  const debouncedRouteSearch = debounce(function (context) {
    routeSearch(context);
  }, 300);

  $('#entry-search').on('input', () => debouncedRouteSearch('main'));
  $('#left-entry-search-inline').on('input', () => debouncedRouteSearch('left'));
  $('#right-entry-search-inline').on('input', () => debouncedRouteSearch('right'));

  // Search settings gear + popover
  applySearchSettingsToUI(loadSearchSettings());

  $('.pt-search-settings-btn').on('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    const context = $(this).data('pt-search-context');
    const $popover = $(`.pt-search-settings-popover[data-pt-search-context="${context}"]`);
    const isOpen = $popover.is(':visible');
    closeSearchSettingsPopovers();
    if (!isOpen) openSearchSettingsPopover(context);
  });

  $('.pt-search-settings-popover').on('click', function (e) {
    // Don't close when interacting inside popover.
    e.stopPropagation();
  });

  $('.pt-search-settings-popover .pt-search-opt-global, .pt-search-settings-popover .pt-search-opt-content').on(
    'change',
    function () {
      const $popover = $(this).closest('.pt-search-settings-popover');
      const globalSearch = $popover.find('.pt-search-opt-global').is(':checked');
      const includeContent = $popover.find('.pt-search-opt-content').is(':checked');
      const settings = updateSearchSettings({ globalSearch, includeContent });
      applySearchSettingsToUI(settings);

      // Refresh search for all visible inputs that have content.
      if ($('#left-entry-search-inline').is(':visible') && $('#left-entry-search-inline').val()) routeSearch('left');
      if ($('#right-entry-search-inline').is(':visible') && $('#right-entry-search-inline').val()) routeSearch('right');
      if ($('#entry-search').is(':visible') && $('#entry-search').val()) routeSearch('main');
    },
  );

  $(document)
    .off('click.ptSearchSettings')
    .on('click.ptSearchSettings', function () {
      closeSearchSettingsPopovers();
    });
  // 添加防抖功能，避免频繁重新加载
  let displayModeChangeTimeout;
  $('#left-display-mode, #right-display-mode, #single-display-mode').on('change', function () {
    const $this = $(this);

    // 立即保存设置
    saveCurrentSettings();

    // 防抖处理重新加载
    clearTimeout(displayModeChangeTimeout);
    displayModeChangeTimeout = setTimeout(() => {
      loadAndDisplayEntries(apiInfo);
    }, 150); // 150ms防抖延迟
  });

  // 绑定设置变更事件
  $('#auto-close-modal, #auto-enable-entry').on('change', saveCurrentSettings);

  // Clean up global click handler when modal is removed.
  modal.on('remove.ptSearchSettings', () => {
    $(document).off('click.ptSearchSettings');
  });

  // 自动根据屏幕方向切换双栏视图（移动端）
  const { isMobile } = getDeviceInfo();
  if (isMobile) {
    const updateDualViewByOrientation = () => {
      // 使用高度和宽高比判断移动端横屏，与 CSS 媒体查询保持一致
      const isLandscape = window.innerHeight <= 680 && window.innerWidth > window.innerHeight && window.innerWidth / window.innerHeight >= 13 / 9;
      if (isLandscape) {
        $('#dual-container').addClass('mobile-dual-view');
      } else {
        $('#dual-container').removeClass('mobile-dual-view');
      }
    };

    // 初始化时设置
    updateDualViewByOrientation();

    // 监听屏幕尺寸变化
    window.addEventListener('resize', updateDualViewByOrientation);
  }

  // 左侧控制
  $('#left-select-all').on('click', () => {
    $('#left-entries-list .entry-item:visible .entry-checkbox').prop('checked', true);
    updateSelectionCount();
  });
  $('#left-select-none').on('click', () => {
    $('#left-entries-list .entry-item:visible .entry-checkbox').prop('checked', false);
    updateSelectionCount();
  });

  if (getActiveTransferAdapter().id === 'worldbook') {
    $('#left-show-new').on('click', () => createNewWorldbookEntry(apiInfo, 'left'));
  } else {
    $('#left-show-new').on('click', () => toggleNewEntries(apiInfo, 'left'));
  }

  $('#left-edit').on('click', () => editSelectedEntry(apiInfo, 'left'));
  $('#left-delete').on('click', () => deleteSelectedEntries(apiInfo, 'left'));
  $('#left-copy').on('click', () => simpleCopyEntries('left', apiInfo));
  $('#transfer-to-right').on('click', () => startTransferMode(apiInfo, 'left', 'right'));

  // 右侧控制
  $('#right-select-all').on('click', () => {
    $('#right-entries-list .entry-item:visible .entry-checkbox').prop('checked', true);
    updateSelectionCount();
  });
  $('#right-select-none').on('click', () => {
    $('#right-entries-list .entry-item:visible .entry-checkbox').prop('checked', false);
    updateSelectionCount();
  });

  if (getActiveTransferAdapter().id === 'worldbook') {
    $('#right-show-new').on('click', () => createNewWorldbookEntry(apiInfo, 'right'));
  } else {
    $('#right-show-new').on('click', () => toggleNewEntries(apiInfo, 'right'));
  }

  $('#right-edit').on('click', () => editSelectedEntry(apiInfo, 'right'));
  $('#right-delete').on('click', () => deleteSelectedEntries(apiInfo, 'right'));
  $('#right-copy').on('click', () => simpleCopyEntries('right', apiInfo));
  $('#transfer-to-left').on('click', () => startTransferMode(apiInfo, 'right', 'left'));

  // Worldbook global-search target picking: allow clicking anywhere on the side panel (not just entries).
  $('#left-side, #right-side')
    .off('click.ptWorldbookPickTarget')
    .on('click.ptWorldbookPickTarget', function (e) {
      const adapter = getActiveTransferAdapter();
      if (adapter?.id !== 'worldbook') return;
      if (!window.ptWorldbookPickTarget) return;

      const $t = $(e.target);
      if ($t.closest('.pt-global-search-panel, .pt-search-settings-popover, .pt-search-settings-btn').length) return;
      if ($t.closest('.entry-item, .create-here-btn, .entry-checkbox').length) return;

      e.preventDefault();
      e.stopPropagation();

      const side = this.id === 'left-side' ? 'left' : 'right';
      commitWorldbookPickTarget(side);
    });
  $('#compare-entries').on('click', () => showCompareModal(apiInfo));

  // 单预设控制
  $('#single-select-all').on('click', () => {
    $('#single-entries-list .entry-item:visible .entry-checkbox').prop('checked', true);
    updateSelectionCount();
  });
  $('#single-select-none').on('click', () => {
    $('#single-entries-list .entry-item:visible .entry-checkbox').prop('checked', false);
    updateSelectionCount();
  });

  if (getActiveTransferAdapter().id === 'worldbook') {
    $('#single-show-new').on('click', () => createNewWorldbookEntry(apiInfo, 'single'));
  }

  $('#single-edit').on('click', () => editSelectedEntry(apiInfo, 'single'));
  $('#single-delete').on('click', () => deleteSelectedEntries(apiInfo, 'single'));
  $('#single-copy').on('click', () => simpleCopyEntries('single', apiInfo));
  $('#single-move').on('click', () => startMoveMode('single', apiInfo));

  $('#close-modal').on('click', () => {
    // 注意：不停止全局预设监听器，因为它应该持续运行
    modal.remove();
  });
  modal.on('click', e => {
    if (e.target === modal[0]) {
      // 注意：不停止全局预设监听器，因为它应该持续运行
      modal.remove();
    }
  });
  $(document).on('keydown.preset-transfer', e => {
    if (e.key === 'Escape') {
      // 注意：不停止全局预设监听器，因为它应该持续运行
      modal.remove();
      $(document).off('keydown.preset-transfer');
    }
  });

  if (getDeviceInfo().isMobile) {
    const originalOverflow = $('body').css('overflow');
    $('body').css('overflow', 'hidden');
    modal.on('remove', () => $('body').css('overflow', originalOverflow));
  }
  modal.css('display', 'flex');

  // 初始化条目拖拽（排序 / 跨侧移动）
  try {
    if (getActiveTransferAdapter().capabilities.supportsMove) {
      initDragDrop(apiInfo);
    }
  } catch (error) {
    console.warn('PresetTransfer: 初始化拖拽功能失败', error);
  }
}

export { bindTransferEvents };
