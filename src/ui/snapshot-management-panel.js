import { PT } from '../core/api-compat.js';
import { extractPresetVersionInfo } from '../core/preset-name-utils.js';
import { escapeHtml, getCurrentApiInfo, getJQuery, getParentWindow } from '../core/utils.js';
import { getNameMatchKey } from '../preset/entry-match-utils.js';
import { getPresetDataFromManager } from '../preset/preset-manager.js';
import {
  STITCH_STATE_SCHEMA_VERSION,
  countPatchStitches,
  normalizeSnapshotPatch,
  syncStitchPatchSnapshot,
} from '../features/preset-stitch-state.js';
import * as SnapshotStorage from '../features/snapshot-storage.js';

const SNAPSHOT_EDIT_MODAL_ID = 'pt-snapshot-edit-modal';
const SNAPSHOT_REFRESH_DELAY_MS = 120;

let snapshotListCache = [];
let refreshTimer = null;

function cloneDeep(value) {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function showToast(level, message) {
  const fn = window.toastr?.[level];
  if (typeof fn === 'function') {
    fn(message);
  }
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function formatDate(timestamp) {
  if (!timestamp) return '未记录时间';
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getVersionLabel(snapshot) {
  const version = String(snapshot?.version ?? '').trim();
  return version ? `v${version}` : '未标注版本';
}

function getCurrentPresetName() {
  try {
    return PT.API.getLoadedPresetName?.() ?? null;
  } catch {
    return null;
  }
}

function getCurrentPresetData(apiInfo, presetName) {
  try {
    const livePreset = apiInfo?.presetManager?.getCompletionPresetByName?.('in_use');
    if (livePreset && typeof livePreset === 'object') {
      return livePreset;
    }
  } catch {
    /* ignore */
  }

  return getPresetDataFromManager(apiInfo, presetName);
}

function getSnapshotEntryName(stitch) {
  const name = String(stitch?.prompt?.name ?? '').trim();
  return name || '未命名条目';
}

function getSnapshotEntryKey(stitch, fallbackKey) {
  const stitchId = String(stitch?.stitchId ?? '').trim();
  return stitchId || fallbackKey;
}

function flattenSnapshotPatchEntries(patch) {
  const entries = [];
  const normalizedPatch = normalizeSnapshotPatch(patch);
  const runs = Array.isArray(normalizedPatch?.runs) ? normalizedPatch.runs : [];

  runs.forEach((run, runIndex) => {
    const runMeta = {
      prevAnchor: cloneDeep(run?.prevAnchor ?? null),
      nextAnchor: cloneDeep(run?.nextAnchor ?? null),
      prevAnchors: cloneDeep(Array.isArray(run?.prevAnchors) ? run.prevAnchors : []),
      nextAnchors: cloneDeep(Array.isArray(run?.nextAnchors) ? run.nextAnchors : []),
      prevAnchorSourceIndex: Number.isFinite(run?.prevAnchorSourceIndex) ? run.prevAnchorSourceIndex : -1,
      nextAnchorSourceIndex: Number.isFinite(run?.nextAnchorSourceIndex) ? run.nextAnchorSourceIndex : -1,
      startSourceIndex: Number.isFinite(run?.startSourceIndex) ? run.startSourceIndex : -1,
      endSourceIndex: Number.isFinite(run?.endSourceIndex) ? run.endSourceIndex : -1,
    };
    const runKey = JSON.stringify(runMeta);

    (Array.isArray(run?.stitches) ? run.stitches : []).forEach((stitch, stitchIndex) => {
      const key = getSnapshotEntryKey(stitch, `run:${runIndex}:${stitchIndex}`);
      const name = getSnapshotEntryName(stitch);

      entries.push({
        key,
        stitchId: String(stitch?.stitchId ?? '').trim(),
        name,
        nameKey: getNameMatchKey(name),
        kind: 'run',
        prompt: cloneDeep(stitch?.prompt ?? {}),
        enabled: stitch?.enabled === true,
        runMeta,
        runKey,
      });
    });
  });

  return entries;
}

function buildPatchFromEntries(sourcePatch, entries) {
  const nextPatch = {
    schema: Number.isFinite(sourcePatch?.schema) ? sourcePatch.schema : 1,
    createdAt: new Date().toISOString(),
    runs: [],
    uninserted: [],
  };

  let currentRun = null;
  let currentRunKey = '';

  entries.forEach(entry => {
    if (entry.kind === 'run') {
      if (!currentRun || entry.runKey !== currentRunKey) {
        currentRun = {
          ...(entry.runMeta ? cloneDeep(entry.runMeta) : {}),
          stitches: [],
        };
        nextPatch.runs.push(currentRun);
        currentRunKey = entry.runKey;
      }

      currentRun.stitches.push({
        stitchId: entry.stitchId,
        prompt: cloneDeep(entry.prompt),
        enabled: entry.enabled === true,
      });
    }
  });

  nextPatch.runs = nextPatch.runs.filter(run => Array.isArray(run.stitches) && run.stitches.length > 0);
  return normalizeSnapshotPatch(nextPatch);
}

function removeEntriesFromPatch(patch, entryKeys) {
  const removalSet = new Set(entryKeys);
  const nextPatch = cloneDeep(normalizeSnapshotPatch(patch) ?? {});

  nextPatch.runs = (Array.isArray(nextPatch.runs) ? nextPatch.runs : [])
    .map((run, runIndex) => {
      const stitches = (Array.isArray(run?.stitches) ? run.stitches : []).filter((stitch, stitchIndex) => {
        const key = getSnapshotEntryKey(stitch, `run:${runIndex}:${stitchIndex}`);
        return !removalSet.has(key);
      });
      return { ...run, stitches };
    })
    .filter(run => Array.isArray(run.stitches) && run.stitches.length > 0);
  nextPatch.uninserted = [];

  return normalizeSnapshotPatch(nextPatch);
}

function mergeSnapshotStates(targetState, sourceState, options = {}) {
  const targetEntries = flattenSnapshotPatchEntries(targetState?.patch);
  const sourceEntries = flattenSnapshotPatchEntries(sourceState?.patch);
  const nextEntries = targetEntries.map(entry => cloneDeep(entry));

  for (const sourceEntry of sourceEntries) {
    const sourceStitchId = String(sourceEntry?.stitchId ?? '').trim();
    const sourceNameKey = String(sourceEntry?.nameKey ?? '').trim();

    let matchIndex = -1;

    if (sourceStitchId) {
      matchIndex = nextEntries.findIndex(entry => String(entry?.stitchId ?? '').trim() === sourceStitchId);
    }

    if (matchIndex === -1 && sourceNameKey) {
      matchIndex = nextEntries.findIndex(entry => String(entry?.nameKey ?? '').trim() === sourceNameKey);
    }

    if (matchIndex >= 0) {
      nextEntries[matchIndex] = cloneDeep(sourceEntry);
    } else {
      nextEntries.push(cloneDeep(sourceEntry));
    }
  }

  const patch = normalizeSnapshotPatch(buildPatchFromEntries(targetState?.patch ?? sourceState?.patch, nextEntries));
  return {
    schema: STITCH_STATE_SCHEMA_VERSION,
    updatedAt: options.updatedAt ?? Date.now(),
    presetName: String(options.presetName ?? sourceState?.presetName ?? targetState?.presetName ?? '').trim(),
    version: String(options.version ?? sourceState?.version ?? targetState?.version ?? '').trim(),
    patch,
    stitchCount: countPatchStitches(patch),
  };
}

async function loadSnapshotList() {
  try {
    const snapshots = await SnapshotStorage.getAllSnapshots();
    snapshotListCache = snapshots.sort((a, b) => {
      const aUpdated = Number(a?.updatedAt) || 0;
      const bUpdated = Number(b?.updatedAt) || 0;
      return bUpdated - aUpdated;
    });
    return snapshotListCache;
  } catch (error) {
    console.error('[PresetTransfer] Failed to load snapshots:', error);
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
        <p class="pt-snapshot-empty-hint">保存当前预设快照后，这里会显示可复用的缝合快照。</p>
      </div>
    `);
    return;
  }

  let totalSize = 0;
  const items = snapshots
    .map(snapshot => {
      const size = JSON.stringify(snapshot).length;
      totalSize += size;

      return `
        <div class="pt-snapshot-item" data-base="${escapeHtml(snapshot.normalizedBase)}">
          <div class="pt-snapshot-header">
            <div class="pt-snapshot-title">
              <strong>${escapeHtml(snapshot.presetName || snapshot.normalizedBase)}</strong>
              <span class="pt-snapshot-version">${escapeHtml(getVersionLabel(snapshot))}</span>
            </div>
            <div class="pt-snapshot-actions">
              <button
                type="button"
                class="pt-snapshot-edit menu_button"
                data-base="${escapeHtml(snapshot.normalizedBase)}"
                title="编辑此快照"
                aria-label="编辑此快照"
              >
                <i class="fa fa-pencil"></i>
              </button>
              <button
                type="button"
                class="pt-snapshot-delete menu_button"
                data-base="${escapeHtml(snapshot.normalizedBase)}"
                title="删除此快照"
                aria-label="删除此快照"
              >
                <i class="fa fa-trash"></i>
              </button>
            </div>
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
    })
    .join('');

  $list.html(`
    <div class="pt-snapshot-summary">
      <span>共 ${snapshots.length} 个快照</span>
      <span>总大小: ${formatBytes(totalSize)}</span>
    </div>
    <div class="pt-snapshot-items">${items}</div>
  `);
}

async function refreshSnapshotList() {
  const snapshots = await loadSnapshotList();
  renderSnapshotList(snapshots);
}

function scheduleSnapshotRefresh() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }

  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshSnapshotList();
  }, SNAPSHOT_REFRESH_DELAY_MS);
}

