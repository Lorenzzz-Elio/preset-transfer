import { ensureUniqueIdentifier } from '../core/utils.js';
import { ensureNewVersionFields } from '../preset/new-version-fields.js';
import { getPresetDataFromManager, getPromptEntries } from '../preset/preset-manager.js';
import { getOrCreateDummyCharacterPromptOrder } from '../ui/edit-modal.js';

const DUMMY_CHARACTER_ID = 100001;

function getDummyCharacterPromptOrder(presetData) {
  if (!presetData || !Array.isArray(presetData.prompt_order)) {
    return null;
  }
  return presetData.prompt_order.find(order => order && order.character_id === DUMMY_CHARACTER_ID) ?? null;
}

function getDummyCharacterOrderIdentifierSet(presetData) {
  const order = getDummyCharacterPromptOrder(presetData);
  const ids = new Set((order?.order ?? []).map(o => o && o.identifier).filter(Boolean));
  return { order, ids };
}

function buildEnabledMap(promptOrder) {
  const map = new Map();
  if (!promptOrder || !Array.isArray(promptOrder.order)) {
    return map;
  }

  for (const item of promptOrder.order) {
    if (item && item.identifier) {
      map.set(item.identifier, Boolean(item.enabled));
    }
  }
  return map;
}

function normalizeName(name) {
  if (typeof name !== 'string') return '';
  return name.trim();
}

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

function buildTargetIdentifiersByName(targetData, targetOrderSet) {
  const map = new Map();
  const prompts = Array.isArray(targetData?.prompts) ? targetData.prompts : [];

  for (const prompt of prompts) {
    if (!prompt || !prompt.identifier) continue;
    if (targetOrderSet && targetOrderSet.size && !targetOrderSet.has(prompt.identifier)) continue;

    const nameKey = getNameMatchKey(prompt.name);
    if (!nameKey) continue;

    if (!map.has(nameKey)) {
      map.set(nameKey, []);
    }
    map.get(nameKey).push(prompt.identifier);
  }
  return map;
}

function buildTargetIdentifiersBySignature(targetData, targetOrderSet) {
  const map = new Map();
  const prompts = Array.isArray(targetData?.prompts) ? targetData.prompts : [];

  for (const prompt of prompts) {
    if (!prompt || !prompt.identifier) continue;
    if (targetOrderSet && targetOrderSet.size && !targetOrderSet.has(prompt.identifier)) continue;

    const signature = buildEntrySignature(prompt);
    if (!signature) continue;

    if (!map.has(signature)) {
      map.set(signature, []);
    }
    map.get(signature).push(prompt.identifier);
  }
  return map;
}

function createAnchorResolver(sourceData, targetData, targetOrderSet, options = {}) {
  const { matchByName = true } = options;
  const sourcePromptMap = buildPromptMapByIdentifier(sourceData);
  const targetPromptMap = buildPromptMapByIdentifier(targetData);
  const targetNameMap = matchByName ? buildTargetIdentifiersByName(targetData, targetOrderSet) : new Map();
  const targetSignatureMap = matchByName ? buildTargetIdentifiersBySignature(targetData, targetOrderSet) : new Map();

  function resolve(sourceIdentifier) {
    if (!sourceIdentifier) return null;
    if (targetOrderSet && targetOrderSet.has(sourceIdentifier)) return sourceIdentifier;
    if (!matchByName) return null;

    const sourcePrompt = sourcePromptMap.get(sourceIdentifier);
    if (!sourcePrompt) return null;

    const sourceNameKey = getNameMatchKey(sourcePrompt?.name);
    let candidates = sourceNameKey ? targetNameMap.get(sourceNameKey) : null;

    if (!Array.isArray(candidates) || candidates.length === 0) {
      const signature = buildEntrySignature(sourcePrompt);
      candidates = targetSignatureMap.get(signature);
    }

    if (!Array.isArray(candidates) || candidates.length === 0) return null;

    if (candidates.length === 1) return candidates[0];

    const sourceRole = sourcePrompt?.role;
    if (sourceRole) {
      const roleMatch = candidates.find(id => targetPromptMap.get(id)?.role === sourceRole);
      if (roleMatch) return roleMatch;
    }

    return candidates[0];
  }

  return { resolve, sourcePromptMap, targetPromptMap };
}

