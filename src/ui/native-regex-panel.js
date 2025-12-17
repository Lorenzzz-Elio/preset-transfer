import { PT } from '../core/api-compat.js';
import { getJQuery, escapeHtml, debounce } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';
import {
  getRegexBindingEnabled,
  getPresetRegexBindings,
  getAllAvailableRegexes,
  savePresetRegexBindings,
  switchPresetRegexes,
} from '../features/regex-binding.js';
import { renderRegexListComponent } from './regex-list-component.js';

const ICON_COLLAPSED = '\u25B6';
const ICON_EXPANDED = '\u25BC';

let lastNativeRegexPanelPresetName = null;
let nativeRegexPanelContentObserver = null;
let nativeRegexPanelRestoringContent = false;

function setLastNativeRegexPanelPresetName(presetName) {
  if (presetName) lastNativeRegexPanelPresetName = presetName;
}

function teardownNativeRegexPanelContentObserver() {
  if (!nativeRegexPanelContentObserver) return;
  try {
    nativeRegexPanelContentObserver.disconnect();
  } catch {
    /* ignore */
  }
  nativeRegexPanelContentObserver = null;
}

function ensureNativeRegexPanelContentGuard() {
  const $ = getJQuery();
  const panel = $('#st-native-regex-panel');
  if (!panel.length) return;
  if (nativeRegexPanelContentObserver) return;

  const ParentObserver = window.parent && window.parent !== window ? window.parent.MutationObserver : null;
  const Observer = ParentObserver || window.MutationObserver;
  if (typeof Observer !== 'function') return;

  const target = panel.get(0);
  if (!target) return;

  nativeRegexPanelContentObserver = new Observer(() => {
    if (nativeRegexPanelRestoringContent) return;

    const $panel = $('#st-native-regex-panel');
    if (!$panel.length) {
      teardownNativeRegexPanelContentObserver();
      return;
    }

    const $content = $panel.find('.content').first();
    if (!$content.length) return;

    if ($content.find('#rb-groups, .rb-toolbar, #rb-search, #rb-filter, #rb-save').length) {
      nativeRegexPanelRestoringContent = true;
      try {
        ensureNativePresetRegexPanelContent($panel);

        const presetName = lastNativeRegexPanelPresetName || PT.API.getLoadedPresetName?.();
        if (presetName) {
          updateNativeRegexPanel(presetName);
        } else {
          $panel.find('#st-regex-binding-status').text('未检测到当前预设');
        }
      } catch (e) {
        console.warn('[RegexPanel] Content guard restore failed:', e);
      } finally {
        nativeRegexPanelRestoringContent = false;
      }
    }
  });

  nativeRegexPanelContentObserver.observe(target, { childList: true, subtree: true });
}

function resolvePresetRegexBindingModalRoot($root) {
  const $ = getJQuery();
  const $candidate = $root && $root.length ? $root : $('#pt-preset-regex-binding-modal');
  if (!$candidate.length) return $();

  const $modal = $candidate.filter('#pt-preset-regex-binding-modal');
  if ($modal.length) return $modal.first();

  const $closest = $candidate.closest('#pt-preset-regex-binding-modal');
  if ($closest.length) return $closest.first();

  return $();
}

function removeNativeRegexPanel() {
  const $ = getJQuery();
  $('#st-native-regex-panel').remove();
  teardownNativeRegexPanelContentObserver();
  lastNativeRegexPanelPresetName = null;
}

function ensureNativePresetRegexPanelContent(panel) {
  if (!panel?.length) return;
  const $content = panel.find('.content');
  if (!$content.length) return;

  const hasStatus = $content.find('#st-regex-binding-status').length > 0;
  const hasSearch = $content.find('#preset-regex-search').length > 0;
  const hasList = $content.find('#preset-regex-list').length > 0;
  if (hasStatus && hasSearch && hasList) return;

  const previousSearch = $content.find('#preset-regex-search').val();
  $content.html(`
    <div id="st-regex-binding-status" style="opacity: .9;">加载中...</div>
    <div class="preset-regex-toolbar">
      <input id="preset-regex-search" class="text_pole" placeholder="搜索当前预设绑定的正则..." />
    </div>
    <div class="preset-regex-list" id="preset-regex-list"></div>
  `);

  if (previousSearch) {
    $content.find('#preset-regex-search').val(previousSearch);
  }
}

