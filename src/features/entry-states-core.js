// ==================== 条目状态核心管理 ====================

import { PT } from '../core/api-compat.js';
import { getPresetDataFromManager, getOrderedPromptEntries } from '../preset/preset-manager.js';

// 条目状态管理开关
let entryStatesSaveWorldBindings =
  localStorage.getItem('preset-transfer-entry-states-save-world-bindings') !== 'false';
let entryStatesGroupByPrefix =
  localStorage.getItem('preset-transfer-entry-states-group') !== 'false';

export function getEntryStatesSaveWorldBindings() {
  return entryStatesSaveWorldBindings;
}

export function setEntryStatesSaveWorldBindings(enabled) {
  entryStatesSaveWorldBindings = !!enabled;
}

export function getEntryStatesGroupByPrefix() {
  return entryStatesGroupByPrefix;
}

export function setEntryStatesGroupByPrefix(enabled) {
  entryStatesGroupByPrefix = !!enabled;
}

// 保护扩展数据的Hook
let originalSavePreset = null;
let hookInstalled = false;
let hookInstallRetryTimer = null;

export function hookPresetSaveToProtectExtensions() {
  try {
    if (hookInstalled) {
      console.log('[EntryStates] Hook已安装，跳过');
      return;
    }

    const apiInfo = getCurrentApiInfo();
    if (!apiInfo || !apiInfo.presetManager) {
      if (!hookInstallRetryTimer) {
        hookInstallRetryTimer = setTimeout(() => {
          hookInstallRetryTimer = null;
          hookPresetSaveToProtectExtensions();
        }, 1000);
        console.log('[EntryStates] API信息未就绪，等待后重试Hook');
      }
      return;
    }

    originalSavePreset = apiInfo.presetManager.savePreset.bind(apiInfo.presetManager);

    apiInfo.presetManager.savePreset = async function hookPresetSaveToProtectExtensions(name, settings, options = {}) {
      try {
        const existingPreset = PT.API.getPreset(name);
        const existingExtensions = existingPreset?.extensions || {};

        if (!settings) {
          const fullPreset = this.getCompletionPresetByName(name);
          if (fullPreset) {
            settings = fullPreset;
          } else {
            settings = this.getPresetSettings(name);
          }
        }

        if (!settings.extensions) {
          settings.extensions = {};
        }

        if (existingExtensions.entryStates) {
          settings.extensions.entryStates = existingExtensions.entryStates;
        }
        if (existingExtensions.entryGrouping) {
          settings.extensions.entryGrouping = existingExtensions.entryGrouping;
        }
        const hasRegexBindingsInSettings = Object.prototype.hasOwnProperty.call(settings.extensions, 'regexBindings');
        if (!hasRegexBindingsInSettings && existingExtensions.regexBindings) {
          settings.extensions.regexBindings = existingExtensions.regexBindings;
        }

        const result = await originalSavePreset.call(this, name, settings, options);

        try {
          const presetObj = this.getCompletionPresetByName?.(name);
          if (presetObj) {
            if (!presetObj.extensions) presetObj.extensions = {};
            if (existingExtensions.entryStates) {
              presetObj.extensions.entryStates = existingExtensions.entryStates;
            }
            if (existingExtensions.entryGrouping) {
              presetObj.extensions.entryGrouping = existingExtensions.entryGrouping;
            }
            if (Object.prototype.hasOwnProperty.call(settings.extensions, 'regexBindings')) {
              presetObj.extensions.regexBindings = settings.extensions.regexBindings;
            } else if (existingExtensions.regexBindings) {
              presetObj.extensions.regexBindings = existingExtensions.regexBindings;
            } else {
              delete presetObj.extensions.regexBindings;
            }
          }
        } catch (_) {}

        return result;
      } catch (error) {
        console.error('[EntryStates] 覆写 savePreset 失败，回退原始保存逻辑:', error);
        return await originalSavePreset.call(this, name, settings, options);
      }
    };

    hookInstalled = true;
    if (hookInstallRetryTimer) {
      clearTimeout(hookInstallRetryTimer);
      hookInstallRetryTimer = null;
    }
    console.log('[EntryStates] 预设保存Hook已安装');
  } catch (error) {
    console.error('[EntryStates] 安装预设保存Hook失败:', error);
    if (!hookInstallRetryTimer) {
      hookInstallRetryTimer = setTimeout(() => {
        hookInstallRetryTimer = null;
        hookPresetSaveToProtectExtensions();
      }, 1500);
      console.log('[EntryStates] 将稍后重试安装Hook');
    }
  }
}

