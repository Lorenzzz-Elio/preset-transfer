function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function getSillyTavernContext() {
  const st = window.parent?.SillyTavern ?? window.SillyTavern;
  if (st) return st.getContext();
  throw new Error('无法获取SillyTavern上下文');
}

function getParentWindow() {
  return window.parent && window.parent !== window ? window.parent : window;
}

function getJQuery() {
  return getParentWindow().$ ?? window.$;
}

function getCurrentApiInfo() {
  try {
    const context = getSillyTavernContext();
    const mainApi = context.mainApi;
    const presetManager = context.getPresetManager(mainApi === 'koboldhorde' ? 'kobold' : mainApi);
    const { preset_names } = presetManager.getPresetList();
    const presetNames = Array.isArray(preset_names) ? preset_names : Object.keys(preset_names || {});
    return {
      apiType: mainApi,
      presetManager: presetManager,
      presetNames: presetNames,
      context: context,
    };
  } catch (error) {
    console.error('获取API信息失败:', error);
    return null;
  }
}

function getDeviceInfo() {
  const parentWindow = getParentWindow();
  const isMobile = parentWindow.innerWidth <= 768;
  const isSmallScreen = parentWindow.innerWidth <= 480;
  const isPortrait = parentWindow.innerHeight > parentWindow.innerWidth;
  return { isMobile, isSmallScreen, isPortrait };
}

function ensureViewportCssVars() {
  const parentWindow = getParentWindow();
  const root = parentWindow.document?.documentElement || document.documentElement;

  if (parentWindow.__presetTransferViewportCssVarsBound) {
    parentWindow.__presetTransferViewportCssVarsHandler?.();
    return;
  }

  const handler = () => {
    // Use innerHeight to match the visible viewport on mobile browsers with dynamic toolbars.
    const vh = parentWindow.innerHeight * 0.01;
    root.style.setProperty('--pt-vh', `${vh}px`);
    root.style.setProperty('--pt-viewport-height', `${parentWindow.innerHeight}px`);
  };

  parentWindow.__presetTransferViewportCssVarsBound = true;
  parentWindow.__presetTransferViewportCssVarsHandler = handler;

  handler();
  parentWindow.addEventListener('resize', handler, { passive: true });
  parentWindow.addEventListener('orientationchange', handler, { passive: true });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Internal helper: do a token-based diff inside the changed region only.
function highlightDiffTokens(oldStr, newStr) {
  const a = (oldStr || '').split(/(\s+)/); // keep whitespace tokens
  const b = (newStr || '').split(/(\s+)/);

  const n = a.length;
  const m = b.length;

  // If nothing to compare, highlight everything as changed.
  if (!newStr || m === 0) {
    return '<span class="diff-highlight">' + escapeHtml(newStr || '') + '</span>';
  }

  // For very large texts, fall back to simple highlight to avoid heavy DP.
  if (n === 0 || n * m > 250000) {
    return '<span class="diff-highlight">' + escapeHtml(newStr) + '</span>';
  }

  // Classic LCS dynamic programming on token arrays.
  const dp = Array(n + 1);
  for (let i = 0; i <= n; i++) {
    dp[i] = new Array(m + 1).fill(0);
  }

  for (let i = 1; i <= n; i++) {
    const ai = a[i - 1];
    for (let j = 1; j <= m; j++) {
      if (ai === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = dp[i - 1][j] >= dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
      }
    }
  }

  const result = [];
  let i = n;
  let j = m;

  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.push({ value: b[j - 1], changed: false });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      result.push({ value: b[j - 1], changed: true });
      j--;
    }
  }

  // Any remaining tokens in `b` are treated as inserted/changed.
  while (j > 0) {
    result.push({ value: b[j - 1], changed: true });
    j--;
  }

  result.reverse();

  return result
    .map(token =>
      token.changed
        ? '<span class="diff-highlight">' + escapeHtml(token.value) + '</span>'
        : escapeHtml(token.value),
    )
    .join('');
}

