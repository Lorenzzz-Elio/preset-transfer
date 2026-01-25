import { getJQuery, getParentWindow } from '../core/utils.js';
import { displayEntries } from '../display/entry-display.js';
import { getFavoriteIdsForContainer, isFavoritesSupported } from '../features/favorite-entries.js';
import { startTransferMode } from '../operations/entry-operations.js';
import { getActiveTransferAdapter, getTransferEngine } from '../transfer/transfer-context.js';

let favoritesChangedListenerBound = false;
let latestApiInfo = null;

function getPanel(context) {
  const $ = getJQuery();
  return $(`.pt-favorites-panel[data-pt-fav-context="${context}"]`);
}

function getButton(context) {
  const $ = getJQuery();
  return $(`.pt-favorites-btn[data-pt-fav-context="${context}"]`);
}

function getListSelector(context) {
  return `#pt-favorites-entries-${context}`;
}

function resolveContainerName(context) {
  const $ = getJQuery();
  if (context === 'left') return String($('#left-preset').val() ?? '').trim();
  if (context === 'right') return String($('#right-preset').val() ?? '').trim();

  const single = String(window.singlePresetName ?? '').trim();
  if (single) return single;

  const left = String($('#left-preset').val() ?? '').trim();
  const right = String($('#right-preset').val() ?? '').trim();
  return left || right;
}

function updatePanelHeader(context, containerName, totalCount, { isGlobal = false } = {}) {
  const $ = getJQuery();
  const $panel = getPanel(context);
  if (!$panel.length) return;

  const adapter = getActiveTransferAdapter();
  const label = adapter?.ui?.containerLabel || '预设';
  const baseText = isGlobal ? `全部${label}` : containerName ? `${label}: ${containerName}` : `未选择${label}`;

  const $list = $(getListSelector(context));
  const selectedCount = $list.find('.entry-checkbox:checked').length;
  const totalText = typeof totalCount === 'number' ? `已选 ${selectedCount}/${totalCount}` : `已选 ${selectedCount}`;
  $panel.find('.pt-favorites-sub').text(`${baseText} · ${totalText}`);
}

function updatePanelActions(context, sourceContainer, { isGlobal = false } = {}) {
  const $ = getJQuery();
  const $panel = getPanel(context);
  if (!$panel.length) return;

  const leftContainer = String($('#left-preset').val() ?? '').trim();
  const rightContainer = String($('#right-preset').val() ?? '').trim();
  const hasTarget = leftContainer || rightContainer;

  $panel.find('.pt-favorites-transfer').prop('disabled', !hasTarget);
}

function setFavoritesGlobals(entries, containerName, listSelector) {
  window.ptFavoriteEntries = entries;
  window.ptFavoriteContainerName = containerName;
  window.ptFavoriteListSelector = listSelector;
}

async function buildFavoriteEntries(apiInfo, adapter, containerName) {
  const engine = getTransferEngine();
  const favoriteIds = await getFavoriteIdsForContainer(adapter.id, containerName);
  if (!favoriteIds || favoriteIds.size === 0) return [];

  const allEntries = await engine.getEntries(apiInfo, containerName, 'include_disabled');
  return (allEntries || []).filter(entry => {
    const identifier = String(entry?.identifier ?? '').trim();
    return identifier && favoriteIds.has(identifier);
  });
}

async function buildFavoriteEntriesForAllContainers(apiInfo, adapter) {
  const engine = getTransferEngine();
  const containers = await engine.listContainers(apiInfo);
  const entries = [];
  const favoriteIdsByContainer = new Map();

  for (const container of containers) {
    let favoriteIds;
    try {
      favoriteIds = await getFavoriteIdsForContainer(adapter.id, container);
    } catch {
      continue;
    }
    if (!favoriteIds || favoriteIds.size === 0) continue;

    favoriteIdsByContainer.set(container, favoriteIds);
    const allEntries = await engine.getEntries(apiInfo, container, 'include_disabled');
    if (!Array.isArray(allEntries) || allEntries.length === 0) continue;

    for (const entry of allEntries) {
      const identifier = String(entry?.identifier ?? '').trim();
      if (!identifier || !favoriteIds.has(identifier)) continue;
      entries.push({
        ...entry,
        ptFavoriteContainer: container,
        ptFavoriteKey: `${container}::${identifier}`,
      });
    }
  }

  return { entries, favoriteIdsByContainer };
}

