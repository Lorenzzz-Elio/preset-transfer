// ==================== 条目状态UI辅助功能 ====================

import { getJQuery, getSillyTavernContext } from '../core/utils.js';
import { sanitizeWorldBindings } from '../features/entry-states-core.js';

let worldInfoModulePromise = null;

export async function getWorldInfoModule() {
  if (!worldInfoModulePromise) {
    worldInfoModulePromise = import('/scripts/world-info.js').catch(error => {
      worldInfoModulePromise = null;
      throw error;
    });
  }
  return worldInfoModulePromise;
}

export function getWorldSelectionFromDom() {
  try {
    const $ = getJQuery();
    if (!$) return null;
    const select = $('#world_info');
    if (!select.length) return null;
    const selectedOptions = select.find('option:selected');
    if (!selectedOptions.length) return [];
    const names = [];
    selectedOptions.each(function () {
      const name = $(this).text().trim();
      if (name && !names.includes(name)) {
        names.push(name);
      }
    });
    return sanitizeWorldBindings(names);
  } catch (error) {
    console.warn('[EntryStates] 读取界面世界书选择失败:', error);
    return null;
  }
}

export async function getCurrentWorldSelection() {
  const fromDom = getWorldSelectionFromDom();
  if (Array.isArray(fromDom)) {
    return fromDom;
  }
  try {
    const module = await getWorldInfoModule();
    const selected = Array.isArray(module.selected_world_info) ? module.selected_world_info : [];
    return sanitizeWorldBindings(selected);
  } catch (error) {
    console.warn('[EntryStates] 获取世界书选择失败:', error);
    return null;
  }
}

export async function applyWorldBindings(worldNames) {
  const $ = getJQuery();
  const sanitizedTargets = sanitizeWorldBindings(Array.isArray(worldNames) ? worldNames : []);
  const hasTargets = sanitizedTargets.length > 0;
  let module = null;

  const ensureWorldInfoModule = async () => {
    if (!module) {
      module = await getWorldInfoModule();
    }
    return module;
  };

  const readAvailableFromDom = () => {
    if (!$) return [];
    const selectEl = $('#world_info');
    if (!selectEl.length) return [];
    return selectEl
      .find('option')
      .map((_, opt) => $(opt).text().trim())
      .get()
      .filter(Boolean);
  };

  let select = $ ? $('#world_info') : null;
  let available = select && select.length ? readAvailableFromDom() : [];

  if (hasTargets && available.length === 0) {
    try {
      const mod = await ensureWorldInfoModule();
      if (typeof mod.updateWorldInfoList === 'function') {
        await mod.updateWorldInfoList();
      }
      if (!select || !select.length) {
        select = $ ? $('#world_info') : null;
      }
      if (select && select.length) {
        available = readAvailableFromDom();
      } else if (Array.isArray(mod.world_names)) {
        available = mod.world_names.slice();
      }
    } catch (error) {
      console.warn('[EntryStates] 更新世界书列表失败:', error);
    }
  }

  if (!available.length && hasTargets) {
    try {
      const mod = await ensureWorldInfoModule();
      if (Array.isArray(mod.world_names)) {
        available = mod.world_names.slice();
      }
    } catch (error) {
      console.warn('[EntryStates] 获取世界书列表失败:', error);
    }
  }

  const availableSet = new Set(available);
  const applied = [];
  const missing = [];

  if (hasTargets) {
    sanitizedTargets.forEach(name => {
      if (!availableSet.size || availableSet.has(name)) {
        applied.push(name);
      } else {
        missing.push(name);
      }
    });
  }

  if (select && select.length) {
    if (!hasTargets) {
      select.val([]).trigger('change');
    } else if (applied.length > 0) {
      const values = [];
      const appliedSet = new Set(applied);
      select.find('option').each(function () {
        const optionName = $(this).text().trim();
        if (appliedSet.has(optionName)) {
          values.push($(this).val());
        }
      });
      select.val(values).trigger('change');
    } else if (missing.length === sanitizedTargets.length) {
      select.val([]).trigger('change');
    }
  } else {
    if (!module && (hasTargets || !hasTargets)) {
      try {
        await ensureWorldInfoModule();
      } catch (error) {
        console.warn('[EntryStates] 同步世界书失败:', error);
        return { applied, missing };
      }
    }
    if (!module) {
      return { applied, missing };
    }

    if (!hasTargets) {
      module.selected_world_info = [];
    } else if (applied.length > 0) {
      module.selected_world_info = applied.slice();
    }
    try {
      const context = getSillyTavernContext();
      context?.saveSettingsDebounced?.();
      context?.eventSource?.emit?.(context.eventTypes?.WORLDINFO_SETTINGS_UPDATED);
    } catch (error) {
      console.warn('[EntryStates] 同步世界书事件失败:', error);
    }
  }

  return { applied, missing };
}
