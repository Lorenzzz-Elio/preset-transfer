import { PT } from '../core/api-compat.js';
import { getCurrentApiInfo, getJQuery } from '../core/utils.js';
import { getCssVar } from '../core/color-utils.js';
import { extractPresetVersionInfo } from '../core/preset-name-utils.js';
import { getPresetDataFromManager } from '../preset/preset-manager.js';
import { getNameMatchKey } from '../preset/entry-match-utils.js';
import { showPresetGitUpdateModal } from './preset-git-update-modal.js';
import { exportPresetBundle, importPresetBundle } from '../features/import-export.js';
import {
  createSnapshotManagementPanel,
  initSnapshotManagementPanel,
} from './snapshot-management-panel.js';
import {
  fetchGitHubTags,
  fetchGitHubReleaseByTag,
  fetchPresetJsonFromGitHubAtRef,
  normalizeVersion,
  parseGitHubRepo,
  pickLatestTagBefore,
  resolveTagNameFromTemplate,
} from '../features/preset-git-sync.js';
import {
  createGitHubRelease,
  createGitHubTagRef,
  upsertGitHubFile,
} from '../features/preset-github-publish.js';
import {
  getPresetAutomationSettings,
  getPresetGitSource,
  removePresetGitSource,
  setPresetAutoMigrateOnImportEnabled,
  setPresetGitAutoUpdateEnabled,
  setPresetGitSource,
} from '../features/preset-stitch-settings.js';
import { switchPresetToVersion } from '../features/preset-version-switch.js';
import {
  applyTransferToolFeatureToggles,
  getTransferToolFeatureFlags,
  setEntryGroupingEnabled,
  setEntryStatesPanelEnabled,
  setRegexBindingFeatureEnabled,
  setRegexScriptGroupingEnabled,
  setWorldbookEntryGroupingEnabled,
  setWorldbookCommonEnabled,
  setWorldbookGroupingEnabled,
  setThemeGroupingEnabled,
} from '../features/feature-toggles.js';

const CONTAINER_ID = 'preset-transfer-extension-settings';

let currentGitBaseKey = '';
const gitSourceDraftByBase = {};

const PT_META_FIELD = 'pt_meta';
const PT_META_NAMESPACE = 'presetTransfer';

const TRANSFER_TOOLS_TAB_STORAGE_KEY = 'preset-transfer-transfer-tools-active-tab';
const TRANSFER_TOOLS_TAB_KEYS = ['features', 'settings', 'snapshots', 'io'];

function stripPresetTransferMetaInPlace(node) {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    node.forEach(stripPresetTransferMetaInPlace);
    return;
  }

  const ptMeta = node[PT_META_FIELD];
  if (ptMeta && typeof ptMeta === 'object' && !Array.isArray(ptMeta)) {
    if (Object.prototype.hasOwnProperty.call(ptMeta, PT_META_NAMESPACE)) {
      delete ptMeta[PT_META_NAMESPACE];
      if (Object.keys(ptMeta).length === 0) {
        delete node[PT_META_FIELD];
      }
    }
  }

  Object.values(node).forEach(stripPresetTransferMetaInPlace);
}

function cloneDeepFallback(value) {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function stripPresetTransferMetaForPublish(value) {
  const cloned = cloneDeepFallback(value);
  stripPresetTransferMetaInPlace(cloned);
  return cloned;
}

let generateQuietPromptFnPromise = null;

async function getGenerateQuietPromptFn() {
  if (generateQuietPromptFnPromise) return generateQuietPromptFnPromise;

  generateQuietPromptFnPromise = (async () => {
    try {
      const mod = await import(/* @vite-ignore */ '/script.js');
      const fn = mod?.generateQuietPrompt;
      return typeof fn === 'function' ? fn : null;
    } catch {
      return null;
    }
  })();

  return generateQuietPromptFnPromise;
}

function safeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function truncateText(text, maxLen = 140) {
  const s = String(text ?? '');
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(0, maxLen - 1)).trimEnd() + '…';
}

function normalizeForDiff(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

function normalizeForSimilarity(text, maxLen = 3200) {
  const normalized = normalizeForDiff(text).toLowerCase().replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return normalized.slice(0, maxLen);
}

function buildBigramCounts(text) {
  const s = String(text ?? '');
  const map = new Map();
  if (s.length < 2) return map;
  for (let i = 0; i < s.length - 1; i++) {
    const bg = s.slice(i, i + 2);
    map.set(bg, (map.get(bg) ?? 0) + 1);
  }
  return map;
}

function diceCoefficientFromBigrams(aCounts, bCounts) {
  if (!aCounts?.size || !bCounts?.size) return 0;
  let intersection = 0;
  let aTotal = 0;
  let bTotal = 0;
  for (const v of aCounts.values()) aTotal += v;
  for (const v of bCounts.values()) bTotal += v;
  for (const [bg, aCount] of aCounts.entries()) {
    const bCount = bCounts.get(bg);
    if (bCount) intersection += Math.min(aCount, bCount);
  }
  if (aTotal + bTotal === 0) return 0;
  return (2 * intersection) / (aTotal + bTotal);
}

function countMarkerHits(text, markers) {
  const s = String(text ?? '');
  if (!s || !Array.isArray(markers) || markers.length === 0) return 0;
  let hits = 0;
  for (const m of markers) {
    if (!m) continue;
    if (m instanceof RegExp) {
      const match = s.match(new RegExp(m.source, m.flags.includes('g') ? m.flags : `${m.flags}g`));
      hits += Array.isArray(match) ? match.length : 0;
      continue;
    }
    const needle = String(m);
    if (!needle) continue;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = s.match(new RegExp(escaped, 'gi'));
    hits += Array.isArray(match) ? match.length : 0;
  }
  return hits;
}

function buildToneHints(oldText, newText) {
  const strictMarkers = [
    '必须',
    '务必',
    '严禁',
    '禁止',
    '不得',
    '不准',
    '不可',
    '一定要',
    /(?:must|never|do not|don't|required|forbidden)\b/i,
  ];
  const softMarkers = [
    '请',
    '尽量',
    '建议',
    '可以',
    '可选',
    '如果',
    /(?:please|may|might|could|try to|recommend)\b/i,
  ];

  const oldStrict = countMarkerHits(oldText, strictMarkers);
  const newStrict = countMarkerHits(newText, strictMarkers);
  const oldSoft = countMarkerHits(oldText, softMarkers);
  const newSoft = countMarkerHits(newText, softMarkers);

  let hint = '语气变化不明显';
  const strictDelta = newStrict - oldStrict;
  const softDelta = newSoft - oldSoft;
  if (strictDelta >= 2 && softDelta <= 0) hint = '措辞更强硬/更严格';
  if (softDelta >= 2 && strictDelta <= 0) hint = '措辞更温和/更建议';
  if (strictDelta >= 2 && softDelta >= 2) hint = '同时更严格也更“礼貌”（混合变化）';
  if (strictDelta <= -2 && softDelta <= 0) hint = '措辞更放松（减少强制/禁止类表述）';

  return {
    hint,
    strict: { old: oldStrict, new: newStrict },
    soft: { old: oldSoft, new: newSoft },
  };
}

function splitNonEmptyLines(text, maxLines = 200) {
  const lines = normalizeForDiff(text).split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length <= maxLines) return lines;
  return lines.slice(0, maxLines);
}

function summarizeLineDiff(oldText, newText, options = {}) {
  const { maxItems = 3, maxLen = 80 } = options;
  const oldLines = splitNonEmptyLines(oldText);
  const newLines = splitNonEmptyLines(newText);

  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  const added = [];
  const removed = [];
  for (const l of newSet) {
    if (!oldSet.has(l)) added.push(l);
  }
  for (const l of oldSet) {
    if (!newSet.has(l)) removed.push(l);
  }

  const addedShown = added.slice(0, maxItems).map(l => truncateText(l, maxLen));
  const removedShown = removed.slice(0, maxItems).map(l => truncateText(l, maxLen));

  return {
    addedCount: added.length,
    removedCount: removed.length,
    addedShown,
    removedShown,
  };
}

function describeValueForChangelog(value) {
  if (value == null) return 'null';
  const t = typeof value;
  if (t === 'string') {
    const s = String(value);
    const brief = truncateText(s, 80);
    return JSON.stringify(brief) + (s.length > 80 ? ` (len=${s.length})` : '');
  }
  if (t === 'number' || t === 'boolean') return String(value);
  if (Array.isArray(value)) return `[array len=${value.length}]`;
  if (t === 'object') return '{object}';
  return String(value);
}

function deepEqual(a, b, depth = 0) {
  if (a === b) return true;
  if (depth > 4) return false;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i], depth + 1)) return false;
    }
    return true;
  }

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k], depth + 1)) return false;
  }
  return true;
}

