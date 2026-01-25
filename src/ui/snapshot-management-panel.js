import { getJQuery } from '../core/utils.js';
import * as SnapshotStorage from '../features/snapshot-storage.js';
import { migrateFromLocalStorage } from '../features/snapshot-migration.js';

let snapshotListCache = [];

function formatBytes(bytes) {
  return (bytes / 1024).toFixed(2) + ' KB';
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function loadSnapshotList() {
  try {
    const snapshots = await SnapshotStorage.getAllSnapshots();
    snapshotListCache = snapshots.sort((a, b) => b.updatedAt - a.updatedAt);
    return snapshotListCache;
  } catch (error) {
    console.error('[PresetTransfer] 加载快照列表失败:', error);
    return [];
  }
}

function renderSnapshotList(snapshots) {
  const $ = getJQuery();
  const $list = $('#pt-snapshot-list');

  if (!$list.length) return;

  if (snapshots.length === 0) {
    $list.html(`
      <div class="pt-snapshot-empty">
        <p>暂无快照数据</p>
        <p class="pt-snapshot-empty-hint">快照会在保存预设时自动创建，用于跨酒馆迁移缝合条目</p>
      </div>
    `);
    return;
  }

  let totalSize = 0;
  const items = snapshots.map(snapshot => {
    const size = JSON.stringify(snapshot).length;
    totalSize += size;

    return `
      <div class="pt-snapshot-item" data-base="${snapshot.normalizedBase}">
        <div class="pt-snapshot-header">
          <div class="pt-snapshot-title">
            <strong>${snapshot.presetName || snapshot.normalizedBase}</strong>
            <span class="pt-snapshot-version">v${snapshot.version}</span>
          </div>
          <button class="pt-snapshot-delete menu_button" data-base="${snapshot.normalizedBase}" title="删除此快照">
            <i class="fa fa-trash"></i>
          </button>
        </div>
        <div class="pt-snapshot-info">
          <span class="pt-snapshot-info-item">
            <i class="fa fa-puzzle-piece"></i> ${snapshot.stitchCount} 条缝合
          </span>
          <span class="pt-snapshot-info-item">
            <i class="fa fa-database"></i> ${formatBytes(size)}
          </span>
          <span class="pt-snapshot-info-item">
            <i class="fa fa-clock"></i> ${formatDate(snapshot.updatedAt)}
          </span>
        </div>
      </div>
    `;
  }).join('');

  $list.html(`
    <div class="pt-snapshot-summary">
      <span>共 ${snapshots.length} 个快照</span>
      <span>总大小: ${formatBytes(totalSize)}</span>
    </div>
    <div class="pt-snapshot-items">
      ${items}
    </div>
  `);

  // 绑定删除按钮事件
  $list.find('.pt-snapshot-delete').on('click', async function(e) {
    e.stopPropagation();
    const base = $(this).data('base');
    await handleDeleteSnapshot(base);
  });
}

async function handleDeleteSnapshot(normalizedBase) {
  const $ = getJQuery();
  const snapshot = snapshotListCache.find(s => s.normalizedBase === normalizedBase);

  if (!snapshot) return;

  const confirmed = confirm(`确定要删除快照"${snapshot.presetName}"吗？\n\n删除后将无法从此快照恢复缝合条目。`);
  if (!confirmed) return;

  try {
    await SnapshotStorage.deleteSnapshot(normalizedBase);
    if (window.toastr) {
      window.toastr.success(`已删除快照: ${snapshot.presetName}`);
    }
    await refreshSnapshotList();
  } catch (error) {
    console.error('[PresetTransfer] 删除快照失败:', error);
    if (window.toastr) {
      window.toastr.error('删除快照失败: ' + error.message);
    }
  }
}

async function handleMigrateFromLocalStorage() {
  const $ = getJQuery();

  const confirmed = confirm(
    '确定要从 localStorage 迁移快照数据吗？\n\n' +
    '这将把旧的快照数据迁移到 IndexedDB。\n' +
    '迁移成功后，localStorage 中的旧数据将被清理。'
  );

  if (!confirmed) return;

  try {
    const result = await migrateFromLocalStorage();

    if (result.migrated) {
      if (window.toastr) {
        if (result.failed > 0) {
          window.toastr.warning(
            `迁移完成：成功 ${result.success} 个，失败 ${result.failed} 个`
          );
        } else {
          window.toastr.success(`成功迁移 ${result.success} 个快照`);
        }
      }
      await refreshSnapshotList();
    } else {
      if (result.reason === 'already_migrated') {
        if (window.toastr) {
          window.toastr.info('数据已经迁移过了');
        }
      } else if (result.reason === 'no_data') {
        if (window.toastr) {
          window.toastr.info('没有需要迁移的数据');
        }
      } else {
        if (window.toastr) {
          window.toastr.error('迁移失败: ' + (result.error || '未知错误'));
        }
      }
    }
  } catch (error) {
    console.error('[PresetTransfer] 迁移失败:', error);
    if (window.toastr) {
      window.toastr.error('迁移失败: ' + error.message);
    }
  }
}

async function handleClearAllSnapshots() {
  const $ = getJQuery();

  if (snapshotListCache.length === 0) {
    if (window.toastr) {
      window.toastr.info('当前没有快照数据');
    }
    return;
  }

  const confirmed = confirm(
    `确定要清空所有 ${snapshotListCache.length} 个快照吗？\n\n` +
    `清空后将无法从快照恢复任何缝合条目。\n\n` +
    `建议：如果只是想节省空间，可以单独删除不需要的快照。`
  );

  if (!confirmed) return;

  try {
    await SnapshotStorage.clearAllSnapshots();
    if (window.toastr) {
      window.toastr.success('已清空所有快照');
    }
    await refreshSnapshotList();
  } catch (error) {
    console.error('[PresetTransfer] 清空快照失败:', error);
    if (window.toastr) {
      window.toastr.error('清空快照失败: ' + error.message);
    }
  }
}

async function refreshSnapshotList() {
  const snapshots = await loadSnapshotList();
  renderSnapshotList(snapshots);
}

function createSnapshotManagementPanel() {
  return `
    <div class="pt-snapshot-panel">
      <div class="pt-snapshot-toolbar">
        <button id="pt-snapshot-refresh" class="menu_button">
          <i class="fa fa-refresh"></i> 刷新
        </button>
        <button id="pt-snapshot-migrate" class="menu_button">
          <i class="fa fa-exchange"></i> 迁移旧数据
        </button>
      </div>
      <div id="pt-snapshot-list" class="pt-snapshot-list">
        <div class="pt-snapshot-loading">
          <i class="fa fa-spinner fa-spin"></i> 加载中...
        </div>
      </div>
    </div>
  `;
}

function bindSnapshotPanelEvents() {
  const $ = getJQuery();

  $('#pt-snapshot-refresh').off('click').on('click', async () => {
    await refreshSnapshotList();
  });

  $('#pt-snapshot-migrate').off('click').on('click', async () => {
    await handleMigrateFromLocalStorage();
  });
}

async function initSnapshotManagementPanel() {
  // 先执行迁移

  // 然后初始化面板
  bindSnapshotPanelEvents();
  await refreshSnapshotList();
}

export {
  createSnapshotManagementPanel,
  initSnapshotManagementPanel,
  refreshSnapshotList,
};
