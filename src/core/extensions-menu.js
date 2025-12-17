import { getJQuery } from './utils.js';

const EXTENSIONS_MENU_SELECTOR = '#extensionsMenu';
const PRESET_MENU_ITEM_ID = 'preset-transfer-menu-item';
const WORLDBOOK_MENU_ITEM_ID = 'worldbook-transfer-menu-item';
const GLOBAL_STYLES_ID = 'preset-transfer-global-styles';

export function waitForExtensionsMenu({ pollIntervalMs = 500 } = {}) {
  return new Promise(resolve => {
    function check() {
      try {
        const $ = getJQuery?.() ?? window.jQuery;
        if ($ && $(EXTENSIONS_MENU_SELECTOR).length) {
          console.log('扩展菜单已就绪');
          resolve();
          return;
        }
      } catch (error) {
        console.warn('jQuery 或扩展菜单未就绪，等待中...', error);
      }

      setTimeout(check, pollIntervalMs);
    }

    check();
  });
}

function mountGlobalStyles($) {
  $(`#${GLOBAL_STYLES_ID}`).remove();
  $('head').append(`
      <style id="${GLOBAL_STYLES_ID}">
        @keyframes pt-fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pt-slideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        /* Subtle scrollbars across all PresetTransfer UI surfaces */
        #preset-transfer-modal,
        #batch-delete-modal,
        #compare-modal,
        #edit-entry-modal,
        [id^="pt-"] {
          scrollbar-width: thin;
          scrollbar-color: rgba(127, 127, 127, 0.16) transparent;
        }

        #preset-transfer-modal *,
        #batch-delete-modal *,
        #compare-modal *,
        #edit-entry-modal *,
        [id^="pt-"] * {
          scrollbar-width: thin;
          scrollbar-color: rgba(127, 127, 127, 0.16) transparent;
        }

        #preset-transfer-modal *::-webkit-scrollbar,
        #batch-delete-modal *::-webkit-scrollbar,
        #compare-modal *::-webkit-scrollbar,
        #edit-entry-modal *::-webkit-scrollbar,
        [id^="pt-"] *::-webkit-scrollbar {
          width: 3px;
          height: 3px;
        }

        #preset-transfer-modal *::-webkit-scrollbar-track,
        #batch-delete-modal *::-webkit-scrollbar-track,
        #compare-modal *::-webkit-scrollbar-track,
        #edit-entry-modal *::-webkit-scrollbar-track,
        [id^="pt-"] *::-webkit-scrollbar-track {
          background: transparent;
        }

        #preset-transfer-modal *::-webkit-scrollbar-thumb,
        #batch-delete-modal *::-webkit-scrollbar-thumb,
        #compare-modal *::-webkit-scrollbar-thumb,
        #edit-entry-modal *::-webkit-scrollbar-thumb,
        [id^="pt-"] *::-webkit-scrollbar-thumb {
          background: rgba(127, 127, 127, 0.14);
          border-radius: 999px;
        }

        #preset-transfer-modal *::-webkit-scrollbar-thumb:hover,
        #batch-delete-modal *::-webkit-scrollbar-thumb:hover,
        #compare-modal *::-webkit-scrollbar-thumb:hover,
        #edit-entry-modal *::-webkit-scrollbar-thumb:hover,
        [id^="pt-"] *::-webkit-scrollbar-thumb:hover {
          background: rgba(127, 127, 127, 0.22);
        }

        #preset-transfer-modal *::-webkit-scrollbar-corner,
        #batch-delete-modal *::-webkit-scrollbar-corner,
        #compare-modal *::-webkit-scrollbar-corner,
        #edit-entry-modal *::-webkit-scrollbar-corner,
        [id^="pt-"] *::-webkit-scrollbar-corner {
          background: transparent;
        }
        #preset-transfer-modal .entry-item {
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        #preset-transfer-modal .entry-item:hover {
          border-color: var(--pt-entry-hover-border, #9ca3af) !important;
          box-shadow: 0 4px 12px var(--pt-entry-hover-shadow, rgba(0,0,0,0.1)) !important;
          transform: translateY(-2px) !important;
        }
        #preset-transfer-modal .entry-item:active {
          transform: translateY(0) !important;
          box-shadow: 0 2px 6px var(--pt-entry-active-shadow, rgba(0,0,0,0.05)) !important;
        }
        #preset-transfer-modal button {
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
          border-radius: 8px !important;
        }
        #preset-transfer-modal button:not(.theme-toggle-btn):not(.jump-btn):not(.pt-search-settings-btn):not(:disabled):hover {
          transform: translateY(-1px) !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
        }
        #preset-transfer-modal button:not(.theme-toggle-btn):not(.pt-search-settings-btn):not(:disabled):active {
          transform: translateY(0) !important;
          box-shadow: 0 2px 6px rgba(0,0,0,0.1) !important;
        }
        #preset-transfer-modal button:disabled {
          opacity: 0.5 !important;
          cursor: not-allowed !important;
          transform: none !important;
        }
      </style>
    `);
}

// Attach the tool to SillyTavern's Extensions menu (left of the input box).
export function integrateIntoExtensionsMenu({ MainUI } = {}) {
  try {
    const $ = getJQuery?.() ?? window.jQuery;
    if (!$) {
      console.warn('PresetTransfer: jQuery 未就绪，暂时无法添加菜单项');
      return false;
    }

    const extensionsMenu = $(EXTENSIONS_MENU_SELECTOR);
    if (!extensionsMenu.length) {
      console.error('PresetTransfer: 未找到 #extensionsMenu 容器');
      return false;
    }

    if ($(`#${PRESET_MENU_ITEM_ID}`).length === 0) {
      const menuItem = $(`
        <a id="${PRESET_MENU_ITEM_ID}" class="list-group-item" href="#" title="预设转移">
          <i class="fa-solid fa-exchange-alt"></i> 预设转移
        </a>
      `);

      extensionsMenu.append(menuItem);

      menuItem.on('click', async event => {
        event.preventDefault();
        event.stopPropagation();

        // Close extensions menu
        extensionsMenu.fadeOut(200);

        try {
          await MainUI?.createTransferUI?.({ adapterKey: 'preset' });
        } catch (error) {
          console.error('PresetTransfer: 创建 UI 失败', error);
          alert('创建预设转移工具界面失败：' + error.message);
        }
      });
    }

    // Worldbook transfer entry (added alongside preset transfer)
    if ($(`#${WORLDBOOK_MENU_ITEM_ID}`).length === 0) {
      const worldbookMenuItem = $(`
        <a id="${WORLDBOOK_MENU_ITEM_ID}" class="list-group-item" href="#" title="世界书转移">
          <i class="fa-solid fa-book"></i> 世界书转移
        </a>
      `);

      extensionsMenu.append(worldbookMenuItem);

      worldbookMenuItem.on('click', async event => {
        event.preventDefault();
        event.stopPropagation();
        extensionsMenu.fadeOut(200);
        try {
          await MainUI?.createTransferUI?.({ adapterKey: 'worldbook' });
        } catch (error) {
          console.error('PresetTransfer: 创建 UI 失败', error);
          alert('创建世界书转移工具界面失败：' + error.message);
        }
      });
    }

    mountGlobalStyles($);

    console.log('PresetTransfer: 已添加菜单项到扩展菜单');
    return true;
  } catch (error) {
    console.error('PresetTransfer: 集成扩展菜单失败', error);
    return false;
  }
}

