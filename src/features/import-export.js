// ==================== 预设+正则包导入导出功能 ====================

import { PT } from '../core/api-compat.js';
import { ensureViewportCssVars, getCurrentApiInfo, getJQuery, getSillyTavernContext } from '../core/utils.js';
import { getPresetRegexBindings, getAllAvailableRegexes } from './regex-binding.js';
import { getPresetDataFromManager } from '../preset/preset-manager.js';
import { CommonStyles } from '../styles/common-styles.js';

// 导出预设+正则包
async function exportPresetBundle(presetName) {
  try {
    // 获取完整的预设数据（包括 prompt_order）
    const apiInfo = getCurrentApiInfo();
    if (!apiInfo || !apiInfo.presetManager) {
      throw new Error('无法获取预设管理器');
    }

    // 使用 getPresetDataFromManager 获取完整预设数据
    const preset = getPresetDataFromManager(apiInfo, presetName);
    if (!preset) {
      throw new Error(`预设 "${presetName}" 不存在`);
    }

    // 获取正则绑定配置
    const bindings = getPresetRegexBindings(presetName);

    // 获取所有绑定的正则
    const allRegexes = getAllAvailableRegexes();
    const boundIds = Array.isArray(bindings.exclusive) ? bindings.exclusive.map(String) : [];
    const boundRegexes = allRegexes.filter(regex => boundIds.includes(String(regex.id)));

    // 构建导出数据
    const bundleData = {
      type: 'preset_with_regex_bundle',
      version: '2.0',
      metadata: {
        exportTime: new Date().toISOString(),
        presetName: presetName,
        regexCount: boundRegexes.length,
      },
      preset: preset,
      regexes: boundRegexes,
      bindings: {
        version: 2,
        bound: Array.isArray(bindings.bound) ? bindings.bound : [],
        // keep legacy ids for compatibility with old tools
        exclusive: boundIds,
      },
    };

    // 生成文件名和下载
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    const fileName = `preset-bundle-${presetName}-${timestamp}.json`;
    const fileData = JSON.stringify(bundleData, null, 2);

    // 使用现有的下载函数
    if (typeof download === 'function') {
      download(fileData, fileName, 'application/json');
    } else {
      // 备用下载方法
      const blob = new Blob([fileData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    if (window.toastr) {
      toastr.success(`预设包已导出: ${fileName}`);
    }
  } catch (error) {
    console.error('导出预设包失败:', error);
    throw error;
  }
}

// 导入预设+正则包
async function importPresetBundle(file) {
  try {
    // 读取文件内容
    const fileText = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });

    // 解析 JSON
    const bundleData = JSON.parse(fileText);

    // 验证文件格式
    if (bundleData.type !== 'preset_with_regex_bundle') {
      throw new Error('不是有效的预设包文件');
    }

    if (!bundleData.preset || !bundleData.regexes || !bundleData.bindings) {
      throw new Error('预设包文件格式不完整');
    }

    // 检测冲突并处理
    await handleImportConflicts(bundleData);
  } catch (error) {
    console.error('导入预设包失败:', error);
    throw error;
  }
}

// 处理导入冲突
async function handleImportConflicts(bundleData) {
  const $ = getJQuery();
  const vars = CommonStyles.getVars();

  // 检测预设名冲突（预设没有 name 属性，使用 metadata 中的名称）
  const presetName = bundleData.metadata.presetName;
  const existingPreset = PT.API.getPreset(presetName);

  // 检测正则名冲突
  const allRegexes = getAllAvailableRegexes();
  const conflictingRegexes = bundleData.regexes.filter(importRegex =>
    allRegexes.some(existing => existing.scriptName === importRegex.scriptName),
  );

  // 如果没有冲突，直接导入
  if (!existingPreset && conflictingRegexes.length === 0) {
    await executeImport(bundleData, 'none', '');
    return;
  }

  // 显示冲突处理对话框
  await showConflictResolutionDialog(bundleData, existingPreset, conflictingRegexes);
}

// 显示冲突处理对话框
async function showConflictResolutionDialog(bundleData, existingPreset, conflictingRegexes) {
  const $ = getJQuery();
  const vars = CommonStyles.getVars();
  ensureViewportCssVars();

  return new Promise(resolve => {
    const presetName = bundleData.metadata.presetName;

    const dialogHtml = `
      <div id="conflict-resolution-dialog" style="--pt-font-size: ${
        vars.fontSize
      }; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; height: 100dvh; height: calc(var(--pt-vh, 1vh) * 100); background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px); z-index: 10003; display: flex; align-items: center; justify-content: center; padding: 20px; padding-top: calc(20px + env(safe-area-inset-top)); padding-bottom: calc(20px + env(safe-area-inset-bottom));">
        <div style="background: ${
          vars.bgColor
        }; border-radius: 16px; padding: 24px; max-width: 500px; width: 100%; color: ${
      vars.textColor
    }; box-shadow: 0 20px 40px rgba(0,0,0,0.1); max-height: 80vh; max-height: 80dvh; max-height: calc(var(--pt-vh, 1vh) * 80); overflow-y: auto;">
          <div style="text-align: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid ${
            vars.borderColor
          };">
            <h3 style="margin: 0 0 8px 0; font-size: calc(var(--pt-font-size) * 1.25); font-weight: 700;">⚠️ 检测到冲突</h3>
            <p style="margin: 0; font-size: ${vars.fontSizeMedium}; color: ${
      vars.tipColor
    };">导入的预设包与现有内容存在冲突</p>
          </div>

          <div style="margin-bottom: 20px;">
            ${
              existingPreset
                ? `
              <div style="margin-bottom: 16px; padding: 12px; background: ${vars.sectionBg}; border-radius: 8px;">
                <strong>预设冲突：</strong> "${presetName}" 已存在
              </div>
            `
                : ''
            }

            ${
              conflictingRegexes.length > 0
                ? `
              <div style="margin-bottom: 16px; padding: 12px; background: ${vars.sectionBg}; border-radius: 8px;">
                <strong>正则冲突：</strong> ${conflictingRegexes.length} 个正则表达式名称已存在
                <div style="margin-top: 8px; font-size: ${vars.fontSizeSmall}; color: ${vars.tipColor};">
                  ${conflictingRegexes
                    .slice(0, 3)
                    .map(r => r.scriptName)
                    .join(', ')}${conflictingRegexes.length > 3 ? '...' : ''}
                </div>
              </div>
            `
                : ''
            }
          </div>

          <div style="margin-bottom: 20px;">
            <label style="display: block; margin-bottom: 8px; font-weight: 600; font-size: ${
              vars.fontSizeMedium
            };">处理方式：</label>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="radio" name="conflict-action" value="overwrite" style="margin: 0;">
                <span>覆盖现有项目</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="radio" name="conflict-action" value="rename" checked style="margin: 0;">
                <span>重命名导入项目（添加前缀）</span>
              </label>
            </div>

            <div id="rename-prefix-section" style="margin-top: 12px;">
              <label style="display: block; margin-bottom: 4px; font-size: ${vars.fontSizeSmall};">重命名前缀：</label>
              <input type="text" id="rename-prefix" value="导入_" style="width: 100%; padding: 8px; border: 1px solid ${
                vars.inputBorder
              }; border-radius: 6px; background: ${vars.inputBg}; color: ${vars.textColor}; font-size: ${
      vars.fontSizeMedium
    };">
            </div>
          </div>

          <div style="display: flex; gap: 12px; justify-content: center;">
            <button id="confirm-import" style="background: #059669; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: ${
              vars.fontSizeMedium
            };">确认导入</button>
            <button id="cancel-import" style="background: #9ca3af; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: ${
              vars.fontSizeMedium
            };">取消</button>
          </div>
        </div>
      </div>
    `;

    $('body').append(dialogHtml);

    // 控制前缀输入框显示
    $('input[name="conflict-action"]').on('change', function () {
      const showPrefix = $(this).val() === 'rename';
      $('#rename-prefix-section').toggle(showPrefix);
    });

    // 确认导入
    $('#confirm-import').on('click', async function () {
      const action = $('input[name="conflict-action"]:checked').val();
      const prefix = $('#rename-prefix').val() || '';

      $('#conflict-resolution-dialog').remove();

      try {
        await executeImport(bundleData, action, prefix);
        resolve();
      } catch (e) {
        console.error('执行导入失败:', e);
        if (window.toastr) toastr.error('导入失败: ' + e.message);
        resolve();
      }
    });

    // 取消导入
    $('#cancel-import').on('click', function () {
      $('#conflict-resolution-dialog').remove();
      resolve();
    });

    // 点击背景关闭
    $('#conflict-resolution-dialog').on('click', function (e) {
      if (e.target === this) {
        $(this).remove();
        resolve();
      }
    });
  });
}

// 执行导入操作
async function executeImport(bundleData, action, prefix) {
  try {
    const $ = getJQuery();
    let presetName = bundleData.metadata.presetName;

    // 处理预设名称
    if (action === 'rename' && prefix) {
      presetName = prefix + presetName;
    }

    // 导入正则表达式
    const importedRegexIds = [];

    for (const regex of bundleData.regexes) {
      // 正则名称字段是 script_name，不是 scriptName
      const originalName = regex.script_name;
      let regexName = regex.script_name;

      // 处理正则名称
      if (action === 'rename' && prefix) {
        regexName = prefix + regexName;
        regex.script_name = regexName; // 更新 script_name
        regex.scriptName = regexName; // 同时更新 scriptName（兼容性）
      }

      // 生成新的 ID（避免 ID 冲突）
      const newId = generateUUID();
      const oldId = regex.id;
      regex.id = newId;
      importedRegexIds.push({ oldId, newId });

      // 使用 PT.API 更新正则列表
      await PT.API.updateTavernRegexesWith(regexes => {
        // 如果是覆盖模式，先删除同名正则
        if (action === 'overwrite') {
          const existingIndex = regexes.findIndex(r => r.scriptName === regexName || r.script_name === regexName);
          if (existingIndex !== -1) {
            regexes.splice(existingIndex, 1);
          }
        }

        regexes.push(regex);
        return regexes;
      });
    }

    // 更新绑定配置中的正则 ID
    const updatedBindings = JSON.parse(JSON.stringify(bundleData.bindings || {}));
    const mapId = oldId => {
      const mapping = importedRegexIds.find(m => m.oldId === oldId);
      return mapping ? mapping.newId : oldId;
    };
    if (Array.isArray(updatedBindings.exclusive)) {
      updatedBindings.exclusive = updatedBindings.exclusive.map(mapId);
    }
    if (Array.isArray(updatedBindings.bound)) {
      updatedBindings.bound = updatedBindings.bound
        .filter(item => item && typeof item === 'object' && item.id != null)
        .map(item => ({ ...item, id: mapId(item.id) }));
      // Ensure legacy list exists for consumers that still read `exclusive`.
      if (!Array.isArray(updatedBindings.exclusive)) {
        updatedBindings.exclusive = updatedBindings.bound.map(x => x.id);
      }
    }

    // 导入预设 - 使用 apiInfo.presetManager.savePreset 创建新预设
    const apiInfo = getCurrentApiInfo();
    if (apiInfo && apiInfo.presetManager) {
      await apiInfo.presetManager.savePreset(presetName, bundleData.preset);
    } else {
      throw new Error('无法获取预设管理器');
    }

    // 等待预设保存完成后再保存正则绑定配置
    setTimeout(async () => {
      try {
        await savePresetRegexBindings(presetName, updatedBindings);
      } catch (bindingError) {}
    }, 500);

    // 保存设置（使用 SillyTavern 原生 context）
    try {
      const context = getSillyTavernContext();
      context?.saveSettingsDebounced?.();
    } catch {
      /* ignore */
    }

    if (window.toastr) {
      toastr.success(`预设包导入成功！预设: ${presetName}，正则: ${bundleData.regexes.length} 个`);
    }
  } catch (error) {
    console.error('执行导入失败:', error);
    throw error;
  }
}

// 使用现有的 generateUUID 函数


export {
  exportPresetBundle,
  importPresetBundle,
  handleImportConflicts,
  showConflictResolutionDialog,
  executeImport
};
