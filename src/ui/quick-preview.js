// 4. 快速预览和测试功能
import { ensureViewportCssVars, getJQuery } from '../core/utils.js';
import { getOrderedPromptEntries, getPresetDataFromManager } from '../preset/preset-manager.js';
import { CommonStyles } from '../styles/common-styles.js';

const QuickPreview = {
  // HTML转义函数，防止XSS
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },
  // 生成预设预览（显示原始HTML标签）
  generatePreview(entries, maxEntries = 5) {
    // entries 参数已经是过滤后的启用条目，不需要再次过滤
    const previewEntries = entries.slice(0, maxEntries);

    return previewEntries
      .map(entry => {
        const content = entry.content || '';
        // 保持原始HTML标签，但进行安全转义
        const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
        const safeName = this.escapeHtml(entry.name || '未命名');
        const safePreview = this.escapeHtml(preview);
        return `${safeName}\n${safePreview}`;
      })
      .join('\n\n' + '─'.repeat(50) + '\n\n');
  },

  // 创建虚拟滚动的条目列表
  createVirtualScrollPreview(entries) {
    return {
      entries: entries,
      itemHeight: 120, // 每个条目的估计高度
      containerHeight: 400, // 容器高度
      visibleCount: Math.ceil(400 / 120), // 可见条目数量
      renderBuffer: 5, // 渲染缓冲区
    };
  },

  // 渲染可见范围内的条目
  renderVisibleEntries(virtualData, scrollTop, isDark = false) {
    const vars = CommonStyles.getVars();
    const { entries, itemHeight, visibleCount, renderBuffer } = virtualData;
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - renderBuffer);
    const endIndex = Math.min(entries.length, startIndex + visibleCount + renderBuffer * 2);

    const visibleEntries = entries.slice(startIndex, endIndex);
    const offsetTop = startIndex * itemHeight;

    return {
      html: visibleEntries
        .map((entry, index) => {
          const actualIndex = startIndex + index;
          const content = entry.content || '';
          const preview = content.length > 300 ? content.substring(0, 300) + '...' : content;

          // HTML转义防止XSS
          const safeName = this.escapeHtml(entry.name || '未命名');
          const safePreview = this.escapeHtml(preview);

          return `
          <div class="virtual-entry-item" style="
            position: absolute;
            top: ${actualIndex * itemHeight}px;
            left: 0;
            right: 0;
            height: ${itemHeight - 10}px;
            padding: 8px;
            border-bottom: 1px solid ${vars.borderColor};
            background: ${vars.subBg};
          ">
            <div style="font-weight: 600; margin-bottom: 4px; color: ${vars.textColor}; font-size: ${
            vars.fontSizeMedium
          };">
              ${safeName}
              <span style="font-size: ${vars.fontSizeSmall}; color: ${vars.tipColor};">(${
            entry.injection_position || 'relative'
          }:${entry.injection_depth ?? 4})</span>
            </div>
            <div style="font-size: ${vars.fontSizeSmall}; color: ${
            vars.tipColor
          }; font-family: 'Courier New', monospace; white-space: pre-wrap; overflow: hidden; max-height: 80px;">${safePreview}</div>
          </div>
        `;
        })
        .join(''),
      totalHeight: entries.length * itemHeight,
      offsetTop,
    };
  },

  // Token估算
  estimateTokens(content) {
    const chineseChars = (content.match(/[\u4e00-\u9fff]/g) || []).length;
    const otherChars = content.length - chineseChars;
    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  },

  // 预设效果预览
  previewPresetEffect(presetData) {
    // 使用 getOrderedPromptEntries 获取已启用的条目
    const entries = getOrderedPromptEntries(presetData, 'default');
    const totalTokens = entries.reduce((sum, entry) => sum + this.estimateTokens(entry.content || ''), 0);

    return {
      totalEntries: entries.length,
      totalTokens,
      preview: this.generatePreview(entries),
      warnings: this.checkBasicWarnings(entries),
    };
  },

  // 基础警告检查
  checkBasicWarnings(entries) {
    const warnings = [];

    // 检查空条目
    const emptyEntries = entries.filter(e => !e.content || !e.content.trim());
    if (emptyEntries.length > 0) {
      warnings.push(`发现 ${emptyEntries.length} 个空条目`);
    }

    // 检查重名条目
    const names = entries.map(e => e.name).filter(Boolean);
    const duplicateNames = names.filter((name, index) => names.indexOf(name) !== index);
    if (duplicateNames.length > 0) {
      warnings.push(`发现重名条目: ${[...new Set(duplicateNames)].join(', ')}`);
    }

    return warnings;
  },

  // 显示预览界面
  showPreviewModal(apiInfo, presetName) {
    const $ = getJQuery();
    const vars = CommonStyles.getVars();
    ensureViewportCssVars();

    try {
      const presetData = getPresetDataFromManager(apiInfo, presetName);
      const preview = this.previewPresetEffect(presetData);

      // 移除已存在的预览
      $('#preview-modal').remove();

      const modalHtml = `
        <div id="preview-modal" style="--pt-font-size: ${
          vars.fontSize
        }; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; height: 100dvh; height: calc(var(--pt-vh, 1vh) * 100); background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px); z-index: 10004; display: flex; align-items: center; justify-content: center; padding: ${
        vars.margin
      }; padding-top: calc(${vars.margin} + env(safe-area-inset-top)); padding-bottom: calc(${vars.margin} + env(safe-area-inset-bottom));">
          <div style="background: ${vars.bgColor}; border-radius: ${vars.borderRadius}; padding: ${
        vars.padding
      }; max-width: 800px; width: 100%; max-height: ${vars.maxHeight}; max-height: 80dvh; max-height: calc(var(--pt-vh, 1vh) * 80); overflow-y: auto; color: ${
        vars.textColor
      }; box-shadow: 0 20px 40px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: ${vars.margin}; padding-bottom: ${
        vars.paddingSmall
      }; border-bottom: 1px solid ${vars.borderColor};">
              <h3 style="margin: 0 0 8px 0; font-size: ${
                vars.fontSizeLarge
              }; font-weight: 700;">预设预览 - ${this.escapeHtml(presetName)}</h3>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: ${
              vars.paddingSmall
            }; margin-bottom: ${vars.margin};">
              <div style="padding: ${vars.paddingSmall}; background: ${vars.sectionBg}; border-radius: ${
        vars.borderRadiusSmall
      }; text-align: center;">
                <div style="font-size: calc(var(--pt-font-size) * 1.5); font-weight: 700; color: ${vars.textColor};">${
                  preview.totalEntries
                }</div>
                <div style="font-size: calc(var(--pt-font-size) * 0.875); color: ${vars.tipColor};">启用条目数</div>
              </div>
              <div style="padding: 16px; background: ${vars.sectionBg}; border-radius: 8px; text-align: center;">
                <div style="font-size: calc(var(--pt-font-size) * 1.5); font-weight: 700; color: ${vars.textColor};">${
                  preview.totalTokens
                }</div>
                <div style="font-size: ${vars.fontSizeMedium}; color: ${vars.tipColor};">预估Token</div>
              </div>
            </div>

            ${
              preview.warnings.length > 0
                ? `
              <div style="margin-bottom: 20px; padding: 16px; background: ${vars.sectionBg}; border: 1px solid ${vars.borderColor}; border-radius: 8px;">
                <h4 style="margin: 0 0 12px 0; font-size: var(--pt-font-size); font-weight: 600; color: ${vars.textColor};">注意事项</h4>
                ${preview.warnings
                  .map(warning => `<div style="color: ${vars.textColor}; margin-bottom: 4px;">• ${this.escapeHtml(warning)}</div>`)
                  .join('')}
              </div>
            `
                : ''
            }

            <div style="margin-bottom: 20px;">
              <h4 style="margin: 0 0 12px 0; font-size: var(--pt-font-size); font-weight: 600;">所有条目预览</h4>
              <div id="virtual-scroll-container" style="
                background: ${vars.sectionBg};
                border: 1px solid ${vars.borderColor};
                border-radius: 8px;
                height: 400px;
                overflow-y: auto;
                position: relative;
              ">
                <div id="virtual-scroll-content" style="position: relative;"></div>
              </div>
            </div>

            <div style="display: flex; gap: ${vars.gap}; justify-content: center;">
              <button id="close-preview" style="padding: ${
                vars.buttonPadding
              }; background: ${vars.accentMutedColor}; color: ${vars.textColor}; border: none; border-radius: ${vars.buttonRadius}; font-size: ${
        vars.fontSizeMedium
      }; font-weight: 600; cursor: pointer;">关闭</button>
            </div>
          </div>
        </div>
      `;

      $('body').append(modalHtml);

      // 初始化虚拟滚动
      const entries = getOrderedPromptEntries(presetData, 'default');
      const virtualData = this.createVirtualScrollPreview(entries);
      const $container = $('#virtual-scroll-container');
      const $content = $('#virtual-scroll-content');

      // 设置内容总高度
      $content.css('height', virtualData.totalHeight + 'px');

      // 初始渲染
      const initialRender = this.renderVisibleEntries(virtualData, 0, false);
      $content.html(initialRender.html);

      // 滚动事件处理（添加节流）
      let scrollTimeout = null;
      let lastStartIndex = -1;

      $container.on('scroll', () => {
        if (scrollTimeout) clearTimeout(scrollTimeout);

        scrollTimeout = setTimeout(() => {
          const scrollTop = $container.scrollTop();
          const newStartIndex = Math.max(0, Math.floor(scrollTop / virtualData.itemHeight) - virtualData.renderBuffer);

          // 只有当起始索引变化时才重新渲染
          if (newStartIndex !== lastStartIndex) {
            const renderResult = this.renderVisibleEntries(virtualData, scrollTop, false);
            $content.html(renderResult.html);
            lastStartIndex = newStartIndex;
          }
        }, 16); // 约60fps的节流
      });

      $('#close-preview').on('click', () => {
        $('#preview-modal').remove();
      });

      // 点击背景关闭
      $('#preview-modal').on('click', function (e) {
        if (e.target === this) {
          $(this).remove();
        }
      });
    } catch (error) {
      console.error('预览失败:', error);
      alert('预览失败: ' + error.message);
    }
  },
};

// BatchCopy模块已完全移除


export {
  QuickPreview
};
