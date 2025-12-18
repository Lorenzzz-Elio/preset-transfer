import { getWorldInfoModule, listWorldbooks } from '../core/worldbook-api.js';
import { getParentWindow } from '../core/utils.js';
import { loadTransferSettings, saveTransferSettings } from '../settings/settings-manager.js';

const EXTENSION_NAMESPACE = 'presetTransfer';
const FAVORITES_KEY = 'worldbookCommonFavorites';
const AUTO_GLOBAL_BOOKS_KEY = 'worldbookCommonAutoGlobalBooks';

const worldbookOpChains = new Map();
const favoritesCache = new Map();

let globalSelectionListenerBound = false;
let globalSelectionListenerBusy = false;

function emitFavoritesChanged(worldbookName) {
  try {
    const pw = getParentWindow?.() ?? window;
    pw.dispatchEvent(
      new CustomEvent('pt:worldbook-common-favorites-changed', {
        detail: { worldbookName: String(worldbookName ?? '').trim() },
      }),
    );
  } catch {
    /* ignore */
  }
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function ensurePresetTransferExt(data) {
  if (!isPlainObject(data)) return null;
  if (!isPlainObject(data.extensions)) data.extensions = {};
  if (!isPlainObject(data.extensions[EXTENSION_NAMESPACE])) data.extensions[EXTENSION_NAMESPACE] = {};
  return data.extensions[EXTENSION_NAMESPACE];
}

function readFavoritesFromWorldbookData(data) {
  const raw = data?.extensions?.[EXTENSION_NAMESPACE]?.[FAVORITES_KEY];
  return asArray(raw)
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);
}

function writeFavoritesToWorldbookData(data, favorites) {
  const ext = ensurePresetTransferExt(data);
  if (!ext) return false;
  ext[FAVORITES_KEY] = Array.isArray(favorites) ? favorites : [];
  return true;
}

function getAutoGlobalBooksSet() {
  const settings = loadTransferSettings();
  return new Set(
    asArray(settings?.[AUTO_GLOBAL_BOOKS_KEY])
      .map((v) => String(v ?? '').trim())
      .filter(Boolean),
  );
}

function saveAutoGlobalBooksSet(set) {
  const settings = loadTransferSettings();
  settings[AUTO_GLOBAL_BOOKS_KEY] = Array.from(set ?? []).map((v) => String(v ?? '').trim()).filter(Boolean);
  saveTransferSettings(settings);
}

function enqueueWorldbookOp(worldbookName, operation) {
  const key = String(worldbookName ?? '').trim();
  if (!key) return Promise.reject(new Error('Missing worldbook name'));

  const prev = worldbookOpChains.get(key) ?? Promise.resolve();
  const next = prev.catch(() => null).then(operation);
  worldbookOpChains.set(key, next);
  return next;
}

async function loadWorldbook(worldbookName) {
  const mod = await getWorldInfoModule();
  if (typeof mod.loadWorldInfo !== 'function') {
    throw new Error('World Info module missing loadWorldInfo');
  }
  const data = await mod.loadWorldInfo(worldbookName);
  if (!data || typeof data !== 'object') {
    throw new Error(`Unable to load worldbook: ${worldbookName}`);
  }
  return data;
}

async function saveWorldbook(worldbookName, data) {
  const mod = await getWorldInfoModule();
  if (typeof mod.saveWorldInfo !== 'function') {
    throw new Error('World Info module missing saveWorldInfo');
  }
  await mod.saveWorldInfo(worldbookName, data, true);
}

function sortWorldEntries(a, b) {
  const ao = Number(a?.order ?? 0);
  const bo = Number(b?.order ?? 0);
  if (ao !== bo) return bo - ao;
  const au = Number(a?.uid ?? 0);
  const bu = Number(b?.uid ?? 0);
  return au - bu;
}

function getEntriesObject(data) {
  return data?.entries && typeof data.entries === 'object' ? data.entries : {};
}

function getOrderedUidsFromWorldbookData(data) {
  const entriesObj = getEntriesObject(data);
  const values = Object.values(entriesObj).filter(Boolean);
  values.sort(sortWorldEntries);
  return values
    .map((e) => (e?.uid != null ? String(e.uid).trim() : ''))
    .filter(Boolean);
}

