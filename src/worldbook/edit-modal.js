import { ensureViewportCssVars, getDeviceInfo, getJQuery, escapeHtml } from '../core/utils.js';
import { loadAndDisplayEntries } from '../display/entry-display.js';
import { CommonStyles } from '../styles/common-styles.js';
import { initWorldbookEntryAIAssistant } from './entry-ai-assistant.js';

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

function formatArrayValue(value) {
  if (!Array.isArray(value)) return '';
  return value.map(v => String(v ?? '').trim()).filter(Boolean).join('\n');
}

function createWorldbookEditEntryModal(apiInfo, worldbookName, entry) {
  const $ = getJQuery();
  const { isMobile, isSmallScreen } = getDeviceInfo();
  ensureViewportCssVars();

  $('#pt-worldbook-edit-modal').remove();
  $('#pt-worldbook-edit-modal-styles').remove();

  const uid = entry?.raw?.uid ?? Number(entry?.identifier);
  if (!Number.isFinite(uid)) {
    alert('无法识别世界书条目的 UID，无法编辑');
    return;
  }

  const raw = entry?.raw ?? {};
  const entryDisplayName = String(raw.comment ?? entry?.name ?? '').trim() || '未命名条目';
  const vars = CommonStyles.getVars();

  const modalHtml = `
    <div id="pt-worldbook-edit-modal">
      <div class="pt-wi-edit-content">
        <div class="pt-wi-edit-header">
          <h2>编辑世界书条目</h2>
          <div class="pt-wi-subtitle">
            <span>世界书: ${escapeHtml(String(worldbookName ?? ''))}</span>
            <span>UID: ${uid}</span>
          </div>
        </div>

        <div class="pt-wi-top-row">
          <div class="pt-wi-current-entry">
            <div class="pt-wi-current-label">当前世界书条目</div>
            <div class="pt-wi-current-value" title="${escapeHtml(entryDisplayName)}">${escapeHtml(entryDisplayName)}</div>
          </div>
          <label class="pt-wi-toggle">
            <span>启用</span>
            <input type="checkbox" id="pt-wi-enabled" ${raw.disable ? '' : 'checked'}>
          </label>
        </div>

        <div class="pt-wi-edit-form">
          <div class="pt-wi-row">
            <label class="pt-wi-label">触发策略</label>
            <div class="pt-wi-inline">
              <select id="pt-wi-trigger-mode" title="选择条目的触发方式">
                <option value="keywords" ${raw.constant ? '' : 'selected'}>关键词</option>
                <option value="constant" ${raw.constant ? 'selected' : ''}>常驻</option>
              </select>
              <select id="pt-wi-selective-logic" title="当存在次关键词(keysecondary)时的匹配逻辑；常驻时无效">
                <option value="0" ${Number(raw.selectiveLogic ?? 0) === 0 ? 'selected' : ''} title="AND_ANY">与任意</option>
                <option value="3" ${Number(raw.selectiveLogic ?? 0) === 3 ? 'selected' : ''} title="AND_ALL">与所有</option>
                <option value="1" ${Number(raw.selectiveLogic ?? 0) === 1 ? 'selected' : ''} title="NOT_ALL">非所有</option>
                <option value="2" ${Number(raw.selectiveLogic ?? 0) === 2 ? 'selected' : ''} title="NOT_ANY">非任意</option>
              </select>
              <span class="pt-wi-hint" title="没有填写次关键词(keysecondary)时，这个选项不会影响触发">次关键词为空时无效</span>
            </div>
          </div>

          <div class="pt-wi-row">
            <label class="pt-wi-label" for="pt-wi-comment">标题/注释</label>
            <input type="text" id="pt-wi-comment" value="${escapeHtml(String(raw.comment ?? entry?.name ?? ''))}" placeholder="用于显示/判重的注释...">
          </div>

          <div class="pt-wi-row">
            <label class="pt-wi-label" for="pt-wi-key">主关键词 (key)</label>
            <textarea id="pt-wi-key" rows="3" placeholder="每行一个关键词，或用逗号分隔">${escapeHtml(formatArrayValue(raw.key))}</textarea>
          </div>

          <div class="pt-wi-row">
            <label class="pt-wi-label" for="pt-wi-keysecondary">次关键词 (keysecondary)</label>
            <textarea id="pt-wi-keysecondary" rows="3" placeholder="每行一个关键词，或用逗号分隔">${escapeHtml(formatArrayValue(raw.keysecondary))}</textarea>
          </div>

          <div class="pt-wi-row">
            <label class="pt-wi-label" for="pt-wi-content">内容</label>
            <textarea id="pt-wi-content" rows="${isMobile ? 10 : 12}" placeholder="世界书条目内容...">${escapeHtml(String(raw.content ?? entry?.content ?? ''))}</textarea>
          </div>

          <div class="pt-wi-row pt-wi-ai-assistant">
            <label class="pt-wi-label">AI 辅助</label>
            <div class="pt-wi-ai-controls">
              <select id="pt-wi-ai-style-entry-selector" title="选择一个世界书条目作为风格参考">
                <option value="">使用当前条目作为参考</option>
              </select>
              <textarea id="pt-wi-ai-additional-prompt" rows="3" placeholder="（可选）输入附加提示词，如“保留某些关键句”、“更精简/更详细”..."></textarea>
              <div class="pt-wi-ai-buttons">
                <button id="pt-wi-ai-convert-btn" type="button" class="pt-wi-ai-btn" disabled>格式转换</button>
                <button id="pt-wi-ai-create-btn" type="button" class="pt-wi-ai-btn" disabled>辅助创作</button>
              </div>
            </div>
          </div>

          <div class="pt-wi-grid">
            <div class="pt-wi-row">
              <label class="pt-wi-label" for="pt-wi-position">插入位置</label>
              <select id="pt-wi-position">
                <option value="0" ${Number(raw.position ?? 0) === 0 ? 'selected' : ''}>角色定义之前</option>
                <option value="1" ${Number(raw.position ?? 0) === 1 ? 'selected' : ''}>角色定义之后</option>
                <option value="2" ${Number(raw.position ?? 0) === 2 ? 'selected' : ''}>作者注释之前</option>
                <option value="3" ${Number(raw.position ?? 0) === 3 ? 'selected' : ''}>作者注释之后</option>
                <option value="5" ${Number(raw.position ?? 0) === 5 ? 'selected' : ''}>↑EM</option>
                <option value="6" ${Number(raw.position ?? 0) === 6 ? 'selected' : ''}>↓EM</option>
                <option value="4" ${Number(raw.position ?? 0) === 4 ? 'selected' : ''}>@D (按深度)</option>
              </select>
            </div>

            <div class="pt-wi-row">
              <label class="pt-wi-label" for="pt-wi-order">顺序 (order)</label>
              <input type="number" id="pt-wi-order" value="${escapeHtml(String(raw.order ?? 100))}" step="1">
            </div>

            <div class="pt-wi-row">
              <label class="pt-wi-label" for="pt-wi-depth">深度 (depth)</label>
              <input type="number" id="pt-wi-depth" value="${escapeHtml(String(raw.depth ?? 4))}" step="1">
            </div>
          </div>
        </div>

        <div class="pt-wi-edit-actions">
          <button id="pt-wi-save" class="pt-wi-action-btn pt-wi-action-primary">保存</button>
          <button id="pt-wi-cancel" class="pt-wi-action-btn">取消</button>
        </div>
      </div>
    </div>
  `;

  $('body').append(modalHtml);

  const styles = `
    #pt-worldbook-edit-modal {
      --pt-font-size: ${vars.fontSize};
      ${CommonStyles.getModalBaseStyles()}
      align-items: ${vars.isMobile ? 'flex-start' : 'center'};
      ${vars.isMobile ? 'padding-top: 20px;' : ''}
    }

    #pt-worldbook-edit-modal,
    #pt-worldbook-edit-modal * {
      font-size: var(--pt-font-size);
    }

    #pt-worldbook-edit-modal .pt-wi-edit-content {
      ${CommonStyles.getModalContentStyles()}
      max-width: ${isSmallScreen ? '95vw' : vars.isMobile ? '90vw' : vars.maxWidth};
      width: ${isSmallScreen ? '95vw' : vars.isMobile ? '90vw' : '90%'};
      max-height: ${vars.isMobile ? '90vh' : '85vh'};
      max-height: ${vars.isMobile ? '90dvh' : '85dvh'};
      max-height: ${vars.isMobile ? 'calc(var(--pt-vh, 1vh) * 90)' : 'calc(var(--pt-vh, 1vh) * 85)'};
      overflow-y: auto;
      animation: pt-slideUp 0.3s ease-out;
      transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease;
    }

    #pt-worldbook-edit-modal .pt-wi-edit-header {
      text-align: center;
      margin-bottom: ${vars.margin};
      padding-bottom: ${vars.paddingSmall};
      border-bottom: 1px solid ${vars.borderColor};
    }

    #pt-worldbook-edit-modal .pt-wi-edit-header h2 {
      margin: 0;
      font-weight: 800;
      letter-spacing: -0.5px;
      font-size: ${vars.isMobile ? 'calc(var(--pt-font-size) * 1.25)' : 'calc(var(--pt-font-size) * 1.4)'};
    }

    #pt-worldbook-edit-modal .pt-wi-subtitle {
      color: ${vars.tipColor};
      font-size: ${vars.fontSizeMedium};
      margin-top: 8px;
      font-weight: 600;
      display: flex;
      gap: 12px;
      justify-content: center;
      align-items: baseline;
      flex-wrap: wrap;
    }

    #pt-worldbook-edit-modal .pt-wi-top-row {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      gap: ${vars.gap};
      padding: ${vars.paddingSmall};
      border-radius: ${vars.borderRadiusSmall};
      border: 1px solid ${vars.borderColor};
      background: ${vars.sectionBg};
      margin-bottom: ${vars.margin};
    }

    #pt-worldbook-edit-modal .pt-wi-current-entry {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1 1 auto;
    }

    #pt-worldbook-edit-modal .pt-wi-current-label {
      font-size: ${vars.fontSizeSmall};
      font-weight: 700;
      color: ${vars.tipColor};
    }

    #pt-worldbook-edit-modal .pt-wi-current-value {
      font-weight: 800;
      color: ${vars.textColor};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: ${isSmallScreen ? '100%' : vars.isMobile ? '52vw' : '60vw'};
    }

    #pt-worldbook-edit-modal .pt-wi-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: flex-start;
      gap: 8px;
      font-weight: 800;
      color: ${vars.textColor};
      white-space: nowrap;
      flex: 0 0 auto;
    }

    #pt-worldbook-edit-modal .pt-wi-toggle input {
      transform: scale(1.15);
      margin: 0;
    }

    #pt-worldbook-edit-modal .pt-wi-edit-form {
      display: flex;
      flex-direction: column;
      gap: ${vars.gap};
    }

    #pt-worldbook-edit-modal .pt-wi-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    #pt-worldbook-edit-modal .pt-wi-label {
      font-weight: 700;
      color: ${vars.textColor};
    }

    #pt-worldbook-edit-modal input[type="text"],
    #pt-worldbook-edit-modal input[type="number"],
    #pt-worldbook-edit-modal select,
    #pt-worldbook-edit-modal textarea {
      padding: ${vars.paddingSmall};
      border-radius: ${vars.borderRadiusSmall};
      border: 1px solid ${vars.inputBorder};
      background: ${vars.inputBg};
      color: ${vars.textColor};
      box-sizing: border-box;
      width: 100%;
    }

    #pt-worldbook-edit-modal input::placeholder,
    #pt-worldbook-edit-modal textarea::placeholder {
      font-size: inherit !important;
    }

    #pt-worldbook-edit-modal textarea {
      resize: vertical;
      min-height: 80px;
      white-space: pre-wrap;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      line-height: 1.5;
    }

    #pt-worldbook-edit-modal .pt-wi-ai-assistant {
      padding: ${vars.paddingSmall};
      background: ${vars.sectionBg};
      border: 1px solid ${vars.borderColor};
      border-radius: ${vars.borderRadiusSmall};
    }

    #pt-worldbook-edit-modal .pt-wi-ai-controls {
      display: flex;
      flex-direction: column;
      gap: ${vars.gap};
      margin-top: 6px;
    }

    #pt-worldbook-edit-modal .pt-wi-ai-buttons {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: ${vars.gap};
    }

    #pt-worldbook-edit-modal .pt-wi-ai-btn {
      background-color: ${vars.sectionBg};
      border: 1px solid ${vars.borderColor};
      padding: ${vars.buttonPaddingSmall};
      border-radius: ${vars.buttonRadius};
      cursor: pointer;
      font-weight: 700;
      color: ${vars.textColor};
      transition: opacity 0.2s ease, transform 0.2s ease;
      min-height: ${vars.isMobile ? '40px' : '44px'};
    }

    #pt-worldbook-edit-modal .pt-wi-ai-btn:hover:not(:disabled) {
      opacity: 0.95;
      transform: translateY(-1px);
    }

    #pt-worldbook-edit-modal .pt-wi-ai-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    #pt-worldbook-edit-modal .pt-wi-inline {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }

    #pt-worldbook-edit-modal .pt-wi-inline-check {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      color: ${vars.textColor};
    }

    #pt-worldbook-edit-modal .pt-wi-hint {
      font-weight: 600;
      color: ${vars.tipColor};
      white-space: nowrap;
    }

    #pt-worldbook-edit-modal .pt-wi-grid {
      display: grid;
      grid-template-columns: ${vars.isMobile ? '1fr' : '1fr 1fr'};
      gap: ${vars.gap};
    }

    #pt-worldbook-edit-modal .pt-wi-edit-actions {
      display: flex;
      flex-direction: row;
      flex-wrap: nowrap;
      align-items: center;
      gap: ${vars.gap};
      justify-content: center;
      margin-top: ${vars.margin};
      padding-top: ${vars.paddingSmall};
      border-top: 1px solid ${vars.borderColor};
    }

    #pt-worldbook-edit-modal .pt-wi-edit-actions .pt-wi-action-btn {
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

    #pt-worldbook-edit-modal .pt-wi-edit-actions .pt-wi-action-btn:hover:not(:disabled) {
      opacity: 0.95;
      transform: translateY(-1px);
    }

    #pt-worldbook-edit-modal .pt-wi-edit-actions .pt-wi-action-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    #pt-worldbook-edit-modal .pt-wi-edit-actions .pt-wi-action-primary {
      background: ${vars.accentColor};
    }
  `;

  $('head').append(`<style id="pt-worldbook-edit-modal-styles">${styles}</style>`);

  initWorldbookEntryAIAssistant(apiInfo, worldbookName);

  $('#pt-wi-comment').on('input', function () {
    const nextName = String($(this).val() ?? '').trim() || '未命名条目';
    $('#pt-worldbook-edit-modal .pt-wi-current-value').text(nextName).attr('title', nextName);
  });

  const updatePositionDependentFields = () => {
    const position = Number($('#pt-wi-position').val());
    const atDepth = position === 4;
    $('#pt-wi-depth').prop('disabled', !atDepth);
  };
  $('#pt-wi-position').on('change', updatePositionDependentFields);
  updatePositionDependentFields();

  const updateSelectiveLogicAvailability = () => {
    const isConstant = String($('#pt-wi-trigger-mode').val() ?? '') === 'constant';
    const hasSecondary = normalizeArrayInput($('#pt-wi-keysecondary').val()).length > 0;
    $('#pt-wi-selective-logic').prop('disabled', isConstant || !hasSecondary);
    $('#pt-wi-key, #pt-wi-keysecondary').prop('disabled', isConstant);
  };
  $('#pt-wi-trigger-mode').on('change', updateSelectiveLogicAvailability);
  $('#pt-wi-keysecondary').on('input', updateSelectiveLogicAvailability);
  updateSelectiveLogicAvailability();

  const closeModal = () => {
    $('#pt-worldbook-edit-modal').remove();
    $('#pt-worldbook-edit-modal-styles').remove();
    $(document).off('keydown.pt-worldbook-edit');
  };

  $('#pt-wi-cancel').on('click', closeModal);
  $('#pt-worldbook-edit-modal').on('click', function (e) {
    if (e.target === this) {
      closeModal();
    }
  });

  $(document).on('keydown.pt-worldbook-edit', function (e) {
    if (e.key === 'Escape') {
      closeModal();
    }
  });

  $('#pt-wi-save').on('click', async function () {
    const $btn = $(this);
    const originalText = $btn.text();
    $btn.prop('disabled', true).text('保存中...');

    try {
      const data = await loadWorldbook(worldbookName);
      if (!data.entries || typeof data.entries !== 'object') {
        data.entries = {};
      }

      const target = data.entries[String(uid)];
      if (!target) {
        throw new Error(`未找到 UID=${uid} 的条目`);
      }

      const enabled = $('#pt-wi-enabled').is(':checked');
      const constant = String($('#pt-wi-trigger-mode').val() ?? '') === 'constant';
      const selectiveLogic = Number($('#pt-wi-selective-logic').val());

      target.disable = !enabled;
      target.constant = constant;
      target.selective = true;
      if (Number.isFinite(selectiveLogic)) {
        target.selectiveLogic = selectiveLogic;
      }

      target.comment = String($('#pt-wi-comment').val() ?? '');
      target.key = normalizeArrayInput($('#pt-wi-key').val());
      target.keysecondary = normalizeArrayInput($('#pt-wi-keysecondary').val());
      target.content = String($('#pt-wi-content').val() ?? '');

      const position = Number($('#pt-wi-position').val());
      const order = Number($('#pt-wi-order').val());
      const depth = Number($('#pt-wi-depth').val());
      const atDepth = position === 4;

      if (Number.isFinite(position)) target.position = position;
      if (Number.isFinite(order)) target.order = order;
      if (Number.isFinite(depth)) target.depth = depth;

      if (atDepth) {
        const fallbackRole = Number.isFinite(Number(raw.role)) ? Number(raw.role) : 0;
        const existingRole = Number.isFinite(Number(target.role)) ? Number(target.role) : fallbackRole;
        target.role = existingRole;
      } else {
        target.role = null;
      }

      await saveWorldbook(worldbookName, data);
      closeModal();
      await loadAndDisplayEntries(apiInfo);
    } catch (error) {
      console.error('保存世界书条目失败:', error);
      alert('保存失败: ' + error.message);
    } finally {
      $btn.prop('disabled', false).text(originalText);
    }
  });
}

export { createWorldbookEditEntryModal };
