import { PT } from '../core/api-compat.js';
import { getCurrentApiInfo, getParentWindow, getSillyTavernContext } from '../core/utils.js';
import { arePresetsSameDifferentVersion, extractPresetVersionInfo } from '../core/preset-name-utils.js';
import { getPresetTransferSettingsNode } from '../core/pt-extension-settings.js';
import { getDefaultSettings } from '../settings/settings-manager.js';
import { getPresetDataFromManager, switchToPreset } from '../preset/preset-manager.js';
import { extractStitchPatch, applyStitchPatch } from '../preset/stitch-patch.js';
import {
  countPatchStitches,
  findBestStitchPatchSnapshotForPresetName,
  getStitchPatchSnapshotForBase,
  hasAnyStitchMeta,
  recordStitchPatchSnapshot,
} from './preset-stitch-state.js';
import { showPresetGitUpdateModal } from '../ui/preset-git-update-modal.js';
import { getPresetGitSource, setPresetGitSource } from './preset-stitch-settings.js';
import {
  compareVersions,
  extractVersionFromTagByTemplate,
  normalizeVersion,
  fetchGitHubTags,
  parseGitHubRepo,
  pickLatestTag,
  resolveTagNameFromTemplate,
  fetchGitHubReleaseByTag,
  fetchPresetJsonFromGitHub,
} from './preset-git-sync.js';

const SKIP_AUTO_MIGRATE_KEY = '__ptPresetTransferSkipAutoMigrateUntilByPresetName';
const SKIP_AUTO_MIGRATE_DEFAULT_TTL_MS = 60 * 1000;

function loadAutomationSettings() {
  const defaults = getDefaultSettings();
  let sharedRaw = null;
  try {
    const { node } = getPresetTransferSettingsNode();
    const shared = node?.transferToolsSettings;
    if (shared && typeof shared === 'object') {
      sharedRaw = shared;
    }
  } catch {
    // ignore
  }
  return sharedRaw ? { ...defaults, ...sharedRaw } : defaults;
}

function getSkipAutoMigrateStore() {
  const pw = typeof getParentWindow === 'function' ? getParentWindow() : window;
  const store = pw?.[SKIP_AUTO_MIGRATE_KEY];
  if (store && typeof store === 'object') return store;
  const next = {};
  if (pw && typeof pw === 'object') {
    pw[SKIP_AUTO_MIGRATE_KEY] = next;
  }
  return next;
}

function markSkipAutoMigrateForPresetName(presetName, ttlMs = SKIP_AUTO_MIGRATE_DEFAULT_TTL_MS) {
  const name = String(presetName ?? '').trim();
  if (!name) return false;
  const ttl = Math.max(1000, Number(ttlMs) || SKIP_AUTO_MIGRATE_DEFAULT_TTL_MS);
  const store = getSkipAutoMigrateStore();
  store[name] = Date.now() + ttl;
  return true;
}

function shouldSkipAutoMigrateForPresetName(presetName) {
  const name = String(presetName ?? '').trim();
  if (!name) return false;
  const store = getSkipAutoMigrateStore();
  const until = store[name];
  if (typeof until !== 'number') return false;
  if (Date.now() <= until) return true;
  delete store[name];
  return false;
}

async function getUsableSnapshotPatchForPresetName(presetName) {
  const info = extractPresetVersionInfo(presetName);
  if (!info?.normalizedBase || !info?.version) return null;

  const patch = await getStitchPatchSnapshotForBase(info.normalizedBase);
  if (patch && countPatchStitches(patch) > 0) {
    return { base: info.normalizedBase, patch };
  }

  // Base name may change across versions (e.g., adding/removing "Beta").
  // Fall back to fuzzy matching against snapshot metadata.
  const fuzzy = await findBestStitchPatchSnapshotForPresetName(presetName);
  if (fuzzy?.patch && countPatchStitches(fuzzy.patch) > 0) {
    return { base: fuzzy.base, patch: fuzzy.patch };
  }

  return null;
}