function ensureNativeRegexPanelInjected() {
  const $ = getJQuery();
  const container = $('#openai_api-presets');
  if (!container.length) return false;
  if ($('#st-native-regex-panel').length) return true;

  if (!$('#st-native-regex-styles').length) {
    $('head').append(`
      <style id="st-native-regex-styles">
        /* 简化样式 - 跟随酒馆美化主题 */
        #st-native-regex-panel { margin-top: 10px; }
        #st-native-regex-panel .header { display: flex; align-items: center; gap: 8px; padding: 8px 0; }
        #st-native-regex-panel .header .title { font-weight: 600; }
        #st-native-regex-panel .rb-group { margin-bottom: 8px; }
        #st-native-regex-panel .rb-group-title { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px 10px; user-select: none; }
        #st-native-regex-panel .rb-group-toggle { width: 16px; text-align: center; }
        #st-native-regex-panel .rb-group-name { flex: 1; }
        #st-native-regex-panel .rb-group-count { opacity: 0.7; font-size: 12px; }
        #st-native-regex-panel .rb-group-content.collapsed { display: none; }
        #st-native-regex-panel .rb-label { display: flex; align-items: center; gap: 8px; padding: 6px 10px; }
        #st-native-regex-panel .rb-label .name { flex: 1; }
        #st-native-regex-panel .rb-label .badge { padding: 2px 6px; border-radius: 3px; font-size: 11px; white-space: nowrap; }
        #st-native-regex-panel .rb-label.unbound .badge { opacity: 0.6; }
        #st-native-regex-panel .rb-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
        #st-native-regex-panel .rb-toolbar input { flex: 1; min-width: 160px; }
        #st-native-regex-panel .rb-toolbar button, #st-native-regex-panel .rb-group-batch-btn { white-space: nowrap; }
        /* 预设正则列表（仅显示已绑定项，用于控制开关） */
        #st-native-regex-panel .preset-regex-toolbar { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
        #st-native-regex-panel .preset-regex-toolbar input { flex: 1; min-width: 160px; }
        #st-native-regex-panel .preset-regex-list .pr-row { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 6px; }
        #st-native-regex-panel .preset-regex-list .pr-row:hover { background: rgba(0,0,0,0.05); }
        #st-native-regex-panel .preset-regex-list .pr-name { flex: 1; }
        #st-native-regex-panel .preset-regex-list .pr-state { opacity: 0.7; font-size: 12px; min-width: 4em; text-align: right; }
        #st-native-regex-panel .preset-regex-list .pr-toggle-wrap { display: flex; align-items: center; }
        #st-native-regex-panel .preset-regex-list input.pr-toggle { display: none !important; }
        #st-native-regex-panel .preset-regex-list .pr-toggle-off { cursor: pointer; opacity: 0.5; filter: grayscale(0.5); transition: opacity var(--animation-duration-2x) ease-in-out; }
        #st-native-regex-panel .preset-regex-list .pr-toggle-off:hover { opacity: 1; filter: none; }
        #st-native-regex-panel .preset-regex-list .pr-toggle-on { cursor: pointer; }
        #st-native-regex-panel .preset-regex-list .pr-toggle:checked ~ .pr-toggle-on { display: inline-block; }
        #st-native-regex-panel .preset-regex-list .pr-toggle:checked ~ .pr-toggle-off { display: none; }
        #st-native-regex-panel .preset-regex-list .pr-toggle:not(:checked) ~ .pr-toggle-on { display: none; }
        #st-native-regex-panel .preset-regex-list .pr-toggle:not(:checked) ~ .pr-toggle-off { display: inline-block; }
        #st-native-regex-panel .preset-regex-empty { opacity: 0.75; padding: 10px; }

        /* 绑定管理弹窗复用同一套布局（不再出现竖排/无法折叠） */
        #pt-preset-regex-binding-modal {
          position: fixed;
          inset: 0;
          z-index: 10050;
          background: rgba(0, 0, 0, 0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          width: 100vw;
          height: 100vh;
          height: 100dvh;
          overflow: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
        }
        #pt-preset-regex-binding-modal .inner {
          width: min(1000px, 96vw);
          max-height: 80vh;
          max-height: 80dvh;
          max-height: min(80dvh, 900px);
          overflow: hidden;
          background: var(--pt-modal-bg);
          color: var(--pt-modal-text);
          border: 1px solid var(--pt-modal-border);
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
        }
        #pt-preset-regex-binding-modal .header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          border-bottom: 1px solid var(--pt-modal-border);
        }
        #pt-preset-regex-binding-modal .header .title {
          flex: 1;
          min-width: 0;
          font-weight: 600;
        }
        #pt-preset-regex-binding-modal .content {
          max-height: calc(80vh - 54px);
          max-height: calc(80dvh - 54px);
          max-height: calc(min(80dvh, 900px) - 54px);
          overflow: auto;
          padding: 10px;
          -webkit-overflow-scrolling: touch;
        }
        @media (max-width: 640px), (max-height: 560px) {
          #pt-preset-regex-binding-modal {
            align-items: flex-start;
            padding-top: 12px;
            padding-top: calc(12px + env(safe-area-inset-top));
            padding-bottom: 12px;
            padding-bottom: calc(12px + env(safe-area-inset-bottom));
            padding-left: 12px;
            padding-right: 12px;
          }
          #pt-preset-regex-binding-modal .inner {
            width: 100%;
            max-height: calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
          }
          #pt-preset-regex-binding-modal .content {
            max-height: calc(100dvh - 24px - 54px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
          }
        }
        #pt-preset-regex-binding-modal .rb-group { margin-bottom: 8px; }
        #pt-preset-regex-binding-modal .rb-group-title { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px 10px; user-select: none; }
        #pt-preset-regex-binding-modal .rb-group-toggle { width: 16px; text-align: center; }
        #pt-preset-regex-binding-modal .rb-group-name { flex: 1; }
        #pt-preset-regex-binding-modal .rb-group-count { opacity: 0.7; font-size: 12px; }
        #pt-preset-regex-binding-modal .rb-group-content.collapsed { display: none; }
        #pt-preset-regex-binding-modal .rb-label { display: flex; align-items: center; gap: 8px; padding: 6px 10px; }
        #pt-preset-regex-binding-modal .rb-label .name { flex: 1; }
        #pt-preset-regex-binding-modal .rb-label .badge { padding: 2px 6px; border-radius: 3px; font-size: 11px; white-space: nowrap; }
        #pt-preset-regex-binding-modal .rb-label.unbound .badge { opacity: 0.6; }
        #pt-preset-regex-binding-modal .rb-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
        #pt-preset-regex-binding-modal .rb-toolbar input { flex: 1; min-width: 160px; }
        #pt-preset-regex-binding-modal .rb-toolbar button, #pt-preset-regex-binding-modal .rb-group-batch-btn { white-space: nowrap; }
        /* 隐藏滚动条 */
        #st-native-regex-panel .content::-webkit-scrollbar { display: none; }
        #st-native-regex-panel .content { scrollbar-width: none; -ms-overflow-style: none; }
      </style>
    `);
  }

  const html = `
    <div id="st-native-regex-panel">
      <div class="header" style="display: flex; align-items: center; gap: 4px;">
        <button id="st-regex-toggle" class="menu_button" title="展开/折叠">${ICON_COLLAPSED}</button>
        <span class="title">预设正则</span>
        <div style="flex:1;"></div>
        <button id="preset-regex-manage" class="menu_button" style="font-size: 11px; padding: 2px 6px; display: inline-block; white-space: nowrap;" title="选择要绑定到当前预设的正则">绑定管理</button>
      </div>
      <div class="content" style="display:none; max-height:50vh; overflow:auto; padding:10px;">
        <div id="st-regex-binding-status" style="opacity: .9;">加载中...</div>
        <div class="preset-regex-toolbar">
          <input id="preset-regex-search" class="text_pole" placeholder="搜索当前预设绑定的正则..." />
        </div>
        <div class="preset-regex-list" id="preset-regex-list"></div>
      </div>
    </div>`;

  container.append(html);
  bindNativeRegexPanelEvents();
  ensureNativeRegexPanelContentGuard();
  const current = PT.API.getLoadedPresetName?.();
  if (current) updateNativeRegexPanel(current);
  return true;
}

