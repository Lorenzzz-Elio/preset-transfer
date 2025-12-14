import { getJQuery } from '../core/utils.js';
import { previewPresetIcon } from '../ui/icons.js';
import { QuickPreview } from '../ui/quick-preview.js';

function initializeEnhancedFeatures(apiInfo) {
  console.log('初始化增强功能...');

  // 延迟初始化，确保 UI 已经完全渲染
  setTimeout(() => {
    try {
      // 添加预览按钮到预设选择区域
      addPreviewButtons(apiInfo);
      console.log('增强功能初始化完成');
    } catch (error) {
      console.error('增强功能初始化失败', error);
    }
  }, 500);
}

// 添加预览按钮
function addPreviewButtons(apiInfo) {
  const $ = getJQuery();

  // 为左侧预设添加预览按钮
  if (!$('#left-preview-btn').length) {
    const leftPreviewBtn = $(`
      <button id="left-preview-btn" class="get-current-btn" title="预览预设">
        ${previewPresetIcon()}
      </button>
    `);

    leftPreviewBtn.on('click', () => {
      const presetName = $('#left-preset').val();
      if (presetName) {
        QuickPreview.showPreviewModal(apiInfo, presetName);
      } else {
        alert('请先选择左侧预设');
      }
    });

    $('#get-current-left').after(leftPreviewBtn);
  }

  // 为右侧预设添加预览按钮
  if (!$('#right-preview-btn').length) {
    const rightPreviewBtn = $(`
      <button id="right-preview-btn" class="get-current-btn" title="预览预设">
        ${previewPresetIcon()}
      </button>
    `);

    rightPreviewBtn.on('click', () => {
      const presetName = $('#right-preset').val();
      if (presetName) {
        QuickPreview.showPreviewModal(apiInfo, presetName);
      } else {
        alert('请先选择右侧预设');
      }
    });

    $('#get-current-right').after(rightPreviewBtn);
  }
}

export { addPreviewButtons, initializeEnhancedFeatures };
