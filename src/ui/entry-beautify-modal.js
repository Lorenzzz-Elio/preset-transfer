import { getJQuery, escapeAttr, escapeHtml, getParentWindow } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';
import { PT } from '../core/api-compat.js';
import { closeIcon } from './icons.js';
import {
  BEAUTIFY_SCRIPT_TYPES,
  BEAUTIFY_SCRIPT_TYPE_LABELS,
  buildBeautifyPreviewDocument,
  generateBeautifyRegex,
  getAllRegexScriptsForReference,
  normalizeBeautifyReplaceString,
  previewRegexReplace,
  saveBeautifyRegexScript,
} from '../features/entry-beautify.js';

const MODAL_ID = 'pt-entry-beautify-modal';
const beautifySessions = new Map();
let generationSequence = 0;

function notify(type, message) {
  const parentWindow = getParentWindow();
  if (parentWindow.toastr?.[type]) {
    parentWindow.toastr[type](message);
    return;
  }

  parentWindow.alert?.(message);
}

function resolveCurrentPresetName() {
  try {
    return PT.API.getLoadedPresetName?.() ?? null;
  } catch {
    return null;
  }
}

function getModal() {
  const $ = getJQuery();
  return $(`#${MODAL_ID}`);
}

function getSession(identifier) {
  return beautifySessions.get(String(identifier ?? '')) ?? null;
}

function upsertSession(session) {
  if (!session?.identifier) {
    throw new Error('Missing beautify session identifier.');
  }

  beautifySessions.set(String(session.identifier), session);
  return session;
}

function ensureSession({
  identifier,
  apiInfo,
  entryName,
  entryContent,
  allScripts,
}) {
  const key = String(identifier ?? '');
  const existing = beautifySessions.get(key);

  const session = existing ?? {
    identifier: key,
    apiInfo: null,
    entryName: '',
    entryContent: '',
    allScripts: [],
    referenceIndex: '',
    userPrompt: '',
    revisionPrompt: '',
    sampleText: '',
    targetType: BEAUTIFY_SCRIPT_TYPES.PRESET,
    result: null,
    isGenerating: false,
    activeRequestId: 0,
    activeGenerationMode: 'create',
  };

  session.apiInfo = apiInfo ?? session.apiInfo;
  session.entryName = entryName ?? session.entryName;
  session.entryContent = entryContent ?? session.entryContent;
  session.allScripts = Array.isArray(allScripts) ? allScripts : session.allScripts;

  return upsertSession(session);
}

function buildResultObject(baseResult = {}, overrides = {}) {
  const base = baseResult && typeof baseResult === 'object' ? baseResult : {};
  const next = overrides && typeof overrides === 'object' ? overrides : {};

  return {
    id: String(next.id ?? base.id ?? ''),
    scriptName: String(next.scriptName ?? base.scriptName ?? ''),
    findRegex: String(next.findRegex ?? base.findRegex ?? ''),
    replaceString: String(next.replaceString ?? base.replaceString ?? ''),
    trimStrings: Array.isArray(next.trimStrings ?? base.trimStrings)
      ? next.trimStrings ?? base.trimStrings
      : [],
    placement: Array.isArray(next.placement ?? base.placement)
      ? next.placement ?? base.placement
      : [2],
    disabled: Boolean(next.disabled ?? base.disabled ?? false),
    markdownOnly: Boolean(next.markdownOnly ?? base.markdownOnly ?? true),
    promptOnly: Boolean(next.promptOnly ?? base.promptOnly ?? false),
    runOnEdit: Boolean(next.runOnEdit ?? base.runOnEdit ?? false),
    substituteRegex: Number(next.substituteRegex ?? base.substituteRegex ?? 0),
    minDepth: next.minDepth ?? base.minDepth ?? null,
    maxDepth: next.maxDepth ?? base.maxDepth ?? null,
  };
}

function getReferenceScriptFromSession(session) {
  if (!session) return null;

  const refIndex = String(session.referenceIndex ?? '');
  if (refIndex === '') return null;

  return session.allScripts?.[Number(refIndex)]?.script ?? null;
}