function renderNativePresetRegexContent(presetName) {
  setLastNativeRegexPanelPresetName(presetName);
  const $ = getJQuery();
  const panel = $('#st-native-regex-panel');
  if (!panel.length) return;
  ensureNativePresetRegexPanelContent(panel);

  const bindings = getPresetRegexBindings(presetName);
  const allRegexes = getAllAvailableRegexes();
  const order = new Map(allRegexes.map((r, idx) => [String(r.id), idx]));
  const regexById = new Map(allRegexes.map(r => [String(r.id), r]));

  const term = (panel.find('#preset-regex-search').val() || '').toLowerCase();
  const bound = Array.isArray(bindings.bound) ? bindings.bound.slice() : [];

  const rows = bound
    .filter(item => item && item.id != null)
    .map(item => ({ id: String(item.id), enabled: !!item.enabled }))
    .filter(item => regexById.has(item.id))
    .sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9))
    .filter(item => {
      if (!term) return true;
      const r = regexById.get(item.id);
      const name = (r?.script_name || String(item.id)).toLowerCase();
      return name.includes(term);
    })
    .map(item => {
      const r = regexById.get(item.id);
      const safeName = escapeHtml(r?.script_name || String(item.id));
      const actualState = r?.enabled ? '已启用' : '未启用';
      return `
        <div class="pr-row" data-id="${escapeHtml(item.id)}">
          <label class="pr-toggle-wrap checkbox flex-container" title="启用/禁用（仅影响该预设）">
            <input type="checkbox" class="pr-toggle" ${item.enabled ? 'checked' : ''} />
            <span class="pr-toggle-on fa-solid fa-toggle-on fa-lg" title="点击禁用"></span>
            <span class="pr-toggle-off fa-solid fa-toggle-off fa-lg" title="点击启用"></span>
          </label>
          <span class="pr-name">${safeName}</span>
          <span class="pr-state">${actualState}</span>
        </div>`;
    })
    .join('');

  panel.find('#preset-regex-list').html(rows || `<div class="preset-regex-empty">当前预设未绑定任何正则。</div>`);
}

