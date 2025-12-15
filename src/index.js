// 预设转移工具 - 入口脚本
// Author: discord千秋梦
// Version: v2.1

// 样式
import './styles/main.css';
import './styles/mobile.css';

// 核心模块
import * as APICompat from './core/api-compat.js';
import * as Constants from './core/constants.js';
import * as Utils from './core/utils.js';

// 样式模块
import * as CommonStyles from './styles/common-styles.js';
import * as Theme from './styles/theme.js';

// 预设相关
import * as BatchDelete from './preset/batch-delete.js';
import * as NewVersionFields from './preset/new-version-fields.js';
import * as PresetManager from './preset/preset-manager.js';

// 功能模块
import * as AIAssistant from './features/ai-assistant.js';
import * as DragDropCore from './features/drag-drop-core.js';
import * as EntryStates from './features/entry-states.js';
import * as EntryGrouping from './features/entry-grouping.js';
import * as GlobalListener from './features/global-listener.js';
import * as ImportExport from './features/import-export.js';
import * as RegexBinding from './features/regex-binding.js';
import { checkForExtensionUpdate } from './features/extension-update.js';

// UI 模块
import * as BatchEditor from './ui/batch-editor.js';
import * as CompareModal from './ui/compare-modal.js';
import * as DragDropUI from './ui/drag-drop-ui.js';
import * as EditModal from './ui/edit-modal.js';
import * as EntryGroupingUI from './ui/entry-grouping-ui.js';
import * as MainUI from './ui/main-ui.js';
import * as NativePanel from './ui/native-panel.js';
import * as PresetUpdateModal from './ui/preset-update-modal.js';
import * as QuickPreview from './ui/quick-preview.js';
import * as RegexUI from './ui/regex-ui.js';
import * as StylesApplication from './ui/styles-application.js';

// 操作模块
import * as CopyMove from './operations/copy-move.js';
import * as CoreOperations from './operations/core-operations.js';
import * as EntryOperations from './operations/entry-operations.js';
import * as EntrySaving from './operations/entry-saving.js';
import * as FindReplace from './operations/find-replace.js';
import * as PresetUpdate from './operations/preset-update.js';

// 显示模块
import * as EntryDisplay from './display/entry-display.js';
import * as SearchFilter from './display/search-filter.js';
import * as UIUpdates from './display/ui-updates.js';

// 事件模块
import * as CompareEvents from './events/compare-events.js';
import * as DragDropEvents from './events/drag-drop-events.js';
import * as EventBinding from './events/event-binding.js';

// 设置模块
import * as EnhancedFeatures from './settings/enhanced-features.js';
import * as SettingsApplication from './settings/settings-application.js';
import * as SettingsManager from './settings/settings-manager.js';

// 批量模块
import * as BatchModifications from './batch/batch-modifications.js';

// 暴露统一命名空间，方便调试
window.PresetTransfer = {
  Utils,
  APICompat,
  Constants,
  CommonStyles,
  Theme,
  PresetManager,
  BatchDelete,
  NewVersionFields,
  EntryStates,
  EntryGrouping,
  DragDropCore,
  RegexBinding,
  ImportExport,
  GlobalListener,
  AIAssistant,
  MainUI,
  RegexUI,
  NativePanel,
  CompareModal,
  EditModal,
  PresetUpdateModal,
  BatchEditor,
  QuickPreview,
  StylesApplication,
  DragDropUI,
  EntryGroupingUI,
  EntryOperations,
  CoreOperations,
  CopyMove,
  FindReplace,
  EntrySaving,
  PresetUpdate,
  EntryDisplay,
  UIUpdates,
  SearchFilter,
  EventBinding,
  CompareEvents,
  DragDropEvents,
  SettingsManager,
  SettingsApplication,
  EnhancedFeatures,
  BatchModifications,
};

// 兼容旧脚本里直接调用的全局函数名（不覆盖 SillyTavern 自带的同名函数）
try {
  const modulesToExpose = [
    Utils,
    CommonStyles,
    Theme,
    PresetManager,
    BatchDelete,
    NewVersionFields,
    EntryStates,
    EntryGrouping,
    DragDropCore,
    RegexBinding,
    ImportExport,
    GlobalListener,
    AIAssistant,
    MainUI,
    RegexUI,
    NativePanel,
    CompareModal,
    EditModal,
    PresetUpdateModal,
    BatchEditor,
    QuickPreview,
    StylesApplication,
    DragDropUI,
    EntryGroupingUI,
    EntryOperations,
    CoreOperations,
    CopyMove,
    FindReplace,
    EntrySaving,
    PresetUpdate,
    EntryDisplay,
    UIUpdates,
    SearchFilter,
    EventBinding,
    CompareEvents,
    DragDropEvents,
    SettingsManager,
    SettingsApplication,
    EnhancedFeatures,
    BatchModifications,
  ];

  for (const mod of modulesToExpose) {
    for (const [key, value] of Object.entries(mod)) {
      if (!(key in window)) {
        window[key] = value;
      }
    }
  }
} catch (error) {
  console.warn('PresetTransfer: 无法将模块函数名挂到 window 上，将只通过 window.PresetTransfer 访问。', error);
}

