const NEW_FIELD_DEFAULTS = {
  injection_order: 100,
  injection_trigger: [],
};

const TRIGGER_TYPES = ['normal', 'continue', 'impersonate', 'swipe', 'regenerate', 'quiet'];

const TRIGGER_TYPE_LABELS = {
  normal: '正常',
  continue: '继续',
  impersonate: 'AI 帮答',
  swipe: 'Swipe',
  regenerate: '重新生成',
  quiet: 'Quiet',
};

export {
  NEW_FIELD_DEFAULTS,
  TRIGGER_TYPES,
  TRIGGER_TYPE_LABELS
};