function syncSessionFromModal(modal = getModal()) {
  if (!modal?.length) return null;

  const identifier = String(modal.attr('data-pt-identifier') ?? '');
  const session = getSession(identifier);
  if (!session) return null;

  session.referenceIndex = String(modal.find('#pt-beautify-ref-select').val() ?? '');
  session.userPrompt = String(modal.find('#pt-beautify-user-prompt').val() ?? '');
  session.revisionPrompt = String(modal.find('#pt-beautify-revision-prompt').val() ?? '');
  session.sampleText = String(modal.find('#pt-beautify-sample-text').val() ?? '');
  session.targetType = Number(modal.find('#pt-beautify-target-type').val() ?? BEAUTIFY_SCRIPT_TYPES.PRESET);

  const scriptName = String(modal.find('#pt-beautify-script-name').val() ?? '').trim();
  const findRegex = String(modal.find('#pt-beautify-find-regex').val() ?? '').trim();
  const replaceString = String(modal.find('#pt-beautify-replace-string').val() ?? '');
  const hasResult = Boolean(session.result) || Boolean(scriptName || findRegex || replaceString);

  session.result = hasResult
    ? buildResultObject(session.result, {
        scriptName,
        findRegex,
        replaceString,
      })
    : null;

  return upsertSession(session);
}

function closeBeautifyModal() {
  const modal = getModal();
  if (modal.length) {
    syncSessionFromModal(modal);
    modal.remove();
  }
}

function resolvePreviewOutput(findRegex, replaceString, sampleText) {
  const normalizedReplaceString = normalizeBeautifyReplaceString(replaceString);
  const normalizedSampleText = String(sampleText ?? '');

  if (!normalizedSampleText.trim() || !String(findRegex ?? '').trim()) {
    return normalizedReplaceString;
  }

  return previewRegexReplace(findRegex, normalizedReplaceString, normalizedSampleText);
}

function updatePreview(modal = getModal()) {
  if (!modal?.length) return;

  const findRegex = String(modal.find('#pt-beautify-find-regex').val() ?? '');
  const replaceString = String(modal.find('#pt-beautify-replace-string').val() ?? '');
  const sampleText = String(modal.find('#pt-beautify-sample-text').val() ?? '');
  const output = resolvePreviewOutput(findRegex, replaceString, sampleText);

  const iframe = modal.find('#pt-beautify-preview-render')[0];
  if (iframe) {
    iframe.srcdoc = buildBeautifyPreviewDocument(output);
  }
}

function updateModalState(modal = getModal(), session = null) {
  if (!modal?.length) return;

  const identifier = String(modal.attr('data-pt-identifier') ?? '');
  const currentSession = session ?? getSession(identifier);
  if (!currentSession) return;

  const hasResult = Boolean(currentSession.result);
  const isGenerating = Boolean(currentSession.isGenerating);
  const generationLabel =
    currentSession.activeGenerationMode === 'revise'
      ? 'AI 正在根据修改意见继续调整，可直接关闭弹窗，完成后会提醒你。'
      : currentSession.activeGenerationMode === 'variant'
        ? 'AI 正在后台重新生成一版，可直接关闭弹窗，完成后会提醒你。'
        : 'AI 正在后台生成正则，可直接关闭弹窗，完成后会提醒你。';

  const idleLabel = hasResult
    ? '可以直接编辑当前代码，也可以填写修改意见继续让 AI 沿着当前版本调整。'
    : '生成时可以直接关闭弹窗，后台完成后会弹出提醒。';

  modal.find('#pt-beautify-ref-select').val(String(currentSession.referenceIndex ?? ''));
  modal.find('#pt-beautify-user-prompt').val(String(currentSession.userPrompt ?? ''));
  modal.find('#pt-beautify-revision-prompt').val(String(currentSession.revisionPrompt ?? ''));
  modal.find('#pt-beautify-sample-text').val(String(currentSession.sampleText ?? ''));
  modal.find('#pt-beautify-target-type').val(String(currentSession.targetType ?? BEAUTIFY_SCRIPT_TYPES.PRESET));

  if (currentSession.result) {
    modal.find('#pt-beautify-script-name').val(String(currentSession.result.scriptName ?? ''));
    modal.find('#pt-beautify-find-regex').val(String(currentSession.result.findRegex ?? ''));
    modal.find('#pt-beautify-replace-string').val(String(currentSession.result.replaceString ?? ''));
  }

  modal.find('#pt-beautify-result-section').css('display', hasResult ? 'flex' : 'none');
  modal.find('#pt-beautify-status').text(isGenerating ? generationLabel : idleLabel);
  modal.find('#pt-beautify-generate').prop('disabled', isGenerating);
  modal.find('#pt-beautify-regenerate').prop('disabled', isGenerating || !hasResult);
  modal.find('#pt-beautify-revise').prop('disabled', isGenerating || !hasResult);
  modal.find('#pt-beautify-save').prop('disabled', isGenerating || !hasResult);
  modal.find('#pt-beautify-generate-text').text(
    isGenerating && currentSession.activeGenerationMode === 'create' ? '后台生成中...' : 'AI 生成正则',
  );

  updatePreview(modal);
}