function buildSourceOrderIdentifiers(sourceOrder, idsToInsert, anchorResolver) {
  const raw = Array.isArray(sourceOrder?.order) ? sourceOrder.order.map(o => o && o.identifier).filter(Boolean) : [];
  if (!anchorResolver) return raw;

  const resolved = [];
  for (const identifier of raw) {
    if (!identifier) continue;
    if (idsToInsert && idsToInsert.has(identifier)) {
      resolved.push(identifier);
      continue;
    }
    const mapped = anchorResolver.resolve(identifier);
    resolved.push(mapped || identifier);
  }
  return resolved;
}

function computeMissingEntries(sourcePresetData, targetPresetData) {
  const { ids: sourceOrderIds } = getDummyCharacterOrderIdentifierSet(sourcePresetData);
  const { ids: targetOrderIds } = getDummyCharacterOrderIdentifierSet(targetPresetData);

  // Only consider entries that are inserted in prompt_order.
  const sourceEntries = getPromptEntries(sourcePresetData).filter(
    entry => entry && entry.identifier && sourceOrderIds.has(entry.identifier),
  );

  const targetEntriesInOrder = getPromptEntries(targetPresetData).filter(
    entry => entry && entry.identifier && targetOrderIds.has(entry.identifier),
  );

  const targetEntryNameKeys = new Set(targetEntriesInOrder.map(e => getNameMatchKey(e && e.name)).filter(Boolean));
  const targetEntrySignatures = new Set(targetEntriesInOrder.map(e => buildEntrySignature(e)).filter(Boolean));

  return sourceEntries.filter(entry => {
    if (!entry) return false;

    const entryNameKey = getNameMatchKey(entry.name);
    const nameExists = entryNameKey ? targetEntryNameKeys.has(entryNameKey) : false;
    const signatureExists = targetEntrySignatures.has(buildEntrySignature(entry));

    if (entry.identifier) {
      if (targetOrderIds.has(entry.identifier)) return false;
      // Safety: if the target already has the same entry name, treat it as present
      // to avoid duplicating base entries when identifiers change across preset versions.
      if (nameExists || signatureExists) return false;
      return true;
    }

    if (entryNameKey) return !(nameExists || signatureExists);
    return false;
  });
}

