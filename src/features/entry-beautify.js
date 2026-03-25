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

export async function generateBeautifyRegex({ entryName, entryContent, referenceScript, userPrompt }) {
  const context = getSillyTavernContext();
  if (typeof context?.generateRaw !== 'function') {
    throw new Error('无法访问 SillyTavern 的 generateRaw API');
  }

  const referenceSection = referenceScript
    ? `\n\n【参考正则风格】\n以下是一个已有的美化正则脚本，请参考其 replaceString 中的 HTML/CSS 风格来生成新的美化：\n\`\`\`json\n${JSON.stringify(
        {
          scriptName: referenceScript.scriptName,
          findRegex: referenceScript.findRegex,
          replaceString: referenceScript.replaceString,
        },
        null,
        2,
      )}\n\`\`\``
    : '';

  const userSection = userPrompt ? `\n\n【用户需求】\n${userPrompt}` : '';

  const systemPrompt = `你是一个 SillyTavern 正则脚本专家，专门负责生成用于美化 AI 输出的正则替换脚本。
你需要根据提供的【预设条目内容】，生成一个正则脚本，使 AI 按照该条目格式输出的内容能够被美化渲染。
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

只输出 JSON 对象，不要输出解释。`;

  const userMessage = `【预设条目名称】\n${entryName}\n\n【预设条目内容】\n${entryContent}${referenceSection}${userSection}`;

  const resultRaw = await context.generateRaw({
    prompt: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    quietToLoud: true,
  });

  const parsedReasoning = context.parseReasoningFromString?.(resultRaw, { strict: false });
  const result = parsedReasoning?.content ?? resultRaw;

  const candidates = [];
  const fenced = result.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) candidates.push(fenced[1]);
  candidates.push(result);

  let parsed = null;
  for (const candidate of candidates) {
    const jsonMatch = candidate.match(/\{[\s\S]*\}/);
    if (!jsonMatch) continue;
    try {
      parsed = JSON.parse(jsonMatch[0]);
      break;
    } catch {
      /* continue */
    }
  }

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
