const STORAGE_KEY = 'preset-transfer-settings';

function getDefaultSettings() {
  return {
    autoCloseModal: true,
    autoEnableEntry: true,
    leftDisplayMode: 'default',
    rightDisplayMode: 'default',
    singleDisplayMode: 'default',
  };
}

function saveTransferSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('保存设置失败:', error);
  }
}

function loadTransferSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...getDefaultSettings(), ...JSON.parse(saved) } : getDefaultSettings();
  } catch (error) {
    console.warn('加载设置失败，使用默认设置:', error);
    return getDefaultSettings();
  }
}

export {
  getDefaultSettings,
  saveTransferSettings,
  loadTransferSettings,
  STORAGE_KEY
};
