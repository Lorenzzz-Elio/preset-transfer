/**
 * 批量编辑 - 条目长文本格式化与解析纯函数模块
 * 遵循分文件原则与 DRY 原则，无 DOM / jQuery 依赖，便于单元测试与复用
 */

import { cloneDeep } from '../core/clone-utils.js';

const ENTRY_HEADER_PREFIX = '=== 条目: ';
const ENTRY_HEADER_SUFFIX = ' ===';

/**
 * 将条目数组格式化为长文本块
 * 仅包含条目名称与条目内容
 * @param {Array<Object>} entries - 条目列表
 * @returns {string} 格式化后的长文本
 */
export function formatEntriesToTextBlock(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return '';
  }

  return entries
    .map(entry => {
      const rawName = String(entry?.name ?? '').trim();
      const name = rawName || '未命名条目';
      const content = String(entry?.content ?? '');
      return `${ENTRY_HEADER_PREFIX}${name}${ENTRY_HEADER_SUFFIX}\n${content}`;
    })
    .join('\n\n');
}

/**
 * 解析长文本块为条目数据数组 [{ name, content }]
 * 具备高度容错性：
 * - 识别 `=== 条目: 名称 ===`、`=== 条目：名称 ===`、`=== Entry: 名称 ===`
 * - 兼容 Markdown 形式 `### 条目: 名称` 或 `## 条目: 名称`
 * - 若内容本身包含 Markdown 标题（如 `### Rules`）或分割线（如 `======`），不会被误识别为新条目
 * - 即使无显式“条目:”标记，也降级支持 `=== 名称 ===`
 *
 * @param {string} text - 输入长文本
 * @returns {Array<{ name: string, content: string }>} 解析出的条目数组
 */
export function parseTextBlockToEntries(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const lines = text.split(/\r?\n/);

  // 严格匹配条目头：必须包含“条目”或“Entry”加中英文冒号
  // 支持 === 条目: 名称 ===, === 条目：名称 ===, === Entry: Name ===
  // 以及 ### 条目: 名称
  const strictHeaderRegex = /^(?:={2,}\s*(?:条目|Entry)\s*[:：]\s*(.*?)\s*={2,}|#{2,4}\s*(?:条目|Entry)\s*[:：]\s*(.*?))$/i;

  // 宽松降级匹配（仅当文本中完全不存在严格条目头时使用）：=== 名称 ===
  const fallbackHeaderRegex = /^={2,}\s*(.*?)\s*={2,}$/;

  const hasStrictHeader = lines.some(line => strictHeaderRegex.test(line.trim()));
  const activeRegex = hasStrictHeader ? strictHeaderRegex : fallbackHeaderRegex;

  const entries = [];
  let currentEntry = null;
  let currentContentLines = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    const match = trimmedLine.match(activeRegex);
    // 提取条目名称（strictRegex 可能在 group 1 或 group 2）
    const matchedName = match ? (match[1] ?? match[2] ?? '').trim().replace(/^\[|\]$/g, '') : null;

    // 当匹配到有效头部，且名称不为空且不仅由等号构成
    if (match && matchedName && !/^=+$/.test(matchedName)) {
      if (currentEntry) {
        currentEntry.content = cleanContentLines(currentContentLines);
        entries.push(currentEntry);
      }
      currentEntry = {
        name: matchedName,
        content: '',
      };
      currentContentLines = [];
    } else if (currentEntry) {
      currentContentLines.push(line);
    }
  }

  if (currentEntry) {
    currentEntry.content = cleanContentLines(currentContentLines);
    entries.push(currentEntry);
  }

  return entries;
}

/**
 * 清理内容行的首尾空行，保留内部格式与缩进
 * @param {Array<string>} lines - 内容行数组
 * @returns {string} 处理后的内容文本
 */
function cleanContentLines(lines) {
  let start = 0;
  while (start < lines.length && lines[start].trim() === '') {
    start++;
  }
  let end = lines.length - 1;
  while (end >= start && lines[end].trim() === '') {
    end--;
  }
  if (start > end) {
    return '';
  }
  return lines.slice(start, end + 1).join('\n');
}

/**
 * 将解析出的长文本应用并回填到原有条目列表
 * 智能 3 阶段匹配策略：
 * 1. 阶段 1（位置同名优先锚定）：当块数量与已选条目数一致时，同索引位置且同名的条目优先 1:1 配对
 *    彻底解决重名条目（如 START / END 包装对）乱序或错位匹配的隐患
 * 2. 阶段 2（跨位置同名匹配）：对顺序被调换的条目按名称继续配对
 * 3. 阶段 3（位置索引兜底匹配）：对未配对的条目与块按剩余顺序配对，支持在长文本中直接重命名条目
 * 4. 严格保留条目的原生 identifier、role、depth、trigger 等所有其他配置属性
 *
 * @param {Array<Object>} originalEntries - 原条目列表
 * @param {string} textBlock - 待应用的文本块
 * @returns {Array<Object>} 更新后的条目列表
 */
export function applyTextBlockToEntries(originalEntries, textBlock) {
  if (!Array.isArray(originalEntries) || originalEntries.length === 0) {
    return originalEntries;
  }
  if (!textBlock || typeof textBlock !== 'string' || !textBlock.trim()) {
    return originalEntries;
  }

  const parsedBlocks = parseTextBlockToEntries(textBlock);
  if (parsedBlocks.length === 0) {
    return originalEntries;
  }

  const result = cloneDeep(originalEntries);
  const matchedEntryIndices = new Set();
  const matchedBlockIndices = new Set();

  // 阶段 1：同位置且同名优先锚定（解决重名条目在原位编辑时的错位问题）
  if (parsedBlocks.length === result.length) {
    for (let i = 0; i < result.length; i++) {
      const blockName = parsedBlocks[i].name.trim();
      const entryName = String(result[i].name ?? '').trim();
      if (blockName === entryName) {
        matchedEntryIndices.add(i);
        matchedBlockIndices.add(i);
        result[i].content = parsedBlocks[i].content;
      }
    }
  }

  // 阶段 2：跨位置同名匹配（处理手动调整了块前后顺序的场景）
  parsedBlocks.forEach((block, bIdx) => {
    if (matchedBlockIndices.has(bIdx)) return;
    const blockName = block.name.trim();
    const entryIdx = result.findIndex((e, eIdx) => {
      if (matchedEntryIndices.has(eIdx)) return false;
      return String(e.name ?? '').trim() === blockName;
    });

    if (entryIdx !== -1) {
      matchedEntryIndices.add(entryIdx);
      matchedBlockIndices.add(bIdx);
      result[entryIdx].content = block.content;
    }
  });

  // 阶段 3：按位置索引匹配剩余未配对条目（支持在长文本中修改条目名称）
  const unmatchedEntryIndices = result
    .map((_, idx) => idx)
    .filter(idx => !matchedEntryIndices.has(idx));

  const unmatchedBlockIndices = parsedBlocks
    .map((_, idx) => idx)
    .filter(idx => !matchedBlockIndices.has(idx));

  const pairCount = Math.min(unmatchedEntryIndices.length, unmatchedBlockIndices.length);
  for (let i = 0; i < pairCount; i++) {
    const eIdx = unmatchedEntryIndices[i];
    const bIdx = unmatchedBlockIndices[i];
    const block = parsedBlocks[bIdx];

    if (block.name && block.name.trim()) {
      result[eIdx].name = block.name.trim();
    }
    result[eIdx].content = block.content;
  }

  return result;
}