async function handleDeleteSnapshot(normalizedBase) {
  const snapshot = snapshotListCache.find(item => item.normalizedBase === normalizedBase);
  if (!snapshot) return;

  const confirmed = confirm(
    `确定要删除快照“${snapshot.presetName || snapshot.normalizedBase}”吗？\n\n删除后将无法再用它迁移缝合条目。`,
  );
  if (!confirmed) return;

  const deleted = await SnapshotStorage.deleteSnapshot(normalizedBase);
  if (!deleted) {
    showToast('error', '删除快照失败。');
    return;
  }

  showToast('success', `已删除快照：${snapshot.presetName || snapshot.normalizedBase}`);
}

async function handleSaveCurrentSnapshot() {
  try {
    const apiInfo = getCurrentApiInfo();
    if (!apiInfo?.presetManager) {
      throw new Error('无法获取当前预设管理器。');
    }

    const presetName = String(getCurrentPresetName() ?? '').trim();
    if (!presetName) {
      throw new Error('当前没有已加载的预设。');
    }

    const presetData = getCurrentPresetData(apiInfo, presetName);
    if (!presetData || typeof presetData !== 'object') {
      throw new Error('无法读取当前预设数据。');
    }

    const info = extractPresetVersionInfo(presetName);
    const existingSnapshot = info?.normalizedBase ? await SnapshotStorage.loadSnapshot(info.normalizedBase) : null;
    const result = await syncStitchPatchSnapshot(presetName, presetData, { deleteIfEmpty: false });

    if (result?.status === 'saved') {
      showToast('success', existingSnapshot ? '当前预设快照已覆盖保存。' : '当前预设快照已保存。');
      return;
    }

    if (result?.status === 'skipped_empty_meta' || result?.status === 'skipped_empty_patch') {
      showToast('info', '当前预设没有可保存的缝合条目。');
      return;
    }

    throw new Error('保存当前预设快照失败。');
  } catch (error) {
    console.error('[PresetTransfer] Failed to save current snapshot:', error);
    showToast('error', error.message || '保存当前预设快照失败。');
  }
}

