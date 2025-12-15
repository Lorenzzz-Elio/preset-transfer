import { ensureViewportCssVars, getCurrentApiInfo, getDeviceInfo, getJQuery } from '../core/utils.js';
import { bindTransferEvents } from '../events/event-binding.js';
import { loadLocalManifest } from '../features/extension-update.js';
import { initializeEnhancedFeatures } from '../settings/enhanced-features.js';
import { getActiveTransferAdapter, getTransferEngine, setActiveTransferAdapterKey } from '../transfer/transfer-context.js';
import { getCurrentPresetIcon } from './icons.js';
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
  const containerNames = await getTransferEngine().listContainers(apiInfo);
  if (containerNames.length < 1) {
    alert('至少需要 1 个预设才能进行操作');
    return;
  }

  const $ = getJQuery();
  const { isMobile, isSmallScreen, isPortrait } = getDeviceInfo();
  ensureViewportCssVars();

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
                        <span class="author">V1.0.0 by discord千秋梦</span>
                    </div>
                </div>
                <div class="preset-selection">
                    <div class="preset-field">
                        <label>
                            <span>左侧预设</span>
                            <span>选择要管理的预设</span>
                        </label>
                        <div class="preset-update-slot" data-side="left"></div>
                        <div class="preset-input-group">
                            <select id="left-preset">
                                <option value="">请选择预设</option>
                                ${apiInfo.presetNames.map(name => `<option value="${name}">${name}</option>`).join('')}
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
                        <div class="preset-update-slot" data-side="right"></div>
                        <div class="preset-input-group">
                            <select id="right-preset">
                                <option value="">请选择预设</option>
                                ${apiInfo.presetNames.map(name => `<option value="${name}">${name}</option>`).join('')}
                            </select>
                            <button id="get-current-right" class="get-current-btn" title="获取当前预设">
                                ${getCurrentPresetIcon()}
                            </button>
                        </div>
                    </div>
                </div>
                <div class="action-section">
                    <button id="load-entries" disabled>加载条目</button>
                    <button id="preset-update-to-right" disabled title="将左侧预设中右侧缺失的条目，按旧版本顺序智能插入到右侧">补全右侧</button>
                    <button id="preset-update-to-left" disabled title="将右侧预设中左侧缺失的条目，按旧版本顺序智能插入到左侧">补全左侧</button>
                    <button id="batch-delete-presets">批量删除预设</button>
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
                            <div class="search-input-wrapper">
                                <input type="text" id="entry-search" placeholder="搜索条目...">
                                <label class="search-content-toggle">
                                    <input type="checkbox" id="search-content-main" checked>
                                    <span>含内容</span>
                                </label>
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
                                <div class="search-input-wrapper">
                                    <input type="text" id="left-entry-search-inline" placeholder="搜索左侧条目...">
                                    <label class="search-content-toggle">
                                        <input type="checkbox" id="search-content-left" checked>
                                        <span>含内容</span>
                                    </label>
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
                                <div class="search-input-wrapper">
                                    <input type="text" id="right-entry-search-inline" placeholder="搜索右侧条目...">
                                    <label class="search-content-toggle">
                                        <input type="checkbox" id="search-content-right" checked>
                                        <span>含内容</span>
                                    </label>
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

  // Adapter-aware UI normalization (worldbook vs preset)
  try {
    modal.find('.modal-header h2').text(adapter.ui.toolTitle);

    const fields = modal.find('.preset-selection .preset-field');
    const leftField = fields.eq(0).find('label span');
    const rightField = fields.eq(1).find('label span');
    leftField.eq(0).text(`左侧${adapter.ui.containerLabel}`);
    leftField.eq(1).text(`选择要管理的${adapter.ui.containerLabel}`);
    rightField.eq(0).text(`右侧${adapter.ui.containerLabel}`);
    rightField.eq(1).text(`选择要管理的${adapter.ui.containerLabel}`);

    const optionsHtml = [`<option value="">请选择${adapter.ui.containerLabel}</option>`]
      .concat(containerNames.map(name => `<option value="${name}">${name}</option>`))
      .join('');

    $('#left-preset').html(optionsHtml);
    $('#right-preset').html(optionsHtml);

    $('#batch-delete-presets').text(`批量删除${adapter.ui.containerLabel}`);

    if (adapter.id === 'worldbook') {
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
  // Keep semantic placement: “补全左侧” on the left, “补全右侧” on the right.
  modal.find('.preset-update-slot[data-side="left"]').append($('#preset-update-to-left'));
  modal.find('.preset-update-slot[data-side="right"]').append($('#preset-update-to-right'));
  modal.find('.preset-update-slot').hide();
  $('#preset-update-to-right, #preset-update-to-left').prop('hidden', true);

  // Normalize texts after DOM insertion (remove decorative emojis)
  $('#close-modal').text('关闭');

  applyStyles(isMobile, isSmallScreen, isPortrait);
  bindTransferEvents(apiInfo, $('#preset-transfer-modal'));

  // 初始化增强功能（包括“新增条目”过滤等）
  if (adapter.id === 'preset') {
    initializeEnhancedFeatures(apiInfo);
  }
}

export { createTransferUI };
