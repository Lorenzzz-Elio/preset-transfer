import { getJQuery } from '../core/utils.js';
import { loadAndDisplayEntries } from './entry-display.js';
import { getActiveTransferAdapter, getTransferEngine } from '../transfer/transfer-context.js';

const MAX_RESULTS = 80;

let activeToken = 0;

function yieldToMain() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function normalizeTerm(term) {
  return String(term || '').toLowerCase().trim();
}

function getOrCreatePanel($wrapper) {
  const $ = getJQuery();
  let panel = $wrapper.find('.pt-global-search-panel');
  if (panel.length) return panel;
  panel = $(`<div class="pt-global-search-panel" style="display:none;"></div>`);
  $wrapper.append(panel);
  return panel;
}

function renderPanel($panel, data) {
  const $ = getJQuery();
  const { title, subtitle, results, targetLabel } = data;

  const itemsHtml = (results || [])
    .map(r => {
      const disabled = r.disabled ? 'disabled' : '';
      const buttonText = '转移条目';
      const sub = r.sub ? `<div class="pt-global-search-sub">${escapeHtml(r.sub)}</div>` : '';
      return `
        <div class="pt-global-search-item" data-pt-result-id="${escapeHtml(r.id)}">
          <div class="pt-global-search-meta">
            <div class="pt-global-search-name">${escapeHtml(r.name || '')}</div>
            ${sub}
          </div>
          <div class="pt-global-search-actions">
            <button class="pt-global-search-transfer" ${disabled}>${buttonText}</button>
          </div>
        </div>
      `;
    })
    .join('');

  $panel.html(`
    <div class="pt-global-search-header">
      <div>
        <div class="pt-global-search-title">${escapeHtml(title || '全局搜索')}</div>
        <div>${escapeHtml(subtitle || '')}</div>
      </div>
    </div>
    ${itemsHtml || `<div class="pt-global-search-item"><div class="pt-global-search-meta"><div class="pt-global-search-sub">没有匹配结果</div></div></div>`}
  `);
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getTargetContainerForContext(context) {
  const $ = getJQuery();
  if (context === 'left') return $('#left-preset').val();
  if (context === 'right') return $('#right-preset').val();
  if (context === 'main') {
    const left = $('#left-preset').val();
    const right = $('#right-preset').val();
    if (left && !right) return left;
    if (!left && right) return right;
    return '';
  }
  return '';
}

function getWorldbookTargets() {
  const $ = getJQuery();
  return {
    left: $('#left-preset').val(),
    right: $('#right-preset').val(),
  };
}

function getDisplayModeForContext(context) {
  const $ = getJQuery();
  if (context === 'left') return $('#left-display-mode').val() || 'default';
  if (context === 'right') return $('#right-display-mode').val() || 'default';
  if (context === 'main') {
    return $('#single-display-mode').val() || 'default';
  }
  return 'default';
}

function getAutoEnableSetting() {
  const $ = getJQuery();
  return $('#auto-enable-entry').is(':checked');
}

function closeAllPanels() {
  const $ = getJQuery();
  $('.pt-global-search-panel').hide();
}

function closePanel($wrapper) {
  getOrCreatePanel($wrapper).hide();
}

async function runGlobalSearch({ apiInfo, context, wrapperSelector, searchTerm, includeContent }) {
  const $ = getJQuery();
  const adapter = getActiveTransferAdapter();
  const engine = getTransferEngine();

  const term = normalizeTerm(searchTerm);
  const $wrapper = $(wrapperSelector);
  const $panel = getOrCreatePanel($wrapper);

  if (!term) {
    closePanel($wrapper);
    return;
  }

  const targetContainer = getTargetContainerForContext(context);
  if (!targetContainer) {
    $panel.show();
    renderPanel($panel, {
      title: '全局搜索',
      subtitle: `请先选择目标${adapter.ui.containerLabel}`,
      results: [],
      targetLabel: adapter.ui.containerLabel,
    });
    return;
  }

  const token = ++activeToken;
  const containers = await engine.listContainers(apiInfo);
  const results = [];
  const idToPayload = new Map();

  $panel.show();
  renderPanel($panel, {
    title: '全局搜索',
    subtitle: `准备扫描...`,
    results: [],
    targetLabel: adapter.ui.containerLabel,
  });

  for (let i = 0; i < containers.length; i++) {
    if (token !== activeToken) return;
    const container = containers[i];

    let entries = [];
    try {
      entries = await engine.getEntries(apiInfo, container, 'include_disabled');
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (token !== activeToken) return;
      if (!entry) continue;

      const name = String(entry.name || '');
      const nameLower = name.toLowerCase();
      const contentLower = includeContent ? String(entry.content || '').toLowerCase() : '';
      const matches = includeContent ? nameLower.includes(term) || contentLower.includes(term) : nameLower.includes(term);
      if (!matches) continue;

      // Avoid duplicates across containers based on a stable key when available.
      // For preset entries, ptKey is name; for worldbook it's a signature.
      // Always scope the key by container so same-named entries across different presets remain visible.
      const stableKey = `${container}::${String(entry.ptKey || entry.identifier || name)}`;
      if (idToPayload.has(stableKey)) continue;

      const id = `${container}::${String(entry.identifier || '')}::${String(results.length)}`;
      idToPayload.set(stableKey, { id, container, entry });

      const subParts = [];
      subParts.push(`来源：${container}`);
      if (includeContent && entry.content) {
        const content = String(entry.content || '').replace(/\s+/g, ' ').trim();
        if (content) subParts.push(`片段：${content.slice(0, 60)}${content.length > 60 ? '…' : ''}`);
      }

      results.push({
        id,
        name,
        sub: subParts.join('  '),
        disabled: container === targetContainer,
      });

      if (results.length >= MAX_RESULTS) break;
    }

    if (token !== activeToken) return;
    renderPanel($panel, {
      title: '全局搜索',
      subtitle: `已扫描 ${i + 1}/${containers.length}，匹配 ${results.length}${results.length >= MAX_RESULTS ? `（已达上限 ${MAX_RESULTS}）` : ''}`,
      results,
      targetLabel: adapter.ui.containerLabel,
    });

    if (results.length >= MAX_RESULTS) break;
    await yieldToMain();
  }

  if (token !== activeToken) return;

  // Bind transfer buttons (id->payload in resultMap)
  $panel.off('click.ptGlobalSearch');
  $panel.on('click.ptGlobalSearch', '.pt-global-search-transfer', async function (e) {
    e.preventDefault();
    e.stopPropagation();

    const $item = $(this).closest('.pt-global-search-item');
    const resultId = $item.data('pt-result-id');
    const match = (results || []).find(r => r.id === resultId);
    if (!match) return;

    const payload = Array.from(idToPayload.values()).find(v => v.id === resultId);
    if (!payload?.entry) return;

    const sourceContainer = payload.container;
    const entry = payload.entry;

    // Activate the standard "click target entry to choose insert position" flow.
    // For adapters without insert position support, fall back to immediate transfer to the current target container.
    if (!adapter.capabilities?.supportsInsertPosition) {
      try {
        const autoEnable = getAutoEnableSetting();
        let actualTargetContainer = targetContainer;

        // Worldbook: if both sides are selected, let user click a side panel (left/right) to choose the target.
        if (adapter.id === 'worldbook') {
          const { left, right } = getWorldbookTargets();
          const hasLeft = !!left;
          const hasRight = !!right;
          const bothTargets = hasLeft && hasRight && left !== right;

          if (bothTargets) {
            window.ptWorldbookPickTarget = {
              apiInfo,
              sourceContainer,
              entries: [entry],
            };
            // Hide panel while choosing target side.
            $panel.hide();
            $('#left-side, #right-side').addClass('transfer-target');

            const tip = '转移模式已激活！请点击左侧或右侧面板区域，选择目标世界书。';
            if (window.toastr) {
              toastr.info(tip);
            } else {
              alert(tip);
            }
            return;
          }

          const worldbookTarget = hasLeft ? left : hasRight ? right : '';
          if (!worldbookTarget) {
            if (window.toastr) toastr.warning('请先选择目标世界书');
            return;
          }

          actualTargetContainer = worldbookTarget;
          await engine.transfer(apiInfo, {
            sourceContainer,
            targetContainer: worldbookTarget,
            entries: [entry],
            insertPosition: null,
            autoEnable,
            displayMode: getDisplayModeForContext(context),
          });
        } else {
          await engine.transfer(apiInfo, {
            sourceContainer,
            targetContainer,
            entries: [entry],
            insertPosition: null,
            autoEnable,
            displayMode: getDisplayModeForContext(context),
          });
        }

        await loadAndDisplayEntries(apiInfo);
        if (window.toastr) toastr.success(`已转移到目标${adapter.ui.containerLabel}: ${actualTargetContainer}`);
      } catch (error) {
        console.error('全局搜索转移失败:', error);
        if (window.toastr) toastr.error('转移失败: ' + error.message);
      }
      return;
    }

    // Reset any existing transfer mode and highlight any target side.
    window.transferMode = null;
    $('.transfer-target, .transfer-source').removeClass('transfer-target transfer-source');

    window.transferMode = {
      apiInfo,
      fromSide: null,
      toSide: 'any',
      selectedEntries: [entry],
      sourceContainer,
    };

    // Hide the global search panel so it doesn't cover the list while choosing the insert location.
    $panel.hide();

    $('#left-side, #right-side, #single-container .entries-side').addClass('transfer-target');

    const tip = `转移模式已激活！请点击任意面板中的条目来选择插入位置。`;
    if (window.toastr) {
      toastr.info(tip);
    } else {
      alert(tip);
    }
  });
}

function cancelGlobalSearch() {
  activeToken += 1;
}

export { cancelGlobalSearch, closeAllPanels, runGlobalSearch };
