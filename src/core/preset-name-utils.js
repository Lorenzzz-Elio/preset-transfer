function normalizePresetBaseName(value) {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[\s\-_–—]+/g, '')
    .replace(/[()（）[\]【】{}<>《》“”"'`~!@#$%^&*+=|\\:;,.?，。！？、·]/g, '');
}

function extractPresetVersionInfo(presetName) {
  const raw = String(presetName ?? '').trim();
  if (!raw) {
    return { raw: '', base: '', normalizedBase: '', version: null };
  }

  // Find the last version-like token anywhere (not necessarily at the end).
  // Supports separators like "~", "†" and common punctuation.
  // Examples:
  // - "xxx~v1.42"
  // - "xxx†V1.2.0"
  // - "xxx V1.1.3 备注..."
  const versionToken = /v?\d+(?:\.\d+){0,3}(?:[a-z]\d*)?/gi;
  const matches = Array.from(raw.matchAll(versionToken));

  const isBoundary = ch => !ch || /[\s\-_–—~†·•|\\/()（）[\]【】{}<>《》“”"'`]/.test(ch);

  let picked = null;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const idx = m.index ?? -1;
    if (idx < 0) continue;
    const before = raw[idx - 1];
    const after = raw[idx + m[0].length];
    if (isBoundary(before) && isBoundary(after)) {
      picked = m;
      break;
    }
  }

  if (!picked || picked.index === undefined) {
    const base = raw;
    return { raw, base, normalizedBase: normalizePresetBaseName(base), version: null };
  }

  const version = String(picked[0]).replace(/^v/i, '');
  let base = raw.slice(0, picked.index).trim();
  base = base.replace(/[\s\-_–—~†·•|\\/]+$/g, '').trim();

  return { raw, base, normalizedBase: normalizePresetBaseName(base), version };
}

function bigrams(str) {
  const s = String(str ?? '');
  if (s.length < 2) return [];
  const out = [];
  for (let i = 0; i < s.length - 1; i++) {
    out.push(s.slice(i, i + 2));
  }
  return out;
}

function diceCoefficient(a, b) {
  const s1 = String(a ?? '');
  const s2 = String(b ?? '');
  if (!s1 && !s2) return 1;
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return 0;

  const b1 = bigrams(s1);
  const b2 = bigrams(s2);
  const map = new Map();

  for (const bg of b1) {
    map.set(bg, (map.get(bg) || 0) + 1);
  }

  let intersection = 0;
  for (const bg of b2) {
    const count = map.get(bg) || 0;
    if (count > 0) {
      map.set(bg, count - 1);
      intersection++;
    }
  }

  return (2 * intersection) / (b1.length + b2.length);
}

function tokenizePresetBaseName(value) {
  const raw = String(value ?? '').toLowerCase();
  const tokens = raw.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) || [];
  return tokens.filter(t => t.length >= 2);
}

function arePresetsSameDifferentVersion(leftPresetName, rightPresetName, options = {}) {
  const { threshold = 0.82 } = options;

  const left = extractPresetVersionInfo(leftPresetName);
  const right = extractPresetVersionInfo(rightPresetName);

  if (!left.raw || !right.raw) return { match: false, similarity: 0, left, right };
  if (left.raw === right.raw) return { match: false, similarity: 0, left, right };
  if (!left.version || !right.version) return { match: false, similarity: 0, left, right };
  if (left.version === right.version) return { match: false, similarity: 0, left, right };

  if (!left.normalizedBase || !right.normalizedBase) return { match: false, similarity: 0, left, right };

  const similarity =
    left.normalizedBase === right.normalizedBase ? 1 : diceCoefficient(left.normalizedBase, right.normalizedBase);

  const leftTokens = tokenizePresetBaseName(left.base);
  const rightTokens = tokenizePresetBaseName(right.base);
  const rightSet = new Set(rightTokens);
  const sharedToken = leftTokens.find(t => t.length >= 3 && rightSet.has(t)) || null;
  if (!sharedToken) {
    return { match: false, similarity, left, right };
  }

  const leftSet = new Set(leftTokens);
  const leftIsSubsetOfRight = leftTokens.length > 0 && leftTokens.every(t => rightSet.has(t));
  const rightIsSubsetOfLeft = rightTokens.length > 0 && rightTokens.every(t => leftSet.has(t));
  const normalizedContains =
    left.normalizedBase.includes(right.normalizedBase) || right.normalizedBase.includes(left.normalizedBase);
  const strongMatch = normalizedContains || leftIsSubsetOfRight || rightIsSubsetOfLeft;

  const match = strongMatch || similarity >= threshold;
  return { match, similarity, left, right };
}

export { arePresetsSameDifferentVersion, extractPresetVersionInfo, normalizePresetBaseName };
