import { getSillyTavernContext } from './utils.js';

// Keep these values in-sync with SillyTavern's `scripts/extensions/regex/engine.js`.
// We keep the mapping local so this extension can be built/bundled without importing ST internals.
const regexPlacement = {
  USER_INPUT: 1,
  AI_OUTPUT: 2,
  SLASH_COMMAND: 3,
  WORLD_INFO: 5,
  REASONING: 6,
};

function deepClone(value) {
  try {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function normalizeEnabledDisabled(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  // ST uses `disabled`; some tools use `enabled`.
  const hasEnabled = Object.prototype.hasOwnProperty.call(obj, 'enabled');
  const hasDisabled = Object.prototype.hasOwnProperty.call(obj, 'disabled');

  // If both exist, prefer `enabled` (UI toggles use it).
  if (hasEnabled) {
    obj.disabled = !obj.enabled;
  } else if (hasDisabled) {
    obj.enabled = !obj.disabled;
  }
  return obj;
}

function toPlacementArray(tavernRegex) {
  // If it's already a ST RegexScriptData object, preserve `placement`.
  if (Array.isArray(tavernRegex?.placement)) return [...tavernRegex.placement];

  const src = tavernRegex?.source ?? {};
  const placement = [];
  if (src.user_input) placement.push(regexPlacement.USER_INPUT);
  if (src.ai_output) placement.push(regexPlacement.AI_OUTPUT);
  if (src.slash_command) placement.push(regexPlacement.SLASH_COMMAND);
  if (src.world_info) placement.push(regexPlacement.WORLD_INFO);
  if (src.reasoning) placement.push(regexPlacement.REASONING);
  return placement;
}

function toRegexScriptData(item) {
  if (!item || typeof item !== 'object') return null;

  const makeId = () => {
    try {
      if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
      }
    } catch {
      /* ignore */
    }
    // RFC4122-ish fallback
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  // Accept both ST-style and various helper export styles.
  const scriptName = item.scriptName ?? item.script_name ?? item.name ?? '';
  const findRegex = item.findRegex ?? item.find_regex ?? '';
  const replaceString = item.replaceString ?? item.replace_string ?? '';
  const runOnEdit = item.runOnEdit ?? item.run_on_edit ?? false;
  const minDepth = item.minDepth ?? item.min_depth ?? null;
  const maxDepth = item.maxDepth ?? item.max_depth ?? null;
  const markdownOnly = item.markdownOnly ?? item.destination?.display ?? false;
  const promptOnly = item.promptOnly ?? item.destination?.prompt ?? false;

  const normalized = {
    id: String(item.id ?? '') || makeId(),
    scriptName: String(scriptName ?? ''),
    findRegex: String(findRegex ?? ''),
    replaceString: String(replaceString ?? ''),
    trimStrings: Array.isArray(item.trimStrings) ? item.trimStrings : [],
    placement: toPlacementArray(item),
    disabled: Object.prototype.hasOwnProperty.call(item, 'enabled') ? !item.enabled : Boolean(item.disabled ?? false),
    markdownOnly: Boolean(markdownOnly),
    promptOnly: Boolean(promptOnly),
    runOnEdit: Boolean(runOnEdit),
    substituteRegex: typeof item.substituteRegex === 'number' ? item.substituteRegex : 0,
    // ST accepts null/number; keep nulls if missing.
    minDepth: typeof minDepth === 'number' ? minDepth : minDepth == null ? null : Number(minDepth),
    maxDepth: typeof maxDepth === 'number' ? maxDepth : maxDepth == null ? null : Number(maxDepth),
  };

  // For compatibility with the rest of PT, keep the legacy fields in-memory only.
  // Do NOT rely on these being persisted by ST.
  normalized.enabled = !normalized.disabled;
  normalized.script_name = normalized.scriptName;
  return normalized;
}

function filterByEnableState(list, enableState) {
  if (enableState === 'enabled') return list.filter(s => s && s.enabled === true);
  if (enableState === 'disabled') return list.filter(s => s && s.enabled === false);
  return list;
}

// Some third-party renderers (e.g. JS-Slash-Runner) rely on the native chat reload flow
// (`reloadCurrentChat` -> `chatLoaded` -> message render events) to rebuild their DOM/iframes.
// Preset Transfer historically only rerendered visible messages, which can leave those renderers
// stuck showing the original code block source. Provide a native-like reload pathway.
let reloadChatTimer = null;
let reloadChatPromise = null;
let reloadChatResolve = null;
function requestReloadCurrentChat(context) {
  const ctx = context ?? getSillyTavernContext();
  if (typeof ctx?.reloadCurrentChat !== 'function') return null;

  if (!reloadChatPromise) {
    reloadChatPromise = new Promise(resolve => {
      reloadChatResolve = resolve;
    });
  }

  if (reloadChatTimer) clearTimeout(reloadChatTimer);
  reloadChatTimer = setTimeout(async () => {
    const done = reloadChatResolve;
    reloadChatResolve = null;
    reloadChatPromise = null;
    reloadChatTimer = null;

    try {
      await ctx.reloadCurrentChat();
    } catch {
      /* ignore */
    } finally {
      done?.(true);
    }
  }, 150);

  return reloadChatPromise;
}

export function getGlobalTavernRegexesNative(opts = {}) {
  const context = getSillyTavernContext();
  const settings = context?.extensionSettings;
  const scriptsRaw = Array.isArray(settings?.regex) ? settings.regex : [];
  const scripts = scriptsRaw
    .map(s => toRegexScriptData(deepClone(s)))
    .filter(Boolean)
    .map(normalizeEnabledDisabled);

  return filterByEnableState(scripts, opts?.enable_state ?? 'all');
}

export async function updateGlobalTavernRegexesWithNative(updater) {
  const context = getSillyTavernContext();
  const settings = context?.extensionSettings;
  if (!settings) throw new Error('无法访问 SillyTavern extensionSettings');

  const current = getGlobalTavernRegexesNative({ scope: 'global', enable_state: 'all' });
  const updated = (typeof updater === 'function' ? await updater(current) : current) ?? current;
  const finalList = Array.isArray(updated) ? updated : current;

  // Normalize to ST RegexScriptData and strip PT-only fields before saving.
  const toSave = finalList
    .map(item => toRegexScriptData(deepClone(item)))
    .filter(Boolean)
    .map(item => {
      const { enabled, script_name, ...st } = item;
      // Ensure `disabled` stays consistent with `enabled` if both were present.
      normalizeEnabledDisabled(st);
      delete st.enabled;
      delete st.script_name;
      return st;
    });

  // Keep the original array + item references (by id) so existing consumers
  // see updates immediately without needing a refresh/reload.
  if (Array.isArray(settings.regex)) {
    const existingById = new Map(
      settings.regex
        .filter(x => x && typeof x === 'object' && x.id != null)
        .map(x => [String(x.id), x]),
    );

    const nextList = toSave.map(item => {
      const id = String(item?.id ?? '');
      const existing = id ? existingById.get(id) : null;
      if (!existing) return item;

      // Remove keys that no longer exist on the new object to avoid stale flags.
      Object.keys(existing).forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(item, key)) delete existing[key];
      });
      Object.assign(existing, item);
      return existing;
    });

    settings.regex.length = 0;
    settings.regex.push(...nextList);
  } else {
    settings.regex = toSave;
  }

  // Some parts of ST respond to settings events rather than direct reference reads.
  try {
    context?.eventSource?.emit?.(context?.eventTypes?.SETTINGS_UPDATED);
  } catch {
    /* ignore */
  }

  // Notify the native Regex extension UI (if enabled) to refresh its list.
  // Without this, external updates (like preset bindings) won't be reflected until
  // the user manually toggles a regex, refreshes, or switches chats/characters.
  try {
    context?.eventSource?.emit?.('regex_scripts_updated', { source: 'preset-transfer' });
  } catch {
    /* ignore */
  }

  // Match ST native regex workflow: save settings and reload current chat to fully re-render.
  try {
    context?.saveSettingsDebounced?.();
  } catch {
    /* ignore */
  }
  void requestReloadCurrentChat(context);

  // Return the normalized PT view (with enabled + script_name).
  return getGlobalTavernRegexesNative({ scope: 'global', enable_state: 'all' });
}