function getPromptKey(prompt, index) {
  const id = prompt?.identifier;
  if (typeof id === 'string' && id.trim()) return `id:${id.trim()}`;
  const name = prompt?.name;
  if (typeof name === 'string' && name.trim()) return `name:${name.trim()}`;
  return `idx:${index}`;
}

function getPromptContent(prompt) {
  const content = prompt?.content ?? prompt?.prompt ?? prompt?.text ?? '';
  return typeof content === 'string' ? content : String(content ?? '');
}

function getPromptMetaSnapshot(prompt) {
  const p = prompt && typeof prompt === 'object' ? prompt : {};
  const triggers = Array.isArray(p?.injection_trigger) ? p.injection_trigger.filter(Boolean).slice().sort() : [];
  return {
    role: p?.role ?? 'system',
    system_prompt: Boolean(p?.system_prompt),
    marker: Boolean(p?.marker),
    forbid_overrides: Boolean(p?.forbid_overrides),
    injection_position: p?.injection_position ?? p?.insertion_position ?? p?.position ?? '',
    injection_depth: p?.injection_depth ?? null,
    injection_order: p?.injection_order ?? null,
    injection_trigger: triggers,
  };
}

function buildMetaBrief(prompt) {
  const meta = getPromptMetaSnapshot(prompt);
  const parts = [];
  if (meta.role) parts.push(`role=${meta.role}`);
  if (meta.injection_position) parts.push(`pos=${meta.injection_position}`);
  if (typeof meta.injection_depth === 'number') parts.push(`depth=${meta.injection_depth}`);
  if (meta.system_prompt) parts.push('system_prompt');
  if (meta.marker) parts.push('marker');
  if (meta.forbid_overrides) parts.push('forbid_overrides');
  return parts.join(', ');
}

function buildNewEntryBrief(prompt) {
  const content = getPromptContent(prompt);
  const snippet = truncateText(normalizeForDiff(content).replace(/\n+/g, ' / '), 120);
  const meta = buildMetaBrief(prompt);
  if (meta) return `简述：${JSON.stringify(snippet)}（${meta}）`;
  return `简述：${JSON.stringify(snippet)}`;
}

function buildChangeBrief(oldPrompt, newPrompt) {
  const oldText = getPromptContent(oldPrompt);
  const newText = getPromptContent(newPrompt);
  const oldNorm = normalizeForDiff(oldText);
  const newNorm = normalizeForDiff(newText);
  const lenOld = oldNorm.length;
  const lenNew = newNorm.length;
  const delta = lenNew - lenOld;

  let lengthHint = '长度变化不明显';
  if (lenOld > 0) {
    const ratio = lenNew / Math.max(1, lenOld);
    if (ratio >= 1.18) lengthHint = `更详细（约 +${Math.max(0, delta)} 字符）`;
    else if (ratio <= 0.82) lengthHint = `更精简（约减少 ${Math.abs(delta)} 字符）`;
  } else if (lenNew > 0) {
    lengthHint = `新增内容（len=${lenNew}）`;
  }

  const tone = buildToneHints(oldText, newText);
  const lineDiff = summarizeLineDiff(oldText, newText, { maxItems: 3, maxLen: 90 });

  const addedParts = lineDiff.addedShown.length ? `新增要点：${lineDiff.addedShown.join('；')}` : '';
  const removedParts = lineDiff.removedShown.length ? `删减要点：${lineDiff.removedShown.join('；')}` : '';

  const hints = [lengthHint, tone.hint].filter(Boolean).join('；');
  const parts = [hints, addedParts, removedParts].filter(Boolean).join('；');
  return {
    summary: parts || '有变更',
    tone,
    lineDiff,
    length: { old: lenOld, new: lenNew, delta },
    oldSnippet: truncateText(oldNorm.replace(/\n+/g, ' / '), 160),
    newSnippet: truncateText(newNorm.replace(/\n+/g, ' / '), 160),
  };
}

function buildPromptMap(prompts) {
  const list = Array.isArray(prompts) ? prompts : [];
  const map = new Map();
  list.forEach((p, idx) => {
    map.set(getPromptKey(p, idx), p);
  });
  return map;
}

function listNames(items, max = 16) {
  const list = Array.isArray(items) ? items : [];
  const names = list.map(x => safeText(x?.name ?? '')).filter(Boolean);
  const shown = names.slice(0, max);
  const suffix = names.length > shown.length ? ` …(+${names.length - shown.length})` : '';
  return shown.join('、') + suffix;
}

function formatGitHubCompareToChangelog(compareJson) {
  if (!compareJson || typeof compareJson !== 'object') return '';
  const commits = Array.isArray(compareJson?.commits) ? compareJson.commits : [];
  if (commits.length === 0) return '（无可显示的提交记录）';

  const lines = [];
  for (const c of commits) {
    const sha = String(c?.sha ?? '').slice(0, 7);
    const msg = String(c?.commit?.message ?? '').split('\n')[0].trim();
    const author = String(c?.commit?.author?.name ?? '').trim();
    const suffix = [sha ? `#${sha}` : '', author ? `by ${author}` : ''].filter(Boolean).join(' ');
    lines.push(`- ${msg || '(no message)'}${suffix ? ` (${suffix})` : ''}`);
  }

  return lines.join('\n').trim();
}

function buildReplacementPairs(removedItems, addedItems) {
  const removed = Array.isArray(removedItems) ? removedItems : [];
  const added = Array.isArray(addedItems) ? addedItems : [];
  if (!removed.length || !added.length) return [];

  const removedCandidates = removed
    .map(({ key, prompt }) => {
      const name = safeText(prompt?.name ?? key);
      const nameKey = getNameMatchKey(name);
      const content = getPromptContent(prompt);
      const simText = normalizeForSimilarity(content);
      return {
        key,
        prompt,
        name,
        nameKey,
        meta: getPromptMetaSnapshot(prompt),
        bigrams: buildBigramCounts(simText),
      };
    })
    .filter(x => x.bigrams.size);

  const addedCandidates = added
    .map(({ key, prompt }) => {
      const name = safeText(prompt?.name ?? key);
      const nameKey = getNameMatchKey(name);
      const content = getPromptContent(prompt);
      const simText = normalizeForSimilarity(content);
      return {
        key,
        prompt,
        name,
        nameKey,
        meta: getPromptMetaSnapshot(prompt),
        bigrams: buildBigramCounts(simText),
      };
    })
    .filter(x => x.bigrams.size);

  if (!removedCandidates.length || !addedCandidates.length) return [];

  function metaScore(a, b) {
    let score = 0;
    let total = 0;
    const checks = ['role', 'system_prompt', 'marker', 'forbid_overrides', 'injection_position'];
    for (const k of checks) {
      total++;
      if (a?.[k] === b?.[k]) score++;
    }
    total++;
    const aDepth = typeof a?.injection_depth === 'number' ? a.injection_depth : null;
    const bDepth = typeof b?.injection_depth === 'number' ? b.injection_depth : null;
    if (aDepth == null || bDepth == null) score += 0.5;
    else if (aDepth === bDepth) score += 1;
    else if (Math.abs(aDepth - bDepth) <= 1) score += 0.6;
    return total ? score / total : 0;
  }

  const pairs = [];
  for (const r of removedCandidates) {
    for (const a of addedCandidates) {
      const contentScore = diceCoefficientFromBigrams(r.bigrams, a.bigrams);
      if (contentScore < 0.72) continue;
      const nameScore =
        r.nameKey && a.nameKey ? diceCoefficientFromBigrams(buildBigramCounts(r.nameKey), buildBigramCounts(a.nameKey)) : 0;
      const mScore = metaScore(r.meta, a.meta);
      const score = contentScore * 0.74 + mScore * 0.18 + nameScore * 0.08;
      if (score < 0.78) continue;
      pairs.push({ removedKey: r.key, addedKey: a.key, score });
    }
  }

  pairs.sort((x, y) => y.score - x.score);
  const usedRemoved = new Set();
  const usedAdded = new Set();
  const chosen = [];
  for (const p of pairs) {
    if (usedRemoved.has(p.removedKey) || usedAdded.has(p.addedKey)) continue;
    usedRemoved.add(p.removedKey);
    usedAdded.add(p.addedKey);
    chosen.push(p);
  }

  return chosen;
}

