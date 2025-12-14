import { ensureViewportCssVars, escapeHtml, getDeviceInfo, getJQuery, highlightDiff } from '../core/utils.js';
import { isEntryDifferent, shouldHighlightPositionDifference, showConfirmDialog } from '../events/compare-events.js';
import { copyEntryBetweenPresets, editEntryInPreset } from '../operations/entry-operations.js';
import { ensureNewVersionFields } from '../preset/new-version-fields.js';
import { getPresetDataFromManager, getPromptEntries } from '../preset/preset-manager.js';
import { CommonStyles } from '../styles/common-styles.js';
function showCompareModal(apiInfo) {
  const $ = getJQuery();
  ensureViewportCssVars();
  const leftPreset = $('#left-preset').val();
  const rightPreset = $('#right-preset').val();

  if (!leftPreset || !rightPreset || leftPreset === rightPreset) {
    alert('请选择两个不同的预设进行比较');
    return;
  }

  try {
    const leftData = getPresetDataFromManager(apiInfo, leftPreset);
    const rightData = getPresetDataFromManager(apiInfo, rightPreset);
    const leftEntries = getPromptEntries(leftData);
    const rightEntries = getPromptEntries(rightData);

    // 找到同名条目
    const commonEntries = [];
    leftEntries.forEach(leftEntry => {
      const rightEntry = rightEntries.find(r => r.name === leftEntry.name);
      if (rightEntry) {
        const isDifferent = isEntryDifferent(leftEntry, rightEntry);
        commonEntries.push({
          name: leftEntry.name,
          left: leftEntry,
          right: rightEntry,
          isDifferent: isDifferent,
        });
      }
    });

    if (commonEntries.length === 0) {
      alert('两个预设中没有同名条目可以比较');
      return;
    }

    createCompareModal(apiInfo, leftPreset, rightPreset, commonEntries);
  } catch (error) {
    console.error('比较失败:', error);
    alert('比较失败: ' + error.message);
  }
}

function createCompareModal(apiInfo, leftPreset, rightPreset, commonEntries) {
  const $ = getJQuery();
  const { isMobile, isSmallScreen, isPortrait } = getDeviceInfo();

  // 移除已存在的比较模态框
  $('#compare-modal').remove();

  const differentEntries = commonEntries.filter(e => e.isDifferent);
  const sameEntries = commonEntries.filter(e => !e.isDifferent);

  const modalHtml = `
        <div id="compare-modal">
            <div class="compare-modal-content">
                <button class="close-compare-btn" id="close-compare-header">×</button>
                <div class="compare-modal-scroll">
                    <div class="compare-modal-header">
                        <div class="title-row">
                            <h2>预设比较</h2>
                        </div>
                        <div class="compare-info">${leftPreset} vs ${rightPreset}</div>
                    </div>
                    <div class="compare-stats">
                        <div class="stat-item">
                            <span class="stat-number different">${differentEntries.length}</span>
                            <span class="stat-label">差异条目</span>
                        </div>
                    </div>
                    <div class="compare-content">
                        ${
                          differentEntries.length > 0
                            ? `
                        <h3>差异条目</h3>
                        <div class="compare-entries">
                            ${differentEntries
                              .map(entry => createCompareEntryHtml(entry, leftPreset, rightPreset))
                              .join('')}
                        </div>
                    `
                            : `
                        <div class="no-diff-message">
                            <div style="font-size: calc(var(--pt-font-size) * 3); margin-bottom: 15px; opacity: 0.5;">✔</div>
                            <div>两个预设之间没有发现差异。</div>
                        </div>
                    `
                        }
                    </div>
                </div>
            </div>
        </div>
    `;

  $('body').append(modalHtml);

  const $root = getJQuery()('#compare-modal');

  // Remove decorative emojis from compare action buttons.
  // 1) Edit buttons like "✏️ 编辑左侧" -> "编辑左侧"
  $root.find('.compare-action-btn.edit-btn').each(function () {
    const $btn = getJQuery()(this);
    const text = $btn
      .text()
      .trim()
      .replace(/^\S+\s+/, '');
    $btn.text(text);
  });

  // 2) Copy buttons like "覆盖左侧 ⬅️" / "➡️ 覆盖右侧" -> "覆盖左侧" / "覆盖右侧"
  $root.find('.compare-action-btn').each(function () {
    const $btn = getJQuery()(this);
    const cleaned = $btn.text().replace(/[⬅➡]/g, '').trim();
    $btn.text(cleaned);
  });
  $('#compare-modal').data({ apiInfo, leftPreset, rightPreset, commonEntries });
  applyCompareModalStyles(isMobile, isSmallScreen, isPortrait);
  bindCompareModalEvents(apiInfo, leftPreset, rightPreset, commonEntries);
}

