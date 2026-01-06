// 快照管理工具函数
import * as SnapshotStorage from './snapshot-storage.js';

/**
 * 获取所有快照的统计信息
 */
export async function getSnapshotStats() {
  return await SnapshotStorage.getSnapshotStats();
}

/**
 * 清理指定的快照
 */
export async function removeSnapshot(normalizedBase) {
  return await SnapshotStorage.deleteSnapshot(normalizedBase);
}

/**
 * 清理所有快照
 */
export async function clearAllSnapshots() {
  return await SnapshotStorage.clearAllSnapshots();
}

/**
 * 在控制台打印快照统计信息
 */
export async function printSnapshotStats() {
  const stats = await getSnapshotStats();

  console.log('=== 预设缝合快照统计 (IndexedDB) ===');
  console.log(`快照数量: ${stats.count}`);
  console.log(`总大小: ${stats.totalSizeKB} KB`);
  console.log('');

  if (stats.snapshots.length > 0) {
    console.table(stats.snapshots);
    console.log('');
    console.log('清理命令:');
    console.log('  清理单个: await window.PresetTransfer.SnapshotUtils.removeSnapshot("预设base名称")');
    console.log('  清理全部: await window.PresetTransfer.SnapshotUtils.clearAllSnapshots()');
  } else {
    console.log('当前没有快照数据');
  }
}