function summarizePresetDiff(oldPreset, newPreset) {
  const oldP = oldPreset && typeof oldPreset === 'object' ? oldPreset : {};
  const newP = newPreset && typeof newPreset === 'object' ? newPreset : {};

  const oldPrompts = Array.isArray(oldP.prompts) ? oldP.prompts : [];
  const newPrompts = Array.isArray(newP.prompts) ? newP.prompts : [];

  const oldMap = buildPromptMap(oldPrompts);
  const newMap = buildPromptMap(newPrompts);

  let added = [];
  let removed = [];
  const replaced = [];
  const modified = [];

  for (const [key, p] of newMap.entries()) {
    if (!oldMap.has(key)) added.push({ key, prompt: p, name: p?.name ?? key });
  }

  for (const [key, p] of oldMap.entries()) {
    if (!newMap.has(key)) removed.push({ key, prompt: p, name: p?.name ?? key });
  }

  const replacementPairs = buildReplacementPairs(removed, added);
  if (replacementPairs.length) {
    const removedByKey = new Map(removed.map(x => [x.key, x]));
    const addedByKey = new Map(added.map(x => [x.key, x]));

    for (const pair of replacementPairs) {
      const oldItem = removedByKey.get(pair.removedKey);
      const newItem = addedByKey.get(pair.addedKey);
      if (!oldItem?.prompt || !newItem?.prompt) continue;
      const change = buildChangeBrief(oldItem.prompt, newItem.prompt);
      replaced.push({
        oldKey: oldItem.key,
        newKey: newItem.key,
        oldName: safeText(oldItem.prompt?.name ?? oldItem.name ?? oldItem.key),
        newName: safeText(newItem.prompt?.name ?? newItem.name ?? newItem.key),
        summary: change.summary,
        details: change,
        score: pair.score,
      });
    }

    const removedMatched = new Set(replacementPairs.map(p => p.removedKey));
    const addedMatched = new Set(replacementPairs.map(p => p.addedKey));
    removed = removed.filter(x => !removedMatched.has(x.key));
    added = added.filter(x => !addedMatched.has(x.key));
  }

  const fieldsToCheck = [
    'name',
    'role',
    'system_prompt',
    'marker',
    'forbid_overrides',
    'enabled',
    'position',
    'insertion_position',
    'injection_position',
    'injection_depth',
    'injection_order',
    'injection_trigger',
  ];

  for (const [key, newPrompt] of newMap.entries()) {
    const oldPrompt = oldMap.get(key);
    if (!oldPrompt) continue;

    const changedFields = [];
    const fieldChanges = [];
    const oldContent = getPromptContent(oldPrompt);
    const newContent = getPromptContent(newPrompt);
    if (oldContent !== newContent) changedFields.push('content');

    for (const field of fieldsToCheck) {
      if (deepEqual(oldPrompt?.[field], newPrompt?.[field])) continue;
      changedFields.push(field);
      fieldChanges.push({
        field,
        oldValue: describeValueForChangelog(oldPrompt?.[field]),
        newValue: describeValueForChangelog(newPrompt?.[field]),
      });
    }

    if (changedFields.length === 0) continue;

    const change = buildChangeBrief(oldPrompt, newPrompt);

    modified.push({
      key,
      name: newPrompt?.name ?? oldPrompt?.name ?? key,
      changedFields: Array.from(new Set(changedFields)),
      fieldChanges,
      summary: change.summary,
      oldContentSnippet: truncateText(oldContent, 160),
      newContentSnippet: truncateText(newContent, 160),
      details: change,
    });
  }

  const ignoredTopKeys = new Set(['prompts', 'prompt_order', 'name', PT_META_FIELD]);
  const topLevelChanges = [];
  const keys = new Set([...Object.keys(oldP), ...Object.keys(newP)]);
  for (const key of keys) {
    if (ignoredTopKeys.has(key)) continue;
    if (deepEqual(oldP[key], newP[key])) continue;
    topLevelChanges.push({
      key,
      oldValue: describeValueForChangelog(oldP[key]),
      newValue: describeValueForChangelog(newP[key]),
    });
  }

  const addedOut = added.map(x => ({
    key: x.key,
    name: x.prompt?.name ?? x.name ?? x.key,
    summary: buildNewEntryBrief(x.prompt),
  }));

  const removedOut = removed.map(x => ({
    key: x.key,
    name: x.prompt?.name ?? x.name ?? x.key,
  }));

  return {
    added: addedOut,
    removed: removedOut,
    replaced,
    modified,
    topLevelChanges,
  };
}

async function generateAiChangelog({ title, facts, responseLength = 650 }) {
  const generateQuietPrompt = await getGenerateQuietPromptFn();
  if (!generateQuietPrompt) {
    throw new Error('未检测到 SillyTavern 的 generateQuietPrompt，无法使用 AI 生成 Changelog');
  }

  const prompt = `
你是一个发布日志（Release Notes）撰写助手。请根据“结构化差异”用中文生成简洁、可读的更新日志（Markdown）。
要求：
- 只基于提供的信息，不要臆测。
- 不要输出 Compare/对比链接或 URL。
- 分段：概览 / 提示词变更（新增、重写、修改、删除）/ 其他设置（如有）。
- “新增”和“重写”必须逐条列出，每条后面必须附带一句“内容简述/修改点摘要”（说明加了什么、删了什么、语气更强/更温和、更精简/更详细等）。
- “重写/修改”要尽量写出前后差异对作用的影响（基于结构化差异里的要点与 old/new 片段）。
- 允许输出更详细一些（约 20-60 行），但避免粘贴整段 JSON 或完整提示词全文。

标题：${String(title ?? '').trim()}

结构化差异：
${String(facts ?? '').trim()}
`.trim();

  return await generateQuietPrompt({
    quietPrompt: prompt,
    quietName: 'Changelog AI',
    responseLength: Math.max(900, Number(responseLength) || 0),
  });
}

function buildFallbackChangelog({ baseLabel, version, previousVersion, diff }) {
  const lines = [];
  lines.push(`## ${baseLabel} v${version}`);
  if (previousVersion) {
    lines.push(`版本：v${previousVersion} → v${version}`);
  } else {
    lines.push('首次发布');
  }
  lines.push('');

  if (diff?.added?.length) {
    lines.push(`### 新增提示词（${diff.added.length}）`);
    for (const a of diff.added) {
      lines.push(`- ${safeText(a?.name ?? '')}${a?.summary ? `：${safeText(a.summary)}` : ''}`);
    }
    lines.push('');
  }

  if (diff?.replaced?.length) {
    lines.push(`### 重写/替换提示词（${diff.replaced.length}）`);
    for (const r of diff.replaced) {
      const left = safeText(r?.oldName ?? '');
      const right = safeText(r?.newName ?? '');
      const namePart = left && right ? `${left} → ${right}` : safeText(right || left || '');
      lines.push(`- ${namePart}${r?.summary ? `：${safeText(r.summary)}` : ''}`);
    }
    lines.push('');
  }

  if (diff?.modified?.length) {
    lines.push(`### 修改提示词（${diff.modified.length}）`);
    for (const m of diff.modified) {
      const name = safeText(m?.name ?? '');
      const fields = Array.isArray(m?.changedFields) ? m.changedFields.join(', ') : '';
      const suffix = fields ? `（${fields}）` : '';
      lines.push(`- ${name}${suffix}${m?.summary ? `：${safeText(m.summary)}` : ''}`);
      if (m?.details?.lineDiff?.addedShown?.length) {
        lines.push(`  - 新增要点：${m.details.lineDiff.addedShown.join('；')}`);
      }
      if (m?.details?.lineDiff?.removedShown?.length) {
        lines.push(`  - 删减要点：${m.details.lineDiff.removedShown.join('；')}`);
      }
    }
    lines.push('');
  }

  if (diff?.removed?.length) {
    lines.push(`### 删除提示词（${diff.removed.length}）`);
    for (const d of diff.removed) {
      lines.push(`- ${safeText(d?.name ?? '')}`);
    }
    lines.push('');
  }

  if (diff?.topLevelChanges?.length) {
    lines.push(`### 其他设置变更（${diff.topLevelChanges.length}）`);
    const shown = diff.topLevelChanges.slice(0, 10);
    for (const c of shown) {
      lines.push(`- ${c.key}: ${c.oldValue} → ${c.newValue}`);
    }
    if (diff.topLevelChanges.length > shown.length) {
      lines.push(`- ……（剩余 ${diff.topLevelChanges.length - shown.length} 项已省略）`);
    }
  }

  return lines.join('\n').trim();
}

