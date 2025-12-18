import { getJQuery } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';
import { getWorldbookFavoritesSet, toggleWorldbookEntryFavorite } from '../features/worldbook-common.js';

let enabled = false;
let rootObserver = null;
let listObserver = null;
let listObserverTarget = null;
let applyQueued = false;
let syncInProgress = false;
let currentWorldbookName = null;
let currentFavorites = new Set();
let favoritesChangedHandlerBound = false;
let favoritesChangedHandler = null;

function bindFavoritesChangedHandler() {
    if (favoritesChangedHandlerBound) return;
    favoritesChangedHandler = async (event) => {
        if (!enabled) return;
        const worldbookName = String(event?.detail?.worldbookName ?? '').trim();
        if (!worldbookName) return;
        if (!currentWorldbookName || currentWorldbookName !== worldbookName) return;
        currentFavorites = await getWorldbookFavoritesSet(worldbookName, { forceRefresh: true });
        queueApply();
    };

    try {
        const pw = window.parent && window.parent !== window ? window.parent : window;
        pw.addEventListener('pt:worldbook-common-favorites-changed', favoritesChangedHandler);
        favoritesChangedHandlerBound = true;
    } catch {
        /* ignore */
    }
}

function unbindFavoritesChangedHandler() {
    if (!favoritesChangedHandlerBound) return;
    try {
        const pw = window.parent && window.parent !== window ? window.parent : window;
        if (favoritesChangedHandler) {
            pw.removeEventListener('pt:worldbook-common-favorites-changed', favoritesChangedHandler);
        }
    } catch {
        /* ignore */
    }
    favoritesChangedHandlerBound = false;
    favoritesChangedHandler = null;
}

function getCurrentWorldbookName() {
    const $ = getJQuery();
    const $select = $('#world_editor_select');
    if (!$select.length) return null;
    const value = String($select.val() ?? '').trim();
    if (!value) return null;
    const $opt = $select.find('option:selected');
    const text = String($opt?.text?.() ?? '').trim();
    return text || null;
}

function findListContainer() {
    const $ = getJQuery();
    return $('#world_popup_entries_list');
}

function applyThemeVarsToContainer($container) {
    if (!$container?.length) return;
    const vars = CommonStyles.getVars();
    $container.addClass('pt-wb-common-root');
    const el = $container[0];
    el.style.setProperty('--pt-section-bg', vars.sectionBg);
    el.style.setProperty('--pt-border', vars.borderColor);
    el.style.setProperty('--pt-text', vars.textColor);
    el.style.setProperty('--pt-tip', vars.tipColor);
}

function getUidFromWorldEntryEl(el) {
    const $ = getJQuery();
    const $el = $(el);
    const dataUid = $el.data('uid');
    if (dataUid != null && String(dataUid).trim()) return String(dataUid).trim();
    const attrUid = $el.attr('uid');
    if (attrUid != null && String(attrUid).trim()) return String(attrUid).trim();
    const dataAttrUid = $el.attr('data-uid');
    if (dataAttrUid != null && String(dataAttrUid).trim()) return String(dataAttrUid).trim();
    return '';
}

function ensureFavoriteButton($entry, uid, isFavorite) {
    const $ = getJQuery();
    const $headerRow = $entry.find('.inline-drawer-header .world_entry_thin_controls').first();
    if (!$headerRow.length) return;

    let $btn = $entry.find('.pt-wb-common-fav-toggle').first();
    if (!$btn.length) {
        $btn = $('<div>')
            .addClass('pt-wb-common-fav-toggle fa-fw')
            .attr({
                role: 'button',
                tabindex: '0',
                title: '加入世界书常用',
            })
            .data('uid', uid);

        const $toggle = $headerRow.find('.killSwitch').first();
        if ($toggle.length) $toggle.after($btn);
        else $headerRow.prepend($btn);
    }

    $btn.toggleClass('is-favorite', !!isFavorite);
    $btn.addClass('fa-star');
    $btn.toggleClass('fa-solid', !!isFavorite);
    $btn.toggleClass('fa-regular', !isFavorite);

    $btn.attr('title', isFavorite ? '从世界书常用移除' : '加入世界书常用');
}

async function refreshFavoritesForWorldbook(worldbookName) {
    currentWorldbookName = worldbookName;
    currentFavorites = await getWorldbookFavoritesSet(worldbookName, { forceRefresh: true });
}