function closeSnapshotEditModal() {
  const $ = getJQuery();
  $(`#${SNAPSHOT_EDIT_MODAL_ID}`).remove();
}

function renderSnapshotEditorState($modal, workingState, normalizedBase) {
  const descriptors = flattenSnapshotPatchEntries(workingState?.patch);
  const listHtml =
    descriptors.length > 0
      ? descriptors
          .map(entry => {
            const locationLabel = entry.kind === 'run' ? '已插入' : '未插入';
            return `
              <div class="pt-snapshot-entry-item" data-key="${escapeHtml(entry.key)}">
                <div class="pt-snapshot-entry-main">
                  <div class="pt-snapshot-entry-name">${escapeHtml(entry.name)}</div>
                  <div class="pt-snapshot-entry-meta">${escapeHtml(locationLabel)}</div>
                </div>
                <button
                  type="button"
                  class="pt-snapshot-entry-remove menu_button"
                  data-key="${escapeHtml(entry.key)}"
                  title="删除此条目"
                  aria-label="删除此条目"
                >
                  <i class="fa fa-trash"></i>
                </button>
              </div>
            `;
          })
          .join('')
      : `
          <div class="pt-snapshot-entry-empty">
            当前快照内已没有条目。保存后将直接删除整个快照。
          </div>
        `;

  $modal.find('.pt-snapshot-editor-count').text(`${descriptors.length} 条缝合`);
  $modal.find('.pt-snapshot-editor-base').text(normalizedBase);
  $modal.find('.pt-snapshot-entry-list').html(listHtml);
}

