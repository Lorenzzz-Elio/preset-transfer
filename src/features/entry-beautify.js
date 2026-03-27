import { getSillyTavernContext, generateUUID } from '../core/utils.js';

export const BEAUTIFY_SCRIPT_TYPES = {
  GLOBAL: 0,
  PRESET: 2,
  SCOPED: 1,
};

export const BEAUTIFY_SCRIPT_TYPE_LABELS = {
  [BEAUTIFY_SCRIPT_TYPES.GLOBAL]: '全局正则脚本',
  [BEAUTIFY_SCRIPT_TYPES.PRESET]: '预设正则脚本',
  [BEAUTIFY_SCRIPT_TYPES.SCOPED]: '角色正则脚本',
};

function stripCodeFence(text) {
  const raw = String(text ?? '').trim();
  const fenced = raw.match(/^```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```$/);
  return fenced?.[1]?.trim() ?? raw;
}

function escapePreviewHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ensureBodyWrapper(text) {
  const normalized = stripCodeFence(text);
  const hasBodyStart = /<body(?:\s[^>]*)?>/i.test(normalized);
  const hasBodyEnd = /<\/body>/i.test(normalized);

  if (hasBodyStart && hasBodyEnd) {
    return normalized;
  }

  return `<body>\n${normalized.trim()}\n</body>`;
}

export function normalizeBeautifyReplaceString(value) {
  return `\`\`\`html\n${ensureBodyWrapper(value)}\n\`\`\``;
}

function serializeScriptForPrompt(script) {
  if (!script || typeof script !== 'object') return null;

  return {
    scriptName: String(script.scriptName ?? ''),
    findRegex: String(script.findRegex ?? ''),
    replaceString: normalizeBeautifyReplaceString(script.replaceString ?? ''),
    placement: Array.isArray(script.placement) ? script.placement : [2],
    disabled: Boolean(script.disabled ?? false),
    markdownOnly: Boolean(script.markdownOnly ?? true),
    promptOnly: Boolean(script.promptOnly ?? false),
  };
}

function buildGenerationObjective({ generationMode, hasExistingScript, hasRevisionPrompt }) {
  if (generationMode === 'variant') {
    return '你需要在满足同一条目需求的前提下，生成一版与当前脚本在视觉结构、布局风格、或匹配策略上明显不同的新方案。';
  }

  if (hasExistingScript || hasRevisionPrompt) {
    return '你需要基于提供的当前脚本和修改意见，输出一份完整的改进版脚本。不要只返回差异，也不要省略未修改字段。';
  }

  return '你需要根据提供的预设条目内容，生成一个全新的美化正则脚本。';
}

function parseBeautifyJson(result) {
  const candidates = [];
  const fenced = result.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) candidates.push(fenced[1]);
  candidates.push(result);

  for (const candidate of candidates) {
    const jsonMatch = candidate.match(/\{[\s\S]*\}/);
    if (!jsonMatch) continue;

    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      /* continue */
    }
  }

  return null;
}

export async function getRegexScriptsByType(scriptType) {
  try {
    const { getScriptsByType } = await import('../../../../regex/engine.js');
    return getScriptsByType(scriptType) ?? [];
  } catch {
    return [];
  }
}

export async function getAllRegexScriptsForReference() {
  const results = [];

  for (const [type, label] of Object.entries(BEAUTIFY_SCRIPT_TYPE_LABELS)) {
    const scripts = await getRegexScriptsByType(Number(type));
    for (const script of scripts) {
      results.push({ script, type: Number(type), typeLabel: label });
    }
  }

  return results;
}

async function refreshRegexExtensionUi() {
  try {
    const { eventSource, event_types } = await import('../../../../../../script.js');
    const context = getSillyTavernContext();
    const apiId = context?.mainApi === 'koboldhorde' ? 'kobold' : context?.mainApi ?? '';
    const presetName = context?.getPresetManager?.(apiId)?.getSelectedPresetName?.() ?? '';
    await eventSource.emit(event_types.PRESET_CHANGED, {
      apiId,
      name: presetName,
    });
  } catch (error) {
    console.warn('[Beautify] Failed to refresh regex extension UI:', error);
  }
}

export async function saveBeautifyRegexScript(scriptData, scriptType) {
  const { saveScriptsByType } = await import('../../../../regex/engine.js');
  const current = await getRegexScriptsByType(scriptType);
  const next = [...current, scriptData];
  await saveScriptsByType(next, scriptType);
  await refreshRegexExtensionUi();
}

