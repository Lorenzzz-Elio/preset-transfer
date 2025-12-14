import { PT } from '../core/api-compat.js';
import { getCurrentApiInfo, getJQuery } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';

let regexBindingEnabled = localStorage.getItem('preset-transfer-regex-binding-enabled') !== 'false';

const REGEX_BINDINGS_VERSION = 2;
const REGEX_BASELINE_STORAGE_KEY = 'preset-transfer-regex-baseline-v2';
let regexBaselineCache = null;

// 正则绑定配置的数据结构
const REGEX_BINDING_TYPES = {
  GLOBAL: 'global', // 全局正则，永不禁用
  EXCLUSIVE: 'exclusive', // 专属正则，可被多个预设设置，切换时智能管理
};

function loadRegexBaseline() {
  if (regexBaselineCache) return regexBaselineCache;
  try {
    const raw = localStorage.getItem(REGEX_BASELINE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    regexBaselineCache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    regexBaselineCache = {};
  }
  return regexBaselineCache;
}

function saveRegexBaseline(baseline) {
  regexBaselineCache = baseline && typeof baseline === 'object' ? baseline : {};
  try {
    localStorage.setItem(REGEX_BASELINE_STORAGE_KEY, JSON.stringify(regexBaselineCache));
  } catch {
    /* ignore */
  }
}

function normalizeRegexId(id) {
  return String(id ?? '');
}

function normalizeRegexBindings(rawBindings) {
  const normalized = {
    bound: [], // [{ id: string, enabled: boolean }]
    exclusive: [], // legacy: array of ids
    states: {}, // { [id]: boolean }
  };

  if (!rawBindings) return normalized;

  const add = (id, enabled) => {
    const key = normalizeRegexId(id);
    if (!key) return;
    const value = !!enabled;

    const existingIndex = normalized.bound.findIndex(x => normalizeRegexId(x?.id) === key);
    if (existingIndex >= 0) {
      normalized.bound[existingIndex].enabled = value;
    } else {
      normalized.bound.push({ id: key, enabled: value });
    }
    normalized.states[key] = value;
  };

  // v2: bound list with enabled state
  if (Array.isArray(rawBindings.bound)) {
    rawBindings.bound.forEach(item => {
      if (item && typeof item === 'object') add(item.id, item.enabled);
    });
  } else if (Array.isArray(rawBindings.items)) {
    // Legacy-ish: some builds used items
    rawBindings.items.forEach(item => {
      if (item && typeof item === 'object') add(item.id, item.enabled);
    });
  } else if (Array.isArray(rawBindings.exclusive)) {
    // v1: exclusive list (no per-regex enabled state) => treat as enabled
    rawBindings.exclusive.forEach(id => add(id, true));
  }

  // Optional: if someone stored states separately, merge it in.
  if (rawBindings.states && typeof rawBindings.states === 'object') {
    Object.entries(rawBindings.states).forEach(([id, enabled]) => {
      if (normalizeRegexId(id) in normalized.states) {
        add(id, !!enabled);
      }
    });
  }

  normalized.exclusive = normalized.bound.map(x => normalizeRegexId(x.id));
  return normalized;
}

// 获取预设的正则绑定配置（改用 PT.API 兼容层）
function getPresetRegexBindings(presetName) {
  try {
    // Prefer presetManager for freshest data (PT.API.getPreset may lag behind preset switching).
    try {
      const apiInfo = getCurrentApiInfo?.();
      const pm = apiInfo?.presetManager;
      if (pm && typeof pm.getCompletionPresetByName === 'function') {
        const presetObj = pm.getCompletionPresetByName(presetName);
        if (presetObj?.extensions?.regexBindings) {
          return normalizeRegexBindings(presetObj.extensions.regexBindings);
        }
        // Even if no bindings exist, returning normalized empty ensures consistent shape.
        if (presetObj) {
          return getDefaultRegexBindings();
        }
      }
    } catch {
      /* ignore and fall back to PT.API */
    }

    const preset = PT.API.getPreset(presetName);
    if (!preset || !preset.extensions) {
      return getDefaultRegexBindings();
    }
    const bindings = preset.extensions.regexBindings;
    if (!bindings) return getDefaultRegexBindings();
    return normalizeRegexBindings(bindings);
  } catch (error) {
    console.warn(`获取预设 "${presetName}" 的正则绑定配置失败:`, error);
    return getDefaultRegexBindings();
  }
}

// 最小化清理预设数据 - 只移除明显的无效元素，保护数据完整性
function minimalCleanPresetData(preset) {
  const cleaned = JSON.parse(JSON.stringify(preset));

  // 只移除明显的 null/undefined 元素，不检查 identifier
  if (cleaned.prompts && Array.isArray(cleaned.prompts)) {
    cleaned.prompts = cleaned.prompts.filter(prompt => prompt != null);
  }

  // 只移除 null/undefined 的 orderGroup 和 orderItem
  if (cleaned.prompt_order && Array.isArray(cleaned.prompt_order)) {
    cleaned.prompt_order = cleaned.prompt_order
      .filter(orderGroup => orderGroup != null)
      .map(orderGroup => {
        if (orderGroup && orderGroup.order && Array.isArray(orderGroup.order)) {
          return {
            ...orderGroup,
            order: orderGroup.order.filter(orderItem => orderItem != null),
          };
        }
        return orderGroup;
      });
  }

  return cleaned;
}

// 保存预设的正则绑定配置（改用 PT.API 兼容层）- 渐进式错误处理
async function savePresetRegexBindings(presetName, bindings) {
  try {
    const normalized = normalizeRegexBindings(bindings);
    const normalizedBindings = {
      version: REGEX_BINDINGS_VERSION,
      bound: normalized.bound,
      // Keep legacy field for backwards compatibility / exports.
      exclusive: normalized.exclusive,
    };

    const apiInfo = getCurrentApiInfo?.();
    if (apiInfo && apiInfo.presetManager) {
      const presetObj = apiInfo.presetManager.getCompletionPresetByName(presetName);
      if (!presetObj) throw new Error(`Preset "${presetName}" not found`);

      if (!presetObj.extensions) presetObj.extensions = {};
      presetObj.extensions.regexBindings = normalizedBindings;

      await apiInfo.presetManager.savePreset(presetName, presetObj, { skipUpdate: false });

      const cachedPreset = PT.API.getPreset(presetName);
      if (cachedPreset) {
        if (!cachedPreset.extensions) cachedPreset.extensions = {};
        cachedPreset.extensions.regexBindings = normalizedBindings;
      }

      return true;
    }

    const preset = PT.API.getPreset(presetName);
    if (!preset) throw new Error(`Preset "${presetName}" not found`);

    if (!preset.extensions) preset.extensions = {};
    preset.extensions.regexBindings = normalizedBindings;

    try {
      await PT.API.replacePreset(presetName, preset);
      return true;
    } catch (firstError) {
      console.warn('Failed to replace preset directly, retrying with cleaned data:', firstError);

      const cleanPreset = minimalCleanPresetData(preset);
      cleanPreset.extensions.regexBindings = normalizedBindings;

      await PT.API.replacePreset(presetName, cleanPreset);
      console.log('Preset saved successfully with cleaned data');
      return true;
    }
  } catch (error) {
    console.error(`Failed to save regex bindings for preset "${presetName}":`, error);
    return false;
  }
}

// 获取默认的正则绑定配置
function getDefaultRegexBindings() {
  return normalizeRegexBindings(null);
}

// 获取所有可用的正则列表（改用 PT.API 兼容层）
function getAllAvailableRegexes() {
  try {
    // 这里只关心全局正则，避免在没有角色上下文时触发角色级正则的持久化逻辑
    return PT.API.getTavernRegexes({ scope: 'global', enable_state: 'all' }) || [];
  } catch (error) {
    console.error('获取正则列表失败:', error);
    return [];
  }
}

// 分析预设切换时需要启用和禁用的正则
function analyzeRegexChanges(fromPresetName, toPresetName, { fromBindings, toBindings } = {}) {
  try {
    const normalizedFrom =
      fromBindings != null
        ? normalizeRegexBindings(fromBindings)
        : fromPresetName
          ? getPresetRegexBindings(fromPresetName)
          : getDefaultRegexBindings();
    const normalizedTo = toBindings != null ? normalizeRegexBindings(toBindings) : getPresetRegexBindings(toPresetName);

    const fromIds = new Set((normalizedFrom.exclusive || []).map(normalizeRegexId));
    const toIds = new Set((normalizedTo.exclusive || []).map(normalizeRegexId));

    const desiredById = new Map();
    normalizedTo.bound.forEach(item => {
      desiredById.set(normalizeRegexId(item.id), !!item.enabled);
    });

    // All regex ids that are bound by ANY preset.
    // For a preset-scoped behavior: if a regex is bound to some preset(s),
    // it should only be active when the current preset binds it.
    //
    // Important: always include from/to ids as a baseline so switching still works
    // even if preset enumeration fails (e.g. PresetManager not ready yet).
    const allBoundIds = new Set([...fromIds, ...toIds]);
    try {
      const apiInfo = getCurrentApiInfo?.();
      const presetNames = apiInfo?.presetNames;
      if (Array.isArray(presetNames)) {
        presetNames.forEach(pn => {
          const b =
            pn === toPresetName && toBindings != null ? normalizedTo : pn === fromPresetName && fromBindings != null ? normalizedFrom : getPresetRegexBindings(pn);
          (b?.exclusive || []).forEach(id => allBoundIds.add(normalizeRegexId(id)));
        });
      }
    } catch {
      /* ignore */
    }

    const toEnable = normalizedTo.bound.filter(x => !!x.enabled).map(x => normalizeRegexId(x.id));
    const toDisable = normalizedTo.bound.filter(x => !x.enabled).map(x => normalizeRegexId(x.id));
    const toRestore = Array.from(fromIds).filter(id => !toIds.has(id));

    return {
      toEnable,
      toDisable,
      toRestore,
      fromBindings: normalizedFrom,
      toBindings: normalizedTo,
      fromIds,
      toIds,
      desiredById,
      allBoundIds,
    };
  } catch (error) {
    console.error('分析正则变化失败:', error);
    return {
      toEnable: [],
      toDisable: [],
      toRestore: [],
      fromBindings: getDefaultRegexBindings(),
      toBindings: getDefaultRegexBindings(),
      fromIds: new Set(),
      toIds: new Set(),
      desiredById: new Map(),
      allBoundIds: new Set(),
    };
  }
}

// 执行正则切换
async function switchPresetRegexes(fromPresetName, toPresetName, opts = {}) {
  try {
    const { fromIds, toIds, desiredById, toBindings, allBoundIds } = analyzeRegexChanges(
      fromPresetName,
      toPresetName,
      opts,
    );

    // If nothing is bound anywhere, nothing to control.
    if ((allBoundIds?.size || 0) === 0 && (fromIds?.size || 0) === 0) {
      return true;
    }

    const allRegexes = getAllAvailableRegexes();
    const currentById = new Map(allRegexes.map(r => [normalizeRegexId(r.id), r]));

    const baseline = loadRegexBaseline();

    // Capture baseline for any regex that becomes preset-bound (first time we see it).
    // Baseline is used when a regex becomes unbound everywhere.
    allBoundIds.forEach(id => {
      if (Object.prototype.hasOwnProperty.call(baseline, id)) return;
      const current = currentById.get(id);
      if (current) baseline[id] = !!current.enabled;
    });

    // Regexes that were bound in the previous preset but are no longer bound by ANY preset:
    // restore them to baseline so they return to "native" management.
    const restoreToBaseline = new Set(Array.from(fromIds).filter(id => !allBoundIds.has(id)));

    // 执行正则更新
    const updateFunction = regexes => {
      regexes.forEach(regex => {
        const id = normalizeRegexId(regex.id);

        if (allBoundIds.has(id)) {
          // Bound to some preset(s): only active when current preset binds it.
          regex.enabled = desiredById.has(id) ? !!desiredById.get(id) : false;
          return;
        }

        // Unbound everywhere now: restore to baseline if we have it.
        if (restoreToBaseline.has(id) && Object.prototype.hasOwnProperty.call(baseline, id)) {
          regex.enabled = !!baseline[id];
        }
      });
      return regexes;
    };

    // 通过 PT.API 统一更新正则
    // 仅更新全局正则，避免在没有选中角色/聊天时触发角色级数据写入
    const updated = await PT.API.updateTavernRegexesWith(updateFunction, { scope: 'global' });

    // Update baseline for regexes not controlled by any preset.
    if (Array.isArray(updated)) {
      updated.forEach(r => {
        const id = normalizeRegexId(r.id);
        if (!allBoundIds.has(id)) baseline[id] = !!r.enabled;
      });
    }

    saveRegexBaseline(baseline);

    return true;
  } catch (error) {
    console.error('切换正则失败:', error);

    // 显示错误提示
    if (window.toastr) {
      toastr.error('正则切换失败: ' + error.message);
    } else {
      console.error('正则切换失败:', error.message);
    }

    return false;
  }
}

// 显示正则切换反馈
function showRegexSwitchingFeedback(toEnable, toDisable, regexMap) {
  const $ = getJQuery();

  // 移除已存在的反馈
  $('#regex-switching-feedback').remove();

  if (toEnable.length === 0 && toDisable.length === 0) {
    return;
  }

  // 获取当前字体大小设置
  const savedSize = localStorage.getItem('preset-transfer-font-size');
  const currentFontSize = savedSize ? parseInt(savedSize) : 16;

  const message = `✅ 已开启绑定正则`;

  const feedback = $(`
    <div id="regex-switching-feedback" style="
      --pt-font-size: ${CommonStyles.getVars().fontSize};
      position: fixed; top: 80px; left: 50%; transform: translateX(-50%); z-index: 10002;
      background: rgba(0, 0, 0, 0.85); color: white; padding: 10px 20px;
      border-radius: 6px; font-size: calc(var(--pt-font-size) * 0.8125); font-weight: 500;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.1);
    ">
      ${message}
    </div>
  `);

  $('body').append(feedback);
}

// 隐藏正则切换反馈
function hideRegexSwitchingFeedback() {
  const $ = getJQuery();
  setTimeout(() => {
    $('#regex-switching-feedback').fadeOut(300, function () {
      $(this).remove();
    });
  }, 1000);
}


// Getter and setter for regexBindingEnabled
function getRegexBindingEnabled() {
  return regexBindingEnabled;
}

function setRegexBindingEnabled(value) {
  regexBindingEnabled = value;
}

export {
  getPresetRegexBindings,
  minimalCleanPresetData,
  savePresetRegexBindings,
  getDefaultRegexBindings,
  getAllAvailableRegexes,
  analyzeRegexChanges,
  switchPresetRegexes,
  showRegexSwitchingFeedback,
  hideRegexSwitchingFeedback,
  REGEX_BINDING_TYPES,
  getRegexBindingEnabled,
  setRegexBindingEnabled
};