function ensurePresetManagerSavePresetWrapped(presetManager) {
  if (!presetManager || typeof presetManager !== 'object') return false;
  if (presetManager.__ptSavePresetWrapped) return true;

  const original = presetManager.savePreset;
  if (typeof original !== 'function') return false;

  presetManager.__ptSavePresetWrapped = true;
  presetManager.__ptSavePresetOriginal = original;

  presetManager.savePreset = async function (...args) {
    const result = await original.apply(this, args);
    try {
      const [presetName, presetData] = args;
      recordStitchPatchSnapshot(presetName, presetData);
    } catch {
      /* ignore */
    }
    return result;
  };

  return true;
}

function getApiInfoForPresetManager(presetManagerKey) {
  const context = getSillyTavernContext();
  const presetManager = context?.getPresetManager?.(presetManagerKey);
  if (!presetManager) return null;

  ensurePresetManagerSavePresetWrapped(presetManager);

  const { preset_names } = presetManager.getPresetList();
  const presetNames = Array.isArray(preset_names) ? preset_names : Object.keys(preset_names || {});

  return {
    apiType: presetManagerKey,
    presetManager,
    presetNames,
    context,
  };
}

function findBestSourcePreset(apiInfo, targetPresetName) {
  const candidates = Array.isArray(apiInfo?.presetNames) ? apiInfo.presetNames : [];
  const targetInfo = extractPresetVersionInfo(targetPresetName);
  if (!targetInfo?.version) return null;

  let best = null;

  for (const name of candidates) {
    if (!name || name === targetPresetName) continue;
    const match = arePresetsSameDifferentVersion(targetPresetName, name).match;
    if (!match) continue;

    let data;
    try {
      data = getPresetDataFromManager(apiInfo, name);
    } catch {
      continue;
    }
    if (!hasAnyStitchMeta(data)) continue;

    const info = extractPresetVersionInfo(name);
    if (!info?.version) continue;

    if (!best) {
      best = { name, version: info.version };
      continue;
    }

    if (compareVersions(info.version, best.version) > 0) {
      best = { name, version: info.version };
    }
  }

  return best?.name ?? null;
}

function formatGitHubCompareToChangelog(compareJson) {
  if (!compareJson || typeof compareJson !== 'object') return '';
  const commits = Array.isArray(compareJson?.commits) ? compareJson.commits : [];
  if (commits.length === 0) return '（无可显示的提交记录）';

  const lines = [];
  for (const c of commits) {
    const sha = String(c?.sha ?? '').slice(0, 7);
    const msg = String(c?.commit?.message ?? '').split('\n')[0].trim();
    const author = String(c?.commit?.author?.name ?? '').trim();
    const suffix = [sha ? `#${sha}` : '', author ? `by ${author}` : ''].filter(Boolean).join(' ');
    lines.push(`- ${msg || '(no message)'}${suffix ? ` (${suffix})` : ''}`);
  }

  return lines.join('\n').trim();
}

function getTagTemplateForSource(source) {
  const explicit = String(source?.tagTemplate ?? '').trim();
  if (explicit) return explicit;
  const refTemplate = String(source?.refTemplate ?? '').trim();
  if (refTemplate && refTemplate.includes('{version}')) return refTemplate;
  return '';
}

function findTagNameForVersion(tags, version, tagTemplate = '') {
  const v = normalizeVersion(String(version ?? ''));
  if (!v) return null;
  const list = Array.isArray(tags) ? tags : [];
  for (const t of list) {
    const name = String(t?.name ?? '').trim();
    if (!name) continue;
    const parsed = extractVersionFromTagByTemplate(name, tagTemplate);
    if (!parsed) continue;
    if (normalizeVersion(parsed) === v) return name;
  }
  return null;
}

function confirmStitchMigration(message) {
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    return window.confirm(String(message ?? ''));
  }
  return true;
}

