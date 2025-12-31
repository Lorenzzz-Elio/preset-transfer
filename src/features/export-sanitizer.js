import { getParentWindow } from '../core/utils.js';

const PT_META_FIELD = 'pt_meta';
const PT_META_NAMESPACE = 'presetTransfer';

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

function stripPresetTransferMetaForExport(value) {
  const cloned = cloneDeepFallback(value);
  stripPresetTransferMetaInPlace(cloned);
  return cloned;
}

function guessJsonIndent(source) {
  if (typeof source !== 'string') return 2;
  const match = source.match(/\n([ \t]+)"/);
  if (!match) return 2;
  const indent = match[1];
  if (indent.startsWith('\t')) return '\t';
  return indent.length;
}

function sanitizeJsonTextIfNeeded(text) {
  if (typeof text !== 'string') return null;
  if (!text.includes(PT_META_FIELD) || !text.includes(PT_META_NAMESPACE)) return null;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  stripPresetTransferMetaInPlace(parsed);
  return JSON.stringify(parsed, null, guessJsonIndent(text));
}

function tryPatchDownload(pw) {
  if (!pw || pw.__presetTransferDownloadPatched) return true;
  if (typeof pw.download !== 'function') return false;

  const originalDownload = pw.download;
  pw.download = function presetTransferDownloadPatched(data, fileName, mimeType) {
    try {
      const isJson =
        (typeof mimeType === 'string' && mimeType.toLowerCase().includes('json')) ||
        (typeof fileName === 'string' && fileName.toLowerCase().endsWith('.json'));

      if (isJson && typeof data === 'string') {
        const sanitized = sanitizeJsonTextIfNeeded(data);
        if (typeof sanitized === 'string') {
          data = sanitized;
        }
      }
    } catch {
      /* ignore */
    }

    return originalDownload.call(this, data, fileName, mimeType);
  };

  pw.__presetTransferDownloadPatched = true;
  return true;
}

function tryPatchBlob(pw) {
  if (!pw || pw.__presetTransferBlobPatched) return true;
  if (typeof pw.Blob !== 'function') return false;

  const OriginalBlob = pw.Blob;

  function PresetTransferBlobPatched(blobParts, options) {
    try {
      const type = options?.type;
      const isJson = typeof type === 'string' && type.toLowerCase().includes('json');
      const parts = Array.isArray(blobParts) ? blobParts : [];

      if (isJson && parts.length > 0 && parts.every(p => typeof p === 'string')) {
        const text = parts.join('');
        const sanitized = sanitizeJsonTextIfNeeded(text);
        if (typeof sanitized === 'string') {
          blobParts = [sanitized];
        }
      }
    } catch {
      /* ignore */
    }

    return new OriginalBlob(blobParts, options);
  }

  try {
    Object.setPrototypeOf(PresetTransferBlobPatched, OriginalBlob);
  } catch {
    /* ignore */
  }

  PresetTransferBlobPatched.prototype = OriginalBlob.prototype;

  pw.Blob = PresetTransferBlobPatched;
  pw.__presetTransferBlobPatched = true;
  return true;
}

async function tryPatchPromptManagerExport(pw) {
  if (!pw || pw.__presetTransferPromptManagerExportPatched) return true;

  let mod;
  try {
    mod = await import('/scripts/PromptManager.js');
  } catch {
    return false;
  }

  const PromptCollection = mod?.PromptCollection;
  if (!PromptCollection?.prototype) return false;

  const originalExport = PromptCollection.prototype.export;
  if (typeof originalExport !== 'function') return false;

  if (originalExport.__presetTransferPatched) {
    pw.__presetTransferPromptManagerExportPatched = true;
    return true;
  }

  function exportPatched(data, type, name = 'export') {
    try {
      return originalExport.call(this, stripPresetTransferMetaForExport(data), type, name);
    } catch {
      return originalExport.call(this, data, type, name);
    }
  }

  exportPatched.__presetTransferPatched = true;
  PromptCollection.prototype.export = exportPatched;
  pw.__presetTransferPromptManagerExportPatched = true;
  return true;
}

export function initExportSanitizer(options = {}) {
  const { retryDelayMs = 500, maxAttempts = 20 } = options;
  const pw = getParentWindow?.() ?? window;

  if (pw.__presetTransferExportSanitizerInit) return;
  pw.__presetTransferExportSanitizerInit = true;

  let attempts = 0;
  const tick = async () => {
    attempts += 1;

    const okBlob = tryPatchBlob(pw);
    const okDownload = tryPatchDownload(pw);
    const okPromptManager = await tryPatchPromptManagerExport(pw);

    if ((okBlob && okDownload && okPromptManager) || attempts >= maxAttempts) return;
    setTimeout(tick, retryDelayMs);
  };

  void tick();
}
