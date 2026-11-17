# Locator Lens

A complete Manifest V3 Chrome extension for finding **verified, unique Playwright locators by hovering**. Enable inspection, hover an element, then click **Copy selector**. Python and JavaScript are supported.

The ready-to-load extension is in [`extension/`](extension/). **Node.js, a build step, an account, and an API key are not needed to use it.**

## Load in Chrome or Edge

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select **`D:\Projects\Job Search\playright-extension\extension`**, the folder containing the built `manifest.json`. On another computer, select this project's `extension` folder.
5. Pin **Locator Lens** from the browser's extensions menu.
6. Open a regular webpage, open the extension popup, and enable **Hover inspection**.
7. Hover an element. Its outline and floating panel appear automatically. Click **Copy selector**.

Select **Python** or **JavaScript** in the popup. The panel immediately follows that setting. The optional **Selector details** setting shows the accessible name and validation information.

Inspection and preferences apply to all accessible tabs and persist across browser restarts. Enabling inspection also attaches to already-open accessible pages. After updating/reloading the extension itself, reload existing webpages to remove the previous content-script instance.

For local HTML files, enable **Allow access to file URLs** in the extension's Chrome settings. For incognito windows, explicitly enable **Allow in Incognito**. Browser-managed pages, the Chrome Web Store, and pages where site access is denied cannot be inspected.

## Use the copied locator

Python, with an existing async Playwright `page`:

```python
await page.get_by_role("button", name="Easy Apply", exact=True).click()
```

JavaScript:

```javascript
await page.getByRole("button", { name: "Easy Apply", exact: true }).click();
```

The clipboard contains the locator expression, starting with `page`. Add `.click()`, `.fill()`, an assertion, or another operation in your script. Python synchronous scripts use the same locator without `await`.

Repeated product cards can produce:

```python
page.locator("article").filter(
    has=page.get_by_role("heading", name="Travel headphones", exact=True)
).get_by_role("button", name="Add to cart", exact=True)
```

Locators inside iframes include the complete path from `page` using `.content_frame` (Python) or `.contentFrame()` (JavaScript). These APIs require Playwright 1.43 or newer; this project's evaluator and tests are pinned to **Playwright 1.65.1**. Use a matching current Playwright version for consistent accessibility behavior.

Shortcuts, configurable at `chrome://extensions/shortcuts`:

| Shortcut | Action |
| --- | --- |
| `Alt+Shift+L` | Toggle inspection |
| `Alt+Shift+C` | Copy the current verified locator |
| `Escape` | Exit inspection while on a webpage |

Normal website events continue to work. The extension does not cancel page clicks, suppress hover events, add attributes to inspected elements, change their classes, or trigger application actions. Only its panel accepts its own pointer interactions.

## How selectors are chosen

Candidates are tried in this order:

1. Role with an exact accessible name.
2. Label for labelled controls, including ARIA label references.
3. Placeholder.
4. `data-testid` through `get_by_test_id`/`getByTestId`. Other common test attributes (`data-test-id`, `data-test`, `data-cy`, `data-qa`) keep their actual attribute names in CSS locators.
5. Exact normalized text.
6. Stable IDs and meaningful attributes such as `name`, `aria-label`, `title`, `alt`, and stable links.
7. Unnamed roles and unique CSS paths.
8. Explicitly fragile, validated positional locators; XPath is an emergency last resort.

Duplicate candidates are refined using unique ancestor locators and identifying headings, links, text, or table cells. The engine never uses CSS classes. It rejects common generated ID patterns, avoids `nth-child`, and prefers parent context to indexes.

Hovering a span or SVG path inside a button or link selects the meaningful interactive parent. Label text can select its associated form control. The outline and element tag refer to the **actual matched target**, and the panel explains normalization such as `Hovered SPAN → matched interactive BUTTON`.

Every recommendation must pass both checks:

```text
number of Playwright matches === 1
matched DOM node === intended target DOM node
```

The validator uses Playwright's own bundled DOM evaluator and accessible-name implementation, rather than approximating `getByRole` or `getByText` with `querySelector`. The same typed locator steps produce the validation query and both clipboard languages. Candidates are checked before display, checked again after asynchronous iframe resolution, and rechecked before copying. Mutations trigger a debounced recheck; scroll and resize update the highlight and hit testing.

If two elements have no distinguishing semantics, a unique `.nth(index)` locator is possible but depends on order. The panel marks it **Fragile** and displays a position warning. An unverified or ambiguous result cannot be copied through the Copy button.

**High**, **Good**, and **Fragile** describe the locator strategy's expected stability. They are heuristics, not percentages or guarantees about future page states. A unique locator is also not a guarantee that the element is enabled, visible, or ready to click; disabled and hidden states are reported separately.

## Architecture

```text
src/
  manifest.json              Manifest V3 and permissions
  shared/settings.js         Validated persistent preferences
  background/
    index.js                 Messaging, badge, injection, clipboard fallback
    frames.js                Frame-owner handshake and verified frame paths
  content/
    index.js                 Inspection lifecycle and orchestration
    hover.js                 Passive pointer detection and hit testing
    highlighter.js           Outline independent of website styles
    overlay-layer.js         Top-layer placement, modal context, and lifecycle
    panel.js                 Closed-shadow floating UI and viewport positioning
  selector/
    dom.js                   Composed-tree traversal and stability heuristics
    generator.js             Prioritized candidate generation and refinement
    validator.js             Playwright matching and identity verification
    serialize.js             Shared query/Python/JavaScript serialization
  popup/                     HTML, CSS, and popup behavior
  offscreen/                 Clipboard support for HTTP/restricted frame contexts
scripts/
  build.mjs                  Static local bundles and packaged assets
  playwright-source.mjs      Version-pinned Playwright DOM adapter
  icons.mjs                  Reproducible toolbar icon assets
  check.mjs                  Package integrity and serialization checks
tests/
  engine.spec.js             Generated expressions executed with real Playwright
  extension.spec.js          Actual loaded-extension browser tests
  fixtures/                  Job cards, shop, forms, dashboard, shadow roots, frames
  unit/                      Escaping, serialization, and ID stability checks
extension/                   Built extension; load this directory in Chrome
```

