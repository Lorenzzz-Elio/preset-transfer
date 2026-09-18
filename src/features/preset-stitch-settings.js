import { loadTransferSettings, saveTransferSettings } from '../settings/settings-manager.js';

function getPresetAutomationSettings() {
  const settings = loadTransferSettings();
  return {
    presetAutoMigrateOnImportEnabled: settings.presetAutoMigrateOnImportEnabled === true,
  };
}

function setPresetAutoMigrateOnImportEnabled(enabled) {
  const settings = loadTransferSettings();
  settings.presetAutoMigrateOnImportEnabled = !!enabled;
  saveTransferSettings(settings);
}

export {
  getPresetAutomationSettings,
  setPresetAutoMigrateOnImportEnabled,
};