function bindNativePresetRegexPanelEvents(presetName) {
  setLastNativeRegexPanelPresetName(presetName);
  const $ = getJQuery();
  const panel = $('#st-native-regex-panel');
  if (!panel.length) return;
  ensureNativePresetRegexPanelContent(panel);

  const debouncedSearch = debounce(() => renderNativePresetRegexContent(presetName), 250);
  panel.find('#preset-regex-search').off('input').on('input', debouncedSearch);

  panel
    .find('#preset-regex-list')
    .off('change', '.pr-toggle')
    .on('change', '.pr-toggle', async function () {
      const $row = $(this).closest('.pr-row');
      const id = String($row.data('id'));
      const enabled = $(this).is(':checked');

      const beforeBindings = getPresetRegexBindings(presetName);
      const nextBindings = {
        bound: (beforeBindings.bound || []).map(x => ({ id: x.id, enabled: x.enabled })),
      };

      const idx = nextBindings.bound.findIndex(x => String(x.id) === id);
      if (idx >= 0) nextBindings.bound[idx].enabled = enabled;

      const ok = await savePresetRegexBindings(presetName, nextBindings);
      if (!ok) {
        if (window.toastr) toastr.error('保存失败');
        renderNativePresetRegexContent(presetName);
        return;
      }

      if (getRegexBindingEnabled()) {
        try {
          await switchPresetRegexes(presetName, presetName, { fromBindings: beforeBindings, toBindings: nextBindings });
          await new Promise(r => setTimeout(r, 100));
        } catch (e) {
          console.warn('应用预设正则开关失败:', e);
        }
      }

      renderNativePresetRegexContent(presetName);
    });
}

function renderNativeRegexBindingContent(presetName, $root) {
  setLastNativeRegexPanelPresetName(presetName);
  const $modal = resolvePresetRegexBindingModalRoot($root);
  if (!$modal.length) return;

  const bindings = getPresetRegexBindings(presetName);
  const allRegexes = getAllAvailableRegexes();
  const comp = renderRegexListComponent({ regexes: allRegexes, bindings });

  const $content = $modal.find('.pt-regex-binding-content').first();
  if (!$content.length) return;
  $content.html(comp.html);
}

