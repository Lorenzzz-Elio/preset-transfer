import { generateUUID } from '../../core/utils.js';
import {
    buildWorldEntrySignature,
    sortWorldEntries,
    applyTransferEntriesToWorldbook,
    applyDeleteEntriesFromWorldbook,
} from '../../core/worldbook-data-pure.js';

let worldInfoModulePromise = null;

async function getWorldInfoModule() {
    if (!worldInfoModulePromise) {
        worldInfoModulePromise = import('/scripts/world-info.js');
    }
    return await worldInfoModulePromise;
}

async function waitForWorldInfoNames(mod, { timeoutMs = 800, intervalMs = 50 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (Array.isArray(mod?.world_names)) return true;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
}

function mapPosition(position) {
    switch (Number(position)) {
        case 0:
            return '角色定义之前';
        case 1:
            return '角色定义之后';
        case 2:
            return '作者注释之前';
        case 3:
            return '作者注释之后';
        case 4:
            return '@D';
        case 5:
            return '↑EM';
        case 6:
            return '↓EM';
        default:
            return String(position ?? '');
    }
}

async function listWorldbooks() {
    const mod = await getWorldInfoModule();

    // Fast path: SillyTavern already loaded world_names during startup.
    if (Array.isArray(mod.world_names)) {
        return mod.world_names.slice();
    }

    // Best-effort wait: world-info may still be initializing when this extension runs.
    const ready = await waitForWorldInfoNames(mod);
    if (ready && Array.isArray(mod.world_names)) {
        return mod.world_names.slice();
    }

    // Slow fallback (also updates SillyTavern DOM): only do this when absolutely necessary.
    if (typeof mod.updateWorldInfoList === 'function') {
        await mod.updateWorldInfoList();
    }

    return Array.isArray(mod.world_names) ? mod.world_names.slice() : [];
}

async function loadWorldbook(name) {
    const mod = await getWorldInfoModule();
    if (typeof mod.loadWorldInfo !== 'function') {
        throw new Error('World Info module missing loadWorldInfo');
    }
    const data = await mod.loadWorldInfo(name);
    if (!data || typeof data !== 'object') {
        throw new Error(`无法加载世界书: ${name}`);
    }
    return data;
}

async function saveWorldbook(name, data) {
    const mod = await getWorldInfoModule();
    if (typeof mod.saveWorldInfo !== 'function') {
        throw new Error('World Info module missing saveWorldInfo');
    }
    await mod.saveWorldInfo(name, data, true);
}

function getEntriesFromWorldbookData(data, displayMode) {
    const entriesObj = data?.entries && typeof data.entries === 'object' ? data.entries : {};
    const values = Object.values(entriesObj).filter(Boolean);
    const mode = String(displayMode ?? '').trim();
    const hasPrimaryKeys = (entry) =>
        Array.isArray(entry?.key) && entry.key.some((v) => String(v ?? '').trim());

    // Worldbook list view is trigger-type oriented (no "enabled-only" mode).
    let filtered = values;
    if (mode === 'wb_constant') {
        filtered = values.filter((e) => !!e?.constant);
    } else if (mode === 'wb_keyword') {
        filtered = values.filter((e) => !e?.constant && hasPrimaryKeys(e));
    } else {
        // default / include_disabled / unknown -> show all
        filtered = values;
    }
    filtered.sort(sortWorldEntries);
    return filtered.map(entry => {
        const signature = buildWorldEntrySignature(entry);
        return {
            identifier: String(entry.uid ?? generateUUID()),
            name: String(entry.comment ?? ''),
            content: String(entry.content ?? ''),
            enabled: !entry.disable,
            ptKey: signature,
            raw: entry,
            role: getTriggerModeLabel(entry),
            injection_position: mapPosition(entry.position),
            injection_depth: Number(entry.depth ?? 0),
            injection_order: Number(entry.order ?? 0),
            injection_trigger: Array.isArray(entry.triggers) ? entry.triggers.map(String) : [],
        };
    });
}

function getTriggerModeLabel(entry) {
    if (entry?.constant) return '常驻';
    const hasPrimaryKeys =
        Array.isArray(entry?.key) && entry.key.map(v => String(v ?? '').trim()).filter(Boolean).length > 0;
    return hasPrimaryKeys ? '关键词' : '无关键词';
}

async function transferWorldEntries(apiInfo, sourceName, targetName, entries, autoEnable) {
    const sourceData = await loadWorldbook(sourceName);
    const targetData = await loadWorldbook(targetName);

    const mod = await getWorldInfoModule();
    const getFreeWorldEntryUid =
        typeof mod.getFreeWorldEntryUid === 'function' ? mod.getFreeWorldEntryUid : null;

    applyTransferEntriesToWorldbook(targetData, entries, {
        autoEnable,
        sourceData,
        getFreeUidFn: getFreeWorldEntryUid,
    });

    await saveWorldbook(targetName, targetData);
}

async function deleteWorldEntries(apiInfo, worldbookName, entries) {
    void apiInfo;
    const data = await loadWorldbook(worldbookName);

    const mod = await getWorldInfoModule();
    const deleteWorldInfoEntry =
        typeof mod.deleteWorldInfoEntry === 'function' ? mod.deleteWorldInfoEntry : null;

    applyDeleteEntriesFromWorldbook(data, entries, {
        deleteEntryFn: deleteWorldInfoEntry,
    });

    await saveWorldbook(worldbookName, data);
}

export function createWorldbookTransferAdapter() {
    return {
        id: 'worldbook',
        ui: {
            toolTitle: '世界书条目转移工具',
            containerLabel: '世界书',
        },
        capabilities: {
            supportsInsertPosition: false,
            supportsUninsertedMode: false,
            supportsEdit: true,
            supportsCopy: true,
            supportsMove: false,
            supportsCompare: false,
            supportsBatchDeleteContainers: true,
        },
        async listContainers(apiInfo) {
            void apiInfo;
            return await listWorldbooks();
        },
        async getEntries(apiInfo, name, displayMode) {
            void apiInfo;
            const data = await loadWorldbook(name);
            return getEntriesFromWorldbookData(data, displayMode);
        },
        async transfer(apiInfo, params) {
            return await transferWorldEntries(
                apiInfo,
                params.sourceContainer,
                params.targetContainer,
                params.entries,
                params.autoEnable,
            );
        },
        async deleteEntries(apiInfo, params) {
            return await deleteWorldEntries(apiInfo, params.container, params.entries);
        },
    };
}
