import { NEW_FIELD_DEFAULTS } from '../../core/constants.js';
import { ensureUniqueIdentifier, generateUUID } from '../../core/utils.js';
import { batchTransferWithNewFields, ensureAllEntriesHaveNewFields } from '../../preset/new-version-fields.js';
import { getOrderedPromptEntries, getPresetDataFromManager } from '../../preset/preset-manager.js';
import { getTargetPromptsList, getOrCreateDummyCharacterPromptOrder } from '../../preset/prompt-order-utils.js';

function withPtKey(entries) {
    return entries.map(entry => ({
        ...entry,
        ptKey: entry?.name || '',
    }));
}

async function insertEntry(apiInfo, targetPreset, newEntry, insertPosition, autoEnable, displayMode = 'default') {
    const targetData = getPresetDataFromManager(apiInfo, targetPreset);
    if (!targetData) throw new Error('无法获取目标预设数据');

    if (!targetData.prompts) targetData.prompts = [];
    const characterPromptOrder = getOrCreateDummyCharacterPromptOrder(targetData);

    const newPrompt = {
        ...newEntry,
        identifier: ensureUniqueIdentifier(targetData, newEntry.identifier || generateUUID()),
        injection_order: newEntry.injection_order ?? NEW_FIELD_DEFAULTS.injection_order,
        injection_trigger: Array.isArray(newEntry.injection_trigger)
            ? [...newEntry.injection_trigger]
            : [...NEW_FIELD_DEFAULTS.injection_trigger],
        forbid_overrides: newEntry.forbid_overrides || false,
        system_prompt: newEntry.system_prompt || false,
        marker: newEntry.marker || false,
    };
    delete newPrompt.isNewEntry;

    targetData.prompts.push(newPrompt);
    const newOrderEntry = { identifier: newPrompt.identifier, enabled: !!autoEnable };

    if (insertPosition === 'top') {
        characterPromptOrder.order.unshift(newOrderEntry);
    } else if (typeof insertPosition === 'string' && insertPosition.startsWith('after-')) {
        const afterIndex = parseInt(insertPosition.replace('after-', ''), 10);
        const referencePromptList = getTargetPromptsList(targetPreset, 'include_disabled');

        if (afterIndex >= 0 && afterIndex < referencePromptList.length) {
            const targetPrompt = referencePromptList[afterIndex];
            const orderIndex = characterPromptOrder.order.findIndex(e => e.identifier === targetPrompt.identifier);
            if (orderIndex !== -1) {
                characterPromptOrder.order.splice(orderIndex + 1, 0, newOrderEntry);
            } else {
                characterPromptOrder.order.push(newOrderEntry);
            }
        } else {
            characterPromptOrder.order.push(newOrderEntry);
        }
    } else {
        characterPromptOrder.order.push(newOrderEntry);
    }

    await apiInfo.presetManager.savePreset(targetPreset, targetData);
}