function bindNativeRegexBindingPanelEvents(presetName, $root, { onSaved } = {}) {
  setLastNativeRegexPanelPresetName(presetName);
  const $ = getJQuery();
  const $modal = resolvePresetRegexBindingModalRoot($root);
  if (!$modal.length) return;
  const $groups = $modal.find('#rb-groups');

  $groups
    .off('click', '.rb-group-title')
    .on('click', '.rb-group-title', function (e) {
      if ($(e.target).closest('.rb-group-batch-btn').length) return;
      const $title = $(this);
      const $content = $title.next('.rb-group-content');
      const $toggle = $title.find('.rb-group-toggle');
      const collapsed = $content.hasClass('collapsed');
      $content.toggleClass('collapsed', !collapsed);
      $toggle.text(collapsed ? ICON_EXPANDED : ICON_COLLAPSED);
    });

  $groups
    .off('click', '.rb-group-batch-btn')
    .on('click', '.rb-group-batch-btn', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const $group = $(this).closest('.rb-group');
      const $rows = $group.find('.regex-row');
      const actions = [
        { fn: $rows => $rows.find('.rb-exclusive').prop('checked', true) },
        { fn: $rows => $rows.find('.rb-exclusive').prop('checked', false) },
      ];
      const choice = window.prompt('1=全选绑定, 2=全取消绑定');
      const idx = { 1: 0, 2: 1 }[choice?.trim?.()] ?? -1;
      if (idx >= 0) {
        actions[idx].fn($rows);

        $rows.find('.rb-label').each(function () {
          const checked = $(this).find('.rb-exclusive').is(':checked');
          $(this)
            .toggleClass('bound', checked)
            .toggleClass('unbound', !checked)
            .find('.badge')
            .text(checked ? '已绑定' : '未绑定')
            .toggleClass('menu_button', checked);
        });
      }
    });

  $groups
    .off('change', '.rb-exclusive')
    .on('change', '.rb-exclusive', function () {
      const $label = $(this).closest('.rb-label');
      const checked = $(this).is(':checked');

      $label
        .toggleClass('bound', checked)
        .toggleClass('unbound', !checked)
        .find('.badge')
        .text(checked ? '已绑定' : '未绑定')
        .toggleClass('menu_button', checked);
    });

  const applyRegexListFilter = () => {
    const term = ($modal.find('#rb-search').val() || '').toLowerCase();
    const mode = $modal.find('#rb-filter').val();
    $modal.find('#rb-groups .rb-group').each(function () {
      let anyVisible = false;
      $(this)
        .find('.regex-row')
        .each(function () {
          const name = $(this).find('.name').text().toLowerCase();
          const isBound = $(this).find('.rb-exclusive').is(':checked');
          const matchTerm = !term || name.includes(term);
          const matchMode =
            mode === 'all' ||
            (mode === 'bound' && isBound) ||
            (mode === 'unbound' && !isBound);
          const visible = matchTerm && matchMode;
          $(this).toggle(visible);
          anyVisible = anyVisible || visible;
        });
      $(this).toggle(anyVisible);
    });
  };

  const debouncedRegexSearch = debounce(applyRegexListFilter, 300);
  $modal.find('#rb-search').off('input').on('input', debouncedRegexSearch);
  $modal.find('#rb-filter').off('change').on('change', applyRegexListFilter);

  $modal
    .find('#rb-save')
    .off('click')
    .on('click', async function () {
      try {
        const beforeBindings = getPresetRegexBindings(presetName);
        const beforeStates =
          beforeBindings?.states && typeof beforeBindings.states === 'object' ? beforeBindings.states : {};
        const bound = [];
        $modal.find('#rb-groups .regex-row').each(function () {
          const id = String($(this).data('id'));
          const isExclusive = $(this).find('.rb-exclusive').is(':checked');
          if (!isExclusive) return;
          const enabled = Object.prototype.hasOwnProperty.call(beforeStates, id) ? !!beforeStates[id] : true;
          bound.push({ id, enabled });
        });
        const nextBindings = { bound };
        const ok = await savePresetRegexBindings(presetName, nextBindings);
        if (ok) {
          updateNativeRegexPanel(presetName);

          if (getRegexBindingEnabled()) {
            try {
              await switchPresetRegexes(presetName, presetName, { fromBindings: beforeBindings, toBindings: nextBindings });
              await new Promise(r => setTimeout(r, 100));
              if (window.toastr) toastr.success('正则绑定配置已保存并生效');
            } catch (switchError) {
              console.error('应用正则绑定失败:', switchError);
              if (window.toastr) toastr.warning('正则绑定配置已保存，但应用失败: ' + switchError.message);
            }
          } else {
            if (window.toastr) toastr.info('已保存（正则绑定功能当前为关闭状态，未立即生效）');
          }

          renderNativeRegexBindingContent(presetName, $modal);
          bindNativeRegexBindingPanelEvents(presetName, $modal, { onSaved });
          if (typeof onSaved === 'function') onSaved();
        } else {
          if (window.toastr) toastr.error('保存失败');
        }
      } catch (e) {
        console.error('保存绑定失败:', e);
        if (window.toastr) toastr.error('保存失败: ' + e.message);
      }
    });
}