function buildChangelogFacts({ baseLabel, filePath, version, previousVersion, tagName, previousTagName, diff }) {
  const lines = [];
  lines.push(`- 预设：${baseLabel}`);
  lines.push(`- 文件：${filePath}`);
  lines.push(`- 版本：${previousVersion ? `v${previousVersion}` : '(首次发布)'} → v${version}`);
  lines.push(`- Tag：${previousTagName || '(无)'} → ${tagName}`);
  lines.push('');

  lines.push('提示词变更：');
  lines.push(`- 新增：${diff.added.length}`);
  lines.push(`- 重写/替换：${diff.replaced.length}`);
  lines.push(`- 修改：${diff.modified.length}`);
  lines.push(`- 删除：${diff.removed.length}`);
  lines.push('');

  if (diff.added.length) {
    lines.push(`新增（${diff.added.length}）：`);
    for (const a of diff.added) {
      lines.push(`- ${safeText(a?.name)}：${safeText(a?.summary ?? '')}`);
    }
    lines.push('');
  }

  if (diff.replaced.length) {
    lines.push(`重写/替换（${diff.replaced.length}）：`);
    const shown = diff.replaced.slice(0, 12);
    for (const r of shown) {
      const left = safeText(r?.oldName ?? '');
      const right = safeText(r?.newName ?? '');
      const namePart = left && right ? `${left} → ${right}` : safeText(right || left || '');
      lines.push(`- ${namePart}：${safeText(r?.summary ?? '')}`);
      if (r?.details?.lineDiff?.addedShown?.length) {
        lines.push(`  - 新增要点：${r.details.lineDiff.addedShown.join('；')}`);
      }
      if (r?.details?.lineDiff?.removedShown?.length) {
        lines.push(`  - 删减要点：${r.details.lineDiff.removedShown.join('；')}`);
      }
      if (r?.details?.tone) {
        lines.push(
          `  - 语气词频：强硬 ${r.details.tone.strict.old}→${r.details.tone.strict.new}，温和 ${r.details.tone.soft.old}→${r.details.tone.soft.new}`,
        );
      }
    }
    if (diff.replaced.length > shown.length) {
      lines.push(`- ……（剩余 ${diff.replaced.length - shown.length} 项已省略）`);
    }
    lines.push('');
  }

  if (diff.modified.length) {
    lines.push(`- 修改(${diff.modified.length})：`);
    const shown = diff.modified.slice(0, 12);
    for (const m of shown) {
      const name = safeText(m.name);
      const fields = Array.isArray(m.changedFields) ? m.changedFields.join(', ') : '';
      lines.push(`  - ${name}${fields ? `（${fields}）` : ''}：${safeText(m?.summary ?? '')}`);
      if (m?.details?.lineDiff?.addedShown?.length) {
        lines.push(`    - 新增要点：${m.details.lineDiff.addedShown.join('；')}`);
      }
      if (m?.details?.lineDiff?.removedShown?.length) {
        lines.push(`    - 删减要点：${m.details.lineDiff.removedShown.join('；')}`);
      }
      if (m?.details?.tone) {
        lines.push(
          `    - 语气词频：强硬 ${m.details.tone.strict.old}→${m.details.tone.strict.new}，温和 ${m.details.tone.soft.old}→${m.details.tone.soft.new}`,
        );
      }
      if (m.changedFields?.includes?.('content')) {
        lines.push(`    - old 片段: ${JSON.stringify(m.details.oldSnippet)}`);
        lines.push(`    - new 片段: ${JSON.stringify(m.details.newSnippet)}`);
      }
    }
    if (diff.modified.length > shown.length) {
      lines.push(`  - ……（剩余 ${diff.modified.length - shown.length} 项已省略）`);
    }
  } else {
    lines.push('- 修改(0)：无');
  }

  lines.push('');
  if (diff.removed.length) {
    lines.push(`删除（${diff.removed.length}）：`);
    const shownRemoved = diff.removed.slice(0, 18);
    for (const d of shownRemoved) {
      lines.push(`- ${safeText(d?.name ?? '')}`);
    }
    if (diff.removed.length > shownRemoved.length) {
      lines.push(`- ……（剩余 ${diff.removed.length - shownRemoved.length} 项已省略）`);
    }
  }

  if (diff.topLevelChanges.length) {
    lines.push('');
    lines.push(`其他设置（${diff.topLevelChanges.length} 项，展示前 10 项）：`);
    const shown = diff.topLevelChanges.slice(0, 10);
    for (const c of shown) {
      lines.push(`- ${c.key}: ${c.oldValue} → ${c.newValue}`);
    }
    if (diff.topLevelChanges.length > shown.length) {
      lines.push(`- ……（剩余 ${diff.topLevelChanges.length - shown.length} 项已省略）`);
    }
  }

  return lines.join('\n').trim();
}

async function buildPublishChangelogContext({ currentName, info, inputs, repo, token, version, tagName }) {
  const filePath = String(inputs.filePath ?? '').trim();
  const baseLabel = info.base || info.raw || currentName;
  const tagTemplate = String(inputs.tagTemplate || inputs.refTemplate || 'v{version}').trim();

  const tags = await fetchGitHubTags({ ...repo, token });
  const previous = pickLatestTagBefore(tags, { tagTemplate, beforeVersion: version });
  const previousTagName = previous?.name ? String(previous.name) : null;
  const previousVersion = previous?.version ? String(previous.version) : null;

  const apiInfo = getCurrentApiInfo();
  if (!apiInfo) throw new Error('无法获取 API 信息');
  const presetData = getPresetDataFromManager(apiInfo, currentName);
  const currentPreset = stripPresetTransferMetaForPublish(presetData);

  let previousPreset = {};
  if (previousTagName) {
    const { json } = await fetchPresetJsonFromGitHubAtRef(
      { repoUrl: inputs.repoUrl, filePath },
      { ref: previousTagName, token },
    );
    previousPreset = stripPresetTransferMetaForPublish(json);
  }

  const diff = summarizePresetDiff(previousPreset, currentPreset);

  return {
    filePath,
    baseLabel,
    tagTemplate,
    previousTagName,
    previousVersion,
    currentPreset,
    previousPreset,
    diff,
  };
}

function getSettingsHost() {
  const $ = getJQuery();
  const left = $('#extensions_settings');
  if (left.length) return left;
  const right = $('#extensions_settings2');
  return right;
}

function getCurrentPresetName() {
  try {
    return PT.API.getLoadedPresetName?.() ?? null;
  } catch {
    return null;
  }
}

function initPresetChangeAutoRefresh() {
  const parentWindow = window.parent && window.parent !== window ? window.parent : window;
  if (parentWindow.__ptTransferToolsPresetRefreshBound) return;
  parentWindow.__ptTransferToolsPresetRefreshBound = true;

  const refresh = () => {
    try {
      // Give the host a tick to finish switching before reading getLoadedPresetName().
      setTimeout(() => syncPresetAutomationUi(), 0);
    } catch {
      /* ignore */
    }
  };

  try {
    PT.API.eventOn?.('preset_changed', refresh);
    PT.API.eventOn?.('oai_preset_changed_after', refresh);
  } catch {
    /* ignore */
  }
}

