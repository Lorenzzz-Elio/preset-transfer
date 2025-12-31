import { ensureUniqueIdentifier } from '../core/utils.js';
import { ensureNewVersionFields } from './new-version-fields.js';
import { getOrCreateDummyCharacterPromptOrder } from './prompt-order-utils.js';
import { buildEntrySignature, getNameMatchKey } from './entry-match-utils.js';
import { getStitchId, isStitchEntry, readPresetTransferMeta } from './stitch-meta.js';

const DUMMY_CHARACTER_ID = 100001;
const STITCH_PATCH_SCHEMA_VERSION = 1;

function cloneDeep(value) {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function sanitizePromptForSave(prompt) {
  const cleaned = ensureNewVersionFields(prompt);
  const next = { ...cleaned };

  if (Array.isArray(next.injection_trigger)) {
    next.injection_trigger = [...next.injection_trigger];
  }

  next.injection_depth ??= 4;
  next.system_prompt = Boolean(next.system_prompt);
  next.marker = Boolean(next.marker);
  next.forbid_overrides = Boolean(next.forbid_overrides);

  delete next.enabled;
  delete next.orderIndex;
  delete next.isNewEntry;
  delete next.isUninserted;
  delete next.hiddenInDefaultMode;
  delete next.ptKey;

  return next;
}

function getDummyCharacterPromptOrder(presetData) {
  if (!presetData || !Array.isArray(presetData.prompt_order)) return null;
  return presetData.prompt_order.find(order => order && order.character_id === DUMMY_CHARACTER_ID) ?? null;
}

function buildPromptMapByIdentifier(presetData) {
  const map = new Map();
  const prompts = Array.isArray(presetData?.prompts) ? presetData.prompts : [];
  for (const prompt of prompts) {
    if (prompt && prompt.identifier) {
      map.set(prompt.identifier, prompt);
    }
  }
  return map;
}

function buildAnchorDescriptor(prompt) {
  if (!prompt || !prompt.identifier) return null;
  return {
    identifier: String(prompt.identifier),
    nameKey: getNameMatchKey(prompt.name),
    signature: buildEntrySignature(prompt),
    role: prompt.role ?? 'system',
    name: typeof prompt.name === 'string' ? prompt.name : '',
  };
}

function createAnchorMatcher(targetData) {
  const targetPromptMap = buildPromptMapByIdentifier(targetData);
  const targetOrder = getOrCreateDummyCharacterPromptOrder(targetData);
  const targetOrderIds = new Set((targetOrder?.order ?? []).map(o => o && o.identifier).filter(Boolean));

  const byNameKey = new Map();
  const bySignature = new Map();

  for (const identifier of targetOrderIds) {
    const prompt = targetPromptMap.get(identifier);
    if (!prompt || !prompt.identifier) continue;
    if (isStitchEntry(prompt)) continue;

    const nameKey = getNameMatchKey(prompt.name);
    if (nameKey) {
      if (!byNameKey.has(nameKey)) byNameKey.set(nameKey, []);
      byNameKey.get(nameKey).push(prompt.identifier);
    }

    const signature = buildEntrySignature(prompt);
    if (signature) {
      if (!bySignature.has(signature)) bySignature.set(signature, []);
      bySignature.get(signature).push(prompt.identifier);
    }
  }

  function resolve(anchor) {
    if (!anchor) return null;

    const rawId = anchor?.identifier;
    if (rawId && targetOrderIds.has(rawId)) {
      const p = targetPromptMap.get(rawId);
      if (p && !isStitchEntry(p)) return rawId;
    }

    const nameKey = anchor?.nameKey;
    if (nameKey && byNameKey.has(nameKey)) {
      const candidates = byNameKey.get(nameKey);
      if (Array.isArray(candidates) && candidates.length) {
        if (candidates.length === 1) return candidates[0];
        const role = anchor?.role;
        if (role) {
          const roleMatch = candidates.find(id => targetPromptMap.get(id)?.role === role);
          if (roleMatch) return roleMatch;
        }
        return candidates[0];
      }
    }

    const signature = anchor?.signature;
    if (signature && bySignature.has(signature)) {
      const candidates = bySignature.get(signature);
      if (Array.isArray(candidates) && candidates.length) return candidates[0];
    }

    return null;
  }

  return { resolve };
}

function chooseInsertIndex(targetOrderArray, run) {
  const prevIndex =
    run.prevAnchor ? targetOrderArray.findIndex(item => item && item.identifier === run.prevAnchor) : -1;
  const nextIndex =
    run.nextAnchor ? targetOrderArray.findIndex(item => item && item.identifier === run.nextAnchor) : -1;

  if (prevIndex !== -1 && nextIndex !== -1) {
    if (prevIndex < nextIndex) {
      return prevIndex + 1;
    }

    const distPrev = run.prevAnchorSourceIndex >= 0 ? run.startSourceIndex - run.prevAnchorSourceIndex : Infinity;
    const distNext = run.nextAnchorSourceIndex >= 0 ? run.nextAnchorSourceIndex - run.endSourceIndex : Infinity;
    if (distNext < distPrev) {
      return nextIndex;
    }
    return prevIndex + 1;
  }

  if (prevIndex !== -1) return prevIndex + 1;
  if (nextIndex !== -1) return nextIndex;
  return targetOrderArray.length;
}

function extractStitchPatch(presetData, options = {}) {
  const { includeUninserted = true, anchorWindowSize = 5 } = options;

  const promptMap = buildPromptMapByIdentifier(presetData);
  const order = getDummyCharacterPromptOrder(presetData);
  const orderItems = Array.isArray(order?.order) ? order.order : [];

  const insertedIdentifiers = new Set(orderItems.map(o => o && o.identifier).filter(Boolean));
  const insertedStitchIds = new Set();

  for (const identifier of insertedIdentifiers) {
    const prompt = promptMap.get(identifier);
    if (!prompt) continue;
    if (!isStitchEntry(prompt)) continue;
    const stitchId = getStitchId(prompt);
    if (stitchId) insertedStitchIds.add(stitchId);
  }

  const runs = [];
  let lastAnchor = null;
  let lastAnchorSourceIndex = -1;
  let currentRun = null;
  const prevAnchorsWindow = [];

  for (let i = 0; i < orderItems.length; i++) {
    const item = orderItems[i];
    const identifier = item?.identifier;
    if (!identifier) continue;

    const prompt = promptMap.get(identifier);
    if (!prompt) continue;

    const isStitch = isStitchEntry(prompt);
    if (isStitch) {
      const stitchId = getStitchId(prompt);
      if (!stitchId) continue;

      if (!currentRun) {
        currentRun = {
          stitches: [],
          prevAnchor: lastAnchor,
          nextAnchor: null,
          prevAnchors: prevAnchorsWindow.slice().reverse(),
          nextAnchors: [],
          prevAnchorSourceIndex: lastAnchorSourceIndex,
          nextAnchorSourceIndex: -1,
          startSourceIndex: i,
          endSourceIndex: i,
        };
      }

      currentRun.stitches.push({
        stitchId,
        prompt: cloneDeep(prompt),
        enabled: Boolean(item?.enabled),
      });
      currentRun.endSourceIndex = i;
      continue;
    }

    // Non-stitch entry: treat as anchor.
    if (currentRun) {
      const nextAnchors = [];
      for (let j = i; j < orderItems.length && nextAnchors.length < anchorWindowSize; j++) {
        const nextItem = orderItems[j];
        const nextIdentifier = nextItem?.identifier;
        if (!nextIdentifier) continue;
        const nextPrompt = promptMap.get(nextIdentifier);
        if (!nextPrompt) continue;
        if (isStitchEntry(nextPrompt)) continue;
        const anchor = buildAnchorDescriptor(nextPrompt);
        if (!anchor) continue;
        nextAnchors.push({ anchor, sourceIndex: j });
      }

      currentRun.nextAnchors = nextAnchors;
      currentRun.nextAnchor = nextAnchors[0]?.anchor ?? buildAnchorDescriptor(prompt);
      currentRun.nextAnchorSourceIndex = Number.isFinite(nextAnchors[0]?.sourceIndex) ? nextAnchors[0].sourceIndex : i;
      runs.push(currentRun);
      currentRun = null;
    }

    const anchor = buildAnchorDescriptor(prompt);
    lastAnchor = anchor;
    lastAnchorSourceIndex = i;

    if (anchor) {
      prevAnchorsWindow.push({ anchor, sourceIndex: i });
      while (prevAnchorsWindow.length > anchorWindowSize) {
        prevAnchorsWindow.shift();
      }
    }
  }

  if (currentRun) {
    runs.push(currentRun);
  }

  const uninserted = [];
  if (includeUninserted) {
    const prompts = Array.isArray(presetData?.prompts) ? presetData.prompts : [];
    for (const prompt of prompts) {
      if (!prompt || !prompt.identifier) continue;
      if (!isStitchEntry(prompt)) continue;
      if (insertedIdentifiers.has(prompt.identifier)) continue;
      const stitchId = getStitchId(prompt);
      if (!stitchId) continue;
      // Avoid duplication: if a stitch is inserted, don't also list it as uninserted.
      if (insertedStitchIds.has(stitchId)) continue;
      uninserted.push({
        stitchId,
        prompt: cloneDeep(prompt),
      });
    }
  }

  return {
    schema: STITCH_PATCH_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    runs,
    uninserted,
  };
}

function applyStitchPatch(targetData, patch, options = {}) {
  const { preserveExistingNonPatchStitches = true, insertedEnabled } = options;

  if (!targetData || typeof targetData !== 'object') {
    throw new Error('Invalid target preset data.');
  }

  if (!patch || typeof patch !== 'object' || patch.schema !== STITCH_PATCH_SCHEMA_VERSION) {
    throw new Error('Invalid stitch patch.');
  }

  if (!Array.isArray(targetData.prompts)) targetData.prompts = [];
  const targetOrder = getOrCreateDummyCharacterPromptOrder(targetData);
  if (!Array.isArray(targetOrder.order)) targetOrder.order = [];

  const promptMap = buildPromptMapByIdentifier(targetData);
  const stitchById = new Map();
  const promptIndexByIdentifier = new Map();

  targetData.prompts.forEach((p, idx) => {
    if (p?.identifier) promptIndexByIdentifier.set(p.identifier, idx);
    const stitchId = getStitchId(p);
    if (stitchId) stitchById.set(stitchId, p);
  });

  const patchStitchIds = new Set();
  for (const run of Array.isArray(patch.runs) ? patch.runs : []) {
    for (const stitch of Array.isArray(run?.stitches) ? run.stitches : []) {
      if (stitch?.stitchId) patchStitchIds.add(stitch.stitchId);
    }
  }
  for (const stitch of Array.isArray(patch.uninserted) ? patch.uninserted : []) {
    if (stitch?.stitchId) patchStitchIds.add(stitch.stitchId);
  }

  // Detach patch stitches from order first so anchor indices are stable.
  const detachIdentifiers = new Set();
  for (const stitchId of patchStitchIds) {
    const existing = stitchById.get(stitchId);
    if (existing?.identifier) detachIdentifiers.add(existing.identifier);
  }
  targetOrder.order = targetOrder.order.filter(o => !detachIdentifiers.has(o?.identifier));

  const matcher = createAnchorMatcher(targetData);

  let addedPrompts = 0;
  let updatedPrompts = 0;
  let insertedOrder = 0;
  let movedOrder = 0;

  function upsertStitchPrompt(stitch) {
    const stitchId = stitch?.stitchId;
    const patchPrompt = stitch?.prompt;
    if (!stitchId || !patchPrompt || typeof patchPrompt !== 'object') return null;

    const existing = stitchById.get(stitchId);
    if (existing?.identifier) {
      const existingIdentifier = existing.identifier;
      const existingIndex = promptIndexByIdentifier.get(existingIdentifier);

      if (existingIndex != null) {
        const cleaned = sanitizePromptForSave(patchPrompt);
        cleaned.identifier = existingIdentifier;

        const existingMeta = readPresetTransferMeta(existing);
        const cleanedMeta = readPresetTransferMeta(cleaned);
        if (!cleanedMeta && existingMeta) {
          // Keep the existing stitch meta if patch prompt somehow lacks it.
          cleaned.pt_meta = existing.pt_meta;
        }

        targetData.prompts[existingIndex] = {
          ...existing,
          ...cleaned,
          identifier: existingIdentifier,
        };
      }

      // Refresh mapping reference
      const updatedPrompt = targetData.prompts[existingIndex] ?? existing;
      promptMap.set(existingIdentifier, updatedPrompt);
      stitchById.set(stitchId, updatedPrompt);
      updatedPrompts += 1;
      return existingIdentifier;
    }

    const cleaned = sanitizePromptForSave(patchPrompt);
    const desiredIdentifier = typeof cleaned.identifier === 'string' ? cleaned.identifier : null;
    const identifier = ensureUniqueIdentifier(targetData, desiredIdentifier);
    cleaned.identifier = identifier;

    targetData.prompts.push(cleaned);
    promptIndexByIdentifier.set(identifier, targetData.prompts.length - 1);
    promptMap.set(identifier, cleaned);
    stitchById.set(stitchId, cleaned);
    addedPrompts += 1;

    return identifier;
  }

  const runs = Array.isArray(patch.runs) ? patch.runs : [];
  for (const run of runs) {
    if (!run || !Array.isArray(run.stitches) || run.stitches.length === 0) continue;

    const resolveWithFallback = (primaryAnchor, primarySourceIndex, candidates) => {
      const primaryResolved = matcher.resolve(primaryAnchor);
      if (primaryResolved) {
        return {
          identifier: primaryResolved,
          sourceIndex: Number.isFinite(primarySourceIndex) ? primarySourceIndex : -1,
        };
      }

      const list = Array.isArray(candidates) ? candidates : [];
      for (const candidate of list) {
        const anchor = candidate?.anchor ?? candidate;
        const resolved = matcher.resolve(anchor);
        if (resolved) {
          return {
            identifier: resolved,
            sourceIndex: Number.isFinite(candidate?.sourceIndex) ? candidate.sourceIndex : -1,
          };
        }
      }

      return { identifier: null, sourceIndex: -1 };
    };

    const prevResolved = resolveWithFallback(run.prevAnchor, run.prevAnchorSourceIndex, run.prevAnchors);
    const nextResolved = resolveWithFallback(run.nextAnchor, run.nextAnchorSourceIndex, run.nextAnchors);

    const insertIndex = chooseInsertIndex(targetOrder.order, {
      prevAnchor: prevResolved.identifier,
      nextAnchor: nextResolved.identifier,
      prevAnchorSourceIndex: prevResolved.sourceIndex,
      nextAnchorSourceIndex: nextResolved.sourceIndex,
      startSourceIndex: Number.isFinite(run.startSourceIndex) ? run.startSourceIndex : -1,
      endSourceIndex: Number.isFinite(run.endSourceIndex) ? run.endSourceIndex : -1,
    });

    let offset = 0;
    for (const stitch of run.stitches) {
      const identifier = upsertStitchPrompt(stitch);
      if (!identifier) continue;

      const alreadyInOrder = targetOrder.order.some(o => o?.identifier === identifier);
      if (alreadyInOrder) {
        // It should have been detached earlier; just in case, treat it as move.
        targetOrder.order = targetOrder.order.filter(o => o?.identifier !== identifier);
        movedOrder += 1;
      }

      targetOrder.order.splice(insertIndex + offset, 0, {
        identifier,
        enabled: typeof insertedEnabled === 'boolean' ? insertedEnabled : stitch?.enabled === true,
      });
      offset += 1;
      insertedOrder += 1;
    }
  }

  // Uninserted stitches: ensure they exist but are not in the order.
  const uninserted = Array.isArray(patch.uninserted) ? patch.uninserted : [];
  for (const stitch of uninserted) {
    const identifier = upsertStitchPrompt({ ...stitch, enabled: null });
    if (!identifier) continue;
    const hadOrder = targetOrder.order.some(o => o?.identifier === identifier);
    if (hadOrder) {
      targetOrder.order = targetOrder.order.filter(o => o?.identifier !== identifier);
      movedOrder += 1;
    }
  }

  if (!preserveExistingNonPatchStitches) {
    // Optional: drop stitches not present in patch (disabled by default).
    const keepIdentifiers = new Set();
    for (const stitchId of patchStitchIds) {
      const p = stitchById.get(stitchId);
      if (p?.identifier) keepIdentifiers.add(p.identifier);
    }
    targetOrder.order = targetOrder.order.filter(o => {
      const prompt = promptMap.get(o?.identifier);
      if (!prompt) return true;
      if (!isStitchEntry(prompt)) return true;
      return keepIdentifiers.has(prompt.identifier);
    });
  }

  return {
    addedPrompts,
    updatedPrompts,
    insertedOrder,
    movedOrder,
    appliedStitches: patchStitchIds.size,
  };
}

export { STITCH_PATCH_SCHEMA_VERSION, extractStitchPatch, applyStitchPatch };
