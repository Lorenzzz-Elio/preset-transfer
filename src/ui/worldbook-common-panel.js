import { ensureViewportCssVars, escapeHtml, getJQuery } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';
import {
    listWorldbookCommonItems,
    setWorldbookCommonEntriesEnabled,
    setWorldbookEntryFavorite,
} from '../features/worldbook-common.js';

const MODAL_ID = 'pt-worldbook-common-modal';
const STYLE_ID = 'pt-worldbook-common-modal-styles';

let isOpen = false;
let refreshing = false;
let collapseState = new Map();

function removeExisting() {
    const $ = getJQuery();
    $(`#${MODAL_ID}`).remove();
    $(`#${STYLE_ID}`).remove();
}

function renderStyles() {
    const vars = CommonStyles.getVars();
    return `
        #${MODAL_ID} {
            --pt-font-size: ${vars.fontSize};
            ${CommonStyles.getModalBaseStyles({ maxWidth: vars.maxWidthLarge })}
        }
        #${MODAL_ID} .pt-wb-common-content {
            --pt-section-bg: ${vars.sectionBg};
            --pt-border: ${vars.borderColor};
            --pt-text: ${vars.textColor};
            --pt-tip: ${vars.tipColor};
            ${CommonStyles.getModalContentStyles({ maxWidth: vars.maxWidthLarge })}
            padding: ${vars.padding};
        }
    `;
}

function groupItems(items) {
    const byWorldbook = new Map();

    for (const item of items) {
        const key = String(item?.worldbookName ?? '').trim();
        if (!key) continue;

        if (!byWorldbook.has(key)) {
            byWorldbook.set(key, {
                worldbookName: key,
                groups: new Map(),
                ungrouped: [],
            });
        }
        const wb = byWorldbook.get(key);

        const groupId = String(item?.groupId ?? '').trim();
        const groupName = String(item?.groupName ?? '').trim();
        if (!groupId || !groupName) {
            wb.ungrouped.push(item);
            continue;
        }
        if (!wb.groups.has(groupId)) wb.groups.set(groupId, { groupId, groupName, items: [] });
        wb.groups.get(groupId).items.push(item);
    }

    const worldbooks = Array.from(byWorldbook.values());
    worldbooks.sort((a, b) => a.worldbookName.localeCompare(b.worldbookName));

    for (const wb of worldbooks) {
        wb.ungrouped.sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? '')));
        wb.groupList = Array.from(wb.groups.values());
        wb.groupList.sort((a, b) => a.groupName.localeCompare(b.groupName));
        for (const g of wb.groupList) {
            g.items.sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? '')));
        }
    }

    return worldbooks;
}

function computeToggleState(items) {
    const existing = items.filter((it) => it.exists);
    const enabledCount = existing.filter((it) => it.enabled).length;
    const total = existing.length;
    return { enabledCount, total, checked: total > 0 && enabledCount === total, indeterminate: enabledCount > 0 && enabledCount < total };
}

function getCollapseKey(parts) {
    return parts.filter(Boolean).join('\u001f');
}

function isCollapsed(parts, defaultCollapsed = false) {
    const key = getCollapseKey(parts);
    return collapseState.has(key) ? collapseState.get(key) : defaultCollapsed;
}

function setCollapsed(parts, collapsed) {
    collapseState.set(getCollapseKey(parts), !!collapsed);
}

function renderWorldbookBlock(wb) {
    const worldKey = getCollapseKey(['wb', wb.worldbookName]);
    const allItems = [...wb.ungrouped, ...wb.groupList.flatMap((g) => g.items)];
    const state = computeToggleState(allItems);
    const collapsed = isCollapsed(['wb', wb.worldbookName], true);

    const groupHtml = wb.groupList.map((g) => renderGroupBlock(wb.worldbookName, g)).join('');
    const ungroupedEntriesHtml = wb.ungrouped.map((it) => renderEntryRow(wb.worldbookName, it)).join('');
    const ungroupedHtml = wb.ungrouped.length
        ? `<div class="pt-wb-common-entries pt-wb-common-ungrouped">${ungroupedEntriesHtml}</div>`
        : '';

    return `
        <div class="pt-wb-common-worldbook" data-worldbook="${escapeHtml(wb.worldbookName)}">
            <div class="pt-entry-group-header pt-wb-common-header ${collapsed ? '' : 'is-expanded'}" data-pt-collapse-key="${escapeHtml(worldKey)}">
                <span class="pt-entry-group-toggle"></span>
                <label class="checkbox_label alignItemsCenter flexGap5 pt-wb-common-checkbox">
                    <input class="pt-wb-common-worldbook-toggle" type="checkbox" ${state.checked ? 'checked' : ''} ${state.total ? '' : 'disabled'} data-indeterminate="${state.indeterminate ? '1' : '0'}" />
                    <span class="pt-entry-group-name">${escapeHtml(wb.worldbookName)}</span>
                </label>
                <span class="pt-entry-group-count">${state.enabledCount}/${state.total}</span>
            </div>
            <div class="pt-entry-group-wrapper ${collapsed ? '' : 'is-expanded'}">
                ${ungroupedHtml}${groupHtml}
            </div>
        </div>
    `;
}