function normalizeTransferToolsTabKey(value) {
  const key = String(value ?? '').trim();
  return TRANSFER_TOOLS_TAB_KEYS.includes(key) ? key : 'features';
}

function getSavedTransferToolsTabKey() {
  try {
    return normalizeTransferToolsTabKey(localStorage.getItem(TRANSFER_TOOLS_TAB_STORAGE_KEY));
  } catch {
    return 'features';
  }
}

function setSavedTransferToolsTabKey(value) {
  try {
    localStorage.setItem(TRANSFER_TOOLS_TAB_STORAGE_KEY, normalizeTransferToolsTabKey(value));
  } catch {
    /* ignore */
  }
}

function applyTransferToolsTabKey(tabKey, { persist = true } = {}) {
  const $ = getJQuery();
  const $root = $(`#${CONTAINER_ID}`);
  if (!$root.length) return;

  const nextKey = normalizeTransferToolsTabKey(tabKey);
  $root.attr('data-pt-transfer-tools-tab', nextKey);

  $root.find('.pt-transfer-tools-tab').each(function () {
    const $tab = $(this);
    const key = normalizeTransferToolsTabKey($tab.data('ptTab'));
    const isActive = key === nextKey;
    $tab.toggleClass('is-active', isActive);
    $tab.attr('aria-selected', isActive ? 'true' : 'false');
    $tab.attr('tabindex', isActive ? '0' : '-1');
  });

  $root.find('.pt-transfer-tools-panel').each(function () {
    const $panel = $(this);
    const key = normalizeTransferToolsTabKey($panel.data('ptTabPanel'));
    const isActive = key === nextKey;
    $panel.toggleClass('is-hidden', !isActive);
    $panel.attr('aria-hidden', isActive ? 'false' : 'true');
  });

  if (persist) setSavedTransferToolsTabKey(nextKey);
}