function buildUidToEntryMap(data) {
  const map = new Map();
  for (const entry of Object.values(getEntriesObject(data))) {
    if (!entry) continue;
    const uid = entry?.uid != null ? String(entry.uid).trim() : '';
    if (!uid) continue;
    map.set(uid, entry);
  }
  return map;
}

function isEntryEnabled(entry) {
  return !entry?.disable;
}

function setEntryEnabled(entry, enabled) {
  if (!entry || typeof entry !== 'object') return;
  entry.disable = !enabled;
}

function getWorldbookGlobalSelectEl() {
  const $ = getJQuery();
  return $('#world_info');
}

async function refreshWorldbookNameList() {
  const mod = await getWorldInfoModule();
  if (typeof mod.updateWorldInfoList === 'function') {
    await mod.updateWorldInfoList();
  }
  return Array.isArray(mod.world_names) ? mod.world_names.slice() : [];
}

async function isWorldbookGloballySelected(worldbookName) {
  const mod = await getWorldInfoModule();
  const list = Array.isArray(mod.selected_world_info) ? mod.selected_world_info : [];
  return list.includes(worldbookName);
}

async function setWorldbookGloballySelected(worldbookName, selected, { trackAuto = false } = {}) {
  const name = String(worldbookName ?? '').trim();
  if (!name) return false;

  const worldNames = await refreshWorldbookNameList();
  const idx = worldNames.indexOf(name);
  if (idx < 0) return false;

  const $select = getWorldbookGlobalSelectEl();
  if (!$select?.length) return false;

  const idxStr = String(idx);
  const currentRaw = $select.val();
  const current = Array.isArray(currentRaw) ? currentRaw.map(String) : currentRaw ? [String(currentRaw)] : [];
  const has = current.includes(idxStr);

  if (selected && has) return true;
  if (!selected && !has) return true;

  let autoSet = null;
  if (trackAuto) autoSet = getAutoGlobalBooksSet();

  if (selected) {
    const next = [...current, idxStr];
    if (trackAuto && !autoSet.has(name)) {
      autoSet.add(name);
      saveAutoGlobalBooksSet(autoSet);
    }
    globalSelectionListenerBusy = true;
    $select.val(next).trigger('change');
    globalSelectionListenerBusy = false;
    return true;
  }

  if (trackAuto && !autoSet.has(name)) {
    return true;
  }

  const next = current.filter((v) => v !== idxStr);
  if (trackAuto && autoSet.has(name)) {
    autoSet.delete(name);
    saveAutoGlobalBooksSet(autoSet);
  }
  globalSelectionListenerBusy = true;
  $select.val(next).trigger('change');
  globalSelectionListenerBusy = false;
  return true;
}

function bindGlobalSelectionListener() {
  if (globalSelectionListenerBound) return;
  const $select = getWorldbookGlobalSelectEl();
  if (!$select?.length) return;

  $select.off('change.pt-wb-common');
  $select.on('change.pt-wb-common', async () => {
    if (globalSelectionListenerBusy) return;
    try {
      const mod = await getWorldInfoModule();
      const selected = new Set(asArray(mod?.selected_world_info).map(String));
      const autoSet = getAutoGlobalBooksSet();
      let changed = false;
      for (const name of Array.from(autoSet)) {
        if (!selected.has(name)) {
          autoSet.delete(name);
          changed = true;
        }
      }
      if (changed) saveAutoGlobalBooksSet(autoSet);
    } catch {
      /* ignore */
    }
  });

  globalSelectionListenerBound = true;
}

function unbindGlobalSelectionListener() {
  if (!globalSelectionListenerBound) return;
  try {
    const $select = getWorldbookGlobalSelectEl();
    $select?.off('change.pt-wb-common');
  } catch {
    /* ignore */
  }
  globalSelectionListenerBound = false;
}

export function initWorldbookCommonGlobalMountTracking() {
  bindGlobalSelectionListener();
}