function renderGroupBlock(worldbookName, group) {
    const groupKey = getCollapseKey(['grp', worldbookName, group.groupId || group.groupName]);
    const state = computeToggleState(group.items);
    const collapsed = isCollapsed(['grp', worldbookName, group.groupId || group.groupName], true);

    const entriesHtml = group.items.map((it) => renderEntryRow(worldbookName, it)).join('');

    return `
        <div class="pt-wb-common-group" data-worldbook="${escapeHtml(worldbookName)}" data-group="${escapeHtml(group.groupId || '')}">
            <div class="pt-entry-group-header pt-wb-common-header ${collapsed ? '' : 'is-expanded'}" data-pt-collapse-key="${escapeHtml(groupKey)}">
                <span class="pt-entry-group-toggle"></span>
                <label class="checkbox_label alignItemsCenter flexGap5 pt-wb-common-checkbox">
                    <input class="pt-wb-common-group-toggle" type="checkbox" ${state.checked ? 'checked' : ''} ${state.total ? '' : 'disabled'} data-indeterminate="${state.indeterminate ? '1' : '0'}" />
                    <span class="pt-entry-group-name">${escapeHtml(group.groupName || '分组')}</span>
                </label>
                <span class="pt-entry-group-count">${state.enabledCount}/${state.total}</span>
            </div>
            <div class="pt-entry-group-wrapper ${collapsed ? '' : 'is-expanded'}">
                <div class="pt-wb-common-entries">
                    ${entriesHtml}
                </div>
            </div>
        </div>
    `;
}

function renderEntryRow(worldbookName, item) {
    const uid = String(item?.uid ?? '');
    const label = String(item?.name ?? '').trim() || `UID: ${uid}`;
    return `
        <div class="pt-wb-common-entry" data-worldbook="${escapeHtml(worldbookName)}" data-uid="${escapeHtml(uid)}">
            <label class="checkbox_label alignItemsCenter flexGap5 pt-wb-common-checkbox">
                <input class="pt-wb-common-entry-toggle" type="checkbox" ${item.enabled ? 'checked' : ''} ${item.exists ? '' : 'disabled'} />
                <span class="pt-wb-common-entry-name">${escapeHtml(label)}</span>
                ${item.exists ? '' : '<span class="pt-wb-common-entry-missing">已删除</span>'}
            </label>
            <button class="menu_button pt-wb-common-entry-remove" type="button">移除</button>
        </div>
    `;
}

function applyIndeterminateCheckboxes($root) {
    $root.find('input[type="checkbox"][data-indeterminate="1"]').each(function () {
        this.indeterminate = true;
    });
}

async function renderList() {
    const $ = getJQuery();
    const $list = $(`#${MODAL_ID} .pt-wb-common-list`);
    if (!$list.length) return;

    const items = await listWorldbookCommonItems();
    if (!items.length) {
        $list.html('<div class="pt-wb-common-empty">暂无常用条目</div>');
        return;
    }

    const worldbooks = groupItems(items);
    const html = worldbooks.map(renderWorldbookBlock).join('');
    $list.html(html);
    applyIndeterminateCheckboxes($list);
}

async function withRefreshLock(fn) {
    if (refreshing) return;
    refreshing = true;
    try {
        await fn();
    } finally {
        refreshing = false;
    }
}

async function refreshPanel() {
    const $ = getJQuery();
    const $status = $(`#${MODAL_ID} .pt-wb-common-status`);
    $status.text('加载中...');
    try {
        await renderList();
        $status.text('');
    } catch (e) {
        console.error('PresetTransfer: failed to render worldbook common panel', e);
        $status.text('加载失败');
    }
}

function bindCollapseToggles($modal) {
    const $ = getJQuery();
    $modal.off('click.pt-wb-common-collapse');
    $modal.on('click.pt-wb-common-collapse', '.pt-wb-common-header', function (e) {
        if ($(e.target).is('input, button, label')) return;
        const $header = $(this);
        const key = String($header.data('pt-collapse-key') ?? '');
        if (!key) return;

        const parts = key.split('\u001f');
        const isExpanded = $header.hasClass('is-expanded');
        const nextExpanded = !isExpanded;
        setCollapsed(parts, !nextExpanded);
        $header.toggleClass('is-expanded', nextExpanded);
        const $wrapper = $header.next('.pt-entry-group-wrapper');
        $wrapper.toggleClass('is-expanded', nextExpanded);
    });
}