function notifyBackgroundCompletion(session, generationMode) {
  const parentWindow = getParentWindow();
  const actionLabel =
    generationMode === 'revise'
      ? '根据修改意见更新的正则'
      : generationMode === 'variant'
        ? '重新生成的新版本正则'
        : 'AI 生成的正则';

  if (parentWindow.toastr?.success) {
    parentWindow.toastr.success(`“${session.entryName}”的${actionLabel}已完成。`);
  }

  const message = `“${session.entryName}”的${actionLabel}已完成。是否现在打开结果窗口继续查看和修改？`;

  if (typeof parentWindow.confirm === 'function') {
    const shouldOpen = parentWindow.confirm(message);
    if (shouldOpen) {
      void openBeautifyModal(session.identifier, session.apiInfo);
    }
    return;
  }

  parentWindow.alert?.(message);
  if (session.apiInfo) {
    void openBeautifyModal(session.identifier, session.apiInfo);
  }
}

async function runBeautifyGeneration(identifier, generationMode) {
  const session = getSession(identifier);
  if (!session) {
    throw new Error('未找到美化正则会话。');
  }

  if (session.isGenerating) {
    return;
  }

  const requestId = ++generationSequence;
  session.isGenerating = true;
  session.activeRequestId = requestId;
  session.activeGenerationMode = generationMode;
  upsertSession(session);
  updateModalState();

  try {
    const result = await generateBeautifyRegex({
      entryName: session.entryName,
      entryContent: session.entryContent,
      referenceScript: getReferenceScriptFromSession(session),
      userPrompt: session.userPrompt,
      existingScript: generationMode === 'create' ? null : session.result,
      revisionPrompt: generationMode === 'revise' ? session.revisionPrompt : '',
      generationMode,
    });

    const latestSession = getSession(identifier);
    if (!latestSession || latestSession.activeRequestId !== requestId) {
      return;
    }

    latestSession.isGenerating = false;
    latestSession.result = buildResultObject(latestSession.result, result);
    upsertSession(latestSession);

    const modal = getModal();
    if (modal.length && modal.attr('data-pt-identifier') === identifier) {
      updateModalState(modal, latestSession);
      notify(
        'success',
        generationMode === 'revise'
          ? '已根据修改意见更新当前正则。'
          : generationMode === 'variant'
            ? '已生成一版新的候选正则。'
            : '美化正则已生成。',
      );
    } else {
      notifyBackgroundCompletion(latestSession, generationMode);
    }
  } catch (error) {
    const latestSession = getSession(identifier);
    if (latestSession && latestSession.activeRequestId === requestId) {
      latestSession.isGenerating = false;
      upsertSession(latestSession);
    }

    updateModalState();
    console.error('[BeautifyModal] Failed to generate regex:', error);
    notify('error', `生成失败：${error.message}`);
  }
}

async function handleGenerateClick(mode) {
  const modal = getModal();
  if (!modal.length) return;

  const session = syncSessionFromModal(modal);
  if (!session) return;

  if (mode === 'revise' && !String(session.revisionPrompt ?? '').trim()) {
    notify('info', '请先输入修改意见，再继续修改当前结果。');
    return;
  }

  await runBeautifyGeneration(session.identifier, mode);
}

