import { loadTransferSettings, saveTransferSettings } from '../settings/settings-manager.js';
import * as SnapshotStorage from './snapshot-storage.js';

const MIGRATION_FLAG_KEY = 'presetStitchSnapshotMigrated';

async function migrateFromLocalStorage() {
  try {
    const settings = loadTransferSettings();

    // 检查是否已经迁移过
    if (settings[MIGRATION_FLAG_KEY] === true) {
      return { migrated: false, reason: 'already_migrated' };
    }

    // 读取旧数据
    const oldSnapshots = settings.presetStitchStateByBase || {};
    const entries = Object.entries(oldSnapshots);

    if (entries.length === 0) {
      // 没有旧数据，标记为已迁移
      settings[MIGRATION_FLAG_KEY] = true;
      saveTransferSettings(settings);
      return { migrated: false, reason: 'no_data', count: 0 };
    }

    // 迁移到 IndexedDB
    let successCount = 0;
    let failCount = 0;
    const errors = [];

    for (const [base, state] of entries) {
      try {
        await SnapshotStorage.saveSnapshot(base, state);
        successCount++;
      } catch (error) {
        failCount++;
        errors.push({ base, error: error.message });
        console.error(`[PresetTransfer] 迁移快照失败 (${base}):`, error);
      }
    }

    // 标记为已迁移
    settings[MIGRATION_FLAG_KEY] = true;

    // 清理 localStorage 中的旧数据（可选）
    if (successCount > 0) {
      delete settings.presetStitchStateByBase;
    }

    saveTransferSettings(settings);

    return {
      migrated: true,
      total: entries.length,
      success: successCount,
      failed: failCount,
      errors,
    };
  } catch (error) {
    console.error('[PresetTransfer] 迁移过程失败:', error);
    return {
      migrated: false,
      reason: 'migration_error',
      error: error.message,
    };
  }
}

async function checkAndMigrate() {
  const result = await migrateFromLocalStorage();

  if (result.migrated) {
    const message = `已自动迁移 ${result.success} 个快照到 IndexedDB`;
    console.info(`[PresetTransfer] ${message}`);

    if (window.toastr) {
      if (result.failed > 0) {
        window.toastr.warning(`${message}（${result.failed} 个失败）`);
      } else {
        window.toastr.success(message);
      }
    }

    return result;
  }

  if (result.reason === 'no_data') {
    console.info('[PresetTransfer] 没有需要迁移的快照数据');
  }

  return result;
}

export {
  migrateFromLocalStorage,
  checkAndMigrate,
};