function bindEntryToggles($modal) {
    const $ = getJQuery();

    $modal.off('input.pt-wb-common-entry');
    $modal.on('input.pt-wb-common-entry', '.pt-wb-common-entry-toggle', async function () {
        const $row = $(this).closest('.pt-wb-common-entry');
        const worldbookName = String($row.data('worldbook') ?? '');
        const uid = String($row.data('uid') ?? '');
        const enabled = $(this).prop('checked');
        await withRefreshLock(async () => {
            await setWorldbookCommonEntriesEnabled(worldbookName, [uid], enabled);
            await refreshPanel();
        });
    });
}

function bindGroupToggles($modal) {
    const $ = getJQuery();

    $modal.off('input.pt-wb-common-group');
    $modal.on('input.pt-wb-common-group', '.pt-wb-common-group-toggle', async function () {
        const $group = $(this).closest('.pt-wb-common-group');
        const worldbookName = String($group.data('worldbook') ?? '');
        const enabled = $(this).prop('checked');
        const uids = $group
            .find('.pt-wb-common-entry-toggle:not(:disabled)')
            .closest('.pt-wb-common-entry')
            .map((_, el) => String($(el).data('uid') ?? '').trim())
            .get()
            .filter(Boolean);
        await withRefreshLock(async () => {
            await setWorldbookCommonEntriesEnabled(worldbookName, uids, enabled);
            await refreshPanel();
        });
    });

    $modal.off('input.pt-wb-common-worldbook');
    $modal.on('input.pt-wb-common-worldbook', '.pt-wb-common-worldbook-toggle', async function () {
        const $world = $(this).closest('.pt-wb-common-worldbook');
        const worldbookName = String($world.data('worldbook') ?? '');
        const enabled = $(this).prop('checked');
        const uids = $world
            .find('.pt-wb-common-entry-toggle:not(:disabled)')
            .closest('.pt-wb-common-entry')
            .map((_, el) => String($(el).data('uid') ?? '').trim())
            .get()
            .filter(Boolean);
        await withRefreshLock(async () => {
            await setWorldbookCommonEntriesEnabled(worldbookName, uids, enabled);
            await refreshPanel();
        });
    });
}

function bindRemoveButtons($modal) {
    const $ = getJQuery();

    $modal.off('click.pt-wb-common-remove');
    $modal.on('click.pt-wb-common-remove', '.pt-wb-common-entry-remove', async function (e) {
        e.preventDefault();
        const $row = $(this).closest('.pt-wb-common-entry');
        const worldbookName = String($row.data('worldbook') ?? '');
        const uid = String($row.data('uid') ?? '');
        await withRefreshLock(async () => {
            await setWorldbookEntryFavorite(worldbookName, uid, false);
            await refreshPanel();
        });
    });
}

function bindHeaderButtons($modal) {
    const $ = getJQuery();
    $modal.find('.pt-wb-common-close').off('click.pt').on('click.pt', () => closeWorldbookCommonPanel());
}

function bindOverlayClose($modal) {
    const $ = getJQuery();
    $modal.off('mousedown.pt-wb-common-overlay');
    $modal.on('mousedown.pt-wb-common-overlay', (e) => {
        if ($(e.target).is(`#${MODAL_ID}`)) closeWorldbookCommonPanel();
    });

    $modal.off('keydown.pt-wb-common-esc');
    $modal.on('keydown.pt-wb-common-esc', (e) => {
        if (e.key === 'Escape') closeWorldbookCommonPanel();
    });
}

export async function openWorldbookCommonPanel() {
    if (isOpen) return;
    isOpen = true;

    ensureViewportCssVars();
    removeExisting();

    const $ = getJQuery();
    $('head').append(`<style id="${STYLE_ID}">${renderStyles()}</style>`);

    const modalHtml = `
        <div id="${MODAL_ID}" class="pt-wb-common-modal" tabindex="-1">
            <div class="pt-wb-common-content">
                <div class="pt-wb-common-header-row flex-container justifySpaceBetween alignItemsCenter flexGap10">
                    <div class="flex-container flexFlowColumn">
                        <div class="pt-wb-common-title">世界书常用</div>
                        <div class="pt-wb-common-status"></div>
                    </div>
                    <div class="pt-wb-common-actions">
                        <button type="button" class="menu_button pt-wb-common-close">关闭</button>
                    </div>
                </div>
                <div class="pt-wb-common-list pt-entry-grouping-root"></div>
            </div>
        </div>
    `;

    $('body').append(modalHtml);
    const $modal = $(`#${MODAL_ID}`);
    $modal.focus();

    bindHeaderButtons($modal);
    bindOverlayClose($modal);
    bindCollapseToggles($modal);
    bindEntryToggles($modal);
    bindGroupToggles($modal);
    bindRemoveButtons($modal);

    await withRefreshLock(async () => refreshPanel());
}

export function closeWorldbookCommonPanel() {
    if (!isOpen) return;
    isOpen = false;
    removeExisting();
}
