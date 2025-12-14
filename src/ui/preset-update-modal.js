import { debounce, ensureViewportCssVars, escapeHtml, getDeviceInfo, getJQuery } from '../core/utils.js';
import { getPresetUpdatePlan, performPresetUpdateMerge } from '../operations/preset-update.js';
import { loadAndDisplayEntries } from '../display/entry-display.js';
import { CommonStyles } from '../styles/common-styles.js';
import { showConfirmDialog } from '../events/compare-events.js';

function showPresetUpdateModal(apiInfo, sourcePreset, targetPreset) {
  const $ = getJQuery();
  ensureViewportCssVars();

  if (!sourcePreset || !targetPreset || sourcePreset === targetPreset) {
    alert('请选择两个不同的预设。');
    return;
  }

  $('#preset-update-modal').remove();

  const vars = CommonStyles.getVars();

  const preserveEnabledDefault =
    localStorage.getItem('preset-transfer-pu-preserve-enabled') === null
      ? true
      : localStorage.getItem('preset-transfer-pu-preserve-enabled') !== 'false';

  const modalHtml = `
    <div id="preset-update-modal" style="--pt-font-size:${vars.fontSize};">
      <div class="preset-update-modal-content">
        <button class="close-preset-update-btn" id="close-preset-update-header" type="button">×</button>
        <div class="preset-update-header">
          <div class="title-row">
            <h2>预设更新</h2>
          </div>
          <div class="preset-update-info">
            <div><span class="label">旧版/来源：</span><span class="value">${escapeHtml(sourcePreset)}</span></div>
            <div><span class="label">新版/目标：</span><span class="value">${escapeHtml(targetPreset)}</span></div>
          </div>
          <div class="preset-update-options">
            <label class="pu-option">
              <input type="checkbox" id="pu-preserve-enabled" ${preserveEnabledDefault ? 'checked' : ''}>
              <span>保留旧版启用状态</span>
            </label>
          </div>
          <div class="preset-update-toolbar">
            <div class="pu-search">
              <input type="text" id="pu-search" placeholder="搜索缺失条目（名称/内容）...">
              <span class="pu-search-hint" id="pu-search-hint"></span>
            </div>
            <div class="pu-toolbar-actions">
              <button type="button" class="pu-btn" id="pu-select-all">全选</button>
              <button type="button" class="pu-btn" id="pu-select-none">不选</button>
              <button type="button" class="pu-btn" id="pu-refresh">重新计算</button>
            </div>
          </div>
          <div class="preset-update-summary" id="pu-summary"></div>
        </div>
        <div class="preset-update-body" id="pu-body">
          <div class="pu-loading">正在计算差异...</div>
        </div>
        <div class="preset-update-footer">
          <button type="button" class="pu-btn" id="pu-execute" disabled>转移选中条目</button>
          <button type="button" class="pu-btn" id="pu-close">关闭</button>
        </div>
      </div>
    </div>
  `;

  $('body').append(modalHtml);

  applyPresetUpdateModalStyles();

  const modal = $('#preset-update-modal');
  modal.data({ apiInfo, sourcePreset, targetPreset });

  bindPresetUpdateModalEvents();
  refreshPlan();

  function bindPresetUpdateModalEvents() {
    const debouncedSearch = debounce(applySearchFilter, 150);

    modal.off('click.pu');
    modal.off('change.pu');

    modal.on('click.pu', '#close-preset-update-header', () => modal.remove());
    modal.on('click.pu', '#pu-close', () => modal.remove());

    modal.on('click', e => e.target === modal[0] && modal.remove());

    $(document).on('keydown.preset-update-modal', e => {
      if (e.key === 'Escape') {
        modal.remove();
        $(document).off('keydown.preset-update-modal');
      }
    });

    modal.on('remove', () => {
      $(document).off('keydown.preset-update-modal');
    });

    modal.on('input.pu', '#pu-search', debouncedSearch);

    modal.on('click.pu', '#pu-refresh', e => {
      e.preventDefault();
      refreshPlan();
    });

    // Manual toggle for checkboxes to avoid theme/global CSS interference with native checkbox clicks.
    modal.on('click.pu', '.pu-option', function (e) {
      e.preventDefault();
      const $input = $(this).find('input[type="checkbox"]').first();
      if (!$input.length) return;
      $input.prop('checked', !$input.prop('checked')).trigger('change');
    });

    modal.on('change.pu', '#pu-preserve-enabled', function () {
      localStorage.setItem('preset-transfer-pu-preserve-enabled', $(this).prop('checked'));
      refreshPlan();
    });

    modal.on('click.pu', '#pu-select-all', e => {
      e.preventDefault();
      setAllVisibleSelection(true);
    });
    modal.on('click.pu', '#pu-select-none', e => {
      e.preventDefault();
      setAllVisibleSelection(false);
    });

    modal.on('click.pu', '#pu-execute', e => {
      e.preventDefault();
      executeMerge();
    });

    if (getDeviceInfo().isMobile) {
      const originalOverflow = $('body').css('overflow');
      $('body').css('overflow', 'hidden');
      modal.on('remove', () => $('body').css('overflow', originalOverflow));
    }

    modal.css('display', 'flex');
  }

  function refreshPlan() {
    const $body = $('#pu-body');
    $body.html('<div class="pu-loading">正在计算差异...</div>');
    $('#pu-summary').text('');
    $('#pu-execute').prop('disabled', true);

    let plan;
    try {
      plan = getPresetUpdatePlan(apiInfo, sourcePreset, targetPreset);
    } catch (error) {
      console.error('预设更新：计算差异失败:', error);
      $body.html(`<div class="pu-empty">计算差异失败：${escapeHtml(error?.message || String(error))}</div>`);
      return;
    }

    modal.data('plan', plan);
    renderPlan(plan);
    applySearchFilter();
  }

  function renderPlan(plan) {
    const $body = $('#pu-body');
    const missingCount = plan?.missingCount ?? 0;
    const preserveEnabled = $('#pu-preserve-enabled').prop('checked');

    if (!plan || !Array.isArray(plan.groups) || plan.groups.length === 0 || missingCount === 0) {
      $body.html('<div class="pu-empty">没有检测到需要补全的条目。</div>');
      updateSummary();
      return;
    }

    const html = plan.groups
      .map(group => {
        const entriesHtml = (group.entries || [])
          .map(entry => {
            const identifier = entry?.identifier || '';
            const name = entry?.name || '(未命名)';
            const sourceEnabledKnown = entry?.enabledInSource === true || entry?.enabledInSource === false;
            const sourceEnabledText = sourceEnabledKnown ? (entry.enabledInSource ? '是' : '否') : '未知';
            const finalEnabled = preserveEnabled && sourceEnabledKnown ? entry.enabledInSource : true;
            const finalEnabledText = finalEnabled ? '是' : '否';

            const contentRaw = typeof entry?.content === 'string' ? entry.content : '';
            const contentSnippet = contentRaw
              ? escapeHtml(contentRaw.replace(/\s+/g, ' ').slice(0, 140))
              : '<span class="pu-muted">（无内容）</span>';
            const contentForSearch = contentRaw.slice(0, 2000);
            const searchText = `${name} ${contentForSearch}`.toLowerCase();

            const role = entry?.role || 'system';
            const position = entry?.injection_position || 'relative';
            const depth = entry?.injection_depth ?? 4;
            const order = entry?.injection_order ?? '';
            const triggers = Array.isArray(entry?.injection_trigger) ? entry.injection_trigger.join(', ') : '';

            const meta = `${role} | ${position} | ${depth} | ${order} | ${triggers || '无'} | 源启用:${sourceEnabledText} | 最终启用:${finalEnabledText}`;

            return `
              <div class="pu-entry" data-identifier="${escapeHtml(identifier)}" data-search="${escapeHtml(searchText)}">
                <label class="pu-entry-main">
                  <input type="checkbox" class="pu-entry-check" data-identifier="${escapeHtml(identifier)}">
                  <span class="pu-entry-name">${escapeHtml(name)}</span>
                </label>
                <div class="pu-entry-meta">${escapeHtml(meta)}</div>
                <div class="pu-entry-content">${contentSnippet}</div>
              </div>
            `;
          })
          .join('');

        return `
          <div class="pu-group" data-group-id="${escapeHtml(group.id)}">
            <div class="pu-group-header">
              <div class="pu-group-title">${escapeHtml(group.label || '插入位置')}</div>
              <div class="pu-group-actions">
                <button type="button" class="pu-btn small pu-group-select" data-action="all">全选</button>
                <button type="button" class="pu-btn small pu-group-select" data-action="none">不选</button>
              </div>
            </div>
            <div class="pu-group-body">
              ${entriesHtml || '<div class="pu-empty">（此分组无条目）</div>'}
            </div>
          </div>
        `;
      })
      .join('');

    $body.html(html);

    $body.off('change.pu').on('change.pu', '.pu-entry-check', () => updateSummary());
    $body.off('click.puToggle').on('click.puToggle', '.pu-entry-main', function (e) {
      e.preventDefault();
      const $input = $(this).find('.pu-entry-check').first();
      if (!$input.length) return;
      $input.prop('checked', !$input.prop('checked')).trigger('change');
    });
    $body.off('click.pu').on('click.pu', '.pu-group-select', function () {
      const $btn = $(this);
      const action = $btn.data('action');
      const $group = $btn.closest('.pu-group');
      const checked = action === 'all';
      $group.find('.pu-entry:visible .pu-entry-check').prop('checked', checked);
      updateSummary();
    });

    updateSummary();
  }

  function applySearchFilter() {
    const term = ($('#pu-search').val() || '').toString().toLowerCase().trim();
    let visibleEntries = 0;

    $('#pu-body .pu-entry').each(function () {
      const $entry = $(this);
      const haystack = ($entry.data('search') || '').toString();
      const match = !term || haystack.includes(term);
      $entry.toggle(match);
      if (match) visibleEntries++;
    });

    $('#pu-body .pu-group').each(function () {
      const $group = $(this);
      const anyVisible = $group.find('.pu-entry:visible').length > 0;
      $group.toggle(anyVisible);
    });

    $('#pu-search-hint').text(term ? `可见 ${visibleEntries} 条` : '');
    updateSummary();
  }

  function setAllVisibleSelection(checked) {
    $('#pu-body .pu-entry:visible .pu-entry-check').prop('checked', checked);
    updateSummary();
  }

  function getSelectedIdentifiers() {
    const ids = [];
    $('#pu-body .pu-entry-check:checked').each(function () {
      const id = $(this).data('identifier');
      if (id) ids.push(String(id));
    });
    return ids;
  }

  function updateSummary() {
    const plan = modal.data('plan');
    const missingCount = plan?.missingCount ?? 0;
    const selectedCount = getSelectedIdentifiers().length;

    $('#pu-summary').text(`缺失 ${missingCount} 条，已选 ${selectedCount} 条`);
    $('#pu-execute').prop('disabled', selectedCount === 0);
  }

  async function executeMerge() {
    const selectedIdentifiers = getSelectedIdentifiers();
    if (selectedIdentifiers.length === 0) return;

    const preserveEnabled = $('#pu-preserve-enabled').prop('checked');

    const confirmMessage = `确定将选中的 <b>${selectedIdentifiers.length}</b> 个条目从 <b>${escapeHtml(
      sourcePreset,
    )}</b> 转移到 <b>${escapeHtml(targetPreset)}</b> 吗？`;

    showConfirmDialog(confirmMessage, async () => {
      const $btn = $('#pu-execute');
      const originalText = $btn.text();
      $btn.prop('disabled', true).text('转移中...');

      try {
        const result = await performPresetUpdateMerge(apiInfo, sourcePreset, targetPreset, {
          preserveEnabled,
          selectedIdentifiers,
        });

        if (!result.merged) {
          alert('没有转移任何条目。');
        } else {
          alert(`已转移 ${result.merged} 个条目到 "${targetPreset}"。`);
        }

        if ($('#auto-close-modal').prop('checked')) {
          $('#preset-update-modal').remove();
          $('#preset-transfer-modal').remove();
          return;
        }

        try {
          loadAndDisplayEntries(apiInfo);
        } catch (e) {
          console.warn('预设更新：刷新主界面失败', e);
        }

        refreshPlan();
      } catch (error) {
        console.error('预设更新：转移失败', error);
        alert('预设更新失败: ' + (error?.message || error));
      } finally {
        $btn.prop('disabled', false).text(originalText);
        updateSummary();
      }
    });
  }
}

