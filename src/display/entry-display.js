import { NEW_FIELD_DEFAULTS } from '../core/constants.js';
import { escapeAttr, escapeHtml, getCurrentApiInfo, getJQuery, getParentWindow } from '../core/utils.js';
import { executeMoveToPosition } from '../operations/copy-move.js';
import { performInsertNewEntry } from '../operations/core-operations.js';
import { executeNewEntryAtPosition, executeTransferToPosition } from '../operations/entry-operations.js';
import { ensureAllEntriesHaveNewFields } from '../preset/new-version-fields.js';
import { getOrderedPromptEntries, getPresetDataFromManager } from '../preset/preset-manager.js';
import { CommonStyles } from '../styles/common-styles.js';
import { getActiveTransferAdapter, getTransferEngine } from '../transfer/transfer-context.js';
import { updateCompareButton } from '../ui/compare-modal.js';
import { getTargetPromptsList } from '../ui/edit-modal.js';
import { createNewIcon, favoriteStarIcon } from '../ui/icons.js';
import { updateSelectionCount } from './ui-updates.js';
import {
  getFavoriteIdsForContainer,
  getFavoriteIdsForContainerSync,
  isFavoritesSupported,
  toggleFavoriteEntry,
} from '../features/favorite-entries.js';
import { applyGroupDisplayToRenderedEntries } from './entry-group-display.js';

async function commitWorldbookPickTarget(side) {
  const $ = getJQuery();
  const adapter = getActiveTransferAdapter();
  if (adapter?.id !== 'worldbook') return;

  const payload = window.ptWorldbookPickTarget;
  if (!payload || !payload.apiInfo || !payload.sourceContainer || !Array.isArray(payload.entries) || payload.entries.length === 0) {
    return;
  }

  let targetContainer = '';
  let displayMode = 'default';

  if (side === 'left') {
    targetContainer = $('#left-preset').val();
    displayMode = $('#left-display-mode').val() || 'default';
  } else if (side === 'right') {
    targetContainer = $('#right-preset').val();
    displayMode = $('#right-display-mode').val() || 'default';
  } else if (side === 'single') {
    targetContainer = window.singlePresetName;
    displayMode = $('#single-display-mode').val() || 'default';
  }

  if (!targetContainer) {
    if (window.toastr) toastr.warning('请选择目标世界书');
    return;
  }

  try {
    const autoEnable = $('#auto-enable-entry').prop('checked');
    await getTransferEngine().transfer(payload.apiInfo, {
      sourceContainer: payload.sourceContainer,
      targetContainer,
      entries: payload.entries,
      insertPosition: null,
      autoEnable,
      displayMode,
    });

    await loadAndDisplayEntries(payload.apiInfo);
    if (window.toastr) toastr.success(`已转移到目标世界书: ${targetContainer}`);
  } catch (error) {
    console.error('世界书转移失败:', error);
    if (window.toastr) toastr.error('转移失败: ' + error.message);
  } finally {
    window.ptWorldbookPickTarget = null;
    $('#left-side, #right-side').removeClass('transfer-target');
  }
}

function resolveContainerName(side, options = {}) {
  const override = String(options?.containerName ?? '').trim();
  if (override) return override;

  const $ = getJQuery();
  if (side === 'left') return String($('#left-preset').val() ?? '').trim();
  if (side === 'right') return String($('#right-preset').val() ?? '').trim();
  if (side === 'single') return String(window.singlePresetName ?? '').trim();
  if (side === 'favorites') return String(window.ptFavoriteContainerName ?? '').trim();
  return '';
}
async function loadAndDisplayEntries(apiInfo) {
  const $ = getJQuery();
  const leftPreset = $('#left-preset').val();
  const rightPreset = $('#right-preset').val();

  // 检查是否至少选择了一个预设
  if (!leftPreset && !rightPreset) {
    alert('请至少选择一个预设');
    return;
  }

  // 判断是单预设还是双预设模式
  const isSingleMode = (leftPreset && !rightPreset) || (!leftPreset && rightPreset);

  if (isSingleMode) {
    await loadSinglePresetMode(apiInfo, leftPreset || rightPreset);
  } else {
    await loadDualPresetMode(apiInfo, leftPreset, rightPreset);
  }
}

