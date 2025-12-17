export function registerPresetTransferNamespace(modules) {
  window.PresetTransfer = modules;
}

export function exposeModuleMembersToWindow(modulesToExpose) {
  try {
    for (const mod of modulesToExpose) {
      if (!mod || typeof mod !== 'object') continue;
      for (const [key, value] of Object.entries(mod)) {
        if (!(key in window)) {
          window[key] = value;
        }
      }
    }
  } catch (error) {
    console.warn(
      'PresetTransfer: 无法将模块函数名挂到 window 上，将只通过 window.PresetTransfer 访问。',
      error,
    );
  }
}