function applyPresetUpdateModalStyles() {
  const $ = getJQuery();
  const vars = CommonStyles.getVars();

  const cssLink = document.createElement('link');
  cssLink.rel = 'stylesheet';
  cssLink.href = './scripts/extensions/third-party/preset-transfer/src/styles/preset-update-modal.css';
  if (!document.querySelector(`link[href="${cssLink.href}"]`)) {
    document.head.appendChild(cssLink);
  }

  const styles = `
    #preset-update-modal {
      --pt-font-size: ${vars.fontSize};
      --pt-accent-color: ${vars.accentColor};
      --pt-accent-color-muted: ${vars.accentMutedColor || vars.accentColor};
      --pt-section-bg: ${vars.sectionBg};
      --pt-sub-bg: ${vars.subBg};
      --pt-input-bg: ${vars.inputBg};
      --pt-border-color: ${vars.borderColor};
      --pt-body-color: ${vars.textColor};
      --pt-quote-color: ${vars.tipColor};
      ${CommonStyles.getModalBaseStyles({ maxWidth: vars.maxWidthLarge })}
      z-index: 10004;
    }
    #preset-update-modal .preset-update-modal-content {
      position: relative;
      background: ${vars.bgColor};
      border-radius: ${vars.borderRadius};
      padding: ${vars.isMobile ? vars.padding : vars.paddingLarge};
      max-width: ${vars.isMobile ? '95vw' : '900px'};
      width: ${vars.isMobile ? '95vw' : '92vw'};
      max-height: ${vars.isMobile ? '92vh' : '88vh'};
      max-height: ${vars.isMobile ? '92dvh' : '88dvh'};
      max-height: ${vars.isMobile ? 'calc(var(--pt-vh, 1vh) * 92)' : 'calc(var(--pt-vh, 1vh) * 88)'};
      display: flex;
      flex-direction: column;
      color: ${vars.textColor};
      border: 1px solid ${vars.borderColor};
      box-shadow: 0 20px 40px ${vars.borderColor};
      overflow: hidden;
    }
  `;

  if (!$('#preset-update-modal-styles').length) {
    $('head').append(`<style id="preset-update-modal-styles">${styles}</style>`);
  }
}

export { showPresetUpdateModal };