function computeInsertRuns(sourceOrderIdentifiers, idsToInsert, targetOrderSet) {
  const runs = [];
  if (!Array.isArray(sourceOrderIdentifiers) || sourceOrderIdentifiers.length === 0) {
    if (idsToInsert.size > 0) {
      runs.push({
        ids: Array.from(idsToInsert),
        prevAnchor: null,
        nextAnchor: null,
        prevAnchorSourceIndex: -1,
        nextAnchorSourceIndex: -1,
        startSourceIndex: -1,
        endSourceIndex: -1,
      });
    }
    return runs;
  }

  let lastAnchor = null;
  let lastAnchorSourceIndex = -1;
  let currentRun = null;

  for (let i = 0; i < sourceOrderIdentifiers.length; i++) {
    const identifier = sourceOrderIdentifiers[i];
    if (!identifier) continue;

    const isAnchor = targetOrderSet.has(identifier);
    const shouldInsert = idsToInsert.has(identifier);

    if (shouldInsert) {
      if (!currentRun) {
        currentRun = {
          ids: [],
          prevAnchor: lastAnchor,
          nextAnchor: null,
          prevAnchorSourceIndex: lastAnchorSourceIndex,
          nextAnchorSourceIndex: -1,
          startSourceIndex: i,
          endSourceIndex: i,
        };
      }
      currentRun.ids.push(identifier);
      currentRun.endSourceIndex = i;
      continue;
    }

    if (currentRun) {
      let nextAnchor = null;
      let nextAnchorSourceIndex = -1;
      for (let j = i; j < sourceOrderIdentifiers.length; j++) {
        const candidate = sourceOrderIdentifiers[j];
        if (candidate && targetOrderSet.has(candidate)) {
          nextAnchor = candidate;
          nextAnchorSourceIndex = j;
          break;
        }
      }
      currentRun.nextAnchor = nextAnchor;
      currentRun.nextAnchorSourceIndex = nextAnchorSourceIndex;
      runs.push(currentRun);
      currentRun = null;
    }

    if (isAnchor) {
      lastAnchor = identifier;
      lastAnchorSourceIndex = i;
    }
  }

  if (currentRun) {
    runs.push(currentRun);
  }

  return runs;
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

function buildRunLabel(run, promptMap) {
  const prev = run.prevAnchor ? promptMap.get(run.prevAnchor) : null;
  const next = run.nextAnchor ? promptMap.get(run.nextAnchor) : null;
  const prevLabel = normalizeName(prev?.name) || run.prevAnchor;
  const nextLabel = normalizeName(next?.name) || run.nextAnchor;

  if (!run.prevAnchor && !run.nextAnchor) {
    return '插入到末尾';
  }
  if (run.prevAnchor && run.nextAnchor) {
    return `插入在 "${prevLabel}" 与 "${nextLabel}" 之间`;
  }
  if (run.prevAnchor) {
    return `插入在 "${prevLabel}" 之后`;
  }
  return `插入在 "${nextLabel}" 之前`;
}

async function performPresetUpdateMerge(apiInfo, sourcePreset, targetPreset, options = {}) {
  const {
    preserveEnabled = true,
    selectedIdentifiers = null,
  } = options;

  const sourceData = getPresetDataFromManager(apiInfo, sourcePreset);
  const targetData = getPresetDataFromManager(apiInfo, targetPreset);
  if (!sourceData || !targetData) throw new Error('无法获取预设数据');

  const allMissingEntries = computeMissingEntries(sourceData, targetData);
  const selectedSet =
    Array.isArray(selectedIdentifiers) || selectedIdentifiers instanceof Set ? new Set(selectedIdentifiers) : null;

  const missingEntries = selectedSet
    ? allMissingEntries.filter(entry => entry && entry.identifier && selectedSet.has(entry.identifier))
    : allMissingEntries;

  if (missingEntries.length === 0) {
    return { merged: 0, insertedOrder: 0, addedPrompts: 0, skipped: 0, missingEntries: [] };
  }

  if (!targetData.prompts) targetData.prompts = [];

  const targetPromptIdentifiers = new Set((targetData.prompts ?? []).map(p => p && p.identifier).filter(Boolean));
  const targetOrder = getOrCreateDummyCharacterPromptOrder(targetData);
  const targetOrderIdentifiers = new Set(targetOrder.order.map(o => o && o.identifier).filter(Boolean));

  const sourceOrder = getDummyCharacterPromptOrder(sourceData);
  const anchorResolver = createAnchorResolver(sourceData, targetData, targetOrderIdentifiers, { matchByName: true });
  const sourceEnabledMap = preserveEnabled ? buildEnabledMap(sourceOrder) : new Map();

  const toInsertByIdentifier = new Map();
  const toInsertNoOrder = [];
  let skipped = 0;

  for (const entry of missingEntries) {
    if (!entry) continue;
    if (!entry.identifier) {
      toInsertNoOrder.push(entry);
      continue;
    }

    // If the prompt already exists in the target (but is not inserted in prompt_order),
    // we only need to insert it into the order instead of duplicating it.
    toInsertByIdentifier.set(entry.identifier, {
      ...entry,
      __targetHasPrompt: targetPromptIdentifiers.has(entry.identifier),
    });
  }

  const identifiersToInsertIntoOrder = new Set(
    Array.from(toInsertByIdentifier.keys()).filter(identifier => !targetOrderIdentifiers.has(identifier)),
  );

  const sourceOrderIdentifiers = buildSourceOrderIdentifiers(sourceOrder, identifiersToInsertIntoOrder, anchorResolver);
  const runs = computeInsertRuns(sourceOrderIdentifiers, identifiersToInsertIntoOrder, targetOrderIdentifiers);
  const identifiersInSourceOrder = new Set(sourceOrderIdentifiers);
  const uninsertedIdentifiers = Array.from(identifiersToInsertIntoOrder).filter(id => !identifiersInSourceOrder.has(id));

  if (uninsertedIdentifiers.length > 0) {
    runs.push({
      ids: uninsertedIdentifiers,
      prevAnchor: null,
      nextAnchor: null,
      prevAnchorSourceIndex: -1,
      nextAnchorSourceIndex: -1,
      startSourceIndex: -1,
      endSourceIndex: -1,
    });
  }

  let addedPrompts = 0;
  let insertedOrder = 0;

  for (const entry of toInsertByIdentifier.values()) {
    if (entry?.__targetHasPrompt) continue;
    const desiredIdentifier = entry.identifier;
    const uniqueIdentifier = ensureUniqueIdentifier(targetData, desiredIdentifier);
    if (uniqueIdentifier !== desiredIdentifier) {
      throw new Error(`目标预设已存在相同 identifier，无法保留: ${desiredIdentifier}`);
    }

    const cleaned = ensureNewVersionFields(entry);
    cleaned.identifier = uniqueIdentifier;
    if (Array.isArray(cleaned.injection_trigger)) {
      cleaned.injection_trigger = [...cleaned.injection_trigger];
    }
    cleaned.injection_depth ??= 4;
    cleaned.system_prompt = Boolean(cleaned.system_prompt);
    cleaned.marker = Boolean(cleaned.marker);
    cleaned.forbid_overrides = Boolean(cleaned.forbid_overrides);
    delete cleaned.enabled;
    delete cleaned.orderIndex;
    delete cleaned.isNewEntry;
    delete cleaned.isUninserted;
    delete cleaned.hiddenInDefaultMode;

    targetData.prompts.push(cleaned);
    targetPromptIdentifiers.add(uniqueIdentifier);
    addedPrompts++;
  }

  for (const entry of toInsertNoOrder) {
    const cleaned = ensureNewVersionFields(entry);
    cleaned.identifier = ensureUniqueIdentifier(targetData, cleaned.identifier);
    if (Array.isArray(cleaned.injection_trigger)) {
      cleaned.injection_trigger = [...cleaned.injection_trigger];
    }
    cleaned.injection_depth ??= 4;
    cleaned.system_prompt = Boolean(cleaned.system_prompt);
    cleaned.marker = Boolean(cleaned.marker);
    cleaned.forbid_overrides = Boolean(cleaned.forbid_overrides);
    delete cleaned.enabled;
    delete cleaned.orderIndex;
    delete cleaned.isNewEntry;
    delete cleaned.isUninserted;
    delete cleaned.hiddenInDefaultMode;
    targetData.prompts.push(cleaned);
    addedPrompts++;
  }

  for (const run of runs) {
    if (!run || !Array.isArray(run.ids) || run.ids.length === 0) continue;

    const insertIndex = chooseInsertIndex(targetOrder.order, run);
    const orderEntries = run.ids
      .filter(identifier => identifiersToInsertIntoOrder.has(identifier))
      .map(identifier => ({
        identifier,
        enabled: preserveEnabled && sourceEnabledMap.has(identifier) ? sourceEnabledMap.get(identifier) : true,
      }));

    if (orderEntries.length === 0) continue;

    targetOrder.order.splice(insertIndex, 0, ...orderEntries);
    insertedOrder += orderEntries.length;
    for (const oe of orderEntries) {
      identifiersToInsertIntoOrder.delete(oe.identifier);
    }
  }

  if (preserveEnabled) {
    for (const identifier of toInsertByIdentifier.keys()) {
      if (!targetOrderIdentifiers.has(identifier) && !targetOrder.order.some(o => o && o.identifier === identifier)) {
        continue;
      }
      if (!sourceEnabledMap.has(identifier)) continue;
      const orderEntry = targetOrder.order.find(o => o && o.identifier === identifier);
      if (orderEntry) {
        orderEntry.enabled = sourceEnabledMap.get(identifier);
      }
    }
  }

  await apiInfo.presetManager.savePreset(targetPreset, targetData);

  return {
    merged: missingEntries.length - skipped,
    insertedOrder,
    addedPrompts,
    skipped,
    missingEntries,
  };
}

function getPresetUpdateDiff(apiInfo, sourcePreset, targetPreset) {
  const sourceData = getPresetDataFromManager(apiInfo, sourcePreset);
  const targetData = getPresetDataFromManager(apiInfo, targetPreset);
  if (!sourceData || !targetData) throw new Error('无法获取预设数据');

  const missingEntries = computeMissingEntries(sourceData, targetData);
  return {
    missingEntries,
    missingCount: missingEntries.length,
  };
}

function getPresetUpdatePlan(apiInfo, sourcePreset, targetPreset, options = {}) {
  const sourceData = getPresetDataFromManager(apiInfo, sourcePreset);
  const targetData = getPresetDataFromManager(apiInfo, targetPreset);
  if (!sourceData || !targetData) throw new Error('无法获取预设数据');

  const missingEntries = computeMissingEntries(sourceData, targetData);

  const targetOrder = getDummyCharacterPromptOrder(targetData) ?? { order: [] };
  const targetOrderIdentifiers = new Set((targetOrder.order ?? []).map(o => o && o.identifier).filter(Boolean));
  const targetPromptMap = buildPromptMapByIdentifier(targetData);

  const sourceOrder = getDummyCharacterPromptOrder(sourceData);
  const sourceEnabledMap = buildEnabledMap(sourceOrder);
  const anchorResolver = createAnchorResolver(sourceData, targetData, targetOrderIdentifiers, { matchByName: true });

  const missingById = new Map();
  const idsToInsert = new Set();
  const missingWithoutId = [];

  for (const entry of missingEntries) {
    if (!entry) continue;
    if (!entry.identifier) {
      missingWithoutId.push(entry);
      continue;
    }
    missingById.set(entry.identifier, {
      ...entry,
      enabledInSource: sourceEnabledMap.has(entry.identifier) ? sourceEnabledMap.get(entry.identifier) : null,
    });
    idsToInsert.add(entry.identifier);
  }

  const sourceOrderIdentifiers = buildSourceOrderIdentifiers(sourceOrder, idsToInsert, anchorResolver);
  const runs = computeInsertRuns(sourceOrderIdentifiers, idsToInsert, targetOrderIdentifiers);

  const identifiersInSourceOrder = new Set(sourceOrderIdentifiers);
  const uninsertedIdentifiers = Array.from(idsToInsert).filter(id => !identifiersInSourceOrder.has(id));

  const finalRuns = runs.slice();
  if (uninsertedIdentifiers.length > 0) {
    finalRuns.push({
      ids: uninsertedIdentifiers,
      prevAnchor: null,
      nextAnchor: null,
      prevAnchorSourceIndex: -1,
      nextAnchorSourceIndex: -1,
      startSourceIndex: -1,
      endSourceIndex: -1,
    });
  }

  const groups = finalRuns
    .filter(run => run && Array.isArray(run.ids) && run.ids.length > 0)
    .map((run, idx) => {
      const insertIndex = chooseInsertIndex(targetOrder.order ?? [], run);
      const label = buildRunLabel(run, targetPromptMap);
      const entries = run.ids.map(identifier => missingById.get(identifier)).filter(Boolean);
      return {
        id: `run-${idx}-${run.prevAnchor || 'start'}-${run.nextAnchor || 'end'}`,
        insertIndex,
        label,
        prevAnchor: run.prevAnchor,
        nextAnchor: run.nextAnchor,
        entries,
      };
    })
    .sort((a, b) => a.insertIndex - b.insertIndex);

  if (missingWithoutId.length > 0) {
    groups.push({
      id: 'no-identifier',
      insertIndex: (targetOrder.order ?? []).length,
      label: '无法定位（缺少 identifier），将插入到末尾',
      prevAnchor: null,
      nextAnchor: null,
      entries: missingWithoutId.map(entry => ({ ...entry, enabledInSource: null })),
    });
  }

  return {
    missingEntries: Array.from(missingById.values()).concat(missingWithoutId),
    missingCount: missingEntries.length,
    groups,
  };
}

export { getPresetUpdateDiff, getPresetUpdatePlan, performPresetUpdateMerge };
