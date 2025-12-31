import { ensureNewVersionFields } from './new-version-fields.js';

function normalizeNameForMatch(name) {
  if (typeof name !== 'string') return '';
  let normalized = name.trim().replace(/\s+/g, ' ');

  // Handle common "choice" prefixes that often change between preset versions:
  // - "(选一) xxx" / "（选一）xxx"
  // - "选一：xxx"
  normalized = normalized.replace(/^[（(]\s*选\s*[一二三四五六七八九十0-9]+\s*[）)]\s*/u, '');
  normalized = normalized.replace(/^选\s*[一二三四五六七八九十0-9]+\s*[:：\-–—]\s*/u, '');

  return normalized.trim();
}

function getNameMatchKey(name) {
  return normalizeNameForMatch(name)
    .toLowerCase()
    .replace(
      /[\s\-_–—:：()（）【】[\]{}<>《》"'`~!@#$%^&*+=|\\;,.?，。！？、·]/g,
      '',
    );
}

function normalizePosition(pos) {
  return pos || 'relative';
}

function normalizeTriggers(triggers) {
  return Array.isArray(triggers) ? [...triggers].filter(Boolean).sort() : [];
}

function buildEntrySignature(entry) {
  const normalized = ensureNewVersionFields(entry);
  const content =
    typeof normalized?.content === 'string' ? normalized.content.replace(/\r\n/g, '\n').trim() : '';
  return JSON.stringify({
    content,
    role: normalized?.role ?? 'system',
    injection_position: normalizePosition(normalized?.injection_position),
    injection_depth: normalized?.injection_depth ?? 4,
    injection_order: normalized?.injection_order ?? '',
    injection_trigger: normalizeTriggers(normalized?.injection_trigger),
    system_prompt: Boolean(normalized?.system_prompt),
    marker: Boolean(normalized?.marker),
    forbid_overrides: Boolean(normalized?.forbid_overrides),
  });
}

export { getNameMatchKey, buildEntrySignature };
