import { loadTransferSettings, saveTransferSettings } from '../settings/settings-manager.js';

function getPresetAutomationSettings() {
  const settings = loadTransferSettings();
  return {
    presetAutoMigrateOnImportEnabled: settings.presetAutoMigrateOnImportEnabled === true,
    presetGitAutoUpdateEnabled: settings.presetGitAutoUpdateEnabled === true,
    presetGitSources: settings.presetGitSources && typeof settings.presetGitSources === 'object' ? settings.presetGitSources : {},
  };
}

function setPresetAutoMigrateOnImportEnabled(enabled) {
  const settings = loadTransferSettings();
  settings.presetAutoMigrateOnImportEnabled = !!enabled;
  saveTransferSettings(settings);
}

function setPresetGitAutoUpdateEnabled(enabled) {
  const settings = loadTransferSettings();
  settings.presetGitAutoUpdateEnabled = !!enabled;
  saveTransferSettings(settings);
}

function getPresetGitSource(normalizedBase) {
  const settings = loadTransferSettings();
  const sources = settings.presetGitSources && typeof settings.presetGitSources === 'object' ? settings.presetGitSources : {};
  const key = String(normalizedBase ?? '').trim();
  const source = key ? sources[key] : null;
  return source && typeof source === 'object' ? source : null;
}

function setPresetGitSource(normalizedBase, source) {
  const key = String(normalizedBase ?? '').trim();
  if (!key) return false;

  const settings = loadTransferSettings();
  const sources = settings.presetGitSources && typeof settings.presetGitSources === 'object' ? settings.presetGitSources : {};

  settings.presetGitSources = {
    ...sources,
    [key]: {
      repoUrl: String(source?.repoUrl ?? '').trim(),
      filePath: String(source?.filePath ?? '').trim(),
      tagTemplate: String(source?.tagTemplate ?? '').trim(),
      refTemplate: String(source?.refTemplate ?? 'v{version}').trim() || 'v{version}',
    },
  };

  saveTransferSettings(settings);
  return true;
}

function removePresetGitSource(normalizedBase) {
  const key = String(normalizedBase ?? '').trim();
  if (!key) return false;

  const settings = loadTransferSettings();
  const sources = settings.presetGitSources && typeof settings.presetGitSources === 'object' ? settings.presetGitSources : {};
  if (!Object.prototype.hasOwnProperty.call(sources, key)) return false;

  const { [key]: _, ...rest } = sources;
  settings.presetGitSources = rest;
  saveTransferSettings(settings);
  return true;
}

export {
  getPresetAutomationSettings,
  setPresetAutoMigrateOnImportEnabled,
  setPresetGitAutoUpdateEnabled,
  getPresetGitSource,
  setPresetGitSource,
  removePresetGitSource,
};