async function applyStitchesToData(apiInfo, sourcePresetName, targetData, options = {}) {
  const { toastPrefix = '', showSuccessToast = true, showNoOpToast = false, insertedEnabled } = options;

  const sourceData = getPresetDataFromManager(apiInfo, sourcePresetName);
  const patch = extractStitchPatch(sourceData);
  const stitchCount = countPatchStitches(patch);

  if (stitchCount === 0) {
    if (showNoOpToast && window.toastr) {
      window.toastr.info(`${toastPrefix}未检测到可迁移的缝合条目`);
    }
    return { stitchCount: 0, applied: null };
  }

  const applied = applyStitchPatch(targetData, patch, { insertedEnabled });

  if (showSuccessToast && window.toastr) {
    window.toastr.success(
      `${toastPrefix}缝合已迁移：${stitchCount} 条（新增 ${applied.addedPrompts}，更新 ${applied.updatedPrompts}）`,
    );
  }

  return { stitchCount, applied };
}

async function applyStitchesPatchToPreset(apiInfo, patch, targetPresetName, options = {}) {
  const { switchToTarget = false, toastPrefix = '', showSuccessToast = true, showNoOpToast = false, insertedEnabled } =
    options;

  const targetData = getPresetDataFromManager(apiInfo, targetPresetName);
  const stitchCount = countPatchStitches(patch);

  if (stitchCount === 0) {
    if (showNoOpToast && window.toastr) window.toastr.info(`${toastPrefix}未检测到可迁移的缝合条目`);
    return { stitchCount: 0, applied: null };
  }

  const applied = applyStitchPatch(targetData, patch, { insertedEnabled });

  await apiInfo.presetManager.savePreset(targetPresetName, targetData);

  if (showSuccessToast && window.toastr) {
    window.toastr.success(
      `${toastPrefix}缝合已迁移：${stitchCount} 条（新增 ${applied.addedPrompts}，更新 ${applied.updatedPrompts}）`,
    );
  }

  if (switchToTarget) {
    try {
      await switchToPreset(apiInfo, targetPresetName);
    } catch {
      /* ignore */
    }
  }

  return { stitchCount, applied };
}

async function migrateStitches(apiInfo, sourcePresetName, targetPresetName, options = {}) {
  const { switchToTarget = false, toastPrefix = '', insertedEnabled } = options;

  const targetData = getPresetDataFromManager(apiInfo, targetPresetName);
  const result = await applyStitchesToData(apiInfo, sourcePresetName, targetData, {
    toastPrefix,
    showSuccessToast: true,
    showNoOpToast: false,
    insertedEnabled,
  });

  if (result.stitchCount === 0) {
    return result;
  }

  await apiInfo.presetManager.savePreset(targetPresetName, targetData);

  if (switchToTarget) {
    try {
      await switchToPreset(apiInfo, targetPresetName);
    } catch {
      /* ignore */
    }
  }

  return result;
}

function findLocalPresetByBaseAndVersion(apiInfo, baseNormalized, version) {
  const want = normalizeVersion(version);
  const names = Array.isArray(apiInfo?.presetNames) ? apiInfo.presetNames : [];

  for (const name of names) {
    const info = extractPresetVersionInfo(name);
    if (!info?.version) continue;
    if (info.normalizedBase !== baseNormalized) continue;
    if (normalizeVersion(info.version) === want) return name;
  }

  return null;
}