async function loadSinglePresetMode(apiInfo, presetName) {
  const $ = getJQuery();
  const displayMode = $('#single-display-mode').val();

  try {
    const adapter = getActiveTransferAdapter();
    const entries = await getTransferEngine().getEntries(apiInfo, presetName, displayMode);

    window.singleEntries = entries;
    window.singlePresetData = null;
    window.singlePresetName = presetName;

    displayEntries(entries, 'single');
    $('#single-preset-title').text(`预设管理: ${presetName}`);

    // 隐藏双预设界面，显示单预设界面
    $('#dual-container').hide();
    $('#single-container').show();
    $('#entries-container').show();
    $('#single-preset-title').text(`${adapter.ui.containerLabel}管理: ${presetName}`);

    // 显示单一搜索栏，隐藏内联搜索栏
    $('.search-section').show();
    $('.left-search-section').hide();
    $('.left-search-container').hide();
    $('.right-search-container').hide();

    updateSelectionCount();

    // 重置模式
    window.transferMode = null;
    window.newEntryMode = null;
  } catch (error) {
    console.error('加载条目失败:', error);
    alert('加载条目失败: ' + error.message);
  }
}

async function loadDualPresetMode(apiInfo, leftPreset, rightPreset) {
  const $ = getJQuery();
  const leftDisplayMode = $('#left-display-mode').val();
  const rightDisplayMode = $('#right-display-mode').val();

  try {
    // 获取预设数据
    const adapter = getActiveTransferAdapter();
    const engine = getTransferEngine();

    // 加载左侧条目
    if (leftPreset) {
      const leftEntries = await engine.getEntries(apiInfo, leftPreset, leftDisplayMode);
      window.leftEntries = leftEntries;
      window.leftPresetData = null;
      displayEntries(leftEntries, 'left');
      $('#left-preset-title').text(`左侧预设: ${leftPreset}`);
    } else {
      window.leftEntries = [];
      window.leftPresetData = null;
      displayEntries([], 'left');
      $('#left-preset-title').text('左侧预设: 未选择');
    }

    // 加载右侧条目
    if (rightPreset) {
      const rightEntries = await engine.getEntries(apiInfo, rightPreset, rightDisplayMode);
      window.rightEntries = rightEntries;
      window.rightPresetData = null;
      displayEntries(rightEntries, 'right');
      $('#right-preset-title').text(`右侧预设: ${rightPreset}`);
    } else {
      window.rightEntries = [];
      window.rightPresetData = null;
      displayEntries([], 'right');
      $('#right-preset-title').text('右侧预设: 未选择');
    }

    // 显示双预设界面，隐藏单预设界面
    $('#single-container').hide();
    $('#dual-container').show();
    $('#entries-container').show();

    if (leftPreset) {
      $('#left-preset-title').text(`左侧${adapter.ui.containerLabel}: ${leftPreset}`);
    } else {
      $('#left-preset-title').text(`左侧${adapter.ui.containerLabel}: 未选择`);
    }

    if (rightPreset) {
      $('#right-preset-title').text(`右侧${adapter.ui.containerLabel}: ${rightPreset}`);
    } else {
      $('#right-preset-title').text(`右侧${adapter.ui.containerLabel}: 未选择`);
    }

    // 隐藏单一搜索栏，显示内联搜索栏
    $('.search-section').hide();
    $('.left-search-section').hide();
    $('.left-search-container').show();
    $('.right-search-container').show();

    updateSelectionCount();
    if (adapter.capabilities.supportsCompare) {
      updateCompareButton();
    }

    // 重置转移模式
    window.transferMode = null;
    window.newEntryMode = null;
  } catch (error) {
    console.error('加载条目失败:', error);
    alert('加载条目失败: ' + error.message);
  }
}

