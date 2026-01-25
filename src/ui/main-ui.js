import { ensureViewportCssVars, escapeAttr, escapeHtml, getCurrentApiInfo, getDeviceInfo, getJQuery } from '../core/utils.js';
import { bindTransferEvents } from '../events/event-binding.js';
import { loadLocalManifest } from '../features/extension-update.js';
import { initPresetListGrouping } from '../features/preset-list-grouping.js';
import { initializeEnhancedFeatures } from '../settings/enhanced-features.js';
import { getActiveTransferAdapter, getTransferEngine, setActiveTransferAdapterKey } from '../transfer/transfer-context.js';
import { favoriteStarIcon, gearIcon, getCurrentPresetIcon } from './icons.js';
import { applyStyles } from './styles-application.js';

async function createTransferUI({ adapterKey = 'preset' } = {}) {
  setActiveTransferAdapterKey(adapterKey);
  const adapter = getActiveTransferAdapter();
  console.log('开始创建转移UI...');

  // 全局预设监听器在脚本加载时已经启动，这里不需要重复初始化
  const apiInfo = getCurrentApiInfo();
  if (!apiInfo) {
    console.error('无法获取API信息');
    alert('无法获取当前API信息，请确保 SillyTavern 已正确加载');
    return;
  }

  console.log('API信息获取成功，预设数量:', apiInfo.presetNames.length);
  const initialContainerNames = adapter.id === 'preset' && Array.isArray(apiInfo.presetNames) ? apiInfo.presetNames.slice() : [];
  if (adapter.id === 'preset' && initialContainerNames.length < 1) {
    alert('至少需要 1 个预设才能进行操作');
    return;
  }

  const $ = getJQuery();
  const { isMobile, isSmallScreen, isPortrait } = getDeviceInfo();
  ensureViewportCssVars();

  const renderFavoritesButton = (context) => `
        <button type="button" class="pt-favorites-btn" data-pt-fav-context="${context}" title="收藏条目">
            ${favoriteStarIcon()}
        </button>
    `;

  const renderFavoritesPanel = (context) => `
        <div class="pt-favorites-panel" data-pt-fav-context="${context}" style="display:none;">
            <div class="pt-favorites-header">
                <div class="pt-favorites-title-group">
                    <div class="pt-favorites-title">收藏条目</div>
                    <div class="pt-favorites-sub"></div>
                </div>
                <div class="pt-favorites-actions">
                    <button type="button" class="pt-favorites-transfer">转移</button>
                </div>
            </div>
            <div class="pt-favorites-body">
                <div class="pt-favorites-empty">暂无收藏条目</div>
                <div id="pt-favorites-entries-${context}" class="pt-favorites-entries"></div>
            </div>
        </div>
    `;

  const extensionManifest = await loadLocalManifest()
    .then(r => r.manifest)
    .catch(() => null);

  const modalHtml = `
        <div id="preset-transfer-modal">
            <div class="transfer-modal-content">
                <div class="modal-header">
                    <div>
                        <h2>预设条目转移工具</h2>
                    </div>
                    <div class="font-size-control">
                        <label for="font-size-slider" title="调节字体大小">⚙️</label>
                        <input type="range" id="font-size-slider" min="10" max="32" value="16" step="1">
                        <span id="font-size-display">16px</span>
                    </div>
                    <div class="version-info">
                        <span class="author">V${escapeHtml(String(extensionManifest?.version ?? 'dev'))} by discord千秋梦</span>
                    </div>
                </div>
                <div class="preset-selection">
                    <div class="preset-field">
                        <label>
                            <span>左侧预设</span>
                            <span>选择要管理的预设</span>
                        </label>
                        <div class="preset-input-group">
                            <select id="left-preset">
                                <option value="">请选择预设</option>
                                ${apiInfo.presetNames.map(name => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join('')}
                            </select>
                            <button id="get-current-left" class="get-current-btn" title="获取当前预设">
                                ${getCurrentPresetIcon()}
                            </button>
                        </div>
                    </div>
                    <div class="preset-field">
                        <label>
                            <span>右侧预设</span>
                            <span>选择要管理的预设</span>
                        </label>
                        <div class="preset-input-group">
                            <select id="right-preset">
                                <option value="">请选择预设</option>
                                ${apiInfo.presetNames.map(name => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join('')}
                            </select>
                            <button id="get-current-right" class="get-current-btn" title="获取当前预设">
                                ${getCurrentPresetIcon()}
                            </button>
                        </div>
                    </div>
                </div>
                <div class="action-section">
                    <button id="load-entries" disabled>加载条目</button>
                    <button id="batch-delete-presets">批量管理预设</button>
                    <label class="auto-switch-label">
                        <input type="checkbox" id="auto-close-modal" checked>
                        <span>完成后自动关闭</span>
                    </label>
                    <label class="auto-switch-label">
                        <input type="checkbox" id="auto-enable-entry" checked>
                        <span>插入后自动开启</span>
                    </label>
                </div>
                <div id="entries-container" style="display: none;">
                    <div class="entries-header">
                        <h4>双向预设管理</h4>
                        <p>提示：左右两侧显示不同预设的条目，可以互相转移、编辑、删除，点击条目右侧的 ➕ 按钮可在此处新建</p>
                        <div class="search-section">
                            <div class="search-input-wrapper has-favorites">
                                ${renderFavoritesButton('main')}
                                <input type="text" id="entry-search" placeholder="搜索条目...">
                                <button type="button" class="pt-search-settings-btn" data-pt-search-context="main" title="搜索选项">
                                    ${gearIcon()}
                                </button>
                                <div class="pt-search-settings-popover" data-pt-search-context="main" style="display:none;">
                                    <label class="pt-search-option">
                                        <input type="checkbox" class="pt-search-opt-global">
                                        <span>跨预设搜索</span>
                                    </label>
                                    <label class="pt-search-option">
                                        <input type="checkbox" class="pt-search-opt-content">
                                        <span>含内容（可能卡顿）</span>
                                    </label>
                                </div>
                                ${renderFavoritesPanel('main')}
                            </div>
                        </div>
                    </div>

                    <!-- 单预设模式 -->
                    <div class="single-entries-container" id="single-container" style="display: none;">
                        <div class="single-side entries-side">
                            <div class="side-header">
                                <h5 id="single-preset-title">预设管理</h5>
                                <div class="side-controls">
                                    <div class="control-row">
                                        <button id="single-select-all" class="selection-btn">
                                            <span class="btn-icon"></span> 全选
                                        </button>
                                        <button id="single-select-none" class="selection-btn">
                                            <span class="btn-icon"></span> 不选
                                        </button>
                                    </div>
                                    <div class="control-row">
                                        <button id="single-show-new" class="selection-btn" style="display: none;">
                                            <span class="btn-icon"></span> 新建
                                        </button>
                                    </div>
                                    <div class="display-options">
                                        <select id="single-display-mode" class="display-mode-select">
                                            <option value="default">仅显示已启用</option>
                                            <option value="include_disabled">显示全部</option>
                                            <option value="show_uninserted">显示未插入提示词（慎选，顺序是完全打乱的，乱用会导致转移位置混乱）</option>
                                        </select>
                                    </div>
                                </div>
                                <span id="single-selection-count" class="selection-count"></span>
                            </div>
                            <div id="single-entries-list" class="entries-list"></div>
                            <div class="side-actions">
                                <button id="single-edit" disabled>编辑</button>
                                <button id="single-delete" disabled>删除</button>
                                <button id="single-copy" disabled>复制</button>
                                <button id="single-move" disabled>移动</button>
                            </div>
                        </div>
                    </div>

                    <!-- 双预设模式 -->
                    <div class="dual-entries-container" id="dual-container" style="display: none;">
                        <div class="entries-side" id="left-side">
                            <div class="side-header">
                                <h5 id="left-preset-title">左侧预设</h5>
                                <div class="side-controls">
                                    <div class="control-row">
                                        <button id="left-select-all" class="selection-btn">
                                            <span class="btn-icon"></span> 全选
                                        </button>
                                        <button id="left-select-none" class="selection-btn">
                                            <span class="btn-icon"></span> 不选
                                        </button>
                                    </div>
                                    <div class="display-options">
                                        <select id="left-display-mode" class="display-mode-select">
                                            <option value="default">仅显示已启用</option>
                                            <option value="include_disabled">显示全部</option>
                                            <option value="show_uninserted">显示未插入提示词（慎选，顺序是完全打乱的，乱用会导致转移位置混乱）</option>
                                        </select>
                                    </div>
                                    <div class="control-row">
                                        <button id="left-show-new" class="selection-btn">
                                            <span class="btn-icon"></span> 新增
                                        </button>
                                    </div>
                                </div>
                            <span id="left-selection-count" class="selection-count"></span>
                        </div>
                        <div class="left-search-container" style="display: none;">
                            <div class="search-input-wrapper has-favorites">
                                ${renderFavoritesButton('left')}
                                <input type="text" id="left-entry-search-inline" placeholder="搜索左侧条目...">
                                <button type="button" class="pt-search-settings-btn" data-pt-search-context="left" title="搜索选项">
                                    ${gearIcon()}
                                </button>
                                    <div class="pt-search-settings-popover" data-pt-search-context="left" style="display:none;">
                                        <label class="pt-search-option">
                                            <input type="checkbox" class="pt-search-opt-global">
                                            <span>跨预设搜索</span>
                                        </label>
                                        <label class="pt-search-option">
                                        <input type="checkbox" class="pt-search-opt-content">
                                        <span>含内容（可能卡顿）</span>
                                    </label>
                                </div>
                                ${renderFavoritesPanel('left')}
                            </div>
                        </div>
                        <div id="left-entries-list" class="entries-list"></div>
                            <div class="side-actions">
                                <button id="left-edit" disabled>编辑</button>
                                <button id="left-delete" disabled>删除</button>
                                <button id="left-copy" disabled>复制</button>
                                <button id="transfer-to-right" disabled>转移</button>
                            </div>
                        </div>

                        <div class="entries-side" id="right-side">
                            <div class="side-header">
                                <h5 id="right-preset-title">右侧预设</h5>
                                <div class="side-controls">
                                    <div class="control-row">
                                        <button id="right-select-all" class="selection-btn">
                                            <span class="btn-icon"></span> 全选
                                        </button>
                                        <button id="right-select-none" class="selection-btn">
                                            <span class="btn-icon"></span> 不选
                                        </button>
                                    </div>
                                    <div class="display-options">
                                        <select id="right-display-mode" class="display-mode-select">
                                            <option value="default">仅显示已启用</option>
                                            <option value="include_disabled">显示全部</option>
                                            <option value="show_uninserted">显示未插入提示词（慎选，顺序是完全打乱的，乱用会导致转移位置混乱）</option>
                                        </select>
                                    </div>
                                    <div class="control-row">
                                        <button id="right-show-new" class="selection-btn">
                                            <span class="btn-icon"></span> 新增
                                        </button>
                                        <button id="compare-entries" class="selection-btn" disabled>
                                            <span class="btn-icon"></span> 比较
                                        </button>
                                    </div>
                                </div>
                            <span id="right-selection-count" class="selection-count"></span>
                        </div>
                        <div class="right-search-container" style="display: none;">
                            <div class="search-input-wrapper has-favorites">
                                ${renderFavoritesButton('right')}
                                <input type="text" id="right-entry-search-inline" placeholder="搜索右侧条目...">
                                <button type="button" class="pt-search-settings-btn" data-pt-search-context="right" title="搜索选项">
                                    ${gearIcon()}
                                </button>
                                    <div class="pt-search-settings-popover" data-pt-search-context="right" style="display:none;">
                                        <label class="pt-search-option">
                                            <input type="checkbox" class="pt-search-opt-global">
                                            <span>跨预设搜索</span>
                                        </label>
                                        <label class="pt-search-option">
                                        <input type="checkbox" class="pt-search-opt-content">
                                        <span>含内容（可能卡顿）</span>
                                    </label>
                                </div>
                                ${renderFavoritesPanel('right')}
                            </div>
                        </div>
                            <div id="right-entries-list" class="entries-list"></div>
                            <div class="side-actions">
                                <button id="right-edit" disabled>编辑</button>
                                <button id="right-delete" disabled>删除</button>
                                <button id="right-copy" disabled>复制</button>
                                <button id="transfer-to-left" disabled>转移</button>
                            </div>
                        </div>
                    </div>

                    <div class="modal-actions">
                        <button id="close-modal">✖ 关闭</button>
                    </div>
                </div>
            </div>
        </div>
    `;

  $('body').append(modalHtml);

  // Version text (based on manifest.json, so it updates automatically after a git pull + refresh).
  try {
    const version = extensionManifest?.version ? `V${String(extensionManifest.version)}` : 'V?';
    const author = extensionManifest?.author ? ` by ${String(extensionManifest.author)}` : '';
    $('#preset-transfer-modal .version-info').html('<span class="author" id="pt-extension-version-info"></span>');
    $('#pt-extension-version-info').text(`${version}${author}`);
  } catch {
    // ignore
  }

  const modal = $('#preset-transfer-modal');
  modal.attr('data-pt-adapter', adapter.id);

  let containerNames = initialContainerNames;
  const isLoadingContainers = adapter.id !== 'preset';
  if (isLoadingContainers) containerNames = [];

  let containerOptionsToken = 0;
  const populateContainerOptions = (names, { loading = false } = {}) => {
    const label = adapter?.ui?.containerLabel ?? '预设';
    const placeholder = loading ? `正在加载${label}...` : `请选择${label}`;

    const $left = $('#left-preset');
    const $right = $('#right-preset');

    $left.prop('disabled', !!loading);
    $right.prop('disabled', !!loading);

    const normalized = (Array.isArray(names) ? names : [])
      .map((n) => String(n ?? '').trim())
      .filter(Boolean);

    const doc = $('#preset-transfer-modal')[0]?.ownerDocument ?? document;

    const applyOptions = ($select) => {
      const el = $select?.[0];
      if (!el) return;

      containerOptionsToken += 1;
      const token = String(containerOptionsToken);
      el.dataset.ptContainerOptionsToken = token;

      el.innerHTML = '';

      const makeOption = (value, text) => {
        const opt = doc.createElement('option');
        opt.value = value;
        opt.textContent = text;
        return opt;
      };

      el.appendChild(makeOption('', placeholder));

      if (normalized.length === 0) return;

      const CHUNK_THRESHOLD = adapter.id === 'worldbook' ? 60 : 900;
      const CHUNK_SIZE = adapter.id === 'worldbook' ? 40 : 300;

      if (normalized.length <= CHUNK_THRESHOLD) {
        const frag = doc.createDocumentFragment();
        for (const name of normalized) frag.appendChild(makeOption(name, name));
        if (el.dataset.ptContainerOptionsToken !== token) return;
        el.appendChild(frag);
        return;
      }

      let idx = 0;
      const appendChunk = () => {
        if (el.dataset.ptContainerOptionsToken !== token) return;
        const frag = doc.createDocumentFragment();
        const end = Math.min(normalized.length, idx + CHUNK_SIZE);
        for (; idx < end; idx += 1) {
          const name = normalized[idx];
          frag.appendChild(makeOption(name, name));
        }
        el.appendChild(frag);
        if (idx < normalized.length) requestAnimationFrame(appendChunk);
      };

      requestAnimationFrame(appendChunk);
    };

    applyOptions($left);
    applyOptions($right);
  };

  populateContainerOptions(containerNames, { loading: isLoadingContainers });

  // Adapter-aware UI normalization (worldbook vs preset)
  try {
    modal.find('.modal-header h2').text(adapter.ui.toolTitle);

    // Search popover label: "global" means cross-container search for the active adapter.
    const globalSearchLabel = adapter.id === 'worldbook' ? '跨世界书搜索' : '跨预设搜索';
    modal.find('.pt-search-settings-popover .pt-search-opt-global').each(function () {
      const $input = $(this);
      $input.closest('label').find('span').last().text(globalSearchLabel);
    });

    const fields = modal.find('.preset-selection .preset-field');
    const leftField = fields.eq(0).find('label span');
    const rightField = fields.eq(1).find('label span');
    leftField.eq(0).text(`左侧${adapter.ui.containerLabel}`);
    leftField.eq(1).text(`选择要管理的${adapter.ui.containerLabel}`);
    rightField.eq(0).text(`右侧${adapter.ui.containerLabel}`);
    rightField.eq(1).text(`选择要管理的${adapter.ui.containerLabel}`);

    populateContainerOptions(containerNames, { loading: isLoadingContainers });

    $('#batch-delete-presets').text(`批量管理${adapter.ui.containerLabel}`);

    if (adapter.id === 'worldbook') {
      try {
        $('#entries-container .entries-header h4').text('双向世界书管理');
        $('#entries-container .entries-header p').text(
          '提示：左右两侧显示不同世界书的条目，可以互相转移、编辑、删除；点击上方“新建”可在当前世界书中创建条目。',
        );
        $('#left-show-new')
          .attr('title', '在左侧世界书中新建条目')
          .html('<span class="btn-icon"></span> 新建');
        $('#right-show-new')
          .attr('title', '在右侧世界书中新建条目')
          .html('<span class="btn-icon"></span> 新建');
        $('#single-show-new')
          .show()
          .attr('title', '在当前世界书中新建条目')
          .html('<span class="btn-icon"></span> 新建');
      } catch {
        // ignore
      }

      // Worldbook display modes: show all / constant / keyword (no "enabled-only" mode).
      try {
        const displayModeOptions = [
          { value: 'default', label: '显示全部' },
          { value: 'wb_constant', label: '显示常驻（蓝灯）' },
          { value: 'wb_keyword', label: '显示关键词（绿灯）' },
        ];

        const allowed = new Set(displayModeOptions.map((o) => o.value));
        const normalizeStored = (value) => {
          const raw = String(value ?? '').trim();
          if (!raw) return 'default';
          if (raw === 'include_disabled') return 'default';
          return allowed.has(raw) ? raw : 'default';
        };

        $('#left-display-mode, #right-display-mode, #single-display-mode').each(function () {
          const $select = $(this);
          const prev = normalizeStored($select.val());

          $select.empty();
          for (const opt of displayModeOptions) {
            $('<option>').val(opt.value).text(opt.label).appendTo($select);
          }

          $select.val(prev);
        });
      } catch {
        // ignore
      }

      const enableDblClickSearch = (selectId) => {
        const $select = $(selectId);
        if (!$select.length) return;
        $select.attr('title', `双击搜索${adapter.ui.containerLabel}`);

        const datalistId = 'pt-worldbook-name-datalist';
        let $datalist = $(`#${datalistId}`);
        if ($datalist.length === 0) {
          $datalist = $('<datalist>').attr('id', datalistId);
          $('body').append($datalist);
        }

        $select.off('dblclick.ptWorldbookSearch');
        $select.on('dblclick.ptWorldbookSearch', function (event) {
          event.preventDefault();
          event.stopPropagation();

          const $this = $(this);
          if ($this.data('pt-search-active')) return;
          $this.data('pt-search-active', true);

          const optionNames = $this
            .find('option')
            .map((_, opt) => String(opt?.value ?? ''))
            .get()
            .filter(Boolean);

          $datalist.empty();
          for (const name of optionNames) {
            $('<option>').attr('value', name).appendTo($datalist);
          }

          const currentValue = String($this.val() ?? '');
          const $input = $('<input>')
            .attr({
              type: 'text',
              list: datalistId,
              placeholder: `搜索${adapter.ui.containerLabel}...`,
            })
            .addClass('pt-container-search-input')
            .val(currentValue);

          const resolveValue = (rawValue) => {
            const needle = String(rawValue ?? '').trim();
            if (!needle) return null;
            const exact = optionNames.find(n => n === needle);
            if (exact) return exact;
            const lower = needle.toLowerCase();
            const matches = optionNames.filter(n => String(n).toLowerCase().includes(lower));
            if (matches.length === 1) return matches[0];
            return null;
          };

          const restore = (apply = false) => {
            const nextValue = resolveValue($input.val());
            $input.remove();
            $this.show();
            $this.data('pt-search-active', false);

            if (apply && nextValue) {
              $this.val(nextValue).trigger('change');
            }
          };

          $this.after($input).hide();
          $input.focus().select();

          $input.on('keydown', e => {
            if (e.key === 'Escape') {
              e.preventDefault();
              restore(false);
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              restore(true);
            }
          });

          $input.on('blur', () => {
            restore(true);
          });
        });
      };

      enableDblClickSearch('#left-preset');
      enableDblClickSearch('#right-preset');
    }

    if (!adapter.capabilities.supportsBatchDeleteContainers) {
      $('#batch-delete-presets').hide();
    }
    if (!adapter.capabilities.supportsCompare) {
      $('#compare-entries').hide();
    }
    if (!adapter.capabilities.supportsEdit) {
      $('#left-edit, #right-edit, #single-edit').hide();
    }
    if (!adapter.capabilities.supportsCopy) {
      $('#left-copy, #right-copy, #single-copy').hide();
    }
    if (!adapter.capabilities.supportsMove) {
      $('#single-move').hide();
    }
    if (!adapter.capabilities.supportsUninsertedMode) {
      $('#left-display-mode option[value="show_uninserted"]').remove();
      $('#right-display-mode option[value="show_uninserted"]').remove();
      $('#single-display-mode option[value="show_uninserted"]').remove();
    }

    if (adapter.id !== 'preset') {
      $('#get-current-left, #get-current-right, #left-preview-btn, #right-preview-btn').remove();
    }

    if ($(`#pt-adapter-style-${adapter.id}`).length === 0) {
      $('head').append(`
        <style id="pt-adapter-style-${adapter.id}">
          #preset-transfer-modal[data-pt-adapter="worldbook"] .create-here-btn { display: none !important; }
          #preset-transfer-modal[data-pt-adapter="worldbook"] #auto-switch-preset { display: none !important; }
          #preset-transfer-modal[data-pt-adapter="worldbook"] .preset-input-group .pt-container-search-input { flex: 1; }
        </style>
      `);
    }
  } catch (e) {
    console.warn('PresetTransfer: adapter UI tweaks failed', e);
  }

  // Normalize texts after DOM insertion (remove decorative emojis)
  $('#close-modal').text('关闭');

  applyStyles(isMobile, isSmallScreen, isPortrait);
  bindTransferEvents(apiInfo, $('#preset-transfer-modal'));
  if (adapter.id === 'preset') {
    initPresetListGrouping('#left-preset');
    initPresetListGrouping('#right-preset');
  }

  if (isLoadingContainers) {
    // Avoid blocking UI during panel open: load container list async and then populate selects.
    setTimeout(() => {
      void (async () => {
        try {
          populateContainerOptions([], { loading: true });
          const names = await getTransferEngine().listContainers(apiInfo);
          if (!Array.isArray(names) || names.length < 1) {
            alert(`至少需要 1 个${adapter.ui.containerLabel}才能进行操作`);
            $('#close-modal').trigger('click');
            return;
          }
          containerNames = names;
          populateContainerOptions(containerNames, { loading: false });
        } catch (error) {
          console.error('PresetTransfer: failed to load containers', error);
          alert(`加载${adapter.ui.containerLabel}列表失败: ` + (error?.message ?? error));
          $('#close-modal').trigger('click');
        }
      })();
    }, 0);
  }

  // 初始化增强功能（包括“新增条目”过滤等）
  if (adapter.id === 'preset') {
    initializeEnhancedFeatures(apiInfo);
  }
}

export { createTransferUI };
