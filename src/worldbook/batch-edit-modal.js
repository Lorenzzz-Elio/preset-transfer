import { ensureViewportCssVars, escapeHtml, getJQuery } from '../core/utils.js';
import { loadAndDisplayEntries } from '../display/entry-display.js';
import { CommonStyles } from '../styles/common-styles.js';

const MODAL_ID = 'pt-worldbook-batch-edit-modal';
const STYLE_ID = 'pt-worldbook-batch-edit-modal-styles';

let worldInfoModulePromise = null;

async function getWorldInfoModule() {
  if (!worldInfoModulePromise) {
    worldInfoModulePromise = import('/scripts/world-info.js');
  }
  return await worldInfoModulePromise;
}

async function loadWorldbook(name) {
  const mod = await getWorldInfoModule();
  if (typeof mod.loadWorldInfo !== 'function') {
    throw new Error('World Info module missing loadWorldInfo');
  }
  const data = await mod.loadWorldInfo(name);
  if (!data || typeof data !== 'object') {
    throw new Error(`无法加载世界书: ${name}`);
  }
  return data;
}

async function saveWorldbook(name, data) {
  const mod = await getWorldInfoModule();
  if (typeof mod.saveWorldInfo !== 'function') {
    throw new Error('World Info module missing saveWorldInfo');
  }
  await mod.saveWorldInfo(name, data, true);
}

function normalizeArrayInput(raw) {
  const text = String(raw ?? '');
  return text
    .split(/[\n,，;；|]/g)
    .map(s => s.trim())
    .filter(Boolean);
}

function getUidFromTransferEntry(entry) {
  const uid = entry?.raw?.uid ?? Number(entry?.identifier);
  return Number.isFinite(uid) ? Number(uid) : null;
}

function removeExisting() {
  const $ = getJQuery();
  $(`#${MODAL_ID}`).remove();
  $(`#${STYLE_ID}`).remove();
  $(document).off('keydown.pt-wb-batch-edit');
}

function renderStyles() {
  const vars = CommonStyles.getVars();
  return `
    #${MODAL_ID} {
      --pt-font-size: ${vars.fontSize};
      ${CommonStyles.getModalBaseStyles({ maxWidth: vars.maxWidthLarge })}
    }
    #${MODAL_ID} * {
      font-size: var(--pt-font-size);
      box-sizing: border-box;
    }
    #${MODAL_ID} .pt-wb-batch-edit-content {
      ${CommonStyles.getModalContentStyles({ maxWidth: vars.maxWidthLarge })}
      border: 1px solid ${vars.borderColor};
    }
    #${MODAL_ID} .pt-wb-batch-edit-header {
      text-align: center;
      margin-bottom: ${vars.margin};
      padding-bottom: ${vars.paddingSmall};
      border-bottom: 1px solid ${vars.borderColor};
    }
    #${MODAL_ID} .pt-wb-batch-edit-header h2 {
      margin: 0 0 8px 0;
      font-size: ${vars.fontSizeLarge};
      font-weight: 700;
    }
    #${MODAL_ID} .pt-wb-batch-edit-subtitle {
      display: flex;
      justify-content: center;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      color: ${vars.tipColor};
      font-size: ${vars.fontSizeMedium};
    }
    #${MODAL_ID} .pt-wb-batch-edit-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    #${MODAL_ID} .pt-wb-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    #${MODAL_ID} .pt-wb-row label {
      font-weight: 600;
      color: ${vars.textColor};
    }
    #${MODAL_ID} input,
    #${MODAL_ID} select,
    #${MODAL_ID} textarea {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid ${vars.inputBorder};
      border-radius: 8px;
      background: ${vars.inputBg};
      color: ${vars.textColor};
      outline: none;
    }
    #${MODAL_ID} textarea {
      resize: vertical;
      min-height: 120px;
      line-height: 1.4;
    }
    #${MODAL_ID} .pt-wb-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    @media (max-width: 520px) {
      #${MODAL_ID} .pt-wb-grid {
        grid-template-columns: 1fr;
      }
    }
    #${MODAL_ID} .pt-wb-hint {
      color: ${vars.tipColor};
      font-size: ${vars.fontSizeSmall};
      line-height: 1.4;
    }
    #${MODAL_ID} .pt-wb-actions {
      display: flex;
      gap: 12px;
      justify-content: center;
      margin-top: ${vars.margin};
      flex-wrap: wrap;
    }
    #${MODAL_ID} .pt-wb-actions .pt-wb-action-btn {
      padding: ${vars.buttonPadding};
      border: none;
      border-radius: ${vars.buttonRadius};
      cursor: pointer;
      font-weight: 700;
      background: ${vars.accentMutedColor};
      color: ${vars.textColor};
      transition: opacity 0.2s ease, transform 0.2s ease;
      min-width: ${vars.isMobile ? '0' : '140px'};
      flex: ${vars.isMobile ? '1' : '0'};
    }
    #${MODAL_ID} .pt-wb-actions .pt-wb-action-btn:hover:not(:disabled) {
      opacity: 0.95;
      transform: translateY(-1px);
    }
    #${MODAL_ID} .pt-wb-actions .pt-wb-action-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
    #${MODAL_ID} .pt-wb-actions .pt-wb-action-primary {
      background: ${vars.accentColor};
    }
  `;
}