function displayEntries(entries, side, options = {}) {
  const $ = getJQuery();
  const containerSelector = options.listSelector || `#${side}-entries-list`;
  const entriesList = $(containerSelector);

  if (!entriesList.length) {
    console.error(`条目列表容器 "${containerSelector}" 未找到`);
    return;
  }

  const vars = CommonStyles.getVars();
  const { isMobile, isSmallScreen } = vars;
  const adapter = getActiveTransferAdapter();
  const renderPositions = options.showPositions !== false;
  const renderCreateButtons = options.showCreateButtons !== false;
  const renderEmptyMessage = options.showEmptyMessage !== false;
  const containerName = resolveContainerName(side, options);
  const supportsFavorites = isFavoritesSupported(adapter?.id);
  const favoriteIds = supportsFavorites && containerName ? getFavoriteIdsForContainerSync(adapter.id, containerName) : null;
  const isFavoritesSide = side === 'favorites';
  const favoriteIdsByContainer = options.favoriteIdsByContainer instanceof Map ? options.favoriteIdsByContainer : null;

  const resolveEntryContainer = (entry) => {
    if (isFavoritesSide) return String(entry?.ptFavoriteContainer ?? '').trim();
    return containerName;
  };

  const resolveEntryKey = (entry) => {
    if (isFavoritesSide) {
      const key = String(entry?.ptFavoriteKey ?? '').trim();
      if (key) return key;
      const entryContainer = resolveEntryContainer(entry);
      const identifier = String(entry?.identifier ?? '').trim();
      if (entryContainer && identifier) return `${entryContainer}::${identifier}`;
      return identifier;
    }
    return String(entry?.identifier ?? '').trim();
  };

  const renderEntryTitle = (entry) => {
    const safeName = escapeHtml(String(entry?.name ?? ''));
    if (isFavoritesSide) {
      const entryContainer = resolveEntryContainer(entry);
      if (entryContainer) return `[${escapeHtml(entryContainer)}] ${safeName}`;
    }
    return safeName;
  };

  const getFavoriteIdsForEntry = (entry) => {
    if (!supportsFavorites) return null;
    if (isFavoritesSide && favoriteIdsByContainer) {
      const entryContainer = resolveEntryContainer(entry);
      return entryContainer ? favoriteIdsByContainer.get(entryContainer) || null : null;
    }
    return favoriteIds;
  };

  const renderWorldbookTriggerDot = (entry) => {
    if (adapter?.id !== 'worldbook') return '';
    const raw = entry?.raw ?? {};
    const isConstant = !!raw.constant;
    const hasKey = Array.isArray(raw.key) && raw.key.some((v) => String(v ?? '').trim());

    if (isConstant) return '<span class="pt-wb-trigger-dot is-constant" title="常驻"></span>';
    if (hasKey) return '<span class="pt-wb-trigger-dot is-keyword" title="关键词"></span>';
    return '';
  };

  const updateFavoriteButtonState = ($btn, isFavorite) => {
    if (!$btn?.length) return;
    $btn.toggleClass('is-favorite', !!isFavorite);
    $btn.attr('aria-pressed', isFavorite ? 'true' : 'false');
    $btn.attr('title', isFavorite ? '取消收藏' : '收藏');
  };

  const renderFavoriteButton = (entry, index) => {
    if (!supportsFavorites) return '';
    const identifier = String(entry?.identifier ?? '').trim();
    if (!identifier) return '';
    const entryContainer = resolveEntryContainer(entry);
    const favoriteSet = getFavoriteIdsForEntry(entry);
    const isFavorite = favoriteSet ? favoriteSet.has(identifier) : false;
    const activeClass = isFavorite ? ' is-favorite' : '';
    const title = isFavorite ? '\u53d6\u6d88\u6536\u85cf' : '\u6536\u85cf';
    const pressed = isFavorite ? 'true' : 'false';
    const containerAttr = isFavoritesSide && entryContainer ? ` data-entry-container="${escapeAttr(entryContainer)}"` : '';
    return `
             <button class="pt-favorite-toggle${activeClass}" data-entry-index="${index}" data-entry-side="${side}" data-entry-identifier="${escapeAttr(identifier)}"${containerAttr} aria-pressed="${pressed}" title="${title}">
                 ${favoriteStarIcon()}
             </button>
         `;
  };

  const syncFavoriteButtons = (ids) => {
    if (!ids || !entriesList?.length) return;
    const isMap = ids instanceof Map;
    entriesList.find('.pt-favorite-toggle').each(function () {
      const $btn = $(this);
      const identifier = String($btn.data('entry-identifier') ?? '').trim();
      if (!identifier) return;
      if (isMap) {
        const container = String($btn.data('entry-container') ?? '').trim();
        const containerIds = container ? ids.get(container) : null;
        updateFavoriteButtonState($btn, containerIds ? containerIds.has(identifier) : false);
        return;
      }
      updateFavoriteButtonState($btn, ids.has(identifier));
    });
  };

  const renderPositionItem = (position, text) => `
   <div class="entry-item position-item" data-position="${position}" data-side="${side}" style="border-color: ${
     vars.borderColor
   }; background: ${
    vars.sectionBg
  }; transition: all 0.3s ease; cursor: pointer; position: relative; display: flex; align-items: center; padding: ${
    isSmallScreen ? '12px 10px' : isMobile ? '14px 12px' : '12px 14px'
  }; margin-bottom: ${isMobile ? '8px' : '6px'}; border: 2px dashed ${
    vars.borderColor
  }; border-radius: 8px; min-height: ${isMobile ? '50px' : '40px'};">
       <div style="flex: 1; text-align: center;">
           <div class="entry-name" style="font-weight: 600; color: ${vars.textColor}; font-size: ${
    isSmallScreen
      ? 'calc(var(--pt-font-size) * 0.8125)'
      : isMobile
      ? 'calc(var(--pt-font-size) * 0.875)'
      : 'calc(var(--pt-font-size) * 0.8125)'
  }; line-height: 1.3;">${text}</div>
       </div>
   </div>`;

  if (entries.length > 260) {
    const topHtml = renderPositionItem('top', '📍 插入到顶部');
    const bottomHtml = renderPositionItem('bottom', '📍 插入到底部');
    const hostId = `pt-${side}-entries-chunk-host`;

    const containerParts = [];
    if (renderPositions) containerParts.push(topHtml);
    containerParts.push(`<div id="${hostId}"></div>`);
    if (renderPositions) containerParts.push(bottomHtml);
    entriesList.html(containerParts.join(''));
    const host = entriesList.find(`#${hostId}`);

    const buildDetailsText = (entry) => {
      const role = entry?.role || 'system';
      const position = entry?.injection_position || 'relative';
      const depth = entry?.injection_depth ?? 4;
      const order = entry?.injection_order ?? 100;
      const triggers = entry?.injection_trigger?.join(', ') || '无';
      return `${role} | ${position} | ${depth} | ${order} | ${triggers}`;
    };

    const renderEntryItem = (entry, index) => `
         <div class="entry-item" data-index="${index}" data-side="${side}" data-identifier="${escapeAttr(resolveEntryKey(entry))}" style="border-color: ${
      vars.inputBorder
    }; background: ${vars.inputBg}; transition: all 0.3s ease; cursor: pointer; position: relative; display: flex; align-items: center; padding: ${
      isSmallScreen ? '8px 6px' : isMobile ? '8px 8px' : '12px 14px'
    }; margin-bottom: ${isMobile ? '6px' : '6px'}; border: 1px solid ${vars.inputBorder}; border-radius: 8px; min-height: ${
      isMobile ? '32px' : '40px'
    };">
             <input type="checkbox" class="entry-checkbox" style="margin-right: ${isMobile ? '8px' : '10px'}; width: ${
      isMobile ? '14px' : '14px'
    }; height: ${isMobile ? '14px' : '14px'}; accent-color: ${vars.accentColor}; cursor: pointer; position: relative; z-index: 10;">
              <div style="flex: 1; ${isMobile ? 'min-width: 0;' : ''}">
                  <div class="entry-name" style="font-weight: 600; color: ${vars.textColor}; font-size: ${
       isSmallScreen
         ? 'calc(var(--pt-font-size) * 0.6875)'
         : isMobile
         ? 'calc(var(--pt-font-size) * 0.75)'
         : 'calc(var(--pt-font-size) * 0.8125)'
    }; word-break: break-word; line-height: 1.2;">${renderWorldbookTriggerDot(entry)}${renderEntryTitle(entry)}</div>
                  ${
                    isMobile
                      ? ''
                      : `<div class="entry-details" style="font-size: calc(var(--pt-font-size) * 0.75); color: ${vars.tipColor}; line-height: 1.4; margin-top: 2px;">${escapeHtml(buildDetailsText(entry))}</div>`
                  }
             </div>
             ${renderFavoriteButton(entry, index)}
             ${renderCreateButtons ? `<button class="create-here-btn" data-entry-index="${index}" data-entry-side="${side}" title="在此处新建">
                 ${createNewIcon()}
             </button>` : ''}
         </div>`;

    const chunkSize = isMobile ? 60 : 160;
    let startIndex = 0;
    let worldbookFavoriteIds = null;
    const renderChunk = () => {
      const endIndex = Math.min(entries.length, startIndex + chunkSize);
      let html = '';
      for (let i = startIndex; i < endIndex; i += 1) {
        html += renderEntryItem(entries[i], i);
      }
      host.append(html);
      if (worldbookFavoriteIds) {
        syncFavoriteButtons(worldbookFavoriteIds);
      }
      startIndex = endIndex;
      if (startIndex < entries.length) requestAnimationFrame(renderChunk);
    };

    renderChunk();
    bindEntryListEvents();

    if (supportsFavorites && adapter?.id === 'worldbook' && containerName) {
      getFavoriteIdsForContainer(adapter.id, containerName)
        .then(ids => {
          worldbookFavoriteIds = ids;
          syncFavoriteButtons(ids);
        })
        .catch(() => null);
    } else if (favoriteIds) {
      syncFavoriteButtons(favoriteIds);
    } else if (favoriteIdsByContainer) {
      syncFavoriteButtons(favoriteIdsByContainer);
    }
    return;
  }

  const entriesHtmlParts = [];
  if (renderPositions) {
    entriesHtmlParts.push(renderPositionItem('top', '📍 插入到顶部'));
  }

  if (entries.length === 0) {
    if (renderEmptyMessage) {
      entriesHtmlParts.push(
        `<div style="color: ${vars.tipColor}; text-align: center; padding: ${
          isMobile ? '30px 15px' : '40px 20px'
        }; font-size: ${
          isMobile ? 'calc(var(--pt-font-size) * 0.875)' : 'calc(var(--pt-font-size) * 0.8125)'
        }; font-weight: 500;"><div style="font-size: calc(var(--pt-font-size) * 3); margin-bottom: 15px; opacity: 0.3;">📭</div><div>没有条目</div></div>`,
      );
    }
  } else {
    entriesHtmlParts.push(
      ...entries.map(
        (entry, index) => `
         <div class="entry-item" data-index="${index}" data-side="${side}" data-identifier="${escapeAttr(resolveEntryKey(entry))}" style="border-color: ${vars.inputBorder}; background: ${
            vars.inputBg
          }; transition: all 0.3s ease; cursor: pointer; position: relative; display: flex; align-items: center; padding: ${
            isSmallScreen ? '8px 6px' : isMobile ? '8px 8px' : '12px 14px'
          }; margin-bottom: ${isMobile ? '6px' : '6px'}; border: 1px solid ${
            vars.inputBorder
          }; border-radius: 8px; min-height: ${isMobile ? '32px' : '40px'};">
             <input type="checkbox" class="entry-checkbox" style="margin-right: ${isMobile ? '8px' : '10px'}; width: ${
            isMobile ? '14px' : '14px'
          }; height: ${isMobile ? '14px' : '14px'}; accent-color: ${
            vars.accentColor
          }; cursor: pointer; position: relative; z-index: 10;">
             <div style="flex: 1; ${isMobile ? 'min-width: 0;' : ''}">
                  <div class="entry-name" style="font-weight: 600; color: ${vars.textColor}; font-size: ${
             isSmallScreen
               ? 'calc(var(--pt-font-size) * 0.6875)'
               : isMobile
               ? 'calc(var(--pt-font-size) * 0.75)'
               : 'calc(var(--pt-font-size) * 0.8125)'
          }; word-break: break-word; line-height: 1.2;">${renderWorldbookTriggerDot(entry)}${renderEntryTitle(entry)}${
             entry.isUninserted
               ? ' <span style="color: ${vars.accentColor}; font-size: calc(var(--pt-font-size) * 0.625);">🔸未插入</span>'
               : ''
           }</div>
                 ${
                   isMobile
                     ? ''
                     : `<div class="entry-details" style="font-size: calc(var(--pt-font-size) * 0.75); color: ${
                          vars.tipColor
                        }; line-height: 1.4; margin-top: 2px;">
                     <span>👤 ${escapeHtml(entry.role || 'system')}</span>
                     <span style="margin-left: 8px;">📍 ${escapeHtml(entry.injection_position || 'relative')}</span>
                     <span style="margin-left: 8px;">🔢 ${escapeHtml(entry.injection_depth ?? 4)}</span>
                     <span style="margin-left: 8px;">#️⃣ ${escapeHtml(entry.injection_order ?? 100)}</span>
                     <span style="margin-left: 8px;">⚡️ ${escapeHtml(entry.injection_trigger?.join(', ') || '无')}</span>
                 </div>`
                 }
             </div>
             ${renderFavoriteButton(entry, index)}
             ${renderCreateButtons ? `<button class="create-here-btn" data-entry-index="${index}" data-entry-side="${side}" title="在此处新建">
                 ${createNewIcon()}
             </button>` : ''}
         </div>`,
      ),
    );
  }

  if (renderPositions) {
    entriesHtmlParts.push(renderPositionItem('bottom', '📍 插入到底部'));
  }

  const entriesHtml = entriesHtmlParts.join('');

  entriesList.html(entriesHtml);

  // Normalize entry detail line: system | relative | 4 | 100 | 无
  // This keeps the original markup structure but strips emoji icons
  // and joins the key attributes with a simple separator for readability.
  entriesList.find('.entry-details').each(function () {
    const $detail = $(this);
    const spans = $detail.find('span');
    if (spans.length < 5) return;

    const cleanText = index => {
      const text = spans.eq(index).text().trim();
      // Remove a leading symbol (emoji etc.) plus following spaces, if present.
      return text.replace(/^\S+\s+/, '').trim();
    };

    const role = cleanText(0) || 'system';
    const position = cleanText(1) || 'relative';
    const depth = cleanText(2) || '4';
    const order = cleanText(3) || '100';
    const triggerRaw = cleanText(4);
    const triggers = triggerRaw || '无';

    $detail.text(`${role} | ${position} | ${depth} | ${order} | ${triggers}`);
  });

  // 绑定事件
  function bindEntryListEvents() {
  setTimeout(() => {
    const parentJQuery = getParentWindow().$;
    const entriesContainer = parentJQuery(containerSelector);

    entriesContainer.off('change', '.entry-checkbox').on('change', '.entry-checkbox', () => {
      updateSelectionCount();
    });

    entriesContainer.off('click', '.pt-favorite-toggle').on('click', '.pt-favorite-toggle', async function (e) {
      e.preventDefault();
      e.stopPropagation();

      const $btn = parentJQuery(this);
      const entrySide = String($btn.data('entry-side') ?? '').trim();
      const identifier = String($btn.data('entry-identifier') ?? '').trim();
      const adapter = getActiveTransferAdapter();
      let resolvedContainer = resolveContainerName(entrySide);
      if (entrySide === 'favorites') {
        const entryContainer = String($btn.data('entry-container') ?? '').trim();
        if (entryContainer) resolvedContainer = entryContainer;
      }

      if (!adapter?.id || !resolvedContainer || !identifier) return;

      try {
        const nextState = await toggleFavoriteEntry(adapter.id, resolvedContainer, identifier);
        updateFavoriteButtonState($btn, nextState);
      } catch (error) {
        console.error('收藏切换失败:', error);
        if (window.toastr) {
          toastr.error('收藏切换失败: ' + (error?.message ?? error));
        } else {
          alert('收藏切换失败: ' + (error?.message ?? error));
        }
      }
    });

    entriesContainer.off('click', '.entry-item').on('click', '.entry-item', async function (e) {
      const $target = parentJQuery(e.target);
      if (!$target.closest('.entry-checkbox, .create-here-btn, .pt-favorite-toggle').length) {
        e.preventDefault();
        const $item = parentJQuery(this);
        const itemSide = $item.data('side');
        const adapter = getActiveTransferAdapter();

        // Worldbook quick target selection mode: click any entry to select target side (no insert position).
        if (window.ptWorldbookPickTarget && adapter?.id === 'worldbook') {
          e.stopPropagation();
          await commitWorldbookPickTarget(itemSide);
          return;
        }

        // 位置项点击逻辑
        if ($item.hasClass('position-item')) {
          const position = $item.data('position');
          if (window.transferMode && (!window.transferMode.toSide || window.transferMode.toSide === itemSide || window.transferMode.toSide === 'any')) {
            executeTransferToPosition(window.transferMode.apiInfo, window.transferMode.fromSide, itemSide, position);
          } else if (window.newEntryMode && window.newEntryMode.side === itemSide) {
            executeNewEntryAtPosition(window.newEntryMode.apiInfo, itemSide, position);
          } else if (window.moveMode && window.moveMode.side === itemSide) {
            executeMoveToPosition(window.moveMode.apiInfo, itemSide, null, position);
          }
          return;
        }

        // 转移模式下的目标条目点击逻辑
        if (window.transferMode && (!window.transferMode.toSide || window.transferMode.toSide === itemSide || window.transferMode.toSide === 'any')) {
          const index = parseInt($item.data('index'));
          const identifier = $item.data('identifier');
          const adapter = getActiveTransferAdapter();

          let realIndex = index;
          if (adapter?.id !== 'worldbook') {
            const targetPreset = itemSide === 'single' ? window.singlePresetName : $(`#${itemSide}-preset`).val();
            // 始终使用完整列表来计算在prompt_order中的真实位置
            const fullList = getTargetPromptsList(targetPreset, 'include_disabled');
            realIndex = fullList.findIndex(entry => entry.identifier === identifier);
            if (realIndex < 0) realIndex = index;
          }

          executeTransferToPosition(
            window.transferMode.apiInfo,
            window.transferMode.fromSide,
            itemSide,
            realIndex,
          );
          return;
        }

        // 新建模式下的目标条目点击逻辑
        if (window.newEntryMode && window.newEntryMode.side === itemSide) {
          const index = parseInt($item.data('index'));
          const identifier = $item.data('identifier');
          const targetPreset = itemSide === 'single' ? window.singlePresetName : $(`#${itemSide}-preset`).val();
          const fullList = getTargetPromptsList(targetPreset, 'include_disabled');
          const realIndex = fullList.findIndex(entry => entry.identifier === identifier);
          executeNewEntryAtPosition(window.newEntryMode.apiInfo, itemSide, realIndex >= 0 ? realIndex : index);
          return;
        }

        // 移动模式下的目标条目点击逻辑
        if (window.moveMode && window.moveMode.side === itemSide) {
          const index = parseInt($item.data('index'));
          const identifier = $item.data('identifier');
          executeMoveToPosition(window.moveMode.apiInfo, itemSide, identifier, index);
          return;
        }

        // 正常选择模式
        const checkbox = $item.find('.entry-checkbox');
        checkbox.prop('checked', !checkbox.prop('checked')).trigger('change');
      }
    });

    // 绑定“在此处新建”按钮事件
    entriesContainer.off('click', '.create-here-btn').on('click', '.create-here-btn', function (e) {
      e.preventDefault();
      e.stopPropagation();

      const $btn = parentJQuery(this);
      const entryIndex = parseInt($btn.data('entry-index'));
      const entrySide = $btn.data('entry-side');

      // 目标预设
      let presetName;
      if (entrySide === 'left') {
        presetName = parentJQuery('#left-preset').val();
      } else if (entrySide === 'right') {
        presetName = parentJQuery('#right-preset').val();
      } else if (entrySide === 'single') {
        presetName = window.singlePresetName;
      }

      if (!presetName) {
        alert('请先选择目标预设');
        return;
      }

      const apiInfo = getCurrentApiInfo();
      if (!apiInfo) {
        alert('无法获取API信息');
        return;
      }

      // 计算“真实索引”（包含被隐藏的禁用项）
      const $entryItem = $btn.closest('.entry-item');
      const identifier = $entryItem.data('identifier');
      const fullList = getTargetPromptsList(presetName, 'include_disabled');
      const realIndex = identifier ? fullList.findIndex(e => e.identifier === identifier) : entryIndex;

      const defaultEntry = {
        name: '新提示词',
        content: '',
        role: 'system',
        injection_depth: 4,
        injection_position: null,
        forbid_overrides: false,
        system_prompt: false,
        marker: false,
        injection_order: NEW_FIELD_DEFAULTS.injection_order,
        injection_trigger: [...NEW_FIELD_DEFAULTS.injection_trigger],
        isNewEntry: true,
      };

      const autoEnable = parentJQuery('#auto-enable-entry').prop('checked');

      performInsertNewEntry(
        apiInfo,
        presetName,
        defaultEntry,
        `after-${realIndex >= 0 ? realIndex : entryIndex}`,
        autoEnable,
      )
        .then(() => {
          if (window.toastr) {
            toastr.success('已在此处新建空白条目');
          }
          loadAndDisplayEntries(apiInfo);
        })
        .catch(error => {
          console.error('在此处新建失败:', error);
          if (window.toastr) {
            toastr.error('在此处新建失败: ' + error.message);
          } else {
            alert('在此处新建失败: ' + error.message);
          }
        });
    });
  }, 50);
  }

  bindEntryListEvents();

  if (supportsFavorites && adapter?.id === 'worldbook' && containerName) {
    getFavoriteIdsForContainer(adapter.id, containerName)
      .then(ids => syncFavoriteButtons(ids))
      .catch(() => null);
  } else if (favoriteIds) {
    syncFavoriteButtons(favoriteIds);
  } else if (favoriteIdsByContainer) {
    syncFavoriteButtons(favoriteIdsByContainer);
  }

  // 应用分组显示（如果有分组配置）
  if (containerName && adapter?.id === 'preset' && !isFavoritesSide) {
    setTimeout(() => {
      applyGroupDisplayToRenderedEntries(entriesList, entries, side, containerName);
    }, 100);
  }
}