async function maybeAutoMigrateOnImport(apiInfo, newPresetName) {
  const settings = loadAutomationSettings();
  const enabled = settings.presetAutoMigrateOnImportEnabled === true;
  if (!enabled) return false;

  if (shouldSkipAutoMigrateForPresetName(newPresetName)) return false;

  const info = extractPresetVersionInfo(newPresetName);
  if (!info?.version) return false;

  const snapshot = await getUsableSnapshotPatchForPresetName(newPresetName);
  if (snapshot?.patch) {
    const stitchCount = countPatchStitches(snapshot.patch);
    if (stitchCount > 0) {
      const ok = confirmStitchMigration(
        `检测到预设“${newPresetName}”可迁移 ${stitchCount} 条缝合（来源：快照）。\n\n是否执行自动迁移？\n\n【确定】迁移\n【取消】跳过（不修改该预设）`,
      );
      if (!ok) {
        if (window.toastr) window.toastr.info('[导入自动] 已取消缝合迁移');
        return true;
      }
    }
    await applyStitchesPatchToPreset(apiInfo, snapshot.patch, newPresetName, {
      switchToTarget: false,
      toastPrefix: '[导入自动] ',
      showSuccessToast: true,
      showNoOpToast: false,
      insertedEnabled: false,
    });
    return true;
  }

  const sourcePresetName = findBestSourcePreset(apiInfo, newPresetName);
  if (!sourcePresetName) return false;

  try {
    const sourceData = getPresetDataFromManager(apiInfo, sourcePresetName);
    const patch = extractStitchPatch(sourceData);
    const stitchCount = countPatchStitches(patch);
    if (stitchCount > 0) {
      const ok = confirmStitchMigration(
        `检测到预设“${newPresetName}”可迁移 ${stitchCount} 条缝合（来源：${sourcePresetName}）。\n\n是否执行自动迁移？\n\n【确定】迁移\n【取消】跳过（不修改该预设）`,
      );
      if (!ok) {
        if (window.toastr) window.toastr.info('[导入自动] 已取消缝合迁移');
        return true;
      }
    }
  } catch {
    // If we fail to pre-calc stitch count, fall back to existing behavior.
  }

  await migrateStitches(apiInfo, sourcePresetName, newPresetName, {
    switchToTarget: false,
    toastPrefix: '[导入自动] ',
    insertedEnabled: false,
  });
  return true;
}

async function maybeAutoUpdateFromGit(apiInfo, presetName) {
  const settings = loadAutomationSettings();
  const enabled = settings.presetGitAutoUpdateEnabled === true;
  if (!enabled) return false;

  const info = extractPresetVersionInfo(presetName);
  if (!info?.version || !info.normalizedBase) return false;

  const sources = settings.presetGitSources && typeof settings.presetGitSources === 'object' ? settings.presetGitSources : {};
  const source = sources[info.normalizedBase];
  if (!source || typeof source !== 'object') return false;

  const repo = parseGitHubRepo(source.repoUrl);
  if (!repo) return false;

  const tagTemplate = getTagTemplateForSource(source);
  const tags = await fetchGitHubTags(repo);
  const latest = pickLatestTag(tags, { tagTemplate });
  if (!latest?.version) return false;

  if (compareVersions(latest.version, info.version) <= 0) return false;

  // Ask for confirmation before applying a potentially destructive update/switch.
  let changelogText = '';
  const headRef = String(latest.name ?? '').trim();
  const baseRef =
    findTagNameForVersion(tags, info.version, tagTemplate) ||
    resolveTagNameFromTemplate(tagTemplate || 'v{version}', info.version);
  const releaseUrl = headRef ? `https://github.com/${repo.owner}/${repo.repo}/releases/tag/${encodeURIComponent(headRef)}` : '';
  const diffUrl =
    baseRef && headRef
      ? `https://github.com/${repo.owner}/${repo.repo}/compare/${encodeURIComponent(baseRef)}...${encodeURIComponent(headRef)}`
      : '';

  let linkUrl = '';
  let linkText = '';

  if (headRef) {
    try {
      const release = await fetchGitHubReleaseByTag({ ...repo, tagName: headRef });
      changelogText = String(release?.body ?? '').trim();
      if (!changelogText) changelogText = '（该版本 Release 未包含正文内容）';
      linkUrl = String(release?.html_url ?? '').trim() || releaseUrl;
      linkText = '打开 GitHub Release';
    } catch (error) {
      console.warn('读取 GitHub Release 失败:', error);
      changelogText = '（未找到该版本的 GitHub Release 更新日志。请确认作者已发布 Release，且 Tag 名称与模板一致。）';
    }
  } else {
    changelogText = '（未能读取更新日志：未解析到最新版本 tag）';
  }

  if (!linkUrl) {
    linkUrl = releaseUrl || diffUrl;
    linkText = releaseUrl ? '打开 GitHub Release' : diffUrl ? '打开 GitHub 差异' : '';
  }

  const ok = await showPresetGitUpdateModal({
    title: '发现预设新版本',
    presetLabel: info.base || presetName,
    localVersion: info.version,
    remoteVersion: latest.version,
    changelogText,
    compareUrl: linkUrl,
    compareButtonText: linkText || '打开 GitHub',
    confirmText: '更新并迁移',
    cancelText: '取消',
  });
  if (!ok) return false;

  // Ensure the target preset exists locally, importing from Git if needed.
  const existingTarget = findLocalPresetByBaseAndVersion(apiInfo, info.normalizedBase, latest.version);
  const targetPresetName = existingTarget || (() => {
    const base = info.base || info.raw || presetName;
    return `${base} v${latest.version}`;
  })();

  // Avoid triggering the import auto-migrate flow for presets created by our own Git updater.
  markSkipAutoMigrateForPresetName(targetPresetName);

  // If the target preset name parses to a different base key, inherit Git source settings
  // so users don't need to re-enter repo/path on every update/rollback.
  try {
    const targetInfo = extractPresetVersionInfo(targetPresetName);
    const targetBase = String(targetInfo?.normalizedBase ?? '').trim();
    const sourceBase = String(info.normalizedBase ?? '').trim();
    if (targetBase && sourceBase && targetBase !== sourceBase && source && !getPresetGitSource(targetBase)) {
      setPresetGitSource(targetBase, source);
    }
  } catch {
    /* ignore */
  }

  if (!existingTarget) {
    const { json } = await fetchPresetJsonFromGitHub(source, { version: latest.version });
    const data = json && typeof json === 'object' ? json : {};
    data.name = targetPresetName;
    await apiInfo.presetManager.savePreset(targetPresetName, data);
  }

  await migrateStitches(apiInfo, presetName, targetPresetName, { switchToTarget: true, toastPrefix: '[Git 自动] ' });
  return true;
}

