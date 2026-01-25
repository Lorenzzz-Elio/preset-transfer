import { getParentWindow } from '../core/utils.js';
import { loadTransferSettings, saveTransferSettings } from '../settings/settings-manager.js';
import { getWorldbookFavoritesSet, setWorldbookEntryFavorite } from './worldbook-common.js';

const FAVORITES_KEY = 'favoriteEntries';

function normalizeKey(value) {
  return String(value ?? '').trim();
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeKey).filter(Boolean);
}

function ensureStore(raw) {
  const safe = raw && typeof raw === 'object' ? raw : {};
  const preset = safe.preset && typeof safe.preset === 'object' ? safe.preset : {};
  const worldbook = safe.worldbook && typeof safe.worldbook === 'object' ? safe.worldbook : {};
  return { preset, worldbook };
}

function getStore() {
  const settings = loadTransferSettings();
  return ensureStore(settings?.[FAVORITES_KEY]);
}

function saveStore(store) {
  const settings = loadTransferSettings();
  settings[FAVORITES_KEY] = ensureStore(store);
  saveTransferSettings(settings);
}

function emitFavoritesChanged(adapterId, containerName) {
  try {
    const target = getParentWindow?.() ?? window;
    target.dispatchEvent(
      new CustomEvent('pt:favorites-changed', {
        detail: {
          adapterId: normalizeKey(adapterId),
          containerName: normalizeKey(containerName),
        },
      }),
    );
  } catch {
    // ignore
  }
}

function isFavoritesSupported(adapterId) {
  return adapterId === 'preset' || adapterId === 'worldbook';
}

function getPresetFavoriteList(containerName) {
  const container = normalizeKey(containerName);
  if (!container) return [];
  const store = getStore();
  return normalizeList(store.preset?.[container]);
}

function setPresetFavorite(containerName, identifier, favorite) {
  const container = normalizeKey(containerName);
  const id = normalizeKey(identifier);
  if (!container || !id) return false;

  const store = getStore();
  const current = new Set(getPresetFavoriteList(container));
  if (favorite) current.add(id);
  else current.delete(id);
  store.preset[container] = Array.from(current);
  saveStore(store);
  emitFavoritesChanged('preset', container);
  return true;
}

async function getFavoriteListForContainer(adapterId, containerName) {
  const adapter = normalizeKey(adapterId);
  const container = normalizeKey(containerName);
  if (!adapter || !container) return [];

  if (adapter === 'worldbook') {
    const set = await getWorldbookFavoritesSet(container);
    return Array.from(set);
  }
  return getPresetFavoriteList(container);
}

function getFavoriteIdsForContainerSync(adapterId, containerName) {
  const adapter = normalizeKey(adapterId);
  if (adapter !== 'preset') return null;
  return new Set(getPresetFavoriteList(containerName));
}

async function getFavoriteIdsForContainer(adapterId, containerName) {
  const list = await getFavoriteListForContainer(adapterId, containerName);
  return new Set(list);
}

async function setFavoriteEntry(adapterId, containerName, identifier, favorite) {
  const adapter = normalizeKey(adapterId);
  const container = normalizeKey(containerName);
  const id = normalizeKey(identifier);
  if (!adapter || !container || !id) return false;

  if (adapter === 'worldbook') {
    const ok = await setWorldbookEntryFavorite(container, id, !!favorite);
    emitFavoritesChanged(adapter, container);
    return ok;
  }

  return setPresetFavorite(container, id, !!favorite);
}

async function toggleFavoriteEntry(adapterId, containerName, identifier) {
  const adapter = normalizeKey(adapterId);
  const container = normalizeKey(containerName);
  const id = normalizeKey(identifier);
  if (!adapter || !container || !id) return false;

  const current = await getFavoriteIdsForContainer(adapter, container);
  const next = !current.has(id);
  await setFavoriteEntry(adapter, container, id, next);
  return next;
}

export {
  getFavoriteIdsForContainer,
  getFavoriteIdsForContainerSync,
  getFavoriteListForContainer,
  isFavoritesSupported,
  setFavoriteEntry,
  toggleFavoriteEntry,
};
