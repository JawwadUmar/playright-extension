(() => {
  // src/shared/settings.js
  var DEFAULT_SETTINGS = Object.freeze({ enabled: false, language: "python", details: false });
  var SETTINGS_KEY = "locatorLensSettings";
  function cleanSettings(value = {}) {
    return {
      enabled: value.enabled === true,
      language: value.language === "javascript" ? "javascript" : "python",
      details: value.details === true
    };
  }
  async function readSettings() {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    return cleanSettings(stored[SETTINGS_KEY] ?? DEFAULT_SETTINGS);
  }
  async function writeSettings(patch) {
    const settings = cleanSettings({ ...await readSettings(), ...patch });
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return settings;
  }

  // src/background/frames.js
  var pending = /* @__PURE__ */ new Map();
  function acceptFrameResult(message, sender) {
    const request = pending.get(message.token);
    if (!request || sender.tab?.id !== request.tabId || sender.frameId !== request.parentId) return false;
    pending.delete(message.token);
    clearTimeout(request.timer);
    request.resolve(message.result);
    return true;
  }
  async function locateFrame(tabId, childId, parentId) {
    const token = crypto.randomUUID();
    const result = new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(token);
        resolve(null);
      }, 1800);
      pending.set(token, { tabId, parentId, resolve, timer });
    });
    try {
      await chrome.tabs.sendMessage(tabId, { type: "prepare-frame", token }, { frameId: parentId });
      await chrome.tabs.sendMessage(tabId, { type: "identify-frame", token }, { frameId: childId });
    } catch {
      const request = pending.get(token);
      if (request) {
        pending.delete(token);
        clearTimeout(request.timer);
        request.resolve(null);
      }
    }
    return result;
  }
  async function resolveFramePath(sender) {
    if (!sender.tab || sender.frameId === 0) return { ok: true, steps: [], fragile: false };
    const frames = await chrome.webNavigation.getAllFrames({ tabId: sender.tab.id });
    const chain = [];
    let frame = frames?.find((item) => item.frameId === sender.frameId);
    if (frame?.documentId && sender.documentId && frame.documentId !== sender.documentId) return { ok: false };
    while (frame && frame.frameId !== 0 && chain.length < 20) {
      chain.unshift(frame);
      frame = frames.find((item) => item.frameId === frame.parentFrameId);
    }
    if (!frame || frame.frameId !== 0) return { ok: false };
    const steps = [];
    let fragile = false;
    for (const child of chain) {
      const locator = await locateFrame(sender.tab.id, child.frameId, child.parentFrameId);
      if (locator?.status !== "verified" || !locator.identityVerified || locator.count !== 1) return { ok: false };
      steps.push(...locator.steps, { kind: "frame" });
      fragile ||= locator.fragile;
    }
    return { ok: true, steps, fragile };
  }

  // src/background/index.js
  var settingsQueue = Promise.resolve();
  var offscreenCreation;
  async function badge() {
    const settings = await readSettings();
    await Promise.all([
      chrome.action.setBadgeText({ text: settings.enabled ? "ON" : "" }),
      chrome.action.setBadgeBackgroundColor({ color: "#087f77" }),
      chrome.action.setTitle({ title: `Locator Lens \xB7 inspection ${settings.enabled ? "on" : "off"}` })
    ]);
  }
  async function updateSettings(patch) {
    settingsQueue = settingsQueue.catch(() => {
    }).then(async () => {
      const previous = await readSettings();
      const settings = await writeSettings(patch);
      if (settings.enabled && !previous.enabled) {
        void chrome.tabs.query({}).then((tabs) => Promise.allSettled(tabs.map((tab) => ensureTab(tab.id))));
      }
      return settings;
    });
    return settingsQueue;
  }
  async function ensureTab(tabId) {
    if (!Number.isInteger(tabId)) return { ok: false, reason: "Open a webpage to start inspecting." };
    const tab = await chrome.tabs.get(tabId);
    if (!/^(https?|file):/i.test(tab.url ?? "")) return { ok: false, reason: "Chrome does not allow inspection on this browser page." };
    if (tab.url.startsWith("file:") && !await chrome.extension.isAllowedFileSchemeAccess()) {
      return { ok: false, reason: "Enable \u201CAllow access to file URLs\u201D in this extension\u2019s Chrome settings." };
    }
    try {
      await chrome.tabs.sendMessage(tabId, { type: "ping" }, { frameId: 0 });
    } catch {
      try {
        await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] });
      } catch {
        return { ok: false, reason: "This page restricts extensions. Try a regular webpage or reload the tab." };
      }
    }
    return { ok: true };
  }
  async function copyText(text) {
    if (typeof text !== "string" || text.length > 3e4) throw new Error("Invalid clipboard text.");
    if (!await chrome.offscreen.hasDocument()) {
      offscreenCreation ??= chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["CLIPBOARD"],
        justification: "Copy the selector explicitly requested by the user."
      }).finally(() => {
        offscreenCreation = void 0;
      });
      await offscreenCreation;
    }
    return chrome.runtime.sendMessage({ target: "offscreen", type: "clipboard-write", text });
  }
  chrome.runtime.onInstalled.addListener(async () => {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    if (!stored[SETTINGS_KEY]) await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
    await badge();
  });
  chrome.runtime.onStartup.addListener(() => {
    void badge();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[SETTINGS_KEY]) void badge();
  });
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === "toggle-inspection") {
      const settings = await readSettings();
      await updateSettings({ enabled: !settings.enabled });
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!settings.enabled && tab) await ensureTab(tab.id);
    }
    if (command === "copy-selector") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await chrome.tabs.sendMessage(tab.id, { type: "copy-current" }).catch(() => {
      });
    }
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.target === "offscreen") return;
    const handle = async () => {
      switch (message?.type) {
        case "settings":
          return { ok: true, settings: await updateSettings(message.patch ?? {}) };
        case "ensure-tab":
          return ensureTab(message.tabId);
        case "frame-path":
          return resolveFramePath(sender);
        case "frame-identified":
          return { ok: acceptFrameResult(message, sender) };
        case "frame-active": {
          if (!sender.tab) return { ok: false };
          await chrome.tabs.sendMessage(sender.tab.id, { type: "active-frame", token: message.token }).catch(() => {
          });
          return { ok: true };
        }
        case "copy":
          return copyText(message.text);
        default:
          return { ok: false, reason: "Unknown request." };
      }
    };
    handle().then(respond, (error) => respond({ ok: false, reason: error.message }));
    return true;
  });
})();
