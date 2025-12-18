import { getJQuery } from '../core/utils.js';
import { openWorldbookCommonPanel } from './worldbook-common-panel.js';

const BUTTON_ID = 'pt-wb-common-button';
const FALLBACK_BAR_ID = 'pt-wb-common-fallback-bar';
const FALLBACK_HOST_ID = 'pt-wb-common-fallback-host';

let enabled = false;
let rootObserver = null;

function createButton() {
    const $ = getJQuery();
    return $('<div>')
        .attr({ id: BUTTON_ID, tabindex: '0', role: 'button', title: '世界书常用' })
        .addClass('qr--button menu_button interactable')
        .text('世界书常用');
}

function bindButtonEvents($button) {
    $button
        .off('click.pt-wb-common-btn')
        .on('click.pt-wb-common-btn', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await openWorldbookCommonPanel();
        })
        .off('keydown.pt-wb-common-btn')
        .on('keydown.pt-wb-common-btn', async (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.stopPropagation();
            await openWorldbookCommonPanel();
        });
}

function getPreferredHost() {
    const $ = getJQuery();
    const $sendForm = $('#send_form');
    if (!$sendForm.length) return null;

    const $existing = $sendForm.find('.qr--button.menu_button.interactable').first();
    if ($existing.length) {
        const $buttonsHost = $existing.closest('.qr--buttons');
        if ($buttonsHost.length) return $buttonsHost;
        const $host = $existing.parent();
        if ($host.length) return $host;
    }

    const $qrBarHost = $sendForm.find('#qr--bar > .qr--buttons').first();
    if ($qrBarHost.length) return $qrBarHost;

    return null;
}

function ensureFallbackHost() {
    const $ = getJQuery();
    const $sendForm = $('#send_form');
    if (!$sendForm.length) return null;

    let $bar = $(`#${FALLBACK_BAR_ID}`);
    if (!$bar.length) {
        $bar = $('<div>')
            .attr('id', FALLBACK_BAR_ID)
            .addClass('flex-container flexGap5');

        const $host = $('<div>')
            .attr('id', FALLBACK_HOST_ID)
            .addClass('flex-container flexGap5 pt-wb-common-fallback-host');

        $bar.append($host);

        const $firstChild = $sendForm.children().first();
        if ($firstChild.length) $firstChild.before($bar);
        else $sendForm.prepend($bar);
    }

    const $host = $bar.find(`#${FALLBACK_HOST_ID}`);
    return $host.length ? $host : null;
}

function moveButtonIntoHost($host) {
    const $ = getJQuery();
    if (!$host?.length) return false;

    let $button = $(`#${BUTTON_ID}`);
    if (!$button.length) {
        $button = createButton();
    }

    if (!$host.find(`#${BUTTON_ID}`).length) {
        $host.prepend($button);
    }

    bindButtonEvents($button);
    return true;
}

function cleanupFallbackHostIfEmpty() {
    const $ = getJQuery();
    const $bar = $(`#${FALLBACK_BAR_ID}`);
    if (!$bar.length) return;

    const hasButton = $bar.find(`#${BUTTON_ID}`).length > 0;
    if (!hasButton) $bar.remove();
}

function ensureInjected() {
    const $ = getJQuery();
    const $sendForm = $('#send_form');
    if (!$sendForm.length) return false;

    const $preferredHost = getPreferredHost();
    if ($preferredHost?.length) {
        const ok = moveButtonIntoHost($preferredHost);
        if (ok) cleanupFallbackHostIfEmpty();
        return ok;
    }

    const $fallbackHost = ensureFallbackHost();
    if (!$fallbackHost?.length) return false;
    return moveButtonIntoHost($fallbackHost);

    return true;
}

function setupRootObserver() {
    if (rootObserver) return;
    const $ = getJQuery();
    const root = $('body')?.[0] ?? document.body;
    if (!root) return;

    const observer = new MutationObserver(() => {
        if (!enabled) return;
        ensureInjected();
    });
    observer.observe(root, { childList: true, subtree: true });
    rootObserver = observer;
}

function cleanup() {
    const $ = getJQuery();
    $(`#${BUTTON_ID}`).off('.pt-wb-common-btn');
    $(`#${BUTTON_ID}`).remove();
    $(`#${FALLBACK_BAR_ID}`).remove();
}

export function initWorldbookCommonEventButton() {
    if (enabled) return;
    enabled = true;
    setupRootObserver();
    ensureInjected();
}

export function destroyWorldbookCommonEventButton() {
    enabled = false;
    if (rootObserver) {
        try { rootObserver.disconnect(); } catch { /* ignore */ }
        rootObserver = null;
    }
    cleanup();
}
