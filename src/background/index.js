import { DEFAULT_SETTINGS, SETTINGS_KEY, readSettings, writeSettings } from '../shared/settings.js';
import { acceptFrameResult, resolveFramePath } from './frames.js';

let settingsQueue = Promise.resolve();
let offscreenCreation;

async function badge() {
  const settings = await readSettings();
  await Promise.all([
    chrome.action.setBadgeText({ text: settings.enabled ? 'ON' : '' }),
    chrome.action.setBadgeBackgroundColor({ color: '#087f77' }),
    chrome.action.setTitle({ title: `Locator Lens · inspection ${settings.enabled ? 'on' : 'off'}` }),
  ]);
}

async function updateSettings(patch) {
  settingsQueue = settingsQueue.catch(() => {}).then(async () => {
    const previous = await readSettings();
    const settings = await writeSettings(patch);
    if (settings.enabled && !previous.enabled) {
      void chrome.tabs.query({}).then(tabs => Promise.allSettled(tabs.map(tab => ensureTab(tab.id))));
    }
    return settings;
  });
  return settingsQueue;
}

async function ensureTab(tabId) {
  if (!Number.isInteger(tabId)) return { ok: false, reason: 'Open a webpage to start inspecting.' };
  const tab = await chrome.tabs.get(tabId);
  if (!/^(https?|file):/i.test(tab.url ?? '')) return { ok: false, reason: 'Chrome does not allow inspection on this browser page.' };
  if (tab.url.startsWith('file:') && !await chrome.extension.isAllowedFileSchemeAccess()) {
    return { ok: false, reason: 'Enable “Allow access to file URLs” in this extension’s Chrome settings.' };
  }
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ping' }, { frameId: 0 });
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
    } catch {
      return { ok: false, reason: 'This page restricts extensions. Try a regular webpage or reload the tab.' };
    }
  }
  return { ok: true };
}

async function copyText(text) {
  if (typeof text !== 'string' || text.length > 30000) throw new Error('Invalid clipboard text.');
  if (!await chrome.offscreen.hasDocument()) {
    offscreenCreation ??= chrome.offscreen.createDocument({
      url: 'offscreen.html', reasons: ['CLIPBOARD'], justification: 'Copy the selector explicitly requested by the user.',
    }).finally(() => { offscreenCreation = undefined; });
    await offscreenCreation;
  }
  return chrome.runtime.sendMessage({ target: 'offscreen', type: 'clipboard-write', text });
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  await badge();
});
chrome.runtime.onStartup.addListener(() => { void badge(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SETTINGS_KEY]) void badge();
});

chrome.commands.onCommand.addListener(async command => {
  if (command === 'toggle-inspection') {
    const settings = await readSettings();
    await updateSettings({ enabled: !settings.enabled });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!settings.enabled && tab) await ensureTab(tab.id);
  }
  if (command === 'copy-selector') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) await chrome.tabs.sendMessage(tab.id, { type: 'copy-current' }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target === 'offscreen') return;
  const handle = async () => {
    switch (message?.type) {
      case 'settings': return { ok: true, settings: await updateSettings(message.patch ?? {}) };
      case 'ensure-tab': return ensureTab(message.tabId);
      case 'frame-path': return resolveFramePath(sender);
      case 'frame-identified': return { ok: acceptFrameResult(message, sender) };
      case 'frame-active': {
        if (!sender.tab) return { ok: false };
        await chrome.tabs.sendMessage(sender.tab.id, { type: 'active-frame', token: message.token }).catch(() => {});
        return { ok: true };
      }
      case 'copy': return copyText(message.text);
      default: return { ok: false, reason: 'Unknown request.' };
    }
  };
  handle().then(respond, error => respond({ ok: false, reason: error.message }));
  return true;
});