export function unhookPresetSaveToProtectExtensions() {
  try {
    if (!hookInstalled) return;

    if (hookInstallRetryTimer) {
      clearTimeout(hookInstallRetryTimer);
      hookInstallRetryTimer = null;
    }

    if (!originalSavePreset) {
      hookInstalled = false;
      return;
    }

    const apiInfo = getCurrentApiInfo?.();
    const pm = apiInfo?.presetManager;
    if (pm && typeof pm.savePreset === 'function') {
      try {
        pm.savePreset = originalSavePreset;
      } catch {
        /* ignore */
      }
    }

    originalSavePreset = null;
    hookInstalled = false;
  } catch {
    /* ignore */
  }
}

export function sanitizeWorldBindings(list) {
  if (!Array.isArray(list)) return [];
  const result = [];
  const seen = new Set();
  list.forEach(item => {
    if (typeof item !== 'string') return;
    const name = item.trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    result.push(name);
  });
  return result;
}

export function normalizeEntryStatesConfig(states) {
  const safeStates = states && typeof states === 'object' ? states : {};
  const normalized = {
    enabled: safeStates.enabled !== false,
    versions: [],
    currentVersion: safeStates.currentVersion || null,
  };

  if (Array.isArray(safeStates.versions)) {
    normalized.versions = safeStates.versions
      .map(version => {
        if (!version || typeof version !== 'object') return null;
        const normalizedVersion = { ...version };
        if (!normalizedVersion.states || typeof normalizedVersion.states !== 'object') {
          normalizedVersion.states = {};
        }
        normalizedVersion.worldBindings = sanitizeWorldBindings(normalizedVersion.worldBindings);
        return normalizedVersion;
      })
      .filter(Boolean);
  }

  return normalized;
}

export function getPresetEntryStates(presetName) {
  try {
    const preset = PT.API.getPreset(presetName);

    if (!preset || !preset.extensions) {
      return getDefaultEntryStates();
    }
    const states = preset.extensions.entryStates;

    if (!states) {
      return getDefaultEntryStates();
    }

    return normalizeEntryStatesConfig(states);
  } catch (error) {
    console.warn(`获取预设 "${presetName}" 的条目状态配置失败:`, error);
    return getDefaultEntryStates();
  }
}

export async function savePresetEntryStates(presetName, states) {
  try {
    const normalizedStates = normalizeEntryStatesConfig(states);
    const apiInfo = getCurrentApiInfo?.();

    if (states && typeof states === 'object') {
      states.enabled = normalizedStates.enabled;
      states.versions = normalizedStates.versions;
      states.currentVersion = normalizedStates.currentVersion;
    }

    if (apiInfo && apiInfo.presetManager) {
      const presetObj = apiInfo.presetManager.getCompletionPresetByName(presetName);
      if (!presetObj) throw new Error(`预设 "${presetName}" 不存在`);

      if (!presetObj.extensions) presetObj.extensions = {};
      presetObj.extensions.entryStates = normalizedStates;

      await apiInfo.presetManager.savePreset(presetName, presetObj, { skipUpdate: false });
      return true;
    }

    const preset = PT.API.getPreset(presetName);
    if (!preset) throw new Error(`预设 "${presetName}" 不存在`);

    if (!preset.extensions) preset.extensions = {};
    preset.extensions.entryStates = normalizedStates;

    await PT.API.replacePreset(presetName, preset);
    return true;
  } catch (error) {
    console.error(`保存预设 "${presetName}" 的条目状态配置失败:`, error);
    return false;
  }
}

export function getDefaultEntryStates() {
  return {
    enabled: true,
    versions: [],
    currentVersion: null,
  };
}

