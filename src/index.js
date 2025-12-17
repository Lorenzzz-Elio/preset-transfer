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
import { applyTransferToolFeatureToggles } from './features/feature-toggles.js';

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
import { initTransferToolsSettingsPanel } from './ui/transfer-tools-settings.js';

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

import { startPresetTransferIntegration } from './core/bootstrap.js';
import { exposeModuleMembersToWindow, registerPresetTransferNamespace } from './core/window-expose.js';

// 暴露统一命名空间，方便调试
registerPresetTransferNamespace({
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
});

// 兼容旧脚本里直接调用的全局函数名（不覆盖 SillyTavern 自带的同名函数）
exposeModuleMembersToWindow([
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
]);

startPresetTransferIntegration({
  MainUI,
  Theme,
  checkForExtensionUpdate,
  initTransferToolsSettingsPanel,
  applyTransferToolFeatureToggles,
});