async function refreshFavoritesPanel(apiInfo, context) {
  const $ = getJQuery();
  const $panel = getPanel(context);
  if (!$panel.length) return;

  latestApiInfo = apiInfo;
  const adapter = getActiveTransferAdapter();
  const listSelector = getListSelector(context);
  const isGlobal = adapter?.id === 'preset';
  const containerName = isGlobal ? '' : resolveContainerName(context);
  const $empty = $panel.find('.pt-favorites-empty');

  if (!isFavoritesSupported(adapter?.id)) {
    setFavoritesGlobals([], '', listSelector);
    window.ptFavoriteIsGlobal = false;
    displayEntries([], 'favorites', {
      listSelector,
      showPositions: false,
      showCreateButtons: false,
      showEmptyMessage: false,
      containerName: '',
    });
    if ($empty.length) $empty.show();
    updatePanelHeader(context, '', 0, { isGlobal });
    updatePanelActions(context, '', { isGlobal });
    return;
  }

  let favoriteEntries = [];
  let favoriteIdsByContainer = null;
  if (isGlobal) {
    try {
      const result = await buildFavoriteEntriesForAllContainers(apiInfo, adapter);
      favoriteEntries = result.entries;
      favoriteIdsByContainer = result.favoriteIdsByContainer;
    } catch (error) {
      console.error('收藏面板加载失败:', error);
      if (window.toastr) {
        toastr.error('收藏加载失败: ' + (error?.message ?? error));
      }
    }
  } else if (containerName) {
    try {
      favoriteEntries = await buildFavoriteEntries(apiInfo, adapter, containerName);
    } catch (error) {
      console.error('收藏面板加载失败:', error);
      if (window.toastr) {
        toastr.error('收藏加载失败: ' + (error?.message ?? error));
      }
    }
  }

  setFavoritesGlobals(favoriteEntries, containerName, listSelector);
  window.ptFavoriteIsGlobal = isGlobal;
  displayEntries(favoriteEntries, 'favorites', {
    listSelector,
    showPositions: false,
    showCreateButtons: false,
    showEmptyMessage: false,
    containerName,
    favoriteIdsByContainer,
  });

  if ($empty.length) {
    $empty.toggle(favoriteEntries.length === 0);
  }

  updatePanelHeader(context, containerName, favoriteEntries.length, { isGlobal });
  updatePanelActions(context, containerName, { isGlobal });

  $(listSelector)
    .off('change.ptFavoritesCount')
    .on('change.ptFavoritesCount', '.entry-checkbox', () => {
      updatePanelHeader(context, containerName, favoriteEntries.length, { isGlobal });
    });
}

function closeFavoritesPanels() {
  const $ = getJQuery();
  $('.pt-favorites-panel').hide();
  $('.pt-favorites-btn').removeClass('is-active');
}

async function toggleFavoritesPanel(apiInfo, context) {
  const $panel = getPanel(context);
  if (!$panel.length) return;

  const isOpen = $panel.is(':visible');
  closeFavoritesPanels();
  if (isOpen) return;

  $panel.show();
  getButton(context).addClass('is-active');
  await refreshFavoritesPanel(apiInfo, context);
}

function bindFavoritesChangedListener() {
  if (favoritesChangedListenerBound) return;
  favoritesChangedListenerBound = true;

  const target = getParentWindow?.() ?? window;
  target.addEventListener('pt:favorites-changed', async (event) => {
    const $ = getJQuery();
    const $openPanel = $('.pt-favorites-panel:visible').first();
    if (!$openPanel.length || !latestApiInfo) return;

    const context = String($openPanel.data('pt-fav-context') ?? '').trim();
    if (!context) return;

    const adapter = getActiveTransferAdapter();
    const detail = event?.detail ?? {};
    const adapterId = String(detail.adapterId ?? '').trim();
    const containerName = String(detail.containerName ?? '').trim();
    const currentContainer = resolveContainerName(context);
    const isGlobal = adapter?.id === 'preset' && !!window.ptFavoriteIsGlobal;

    if (adapterId && adapter?.id && adapterId !== adapter.id) return;
    if (!isGlobal && containerName && currentContainer && containerName !== currentContainer) return;

    await refreshFavoritesPanel(latestApiInfo, context);
  });
}

function bindFavoritesPanelEvents(apiInfo, modal, { closeSearchSettingsPopovers, closeGlobalSearchPanels } = {}) {
  latestApiInfo = apiInfo;
  bindFavoritesChangedListener();

  const $ = getJQuery();
  $('.pt-favorites-btn')
    .off('click.ptFavorites')
    .on('click.ptFavorites', async function (e) {
      e.preventDefault();
      e.stopPropagation();

      const context = String($(this).data('pt-fav-context') ?? '').trim();
      if (!context) return;

      if (typeof closeSearchSettingsPopovers === 'function') closeSearchSettingsPopovers();
      if (typeof closeGlobalSearchPanels === 'function') closeGlobalSearchPanels();

      await toggleFavoritesPanel(apiInfo, context);
    });

  $('.pt-favorites-panel')
    .off('click.ptFavoritesPanel')
    .on('click.ptFavoritesPanel', function (e) {
      e.stopPropagation();
    });

  $('.pt-favorites-transfer')
    .off('click.ptFavoritesTransfer')
    .on('click.ptFavoritesTransfer', function (e) {
      e.preventDefault();
      e.stopPropagation();

      const $panel = $(this).closest('.pt-favorites-panel');
      const context = String($panel.data('pt-fav-context') ?? '').trim();
      if (!context) return;

      const listSelector = getListSelector(context);
      const selectedCount = $(listSelector).find('.entry-checkbox:checked').length;
      if (!selectedCount) {
        alert('请至少选择一个条目进行转移');
        return;
      }

      const adapter = getActiveTransferAdapter();
      const sourceContainer = resolveContainerName(context);
      if (!sourceContainer && adapter?.id !== 'preset') {
        alert('请选择源预设');
        return;
      }

      closeFavoritesPanels();
      startTransferMode(apiInfo, 'favorites', null);
    });

  $(document)
    .off('click.ptFavoritesPanel')
    .on('click.ptFavoritesPanel', function (e) {
      const $target = $(e.target);
      if ($target.closest('.pt-favorites-panel, .pt-favorites-btn').length) return;
      closeFavoritesPanels();
    });

  if (modal) {
    modal.on('remove.ptFavoritesPanel', () => {
      $(document).off('click.ptFavoritesPanel');
    });
  }
}

export { bindFavoritesPanelEvents, closeFavoritesPanels, refreshFavoritesPanel };
