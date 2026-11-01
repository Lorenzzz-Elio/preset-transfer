/**
 * clone-utils.js
 * 纯粹的深度克隆工具模块
 * 遵循单一职责与分文件原则。
 * 优先使用现代浏览器标准的 structuredClone，失败或不支持时安全回退至 JSON 序列化。
 */

export function cloneDeep(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  try {
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }
  } catch {
    // structuredClone 在处理某些特殊宿主对象或不可克隆字段时可能抛错，转入降级策略
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    // 若 JSON 序列化也失败（如极罕见的不可序列化场景），浅拷贝作为最后保底
    return Array.isArray(value) ? [...value] : { ...value };
  }
}

export default cloneDeep;
