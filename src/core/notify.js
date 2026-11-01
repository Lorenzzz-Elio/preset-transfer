/**
 * notify.js
 * 统一轻量通知模块
 * 自动适配 SillyTavern 原生 toastr 浮动气泡，避免使用卡死页面的原生 alert()。
 * 当 toastr 不可用或处于脱机环境时安全降级到控制台输出。
 */

function getToastr() {
  if (typeof window === 'undefined') return null;
  if (window.toastr && typeof window.toastr.info === 'function') {
    return window.toastr;
  }
  if (window.parent && window.parent.toastr && typeof window.parent.toastr.info === 'function') {
    return window.parent.toastr;
  }
  return null;
}

function formatMessage(message) {
  if (message === null || message === undefined) return '';
  const text = String(message);
  // 若包含换行符，将换行符转为 HTML <br>，方便 Toastr 多行显示
  if (text.includes('\n')) {
    return text.replace(/\n/g, '<br>');
  }
  return text;
}

export const notify = {
  success(message, title, options) {
    const toastr = getToastr();
    const formatted = formatMessage(message);
    if (toastr && typeof toastr.success === 'function') {
      toastr.success(formatted, title, options);
    } else {
      console.log('[PresetTransfer:SUCCESS]', title ? `${title}: ` : '', message);
    }
  },

  error(message, title, options) {
    const toastr = getToastr();
    const formatted = formatMessage(message);
    if (toastr && typeof toastr.error === 'function') {
      toastr.error(formatted, title, options);
    } else {
      console.error('[PresetTransfer:ERROR]', title ? `${title}: ` : '', message);
    }
  },

  warning(message, title, options) {
    const toastr = getToastr();
    const formatted = formatMessage(message);
    if (toastr && typeof toastr.warning === 'function') {
      toastr.warning(formatted, title, options);
    } else {
      console.warn('[PresetTransfer:WARN]', title ? `${title}: ` : '', message);
    }
  },

  info(message, title, options) {
    const toastr = getToastr();
    const formatted = formatMessage(message);
    if (toastr && typeof toastr.info === 'function') {
      toastr.info(formatted, title, options);
    } else {
      console.info('[PresetTransfer:INFO]', title ? `${title}: ` : '', message);
    }
  },
};

export default notify;