function renderPanel() {
  const themeAccentColor = getCssVar('--SmartThemeEmColor', 'currentColor');
  return `
    <div id="${CONTAINER_ID}" class="extension_container">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>转移工具</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          <div class="flex-container flexFlowColumn flexGap5">
            <div class="pt-transfer-tools-tabbar" role="tablist" aria-label="转移工具标签页">
              <button
                id="pt-transfer-tools-tab-features"
                type="button"
                class="pt-transfer-tools-tab menu_button"
                role="tab"
                aria-controls="pt-transfer-tools-panel-features"
                data-pt-tab="features"
              >功能</button>
              <button
                id="pt-transfer-tools-tab-settings"
                type="button"
                class="pt-transfer-tools-tab menu_button"
                role="tab"
                aria-controls="pt-transfer-tools-panel-settings"
                data-pt-tab="settings"
              >预设更新</button>
              <button
                id="pt-transfer-tools-tab-snapshots"
                type="button"
                class="pt-transfer-tools-tab menu_button"
                role="tab"
                aria-controls="pt-transfer-tools-panel-snapshots"
                data-pt-tab="snapshots"
              >快照管理</button>
              <button
                id="pt-transfer-tools-tab-io"
                type="button"
                class="pt-transfer-tools-tab menu_button"
                role="tab"
                aria-controls="pt-transfer-tools-panel-io"
                data-pt-tab="io"
              >导出导入</button>
            </div>

            <div
              id="pt-transfer-tools-panel-features"
              class="pt-transfer-tools-panel"
              role="tabpanel"
              aria-labelledby="pt-transfer-tools-tab-features"
              data-pt-tab-panel="features"
            >
              <div class="pt-transfer-tools-card flex-container flexFlowColumn flexGap5">
                <div class="pt-transfer-tools-card-title">功能开关</div>
                <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-entry-states-panel">
                  <input id="pt-enable-entry-states-panel" type="checkbox" style="accent-color: ${themeAccentColor};" />
                  <small>条目状态</small>
                </label>
                <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-regex-binding">
                  <input id="pt-enable-regex-binding" type="checkbox" style="accent-color: ${themeAccentColor};" />
                  <small>预设正则</small>
                </label>
                <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-regex-script-grouping">
                  <input id="pt-enable-regex-script-grouping" type="checkbox" style="accent-color: ${themeAccentColor};" />
                  <small>正则分组</small>
                </label>
                <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-entry-grouping">
                  <input id="pt-enable-entry-grouping" type="checkbox" style="accent-color: ${themeAccentColor};" />
                  <small>条目分组</small>
                </label>
                <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-worldbook-grouping">
                  <input id="pt-enable-worldbook-grouping" type="checkbox" style="accent-color: ${themeAccentColor};" />
                  <small>世界书分组查看</small>
                </label>
                <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-worldbook-entry-grouping">
                  <input id="pt-enable-worldbook-entry-grouping" type="checkbox" style="accent-color: ${themeAccentColor};" />
                  <small>世界书条目分组</small>
                </label>
                <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-worldbook-common">
                  <input id="pt-enable-worldbook-common" type="checkbox" style="accent-color: ${themeAccentColor};" />
                  <small>世界书常用</small>
                </label>
                <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-theme-grouping">
                  <input id="pt-enable-theme-grouping" type="checkbox" style="accent-color: ${themeAccentColor};" />
                  <small>UI主题分组</small>
                </label>
              </div>
            </div>

            <div
              id="pt-transfer-tools-panel-settings"
              class="pt-transfer-tools-panel is-hidden"
              role="tabpanel"
              aria-labelledby="pt-transfer-tools-tab-settings"
              data-pt-tab-panel="settings"
            >
              <div class="flex-container flexFlowColumn flexGap5">
                <div class="pt-transfer-tools-card flex-container flexFlowColumn flexGap5">
                  <div class="pt-transfer-tools-card-title">设置更新</div>
                  <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-preset-auto-migrate-import">
                    <input id="pt-enable-preset-auto-migrate-import" type="checkbox" style="accent-color: ${themeAccentColor};" />
                    <small>导入新版本后自动迁移缝合</small>
                  </label>
                  <label class="checkbox_label alignItemsCenter flexGap5" for="pt-enable-preset-git-auto-update">
                    <input id="pt-enable-preset-git-auto-update" type="checkbox" style="accent-color: ${themeAccentColor};" />
                    <small>Git 自动更新预设（需配置 Git 源）</small>
                  </label>
                </div>

                <div class="pt-transfer-tools-card flex-container flexFlowColumn flexGap5">
                  <div class="inline-drawer" style="margin-top: 0;">
                    <div class="inline-drawer-toggle inline-drawer-header">
                      <b>用户使用</b>
                      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content">
                      <div class="flex-container flexFlowColumn flexGap5 wide100p" style="padding: 6px 0;">
                        <small id="pt-git-base-hint" style="opacity: 0.85;"></small>
                        <input id="pt-git-repo-url" class="text_pole" type="text" placeholder="GitHub 仓库 URL（例：https://github.com/owner/repo）" />
                        <input id="pt-git-file-path" class="text_pole" type="text" placeholder="仓库内 JSON 路径（例：presets/preset.json）" />
                        <input id="pt-git-ref-template" class="text_pole" type="text" placeholder="Ref 模板（默认：v{version}）" />
                        <input id="pt-git-tag-template" class="text_pole" type="text" placeholder="Tag 模板/前缀（例：nuxus-v{version}；用于自动更新过滤 tags）" />
                        <div class="flex-container flexGap5 alignItemsCenter wide100p" style="flex-wrap: wrap;">
                          <button id="pt-git-save-source" class="menu_button" style="white-space: nowrap;">保存 Git 源</button>
                          <button id="pt-git-clear-source" class="menu_button" style="white-space: nowrap;">清除 Git 源</button>
                        </div>
                        <div class="flex-container flexGap5 alignItemsCenter wide100p" style="flex-wrap: wrap;">
                          <input id="pt-target-version" class="text_pole" type="text" placeholder="目标版本号（例：6.4）" style="flex: 1; min-width: 160px;" />
                        </div>
                        <div class="flex-container flexGap5 alignItemsCenter wide100p" style="flex-wrap: wrap;">
                          <button id="pt-switch-version" class="menu_button" style="white-space: nowrap;">切换版本</button>
                          <button id="pt-view-version-changelog" class="menu_button" style="white-space: nowrap;">查看更新日志</button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="inline-drawer" style="margin-top: 4px;">
                    <div class="inline-drawer-toggle inline-drawer-header">
                      <b>作者发布</b>
                      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content">
                      <div class="flex-container flexFlowColumn flexGap5 wide100p" style="padding: 6px 0;">
                        <input id="pt-publish-branch" class="text_pole" type="text" placeholder="发布分支（默认：main）" />
                        <input id="pt-publish-version" class="text_pole" type="text" placeholder="发布版本号（例：1.2.0）" />
                        <input id="pt-publish-token" class="text_pole" type="password" placeholder="GitHub Token（需要 repo/contents 权限，仅本地使用）" />
                        <textarea id="pt-publish-changelog" class="text_pole" placeholder="Changelog / Release Notes（可留空点击生成）" style="min-height: 120px; resize: vertical; width: 100%;"></textarea>
                        <div class="flex-container flexGap5 alignItemsCenter wide100p" style="flex-wrap: wrap;">
                          <button id="pt-publish-generate-changelog" class="menu_button" style="white-space: nowrap;">生成 Changelog</button>
                          <button id="pt-publish-upload" class="menu_button" style="white-space: nowrap;">上传并发布</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div
              id="pt-transfer-tools-panel-snapshots"
              class="pt-transfer-tools-panel is-hidden"
              role="tabpanel"
              aria-labelledby="pt-transfer-tools-tab-snapshots"
              data-pt-tab-panel="snapshots"
            >
              <!-- 快照管理面板内容将在这里动态插入 -->
            </div>

            <div
              id="pt-transfer-tools-panel-io"
              class="pt-transfer-tools-panel is-hidden"
              role="tabpanel"
              aria-labelledby="pt-transfer-tools-tab-io"
              data-pt-tab-panel="io"
            >
              <div class="pt-transfer-tools-card flex-container flexFlowColumn flexGap5">
                <div class="pt-transfer-tools-card-title">导出导入</div>
                <div class="flex-container flexGap5 alignItemsCenter wide100p" style="flex-wrap: wrap;">
                  <button id="pt-export-preset-bundle" class="menu_button" style="white-space: nowrap;">导出预设包</button>
                  <button id="pt-import-preset-bundle" class="menu_button" style="white-space: nowrap;">导入预设包</button>
                  <input type="file" id="pt-import-preset-bundle-file" accept=".json" style="display: none;">
                </div>
                <label class="checkbox_label alignItemsCenter flexGap5" for="pt-export-global-worldbooks">
                  <input id="pt-export-global-worldbooks" type="checkbox" style="accent-color: ${themeAccentColor};" />
                  <small>同时导出全局世界书</small>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function syncUiFromFlags(flags) {
  const $ = getJQuery();
  $('#pt-enable-entry-states-panel').prop('checked', !!flags.entryStatesPanelEnabled);
  $('#pt-enable-regex-binding').prop('checked', !!flags.regexBindingEnabled);
  $('#pt-enable-regex-script-grouping').prop('checked', !!flags.regexScriptGroupingEnabled);
  $('#pt-enable-entry-grouping').prop('checked', !!flags.entryGroupingEnabled);
  $('#pt-enable-worldbook-grouping').prop('checked', !!flags.worldbookGroupingEnabled);
  $('#pt-enable-worldbook-entry-grouping').prop('checked', !!flags.worldbookEntryGroupingEnabled);
  $('#pt-enable-worldbook-common').prop('checked', !!flags.worldbookCommonEnabled);
  $('#pt-enable-theme-grouping').prop('checked', !!flags.themeGroupingEnabled);
}

function getSuggestedGitTemplates(info) {
  const baseKey = String(info?.normalizedBase ?? '').trim();
  const prefix = baseKey ? `${baseKey}-v` : 'v';
  const template = `${prefix}{version}`;
  return { refTemplate: template, tagTemplate: template };
}

function readGitSourceInputs() {
  const $ = getJQuery();
  return {
    repoUrl: ($('#pt-git-repo-url').val() || '').toString().trim(),
    filePath: ($('#pt-git-file-path').val() || '').toString().trim(),
    refTemplate: ($('#pt-git-ref-template').val() || '').toString().trim(),
    tagTemplate: ($('#pt-git-tag-template').val() || '').toString().trim(),
  };
}

function writeGitSourceInputs(values) {
  const $ = getJQuery();
  $('#pt-git-repo-url').val(values?.repoUrl ?? '');
  $('#pt-git-file-path').val(values?.filePath ?? '');
  $('#pt-git-ref-template').val(values?.refTemplate ?? '');
  $('#pt-git-tag-template').val(values?.tagTemplate ?? '');
}

function updateDraftFromInputs() {
  if (!currentGitBaseKey) return;
  gitSourceDraftByBase[currentGitBaseKey] = { ...readGitSourceInputs() };
}

function syncPresetAutomationUi() {
  const $ = getJQuery();
  const settings = getPresetAutomationSettings();

  $('#pt-enable-preset-auto-migrate-import').prop('checked', !!settings.presetAutoMigrateOnImportEnabled);
  $('#pt-enable-preset-git-auto-update').prop('checked', !!settings.presetGitAutoUpdateEnabled);

  const currentName = getCurrentPresetName();
  if (!currentName) {
    currentGitBaseKey = '';
    $('#pt-git-base-hint').text('当前预设：未选择');
    $('#pt-git-repo-url, #pt-git-file-path, #pt-git-ref-template, #pt-git-tag-template, #pt-git-save-source, #pt-git-clear-source, #pt-switch-version, #pt-view-version-changelog')
      .prop('disabled', true);
    $('#pt-publish-branch, #pt-publish-version, #pt-publish-token, #pt-publish-changelog, #pt-publish-generate-changelog, #pt-publish-upload')
      .prop('disabled', true);
    return;
  }

  const info = extractPresetVersionInfo(currentName);
  const baseKey = info?.normalizedBase || '';
  currentGitBaseKey = baseKey;
  $('#pt-git-base-hint').text(baseKey ? `当前预设：${info.base || currentName}` : `当前预设：${currentName}`);

  const disabled = !baseKey;
  $('#pt-git-repo-url, #pt-git-file-path, #pt-git-ref-template, #pt-git-tag-template, #pt-git-save-source, #pt-git-clear-source, #pt-switch-version, #pt-view-version-changelog')
    .prop('disabled', disabled);
  $('#pt-publish-branch, #pt-publish-version, #pt-publish-token, #pt-publish-changelog, #pt-publish-generate-changelog, #pt-publish-upload')
    .prop('disabled', disabled);

  const source = baseKey ? getPresetGitSource(baseKey) : null;
  const draft = baseKey ? gitSourceDraftByBase[baseKey] : null;
  const suggested = getSuggestedGitTemplates(info);

  let gitValues = null;
  if (draft) {
    gitValues = {
      repoUrl: draft.repoUrl ?? '',
      filePath: draft.filePath ?? '',
      refTemplate: draft.refTemplate ?? suggested.refTemplate,
      tagTemplate: draft.tagTemplate ?? suggested.tagTemplate,
    };
  } else if (source) {
    gitValues = {
      repoUrl: source.repoUrl ?? '',
      filePath: source.filePath ?? '',
      refTemplate: source.refTemplate ?? 'v{version}',
      tagTemplate: source.tagTemplate ?? '',
    };
  } else {
    // No config saved yet: prefill templates based on preset base name.
    gitValues = {
      repoUrl: '',
      filePath: '',
      refTemplate: suggested.refTemplate,
      tagTemplate: suggested.tagTemplate,
    };
  }

  writeGitSourceInputs(gitValues);

  // Best-effort: prefill publish fields, but never overwrite user input.
  const currentBranch = ($('#pt-publish-branch').val() || '').toString().trim();
  if (!currentBranch) $('#pt-publish-branch').val('main');

  const currentPublishVersion = ($('#pt-publish-version').val() || '').toString().trim();
  if (!currentPublishVersion && info?.version) $('#pt-publish-version').val(normalizeVersion(info.version));
}

function bindEvents() {
  const $ = getJQuery();

  const $root = $(`#${CONTAINER_ID}`);
  if ($root.length) {
    $root
      .off('click.pt-transfer-tools-tabs')
      .on('click.pt-transfer-tools-tabs', '.pt-transfer-tools-tab', function (e) {
        e.preventDefault();
        applyTransferToolsTabKey($(this).data('ptTab'), { persist: true });
      });

    applyTransferToolsTabKey(getSavedTransferToolsTabKey(), { persist: false });
  }

  $('#pt-enable-entry-states-panel')
    .off('input.pt')
    .on('input.pt', function () {
      setEntryStatesPanelEnabled($(this).prop('checked'));
      applyTransferToolFeatureToggles();
    });

  $('#pt-enable-entry-grouping')
    .off('input.pt')
    .on('input.pt', function () {
      setEntryGroupingEnabled($(this).prop('checked'));
      applyTransferToolFeatureToggles();
    });

  $('#pt-enable-worldbook-grouping')
    .off('input.pt')
    .on('input.pt', function () {
      setWorldbookGroupingEnabled($(this).prop('checked'));
      applyTransferToolFeatureToggles();
    });

  $('#pt-enable-worldbook-entry-grouping')
    .off('input.pt')
    .on('input.pt', function () {
      setWorldbookEntryGroupingEnabled($(this).prop('checked'));
      applyTransferToolFeatureToggles();
    });

  $('#pt-enable-worldbook-common')
    .off('input.pt')
    .on('input.pt', function () {
      setWorldbookCommonEnabled($(this).prop('checked'));
      applyTransferToolFeatureToggles();
    });

  $('#pt-enable-theme-grouping')
    .off('input.pt')
    .on('input.pt', function () {
      setThemeGroupingEnabled($(this).prop('checked'));
      applyTransferToolFeatureToggles();
    });

  $('#pt-enable-regex-binding')
    .off('input.pt')
    .on('input.pt', async function () {
      await setRegexBindingFeatureEnabled($(this).prop('checked'));
      applyTransferToolFeatureToggles();
    });

  $('#pt-enable-regex-script-grouping')
    .off('input.pt')
    .on('input.pt', function () {
      setRegexScriptGroupingEnabled($(this).prop('checked'));
      applyTransferToolFeatureToggles();
    });

  $('#pt-enable-preset-auto-migrate-import')
    .off('input.pt')
    .on('input.pt', function () {
      setPresetAutoMigrateOnImportEnabled($(this).prop('checked'));
    });

  $('#pt-enable-preset-git-auto-update')
    .off('input.pt')
    .on('input.pt', function () {
      setPresetGitAutoUpdateEnabled($(this).prop('checked'));
    });

  $('#pt-git-repo-url, #pt-git-file-path, #pt-git-ref-template, #pt-git-tag-template')
    .off('input.pt')
    .on('input.pt', function () {
      updateDraftFromInputs();
    });

  $('#pt-git-save-source')
    .off('click.pt')
    .on('click.pt', function () {
      try {
        const currentName = getCurrentPresetName();
        if (!currentName) throw new Error('请先选择一个预设');
        const info = extractPresetVersionInfo(currentName);
        if (!info?.normalizedBase) throw new Error('无法解析当前预设版本信息');

        const repoUrl = ($('#pt-git-repo-url').val() || '').toString().trim();
        const filePath = ($('#pt-git-file-path').val() || '').toString().trim();
        const refTemplate = ($('#pt-git-ref-template').val() || '').toString().trim() || 'v{version}';
        const tagTemplate = ($('#pt-git-tag-template').val() || '').toString().trim();

        setPresetGitSource(info.normalizedBase, { repoUrl, filePath, tagTemplate, refTemplate });
        delete gitSourceDraftByBase[info.normalizedBase];
        if (window.toastr) toastr.success('Git 源已保存（按预设基础名）');
        syncPresetAutomationUi();
      } catch (e) {
        console.error('保存 Git 源失败', e);
        if (window.toastr) toastr.error('保存失败: ' + (e?.message ?? e));
      }
    });

  $('#pt-git-clear-source')
    .off('click.pt')
    .on('click.pt', function () {
      try {
        const currentName = getCurrentPresetName();
        if (!currentName) throw new Error('请先选择一个预设');
        const info = extractPresetVersionInfo(currentName);
        if (!info?.normalizedBase) throw new Error('无法解析当前预设版本信息');

        const ok = removePresetGitSource(info.normalizedBase);
        delete gitSourceDraftByBase[info.normalizedBase];
        if (window.toastr) toastr.success(ok ? 'Git 源已清除' : '当前预设未配置 Git 源');
        syncPresetAutomationUi();
      } catch (e) {
        console.error('清除 Git 源失败', e);
        if (window.toastr) toastr.error('清除失败: ' + (e?.message ?? e));
      }
    });

  $('#pt-publish-generate-changelog')
    .off('click.pt')
    .on('click.pt', async function () {
      const btn = $(this);
      try {
        const currentName = getCurrentPresetName();
        if (!currentName) throw new Error('请先选择一个预设');

        const info = extractPresetVersionInfo(currentName);
        if (!info?.normalizedBase) throw new Error('无法解析当前预设版本信息');

        const inputs = readGitSourceInputs();
        const repo = parseGitHubRepo(inputs.repoUrl);
        if (!repo) throw new Error('无效的 GitHub 仓库 URL');

        const filePath = String(inputs.filePath ?? '').trim();
        if (!filePath) throw new Error('请填写仓库内 JSON 路径');

        const token = ($('#pt-publish-token').val() || '').toString().trim();
        if (!token) throw new Error('请填写 GitHub Token');

        const rawVersion = ($('#pt-publish-version').val() || '').toString().trim() || String(info.version ?? '').trim();
        const version = normalizeVersion(rawVersion);
        if (!version) throw new Error('请填写发布版本号');

        const tagTemplate = String(inputs.tagTemplate || inputs.refTemplate || 'v{version}').trim();
        const tagName = resolveTagNameFromTemplate(tagTemplate, version);
        if (!tagName) throw new Error('无法根据 Tag 模板生成 tag 名称');

        btn.prop('disabled', true);

        const ctx = await buildPublishChangelogContext({ currentName, info, inputs, repo, token, version, tagName });

        const title = `${ctx.baseLabel} v${version}`;
        const facts = buildChangelogFacts({
          baseLabel: ctx.baseLabel,
          filePath: ctx.filePath,
          version,
          previousVersion: ctx.previousVersion,
          tagName,
          previousTagName: ctx.previousTagName,
          diff: ctx.diff,
        });

        let generated = '';
        try {
          generated = await generateAiChangelog({ title, facts });
        } catch (error) {
          console.warn('AI 生成 Changelog 失败，使用回退模板:', error);
          generated = buildFallbackChangelog({
            baseLabel: ctx.baseLabel,
            version,
            previousVersion: ctx.previousVersion,
            diff: ctx.diff,
          });
        }

        const text = String(generated ?? '').trim();
        if (!text) throw new Error('生成结果为空');
        $('#pt-publish-changelog').val(text);
        if (window.toastr) toastr.success('已生成 Changelog');
      } catch (e) {
        console.error('生成 Changelog 失败', e);
        if (window.toastr) toastr.error('生成失败: ' + (e?.message ?? e));
      } finally {
        btn.prop('disabled', false);
      }
    });

  $('#pt-publish-upload')
    .off('click.pt')
    .on('click.pt', async function () {
      const btn = $(this);
      try {
        const currentName = getCurrentPresetName();
        if (!currentName) throw new Error('请先选择一个预设');

        const info = extractPresetVersionInfo(currentName);
        if (!info?.normalizedBase) throw new Error('无法解析当前预设版本信息');

        const inputs = readGitSourceInputs();
        const repo = parseGitHubRepo(inputs.repoUrl);
        if (!repo) throw new Error('无效的 GitHub 仓库 URL');

        const filePath = String(inputs.filePath ?? '').trim();
        if (!filePath) throw new Error('请填写仓库内 JSON 路径');

        const token = ($('#pt-publish-token').val() || '').toString().trim();
        if (!token) throw new Error('请填写 GitHub Token');

        const branch = ($('#pt-publish-branch').val() || '').toString().trim() || 'main';

        const rawVersion = ($('#pt-publish-version').val() || '').toString().trim() || String(info.version ?? '').trim();
        const version = normalizeVersion(rawVersion);
        if (!version) throw new Error('请填写发布版本号');

        const tagTemplate = String(inputs.tagTemplate || inputs.refTemplate || 'v{version}').trim();
        const tagName = resolveTagNameFromTemplate(tagTemplate, version);
        if (!tagName) throw new Error('无法根据 Tag 模板生成 tag 名称');

        btn.prop('disabled', true);

        const ctx = await buildPublishChangelogContext({ currentName, info, inputs, repo, token, version, tagName });

        const message = `Preset: ${ctx.baseLabel} v${version}`;

        const contentText = JSON.stringify(ctx.currentPreset, null, 2);
        const put = await upsertGitHubFile({
          owner: repo.owner,
          repo: repo.repo,
          token,
          branch,
          filePath,
          contentText,
          message,
        });

        const commitSha = String(put?.commit?.sha ?? '').trim();
        if (!commitSha) throw new Error('上传成功但未返回 commit sha，无法打 tag');

        await createGitHubTagRef({ owner: repo.owner, repo: repo.repo, token, tagName, sha: commitSha });

        let releaseNotes = ($('#pt-publish-changelog').val() || '').toString().trim();
        if (!releaseNotes) {
          const title = `${ctx.baseLabel} v${version}`;
          const facts = buildChangelogFacts({
            baseLabel: ctx.baseLabel,
            filePath: ctx.filePath,
            version,
            previousVersion: ctx.previousVersion,
            tagName,
            previousTagName: ctx.previousTagName,
            diff: ctx.diff,
          });

          try {
            releaseNotes = await generateAiChangelog({ title, facts });
          } catch (error) {
            console.warn('AI 生成 Changelog 失败，使用回退模板:', error);
            releaseNotes = buildFallbackChangelog({
              baseLabel: ctx.baseLabel,
              version,
              previousVersion: ctx.previousVersion,
              diff: ctx.diff,
            });
          }

          releaseNotes = String(releaseNotes ?? '').trim();
          if (releaseNotes) $('#pt-publish-changelog').val(releaseNotes);
        }

        const release = await createGitHubRelease({
          owner: repo.owner,
          repo: repo.repo,
          token,
          tagName,
          name: message,
          bodyText: releaseNotes,
          targetCommitish: branch,
        });

        const url = String(release?.html_url ?? '').trim();
        if (window.toastr) {
          toastr.success(url ? `发布成功：${url}` : `发布成功：${tagName}`);
        }
      } catch (e) {
        console.error('上传并发布失败', e);
        if (window.toastr) toastr.error('发布失败: ' + (e?.message ?? e));
      } finally {
        btn.prop('disabled', false);
      }
    });

  $('#pt-switch-version')
    .off('click.pt')
    .on('click.pt', async function () {
      try {
        const version = ($('#pt-target-version').val() || '').toString().trim();
        if (!version) throw new Error('请输入目标版本号');
        $(this).prop('disabled', true);
        await switchPresetToVersion(version);
        syncPresetAutomationUi();
      } catch (e) {
        console.error('切换版本失败', e);
        if (window.toastr) toastr.error('切换失败: ' + (e?.message ?? e));
      } finally {
        $(this).prop('disabled', false);
      }
    });

  $('#pt-view-version-changelog')
    .off('click.pt')
    .on('click.pt', async function () {
      const btn = $(this);
      try {
        const currentName = getCurrentPresetName();
        if (!currentName) throw new Error('请先选择一个预设');

        const info = extractPresetVersionInfo(currentName);
        if (!info?.version) throw new Error('当前预设名称未包含版本号，无法生成更新日志');

        const rawTarget = ($('#pt-target-version').val() || '').toString().trim();
        const targetVersion = normalizeVersion(rawTarget);
        if (!targetVersion) throw new Error('请输入目标版本号');

        const inputs = readGitSourceInputs();
        const repo = parseGitHubRepo(inputs.repoUrl);
        if (!repo) throw new Error('无效的 GitHub 仓库 URL');

        const tagTemplate = String(inputs.tagTemplate ?? '').trim();
        const refTemplate = String(inputs.refTemplate ?? '').trim();
        const versionRefTemplate = tagTemplate || (refTemplate.includes('{version}') ? refTemplate : 'v{version}');

        const currentVersion = normalizeVersion(String(info.version ?? ''));
        const tagName = resolveTagNameFromTemplate(versionRefTemplate, targetVersion);
        if (!tagName) throw new Error('无法根据 Tag/Ref 模板生成 tagName（请检查是否包含 {version} 或是否为空）');

        btn.prop('disabled', true);

        let changelogText = '';
        try {
          const release = await fetchGitHubReleaseByTag({ ...repo, tagName });
          changelogText = String(release?.body ?? '').trim();
          if (!changelogText) {
            changelogText = '（该版本 Release 未包含正文内容）';
          }
        } catch (error) {
          console.warn('读取 GitHub Release 失败:', error);
          changelogText = '（未找到该版本的 GitHub Release 更新日志。请确认作者已发布 Release，且 Tag 名称与模板一致。）';
        }

        const releaseUrl = `https://github.com/${repo.owner}/${repo.repo}/releases/tag/${encodeURIComponent(tagName)}`;

        await showPresetGitUpdateModal({
          title: '版本变更日志',
          presetLabel: info.base || info.raw || currentName,
          localVersion: currentVersion || info.version,
          remoteVersion: targetVersion,
          changelogText,
          compareUrl: releaseUrl,
          compareButtonText: '打开 GitHub Release',
          showConfirm: false,
          showCancel: false,
        });
      } catch (e) {
        console.error('获取更新日志失败', e);
        if (window.toastr) toastr.error('获取更新日志失败: ' + (e?.message ?? e));
      } finally {
        btn.prop('disabled', false);
      }
    });

  $('#pt-export-preset-bundle')
    .off('click.pt')
    .on('click.pt', async function () {
      try {
        const presetName = getCurrentPresetName();
        if (!presetName) {
          if (window.toastr) toastr.error('请先选择一个预设');
          return;
        }
        const includeGlobalWorldbooks = $('#pt-export-global-worldbooks').prop('checked');
        await exportPresetBundle(presetName, { includeGlobalWorldbooks });
      } catch (e) {
        console.error('导出预设包失败', e);
        if (window.toastr) toastr.error('导出失败: ' + (e?.message ?? e));
      }
    });

  $('#pt-import-preset-bundle')
    .off('click.pt')
    .on('click.pt', function () {
      $('#pt-import-preset-bundle-file').trigger('click');
    });

  $('#pt-import-preset-bundle-file')
    .off('change.pt')
    .on('change.pt', async function (e) {
      const file = e?.target?.files?.[0];
      if (!file) return;
      try {
        await importPresetBundle(file);
      } catch (err) {
        console.error('导入预设包失败', err);
        if (window.toastr) toastr.error('导入失败: ' + (err?.message ?? err));
      } finally {
        $(this).val('');
      }
    });
}

export function initTransferToolsSettingsPanel() {
  const $ = getJQuery();
  const host = getSettingsHost();
  if (!host?.length) return false;
  if ($(`#${CONTAINER_ID}`).length) return true;

  host.append(renderPanel());

  // 插入快照管理面板内容
  $('#pt-transfer-tools-panel-snapshots').html(createSnapshotManagementPanel());

  const flags = getTransferToolFeatureFlags();
  syncUiFromFlags(flags);
  syncPresetAutomationUi();
  bindEvents();
  initPresetChangeAutoRefresh();

  // 初始化快照管理面板
  initSnapshotManagementPanel().catch(err => {
    console.error('[PresetTransfer] 初始化快照管理面板失败:', err);
  });

  return true;
}