async function applyToList() {
    if (!enabled) return;
    const $ = getJQuery();
    const $list = findListContainer();
    if (!$list.length) return;

    applyThemeVarsToContainer($list);

    const name = getCurrentWorldbookName();
    if (!name) return;

    if (name !== currentWorldbookName) {
        await refreshFavoritesForWorldbook(name);
    }

    $list.find('.world_entry').each(function () {
        const uid = getUidFromWorldEntryEl(this);
        if (!uid) return;
        ensureFavoriteButton($(this), uid, currentFavorites.has(uid));
    });
}

function queueApply() {
    if (!enabled) return;
    if (applyQueued) return;
    applyQueued = true;
    Promise.resolve().then(() => {
        applyQueued = false;
        void applyToList();
    });
}

function bindEvents() {
    const $ = getJQuery();
    const $list = findListContainer();
    if (!$list.length) return false;

    $list.off('click.pt-wb-common');
    $list.on('click.pt-wb-common', '.pt-wb-common-fav-toggle', async function (e) {
        e.preventDefault();
        e.stopPropagation();

        const worldbookName = getCurrentWorldbookName();
        if (!worldbookName) return;

        const uid = String($(this).data('uid') ?? '').trim();
        if (!uid) return;

        try {
            await toggleWorldbookEntryFavorite(worldbookName, uid);
            currentFavorites = await getWorldbookFavoritesSet(worldbookName, { forceRefresh: true });
            queueApply();
        } catch (err) {
            console.error('PresetTransfer: failed to toggle worldbook common favorite', err);
            if (window.toastr) toastr.error('操作失败: ' + (err?.message ?? err));
        }
    });

    $list.off('keydown.pt-wb-common');
    $list.on('keydown.pt-wb-common', '.pt-wb-common-fav-toggle', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        $(this).trigger('click');
    });

    $('#world_editor_select')
        .off('change.pt-wb-common')
        .on('change.pt-wb-common', async () => {
            const nextName = getCurrentWorldbookName();
            if (!nextName) return;
            await refreshFavoritesForWorldbook(nextName);
            queueApply();
        });

    return true;
}

function setupObserver() {
    const $list = findListContainer();
    if (!$list.length) return;

    if (listObserver) {
        try { listObserver.disconnect(); } catch { /* ignore */ }
        listObserver = null;
    }

    listObserver = new MutationObserver(() => queueApply());
    listObserver.observe($list[0], { childList: true, subtree: true });
    listObserverTarget = $list[0];
}

function detachFromList() {
    if (listObserver) {
        try { listObserver.disconnect(); } catch { /* ignore */ }
        listObserver = null;
    }
    listObserverTarget = null;

    try {
        const $ = getJQuery();
        $('#world_editor_select').off('change.pt-wb-common');
        const $list = findListContainer();
        if ($list?.length) {
            $list.off('click.pt-wb-common');
            $list.off('keydown.pt-wb-common');
            $list.find('.pt-wb-common-fav-toggle').remove();
            $list.removeClass('pt-wb-common-root');
        }
    } catch {
        /* ignore */
    }
}

async function attachToList() {
    const $ = getJQuery();
    if (!$?.fn) return false;

    const $list = findListContainer();
    if (!$list.length) return false;

    const name = getCurrentWorldbookName();
    if (name) await refreshFavoritesForWorldbook(name);

    const ok = bindEvents();
    if (!ok) return false;
    setupObserver();
    setTimeout(() => queueApply(), 0);
    return true;
}

function setupRootObserver() {
    if (rootObserver) return;

    const $ = getJQuery();
    const root = $('body')?.[0] ?? document.body;
    if (!root) return;

    const observer = new MutationObserver(() => void syncAttachment());
    observer.observe(root, { childList: true, subtree: true });
    rootObserver = observer;
}

async function syncAttachment() {
    if (!enabled) return;
    if (syncInProgress) return;
    syncInProgress = true;
    try {
        const $list = findListContainer();
        const listEl = $list?.[0] ?? null;

        if (!listEl) {
            if (listObserver) detachFromList();
            return;
        }

        if (listObserver && listObserverTarget === listEl) return;
        if (listObserver) detachFromList();
        await attachToList();
    } finally {
        syncInProgress = false;
    }
}

export function initWorldbookCommonEntryUi() {
    if (enabled) return;
    enabled = true;
    setupRootObserver();
    bindFavoritesChangedHandler();
    void syncAttachment();
}

export function destroyWorldbookCommonEntryUi() {
    enabled = false;

    if (rootObserver) {
        try { rootObserver.disconnect(); } catch { /* ignore */ }
        rootObserver = null;
    }

    unbindFavoritesChangedHandler();
    detachFromList();

    applyQueued = false;
    currentWorldbookName = null;
    currentFavorites = new Set();
    syncInProgress = false;
}