export async function generateBeautifyRegex({
  entryName,
  entryContent,
  referenceScript,
  userPrompt,
  existingScript = null,
  revisionPrompt = '',
  generationMode = 'create',
}) {
  const context = getSillyTavernContext();
  if (typeof context?.generateRaw !== 'function') {
    throw new Error('无法访问 SillyTavern 的 generateRaw API');
  }

  const normalizedReferenceScript = serializeScriptForPrompt(referenceScript);
  const includeExistingScript = generationMode !== 'variant';
  const normalizedExistingScript = includeExistingScript ? serializeScriptForPrompt(existingScript) : null;
  const normalizedRevisionPrompt = String(revisionPrompt ?? '').trim();
  const normalizedUserPrompt = String(userPrompt ?? '').trim();

  const referenceSection = referenceScript
    ? `\n\n【参考正则风格】\n以下是一个已有的美化正则脚本，请参考其 replaceString 中的 HTML/CSS 风格来生成新的美化：\n\`\`\`json\n${JSON.stringify(
        normalizedReferenceScript,
        null,
        2,
      )}\n\`\`\``
    : '';

  const userSection = normalizedUserPrompt ? `\n\n【用户需求】\n${normalizedUserPrompt}` : '';
  const existingScriptSection = normalizedExistingScript
    ? `\n\n【当前脚本】\n以下是当前正在编辑的版本。若是“继续修改”，请基于它输出完整新版本；若是“重新生成一版”，可参考但不要只做微调。\n\`\`\`json\n${JSON.stringify(
        normalizedExistingScript,
        null,
        2,
      )}\n\`\`\``
    : '';
  const revisionSection = normalizedRevisionPrompt ? `\n\n【修改意见】\n${normalizedRevisionPrompt}` : '';

  const objective = buildGenerationObjective({
    generationMode,
    hasExistingScript: Boolean(normalizedExistingScript),
    hasRevisionPrompt: Boolean(normalizedRevisionPrompt),
  });

  const systemPrompt = `你是一个 SillyTavern 正则脚本专家，专门负责生成用于美化 AI 输出的正则替换脚本。
${objective}
输出必须是一个 JSON 对象，包含以下字段：
- scriptName: string
- findRegex: string
- replaceString: string
- placement: number[]
- disabled: boolean
- markdownOnly: boolean
- promptOnly: boolean

replaceString 必须满足以下要求：
- 必须使用 \`\`\`html 代码块包裹
- 代码块内部必须同时包含 <body> 和 </body> 标签
- 如果需要 CSS/JS，请放在 <body> 内的 <style> / <script> 中
- 不要输出 body 标签之外的额外内容
- 如果提供了当前脚本，你可以修改任何字段，但最终必须返回完整可用的新脚本
- 如果是重新生成变体，不要只改颜色或几个字，尽量让布局结构或样式语言有明显区别

只输出 JSON 对象，不要输出解释。`;

  const userMessage = `【预设条目名称】\n${entryName}\n\n【预设条目内容】\n${entryContent}${referenceSection}${userSection}${existingScriptSection}${revisionSection}`;

  const resultRaw = await context.generateRaw({
    prompt: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    quietToLoud: true,
  });

  const parsedReasoning = context.parseReasoningFromString?.(resultRaw, { strict: false });
  const result = parsedReasoning?.content ?? resultRaw;
  const parsed = parseBeautifyJson(result);

  if (!parsed) {
    throw new Error(`AI 返回的不是有效 JSON。原始返回：${result}`);
  }

  return {
    id: generateUUID(),
    scriptName: String(parsed.scriptName ?? `美化-${entryName}`),
    findRegex: String(parsed.findRegex ?? ''),
    replaceString: normalizeBeautifyReplaceString(parsed.replaceString ?? ''),
    trimStrings: [],
    placement: Array.isArray(parsed.placement) ? parsed.placement : [2],
    disabled: Boolean(parsed.disabled ?? false),
    markdownOnly: Boolean(parsed.markdownOnly ?? true),
    promptOnly: Boolean(parsed.promptOnly ?? false),
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  };
}

export function previewRegexReplace(findRegex, replaceString, sampleText) {
  if (!findRegex || !sampleText) return sampleText;

  try {
    const match = findRegex.match(/^\/(.+)\/([gimsuy]*)$/);
    const regex = match ? new RegExp(match[1], match[2] || 'g') : new RegExp(findRegex, 'g');
    return sampleText.replace(regex, replaceString);
  } catch {
    return sampleText;
  }
}

export function buildBeautifyPreviewDocument(value) {
  const normalized = stripCodeFence(value).trim();
  const hasBodyStart = /<body(?:\s[^>]*)?>/i.test(normalized);
  const hasBodyEnd = /<\/body>/i.test(normalized);

  if (!normalized) {
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; min-height: 100%; }
      body {
        padding: 12px;
        box-sizing: border-box;
        font-family: system-ui, sans-serif;
        color: #d7d7d7;
        background: transparent;
      }
    </style>
  </head>
  <body>暂无可渲染内容。</body>
</html>`;
  }

  if (hasBodyStart && hasBodyEnd) {
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; min-height: 100%; background: transparent; }
      body {
        padding: 12px;
        box-sizing: border-box;
      }
      *, *::before, *::after {
        box-sizing: border-box;
        max-width: 100%;
      }
    </style>
  </head>
  ${normalized}
</html>`;
  }

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; min-height: 100%; background: transparent; }
      body {
        padding: 12px;
        box-sizing: border-box;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        color: #d7d7d7;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
      }
    </style>
  </head>
  <body><pre>${escapePreviewHtml(normalized)}</pre></body>
</html>`;
}