// 统一获取当前侧已选中的条目（优先按 identifier 对应，保证顺序稳定）
function getSelectedEntries(side, options = {}) {
  const $ = getJQuery();
  const selected = [];
  let entries;
  let listSelector;

  if (side === 'favorites') {
    entries = Array.isArray(options.entries) ? options.entries : Array.isArray(window.ptFavoriteEntries) ? window.ptFavoriteEntries : [];
    listSelector = options.listSelector || window.ptFavoriteListSelector || '#pt-favorites-entries-main';
  } else if (side === 'single') {
    entries = window.singleEntries;
    listSelector = '#single-entries-list';
  } else {
    entries = side === 'left' ? window.leftEntries : window.rightEntries;
    listSelector = `#${side}-entries-list`;
  }

  const identifierIndexMap = [];

  // 优先使用 identifier 匹配，fallback 到 index，保持与旧单文件版本一致
  $(`${listSelector} .entry-checkbox:checked`).each(function () {
    const $item = $(this).closest('.entry-item');
    const identifier = $item.data('identifier');
    const index = parseInt($item.data('index'));

    if (identifier && entries) {
      const entryByIdentifier = entries.find(entry => {
        if (side === 'favorites') {
          const key = String(entry?.ptFavoriteKey ?? '').trim();
          return key && key === identifier;
        }
        return entry.identifier === identifier;
      });
      if (entryByIdentifier) {
        identifierIndexMap.push({
          entry: entryByIdentifier,
          originalIndex: entries.indexOf(entryByIdentifier),
          identifier,
        });
        return;
      }
    }

    if (!isNaN(index) && entries && entries[index]) {
      identifierIndexMap.push({
        entry: entries[index],
        originalIndex: index,
        identifier: entries[index].identifier || null,
      });
    }
  });

  identifierIndexMap.sort((a, b) => a.originalIndex - b.originalIndex);
  identifierIndexMap.forEach(item => selected.push(item.entry));

  return selected;
}

export { commitWorldbookPickTarget, displayEntries, getSelectedEntries, loadAndDisplayEntries, loadDualPresetMode, loadSinglePresetMode };