let state = {
  active: false,
  pollTimer: null,
  knownPresets: new Set(),
  processedImports: new Map(),
  importInProgress: new Set(),
  gitInProgress: false,
  lastGitCheckByBase: new Map(),
};

function markImportProcessed(name) {
  if (!name) return;
  state.processedImports.set(String(name), Date.now());
}

function wasImportProcessedRecently(name, windowMs = 15000) {
  if (!name) return false;
  const key = String(name);
  const last = state.processedImports.get(key);
  if (!last) return false;

  const elapsed = Date.now() - last;
  if (elapsed > windowMs) {
    state.processedImports.delete(key);
    return false;
  }

  return true;
}

function refreshKnownPresets(apiInfo) {
  const names = Array.isArray(apiInfo?.presetNames) ? apiInfo.presetNames : [];
  state.knownPresets = new Set(names);
}

async function pollPresetList() {
  const settings = loadAutomationSettings();
  const wantImport = settings.presetAutoMigrateOnImportEnabled === true;
  if (!wantImport) return;

  const apiInfo = getCurrentApiInfo();
  if (!apiInfo) return;

  const names = Array.isArray(apiInfo.presetNames) ? apiInfo.presetNames : [];
  const current = new Set(names);

  const added = [];
  for (const name of current) {
    if (!state.knownPresets.has(name)) added.push(name);
  }

  if (added.length === 0) {
    state.knownPresets = current;
    return;
  }

  for (const name of added) {
    if (!name) continue;
    if (shouldSkipAutoMigrateForPresetName(name)) continue;
    if (wasImportProcessedRecently(name)) continue;
    if (state.importInProgress.has(name)) continue;
    state.importInProgress.add(name);
    try {
      await maybeAutoMigrateOnImport(apiInfo, name);
      markImportProcessed(name);
    } catch (error) {
      console.error('[PresetTransfer] 导入自动迁移失败:', error);
      if (window.toastr) window.toastr.error('[导入自动] 迁移失败: ' + (error?.message ?? error));
    } finally {
      state.importInProgress.delete(name);
    }
  }

  state.knownPresets = current;
}