function createCompareDetailHtml(side, presetName, entry, otherEntry) {
  const current = ensureNewVersionFields(entry);
  const other = ensureNewVersionFields(otherEntry);
  const content = current.content || '';
  const otherContent = other.content || '';
  const triggersDifferent =
    JSON.stringify([...(current.injection_trigger || [])].sort()) !==
    JSON.stringify([...(other.injection_trigger || [])].sort());

  return `
    <div class="compare-side ${side}-side">
        <h5>${presetName}</h5>
        <div class="compare-details">
            <div class="detail-row">
                <span class="label">角色:</span>
                <span class="value ${current.role !== other.role ? 'different' : ''}">${current.role || 'system'}</span>
            </div>
            <div class="detail-row">
                <span class="label">位置:</span>
                <span class="value ${
                  shouldHighlightPositionDifference(current.injection_position, other.injection_position)
                    ? 'different'
                    : ''
                }">${current.injection_position || 'relative'}</span>
            </div>
            <div class="detail-row">
                <span class="label">深度:</span>
                <span class="value ${current.injection_depth !== other.injection_depth ? 'different' : ''}">${
    current.injection_depth ?? 4
  }</span>
            </div>
            <div class="detail-row">
                <span class="label">顺序:</span>
                <span class="value ${current.injection_order !== other.injection_order ? 'different' : ''}">${
    current.injection_order
  }</span>
            </div>
            <div class="detail-row">
                <span class="label">触发:</span>
                <span class="value ${triggersDifferent ? 'different' : ''}">${
    current.injection_trigger.join(', ') || '无'
  }</span>
            </div>
            <div class="detail-row">
                <span class="label">内容:</span>
                <div class="content-preview ${content !== otherContent ? 'different' : ''}">
                    ${content !== otherContent ? highlightDiff(otherContent, content) : escapeHtml(content)}
                </div>
            </div>
        </div>
    </div>`;
}

function createCompareEntryHtml(entry, leftPreset, rightPreset) {
  return `
    <div class="compare-entry">
        <div class="compare-entry-header">
            <h4>${entry.name}</h4>
            ${
              entry.isDifferent
                ? `
                <div class="compare-actions">
                    <button class="compare-action-btn" data-action="copy-right-to-left" data-entry-name="${entry.name}">覆盖左侧 ⬅️</button>
                    <button class="compare-action-btn" data-action="copy-left-to-right" data-entry-name="${entry.name}">➡️ 覆盖右侧</button>
                    <button class="compare-action-btn edit-btn" data-action="edit-left" data-entry-name="${entry.name}">✏️ 编辑左侧</button>
                    <button class="compare-action-btn edit-btn" data-action="edit-right" data-entry-name="${entry.name}">✏️ 编辑右侧</button>
                </div>
            `
                : ''
            }
        </div>
        <div class="compare-sides">
            ${createCompareDetailHtml('left', leftPreset, entry.left, entry.right)}
            ${createCompareDetailHtml('right', rightPreset, entry.right, entry.left)}
        </div>
    </div>
  `;
}

