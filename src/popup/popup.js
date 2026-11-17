import { readSettings, SETTINGS_KEY } from '../shared/settings.js';
import { expression } from '../selector/serialize.js';

const $ = id => document.getElementById(id);
let settings;
let tab;
let pageStatus;

function render() {
  document.body.dataset.enabled = String(settings.enabled);
  $('enabled').setAttribute('aria-checked', String(settings.enabled));
  $('enabled').setAttribute('aria-label', `${settings.enabled ? 'Disable' : 'Enable'} hover inspection`);
  $('mode-label').textContent = settings.enabled ? 'On · hover to inspect' : 'Off · browse as usual';
  $('python').setAttribute('aria-pressed', String(settings.language === 'python'));
  $('javascript').setAttribute('aria-pressed', String(settings.language === 'javascript'));
  $('details').checked = settings.details;
  $('preview').textContent = expression([{ kind: 'role', value: 'button', name: 'Save' }], settings.language);
  if (pageStatus) {
    $('page-status').textContent = pageStatus.ok ? settings.enabled ? 'Active on this page' : 'Ready on this page' : 'Unavailable on this page';
    if (!pageStatus.ok) showError(pageStatus.reason);
  }
}

function showError(message) { $('error').textContent = message; $('error').hidden = false; }

async function change(patch) {
  $('enabled').disabled = true;
  $('error').hidden = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'settings', patch });
    if (!result.ok) throw new Error(result.reason);
    settings = result.settings;
    if (patch.enabled && tab) pageStatus = await chrome.runtime.sendMessage({ type: 'ensure-tab', tabId: tab.id });
    render();
  } catch (error) { showError(error.message); }
  finally { $('enabled').disabled = false; }
}

$('enabled').addEventListener('click', () => change({ enabled: !settings.enabled }));
$('python').addEventListener('click', () => change({ language: 'python' }));
$('javascript').addEventListener('click', () => change({ language: 'javascript' }));
$('details').addEventListener('change', event => change({ details: event.target.checked }));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SETTINGS_KEY]) { settings = changes[SETTINGS_KEY].newValue; render(); }
});

async function init() {
  try {
    settings = await readSettings();
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    render();
    pageStatus = await chrome.runtime.sendMessage({ type: 'ensure-tab', tabId: tab?.id });
    render();
  } catch (error) { showError(error.message); }
}
void init();
