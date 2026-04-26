import { NEW_FIELD_DEFAULTS } from '../../core/constants.js';
import { ensureUniqueIdentifier, generateUUID } from '../../core/utils.js';
import { batchTransferWithNewFields, ensureAllEntriesHaveNewFields } from '../../preset/new-version-fields.js';
import { getOrderedPromptEntries, getPresetDataFromManager } from '../../preset/preset-manager.js';
import { ensureStitchMeta } from '../../preset/stitch-meta.js';
import { getTargetPromptsList, getOrCreateDummyCharacterPromptOrder } from '../../preset/prompt-order-utils.js';
import { preserveTransferredPresetGroups, reassignPresetGroupingMembers } from '../../features/entry-grouping.js';

function withPtKey(entries) {
    return entries.map(entry => ({
        ...entry,
        ptKey: entry?.name || '',
    }));
}

async function insertEntry(apiInfo, targetPreset, newEntry, insertPosition, autoEnable, displayMode = 'default', options = {}) {
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

    const stitchedPrompt = ensureStitchMeta(newPrompt);
    targetData.prompts.push(stitchedPrompt);
    const newOrderEntry = { identifier: stitchedPrompt.identifier, enabled: !!autoEnable };
    let targetIdentifier = String(options?.targetIdentifier ?? '').trim() || null;
    const targetGroupId = String(options?.targetGroupId ?? '').trim();

    if (insertPosition === 'top') {
        characterPromptOrder.order.unshift(newOrderEntry);
    } else if (typeof insertPosition === 'string' && insertPosition.startsWith('after-')) {
        const afterIndex = parseInt(insertPosition.replace('after-', ''), 10);
        const referencePromptList = getTargetPromptsList(targetPreset, 'include_disabled');

        if (afterIndex >= 0 && afterIndex < referencePromptList.length) {
            const targetPrompt = referencePromptList[afterIndex];
            targetIdentifier = String(targetPrompt?.identifier ?? '').trim() || null;
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

    if (targetIdentifier || targetGroupId) {
        const orderedIdentifiers = characterPromptOrder.order.map(entry => String(entry?.identifier ?? '').trim()).filter(Boolean);
        await reassignPresetGroupingMembers(
            targetPreset,
            [stitchedPrompt.identifier],
            orderedIdentifiers,
            { targetIdentifier, targetGroupId },
        );
    }
}

async function transferEntries(
    apiInfo,
    sourcePreset,
    targetPreset,
    selectedEntries,
    insertPosition,
    autoEnable,
    displayMode = 'default',
    options = {},
) {
    const sourceData = getPresetDataFromManager(apiInfo, sourcePreset);
    const targetData = getPresetDataFromManager(apiInfo, targetPreset);
    if (!sourceData || !targetData) throw new Error('无法获取预设数据');

    if (!targetData.prompts) targetData.prompts = [];
    const characterPromptOrder = getOrCreateDummyCharacterPromptOrder(targetData);

    const targetPromptMap = new Map(targetData.prompts.map((p, i) => [p.name, i]));
    const insertedOrderEntries = [];
    const transferredIdentifierMap = new Map();
    let targetIdentifier = String(options?.targetIdentifier ?? '').trim() || null;
    const targetGroupId = String(options?.targetGroupId ?? '').trim();
    const selectedGroups = Array.isArray(options?.selectedGroups) ? options.selectedGroups : [];

    const entriesToTransfer = batchTransferWithNewFields(selectedEntries);

    entriesToTransfer.forEach((entry, index) => {
        const sourceIdentifier = String(selectedEntries?.[index]?.identifier ?? entry?.identifier ?? '').trim();

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
                insertedOrderEntries.push({ identifier: existingIdentifier, enabled: !!autoEnable });
            }

            if (sourceIdentifier) {
                transferredIdentifierMap.set(sourceIdentifier, existingIdentifier);
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
            const stitchedPrompt = ensureStitchMeta(newPrompt);
            targetData.prompts.push(stitchedPrompt);
            insertedOrderEntries.push({ identifier: stitchedPrompt.identifier, enabled: !!autoEnable });
            if (sourceIdentifier) {
                transferredIdentifierMap.set(sourceIdentifier, stitchedPrompt.identifier);
            }
        }
    });

    if (insertedOrderEntries.length > 0) {
        if (insertPosition === 'top') {
            characterPromptOrder.order.unshift(...insertedOrderEntries);
        } else if (typeof insertPosition === 'string' && insertPosition.startsWith('after-')) {
            const afterIndex = parseInt(insertPosition.replace('after-', ''), 10);
            const referencePromptList = getTargetPromptsList(targetPreset, 'include_disabled');

            if (afterIndex >= 0 && afterIndex < referencePromptList.length) {
                const targetPrompt = referencePromptList[afterIndex];
                targetIdentifier = String(targetPrompt?.identifier ?? '').trim() || null;
                const orderIndex = characterPromptOrder.order.findIndex(e => e.identifier === targetPrompt.identifier);
                if (orderIndex !== -1) {
                    characterPromptOrder.order.splice(orderIndex + 1, 0, ...insertedOrderEntries);
                } else {
                    characterPromptOrder.order.push(...insertedOrderEntries);
                }
            } else {
                characterPromptOrder.order.push(...insertedOrderEntries);
            }
        } else {
            characterPromptOrder.order.push(...insertedOrderEntries);
        }
    }

    await apiInfo.presetManager.savePreset(targetPreset, targetData);

    if ((targetIdentifier || targetGroupId) && insertedOrderEntries.length > 0) {
        const orderedIdentifiers = characterPromptOrder.order.map(entry => String(entry?.identifier ?? '').trim()).filter(Boolean);
        await reassignPresetGroupingMembers(
            targetPreset,
            insertedOrderEntries.map(entry => entry.identifier),
            orderedIdentifiers,
            { targetIdentifier, targetGroupId },
        );
    }

    if (selectedGroups.length > 0) {
        const orderedIdentifiers = characterPromptOrder.order.map(entry => String(entry?.identifier ?? '').trim()).filter(Boolean);
        const preservedGroups = selectedGroups
            .map(group => {
                const memberIdentifiers = (Array.isArray(group?.entryIdentifiers) ? group.entryIdentifiers : [])
                    .map(identifier => transferredIdentifierMap.get(String(identifier ?? '').trim()))
                    .filter(Boolean);

                if (memberIdentifiers.length === 0) return null;
                return {
                    name: String(group?.name ?? '').trim() || '分组',
                    memberIdentifiers,
                };
            })
            .filter(Boolean);

        if (preservedGroups.length > 0) {
            await preserveTransferredPresetGroups(targetPreset, preservedGroups, orderedIdentifiers);
        }
    }
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
                {
                    targetGroupId: params.targetGroupId,
                    targetIdentifier: params.targetIdentifier,
                },
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
                {
                    targetGroupId: params.targetGroupId,
                    targetIdentifier: params.targetIdentifier,
                },
            );
        },
    };
}
