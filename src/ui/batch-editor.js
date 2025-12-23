// 2. 批量编辑功能
import { ensureViewportCssVars, getJQuery } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';

const BatchEditor = {
  // 批量修改角色
  changeRole(entries, newRole) {
    return entries.map(entry => ({ ...entry, role: newRole }));
  },

  // 批量调整注入深度
  adjustDepth(entries, newDepth) {
    return entries.map(entry => ({ ...entry, injection_depth: newDepth }));
  },

  // 批量启用/禁用
  toggleEnabled(entries, enabled) {
    return entries.map(entry => ({ ...entry, enabled }));
  },

  // 批量添加前缀
  addPrefix(entries, prefix) {
    return entries.map(entry => ({
      ...entry,
      content: `${prefix}\n${entry.content}`,
    }));
  },

  // 批量添加后缀
  addSuffix(entries, suffix) {
    return entries.map(entry => ({
      ...entry,
      content: `${entry.content}\n${suffix}`,
    }));
  },

  // 批量查找替换
  findReplace(entries, findText, replaceText, caseSensitive = false) {
    return entries.map(entry => {
      let content = entry.content;
      if (caseSensitive) {
        // 区分大小写的替换
        const regex = new RegExp(escapeRegExp(findText), 'g');
        content = content.replace(regex, replaceText);
      } else {
        // 不区分大小写的替换
        const regex = new RegExp(escapeRegExp(findText), 'gi');
        content = content.replace(regex, replaceText);
      }
      return {
        ...entry,
        content: content,
      };
    });
  },

  // 批量重命名
  batchRename(entries, pattern) {
    return entries.map((entry, index) => ({
      ...entry,
      name: pattern
        .replace('{original}', entry.name)
        .replace('{index}', (index + 1).toString())
        .replace('{role}', entry.role)
        .replace('{depth}', entry.injection_depth.toString()),
    }));
  },

  // 显示批量编辑对话框
  showBatchEditDialog(selectedEntries, onApply) {
    const $ = getJQuery();
    const vars = CommonStyles.getVars();
    ensureViewportCssVars();

    // 移除已存在的对话框
    $('#batch-edit-modal').remove();

      const modalHtml = `
      <div id="batch-edit-modal" style="--pt-font-size: ${vars.fontSize}; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; height: 100dvh; height: calc(var(--pt-vh, 1vh) * 100); background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px); z-index: 10002; display: flex; align-items: center; justify-content: center; padding: ${vars.margin}; padding-top: calc(${vars.margin} + env(safe-area-inset-top)); padding-bottom: calc(${vars.margin} + env(safe-area-inset-bottom));">
        <div style="background: ${vars.bgColor}; border-radius: ${vars.borderRadius}; padding: ${vars.padding}; max-width: 600px; width: 100%; max-height: ${vars.maxHeight}; max-height: 80dvh; max-height: calc(var(--pt-vh, 1vh) * 80); overflow-y: auto; color: ${vars.textColor}; box-shadow: 0 20px 40px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: ${vars.margin}; padding-bottom: ${vars.paddingSmall}; border-bottom: 1px solid ${vars.borderColor};">
            <h3 style="margin: 0 0 8px 0; font-size: ${vars.fontSizeLarge}; font-weight: 700;">批量编辑条目</h3>
            <p style="margin: 0; font-size: ${vars.fontSizeMedium}; color: ${vars.tipColor};">选中了 ${selectedEntries.length} 个条目</p>
          </div>

          <div style="margin-bottom: 20px;">
            <h4 style="margin: 0 0 12px 0; font-size: var(--pt-font-size); font-weight: 600;">基础属性</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
              <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: ${vars.fontSizeMedium};">角色类型</label>
                <select id="batch-role" style="width: 100%; padding: 8px 12px; background: ${vars.inputBg}; color: ${vars.textColor}; border: 1px solid ${vars.inputBorder}; border-radius: 6px; font-size: ${vars.fontSizeMedium};">
                  <option value="">不修改</option>
                  <option value="system">System</option>
                  <option value="user">User</option>
                  <option value="assistant">Assistant</option>
                </select>
              </div>
              <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: ${vars.fontSizeMedium};">注入深度</label>
                <input type="number" id="batch-depth" placeholder="不修改" min="0" max="100" style="width: 100%; padding: 8px 12px; background: ${vars.inputBg}; color: ${vars.textColor}; border: 1px solid ${vars.inputBorder}; border-radius: 6px; box-sizing: border-box; font-size: ${vars.fontSizeMedium};">
              </div>
            </div>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: ${vars.fontSizeMedium};">启用状态</label>
              <select id="batch-enabled" style="width: 100%; padding: 8px 12px; background: ${vars.inputBg}; color: ${vars.textColor}; border: 1px solid ${vars.inputBorder}; border-radius: 6px; font-size: ${vars.fontSizeMedium};">
                <option value="">不修改</option>
                <option value="true">启用</option>
                <option value="false">禁用</option>
              </select>
            </div>
          </div>

          <div style="margin-bottom: 20px;">
            <h4 style="margin: 0 0 12px 0; font-size: var(--pt-font-size); font-weight: 600;">内容编辑</h4>
            <div style="margin-bottom: 16px;">
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: ${vars.fontSizeMedium};">添加前缀</label>
              <textarea id="batch-prefix" placeholder="在所有条目内容前添加..." rows="2" style="width: 100%; padding: 8px 12px; background: ${vars.inputBg}; color: ${vars.textColor}; border: 1px solid ${vars.inputBorder}; border-radius: 6px; resize: vertical; box-sizing: border-box; font-size: ${vars.fontSizeMedium};"></textarea>
            </div>
            <div style="margin-bottom: 16px;">
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: ${vars.fontSizeMedium};">添加后缀</label>
              <textarea id="batch-suffix" placeholder="在所有条目内容后添加..." rows="2" style="width: 100%; padding: 8px 12px; background: ${vars.inputBg}; color: ${vars.textColor}; border: 1px solid ${vars.inputBorder}; border-radius: 6px; resize: vertical; box-sizing: border-box; font-size: ${vars.fontSizeMedium};"></textarea>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: ${vars.fontSizeMedium};">查找文本</label>
                <input type="text" id="batch-find" placeholder="要替换的文本" style="width: 100%; padding: 8px 12px; background: ${vars.inputBg}; color: ${vars.textColor}; border: 1px solid ${vars.inputBorder}; border-radius: 6px; box-sizing: border-box; font-size: ${vars.fontSizeMedium};">
              </div>
              <div>
                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: ${vars.fontSizeMedium};">替换为</label>
                <input type="text" id="batch-replace" placeholder="替换后的文本" style="width: 100%; padding: 8px 12px; background: ${vars.inputBg}; color: ${vars.textColor}; border: 1px solid ${vars.inputBorder}; border-radius: 6px; box-sizing: border-box; font-size: ${vars.fontSizeMedium};">
              </div>
            </div>
            <div style="margin-top: 8px;">
              <label style="display: flex; align-items: center; gap: 8px; font-size: ${vars.fontSizeMedium};">
                <input type="checkbox" id="batch-case-sensitive">
                区分大小写
              </label>
            </div>
          </div>

          <div style="margin-bottom: 20px;">
            <h4 style="margin: 0 0 12px 0; font-size: var(--pt-font-size); font-weight: 600;">批量重命名</h4>
            <div>
              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: ${vars.fontSizeMedium};">重命名模式</label>
              <input type="text" id="batch-rename-pattern" placeholder="例如: {original}_修改版 或 条目{index}" style="width: 100%; padding: 8px 12px; background: ${vars.inputBg}; color: ${vars.textColor}; border: 1px solid ${vars.inputBorder}; border-radius: 6px; box-sizing: border-box; font-size: ${vars.fontSizeMedium};">
              <div style="margin-top: 4px; font-size: ${vars.fontSizeSmall}; color: ${vars.tipColor};">
                可用变量: {original}=原名称, {index}=序号, {role}=角色, {depth}=深度
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 12px; justify-content: center;">
            <button id="apply-batch-edit" style="padding: calc(var(--pt-font-size) * 0.75) calc(var(--pt-font-size) * 1.5); background: ${vars.sectionBg}; color: ${vars.textColor}; border: 1px solid ${vars.borderColor}; border-radius: 8px; font-size: ${vars.fontSizeMedium}; font-weight: 600; cursor: pointer;">应用</button>
            <button id="cancel-batch-edit" style="padding: calc(var(--pt-font-size) * 0.75) calc(var(--pt-font-size) * 1.5); background: ${vars.sectionBg}; color: ${vars.textColor}; border: 1px solid ${vars.borderColor}; border-radius: 8px; font-size: ${vars.fontSizeMedium}; font-weight: 600; cursor: pointer;">❌ 取消</button>
          </div>
        </div>
      </div>
      `;

      $('body').append(modalHtml);
      // Normalize cancel button and headings (remove decorative emojis)
      $('#cancel-batch-edit').text('取消');

    // 绑定事件
    $('#apply-batch-edit').on('click', () => {
      const modifications = {
        role: $('#batch-role').val(),
        depth: $('#batch-depth').val() ? parseInt($('#batch-depth').val()) : null,
        enabled: $('#batch-enabled').val() ? $('#batch-enabled').val() === 'true' : null,
        prefix: $('#batch-prefix').val().trim(),
        suffix: $('#batch-suffix').val().trim(),
        findText: $('#batch-find').val(),
        replaceText: $('#batch-replace').val(),
        caseSensitive: $('#batch-case-sensitive').is(':checked'),
        renamePattern: $('#batch-rename-pattern').val().trim(),
      };

      // 应用修改但不关闭对话框，让用户可以继续修改
      onApply(modifications);

      // 显示成功提示
      if (window.toastr) {
        toastr.success('批量修改已应用');
      } else {
        alert('批量修改已应用');
      }
    });

    $('#cancel-batch-edit').on('click', () => {
      $('#batch-edit-modal').remove();
    });

    // 点击背景关闭
    $('#batch-edit-modal').on('click', function (e) {
      if (e.target === this) {
        $(this).remove();
      }
    });
  },

  // 应用批量修改
  applyBatchModifications(entries, modifications) {
    let result = [...entries];

    // 应用角色修改
    if (modifications.role) {
      result = this.changeRole(result, modifications.role);
    }

    // 应用深度修改
    if (modifications.depth !== null) {
      result = this.adjustDepth(result, modifications.depth);
    }

    // 应用启用状态修改
    if (modifications.enabled !== null) {
      result = this.toggleEnabled(result, modifications.enabled);
    }

    // 应用前缀
    if (modifications.prefix) {
      result = this.addPrefix(result, modifications.prefix);
    }

    // 应用后缀
    if (modifications.suffix) {
      result = this.addSuffix(result, modifications.suffix);
    }

    // 应用查找替换
    if (modifications.findText && modifications.replaceText !== undefined) {
      result = this.findReplace(result, modifications.findText, modifications.replaceText, modifications.caseSensitive);
    }

    // 应用重命名
    if (modifications.renamePattern) {
      result = this.batchRename(result, modifications.renamePattern);
    }

    return result;
  },
};

// SmartPresetImporter模块已删除


export {
  BatchEditor
};