function openPresetRegexBindingManager(presetName) {
  setLastNativeRegexPanelPresetName(presetName);
  const $ = getJQuery();
  const vars = CommonStyles.getVars();

  $('#pt-preset-regex-binding-modal').remove();

  const $modal = $(`
    <div id="pt-preset-regex-binding-modal" style="
      --pt-modal-bg: ${vars.bgColor};
      --pt-modal-text: ${vars.textColor};
      --pt-modal-border: ${vars.borderColor};
    ">
      <div class="inner">
        <div class="header">
          <div class="title">绑定管理：${escapeHtml(presetName)}</div>
          <button id="pt-preset-regex-binding-save" class="menu_button" style="white-space:nowrap;">保存</button>
          <button id="pt-preset-regex-binding-close" class="menu_button" style="white-space:nowrap;">关闭</button>
        </div>
        <div class="content pt-regex-binding-content"></div>
      </div>
    </div>
  `);

  $('body').append($modal);

  $modal.on('click', function (e) {
    if (e.target === this) $(this).remove();
  });
  $modal.find('#pt-preset-regex-binding-save').on('click', () => $modal.find('#rb-save').trigger('click'));
  $modal.find('#pt-preset-regex-binding-close').on('click', () => $modal.remove());

  renderNativeRegexBindingContent(presetName, $modal);
  bindNativeRegexBindingPanelEvents(presetName, $modal, {
    onSaved: () => {
      updateNativeRegexPanel(presetName);
      renderNativePresetRegexContent(presetName);
    },
  });

  $modal.find('#rb-save').hide();
}

function bindNativeRegexPanelEvents() {
  const $ = getJQuery();
  const panel = $('#st-native-regex-panel');
  if (!panel.length) return;

  $('#st-regex-toggle')
    .off('click')
    .on('click', function () {
      const $content = panel.find('.content');
      const wasOpen = $content.is(':visible');
      $content.slideToggle(150);
      $(this).text(wasOpen ? ICON_COLLAPSED : ICON_EXPANDED);
      if (!wasOpen) {
        try {
          const presetName = PT.API.getLoadedPresetName?.();
          if (presetName) {
            updateNativeRegexPanel(presetName);
          } else {
            panel.find('#st-regex-binding-status').text('未检测到当前预设');
          }
        } catch (e) {
          console.error('[RegexPanel] 展开面板失败:', e);
          if (window.toastr) toastr.error('打开绑定界面失败: ' + e.message);
        }
      }
    });

  $('#preset-regex-manage')
    .off('click')
    .on('click', function () {
      try {
        const presetName = PT.API.getLoadedPresetName?.();
        if (!presetName) {
          if (window.toastr) toastr.error('请先选择一个预设');
          return;
        }
        openPresetRegexBindingManager(presetName);
      } catch (e) {
        console.error('打开绑定管理失败:', e);
      }
    });
}

function updateNativeRegexPanel(presetName) {
  setLastNativeRegexPanelPresetName(presetName);
  ensureNativeRegexPanelContentGuard();
  try {
    const $ = getJQuery();
    const panel = $('#st-native-regex-panel');

    if (!panel.length) return;
    ensureNativePresetRegexPanelContent(panel);
    const bindings = getPresetRegexBindings(presetName);
    const count = Array.isArray(bindings.bound)
      ? bindings.bound.length
      : Array.isArray(bindings.exclusive)
        ? bindings.exclusive.length
        : 0;
    panel.find('#st-regex-binding-status').text(`预设: ${presetName}（已绑定 ${count} 个正则）`);

    try {
      renderNativePresetRegexContent(presetName);
      bindNativePresetRegexPanelEvents(presetName);
    } catch {
      /* ignore */
    }
  } catch (e) {
    console.warn('更新原生正则面板失败:', e);
  }
}

export {
  ensureNativeRegexPanelInjected,
  removeNativeRegexPanel,
  updateNativeRegexPanel,
  renderNativePresetRegexContent,
  bindNativePresetRegexPanelEvents,
  openPresetRegexBindingManager,
  renderNativeRegexBindingContent,
  bindNativeRegexBindingPanelEvents,
  bindNativeRegexPanelEvents,
};
