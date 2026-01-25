import { getSillyTavernContext } from '../core/utils.js';
import { showAILoading } from './ai-assistant.js';
import { isEntryDifferent } from '../events/compare-events.js';
import { getPromptEntries } from '../preset/preset-manager.js';

/**
 * 生成两个预设版本之间的更新日志
 * @param {object} leftData - 左侧预设数据
 * @param {object} rightData - 右侧预设数据
 * @param {string} leftPresetName - 左侧预设名称
 * @param {string} rightPresetName - 右侧预设名称
 * @param {string} referenceChangelogs - 以往的更新日志作为参考（可选）
 * @returns {Promise<string>} - 生成的更新日志文本
 */
async function generateChangelog(leftData, rightData, leftPresetName, rightPresetName, referenceChangelogs = '') {
  const context = getSillyTavernContext();
  if (!context || typeof context.generateRaw !== 'function') {
    throw new Error('无法访问 SillyTavern 的 generateRaw API');
  }

  try {
    showAILoading(true, 'AI 正在生成更新日志...');

    const leftEntries = getPromptEntries(leftData);
    const rightEntries = getPromptEntries(rightData);

    // 复用现有的差异分析逻辑
    const changes = analyzeChanges(leftEntries, rightEntries);

    // 构建提示词
    const systemPrompt = {
      role: 'system',
      content: `你是一个更新日志撰写助手，负责为预设更新撰写清晰的更新说明。

你的任务是根据两个预设版本之间的差异，生成一份更新日志。

写作要求：
1. 使用简单直白的语言，避免夸张的专业术语（如"生态系统"、"赋能"、"闭环"、"深度赋能"等）
2. 必须列出具体的条目名称，不要笼统地说"新增一批"或"修改若干"
3. 用日常用语描述变更，例如"新增了【条目名】"、"修改了【条目名】的内容"
4. 对于重要的修改，可以简单说明改了什么（如"调整了触发条件"、"更新了内容"）
5. 如果提供了参考日志：把它当作“结构/格式/文风模板”，尽可能严格模仿其结构（标题层级、分组方式、条目句式、标点与换行）
6. 参考日志仅用于写作风格与结构参考：严禁借用/照抄参考日志里的具体更新内容、条目名或改动点；所有更新内容必须只来自本次差异列表
7. 不要推测未在差异列表中出现的变更；不确定时宁可不写，也不要编造
8. 保持清晰易读，但不要过于简略

请直接输出更新日志文本，不要包含任何额外的解释或标记。`,
    };

    let userPrompt = `请为以下预设更新生成更新日志：

**版本信息**
- 旧版本：${leftPresetName}
- 新版本：${rightPresetName}

**变更统计**
- 新增条目：${changes.added.length} 个
- 修改条目：${changes.modified.length} 个
- 删除条目：${changes.removed.length} 个

**详细变更**
`;

    if (changes.added.length > 0) {
      userPrompt += `\n新增条目：\n${changes.added.map(e => `- ${e.name}`).join('\n')}\n`;
    }

    if (changes.modified.length > 0) {
      userPrompt += `\n修改条目：\n${changes.modified.map(e => `- ${e.name}`).join('\n')}\n`;
    }

    if (changes.removed.length > 0) {
      userPrompt += `\n删除条目：\n${changes.removed.map(e => `- ${e.name}`).join('\n')}\n`;
    }

    if (referenceChangelogs) {
      userPrompt += `\n**参考格式（以往的更新日志）**\n\`\`\`\n${referenceChangelogs}\n\`\`\`\n\n请尽可能严格模仿上述参考日志的结构与文风（标题层级、分组方式、句式、标点、换行）。\n注意：参考日志仅用于“结构/文风”参考；更新内容必须只基于上方差异列表，禁止把参考日志里的条目名/改动点带入本次输出。`;
    }

    const ordered_prompts = [systemPrompt, { role: 'user', content: userPrompt }];

    const resultRaw = await context.generateRaw({
      prompt: ordered_prompts,
      quietToLoud: true,
    });

    const parsedReasoning = context.parseReasoningFromString?.(resultRaw, { strict: false });
    const result = parsedReasoning?.content ?? resultRaw;

    return result.trim();
  } catch (error) {
    console.error('生成更新日志失败:', error);
    throw error;
  } finally {
    showAILoading(false);
  }
}

/**
 * 分析两个预设之间的差异（复用现有的isEntryDifferent函数）
 */
function analyzeChanges(leftEntries, rightEntries) {
  const leftMap = new Map(leftEntries.map(e => [e.name, e]));
  const rightMap = new Map(rightEntries.map(e => [e.name, e]));

  const added = [];
  const removed = [];
  const modified = [];

  // 找出新增的条目
  for (const [name, entry] of rightMap) {
    if (!leftMap.has(name)) {
      added.push({ name, entry });
    }
  }

  // 找出删除的条目
  for (const [name, entry] of leftMap) {
    if (!rightMap.has(name)) {
      removed.push({ name, entry });
    }
  }

  // 找出修改的条目（复用isEntryDifferent）
  for (const [name, leftEntry] of leftMap) {
    const rightEntry = rightMap.get(name);
    if (rightEntry && isEntryDifferent(leftEntry, rightEntry)) {
      modified.push({ name, leftEntry, rightEntry });
    }
  }

  return { added, removed, modified };
}

export { generateChangelog, analyzeChanges };