// 把工具接到输入框左侧的扩展菜单里
function integrateIntoExtensionsMenu() {
  try {
    const $ = Utils.getJQuery?.() ?? window.jQuery;
    if (!$) {
      console.warn('PresetTransfer: jQuery 未就绪，暂时无法添加菜单项');
      return;
    }

    const extensionsMenu = $('#extensionsMenu');
    if (!extensionsMenu.length) {
      console.error('PresetTransfer: 未找到 #extensionsMenu 容器');
      return;
    }

    if ($('#preset-transfer-menu-item').length === 0) {
      const menuItem = $(`
        <a id="preset-transfer-menu-item" class="list-group-item" href="#" title="预设转移">
          <i class="fa-solid fa-exchange-alt"></i> 预设转移
        </a>
      `);

      extensionsMenu.append(menuItem);

      menuItem.on('click', async event => {
        event.preventDefault();
        event.stopPropagation();

        // 关闭扩展菜单
        $('#extensionsMenu').fadeOut(200);

        try {
          await MainUI.createTransferUI?.({ adapterKey: 'preset' });
        } catch (error) {
          console.error('PresetTransfer: 创建 UI 失败', error);
          alert('创建预设转移工具界面失败：' + error.message);
        }
      });
    }

    // 全局滚动条等样式
    // Worldbook transfer entry (added alongside preset transfer)
    if ($('#worldbook-transfer-menu-item').length === 0) {
      const worldbookMenuItem = $(`
        <a id="worldbook-transfer-menu-item" class="list-group-item" href="#" title="世界书转移">
          <i class="fa-solid fa-book"></i> 世界书转移
        </a>
      `);

      extensionsMenu.append(worldbookMenuItem);

      worldbookMenuItem.on('click', async event => {
        event.preventDefault();
        event.stopPropagation();
        $('#extensionsMenu').fadeOut(200);
        try {
          await MainUI.createTransferUI?.({ adapterKey: 'worldbook' });
        } catch (error) {
          console.error('PresetTransfer: åˆ›å»º UI å¤±è´¥', error);
          alert('创建世界书转移工具界面失败：' + error.message);
        }
      });
    }

    $('#preset-transfer-global-styles').remove();
    $('head').append(`
      <style id="preset-transfer-global-styles">
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
        #preset-transfer-modal button:not(.theme-toggle-btn):not(.jump-btn):not(:disabled):hover {
          transform: translateY(-1px) !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
        }
        #preset-transfer-modal button:not(.theme-toggle-btn):not(:disabled):active {
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

    console.log('PresetTransfer: 已添加菜单项到扩展菜单');
  } catch (error) {
    console.error('PresetTransfer: 集成扩展菜单失败', error);
  }
}

// 初始化入口
async function initPresetTransferIntegration() {
  try {
    console.log('预设转移工具开始初始化...');

    // Check for updates once per page load (no git operations here; only HTTP fetch).
    // If an update is available, the UI will show an update button when the modal is opened.
    checkForExtensionUpdate().catch(() => {});

    // 等待扩展菜单和 jQuery 就绪
    await waitForExtensionsMenu();

    // 添加到扩展菜单
    integrateIntoExtensionsMenu();

    // 初始化主题设置
    try {
      Theme.initializeThemeSettings?.();
    } catch (error) {
      console.log('主题初始化跳过：', error?.message);
    }

    // 注入原生页面里的正则 / 条目状态折叠面板
    try {
      NativePanel.initNativeRegexPanelIntegration?.();
    } catch (e) {
      console.warn('注入原生正则面板失败，将稍后重试');
      setTimeout(() => {
        try {
          NativePanel.initNativeRegexPanelIntegration?.();
        } catch {
          /* ignore */
        }
      }, 1500);
    }

    // 启动全局预设监听器（负责绑定正则与条目状态随预设切换自动更新）
    try {
      GlobalListener.init?.();
      console.log('全局预设监听器已启动');
    } catch (error) {
      console.warn('启动全局预设监听器失败:', error);
      setTimeout(() => {
        try {
          GlobalListener.init?.();
          console.log('全局预设监听器延迟启动成功');
        } catch (retryError) {
          console.error('全局预设监听器启动失败:', retryError);
        }
      }, 2000);
    }

    // 初始化条目分组功能
    try {
      EntryGroupingUI.initEntryGrouping?.();
      console.log('条目分组功能已启动');
    } catch (error) {
      console.warn('启动条目分组功能失败:', error);
    }

    console.log('预设转移工具初始化完成');
  } catch (error) {
    console.error('初始化失败:', error);
    setTimeout(initPresetTransferIntegration, 3000);
  }
}

// 等待扩展菜单 / jQuery 就绪
function waitForExtensionsMenu() {
  return new Promise(resolve => {
    function check() {
      try {
        const $ = window.jQuery;
        if ($ && $('#extensionsMenu').length) {
          console.log('扩展菜单已就绪');
          resolve();
        } else {
          setTimeout(check, 500);
        }
      } catch (error) {
        console.warn('jQuery 或扩展菜单未就绪，等待中...', error);
        setTimeout(check, 500);
      }
    }
    check();
  });
}

// 启动
jQuery(async () => {
  await initPresetTransferIntegration();
});