// Highlight differences between two strings.
// `base` is the original text, `compare` is the new text to render.
// We first strip out the common prefix/suffix, then run a token-level diff
// only inside the minimal changed window. This keeps most identical content
// un-highlighted even when the diff is near the beginning.
function highlightDiff(base, compare) {
  const t1 = base || '';
  const t2 = compare || '';

  if (t1 === t2) return escapeHtml(t2);

  const len1 = t1.length;
  const len2 = t2.length;

  // Find common prefix
  let start = 0;
  while (start < len1 && start < len2 && t1[start] === t2[start]) {
    start++;
  }

  // Find common suffix
  let end1 = len1;
  let end2 = len2;
  while (end1 > start && end2 > start && t1[end1 - 1] === t2[end2 - 1]) {
    end1--;
    end2--;
  }

  const prefix = t2.substring(0, start);
  const suffix = t2.substring(end2);
  const diffOld = t1.substring(start, end1);
  const diffNew = t2.substring(start, end2);

  if (!diffNew) {
    // Only deletions, nothing new to show.
    return escapeHtml(prefix + suffix);
  }

  const highlightedMiddle = highlightDiffTokens(diffOld, diffNew);
  return escapeHtml(prefix) + highlightedMiddle + escapeHtml(suffix);
}


function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0,
      v = c == 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// 确保identifier在预设中的唯一性
function ensureUniqueIdentifier(presetData, baseIdentifier = null) {
  if (!presetData || !presetData.prompts) {
    return baseIdentifier || generateUUID();
  }

  const existingIdentifiers = new Set(presetData.prompts.map(p => p.identifier).filter(Boolean));

  // 如果没有提供基础identifier，生成一个新的
  if (!baseIdentifier) {
    let newId = generateUUID();
    while (existingIdentifiers.has(newId)) {
      newId = generateUUID();
    }
    return newId;
  }

  // 如果提供的identifier不冲突，直接返回
  if (!existingIdentifiers.has(baseIdentifier)) {
    return baseIdentifier;
  }

  // 如果冲突，生成新的
  let newId = generateUUID();
  while (existingIdentifiers.has(newId)) {
    newId = generateUUID();
  }
  return newId;
}

// 通过identifier或名称查找条目
function findEntryByIdentifierOrName(entries, identifier, name) {
  if (!entries || !Array.isArray(entries)) {
    return null;
  }

  // 优先通过identifier查找
  if (identifier) {
    const entryByIdentifier = entries.find(entry => entry.identifier === identifier);
    if (entryByIdentifier) {
      return entryByIdentifier;
    }
  }

  // fallback到名称查找
  if (name) {
    return entries.find(entry => entry.name === name);
  }

  return null;
}

// 创建条目的identifier映射，提高查找性能
function createIdentifierMap(entries) {
  if (!entries || !Array.isArray(entries)) {
    return new Map();
  }

  const map = new Map();
  entries.forEach((entry, index) => {
    if (entry.identifier) {
      map.set(entry.identifier, { entry, index });
    }
    // 同时建立名称映射作为备选
    if (entry.name) {
      const nameKey = `name:${entry.name}`;
      if (!map.has(nameKey)) {
        // 避免名称重复时覆盖
        map.set(nameKey, { entry, index });
      }
    }
  });

  return map;
}

// 使用映射快速查找条目
function findEntryFromMap(identifierMap, identifier, name) {
  if (!identifierMap || identifierMap.size === 0) {
    return null;
  }

  // 优先通过identifier查找
  if (identifier && identifierMap.has(identifier)) {
    return identifierMap.get(identifier);
  }

  // fallback到名称查找
  if (name) {
    const nameKey = `name:${name}`;
    if (identifierMap.has(nameKey)) {
      return identifierMap.get(nameKey);
    }
  }

  return null;
}

// =============================================
// AI Assistant Functions
// =============================================


export {
  debounce,
  getSillyTavernContext,
  getParentWindow,
  getJQuery,
  getCurrentApiInfo,
  getDeviceInfo,
  ensureViewportCssVars,
  escapeHtml,
  highlightDiff,
  escapeRegExp,
  generateUUID,
  ensureUniqueIdentifier,
  findEntryByIdentifierOrName,
  createIdentifierMap,
  findEntryFromMap
};
