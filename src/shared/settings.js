export const DEFAULT_SETTINGS = Object.freeze({ enabled: false, language: 'python', details: false });
export const SETTINGS_KEY = 'locatorLensSettings';

export function cleanSettings(value = {}) {
  return {
    enabled: value.enabled === true,
    language: value.language === 'javascript' ? 'javascript' : 'python',
    details: value.details === true,
  };
}

export async function readSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return cleanSettings(stored[SETTINGS_KEY] ?? DEFAULT_SETTINGS);
}

export async function writeSettings(patch) {
  const settings = cleanSettings({ ...await readSettings(), ...patch });
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}
