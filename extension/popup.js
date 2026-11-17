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

  // src/selector/serialize.js
  function quote(value) {
    return JSON.stringify(String(value)).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  }
  function expression(steps, language = "python", base = "page") {
    const py = language === "python";
    let result = base;
    for (const step of steps) {
      const value = quote(step.value ?? "");
      switch (step.kind) {
        case "role":
          result += py ? `.get_by_role(${value}${step.name !== void 0 ? `, name=${quote(step.name)}, exact=True` : ""})` : `.getByRole(${value}${step.name !== void 0 ? `, { name: ${quote(step.name)}, exact: true }` : ""})`;
          break;
        case "label":
        case "placeholder":
        case "text": {
          const names = { label: ["get_by_label", "getByLabel"], placeholder: ["get_by_placeholder", "getByPlaceholder"], text: ["get_by_text", "getByText"] };
          result += py ? `.${names[step.kind][0]}(${value}, exact=True)` : `.${names[step.kind][1]}(${value}, { exact: true })`;
          break;
        }
        case "testId":
          result += `.${py ? "get_by_test_id" : "getByTestId"}(${value})`;
          break;
        case "css":
          result += `.locator(${value})`;
          break;
        case "xpath":
          result += `.locator(${quote(`xpath=${step.value}`)})`;
          break;
        case "filterText":
          result += py ? `.filter(has_text=${value})` : `.filter({ hasText: ${value} })`;
          break;
        case "filterHas": {
          const inner = expression(step.steps, language);
          result += py ? `.filter(has=${inner})` : `.filter({ has: ${inner} })`;
          break;
        }
        case "nth":
          result += `.nth(${step.index})`;
          break;
        case "frame":
          result += py ? ".content_frame" : ".contentFrame()";
          break;
        default:
          throw new Error(`Unsupported code step: ${step.kind}`);
      }
    }
    return result;
  }

  // src/popup/popup.js
  var $ = (id) => document.getElementById(id);
  var settings;
  var tab;
  var pageStatus;
  function render() {
    document.body.dataset.enabled = String(settings.enabled);
    $("enabled").setAttribute("aria-checked", String(settings.enabled));
    $("enabled").setAttribute("aria-label", `${settings.enabled ? "Disable" : "Enable"} hover inspection`);
    $("mode-label").textContent = settings.enabled ? "On \xB7 hover to inspect" : "Off \xB7 browse as usual";
    $("python").setAttribute("aria-pressed", String(settings.language === "python"));
    $("javascript").setAttribute("aria-pressed", String(settings.language === "javascript"));
    $("details").checked = settings.details;
    $("preview").textContent = expression([{ kind: "role", value: "button", name: "Save" }], settings.language);
    if (pageStatus) {
      $("page-status").textContent = pageStatus.ok ? settings.enabled ? "Active on this page" : "Ready on this page" : "Unavailable on this page";
      if (!pageStatus.ok) showError(pageStatus.reason);
    }
  }
  function showError(message) {
    $("error").textContent = message;
    $("error").hidden = false;
  }
  async function change(patch) {
    $("enabled").disabled = true;
    $("error").hidden = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: "settings", patch });
      if (!result.ok) throw new Error(result.reason);
      settings = result.settings;
      if (patch.enabled && tab) pageStatus = await chrome.runtime.sendMessage({ type: "ensure-tab", tabId: tab.id });
      render();
    } catch (error) {
      showError(error.message);
    } finally {
      $("enabled").disabled = false;
    }
  }
  $("enabled").addEventListener("click", () => change({ enabled: !settings.enabled }));
  $("python").addEventListener("click", () => change({ language: "python" }));
  $("javascript").addEventListener("click", () => change({ language: "javascript" }));
  $("details").addEventListener("change", (event) => change({ details: event.target.checked }));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[SETTINGS_KEY]) {
      settings = changes[SETTINGS_KEY].newValue;
      render();
    }
  });
  async function init() {
    try {
      settings = await readSettings();
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      render();
      pageStatus = await chrome.runtime.sendMessage({ type: "ensure-tab", tabId: tab?.id });
      render();
    } catch (error) {
      showError(error.message);
    }
  }
  void init();
})();