Content scripts run in Chrome's **isolated world**, in every permitted frame. The panel and outline live in a closed Shadow DOM, so page selectors cannot traverse the UI and website styles do not affect it. No selector or application data is sent to a server.

The overlay uses a fixed manual popover in the browser's top layer, with maximum-z-index positioning as a fallback. It mounts inside the active native dialog or the inspected site's dialog/popover so modal inertness and focus traps do not block Copy. The transparent overlay and its backdrop pass pointer events through; only the panel accepts clicks. New site overlays raise the panel again, and viewport resize/zoom/scroll keep it in view. A newly opened modal clears an inspection of an element that it has made inert; moving the pointer inspects the new modal. This follows the [HTML popover](https://html.spec.whatwg.org/multipage/popover.html) and [modal inertness](https://html.spec.whatwg.org/multipage/interaction.html#inert) rules.

For cross-origin frames, the service worker obtains the browser's frame topology. A short-lived runtime-authorized handshake identifies the owning `iframe` by its actual `contentWindow`, rather than guessing from its URL. Each parent validates a unique locator for that exact frame element; nested paths are composed in order. Identical frame URLs are supported. A path that cannot be verified produces an unavailable result instead of an incorrect top-level locator.

Playwright is bundled **at build time**. There is no runtime package download, CDN, remote script, `eval` requirement, browser-driver connection, or LLM call. The read-only adapter disables Playwright's event interception and global-listener recovery. DOM/accessibility caches live only for one synchronous generation pass and are cleared before the page can change. The internal adapter is version-pinned and must be reviewed when upgrading Playwright.

## Development and tests

Requires Node.js 20+ and npm. The extension itself has no runtime npm dependencies.

```sh
npm ci
npx playwright install chromium
npm run build
npm run check
npm test
```

`npm test` builds and runs real-browser selector and loaded-extension tests. `npm run check` verifies the packaged manifest, local files, JavaScript syntax, and unit tests. `npm run test:unit` runs only unit tests. Use `npm run test:headed` to see browser interactions.

With Python installed, `npm run test:python` additionally parses 192 generated Python expressions, including nested filters, frame paths, control characters, Unicode, and quotes. No Python packages are required for this syntax check.

Tests prefer the pinned Playwright Chromium installation, then an already-installed Playwright Chromium binary. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to override the executable. Chrome/Edge production builds can disable the command-line flags needed for extension tests; use Playwright's Chromium distribution.

```sh
npm run demo
```

Open `http://127.0.0.1:4173` with the unpacked extension enabled to try all test scenarios manually. Stop the demo server before running the tests, since both use port 4173. The cross-origin scenario also uses `http://localhost:4173`.

Browser coverage includes duplicate buttons and placeholders, labels, disabled/hidden controls, nested spans/SVGs, generated IDs/classes, empty elements, special characters, repeated forms/cards/table rows, dynamic insertion and replacement, open/nested Shadow DOM, and same-origin/cross-origin/srcdoc/nested iframes. Each engine test executes the generated JavaScript expression through Playwright and compares the resolved node with the target. Extension tests exercise the real popup, badge, floating panel, clipboard, settings, and hover lifecycle, plus native/nested/shadow-root dialogs, maximum-z-index backdrops, late-opening site popovers, transformed/clipped containers, and viewport resizing. See [manual website checks](tests/MANUAL_TESTS.md) for live-site verification.

## Limitations

- Uniqueness is verified against a page-state snapshot. Navigation, localization, user data, DOM order, or changed accessible names can affect a copied locator later. Revalidate fragile locators in your automation.
- Closed Shadow DOM, browser-owned controls (such as a native select popup), pseudo-elements, and individual pixels inside a canvas are not inspectable as ordinary DOM elements. For a closed shadow tree, only the accessible host can be targeted. [Playwright documents its Shadow DOM boundaries here.](https://playwright.dev/docs/locators#locate-in-shadow-dom)
- Frame inspection requires extension access to the frame and every ancestor needed for a verified path. Browser restrictions, extension-denied origins, or inaccessible shadow-hosted frames can prevent it. The UI stays inside the inspected frame's viewport; very small frames may require scrolling the panel or using the copy shortcut. [Chrome documents content-script frame access here.](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#specify-frames)
- Inspecting a label or nested decoration may intentionally target its associated control/interactive ancestor. The panel names the matched element.
- Browser UI and embedding iframe boundaries cannot be escaped by a webpage overlay. A site that actively removes extension nodes can still conceal the UI; the extension does not modify application code to prevent that.
- `getByTestId` assumes Playwright's default `data-testid`. Other test attributes are emitted explicitly, so they work without a custom test-ID configuration. If your Playwright project overrides `testIdAttribute`, use the displayed test-ID locator only after aligning that configuration.
- Automated job-listing/shop/dashboard tests are synthetic and contain no site-specific rules. Live authenticated LinkedIn and other third-party accounts were not used for automated verification.

License: [MIT](LICENSE). Bundled Playwright notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