export function destroyWorldbookCommonGlobalMountTracking() {
  unbindGlobalSelectionListener();
}

export async function getWorldbookFavoritesSet(worldbookName, { forceRefresh = false } = {}) {
  const name = String(worldbookName ?? '').trim();
  if (!name) return new Set();

  if (!forceRefresh && favoritesCache.has(name)) {
    return new Set(favoritesCache.get(name));
  }

  try {
    const data = await loadWorldbook(name);
    const favorites = new Set(readFavoritesFromWorldbookData(data));
    favoritesCache.set(name, favorites);
    return new Set(favorites);
  } catch (e) {
    console.warn('PresetTransfer: failed to load favorites', name, e);
    return new Set();
  }
}

export async function setWorldbookEntryFavorite(worldbookName, uid, favorite) {
  const name = String(worldbookName ?? '').trim();
  const entryUid = String(uid ?? '').trim();
  if (!name || !entryUid) return false;

  return await enqueueWorldbookOp(name, async () => {
    const data = await loadWorldbook(name);
    const list = readFavoritesFromWorldbookData(data);
    const set = new Set(list);
    if (favorite) set.add(entryUid);
    else set.delete(entryUid);

    const next = Array.from(set);
    writeFavoritesToWorldbookData(data, next);
    await saveWorldbook(name, data);
    favoritesCache.set(name, new Set(next));
    emitFavoritesChanged(name);
    return true;
  });
}

export async function toggleWorldbookEntryFavorite(worldbookName, uid) {
  const favorites = await getWorldbookFavoritesSet(worldbookName);
  const entryUid = String(uid ?? '').trim();
  return await setWorldbookEntryFavorite(worldbookName, entryUid, !favorites.has(entryUid));
}

function readRawEntryGroupingsFromWorldbookData(data) {
  return data?.extensions?.[EXTENSION_NAMESPACE]?.worldbookEntryGrouping;
}

function readGroupName(entry) {
  return entry?.name || entry?.groupName || '分组';
}

function normalizeEntryGroupingForRead(entry, orderedUids) {
  if (!isPlainObject(entry)) return null;

  const hasUidAnchors =
    typeof entry?.startUid === 'string'
    || typeof entry?.endUid === 'string'
    || typeof entry?.startUid === 'number'
    || typeof entry?.endUid === 'number';

  if (hasUidAnchors) {
    const startUid = entry.startUid != null ? String(entry.startUid).trim() : '';
    const endUid = entry.endUid != null ? String(entry.endUid).trim() : '';
    if (startUid && endUid) {
      return {
        id: typeof entry.id === 'string' ? entry.id : '',
        name: readGroupName(entry),
        startUid,
        endUid,
        mode: entry.mode || 'inclusive',
        unresolved: !!entry.unresolved,
      };
    }
  }

  if (typeof entry?.startIndex === 'number' && typeof entry?.endIndex === 'number') {
    const startUid = Array.isArray(orderedUids) ? orderedUids[entry.startIndex] : '';
    const endUid = Array.isArray(orderedUids) ? orderedUids[entry.endIndex] : '';
    if (startUid && endUid) {
      return {
        id: typeof entry.id === 'string' ? entry.id : '',
        name: readGroupName(entry),
        startUid,
        endUid,
        mode: entry.mode || 'inclusive',
        unresolved: false,
      };
    }
  }

  return null;
}

function getWorldbookEntryGroupingsFromData(data, orderedUids) {
  const raw = readRawEntryGroupingsFromWorldbookData(data);
  return asArray(raw)
    .map((g) => normalizeEntryGroupingForRead(g, orderedUids))
    .filter(Boolean);
}

function buildGroupingIndex({ orderedUids, groupings }) {
  const uidToGroup = new Map();
  const groups = [];
  const uidToIndex = new Map(orderedUids.map((uid, idx) => [uid, idx]));

  for (const grouping of groupings) {
    const startIndex = uidToIndex.get(grouping.startUid);
    const endIndex = uidToIndex.get(grouping.endUid);
    if (typeof startIndex !== 'number' || typeof endIndex !== 'number') continue;
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);

    const range = orderedUids.slice(start, end + 1);
    for (const uid of range) {
      uidToGroup.set(uid, grouping);
    }
    groups.push({
      ...grouping,
      startIndex: start,
      endIndex: end,
    });
  }

  groups.sort((a, b) => a.startIndex - b.startIndex);
  return { uidToGroup, groups };
}

