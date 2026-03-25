import { getJQuery, escapeHtml, getParentWindow } from '../core/utils.js';
import { CommonStyles } from '../styles/common-styles.js';
import { PT } from '../core/api-compat.js';
import {
  BEAUTIFY_SCRIPT_TYPES,
  BEAUTIFY_SCRIPT_TYPE_LABELS,
  getAllRegexScriptsForReference,
  generateBeautifyRegex,
  normalizeBeautifyReplaceString,
  previewRegexReplace,
  saveBeautifyRegexScript,
} from '../features/entry-beautify.js';

const MODAL_ID = 'pt-entry-beautify-modal';

function notify(type, message) {
  const parentWindow = getParentWindow();
  if (parentWindow.toastr?.[type]) {
    parentWindow.toastr[type](message);
    return;
  }

  parentWindow.alert?.(message);
}

function closeBeautifyModal() {
  const $ = getJQuery();
  $(`#${MODAL_ID}`).remove();
}

function resolveCurrentPresetName() {
  try {
    return PT.API.getLoadedPresetName?.() ?? null;
  } catch {
    return null;
  }
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

  const refOptions = allScripts
    .map((item, index) => {
      const label = `[${item.typeLabel}] ${escapeHtml(item.script?.scriptName ?? '未命名')}`;
      return `<option value="${index}">${label}</option>`;
    })
    .join('');

  const targetOptions = Object.entries(BEAUTIFY_SCRIPT_TYPE_LABELS)
    .map(([type, label]) => {
      const selected = Number(type) === BEAUTIFY_SCRIPT_TYPES.PRESET ? 'selected' : '';
      return `<option value="${type}" ${selected}>${label}</option>`;
    })
    .join('');

  const modal = $(`
    <div id="${MODAL_ID}" style="${CommonStyles.getModalBaseStyles()}">
      <div style="${contentStyles}">
        <div style="display:flex; align-items:center; gap:${vars.gap}; margin-bottom:${vars.margin};">
          <span style="flex:1; font-size:${vars.fontSizeLarge}; font-weight:600;">制作美化正则</span>
          <button
            id="pt-beautify-close"
            class="menu_button"
            type="button"
            style="padding:${vars.buttonPaddingSmall}; border-radius:${vars.buttonRadius};"
            title="关闭">
            关闭
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
            <select id="pt-beautify-ref-select" class="text_pole" style="width:100%;">
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
              style="width:100%; resize:vertical;"></textarea>
          </section>

          <button
            id="pt-beautify-generate"
            class="menu_button"
            type="button"
            style="width:100%; padding:${vars.buttonPadding}; border-radius:${vars.buttonRadius};">
            <span id="pt-beautify-generate-text">AI 生成正则</span>
          </button>

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
              <label for="pt-beautify-replace-string" style="font-size:${vars.fontSizeSmall}; color:${vars.tipColor};">替换式</label>
              <textarea
                id="pt-beautify-replace-string"
                class="text_pole"
                rows="8"
                style="width:100%; resize:vertical; font-family:monospace;"></textarea>
              <div style="font-size:${vars.fontSizeSmall}; color:${vars.tipColor};">
                将自动规范为带 <code>\`\`\`html</code> 代码块且包含 <code>&lt;body&gt;</code> 与 <code>&lt;/body&gt;</code>。
              </div>
            </section>

            <section style="display:flex; flex-direction:column; gap:calc(${vars.gap} / 2);">
              <label for="pt-beautify-sample-text" style="font-size:${vars.fontSizeSmall}; color:${vars.tipColor};">示例文本</label>
              <textarea
                id="pt-beautify-sample-text"
                class="text_pole"
                rows="4"
                placeholder="输入一段示例文本，用于查看替换结果。"
                style="width:100%; resize:vertical;"></textarea>
              <div style="font-size:${vars.fontSizeSmall}; color:${vars.tipColor};">替换结果预览</div>
              <pre
                id="pt-beautify-preview-output"
                style="
                  margin:0;
                  background:${vars.inputBg};
                  border:1px solid ${vars.inputBorder};
                  border-radius:${vars.borderRadiusSmall};
                  padding:${vars.paddingSmall};
                  min-height:calc(${vars.paddingLarge} * 2);
                  font-size:${vars.fontSizeSmall};
                  white-space:pre-wrap;
                  word-break:break-word;
                "></pre>
            </section>

            <div style="display:flex; gap:${vars.gap}; align-items:center;">
              <select id="pt-beautify-target-type" class="text_pole" style="flex:1;">
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

  const updatePreview = () => {
    const findRegex = String(modal.find('#pt-beautify-find-regex').val() ?? '');
    const replaceString = String(modal.find('#pt-beautify-replace-string').val() ?? '');
    const sampleText = String(modal.find('#pt-beautify-sample-text').val() ?? '');
    const output = previewRegexReplace(findRegex, replaceString, sampleText);
    modal.find('#pt-beautify-preview-output').text(output);
  };

  modal.find('#pt-beautify-close').on('click', closeBeautifyModal);
  modal.on('click', (event) => {
    if ($(event.target).is(`#${MODAL_ID}`)) {
      closeBeautifyModal();
    }
  });

  modal.on('input', '#pt-beautify-find-regex, #pt-beautify-replace-string, #pt-beautify-sample-text', updatePreview);

  modal.find('#pt-beautify-generate').on('click', async () => {
    const $button = modal.find('#pt-beautify-generate');
    const $buttonText = modal.find('#pt-beautify-generate-text');
    $button.prop('disabled', true);
    $buttonText.text('生成中...');

    try {
      const refIndex = String(modal.find('#pt-beautify-ref-select').val() ?? '');
      const referenceScript = refIndex === '' ? null : allScripts[Number(refIndex)]?.script ?? null;
      const userPrompt = String(modal.find('#pt-beautify-user-prompt').val() ?? '').trim();

      const result = await generateBeautifyRegex({
        entryName,
        entryContent,
        referenceScript,
        userPrompt,
      });

      modal.find('#pt-beautify-script-name').val(result.scriptName);
      modal.find('#pt-beautify-find-regex').val(result.findRegex);
      modal.find('#pt-beautify-replace-string').val(result.replaceString);
      modal.find('#pt-beautify-result-section').css('display', 'flex');
      updatePreview();
    } catch (error) {
      console.error('[BeautifyModal] Failed to generate regex:', error);
      notify('error', `生成失败：${error.message}`);
    } finally {
      $button.prop('disabled', false);
      $buttonText.text('AI 生成正则');
    }
  });

  modal.find('#pt-beautify-save').on('click', async () => {
    const scriptName = String(modal.find('#pt-beautify-script-name').val() ?? '').trim();
    const findRegex = String(modal.find('#pt-beautify-find-regex').val() ?? '').trim();
    const rawReplaceString = String(modal.find('#pt-beautify-replace-string').val() ?? '');
    const replaceString = normalizeBeautifyReplaceString(rawReplaceString);
    const targetType = Number(modal.find('#pt-beautify-target-type').val());

    if (!scriptName || !findRegex) {
      notify('error', '脚本名称和查找正则不能为空。');
      return;
    }

    modal.find('#pt-beautify-replace-string').val(replaceString);
    updatePreview();

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
}
