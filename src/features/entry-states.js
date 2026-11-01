// ==================== 条目状态管理功能 ====================
// 此文件现在作为统一入口，整合核心状态管理和UI功能

import * as Core from './entry-states-core.js';
import * as UI from '../ui/entry-states-ui.js';
import { notify } from '../core/notify.js';

// 从核心模块导出
export {
  getEntryStatesSaveWorldBindings,
  setEntryStatesSaveWorldBindings,
  getEntryStatesGroupByPrefix,
  setEntryStatesGroupByPrefix,
  hookPresetSaveToProtectExtensions,
  unhookPresetSaveToProtectExtensions,
  sanitizeWorldBindings,
  normalizeEntryStatesConfig,
  getPresetEntryStates,
  savePresetEntryStates,
  getDefaultEntryStates,
  getCurrentEntryStates,
  deleteEntryStatesVersion,
  renameEntryStatesVersion
} from './entry-states-core.js';

// 从UI模块导出
export {
  getWorldInfoModule,
  getWorldSelectionFromDom,
  getCurrentWorldSelection,
  applyWorldBindings
} from '../ui/entry-states-ui.js';

// 应用条目状态版本（整合UI通知）
export async function applyEntryStates(presetName, versionId) {
  const applyWorldBindingsFn = async (worldBindings) => {
    try {
      const { applied, missing } = await UI.applyWorldBindings(worldBindings);
      if (missing.length) {
        notify.warning(`世界书未找到: ${missing.join('、')}`);
      }
      if (applied.length) {
        notify.success(`已同步世界书: ${applied.join('、')}`);
      } else if (Array.isArray(worldBindings) && worldBindings.length === 0) {
        notify.info('世界书选择已清空');
      }
    } catch (worldError) {
      console.warn('同步世界书失败:', worldError);
      notify.error('同步世界书失败: ' + worldError.message);
    }
  };

  return await Core.applyEntryStates(presetName, versionId, applyWorldBindingsFn);
}

// 保存当前条目状态为新版本（整合UI通知）
export async function saveCurrentEntryStatesAsVersion(presetName, versionName) {
  const getCurrentWorldSelectionFn = async () => {
    const worldBindings = await UI.getCurrentWorldSelection();
    if (worldBindings === null) {
      notify.warning('获取世界书选择失败，已跳过绑定保存');
    }
    return worldBindings;
  };

  return await Core.saveCurrentEntryStatesAsVersion(presetName, versionName, getCurrentWorldSelectionFn);
}