export function openWorldbookBatchEditModal(apiInfo, worldbookName, selectedEntries) {
  const $ = getJQuery();
  ensureViewportCssVars();

  const name = String(worldbookName ?? '').trim();
  const entries = Array.isArray(selectedEntries) ? selectedEntries : [];
  const uids = entries.map(getUidFromTransferEntry).filter((v) => Number.isFinite(v));

  if (!name) {
    alert('请先选择世界书');
    return;
  }
  if (!apiInfo) {
    alert('无法获取API信息');
    return;
  }
  if (uids.length < 1) {
    alert('请选择要编辑的条目');
    return;
  }

  removeExisting();
  $('head').append(`<style id="${STYLE_ID}">${renderStyles()}</style>`);

  const modalHtml = `
    <div id="${MODAL_ID}" class="pt-wb-batch-edit-modal" tabindex="-1">
      <div class="pt-wb-batch-edit-content">
        <div class="pt-wb-batch-edit-header">
          <h2>批量编辑世界书条目</h2>
          <div class="pt-wb-batch-edit-subtitle">
            <span>世界书: ${escapeHtml(name)}</span>
            <span>已选: ${uids.length}</span>
          </div>
        </div>

        <div class="pt-wb-batch-edit-form">
          <div class="pt-wb-row">
            <label for="pt-wb-batch-trigger-mode">触发策略</label>
            <select id="pt-wb-batch-trigger-mode">
              <option value="">不修改</option>
              <option value="keywords">关键词</option>
              <option value="constant">常驻</option>
            </select>
          </div>

          <div class="pt-wb-row">
            <label for="pt-wb-batch-enabled">启用状态</label>
            <select id="pt-wb-batch-enabled">
              <option value="">不修改</option>
              <option value="true">启用</option>
              <option value="false">禁用</option>
            </select>
          </div>

          <div class="pt-wb-grid">
            <div class="pt-wb-row">
              <label for="pt-wb-batch-depth">深度</label>
              <input id="pt-wb-batch-depth" type="number" inputmode="numeric" placeholder="不修改">
            </div>
            <div class="pt-wb-row">
              <label for="pt-wb-batch-order">顺序</label>
              <input id="pt-wb-batch-order" type="number" inputmode="numeric" placeholder="不修改">
            </div>
          </div>

          <div class="pt-wb-row">
            <label for="pt-wb-batch-key">触发关键词（覆盖）</label>
            <textarea id="pt-wb-batch-key" placeholder="每行一个关键词（或用逗号/分号分隔）&#10;填写后会覆盖原有 key；仅对关键词触发条目生效"></textarea>
            <div class="pt-wb-hint">提示：若条目为“常驻”，不会修改其关键词。</div>
          </div>
        </div>

        <div class="pt-wb-actions">
          <button type="button" class="pt-wb-action-btn pt-wb-action-primary" id="pt-wb-batch-apply">应用</button>
          <button type="button" class="pt-wb-action-btn" id="pt-wb-batch-cancel">取消</button>
        </div>
      </div>
    </div>
  `;

  $('body').append(modalHtml);
  const $modal = $(`#${MODAL_ID}`);
  $modal.focus();

  const closeModal = () => removeExisting();

  $('#pt-wb-batch-cancel').on('click', closeModal);
  $modal.on('click', function (e) {
    if (e.target === this) closeModal();
  });

  $(document)
    .off('keydown.pt-wb-batch-edit')
    .on('keydown.pt-wb-batch-edit', function (e) {
      if (e.key === 'Escape') closeModal();
    });

  $('#pt-wb-batch-apply').on('click', async function () {
    const $btn = $(this);
    const originalText = $btn.text();
    $btn.prop('disabled', true).text('应用中...');

    try {
      const triggerMode = String($('#pt-wb-batch-trigger-mode').val() ?? '').trim();
      const enabledRaw = String($('#pt-wb-batch-enabled').val() ?? '').trim();
      const enabled = enabledRaw === '' ? null : enabledRaw === 'true';

      const depthRaw = String($('#pt-wb-batch-depth').val() ?? '').trim();
      const depth = depthRaw === '' ? null : Number(depthRaw);

      const orderRaw = String($('#pt-wb-batch-order').val() ?? '').trim();
      const order = orderRaw === '' ? null : Number(orderRaw);

      const keywords = normalizeArrayInput($('#pt-wb-batch-key').val());
      const hasKeywords = keywords.length > 0;

      const data = await loadWorldbook(name);
      if (!data.entries || typeof data.entries !== 'object') data.entries = {};

      let updatedCount = 0;
      let skippedKeywordCount = 0;

      for (const uid of uids) {
        const key = String(uid);
        const target = data.entries[key];
        if (!target || typeof target !== 'object') continue;

        if (enabled !== null) {
          target.disable = !enabled;
        }

        let constantOverride = null;
        if (triggerMode === 'constant') constantOverride = true;
        else if (triggerMode === 'keywords') constantOverride = false;

        if (constantOverride !== null) {
          target.constant = constantOverride;
        }

        if (depth !== null && Number.isFinite(depth)) {
          target.depth = depth;
        }

        if (order !== null && Number.isFinite(order)) {
          target.order = order;
        }

        if (hasKeywords) {
          const isConstantNow = constantOverride !== null ? constantOverride : !!target.constant;
          if (!isConstantNow) {
            target.key = keywords.slice();
          } else {
            skippedKeywordCount += 1;
          }
        }

        updatedCount += 1;
      }

      await saveWorldbook(name, data);
      closeModal();
      await loadAndDisplayEntries(apiInfo);

      const msg = skippedKeywordCount
        ? `已批量更新 ${updatedCount} 个条目（其中 ${skippedKeywordCount} 个常驻条目未修改关键词）`
        : `已批量更新 ${updatedCount} 个条目`;
      if (window.toastr) toastr.success(msg);
      else alert(msg);
    } catch (error) {
      console.error('批量编辑世界书条目失败:', error);
      const msg = '批量编辑失败: ' + (error?.message ?? error);
      if (window.toastr) toastr.error(msg);
      else alert(msg);
    } finally {
      $btn.prop('disabled', false).text(originalText);
    }
  });
}

