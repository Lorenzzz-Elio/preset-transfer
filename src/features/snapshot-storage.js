// IndexedDB 存储方案，替代 localStorage
const DB_NAME = 'PresetTransferSnapshots';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';

let dbInstance = null;

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

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'normalizedBase' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
  });
}

export async function saveSnapshot(normalizedBase, state) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const data = {
      normalizedBase,
      ...state,
    };

    await new Promise((resolve, reject) => {
      const request = store.put(data);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    return true;
  } catch (error) {
    console.error('[PresetTransfer] IndexedDB 保存失败:', error);
    return false;
  }
}

export async function loadSnapshot(normalizedBase) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return await new Promise((resolve, reject) => {
      const request = store.get(normalizedBase);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[PresetTransfer] IndexedDB 读取失败:', error);
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
    console.error('[PresetTransfer] IndexedDB 读取全部失败:', error);
    return [];
  }
}

export async function deleteSnapshot(normalizedBase) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    await new Promise((resolve, reject) => {
      const request = store.delete(normalizedBase);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    return true;
  } catch (error) {
    console.error('[PresetTransfer] IndexedDB 删除失败:', error);
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

    return true;
  } catch (error) {
    console.error('[PresetTransfer] IndexedDB 清空失败:', error);
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
    console.error('[PresetTransfer] 获取统计失败:', error);
    return { count: 0, totalSizeKB: '0', snapshots: [] };
  }
}
