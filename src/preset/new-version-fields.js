import { generateUUID } from '../core/utils.js';
import { NEW_FIELD_DEFAULTS } from '../core/constants.js';
function hasNewVersionFields(entry) {
  return entry.hasOwnProperty('injection_order') || entry.hasOwnProperty('injection_trigger');
}

function extractNewVersionFields(sourceEntry) {
  const newFields = {};
  if (sourceEntry.hasOwnProperty('injection_order')) {
    newFields.injection_order = sourceEntry.injection_order;
  }
  if (sourceEntry.hasOwnProperty('injection_trigger')) {
    newFields.injection_trigger = Array.isArray(sourceEntry.injection_trigger)
      ? [...sourceEntry.injection_trigger]
      : [];
  }
  return newFields;
}

function applyNewVersionFields(targetEntry, newFields) {
  if (newFields.hasOwnProperty('injection_order')) {
    targetEntry.injection_order = newFields.injection_order;
  } else if (!targetEntry.hasOwnProperty('injection_order')) {
    targetEntry.injection_order = NEW_FIELD_DEFAULTS.injection_order;
  }
  if (newFields.hasOwnProperty('injection_trigger')) {
    targetEntry.injection_trigger = [...newFields.injection_trigger];
  } else if (!targetEntry.hasOwnProperty('injection_trigger')) {
    targetEntry.injection_trigger = [...NEW_FIELD_DEFAULTS.injection_trigger];
  }
  return targetEntry;
}

function transferEntryWithNewFields(sourceEntry, targetEntry = null) {
  if (!targetEntry) {
    targetEntry = {
      identifier: sourceEntry.identifier,
      name: sourceEntry.name,
      role: sourceEntry.role,
      content: sourceEntry.content,
      system_prompt: sourceEntry.system_prompt || false,
      injection_position: sourceEntry.injection_position,
      injection_depth: sourceEntry.injection_depth,
      forbid_overrides: sourceEntry.forbid_overrides || false,
    };
  }
  const newFields = extractNewVersionFields(sourceEntry);
  return applyNewVersionFields(targetEntry, newFields);
}

function batchTransferWithNewFields(sourceEntries) {
  return sourceEntries.map(sourceEntry => transferEntryWithNewFields(sourceEntry));
}

function createEntryWithNewFields(entryData, options = {}) {
  const entry = {
    identifier: entryData.identifier || generateUUID(),
    name: entryData.name || '',
    role: entryData.role || 'system',
    content: entryData.content || '',
    system_prompt: entryData.system_prompt || false,
    injection_position: entryData.injection_position,
    injection_depth: entryData.injection_depth ?? 4,
    forbid_overrides: entryData.forbid_overrides || false,
    injection_order: options.order ?? NEW_FIELD_DEFAULTS.injection_order,
    injection_trigger: options.triggers ? [...options.triggers] : [...NEW_FIELD_DEFAULTS.injection_trigger],
  };
  return entry;
}

function sortEntriesByOrder(entries) {
  return entries.slice().sort((a, b) => {
    const orderA = a.injection_order ?? NEW_FIELD_DEFAULTS.injection_order;
    const orderB = b.injection_order ?? NEW_FIELD_DEFAULTS.injection_order;
    return orderA - orderB;
  });
}

function ensureNewVersionFields(entry) {
  const updatedEntry = { ...entry };
  if (!updatedEntry.hasOwnProperty('injection_order')) {
    updatedEntry.injection_order = NEW_FIELD_DEFAULTS.injection_order;
  }
  if (!updatedEntry.hasOwnProperty('injection_trigger')) {
    updatedEntry.injection_trigger = [...NEW_FIELD_DEFAULTS.injection_trigger];
  }
  return updatedEntry;
}

function ensureAllEntriesHaveNewFields(entries) {
  return entries.map(entry => ensureNewVersionFields(entry));
}


export {
  hasNewVersionFields,
  extractNewVersionFields,
  applyNewVersionFields,
  transferEntryWithNewFields,
  batchTransferWithNewFields,
  createEntryWithNewFields,
  sortEntriesByOrder,
  ensureNewVersionFields,
  ensureAllEntriesHaveNewFields
};
