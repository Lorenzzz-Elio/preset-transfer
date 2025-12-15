import { getCurrentApiInfo } from '../core/utils.js';
import { getPresetDataFromManager, getPromptEntries } from './preset-manager.js';

function getTargetPromptsList(targetPreset, displayMode = 'default') {
    try {
        const apiInfo = getCurrentApiInfo();
        if (!apiInfo) return [];
        const presetData = getPresetDataFromManager(apiInfo, targetPreset);
        if (!presetData) return [];

        if (!presetData.prompts || !Array.isArray(presetData.prompts)) {
            return [];
        }

        const dummyCharacterId = 100001;
        const characterPromptOrder = presetData.prompt_order?.find(order => order.character_id === dummyCharacterId);

        if (!characterPromptOrder) {
            return getPromptEntries(presetData);
        }

        const orderedEntries = [];
        const promptMap = new Map(presetData.prompts.map(p => [p.identifier, p]));

        characterPromptOrder.order.forEach(orderEntry => {
            const prompt = promptMap.get(orderEntry.identifier);
            if (prompt && !prompt.system_prompt && !prompt.marker && prompt.name && prompt.name.trim() !== '') {
                const entryWithStatus = {
                    ...prompt,
                    enabled: orderEntry.enabled,
                    orderIndex: orderedEntries.length,
                };

                if (displayMode === 'default' && !orderEntry.enabled) {
                    entryWithStatus.hiddenInDefaultMode = true;
                }

                orderedEntries.push(entryWithStatus);
            }
        });

        if (displayMode === 'default') {
            return orderedEntries.filter(entry => !entry.hiddenInDefaultMode);
        }

        return orderedEntries;
    } catch (error) {
        console.error('获取目标提示词列表失败:', error);
        return [];
    }
}

function getOrCreateDummyCharacterPromptOrder(presetData) {
    if (!presetData.prompt_order) {
        presetData.prompt_order = [];
    }
    const dummyCharacterId = 100001;
    let characterPromptOrder = presetData.prompt_order.find(order => order.character_id === dummyCharacterId);
    if (!characterPromptOrder) {
        characterPromptOrder = {
            character_id: dummyCharacterId,
            order: [
                { identifier: 'main', enabled: true },
                { identifier: 'worldInfoBefore', enabled: true },
                { identifier: 'personaDescription', enabled: true },
                { identifier: 'charDescription', enabled: true },
                { identifier: 'charPersonality', enabled: true },
                { identifier: 'scenario', enabled: true },
                { identifier: 'enhanceDefinitions', enabled: false },
                { identifier: 'nsfw', enabled: true },
                { identifier: 'worldInfoAfter', enabled: true },
                { identifier: 'dialogueExamples', enabled: true },
                { identifier: 'chatHistory', enabled: true },
                { identifier: 'jailbreak', enabled: true },
            ],
        };
        presetData.prompt_order.push(characterPromptOrder);
    }
    return characterPromptOrder;
}

export { getOrCreateDummyCharacterPromptOrder, getTargetPromptsList };