async function handleSnapshotEditorSave(currentBase, originalSnapshot, workingState, $modal) {
  const $ = getJQuery();
  const newPresetName = String($modal.find('.pt-snapshot-editor-name').val() ?? '').trim();
  if (!newPresetName) {
    showToast('error', '快照预设名不能为空。');
    return;
  }

  const targetInfo = extractPresetVersionInfo(newPresetName);
  const targetBase = String(targetInfo?.normalizedBase ?? '').trim();
  if (!targetBase) {
    showToast('error', '无法根据该名称生成快照索引。');
    return;
  }

  const stitchCount = countPatchStitches(workingState.patch);
  if (stitchCount === 0) {
    const deleted = await SnapshotStorage.deleteSnapshot(currentBase);
    if (!deleted) {
      showToast('error', '删除空快照失败。');
      return;
    }

    closeSnapshotEditModal();
    showToast('success', '快照已清空并删除。');
    return;
  }

  const nextState = {
    ...cloneDeep(originalSnapshot),
    presetName: newPresetName,
    version: targetInfo?.version ? String(targetInfo.version) : '',
    updatedAt: Date.now(),
    patch: normalizeSnapshotPatch(workingState.patch),
    stitchCount,
  };

  if (targetBase === currentBase) {
    const saved = await SnapshotStorage.putSnapshot({ ...nextState, normalizedBase: currentBase });
    if (!saved) {
      showToast('error', '保存快照失败。');
      return;
    }

    closeSnapshotEditModal();
    showToast('success', '快照已更新。');
    return;
  }

  const targetSnapshot = await SnapshotStorage.loadSnapshot(targetBase);
  if (targetSnapshot) {
    const confirmed = confirm(
      `目标快照“${targetSnapshot.presetName || targetBase}”已存在。\n\n` +
        '将把当前快照合并到目标快照：\n' +
        '- 当前快照的同名条目会覆盖目标快照\n' +
        '- 当前快照中的新条目会加入目标快照\n' +
        '- 当前快照会被删除\n\n' +
        '是否继续？',
    );
    if (!confirmed) return;

    const mergedState = mergeSnapshotStates(targetSnapshot, nextState, {
      presetName: newPresetName,
      version: nextState.version,
      updatedAt: Date.now(),
    });

    const saved = await SnapshotStorage.putSnapshot({ ...mergedState, normalizedBase: targetBase });
    if (!saved) {
      showToast('error', '合并快照失败。');
      return;
    }

    const deleted = await SnapshotStorage.deleteSnapshot(currentBase);
    if (!deleted) {
      showToast('warning', '目标快照已更新，但原快照删除失败，请手动检查。');
    } else {
      showToast('success', '快照已合并。');
    }

    closeSnapshotEditModal();
    return;
  }

  const saved = await SnapshotStorage.putSnapshot({ ...nextState, normalizedBase: targetBase });
  if (!saved) {
    showToast('error', '迁移快照失败。');
    return;
  }

  const deleted = await SnapshotStorage.deleteSnapshot(currentBase);
  if (!deleted) {
    showToast('warning', '新索引快照已保存，但旧快照删除失败，请手动检查。');
  } else {
    showToast('success', '快照索引已更新。');
  }

  closeSnapshotEditModal();
}

