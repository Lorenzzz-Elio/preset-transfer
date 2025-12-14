import { getSillyTavernContext } from './utils.js';

function getPresetManagerFromContext(context) {
  const apiId = context?.mainApi === 'koboldhorde' ? 'kobold' : context?.mainApi;
  const pm = context?.getPresetManager?.(apiId);
  if (!pm) throw new Error('无法获取 PresetManager（请确认已在 SillyTavern 主界面运行）');
  return pm;
}

/**
 * Returns the currently selected preset name (aka loaded preset).
 * This is the native equivalent of various third-party helpers' `getLoadedPresetName`.
 */
export function getLoadedPresetNameNative() {
  const context = getSillyTavernContext();
  const pm = getPresetManagerFromContext(context);
  return pm.getSelectedPresetName?.() ?? null;
}

