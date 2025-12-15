import { generateUUID } from '../../core/utils.js';

let worldInfoModulePromise = null;

async function getWorldInfoModule() {
    if (!worldInfoModulePromise) {
        worldInfoModulePromise = import('/scripts/world-info.js');
    }
    return await worldInfoModulePromise;
}

function normalizeKeyArray(value) {
    if (!Array.isArray(value)) return '';
    return value
        .map(v => String(v ?? '').trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .join('|');
}

function buildSignature(entry) {
    const comment = String(entry?.comment ?? '').trim();
    const key = normalizeKeyArray(entry?.key);
    const keysecondary = normalizeKeyArray(entry?.keysecondary);
    return `${comment}||${key}||${keysecondary}`;
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

function sortWorldEntries(a, b) {
    const ao = Number(a?.order ?? 0);
    const bo = Number(b?.order ?? 0);
    if (ao !== bo) return bo - ao;
    const au = Number(a?.uid ?? 0);
    const bu = Number(b?.uid ?? 0);
    return au - bu;
}

async function listWorldbooks() {
    const mod = await getWorldInfoModule();
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
    const filtered =
        displayMode === 'include_disabled' ? values : values.filter(e => !e.disable);
    filtered.sort(sortWorldEntries);
    return filtered.map(entry => {
        const signature = buildSignature(entry);
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

function getFreeUidFallback(targetData) {
    const entriesObj = targetData?.entries && typeof targetData.entries === 'object' ? targetData.entries : {};
    const used = new Set(Object.values(entriesObj).map(e => Number(e?.uid)).filter(Number.isFinite));
    let uid = 0;
    while (used.has(uid)) uid += 1;
    return uid;
}

function cloneWorldEntry(sourceEntry) {
    const clone = JSON.parse(JSON.stringify(sourceEntry ?? {}));
    delete clone.uid;
    return clone;
}

function getTriggerModeLabel(entry) {
    if (entry?.constant) return '常驻';
    const hasPrimaryKeys =
        Array.isArray(entry?.key) && entry.key.map(v => String(v ?? '').trim()).filter(Boolean).length > 0;
    return hasPrimaryKeys ? '关键词' : '无关键词';
}

async function transferWorldEntries(apiInfo, sourceName, targetName, entries, autoEnable) {
    void apiInfo;
    const sourceData = await loadWorldbook(sourceName);
    const targetData = await loadWorldbook(targetName);

    if (!targetData.entries || typeof targetData.entries !== 'object') {
        targetData.entries = {};
    }

    const targetSignatureToUid = new Map();
    for (const entry of Object.values(targetData.entries)) {
        if (!entry) continue;
        targetSignatureToUid.set(buildSignature(entry), Number(entry.uid));
    }

    const sourceEntriesObj = sourceData?.entries && typeof sourceData.entries === 'object' ? sourceData.entries : {};
    const sourceByUid = new Map(Object.values(sourceEntriesObj).filter(Boolean).map(e => [String(e.uid), e]));

    const mod = await getWorldInfoModule();
    const getFreeWorldEntryUid =
        typeof mod.getFreeWorldEntryUid === 'function' ? mod.getFreeWorldEntryUid : null;

    for (const item of entries) {
        const src = item?.raw ?? sourceByUid.get(String(item.identifier));
        if (!src) continue;

        const signature = buildSignature(src);
        const existingUid = targetSignatureToUid.get(signature);
        const clone = cloneWorldEntry(src);
        if (autoEnable) {
            clone.disable = false;
        }

        if (Number.isFinite(existingUid)) {
            targetData.entries[String(existingUid)] = { uid: existingUid, ...clone };
        } else {
            const newUid = getFreeWorldEntryUid ? getFreeWorldEntryUid(targetData) : getFreeUidFallback(targetData);
            targetData.entries[String(newUid)] = { uid: newUid, ...clone };
            targetSignatureToUid.set(signature, newUid);
        }
    }

    await saveWorldbook(targetName, targetData);
}

async function deleteWorldEntries(apiInfo, worldbookName, entries) {
    void apiInfo;
    const data = await loadWorldbook(worldbookName);

    if (!data.entries || typeof data.entries !== 'object') {
        data.entries = {};
    }

    const mod = await getWorldInfoModule();
    const deleteWorldInfoEntry =
        typeof mod.deleteWorldInfoEntry === 'function' ? mod.deleteWorldInfoEntry : null;

    for (const item of entries) {
        const uid = item?.raw?.uid ?? Number(item?.identifier);
        if (!Number.isFinite(uid)) continue;

        if (deleteWorldInfoEntry) {
            await deleteWorldInfoEntry(data, uid, { silent: true });
        } else {
            delete data.entries[String(uid)];
        }
    }

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
