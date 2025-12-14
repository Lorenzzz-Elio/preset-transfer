import { getSillyTavernContext } from './utils.js';
import { getLoadedPresetNameNative } from './st-presets.js';

function getPresetManager() {
  const context = getSillyTavernContext();
  const apiId = context?.mainApi === 'koboldhorde' ? 'kobold' : context?.mainApi;
  const presetManager = context?.getPresetManager?.(apiId);
  if (!presetManager) {
    throw new Error('无法获取 PresetManager（请确认已在 SillyTavern 主界面运行）');
  }
  return presetManager;
}

function resolveInUsePresetName(name, presetManager) {
  if (name !== 'in_use') return name;
  // Treat "in_use" as an alias of the currently selected preset.
  return presetManager.getSelectedPresetName?.() || name;
}

function safeCall(f, ...args) {
  try {
    if (typeof f === 'function') return f(...args);
  } catch (e) {
    console.warn('调用函数失败:', e);
  }
  return undefined;
}

export function createPresetApi() {
  return {
    // Preset read: prefer completion preset (includes prompts + prompt_order).
    getPreset(name) {
      const presetManager = getPresetManager();
      const resolvedName = resolveInUsePresetName(name, presetManager);

      const preset = presetManager.getCompletionPresetByName?.(resolvedName);
      if (preset) return preset;

      // Fallback: older/alternative implementations may only expose preset settings.
      return safeCall(presetManager.getPresetSettings?.bind(presetManager), resolvedName);
    },

    // Preset write: save via PresetManager.
    async replacePreset(name, preset) {
      const presetManager = getPresetManager();
      const resolvedName = resolveInUsePresetName(name, presetManager);
      if (typeof presetManager.savePreset !== 'function') {
        throw new Error('PresetManager.savePreset 不可用');
      }
      await presetManager.savePreset(resolvedName, preset);
      return true;
    },

    // Current preset name: sourced from PresetManager UI state.
    getLoadedPresetName() {
      return getLoadedPresetNameNative();
    },

    // Switch preset: select by option value.
    loadPreset(name) {
      const presetManager = getPresetManager();
      const value = presetManager.findPreset?.(name);
      if (value == null) throw new Error(`未找到预设: ${name}`);
      presetManager.selectPreset?.(value);
      return true;
    },
  };
}