function applyCompareModalStyles(isMobile, isSmallScreen, isPortrait) {
  const $ = getJQuery();
  const vars = CommonStyles.getVars();

  const cssLink = document.createElement('link');
  cssLink.rel = 'stylesheet';
  cssLink.href = './scripts/extensions/third-party/preset-transfer/src/styles/compare-modal.css';
  if (!document.querySelector(`link[href="${cssLink.href}"]`)) {
    document.head.appendChild(cssLink);
  }

  const styles = `
        #compare-modal {
            --pt-font-size: ${vars.fontSize};
            ${CommonStyles.getModalBaseStyles({ maxWidth: vars.maxWidthLarge })}
            align-items: ${vars.isMobile ? 'flex-start' : 'center'};
            ${vars.isMobile ? 'padding-top: 20px;' : ''}
        }
        #compare-modal .compare-modal-content {
            position: relative;
            background: ${vars.bgColor}; border-radius: ${vars.isMobile ? vars.borderRadius : '20px'};
            padding: ${vars.isSmallScreen ? vars.padding : vars.isMobile ? vars.paddingLarge : '32px'};
            max-width: ${vars.isSmallScreen ? '95vw' : vars.isMobile ? '90vw' : '900px'};
            width: ${vars.isSmallScreen ? '95vw' : vars.isMobile ? '90vw' : '90%'};
            color: ${vars.textColor};
        }
        #compare-modal .compare-modal-scroll {
            max-height: ${vars.isMobile ? '90vh' : '85vh'};
            max-height: ${vars.isMobile ? '90dvh' : '85dvh'};
            max-height: ${vars.isMobile ? 'calc(var(--pt-vh, 1vh) * 90)' : 'calc(var(--pt-vh, 1vh) * 85)'};
            overflow-y: auto;
            ${vars.isMobile ? '-webkit-overflow-scrolling: touch;' : ''}
        }
        #compare-modal .compare-modal-header {
            margin-bottom: ${vars.isMobile ? vars.padding : vars.paddingLarge};
            padding-bottom: ${vars.isMobile ? '18px' : '22px'}; border-bottom: 1px solid ${vars.borderColor};
        }
        #compare-modal .compare-modal-header .title-row {
            gap: ${vars.gap}; padding: ${vars.isMobile ? '8px 0' : '12px 0'};
        }
        #compare-modal .close-compare-btn {
            font-size: calc(${vars.fontSize} * 1.5);
            color: ${vars.tipColor};
        }
        #compare-modal .close-compare-btn:hover { color: ${vars.textColor}; }
        #compare-modal .compare-modal-header span {
            font-size: ${vars.isSmallScreen ? '1.75em' : vars.isMobile ? '2em' : '2.25em'};
        }
        #compare-modal .compare-modal-header h2 {
            font-size: ${vars.isSmallScreen ? '1.375em' : vars.isMobile ? '1.5em' : '1.75em'};
            color: ${vars.textColor};
        }
        #compare-modal .compare-info {
            font-size: ${vars.fontSizeMedium};
            color: ${vars.tipColor};
        }
        #compare-modal .compare-stats {
            gap: ${vars.isMobile ? '20px' : '30px'};
            margin-bottom: ${vars.isMobile ? vars.padding : vars.paddingLarge};
        }
        #compare-modal .stat-item {
            padding: ${vars.isMobile ? vars.paddingSmall : vars.paddingSmall};
            background: ${vars.sectionBg}; border-radius: ${vars.borderRadiusMedium};
            min-width: ${vars.isMobile ? '80px' : '100px'};
        }
        #compare-modal .stat-number {
            font-size: ${vars.isMobile ? '1.5em' : '1.75em'};
            color: ${vars.textColor};
        }
        #compare-modal .stat-label {
            font-size: ${vars.fontSizeSmall}; color: ${vars.tipColor};
        }
        #compare-modal .compare-content h3 {
            margin: ${vars.isMobile ? '24px 0 16px' : '28px 0 20px'};
            font-size: ${vars.isMobile ? vars.fontSizeLarge : '1.25em'};
            color: ${vars.textColor};
        }
        #compare-modal .compare-entry {
            border: 1px solid ${vars.borderColor}; border-radius: ${vars.borderRadiusMedium};
            margin-bottom: ${vars.isMobile ? '16px' : '20px'};
            background: ${vars.bgColor};
        }
        #compare-modal .compare-entry-header {
            background: ${vars.sectionBg}; padding: ${vars.isMobile ? '12px 16px' : '14px 20px'};
            border-bottom: 1px solid ${vars.borderColor};
            gap: ${vars.isMobile ? '8px' : vars.gap};
        }
        #compare-modal .compare-entry-header h4 {
            font-size: ${vars.isMobile ? vars.fontSize : vars.fontSizeLarge};
            color: ${vars.textColor};
        }
        #compare-modal .compare-actions {
            gap: ${vars.isMobile ? '6px' : '8px'};
            ${vars.isMobile ? 'display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;' : ''}
        }
        #compare-modal .compare-action-btn {
            padding: ${vars.isMobile ? '4px 8px' : '6px 10px'};
            border: 1px solid ${vars.inputBorder};
            background: ${vars.inputBg}; color: ${vars.textColor};
            font-size: ${vars.fontSizeSmall};
        }
        #compare-modal .compare-sides {
            display: ${vars.isMobile ? 'flex' : 'grid'};
            ${vars.isMobile ? 'flex-direction: column;' : 'grid-template-columns: 1fr 1fr;'}
        }
        #compare-modal .compare-side {
            padding: ${vars.isMobile ? vars.paddingSmall : vars.margin};
        }
        #compare-modal .compare-side.right-side {
            border-left: ${vars.isMobile ? 'none' : `1px solid ${vars.borderColor}`};
            border-top: ${vars.isMobile ? `1px solid ${vars.borderColor}` : 'none'};
        }
        #compare-modal .compare-side h5 {
            margin: 0 0 ${vars.isMobile ? '12px' : '16px'} 0;
            font-size: ${vars.isMobile ? vars.fontSizeMedium : vars.fontSize};
            color: ${vars.tipColor};
        }
        #compare-modal .detail-row {
            margin-bottom: ${vars.isMobile ? '8px' : vars.gap};
            gap: ${vars.isMobile ? '4px' : '8px'};
            ${vars.isMobile ? 'flex-direction: column; align-items: stretch;' : ''}
        }
        #compare-modal .detail-row .label {
            color: ${vars.tipColor}; font-size: ${vars.fontSizeSmall};
            min-width: ${vars.isMobile ? '40px' : '50px'};
            ${vars.isMobile ? 'margin-bottom: 2px;' : ''}
        }
        #compare-modal .detail-row .value {
            font-size: ${vars.fontSizeSmall}; color: ${vars.textColor};
        }
        #compare-modal .content-preview {
             background: ${vars.subBg}; padding: ${vars.isMobile ? '8px' : '10px'};
             font-size: ${vars.fontSizeSmall}; color: ${vars.textColor};
             ${vars.isMobile ? 'width: 100%; min-height: 40px;' : ''}
             border: 1px solid ${vars.borderColor};
             border-radius: 6px;
             box-sizing: border-box;
             white-space: pre-wrap;
             word-break: break-word;
             line-height: 1.5;
        }
        #compare-modal .same-entries {
            gap: ${vars.isMobile ? '8px' : '10px'};
        }
        #compare-modal .same-entry {
            padding: ${vars.isMobile ? '6px 12px' : '8px 16px'};
            font-size: ${vars.fontSizeSmall};
        }
        #compare-modal .compare-modal-actions {
            margin-top: ${vars.isMobile ? vars.padding : vars.paddingLarge};
            padding-top: ${vars.isMobile ? vars.margin : vars.padding};
            border-top: 1px solid ${vars.borderColor};
        }
        #compare-modal .compare-modal-actions button {
            padding: ${vars.buttonPadding};
            border-radius: ${vars.buttonRadius};
            font-size: ${vars.fontSizeMedium};
        }
    `;

  if (!$('#compare-modal-styles').length) {
    $('head').append(`<style id="compare-modal-styles">${styles}</style>`);
  }
}

