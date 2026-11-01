/**
 * worldbook-data-pure.js
 * 世界书纯函数核心层：负责世界书条目签名计算、UID 分配、条目合并去重与批量删除
 * 无 DOM 依赖、无宿主全局依赖、无异步 I/O 阻塞，可完全脱机进行自动化单元测试。
 */

/**
 * 规范化关键词数组为有序管道符字符串
 * @param {*} value
 * @returns {string}
 */
export function normalizeKeyArray(value) {
  if (!Array.isArray(value)) return '';
  return value
    .map(v => String(v ?? '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .join('|');
}

/**
 * 构建世界书条目的唯一比对签名 (comment + key + keysecondary)
 * @param {Object} entry
 * @returns {string}
 */
export function buildWorldEntrySignature(entry) {
  const comment = String(entry?.comment ?? '').trim();
  const key = normalizeKeyArray(entry?.key);
  const keysecondary = normalizeKeyArray(entry?.keysecondary);
  return `${comment}||${key}||${keysecondary}`;
}

/**
 * 条目排序比对：order 倒序优先，uid 正序后置
 * @param {Object} a
 * @param {Object} b
 * @returns {number}
 */
export function sortWorldEntries(a, b) {
  const ao = Number(a?.order ?? 0);
  const bo = Number(b?.order ?? 0);
  if (ao !== bo) return bo - ao;
  const au = Number(a?.uid ?? 0);
  const bu = Number(b?.uid ?? 0);
  return au - bu;
}

/**
 * 纯计算寻找世界书中最小可用的数值 UID（自动避免碰撞）
 * @param {Object} targetData
 * @returns {number}
 */
export function getFreeWorldEntryUid(targetData) {
  const entriesObj = targetData?.entries && typeof targetData.entries === 'object' ? targetData.entries : {};
  const used = new Set(Object.values(entriesObj).map(e => Number(e?.uid)).filter(Number.isFinite));
  let uid = 0;
  while (used.has(uid)) uid += 1;
  return uid;
}

/**
 * 安全深度克隆世界书条目，并剔除原生 UID
 * @param {Object} sourceEntry
 * @returns {Object}
 */
export function cloneWorldEntry(sourceEntry) {
  const clone = JSON.parse(JSON.stringify(sourceEntry ?? {}));
  delete clone.uid;
  return clone;
}

/**
 * 将条目批量合并/迁移至目标世界书
 * @param {Object} targetData 目标世界书数据
 * @param {Array} entries 待迁移条目数组
 * @param {Object} [options]
 * @param {boolean} [options.autoEnable=false] 是否自动开启条目
 * @param {Object} [options.sourceData=null] 源世界书完整数据（用于 identifier 反查）
 * @param {Function} [options.getFreeUidFn=null] 自定义 UID 分配函数
 * @returns {{ targetData: Object, updatedCount: number, insertedCount: number, transferredUidMap: Map }}
 */
export function applyTransferEntriesToWorldbook(targetData, entries, options = {}) {
  if (!targetData || typeof targetData !== 'object') {
    throw new Error('targetData 必须为对象');
  }
  if (!targetData.entries || typeof targetData.entries !== 'object') {
    targetData.entries = {};
  }

  const {
    autoEnable = false,
    sourceData = null,
    getFreeUidFn = null,
  } = options;

  const targetSignatureToUid = new Map();
  for (const entry of Object.values(targetData.entries)) {
    if (!entry) continue;
    targetSignatureToUid.set(buildWorldEntrySignature(entry), Number(entry.uid));
  }

  const sourceEntriesObj = sourceData?.entries && typeof sourceData.entries === 'object' ? sourceData.entries : {};
  const sourceByUid = new Map(Object.values(sourceEntriesObj).filter(Boolean).map(e => [String(e.uid), e]));

  const allocateUid = typeof getFreeUidFn === 'function' ? getFreeUidFn : getFreeWorldEntryUid;

  let updatedCount = 0;
  let insertedCount = 0;
  const transferredUidMap = new Map();

  const entryList = Array.isArray(entries) ? entries : [];

  for (const item of entryList) {
    const src = item?.raw ?? sourceByUid.get(String(item?.identifier));
    if (!src) continue;

    const signature = buildWorldEntrySignature(src);
    const existingUid = targetSignatureToUid.get(signature);
    const clone = cloneWorldEntry(src);
    if (autoEnable) {
      clone.disable = false;
    }

    const sourceIdentifier = String(item?.identifier ?? src?.uid ?? '');

    if (Number.isFinite(existingUid)) {
      // 存在同签名条目：覆盖并保留目标原 UID
      targetData.entries[String(existingUid)] = { uid: existingUid, ...clone };
      updatedCount += 1;
      if (sourceIdentifier) {
        transferredUidMap.set(sourceIdentifier, existingUid);
      }
    } else {
      // 全新条目：自动分配不冲突的新 UID
      const newUid = allocateUid(targetData);
      targetData.entries[String(newUid)] = { uid: newUid, ...clone };
      targetSignatureToUid.set(signature, newUid);
      insertedCount += 1;
      if (sourceIdentifier) {
        transferredUidMap.set(sourceIdentifier, newUid);
      }
    }
  }

  return {
    targetData,
    updatedCount,
    insertedCount,
    transferredUidMap,
  };
}

/**
 * 从世界书数据中删除指定条目
 * @param {Object} targetData 目标世界书数据
 * @param {Array} entries 待删除条目列表
 * @param {Object} [options]
 * @param {Function} [options.deleteEntryFn=null] 自定义单条删除函数
 * @returns {{ targetData: Object, deletedCount: number }}
 */
export function applyDeleteEntriesFromWorldbook(targetData, entries, options = {}) {
  if (!targetData || typeof targetData !== 'object') {
    throw new Error('targetData 必须为对象');
  }
  if (!targetData.entries || typeof targetData.entries !== 'object') {
    targetData.entries = {};
  }

  const { deleteEntryFn = null } = options;
  const entryList = Array.isArray(entries) ? entries : [];
  let deletedCount = 0;

  for (const item of entryList) {
    const uid = item?.raw?.uid ?? Number(item?.identifier);
    if (!Number.isFinite(uid)) continue;

    const uidKey = String(uid);
    if (targetData.entries.hasOwnProperty(uidKey)) {
      if (typeof deleteEntryFn === 'function') {
        deleteEntryFn(targetData, uid);
      } else {
        delete targetData.entries[uidKey];
      }
      deletedCount += 1;
    }
  }

  return {
    targetData,
    deletedCount,
  };
}
