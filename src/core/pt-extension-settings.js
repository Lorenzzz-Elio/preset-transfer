import { getSillyTavernContext } from './utils.js';

function getExtensionSettingsRoot(context) {
  if (!context || typeof context !== 'object') return null;
  const root = context.extensionSettings ?? context.extension_settings;
  return root && typeof root === 'object' ? root : null;
}

export function getPresetTransferSettingsNode({ create = false } = {}) {
  try {
    const context = getSillyTavernContext();
    const root = getExtensionSettingsRoot(context);
    if (!root) return { context, node: null };

    const existing = root.presetTransfer;
    if (existing && typeof existing === 'object') return { context, node: existing };
    if (!create) return { context, node: null };

    root.presetTransfer = {};
    return { context, node: root.presetTransfer };
  } catch {
    return { context: null, node: null };
  }
}

export function trySaveSillyTavernSettings(context) {
  try {
    context?.saveSettingsDebounced?.();
  } catch {
    // ignore
  }
}