function shouldGitCheckNow(baseNormalized, intervalMs = 10 * 60 * 1000) {
  const last = state.lastGitCheckByBase.get(baseNormalized) || 0;
  return Date.now() - last >= intervalMs;
}

async function handlePresetChanged(presetName) {
  const settings = loadAutomationSettings();
  const wantGit = settings.presetGitAutoUpdateEnabled === true;

  // Note: Snapshot recording removed from here - snapshots should only be created
  // when actual stitch operations (transfer/copy) occur, not when switching versions.
  // The snapshot will be recorded via the savePreset wrapper when modifications are saved.

  if (!wantGit) return;

  if (state.gitInProgress) return;

  const info = extractPresetVersionInfo(presetName);
  const base = info?.normalizedBase;
  if (!base) return;

  if (!shouldGitCheckNow(base)) return;
  state.lastGitCheckByBase.set(base, Date.now());

  const apiInfo = getCurrentApiInfo();
  if (!apiInfo) return;

  state.gitInProgress = true;
  try {
    await maybeAutoUpdateFromGit(apiInfo, presetName);
  } catch (error) {
    console.error('[PresetTransfer] Git 自动更新失败:', error);
    if (window.toastr) window.toastr.error('[Git 自动] 更新失败: ' + (error?.message ?? error));
  } finally {
    state.gitInProgress = false;
  }
}

function findSourcePresetForOaiImport(apiInfo, importingPresetName) {
  if (!apiInfo || !importingPresetName) return null;

  // Prefer overwriting scenario: reuse the existing preset with the same name as the source if it has stitches.
  try {
    const existing = getPresetDataFromManager(apiInfo, importingPresetName);
    if (hasAnyStitchMeta(existing)) {
      return importingPresetName;
    }
  } catch {
    // ignore
  }

  return findBestSourcePreset(apiInfo, importingPresetName);
}

