import { PT } from '../core/api-compat.js';
import { getJQuery } from '../core/utils.js';
import { getPresetRegexBindings } from '../features/regex-binding.js';
import { ensureNativeRegexPanelInjected, openPresetRegexBindingManager } from './native-panel.js';
import { renderRegexListComponent } from './regex-list-component.js';

function createRegexBindingModal(presetName) {
  try {
    const $ = getJQuery();
    ensureNativeRegexPanelInjected();
    const name = presetName || PT.API.getLoadedPresetName?.();
    if (name) {
      openPresetRegexBindingManager(name);
    }
  } catch (e) {
    console.warn('打开原生面板失败:', e);
  }
}

// 获取正则在当前绑定配置中的类型
function getCurrentRegexBindingType(regexId, bindings) {
  if (bindings.exclusive.includes(regexId)) return 'exclusive';
  return '';
}

// 更新预设的正则状态显示
function updatePresetRegexStatus(presetName) {
  const $ = getJQuery();
  const bindings = getPresetRegexBindings(presetName);
  const totalBindings = bindings.exclusive.length;

  // 更新按钮标题显示绑定数量
  const leftPreset = $('#left-preset').val();
  const rightPreset = $('#right-preset').val();

  // 左右侧旧按钮已移除，状态仅在面板内展示
}

// 在原生页面中注入"条目状态管理"折叠面板（默认折叠）

export {
  createRegexBindingModal,
  getCurrentRegexBindingType,
  renderRegexListComponent,
  updatePresetRegexStatus
};