export async function openBeautifyModal(identifier, apiInfo) {
  const $ = getJQuery();
  if ($(`#${MODAL_ID}`).length) return;

  let entry = null;
  try {
    const { getPresetDataFromManager } = await import('../preset/preset-manager.js');
    const presetName = resolveCurrentPresetName();
    if (presetName) {
      const presetData = getPresetDataFromManager(apiInfo, presetName);
      entry = presetData?.prompts?.find((prompt) => prompt?.identifier === identifier) ?? null;
    }
  } catch (error) {
    console.warn('[BeautifyModal] Failed to load entry:', error);
  }

  let allScripts = [];
  try {
    allScripts = await getAllRegexScriptsForReference();
  } catch (error) {
    console.warn('[BeautifyModal] Failed to load reference scripts:', error);
  }

  const vars = CommonStyles.getVars();
  const entryName = entry?.name ?? identifier;
  const entryContent = entry?.content ?? '';
  const contentStyles = CommonStyles.getModalContentStyles({ maxWidth: vars.maxWidthLarge });
  const fieldFontSize = vars.fontSizeMedium;
  const fieldLineHeight = '1.45';

  const session = ensureSession({
    identifier,
    apiInfo,
    entryName,
    entryContent,
    allScripts,
  });

  const refOptions = allScripts
    .map((item, index) => {
      const label = `[${item.typeLabel}] ${escapeHtml(item.script?.scriptName ?? '未命名')}`;
      return `<option value="${index}">${label}</option>`;
    })
    .join('');

  const targetOptions = Object.entries(BEAUTIFY_SCRIPT_TYPE_LABELS)
    .map(([type, label]) => {
      const selected = Number(type) === Number(session.targetType ?? BEAUTIFY_SCRIPT_TYPES.PRESET) ? 'selected' : '';
      return `<option value="${type}" ${selected}>${label}</option>`;
    })
    .join('');

  const modal = $(`
    <div id="${MODAL_ID}" data-pt-identifier="${escapeAttr(String(identifier))}" style="${CommonStyles.getModalBaseStyles()}">
      <div style="${contentStyles}">
        <div style="display:flex; align-items:center; gap:${vars.gap}; margin-bottom:${vars.margin};">
          <span style="flex:1; font-size:${vars.fontSizeLarge}; font-weight:600;">制作美化正则</span>
          <button
            id="pt-beautify-close"
            class="menu_button"
            type="button"
            aria-label="关闭"
            style="
              display:inline-flex;
              align-items:center;
              justify-content:center;
              width:36px;
              height:36px;
              padding:0;
              border-radius:${vars.buttonRadius};
              flex:0 0 auto;
            "
            title="关闭">
            ${closeIcon(18)}
          </button>
        </div>

        <div style="display:flex; flex-direction:column; gap:${vars.gap};">
          <section style="display:flex; flex-direction:column; gap:calc(${vars.gap} / 2);">
            <div style="font-size:${vars.fontSizeSmall}; color:${vars.tipColor};">条目名称</div>
            <div
              style="
                background:${vars.inputBg};
                border:1px solid ${vars.inputBorder};
                border-radius:${vars.borderRadiusSmall};
                padding:${vars.paddingSmall};
                font-size:${vars.fontSizeMedium};
              ">
              ${escapeHtml(entryName)}
            </div>
          </section>

          <section style="display:flex; flex-direction:column; gap:calc(${vars.gap} / 2);">
            <div style="font-size:${vars.fontSizeSmall}; color:${vars.tipColor};">条目内容</div>
            <div
              style="
                background:${vars.inputBg};
                border:1px solid ${vars.inputBorder};
                border-radius:${vars.borderRadiusSmall};
                padding:${vars.paddingSmall};
                font-size:${vars.fontSizeSmall};
                max-height:calc(${vars.maxHeight} / 4);
                overflow-y:auto;
                white-space:pre-wrap;
                word-break:break-word;
              ">
              ${escapeHtml(entryContent)}
            </div>
          </section>

          <section style="display:flex; flex-direction:column; gap:calc(${vars.gap} / 2);">
            <label for="pt-beautify-ref-select" style="font-size:${vars.fontSizeSmall}; color:${vars.tipColor};">参考正则风格</label>
            <select
              id="pt-beautify-ref-select"
              class="text_pole"
              style="
                width:100%;
                min-height:42px;
                font-size:${fieldFontSize};
                line-height:${fieldLineHeight};
              ">
              <option value="">不使用参考正则</option>
              ${refOptions}
            </select>
          </section>

          <section style="display:flex; flex-direction:column; gap:calc(${vars.gap} / 2);">
            <label for="pt-beautify-user-prompt" style="font-size:${vars.fontSizeSmall}; color:${vars.tipColor};">附加要求</label>
            <textarea
              id="pt-beautify-user-prompt"
              class="text_pole"
              rows="4"
              placeholder="例如：卡片用偏冷色、包含标题区、正文支持多段文本。"
              style="
                width:100%;
                resize:vertical;
                min-height:120px;
                font-size:${fieldFontSize};
                line-height:${fieldLineHeight};
              "></textarea>
          </section>

          <div style="display:flex; gap:${vars.gap}; align-items:center; flex-wrap:wrap;">
            <button
              id="pt-beautify-generate"
              class="menu_button"
              type="button"
              style="flex:1; min-width:180px; padding:${vars.buttonPadding}; border-radius:${vars.buttonRadius};">
              <span id="pt-beautify-generate-text">AI 生成正则</span>
            </button>
          </div>

          <div
            id="pt-beautify-status"
            style="
              font-size:${vars.fontSizeSmall};
              color:${vars.tipColor};
              margin-top:calc(${vars.gap} / -3);
            "></div>

          <div
            id="pt-beautify-result-section"
            style="display:none; flex-direction:column; gap:${vars.gap}; margin-top:calc(${vars.gap} / 2);">
            <section style="display:flex; flex-direction:column; gap:calc(${vars.gap} / 2);">
              <label for="pt-beautify-script-name" style="font-size:${vars.fontSizeSmall}; color:${vars.tipColor};">脚本名称</label>
              <input id="pt-beautify-script-name" class="text_pole" type="text" style="width:100%;" />
            </section>

            <section style="display:flex; flex-direction:column; gap:calc(${vars.gap} / 2);">
              <label for="pt-beautify-find-regex" style="font-size:${vars.fontSizeSmall}; color:${vars.tipColor};">查找正则</label>
              <input
                id="pt-beautify-find-regex"
                class="text_pole"
                type="text"
                style="width:100%; font-family:monospace;" />
            </section>

            <section style="display:flex; flex-direction:column; gap:calc(${vars.gap} / 2);">
              <label for="pt-beautify-replace-string" style="font-size:${vars.fontSizeSmall}; color:${vars.tipColor};">替换串</label>
              <textarea
                id="pt-beautify-replace-string"
                class="text_pole"
                rows="10"
                style="width:100%; resize:vertical; font-family:monospace;"></textarea>
              <div style="font-size:${vars.fontSizeSmall}; color:${vars.tipColor};">
                保存时会自动规范为带 <code>\`\`\`html</code> 代码块且包含 <code>&lt;body&gt;</code> 与 <code>&lt;/body&gt;</code>。
              </div>
            </section>

            <section style="display:flex; flex-direction:column; gap:calc(${vars.gap} / 2);">
              <label for="pt-beautify-revision-prompt" style="font-size:${vars.fontSizeSmall}; color:${vars.tipColor};">修改意见</label>
              <textarea
                id="pt-beautify-revision-prompt"
                class="text_pole"
                rows="4"
                placeholder="例如：标题更紧凑，卡片边框更细，正文段落间距再大一点。"
                style="
                  width:100%;
                  resize:vertical;
                  min-height:100px;
                  font-size:${fieldFontSize};
                  line-height:${fieldLineHeight};
                "></textarea>
              <div style="display:flex; gap:${vars.gap}; flex-wrap:wrap;">
                <button
                  id="pt-beautify-revise"
                  class="menu_button"
                  type="button"
                  style="flex:1; min-width:180px; padding:${vars.buttonPaddingSmall}; border-radius:${vars.buttonRadius};">
                  按修改意见继续生成
                </button>
                <button
                  id="pt-beautify-regenerate"
                  class="menu_button"
                  type="button"
                  style="flex:1; min-width:180px; padding:${vars.buttonPaddingSmall}; border-radius:${vars.buttonRadius};">
                  重新生成一版
                </button>
              </div>
            </section>

            <section style="display:flex; flex-direction:column; gap:calc(${vars.gap} / 2);">
              <label for="pt-beautify-sample-text" style="font-size:${vars.fontSizeSmall}; color:${vars.tipColor};">示例文本</label>
              <textarea
                id="pt-beautify-sample-text"
                class="text_pole"
                rows="4"
                placeholder="可选。输入示例文本后会先跑替换，再展示最终结果；留空则直接预览当前替换串。"
                style="width:100%; resize:vertical;"></textarea>
            </section>

            <section style="display:grid; grid-template-columns:minmax(0, 1fr); gap:${vars.gap};">
              <div style="display:flex; flex-direction:column; gap:calc(${vars.gap} / 2);">
                <div style="font-size:${vars.fontSizeSmall}; color:${vars.tipColor};">实际渲染效果</div>
                <iframe
                  id="pt-beautify-preview-render"
                  sandbox="allow-scripts"
                  style="
                    width:100%;
                    min-height:280px;
                    border:1px solid ${vars.inputBorder};
                    border-radius:${vars.borderRadiusSmall};
                    background:transparent;
                  "></iframe>
              </div>
            </section>

            <div style="display:flex; gap:${vars.gap}; align-items:center; flex-wrap:wrap;">
              <select id="pt-beautify-target-type" class="text_pole" style="flex:1; min-width:200px;">
                ${targetOptions}
              </select>
              <button
                id="pt-beautify-save"
                class="menu_button"
                type="button"
                style="padding:${vars.buttonPaddingSmall}; border-radius:${vars.buttonRadius}; white-space:nowrap;">
                保存正则脚本
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `);

  $('body').append(modal);

  modal.find('#pt-beautify-close').on('click', closeBeautifyModal);
  modal.on('click', (event) => {
    if ($(event.target).is(`#${MODAL_ID}`)) {
      closeBeautifyModal();
    }
  });

  modal.on(
    'input',
    '#pt-beautify-find-regex, #pt-beautify-replace-string, #pt-beautify-sample-text',
    () => {
      syncSessionFromModal(modal);
      updatePreview(modal);
    },
  );

  modal.on('input', '#pt-beautify-ref-select, #pt-beautify-user-prompt, #pt-beautify-revision-prompt', () => {
    syncSessionFromModal(modal);
    updateModalState(modal);
  });

  modal.on('change', '#pt-beautify-ref-select, #pt-beautify-target-type', () => {
    syncSessionFromModal(modal);
    updateModalState(modal);
  });

  modal.find('#pt-beautify-generate').on('click', async () => {
    await handleGenerateClick('create');
  });

  modal.find('#pt-beautify-revise').on('click', async () => {
    await handleGenerateClick('revise');
  });

  modal.find('#pt-beautify-regenerate').on('click', async () => {
    await handleGenerateClick('variant');
  });

  modal.find('#pt-beautify-save').on('click', async () => {
    const currentSession = syncSessionFromModal(modal);
    if (!currentSession?.result) {
      notify('error', '当前还没有可保存的正则结果。');
      return;
    }

    const scriptName = String(currentSession.result.scriptName ?? '').trim();
    const findRegex = String(currentSession.result.findRegex ?? '').trim();
    const replaceString = normalizeBeautifyReplaceString(currentSession.result.replaceString ?? '');
    const targetType = Number(currentSession.targetType ?? BEAUTIFY_SCRIPT_TYPES.PRESET);

    if (!scriptName || !findRegex) {
      notify('error', '脚本名称和查找正则不能为空。');
      return;
    }

    currentSession.result = buildResultObject(currentSession.result, { scriptName, findRegex, replaceString });
    upsertSession(currentSession);
    modal.find('#pt-beautify-replace-string').val(replaceString);
    updatePreview(modal);

    const $saveButton = modal.find('#pt-beautify-save');
    $saveButton.prop('disabled', true).text('保存中...');

    try {
      const { generateUUID } = await import('../core/utils.js');
      const scriptData = {
        id: generateUUID(),
        scriptName,
        findRegex,
        replaceString,
        trimStrings: [],
        placement: [2],
        disabled: false,
        markdownOnly: true,
        promptOnly: false,
        runOnEdit: false,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
      };

      await saveBeautifyRegexScript(scriptData, targetType);

      const typeLabel = BEAUTIFY_SCRIPT_TYPE_LABELS[targetType] ?? '正则脚本';
      notify('success', `已保存到${typeLabel}：${scriptName}`);
      closeBeautifyModal();
    } catch (error) {
      console.error('[BeautifyModal] Failed to save regex:', error);
      notify('error', `保存失败：${error.message}`);
    } finally {
      $saveButton.prop('disabled', false).text('保存正则脚本');
    }
  });

  updateModalState(modal, session);
}