function bindCompareModalEvents(apiInfo, leftPreset, rightPreset, commonEntries) {
  const $ = getJQuery();
  const modal = $('#compare-modal');

  // 重排头部结构：让标题单独一行，关闭按钮独立悬浮在右上角
  try {
    const header = modal.find('.compare-modal-header');
    const firstRow = header.children().first();
    const closeBtn = firstRow.find('.close-compare-btn').first();
    const icon = firstRow.find('span').first();
    const title = firstRow.find('h2').first();
    const info = header.find('.compare-info').first();

    if (false && firstRow.length && closeBtn.length && icon.length && title.length) {
      closeBtn.detach();
      icon.detach();
      title.detach();
      if (info.length) info.detach();

      header.empty();
      header.append(closeBtn);
      const titleRow = $('<div class="title-row"></div>');
      titleRow.append(icon, title);
      header.append(titleRow);
      if (info.length) header.append(info);
    }
  } catch {
    // 忽略头部重排失败
  }

  $('#close-compare-header').on('click', () => modal.remove());

  // 操作按钮事件
  $('.compare-action-btn').on('click', function () {
    const action = $(this).data('action');
    const entryName = $(this).data('entry-name');
    const entry = commonEntries.find(e => e.name === entryName);

    if (!entry) return;

    switch (action) {
      case 'copy-left-to-right':
        showConfirmDialog(
          `确定要用 <b>${leftPreset}</b> 的条目 "<b>${entryName}</b>" 覆盖 <b>${rightPreset}</b> 中的同名条目吗？此操作不可撤销。`,
          () => copyEntryBetweenPresets(apiInfo, leftPreset, rightPreset, entry.left, entryName),
        );
        break;
      case 'copy-right-to-left':
        showConfirmDialog(
          `确定要用 <b>${rightPreset}</b> 的条目 "<b>${entryName}</b>" 覆盖 <b>${leftPreset}</b> 中的同名条目吗？此操作不可撤销。`,
          () => copyEntryBetweenPresets(apiInfo, rightPreset, leftPreset, entry.right, entryName),
        );
        break;
      case 'edit-left':
        modal.hide(); // 隐藏而不是移除比较模态框
        editEntryInPreset(apiInfo, leftPreset, entry.left, entryName, true); // 传递来自比较界面的标记
        break;
      case 'edit-right':
        modal.hide(); // 隐藏而不是移除比较模态框
        editEntryInPreset(apiInfo, rightPreset, entry.right, entryName, true); // 传递来自比较界面的标记
        break;
    }
  });

  modal.on('click', e => e.target === modal[0] && modal.remove());

  // ESC键关闭模态框
  $(document).on('keydown.compare-modal', e => {
    if (e.key === 'Escape') {
      modal.remove();
      $(document).off('keydown.compare-modal');
    }
  });

  // 移动端处理
  if (getDeviceInfo().isMobile) {
    const originalOverflow = $('body').css('overflow');
    $('body').css('overflow', 'hidden');
    modal.on('remove', () => $('body').css('overflow', originalOverflow));
  }

  modal.css('display', 'flex');
}

function updateCompareButton() {
  const $ = getJQuery();
  const leftPreset = $('#left-preset').val();
  const rightPreset = $('#right-preset').val();
  const btn = $('#compare-entries');

  if (btn.length) {
    if (leftPreset && rightPreset && leftPreset !== rightPreset) {
      btn.prop('disabled', false).removeClass('disabled');
    } else {
      btn.prop('disabled', true).addClass('disabled');
    }
  }
}

export {
  applyCompareModalStyles,
  bindCompareModalEvents,
  createCompareDetailHtml,
  createCompareEntryHtml,
  createCompareModal,
  showCompareModal,
  updateCompareButton,
};
