import { generateUUID } from '../core/utils.js';

const PT_META_FIELD = 'pt_meta';
const PT_META_NAMESPACE = 'presetTransfer';

const STITCH_SCHEMA_VERSION = 1;
const STITCH_KIND = 'stitch';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readPresetTransferMeta(entry) {
  const root = entry?.[PT_META_FIELD];
  if (!root) return null;

  // Preferred: namespaced meta to avoid collisions with other extensions.
  if (isPlainObject(root) && isPlainObject(root[PT_META_NAMESPACE])) {
    return root[PT_META_NAMESPACE];
  }

  // Back-compat: legacy flat schema (if it ever existed).
  if (isPlainObject(root) && root.kind === STITCH_KIND) {
    return root;
  }

  return null;
}

function writePresetTransferMeta(entry, meta) {
  if (!entry || typeof entry !== 'object') return entry;

  const root = entry[PT_META_FIELD];
  if (isPlainObject(root)) {
    return {
      ...entry,
      [PT_META_FIELD]: {
        ...root,
        [PT_META_NAMESPACE]: meta,
      },
    };
  }

  return {
    ...entry,
    [PT_META_FIELD]: {
      [PT_META_NAMESPACE]: meta,
    },
  };
}

function getStitchId(entry) {
  const meta = readPresetTransferMeta(entry);
  const id = meta?.stitchId;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function isStitchEntry(entry) {
  const meta = readPresetTransferMeta(entry);
  return Boolean(meta && meta.kind === STITCH_KIND && getStitchId(entry));
}

function ensureStitchMeta(entry, options = {}) {
  const { now = new Date().toISOString() } = options;

  const existingId = getStitchId(entry);
  if (existingId) return entry;

  const meta = {
    schema: STITCH_SCHEMA_VERSION,
    kind: STITCH_KIND,
    stitchId: generateUUID(),
    createdAt: now,
  };

  return writePresetTransferMeta(entry, meta);
}

function assignNewStitchMeta(entry, options = {}) {
  const { now = new Date().toISOString(), stitchId = generateUUID() } = options;

  const meta = {
    schema: STITCH_SCHEMA_VERSION,
    kind: STITCH_KIND,
    stitchId,
    createdAt: now,
  };

  return writePresetTransferMeta(entry, meta);
}

export {
  PT_META_FIELD,
  PT_META_NAMESPACE,
  STITCH_SCHEMA_VERSION,
  STITCH_KIND,
  readPresetTransferMeta,
  writePresetTransferMeta,
  getStitchId,
  isStitchEntry,
  ensureStitchMeta,
  assignNewStitchMeta,
};
