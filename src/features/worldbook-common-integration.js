import { initWorldbookCommonGlobalMountTracking, destroyWorldbookCommonGlobalMountTracking } from './worldbook-common.js';
import { ensureWorldbookCommonSlashCommand } from './worldbook-common-slash-command.js';
import { initWorldbookCommonEntryUi, destroyWorldbookCommonEntryUi } from '../ui/worldbook-common-entry-ui.js';
import { initWorldbookCommonEventButton, destroyWorldbookCommonEventButton } from '../ui/worldbook-common-event-button.js';

const QUICK_REPLY_LABEL = '世界书常用';
const QUICK_REPLY_MESSAGE = '/pt-wb-common';
const QUICK_REPLY_TITLE = '打开世界书常用面板';

let active = false;
let quickReplyRetryTimer = null;
let quickReplyRetryDelayMs = 800;
let quickReplyRetryAttempts = 0;
const QUICK_REPLY_MAX_ATTEMPTS = 12;
let quickReplyCleanupTimer = null;
let quickReplyCleanupDelayMs = 800;
let quickReplyCleanupAttempts = 0;
const QUICK_REPLY_CLEANUP_MAX_ATTEMPTS = 16;

async function ensureQuickReply() {
    const api = globalThis.quickReplyApi;
    if (!api || typeof api.createQuickReply !== 'function') return false;

    const listGlobalSets = typeof api.listGlobalSets === 'function' ? api.listGlobalSets.bind(api) : null;
    const getSetByName = typeof api.getSetByName === 'function' ? api.getSetByName.bind(api) : null;
    const createSet = typeof api.createSet === 'function' ? api.createSet.bind(api) : null;
    const getQrByLabel = typeof api.getQrByLabel === 'function' ? api.getQrByLabel.bind(api) : null;
    const updateQuickReply = typeof api.updateQuickReply === 'function' ? api.updateQuickReply.bind(api) : null;

    const globalSets = listGlobalSets ? listGlobalSets() : [];
    const targetSetName = String(globalSets?.[0] ?? 'Default');

    if (getSetByName && !getSetByName(targetSetName) && createSet) {
        await createSet(targetSetName);
    }

    if ((!globalSets || globalSets.length === 0) && typeof api.addGlobalSet === 'function') {
        try {
            api.addGlobalSet(targetSetName, true);
        } catch {
            /* ignore */
        }
    }

    const existing = getQrByLabel ? getQrByLabel(targetSetName, QUICK_REPLY_LABEL) : null;
    if (existing && updateQuickReply) {
        updateQuickReply(targetSetName, QUICK_REPLY_LABEL, {
            message: QUICK_REPLY_MESSAGE,
            title: QUICK_REPLY_TITLE,
            showLabel: true,
        });
        return true;
    }

    api.createQuickReply(targetSetName, QUICK_REPLY_LABEL, {
        message: QUICK_REPLY_MESSAGE,
        title: QUICK_REPLY_TITLE,
        showLabel: true,
    });
    return true;
}

async function removeQuickReply() {
    const api = globalThis.quickReplyApi;
    if (!api || typeof api.deleteQuickReply !== 'function' || typeof api.getQrByLabel !== 'function') return false;

    const listSets = typeof api.listSets === 'function' ? api.listSets.bind(api) : null;
    const setNames = listSets ? listSets() : [];
    let removed = false;

    for (const setName of setNames) {
        try {
            const qr = api.getQrByLabel(setName, QUICK_REPLY_LABEL);
            if (!qr) continue;
            const msg = String(qr?.message ?? '').trim();
            if (msg !== QUICK_REPLY_MESSAGE) continue;
            api.deleteQuickReply(setName, QUICK_REPLY_LABEL);
            removed = true;
        } catch {
            /* ignore */
        }
    }

    return removed;
}

function stopQuickReplyRetry() {
    if (quickReplyRetryTimer) {
        clearTimeout(quickReplyRetryTimer);
        quickReplyRetryTimer = null;
    }
    quickReplyRetryDelayMs = 800;
    quickReplyRetryAttempts = 0;
}

function stopQuickReplyCleanupRetry() {
    if (quickReplyCleanupTimer) {
        clearTimeout(quickReplyCleanupTimer);
        quickReplyCleanupTimer = null;
    }
    quickReplyCleanupDelayMs = 800;
    quickReplyCleanupAttempts = 0;
}

function startQuickReplyRetry() {
    stopQuickReplyRetry();
    stopQuickReplyCleanupRetry();

    const attempt = async () => {
        if (!active) return;
        quickReplyRetryAttempts += 1;
        if (quickReplyRetryAttempts > QUICK_REPLY_MAX_ATTEMPTS) {
            stopQuickReplyRetry();
            return;
        }
        const ok = await ensureQuickReply();
        if (ok) {
            stopQuickReplyRetry();
            return;
        }
        quickReplyRetryDelayMs = Math.min(quickReplyRetryDelayMs * 1.6, 8000);
        quickReplyRetryTimer = setTimeout(attempt, quickReplyRetryDelayMs);
    };

    quickReplyRetryTimer = setTimeout(attempt, quickReplyRetryDelayMs);
}

function startQuickReplyCleanupRetry() {
    if (quickReplyCleanupTimer) return;
    stopQuickReplyCleanupRetry();
    stopQuickReplyRetry();

    const attempt = async () => {
        if (active) return;
        quickReplyCleanupAttempts += 1;
        if (quickReplyCleanupAttempts > QUICK_REPLY_CLEANUP_MAX_ATTEMPTS) {
            stopQuickReplyCleanupRetry();
            return;
        }

        const removed = await removeQuickReply();
        if (removed) {
            stopQuickReplyCleanupRetry();
            return;
        }

        quickReplyCleanupDelayMs = Math.min(quickReplyCleanupDelayMs * 1.6, 12000);
        quickReplyCleanupTimer = setTimeout(attempt, quickReplyCleanupDelayMs);
    };

    quickReplyCleanupTimer = setTimeout(attempt, quickReplyCleanupDelayMs);
}

export async function setWorldbookCommonFeatureActive(enabled) {
    const nextActive = !!enabled;
    const prevActive = active;
    active = nextActive;

    await ensureWorldbookCommonSlashCommand({ enabled: () => active });

    if (!active) {
        startQuickReplyCleanupRetry();
        stopQuickReplyRetry();
        await removeQuickReply();
        destroyWorldbookCommonGlobalMountTracking();
        destroyWorldbookCommonEntryUi();
        destroyWorldbookCommonEventButton();
        return;
    }

    if (prevActive) return;

    initWorldbookCommonGlobalMountTracking();
    initWorldbookCommonEntryUi();
    initWorldbookCommonEventButton();
    // Do not auto-create Quick Reply entries; keep a stable standalone button instead.
}