async function openSnapshotEditor(normalizedBase) {
  const snapshot = await SnapshotStorage.loadSnapshot(normalizedBase);
  if (!snapshot) {
    showToast('error', '找不到对应的快照。');
    return;
  }

  const $ = getJQuery();
  closeSnapshotEditModal();

  const workingState = {
    ...cloneDeep(snapshot),
    patch: normalizeSnapshotPatch(snapshot.patch),
  };
  const modalHtml = `
    <div id="${SNAPSHOT_EDIT_MODAL_ID}" class="pt-snapshot-modal" tabindex="-1">
      <div class="pt-snapshot-modal-card">
        <div class="pt-snapshot-modal-header">
          <div class="pt-snapshot-modal-heading">
            <div class="pt-snapshot-modal-title">编辑快照</div>
            <div class="pt-snapshot-modal-subtitle">
              可修改快照归属预设名。若目标快照已存在，会自动合并，且当前快照的同名条目会覆盖目标快照。
            </div>
          </div>
        </div>
        <div class="pt-snapshot-modal-body">
          <label class="pt-snapshot-field">
            <span class="pt-snapshot-field-label">快照预设名</span>
            <input
              type="text"
              class="text_pole pt-snapshot-editor-name"
              value="${escapeHtml(snapshot.presetName || '')}"
              placeholder="输入用于归并/迁移的预设名"
            />
          </label>
          <div class="pt-snapshot-editor-summary">
            <span class="pt-snapshot-editor-count"></span>
            <span class="pt-snapshot-editor-base"></span>
          </div>
          <div class="pt-snapshot-entry-list"></div>
        </div>
        <div class="pt-snapshot-modal-actions">
          <button type="button" class="menu_button pt-snapshot-editor-cancel">取消</button>
          <button type="button" class="menu_button pt-snapshot-editor-save">保存</button>
        </div>
      </div>
    </div>
  `;

  $('body').append(modalHtml);
  const $modal = $(`#${SNAPSHOT_EDIT_MODAL_ID}`);

  renderSnapshotEditorState($modal, workingState, normalizedBase);
  $modal.focus();

  $modal.on('click', event => {
    if (event.target === $modal[0]) {
      closeSnapshotEditModal();
    }
  });

  $modal.on('keydown', event => {
    if (event.key === 'Escape') {
      closeSnapshotEditModal();
    }
  });

  $modal.find('.pt-snapshot-editor-cancel').on('click', () => {
    closeSnapshotEditModal();
  });

  $modal.on('click', '.pt-snapshot-entry-remove', function () {
    const key = String($(this).data('key') ?? '').trim();
    if (!key) return;
    workingState.patch = removeEntriesFromPatch(workingState.patch, [key]);
    renderSnapshotEditorState($modal, workingState, normalizedBase);
  });

  $modal.find('.pt-snapshot-editor-save').on('click', async () => {
    await handleSnapshotEditorSave(normalizedBase, snapshot, workingState, $modal);
  });
}

function bindSnapshotPanelEvents() {
  const $ = getJQuery();

  $('#pt-snapshot-refresh')
    .off('click')
    .on('click', async () => {
      await refreshSnapshotList();
    });

  $('#pt-snapshot-save-current')
    .off('click')
    .on('click', async () => {
      await handleSaveCurrentSnapshot();
    });

  $('#pt-snapshot-list')
    .off('click', '.pt-snapshot-delete')
    .on('click', '.pt-snapshot-delete', async function (event) {
      event.stopPropagation();
      const normalizedBase = String($(this).data('base') ?? '').trim();
      if (!normalizedBase) return;
      await handleDeleteSnapshot(normalizedBase);
    });

  $('#pt-snapshot-list')
    .off('click', '.pt-snapshot-edit')
    .on('click', '.pt-snapshot-edit', async function (event) {
      event.stopPropagation();
      const normalizedBase = String($(this).data('base') ?? '').trim();
      if (!normalizedBase) return;
      await openSnapshotEditor(normalizedBase);
    });
}

function bindSnapshotRefreshSources() {
  const parentWindow = getParentWindow();
  if (parentWindow.__ptSnapshotRefreshSourcesBound) return;
  parentWindow.__ptSnapshotRefreshSourcesBound = true;

  parentWindow.addEventListener(SnapshotStorage.SNAPSHOT_CHANGE_EVENT, () => {
    scheduleSnapshotRefresh();
  });

  const refreshFromEvent = () => {
    scheduleSnapshotRefresh();
  };

  const nativeEvents = [
    'preset_changed',
    'oai_preset_changed_after',
    'PRESET_RENAMED',
    'preset_renamed',
    'PRESET_DELETED',
    'preset_deleted',
  ];

  nativeEvents.forEach(eventName => {
    try {
      PT.API.eventOn?.(eventName, () => setTimeout(refreshFromEvent, 0));
    } catch {
      /* ignore */
    }
  });
}

function createSnapshotManagementPanel() {
  return `
    <div class="pt-snapshot-panel">
      <div class="pt-snapshot-toolbar">
        <button id="pt-snapshot-refresh" class="menu_button">
          <i class="fa fa-refresh"></i> 刷新
        </button>
        <button id="pt-snapshot-save-current" class="menu_button">
          <i class="fa fa-save"></i> 保存预设快照
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

async function initSnapshotManagementPanel() {
  bindSnapshotPanelEvents();
  bindSnapshotRefreshSources();
  await refreshSnapshotList();
}

export { createSnapshotManagementPanel, initSnapshotManagementPanel, refreshSnapshotList };
