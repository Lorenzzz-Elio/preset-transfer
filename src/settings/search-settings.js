const STORAGE_KEY = 'preset-transfer-search-settings';

function getDefaultSearchSettings() {
  return {
    globalSearch: false,
    includeContent: false,
  };
}

function loadSearchSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...getDefaultSearchSettings(), ...JSON.parse(raw) };
    }
  } catch {
    /* ignore */
  }

  // First-time defaults: everything off.
  const settings = getDefaultSearchSettings();
  saveSearchSettings(settings);
  return settings;
}

function saveSearchSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

function updateSearchSettings(patch) {
  const current = loadSearchSettings();
  const next = { ...current, ...patch };
  saveSearchSettings(next);
  return next;
}

export { STORAGE_KEY, getDefaultSearchSettings, loadSearchSettings, saveSearchSettings, updateSearchSettings };
