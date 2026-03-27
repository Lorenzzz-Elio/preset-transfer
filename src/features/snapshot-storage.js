import { getParentWindow } from '../core/utils.js';

const DB_NAME = 'PresetTransferSnapshots';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';
const SNAPSHOT_CHANGE_EVENT = 'preset-transfer:snapshots-changed';

let dbInstance = null;

function emitSnapshotChange(detail = {}) {
  try {
    const target = getParentWindow?.() ?? window;
    target.dispatchEvent(new CustomEvent(SNAPSHOT_CHANGE_EVENT, { detail }));
  } catch {
    /* ignore */
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'normalizedBase' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
  });
}

export async function putSnapshot(snapshot) {
  try {
    const normalizedBase = String(snapshot?.normalizedBase ?? '').trim();
    if (!normalizedBase) {
      throw new Error('Snapshot normalizedBase is required.');
    }

    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const data = { ...snapshot, normalizedBase };

    await new Promise((resolve, reject) => {
      const request = store.put(data);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    emitSnapshotChange({ type: 'put', normalizedBase });
    return true;
  } catch (error) {
    console.error('[PresetTransfer] IndexedDB save failed:', error);
    return false;
  }
}

export async function saveSnapshot(normalizedBase, state) {
  return putSnapshot({
    ...(state && typeof state === 'object' ? state : {}),
    normalizedBase: String(normalizedBase ?? '').trim(),
  });
}

export async function loadSnapshot(normalizedBase) {
  try {
    const key = String(normalizedBase ?? '').trim();
    if (!key) return null;

    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return await new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[PresetTransfer] IndexedDB load failed:', error);
    return null;
  }
}

export async function getAllSnapshots() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[PresetTransfer] IndexedDB getAll failed:', error);
    return [];
  }
}

export async function deleteSnapshot(normalizedBase) {
  try {
    const key = String(normalizedBase ?? '').trim();
    if (!key) return false;

    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    await new Promise((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    emitSnapshotChange({ type: 'delete', normalizedBase: key });
    return true;
  } catch (error) {
    console.error('[PresetTransfer] IndexedDB delete failed:', error);
    return false;
  }
}

export async function clearAllSnapshots() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    await new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    emitSnapshotChange({ type: 'clear' });
    return true;
  } catch (error) {
    console.error('[PresetTransfer] IndexedDB clear failed:', error);
    return false;
  }
}

export async function getSnapshotStats() {
  try {
    const snapshots = await getAllSnapshots();

    let totalSize = 0;
    const stats = snapshots.map(state => {
      const size = JSON.stringify(state).length;
      totalSize += size;

      return {
        base: state.normalizedBase,
        presetName: state.presetName,
        version: state.version,
        stitchCount: state.stitchCount,
        sizeKB: (size / 1024).toFixed(2),
        updatedAt: new Date(state.updatedAt).toLocaleString(),
      };
    });

    stats.sort((a, b) => parseFloat(b.sizeKB) - parseFloat(a.sizeKB));

    return {
      count: snapshots.length,
      totalSizeKB: (totalSize / 1024).toFixed(2),
      snapshots: stats,
    };
  } catch (error) {
    console.error('[PresetTransfer] Failed to get snapshot stats:', error);
    return { count: 0, totalSizeKB: '0', snapshots: [] };
  }
}

export { SNAPSHOT_CHANGE_EVENT };