export async function listWorldbookCommonItems() {
  const names = await listWorldbooks();
  const items = [];

  for (const worldbookName of names) {
    try {
      const data = await loadWorldbook(worldbookName);
      const favorites = readFavoritesFromWorldbookData(data);
      if (!favorites.length) continue;

      const orderedUids = getOrderedUidsFromWorldbookData(data);
      const groupings = getWorldbookEntryGroupingsFromData(data, orderedUids);
      const { uidToGroup } = buildGroupingIndex({ orderedUids, groupings });

      const uidToEntry = buildUidToEntryMap(data);
      for (const uid of favorites) {
        const entry = uidToEntry.get(uid);
        const grouping = uidToGroup.get(uid) ?? null;
        items.push({
          worldbookName,
          uid,
          exists: !!entry,
          name: String(entry?.comment ?? '').trim(),
          enabled: entry ? isEntryEnabled(entry) : false,
          groupId: grouping?.id || '',
          groupName: grouping?.name || '',
          order: entry?.order ?? null,
        });
      }
    } catch (e) {
      console.warn('PresetTransfer: failed to read worldbook common items', worldbookName, e);
    }
  }

  return items;
}

async function setWorldbookEntriesEnabledInternal(worldbookName, uids, enabled) {
  const name = String(worldbookName ?? '').trim();
  const uidList = asArray(uids).map((u) => String(u ?? '').trim()).filter(Boolean);
  if (!name || !uidList.length) return false;

  return await enqueueWorldbookOp(name, async () => {
    const data = await loadWorldbook(name);
    const entriesObj = getEntriesObject(data);
    let changed = false;
    for (const uid of uidList) {
      const entry = entriesObj?.[uid];
      if (!entry) continue;
      const prev = isEntryEnabled(entry);
      if (prev === !!enabled) continue;
      setEntryEnabled(entry, !!enabled);
      changed = true;
    }
    if (changed) await saveWorldbook(name, data);
    return true;
  });
}

async function ensureGlobalSelectionForEntryToggle(worldbookName, enabled) {
  if (enabled) {
    await setWorldbookGloballySelected(worldbookName, true, { trackAuto: true });
    return;
  }

  try {
    const data = await loadWorldbook(worldbookName);
    const favorites = readFavoritesFromWorldbookData(data);
    if (!favorites.length) {
      await setWorldbookGloballySelected(worldbookName, false, { trackAuto: true });
      return;
    }

    const uidToEntry = buildUidToEntryMap(data);
    const stillEnabled = favorites.some((uid) => {
      const entry = uidToEntry.get(uid);
      return entry && isEntryEnabled(entry);
    });

    if (!stillEnabled) {
      await setWorldbookGloballySelected(worldbookName, false, { trackAuto: true });
    }
  } catch {
    /* ignore */
  }
}

export async function setWorldbookCommonEntriesEnabled(worldbookName, uids, enabled) {
  const name = String(worldbookName ?? '').trim();
  if (!name) return false;

  await setWorldbookEntriesEnabledInternal(name, uids, enabled);
  await ensureGlobalSelectionForEntryToggle(name, !!enabled);
  return true;
}

export async function getWorldbookCommonStateSummary(worldbookName) {
  const name = String(worldbookName ?? '').trim();
  if (!name) return null;

  const favorites = await getWorldbookFavoritesSet(name);
  const data = await loadWorldbook(name);
  const uidToEntry = buildUidToEntryMap(data);

  let enabledCount = 0;
  for (const uid of favorites) {
    const entry = uidToEntry.get(uid);
    if (entry && isEntryEnabled(entry)) enabledCount += 1;
  }

  return {
    worldbookName: name,
    favoritesCount: favorites.size,
    enabledCount,
    globalSelected: await isWorldbookGloballySelected(name),
  };
}