async function transferEntries(
    apiInfo,
    sourcePreset,
    targetPreset,
    selectedEntries,
    insertPosition,
    autoEnable,
    displayMode = 'default',
) {
    const sourceData = getPresetDataFromManager(apiInfo, sourcePreset);
    const targetData = getPresetDataFromManager(apiInfo, targetPreset);
    if (!sourceData || !targetData) throw new Error('无法获取预设数据');

    if (!targetData.prompts) targetData.prompts = [];
    const characterPromptOrder = getOrCreateDummyCharacterPromptOrder(targetData);

    const targetPromptMap = new Map(targetData.prompts.map((p, i) => [p.name, i]));
    const newOrderEntries = [];

    const entriesToTransfer = batchTransferWithNewFields(selectedEntries);

    entriesToTransfer.forEach(entry => {
        if (targetPromptMap.has(entry.name)) {
            const targetIndex = targetPromptMap.get(entry.name);
            const existingIdentifier = targetData.prompts[targetIndex].identifier;
            targetData.prompts[targetIndex] = {
                ...targetData.prompts[targetIndex],
                ...entry,
                identifier: existingIdentifier,
                injection_order: entry.injection_order ?? NEW_FIELD_DEFAULTS.injection_order,
                injection_trigger: Array.isArray(entry.injection_trigger)
                    ? [...entry.injection_trigger]
                    : [...NEW_FIELD_DEFAULTS.injection_trigger],
            };

            // If the entry exists but isn't in prompt_order (uninserted), make sure it's inserted.
            // Preserve existing enabled state when present; otherwise apply the current autoEnable setting.
            const existingOrderEntry = characterPromptOrder.order.find(o => o.identifier === existingIdentifier);
            if (!existingOrderEntry) {
                characterPromptOrder.order.push({ identifier: existingIdentifier, enabled: !!autoEnable });
            }
        } else {
            const newPrompt = {
                ...entry,
                identifier: ensureUniqueIdentifier(targetData, entry.identifier || generateUUID()),
                injection_order: entry.injection_order ?? NEW_FIELD_DEFAULTS.injection_order,
                injection_trigger: Array.isArray(entry.injection_trigger)
                    ? [...entry.injection_trigger]
                    : [...NEW_FIELD_DEFAULTS.injection_trigger],
            };
            targetData.prompts.push(newPrompt);
            newOrderEntries.push({ identifier: newPrompt.identifier, enabled: !!autoEnable });
        }
    });

    if (newOrderEntries.length > 0) {
        if (insertPosition === 'top') {
            characterPromptOrder.order.unshift(...newOrderEntries);
        } else if (typeof insertPosition === 'string' && insertPosition.startsWith('after-')) {
            const afterIndex = parseInt(insertPosition.replace('after-', ''), 10);
            const referencePromptList = getTargetPromptsList(targetPreset, 'include_disabled');

            if (afterIndex >= 0 && afterIndex < referencePromptList.length) {
                const targetPrompt = referencePromptList[afterIndex];
                const orderIndex = characterPromptOrder.order.findIndex(e => e.identifier === targetPrompt.identifier);
                if (orderIndex !== -1) {
                    characterPromptOrder.order.splice(orderIndex + 1, 0, ...newOrderEntries);
                } else {
                    characterPromptOrder.order.push(...newOrderEntries);
                }
            } else {
                characterPromptOrder.order.push(...newOrderEntries);
            }
        } else {
            characterPromptOrder.order.push(...newOrderEntries);
        }
    }

    await apiInfo.presetManager.savePreset(targetPreset, targetData);
}

async function deleteEntries(apiInfo, presetName, selectedEntries) {
    const sourceData = getPresetDataFromManager(apiInfo, presetName);
    if (!sourceData) throw new Error('无法获取源预设数据');
    if (!sourceData.prompts) sourceData.prompts = [];
    if (!sourceData.prompt_order) sourceData.prompt_order = [];

    const dummyCharacterId = 100001;
    let characterPromptOrder = sourceData.prompt_order.find(order => order.character_id === dummyCharacterId);
    if (!characterPromptOrder) {
        characterPromptOrder = { character_id: dummyCharacterId, order: [] };
        sourceData.prompt_order.push(characterPromptOrder);
    }

    const namesToDelete = new Set(selectedEntries.map(entry => entry.name));
    const identifiersToDelete = new Set(selectedEntries.map(entry => entry.identifier));

    sourceData.prompts = sourceData.prompts.filter(p => !(p && p.name && namesToDelete.has(p.name)));
    characterPromptOrder.order = characterPromptOrder.order.filter(o => !identifiersToDelete.has(o.identifier));

    await apiInfo.presetManager.savePreset(presetName, sourceData);
}

export function createPresetTransferAdapter() {
    return {
        id: 'preset',
        ui: {
            toolTitle: '预设条目转移工具',
            containerLabel: '预设',
        },
        capabilities: {
            supportsInsertPosition: true,
            supportsUninsertedMode: true,
            supportsEdit: true,
            supportsCopy: true,
            supportsMove: true,
            supportsCompare: true,
            supportsBatchDeleteContainers: true,
        },
        async listContainers(apiInfo) {
            return Array.isArray(apiInfo?.presetNames) ? apiInfo.presetNames.slice() : [];
        },
        async getEntries(apiInfo, name, displayMode) {
            const presetData = getPresetDataFromManager(apiInfo, name);
            const entries = ensureAllEntriesHaveNewFields(getOrderedPromptEntries(presetData, displayMode));
            return withPtKey(entries);
        },
        async transfer(apiInfo, params) {
            return await transferEntries(
                apiInfo,
                params.sourceContainer,
                params.targetContainer,
                params.entries,
                params.insertPosition,
                params.autoEnable,
                params.displayMode,
            );
        },
        async deleteEntries(apiInfo, params) {
            return await deleteEntries(apiInfo, params.container, params.entries);
        },
        async insertEntry(apiInfo, params) {
            return await insertEntry(
                apiInfo,
                params.container,
                params.entry,
                params.insertPosition,
                params.autoEnable,
                params.displayMode,
            );
        },
    };
}