export function getCurrentEntryStates(presetName) {
  try {
    const apiInfo = getCurrentApiInfo();
    if (!apiInfo) return {};

    const presetData = getPresetDataFromManager(apiInfo, presetName);
    if (!presetData) return {};

    const entries = getOrderedPromptEntries(presetData, 'include_disabled');
    const states = {};

    entries.forEach(entry => {
      if (entry.identifier) {
        states[entry.identifier] = entry.enabled === true;
      }
    });

    return states;
  } catch (error) {
    console.error('获取当前条目状态失败:', error);
    return {};
  }
}

export async function applyEntryStates(presetName, versionId, applyWorldBindingsFn) {
  try {
    const statesConfig = getPresetEntryStates(presetName);
    const version = statesConfig.versions.find(v => v.id === versionId);
    if (!version) {
      throw new Error('状态版本不存在');
    }

    const apiInfo = getCurrentApiInfo();
    if (!apiInfo) throw new Error('无法获取API信息');

    const presetData = getPresetDataFromManager(apiInfo, presetName);
    if (!presetData) throw new Error('预设不存在');

    if (!presetData.prompt_order) presetData.prompt_order = [];

    const dummyCharacterId = 100001;
    let characterPromptOrder = presetData.prompt_order.find(order => order.character_id === dummyCharacterId);

    if (!characterPromptOrder) {
      characterPromptOrder = { character_id: dummyCharacterId, order: [] };
      presetData.prompt_order.push(characterPromptOrder);
    }

    characterPromptOrder.order.forEach(orderEntry => {
      if (orderEntry.identifier && version.states.hasOwnProperty(orderEntry.identifier)) {
        orderEntry.enabled = version.states[orderEntry.identifier];
      }
    });

    await apiInfo.presetManager.savePreset(presetName, presetData, { skipUpdate: true });

    statesConfig.currentVersion = versionId;
    await savePresetEntryStates(presetName, statesConfig);

    if (entryStatesSaveWorldBindings && Object.prototype.hasOwnProperty.call(version, 'worldBindings') && applyWorldBindingsFn) {
      await applyWorldBindingsFn(version.worldBindings);
    }

    return true;
  } catch (error) {
    console.error('应用条目状态失败:', error);
    throw error;
  }
}

export async function saveCurrentEntryStatesAsVersion(presetName, versionName, getCurrentWorldSelectionFn) {
  try {
    const currentStates = getCurrentEntryStates(presetName);
    const statesConfig = getPresetEntryStates(presetName);

    let worldBindings = null;
    if (entryStatesSaveWorldBindings && getCurrentWorldSelectionFn) {
      worldBindings = await getCurrentWorldSelectionFn();
      if (worldBindings === null) {
        console.warn('[EntryStates] 获取世界书选择失败，已跳过绑定保存');
      }
    }

    const newVersion = {
      id: generateUUID(),
      name: versionName,
      createdAt: new Date().toISOString(),
      states: currentStates,
    };

    if (entryStatesSaveWorldBindings && worldBindings !== null) {
      newVersion.worldBindings = worldBindings;
    }

    statesConfig.versions.push(newVersion);
    statesConfig.currentVersion = newVersion.id;

    const success = await savePresetEntryStates(presetName, statesConfig);
    if (success) {
      return newVersion;
    } else {
      throw new Error('保存失败');
    }
  } catch (error) {
    console.error('保存条目状态版本失败:', error);
    throw error;
  }
}

export async function deleteEntryStatesVersion(presetName, versionId) {
  try {
    const statesConfig = getPresetEntryStates(presetName);
    const versionIndex = statesConfig.versions.findIndex(v => v.id === versionId);

    if (versionIndex === -1) {
      throw new Error('版本不存在');
    }

    statesConfig.versions.splice(versionIndex, 1);

    if (statesConfig.currentVersion === versionId) {
      statesConfig.currentVersion = null;
    }

    return await savePresetEntryStates(presetName, statesConfig);
  } catch (error) {
    console.error('删除条目状态版本失败:', error);
    throw error;
  }
}

export async function renameEntryStatesVersion(presetName, versionId, newName) {
  try {
    const statesConfig = getPresetEntryStates(presetName);
    const version = statesConfig.versions.find(v => v.id === versionId);

    if (!version) {
      throw new Error('版本不存在');
    }

    version.name = newName;

    return await savePresetEntryStates(presetName, statesConfig);
  } catch (error) {
    console.error('重命名条目状态版本失败:', error);
    throw error;
  }
}
