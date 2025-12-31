import { PT } from '../core/api-compat.js';
import { getCurrentApiInfo, getParentWindow } from '../core/utils.js';
import { extractPresetVersionInfo } from '../core/preset-name-utils.js';
import { getPresetDataFromManager, switchToPreset } from '../preset/preset-manager.js';
import { applyStitchPatch, extractStitchPatch } from '../preset/stitch-patch.js';
import { normalizeVersion } from './preset-git-sync.js';
import { getPresetGitSource, setPresetGitSource } from './preset-stitch-settings.js';
import { fetchPresetJsonFromGitHub } from './preset-git-sync.js';

const SKIP_AUTO_MIGRATE_KEY = '__ptPresetTransferSkipAutoMigrateUntilByPresetName';
const SKIP_AUTO_MIGRATE_DEFAULT_TTL_MS = 60 * 1000;

function markSkipAutoMigrateForPresetName(presetName, ttlMs = SKIP_AUTO_MIGRATE_DEFAULT_TTL_MS) {
  const name = String(presetName ?? '').trim();
  if (!name) return false;
  const pw = typeof getParentWindow === 'function' ? getParentWindow() : window;
  const store = pw?.[SKIP_AUTO_MIGRATE_KEY];
  const map = store && typeof store === 'object' ? store : (pw[SKIP_AUTO_MIGRATE_KEY] = {});
  const ttl = Math.max(1000, Number(ttlMs) || SKIP_AUTO_MIGRATE_DEFAULT_TTL_MS);
  map[name] = Date.now() + ttl;
  return true;
}

function countPatchStitches(patch) {
  if (!patch || typeof patch !== 'object') return 0;
  const runs = Array.isArray(patch.runs) ? patch.runs : [];
  const uninserted = Array.isArray(patch.uninserted) ? patch.uninserted : [];
  const inRuns = runs.reduce((acc, run) => acc + (Array.isArray(run?.stitches) ? run.stitches.length : 0), 0);
  return inRuns + uninserted.length;
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

async function switchPresetToVersion(targetVersion, options = {}) {
  const { allowGitFetch = true } = options;

  const version = normalizeVersion(targetVersion);
  if (!version) {
    throw new Error('请输入目标版本号');
  }

  const apiInfo = getCurrentApiInfo();
  if (!apiInfo) throw new Error('无法获取 API 信息');

  const sourcePresetName = PT.API.getLoadedPresetName?.() ?? null;
  if (!sourcePresetName) throw new Error('请先在酒馆中选择一个当前预设');

  const sourceInfo = extractPresetVersionInfo(sourcePresetName);
  if (!sourceInfo?.normalizedBase) throw new Error('无法解析当前预设版本信息');

  const sourceGitSource = getPresetGitSource(sourceInfo.normalizedBase);

  let targetPresetName = findLocalPresetByBaseAndVersion(apiInfo, sourceInfo.normalizedBase, version);

  if (!targetPresetName && allowGitFetch) {
    if (sourceGitSource) {
      const { json } = await fetchPresetJsonFromGitHub(sourceGitSource, { version });
      const base = sourceInfo.base || sourceInfo.raw || String(sourcePresetName);
      targetPresetName = `${base} v${version}`;
      markSkipAutoMigrateForPresetName(targetPresetName);
      const data = json && typeof json === 'object' ? json : {};
      data.name = targetPresetName;
      await apiInfo.presetManager.savePreset(targetPresetName, data);
    }
  }

  if (!targetPresetName) {
    throw new Error('未找到目标版本（本地不存在，且未配置/未启用 Git 源）');
  }

  // If the target preset name parses to a different base key, inherit Git source settings
  // so users don't need to re-enter repo/path on every version switch.
  try {
    const targetInfo = extractPresetVersionInfo(targetPresetName);
    const targetBase = String(targetInfo?.normalizedBase ?? '').trim();
    const sourceBase = String(sourceInfo.normalizedBase ?? '').trim();
    if (targetBase && sourceBase && targetBase !== sourceBase && sourceGitSource && !getPresetGitSource(targetBase)) {
      setPresetGitSource(targetBase, sourceGitSource);
    }
  } catch {
    /* ignore */
  }

  // Optionally apply stitches from current preset to target version, then switch.
  const sourceData = getPresetDataFromManager(apiInfo, sourcePresetName);
  const targetData = getPresetDataFromManager(apiInfo, targetPresetName);

  const patch = extractStitchPatch(sourceData);
  const stitchCount = countPatchStitches(patch);

  if (stitchCount > 0) {
    const confirmed =
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(
            `检测到当前预设包含 ${stitchCount} 条缝合条目。\n\n是否将这些缝合迁移到目标版本 v${version}？\n\n【确定】迁移并切换\n【取消】跳过迁移，直接切换`,
          )
        : true;

    if (confirmed) {
      const applied = applyStitchPatch(targetData, patch);
      await apiInfo.presetManager.savePreset(targetPresetName, targetData);
      if (window.toastr) {
        window.toastr.success(
          `已切换到 v${version}（缝合 ${stitchCount} 条：新增 ${applied.addedPrompts}，更新 ${applied.updatedPrompts}）`,
        );
      }
    } else if (window.toastr) {
      window.toastr.info(`已切换到 v${version}（已跳过缝合迁移 ${stitchCount} 条）`);
    }
  } else if (window.toastr) {
    window.toastr.info(`已切换到 v${version}（当前预设没有可迁移的缝合）`);
  }

  await switchToPreset(apiInfo, targetPresetName);
  return { sourcePresetName, targetPresetName, stitchCount };
}

export { switchPresetToVersion };
