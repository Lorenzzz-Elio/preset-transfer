import { getJQuery } from '../core/utils.js';
import { getWorldInfoModule } from '../core/worldbook-api.js';
import { callAIAssistant } from '../features/ai-assistant.js';

function getEntriesObject(data) {
  if (!data || typeof data !== 'object') return {};
  if (!data.entries || typeof data.entries !== 'object') return {};
  return data.entries;
}

function sortWorldEntries(a, b) {
  const ao = Number(a?.order ?? 0);
  const bo = Number(b?.order ?? 0);
  if (ao !== bo) return bo - ao;
  const au = Number(a?.uid ?? 0);
  const bu = Number(b?.uid ?? 0);
  return au - bu;
}

function buildReferenceOptionLabel(entry) {
  const comment = String(entry?.comment ?? '').trim() || '未命名条目';
  const uid = entry?.uid != null ? String(entry.uid).trim() : '';
  return uid ? `${comment} (UID:${uid})` : comment;
}

async function loadWorldbookEntries(worldbookName) {
  const mod = await getWorldInfoModule();
  if (typeof mod?.loadWorldInfo !== 'function') {
    throw new Error('World Info module missing loadWorldInfo');
  }

  const data = await mod.loadWorldInfo(worldbookName);
  const entries = Object.values(getEntriesObject(data)).filter(Boolean);
  entries.sort(sortWorldEntries);
  return entries;
}

function normalizeText(value) {
  return String(value ?? '');
}

export async function initWorldbookEntryAIAssistant(apiInfo, worldbookName) {
  const $ = getJQuery();

  const $selector = $('#pt-wi-ai-style-entry-selector');
  const $prompt = $('#pt-wi-ai-additional-prompt');
  const $convertBtn = $('#pt-wi-ai-convert-btn');
  const $createBtn = $('#pt-wi-ai-create-btn');

  if (!$selector.length || !$prompt.length || !$convertBtn.length || !$createBtn.length) {
    return;
  }

  $selector.find('option:not(:first)').remove();

  let entries = [];
  try {
    entries = await loadWorldbookEntries(worldbookName);
  } catch (error) {
    console.error('加载世界书条目列表失败:', error);
  }

  const uidToEntry = new Map();
  for (const entry of entries) {
    const uid = entry?.uid != null ? String(entry.uid).trim() : '';
    if (!uid) continue;
    uidToEntry.set(uid, entry);
    $selector.append(
      $('<option>', {
        value: uid,
        text: buildReferenceOptionLabel(entry),
      }),
    );
  }

  $convertBtn.prop('disabled', false);
  $createBtn.prop('disabled', false);

  const handleAIAssist = async (task) => {
    const selectedUid = String($selector.val() ?? '').trim();
    let referenceEntry;

    if (selectedUid) {
      const rawRef = uidToEntry.get(selectedUid);
      if (!rawRef) {
        alert('找不到指定的参考条目');
        return;
      }
      referenceEntry = {
        name: normalizeText(rawRef.comment).trim() || `UID:${selectedUid}`,
        content: normalizeText(rawRef.content),
      };
    } else {
      referenceEntry = {
        name: normalizeText($('#pt-wi-comment').val()).trim() || '当前条目',
        content: normalizeText($('#pt-wi-content').val()),
      };
      if (!referenceEntry.content.trim()) {
        alert('当前条目内容为空，请先填写内容或选择参考条目');
        return;
      }
    }

    const sourceEntry = {
      name: normalizeText($('#pt-wi-comment').val()).trim(),
      content: normalizeText($('#pt-wi-content').val()),
    };

    const additionalPrompt = normalizeText($prompt.val());

    try {
      const result = await callAIAssistant(apiInfo, task, sourceEntry, referenceEntry, additionalPrompt);
      $('#pt-wi-comment').val(normalizeText(result.name));
      $('#pt-wi-comment').trigger('input');
      $('#pt-wi-content').val(normalizeText(result.content));
      console.log(`世界书 AI ${task === 'convert' ? '格式转换' : '辅助创作'}完成`);
    } catch {
      // Errors are already surfaced inside callAIAssistant
    }
  };

  $convertBtn.off('click.pt-wi-ai').on('click.pt-wi-ai', () => handleAIAssist('convert'));
  $createBtn.off('click.pt-wi-ai').on('click.pt-wi-ai', () => handleAIAssist('create'));
}