async function handleOaiPresetImportReady(payload) {
  const settings = loadAutomationSettings();
  const enabled = settings.presetAutoMigrateOnImportEnabled === true;
  if (!enabled) return;

  const presetName =
    typeof payload === 'string'
      ? payload
      : payload && typeof payload === 'object'
        ? payload.presetName || payload.name || payload.preset
        : null;
  const data = payload && typeof payload === 'object' ? payload.data : null;

  if (!presetName || !data || typeof data !== 'object') return;
  if (shouldSkipAutoMigrateForPresetName(presetName)) return;

  // Only run for versioned presets.
  const info = extractPresetVersionInfo(presetName);
  if (!info?.version) return;

  const apiInfo = getApiInfoForPresetManager('openai');
  if (!apiInfo) return;

  if (state.importInProgress.has(presetName)) return;
  state.importInProgress.add(presetName);

  try {
    const snapshot = await getUsableSnapshotPatchForPresetName(presetName);
    const patch = snapshot?.patch ?? null;

    let result = { stitchCount: 0, applied: null };
    let sourcePreset = snapshot?.base ? '[snapshot]' : null;

    if (patch) {
      const stitchCount = countPatchStitches(patch);
      if (stitchCount > 0) {
        const ok = confirmStitchMigration(
          `检测到导入的预设“${presetName}”可迁移 ${stitchCount} 条缝合（来源：快照）。\n\n是否执行自动迁移？\n\n【确定】迁移\n【取消】跳过（保持导入内容不变）`,
        );
        if (!ok) {
          if (window.toastr) window.toastr.info('[导入自动] 已取消缝合迁移');
          markImportProcessed(presetName);
          return;
        }
        const applied = applyStitchPatch(data, patch, { insertedEnabled: false });
        result = { stitchCount, applied };
      }
    } else {
      sourcePreset = findSourcePresetForOaiImport(apiInfo, presetName);
      if (!sourcePreset) {
        console.info('[PresetTransfer] 导入自动迁移：未找到缝合源预设:', presetName);
        if (window.toastr) window.toastr.info('[导入自动] 未找到可迁移的缝合源预设');
        markImportProcessed(presetName);
        return;
      }

      try {
        const sourceData = getPresetDataFromManager(apiInfo, sourcePreset);
        const sourcePatch = extractStitchPatch(sourceData);
        const stitchCount = countPatchStitches(sourcePatch);
        if (stitchCount > 0) {
          const ok = confirmStitchMigration(
            `检测到导入的预设“${presetName}”可迁移 ${stitchCount} 条缝合（来源：${sourcePreset}）。\n\n是否执行自动迁移？\n\n【确定】迁移\n【取消】跳过（保持导入内容不变）`,
          );
          if (!ok) {
            if (window.toastr) window.toastr.info('[导入自动] 已取消缝合迁移');
            markImportProcessed(presetName);
            return;
          }
        }
      } catch {
        // If we fail to pre-calc stitch count, fall back to existing behavior.
      }

      result = await applyStitchesToData(apiInfo, sourcePreset, data, {
        toastPrefix: '[导入自动] ',
        showSuccessToast: false,
        showNoOpToast: false,
        insertedEnabled: false,
      });
    }

    if (result.stitchCount === 0) {
      if (window.toastr) window.toastr.info('[导入自动] 未检测到可迁移的缝合条目');
      markImportProcessed(presetName);
      return;
    }

    // Persist a single source-of-truth snapshot for this base.
    recordStitchPatchSnapshot(presetName, data, { force: true });

    if (window.toastr) {
      window.toastr.success(
        `[导入自动] 缝合已迁移：${result.stitchCount} 条（新增 ${result.applied?.addedPrompts ?? 0}，更新 ${result.applied?.updatedPrompts ?? 0}）`,
      );
    }

    markImportProcessed(presetName);
    console.info('[PresetTransfer] 导入自动迁移完成:', {
      presetName,
      sourcePreset,
      stitchCount: result.stitchCount,
    });
  } catch (error) {
    console.error('[PresetTransfer] 导入自动迁移失败:', error);
    if (window.toastr) window.toastr.error('[导入自动] 迁移失败: ' + (error?.message ?? error));
  } finally {
    state.importInProgress.delete(presetName);
  }
}

function initPresetStitchAutomation() {
  if (state.active) return true;

  const apiInfo = getCurrentApiInfo();
  if (apiInfo) {
    refreshKnownPresets(apiInfo);
    ensurePresetManagerSavePresetWrapped(apiInfo.presetManager);
  }

  // Mark the currently loaded preset as "known" so import auto-migrate won't treat it as a new import on startup.
  try {
    const currentName = PT.API.getLoadedPresetName?.() ?? null;
    if (currentName) markSkipAutoMigrateForPresetName(String(currentName), 5000);
  } catch {
    /* ignore */
  }

  // Import/list watcher (polling, light-weight).
  state.pollTimer = setInterval(() => {
    void pollPresetList();
  }, 2000);

  // Git auto update trigger: preset change events.
  const onPresetChange = data => {
    let name = null;
    if (typeof data === 'string') name = data;
    else if (data && typeof data === 'object') name = data.name || data.presetName || data.preset;
    name = name || PT.API.getLoadedPresetName?.() || null;
    if (!name) return;
    void handlePresetChanged(String(name));
  };

  // Best-effort event hooks; environments differ.
  try {
    PT.API.eventOn?.('preset_changed', onPresetChange);
    PT.API.eventOn?.('oai_preset_changed_after', () => setTimeout(() => onPresetChange(null), 0));
    PT.API.eventOn?.('oai_preset_import_ready', payload => void handleOaiPresetImportReady(payload));
  } catch {
    /* ignore */
  }

  state.active = true;
  return true;
}

export { initPresetStitchAutomation, migrateStitches, maybeAutoUpdateFromGit, maybeAutoMigrateOnImport };
