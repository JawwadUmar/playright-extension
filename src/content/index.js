import { readSettings, SETTINGS_KEY } from '../shared/settings.js';
import { SelectorGenerator } from '../selector/generator.js';
import { meaningfulTarget, deepElements } from '../selector/dom.js';
import { expression } from '../selector/serialize.js';
import { FloatingPanel } from './panel.js';
import { HoverDetector } from './hover.js';

// Static content scripts and on-demand injection can meet in already-open tabs.
if (!globalThis.__locatorLensInstalled) {
  install();
  globalThis.__locatorLensInstalled = true;
}

function install() {
  let settings = { enabled: false, language: 'python', details: false };
  let engine;
  let panel;
  let hover;
  let observer;
  let shadowObserver;
  let selected;
  let revision = 0;
  let refreshTimer;
  let layoutFrame;
  // randomUUID is restricted to secure contexts; getRandomValues also works
  // on ordinary HTTP pages, including in Chrome's isolated content world.
  const token = [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const preparedFrames = new Map();
  const getEngine = () => engine ??= new SelectorGenerator(window);
  const send = message => chrome.runtime.sendMessage(message);
  const framePath = () => window === window.top ? Promise.resolve({ ok: true, steps: [], fragile: false }) : send({ type: 'frame-path' });

  function render() {
    if (!selected || !panel) return;
    panel.render({ ...selected, code: expression(selected.fullSteps, settings.language), settings }, selected.target, selected.point);
  }

  function hide() {
    revision++;
    selected = undefined;
    panel?.hide();
    hover?.cancel();
  }

  async function inspect(raw, point, force = false) {
    if (!settings.enabled || !panel || panel.ownsNode(raw) || (!force && panel.isEngaged())) return;
    const target = meaningfulTarget(raw, element => getEngine().validator.role(element));
    if (!target || !target.isConnected) return;
    if (!force && selected?.target === target) {
      panel.highlighter.show(target);
      return;
    }
    const currentRevision = ++revision;
    try {
      let model = getEngine().generate(target);
      const path = model.status === 'verified' ? await framePath() : { ok: true, steps: [] };
      if (currentRevision !== revision || !settings.enabled || !target.isConnected) return;
      if (!path.ok) model = getEngine().unavailable('The iframe path could not be verified. Reload this frame or check the extension’s site access.');
      else if (model.status === 'verified' && !getEngine().validator.validate(model.steps, target).valid) {
        model = getEngine().unavailable('The page changed during validation. Hover again.');
      }
      if (path.fragile && model.status === 'verified') {
        model = { ...model, confidence: 'Fragile', score: Math.min(model.score, 38), warnings: [...model.warnings, 'The iframe path is position dependent.'] };
      }
      selected = { target, rawTag: raw.tagName, point, model, fullSteps: [...(path.steps ?? []), ...model.steps] };
      shadowObserver?.disconnect();
      shadowObserver = new MutationObserver(scheduleRefresh);
      let root = target.getRootNode();
      while (root instanceof ShadowRoot) {
        shadowObserver.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
        root = root.host.getRootNode();
      }
      render();
      void send({ type: 'frame-active', token }).catch(() => {});
    } catch (error) {
      if (currentRevision === revision && panel) panel.error(`Inspection unavailable: ${error.message}`, true);
    }
  }

  async function copy() {
    const snapshot = selected;
    if (!snapshot || snapshot.model.status !== 'verified') return;
    panel.copying();
    try {
      if (!getEngine().validator.validate(snapshot.model.steps, snapshot.target).valid) {
        panel.error('The page changed. Hover the element again before copying.', true);
        return;
      }
      const path = await framePath();
      if (selected !== snapshot || !settings.enabled) return;
      if (!path.ok || !getEngine().validator.validate(snapshot.model.steps, snapshot.target).valid) {
        panel.error('The element or iframe changed. Hover again before copying.', true);
        return;
      }
      snapshot.fullSteps = [...path.steps, ...snapshot.model.steps];
      const text = expression(snapshot.fullSteps, settings.language);
      panel.code.textContent = text;
      let copied = false;
      if (window.isSecureContext) {
        try { await navigator.clipboard.writeText(text); copied = true; } catch { /* HTTP and iframe fallback below. */ }
      }
      if (!copied) {
        const response = await send({ type: 'copy', text });
        if (!response?.ok) throw new Error(response?.reason ?? 'Clipboard unavailable. Select and copy the displayed code.');
      }
      if (selected === snapshot) panel.copied();
    } catch (error) {
      if (selected === snapshot) panel.error(error.message);
    }
  }

  function scheduleRefresh(records) {
    if (!selected || refreshTimer) return;
    if (records?.length && records.every(record => panel?.ownsNode(record.target)
      || (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(node => panel?.ownsNode(node))))) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      if (!selected || !panel) return;
      if (!selected.target.isConnected || !getEngine().validator.validate(selected.model.steps, selected.target).valid) {
        if (panel.isEngaged()) panel.error('The page changed. Hover the element again before copying.', true);
        else { hide(); hover.resample(); }
      } else {
        panel.highlighter.show(selected.target);
        panel.position(selected.target, selected.point);
        hover.resample();
      }
    }, 180);
  }

  function layout() {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = undefined;
      if (selected && panel) {
        panel.highlighter.show(selected.target);
        panel.position(selected.target, selected.point);
      }
      hover?.resample();
    });
  }

  function keydown(event) {
    if (event.key === 'Escape' && !event.repeat) void send({ type: 'settings', patch: { enabled: false } }).catch(() => {});
  }

  function applySettings(next) {
    settings = next;
    if (settings.enabled && !panel) {
      panel = new FloatingPanel({
        onCopy: () => { void copy(); },
        onDisable: () => { void send({ type: 'settings', patch: { enabled: false } }); },
        onEnter: () => { revision++; hover?.cancel(); }, onLeave: () => hover?.resample(),
      });
      hover = new HoverDetector({ ownsEvent: event => panel.ownsEvent(event), engaged: () => panel.isEngaged(), onHover: inspect, onLeave: hide });
      hover.start();
      observer = new MutationObserver(scheduleRefresh);
      observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      window.addEventListener('scroll', layout, { capture: true, passive: true });
      window.addEventListener('resize', layout, { passive: true });
      document.addEventListener('keydown', keydown, true);
    } else if (!settings.enabled && panel) {
      hide();
      hover.stop();
      observer.disconnect();
      shadowObserver?.disconnect();
      panel.destroy();
      panel = undefined;
      hover = undefined;
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
      cancelAnimationFrame(layoutFrame);
      layoutFrame = undefined;
      window.removeEventListener('scroll', layout, true);
      window.removeEventListener('resize', layout);
      document.removeEventListener('keydown', keydown, true);
    } else if (panel && selected) render();
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    switch (message?.type) {
      case 'ping': respond({ ok: true }); break;
      case 'active-frame': if (message.token !== token) hide(); respond({ ok: true }); break;
      case 'copy-current': void copy(); respond({ ok: true }); break;
      case 'prepare-frame':
        preparedFrames.set(message.token, performance.now() + 3000);
        for (const [key, expiry] of preparedFrames) if (expiry < performance.now()) preparedFrames.delete(key);
        respond({ ok: true });
        break;
      case 'identify-frame':
        if (window !== window.parent) window.parent.postMessage({ source: 'locator-lens-frame', token: message.token }, '*');
        respond({ ok: true });
        break;
      default: break;
    }
  });

  window.addEventListener('message', event => {
    const data = event.data;
    if (data?.source !== 'locator-lens-frame' || !preparedFrames.has(data.token)) return;
    const expiry = preparedFrames.get(data.token);
    preparedFrames.delete(data.token);
    if (expiry < performance.now()) return;
    const frame = deepElements(document, 'iframe,frame').find(node => node.contentWindow === event.source);
    if (!frame) return;
    const result = getEngine().generate(frame);
    void send({ type: 'frame-identified', token: data.token, result }).catch(() => {});
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SETTINGS_KEY]) applySettings(changes[SETTINGS_KEY].newValue ?? { enabled: false });
  });
  void readSettings().then(applySettings).catch(() => {});
}
