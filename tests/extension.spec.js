import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { browserExecutable } from '../scripts/browser.mjs';

test.describe.configure({ mode: 'serial' });
let context;
let worker;
let extensionId;
let profile;

test.beforeAll(async ({}, testInfo) => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'locator-lens-tests-'));
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, {
    headless: testInfo.project.use.headless ?? true, executablePath: browserExecutable(), viewport: { width: 1360, height: 960 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
});
test.afterAll(async () => {
  await context?.close();
  // Only the exact temporary directory created by this test run can be removed.
  if (profile && path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('locator-lens-tests-')) {
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

async function settings(patch) {
  await worker.evaluate(async value => {
    const key = 'locatorLensSettings';
    const stored = await chrome.storage.local.get(key);
    await chrome.storage.local.set({ [key]: { enabled: false, language: 'python', details: false, ...stored[key], ...value } });
  }, patch);
}

async function newPage(pathname = '/') {
  await settings({ enabled: false, language: 'python', details: false });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:4173${pathname}`);
  await settings({ enabled: true });
  await expect(page.locator('locator-lens-overlay')).toHaveCount(1);
  return page;
}

// CDP can inspect closed shadow roots for tests. Ordinary page JavaScript and
// Playwright locators cannot see the extension's controls.
async function panelTree(page, frameUrl) {
  let session;
  const frame = frameUrl && page.frames().find(item => item.url() === frameUrl);
  if (frame) {
    try { session = await context.newCDPSession(frame); } catch { /* Same-process frames use their page session. */ }
  }
  session ??= await context.newCDPSession(page);
  await session.send('DOM.enable');
  const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
  const visit = (node, predicate, includeFrames = false) => {
    if (predicate(node)) return node;
    for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? []), ...(includeFrames && node.contentDocument ? [node.contentDocument] : [])]) {
      const found = visit(child, predicate, includeFrames); if (found) return found;
    }
    return null;
  };
  const visiblePanel = node => node.localName === 'section' && (node.attributes ?? []).some((value, index, values) => values[index - 1] === 'style' && value.includes('display: block'));
  const tree = frameUrl ? visit(root, node => node.nodeName === '#document' && node.documentURL === frameUrl && visit(node, visiblePanel), true) : root;
  const host = tree && visit(tree, node => node.localName === 'locator-lens-overlay');
  const panel = host && visit(host, node => node.localName === 'section');
  const code = panel && visit(panel, node => node.localName === 'code');
  const button = panel && visit(panel, node => node.attributes?.includes('data-action') && node.attributes.includes('copy'));
  const text = node => [node.nodeValue ?? '', ...(node.children ?? []).map(text)].join('');
  return { session, panel, code: code ? text(code) : '', button, text: panel ? text(panel) : '' };
}

async function panelCode(page, frameUrl) {
  const result = await panelTree(page, frameUrl);
  await result.session.detach();
  return result.code;
}

async function clickCopy(page, frameUrl) {
  const result = await panelTree(page, frameUrl);
  expect(result.button).toBeTruthy();
  const { model } = await result.session.send('DOM.getBoxModel', { backendNodeId: result.button.backendNodeId });
  const q = model.content;
  await page.mouse.click((q[0] + q[2] + q[4] + q[6]) / 4, (q[1] + q[3] + q[5] + q[7]) / 4);
  await result.session.detach();
}

async function expectCopied(page) {
  await clickCopy(page);
  await expect.poll(async () => {
    const tree = await panelTree(page); await tree.session.detach(); return tree.text;
  }).toContain('Copied');
}

async function expectPanelInViewport(page) {
  const tree = await panelTree(page);
  const { model } = await tree.session.send('DOM.getBoxModel', { backendNodeId: tree.panel.backendNodeId });
  await tree.session.detach();
  const viewport = page.viewportSize();
  const xs = model.border.filter((_, index) => index % 2 === 0);
  const ys = model.border.filter((_, index) => index % 2 === 1);
  expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...xs)).toBeLessThanOrEqual(viewport.width);
  expect(Math.max(...ys)).toBeLessThanOrEqual(viewport.height);
}

test('loads the MV3 worker and popup, persists controls, and updates the badge', async () => {
  await settings({ enabled: false });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByRole('heading', { name: 'Locator Lens' })).toBeVisible();
  await popup.getByRole('switch').click();
  await expect(popup.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  expect(await worker.evaluate(() => chrome.action.getBadgeText({}))).toBe('ON');
  await popup.getByRole('button', { name: 'JavaScript', exact: true }).click();
  await popup.getByLabel('Selector details').check();
  await popup.reload();
  await expect(popup.getByRole('button', { name: 'JavaScript', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(popup.getByLabel('Selector details')).toBeChecked();
  await popup.setViewportSize({ width: 344, height: 560 });
  await popup.screenshot({ path: 'test-results/popup.png' });
  await popup.close();
});

test('hover highlights, updates automatically, copies in one click, and leaves site clicks intact', async () => {
  const page = await newPage();
  await page.locator('[data-case="save"]').hover();
  await expect.poll(() => panelCode(page)).toContain('Save changes');
  expect(await page.locator('locator-lens-overlay').evaluate(node => node.shadowRoot)).toBeNull();
  await page.screenshot({ path: 'test-results/hover-panel.png' });
  await clickCopy(page);
  await expect.poll(async () => {
    const tree = await panelTree(page); await tree.session.detach(); return tree.text;
  }).toContain('Copied');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4173' });
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('page.get_by_role("button", name="Save changes", exact=True)');
  await page.locator('[data-case="link"]').hover();
  await expect.poll(() => panelCode(page)).toContain('Account settings');
  await page.locator('[data-case="save"]').click();
  expect(await page.evaluate(() => window.interactionCount)).toBe(1);
  await page.locator('[data-case="nested-span"]').hover();
  await expect.poll(() => panelCode(page)).toContain('Continue to checkout');
  const tree = await panelTree(page); expect(tree.text).toContain('Hovered SPAN'); await tree.session.detach();
  await settings({ language: 'javascript' });
  await expect.poll(() => panelCode(page)).toContain('page.getByRole(');
  await page.keyboard.press('Escape');
  await expect(page.locator('locator-lens-overlay')).toHaveCount(0);
  await page.close();
});

test('hover inspection follows dynamically inserted and replaced elements', async () => {
  const page = await newPage();
  await page.locator('[data-case="insert"]').click();
  await page.locator('[data-case="inserted"]').hover();
  await expect.poll(() => panelCode(page)).toContain('Loaded after navigation');
  await page.locator('[data-case="inserted"]').evaluate(node => node.outerHTML = '<button data-case="replaced">Replacement control</button>');
  await expect.poll(() => panelCode(page)).toContain('Replacement control');
  await page.close();
});

test('open shadow DOM hovering targets an interactive parent', async () => {
  const page = await newPage();
  await page.locator('lens-component').first().locator('[data-case="shadow-span"]').hover();
  await expect.poll(() => panelCode(page)).toContain('Shadow primary');
  const code = await panelCode(page);
  expect(code).not.toContain('nth');
  await page.close();
});

test('HTTP pages copy through the offscreen clipboard fallback', async () => {
  await settings({ enabled: false, language: 'python' });
  await context.route('http://plain.test/**', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><body><button>Copy on HTTP</button></body></html>',
  }));
  const page = await context.newPage();
  await page.goto('http://plain.test/');
  expect(await page.evaluate(() => isSecureContext)).toBe(false);
  await settings({ enabled: true });
  await expect(page.locator('locator-lens-overlay')).toHaveCount(1);
  await page.getByRole('button', { name: 'Copy on HTTP' }).hover();
  await expect.poll(() => panelCode(page)).toContain('Copy on HTTP');
  await clickCopy(page);
  await expect.poll(async () => {
    const tree = await panelTree(page); await tree.session.detach(); return tree.text;
  }).toContain('Copied');
  expect(await worker.evaluate(() => chrome.offscreen.hasDocument())).toBe(true);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4173' });
  await page.goto('http://127.0.0.1:4173');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Copy on HTTP');
  await page.close();
});

test('copy refuses a locator that became ambiguous while the panel was open', async () => {
  const page = await newPage();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4173' });
  await page.evaluate(() => navigator.clipboard.writeText('unchanged clipboard'));
  await page.locator('[data-case="save"]').hover();
  await expect.poll(() => panelCode(page)).toContain('Save changes');
  const tree = await panelTree(page);
  const { model } = await tree.session.send('DOM.getBoxModel', { backendNodeId: tree.button.backendNodeId });
  await page.mouse.move((model.content[0] + model.content[4]) / 2, (model.content[1] + model.content[5]) / 2);
  await tree.session.detach();
  await page.locator('[data-case="save"]').evaluate(node => node.after(node.cloneNode(true)));
  await clickCopy(page);
  await expect.poll(async () => {
    const current = await panelTree(page); await current.session.detach(); return current.text;
  }).toContain('page changed');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('unchanged clipboard');
  await page.close();
});

test('same-origin, cross-origin, srcdoc, and nested frames include verified frame paths', async () => {
  const page = await newPage();
  const scenarios = [
    { frame: page.frameLocator('iframe[title="Payment details"]'), target: 'frame-button', url: 'http://127.0.0.1:4173/frame.html', name: 'Pay securely' },
    { frame: page.frameLocator('iframe[title="Payment details"]'), target: 'frame-duplicate-b', url: 'http://127.0.0.1:4173/frame.html', name: 'Use this card' },
    { frame: page.frameLocator('iframe[title="Cross origin account"]'), target: 'frame-button', url: 'http://localhost:4173/frame.html?cross=1', name: 'Pay securely' },
    { frame: page.frameLocator('iframe[title="Inline document"]'), target: 'srcdoc-button', url: 'about:srcdoc', name: 'Save inline document' },
    { frame: page.frameLocator('iframe[title="Payment details"]').frameLocator('iframe[title="Confirmation"]'), target: 'deep-frame-button', url: 'http://127.0.0.1:4173/deep-frame.html', name: 'Confirm transfer' },
  ];
  for (const scenario of scenarios) {
    await scenario.frame.locator(`[data-case="${scenario.target}"]`).hover();
    await expect.poll(() => panelCode(page, scenario.url), { timeout: 10000 }).toContain(scenario.name);
    const python = await panelCode(page, scenario.url);
    expect(python).toContain('.content_frame.');
    await settings({ language: 'javascript' });
    await expect.poll(() => panelCode(page, scenario.url)).toContain('.contentFrame()');
    const code = await panelCode(page, scenario.url);
    const locator = new Function('page', `return (${code});`)(page);
    await expect(locator).toHaveCount(1);
    await expect(locator).toHaveText(scenario.name);
    await settings({ language: 'python' });
  }
  await page.close();
});

test('identical iframe URLs and titles resolve to the exact hovered frame', async () => {
  const page = await newPage();
  await page.locator('iframe[title="Payment details"]').evaluate(node => node.after(node.cloneNode(true)));
  const frame = page.frameLocator('iframe[title="Payment details"]').nth(1);
  const target = frame.locator('[data-case="frame-button"]');
  await target.hover();
  const url = 'http://127.0.0.1:4173/frame.html';
  await expect.poll(() => panelCode(page, url)).toContain('Pay securely');
  await settings({ language: 'javascript' });
  await expect.poll(() => panelCode(page, url)).toContain('.contentFrame()');
  const code = await panelCode(page, url);
  const locator = new Function('page', `return (${code});`)(page);
  await expect(locator).toHaveCount(1);
  expect(await locator.evaluate((node, expected) => node === expected, await target.elementHandle())).toBe(true);
  const tree = await panelTree(page, url);
  expect(tree.text).toContain('iframe path is position dependent');
  await tree.session.detach();
  await page.close();
});

test('panel stays clickable above maximum-z-index job cards and clipped modal containers', async () => {
  const page = await newPage('/overlays.html');
  await page.locator('#outside').hover();
  await expect.poll(() => panelCode(page)).toContain('Ordinary page action');
  await page.evaluate(() => window.openCssModal());
  await page.locator('#css-next').hover();
  await expect.poll(() => panelCode(page)).toContain('Continue application');
  await expectPanelInViewport(page);
  await expectCopied(page);
  await expect(page.getByRole('dialog', { name: 'Job application' })).toBeVisible();
  await page.screenshot({ path: 'test-results/modal-overlay.png' });
  await page.close();
});

test('native modal backdrops do not dim or block Copy and showing the panel preserves page focus', async () => {
  const page = await newPage('/overlays.html');
  await page.locator('#outside').hover();
  await expect.poll(() => panelCode(page)).toContain('Ordinary page action');
  await page.locator('#native-modal').evaluate(dialog => dialog.showModal());
  await page.locator('#native-field').fill('applicant@example.test');
  await page.locator('#native-next').hover();
  await expect.poll(() => panelCode(page)).toContain('Next step');
  await expect(page.locator('#native-field')).toBeFocused();
  await expectPanelInViewport(page);
  await expectCopied(page);
  expect(await page.locator('#native-modal').evaluate(dialog => dialog.matches(':modal'))).toBe(true);
  await page.locator('#native-next').click();
  expect(await page.evaluate(() => window.modalClicks)).toBe(1);
  await page.screenshot({ path: 'test-results/native-modal-overlay.png' });
  await page.locator('#native-modal').evaluate(dialog => dialog.close());
  await page.locator('#outside').hover();
  await expect.poll(() => panelCode(page)).toContain('Ordinary page action');
  await expectCopied(page);
  await page.close();
});

test('later top-layer site popovers do not cover the existing selector panel', async () => {
  const page = await newPage('/overlays.html');
  await page.locator('#outside').hover();
  await expect.poll(() => panelCode(page)).toContain('Ordinary page action');
  await page.locator('#site-popover').evaluate(popover => popover.showPopover());
  // Keep the existing selector: no new hover is required to lift the panel.
  await expectCopied(page);
  expect(await page.locator('#site-popover').evaluate(popover => popover.matches(':popover-open'))).toBe(true);
  await page.close();
});

test('Copy inside an automatic site popover leaves that popover open', async () => {
  const page = await newPage('/overlays.html');
  await page.locator('#auto-popover').evaluate(popover => popover.showPopover());
  await page.locator('#auto-action').hover();
  await expect.poll(() => panelCode(page)).toContain('Manage account menu');
  await expectCopied(page);
  expect(await page.locator('#auto-popover').evaluate(popover => popover.matches(':popover-open'))).toBe(true);
  await page.close();
});

test('native dialogs inside open shadow roots allow panel interaction', async () => {
  const page = await newPage('/overlays.html');
  await page.locator('modal-component').locator('dialog').evaluate(dialog => dialog.showModal());
  await page.locator('#shadow-action').hover();
  await expect.poll(() => panelCode(page)).toContain('Save shadow modal');
  await expectPanelInViewport(page);
  await expectCopied(page);
  expect(await page.locator('modal-component').locator('dialog').evaluate(dialog => dialog.matches(':modal'))).toBe(true);
  await page.close();
});

test('nested modal transitions use the active dialog even when DOM order differs', async () => {
  const page = await newPage('/overlays.html');
  // Open the later DOM sibling first; the last DOM dialog is not always topmost.
  await page.locator('#second-modal').evaluate(dialog => dialog.showModal());
  await page.locator('#second-next').hover();
  await expect.poll(() => panelCode(page)).toContain('Finish application');
  await page.locator('#native-modal').evaluate(dialog => dialog.showModal());
  await page.locator('#native-next').hover();
  await expect.poll(() => panelCode(page)).toContain('Next step');
  await expectCopied(page);
  await page.locator('#native-modal').evaluate(dialog => dialog.close());
  await page.locator('#second-next').hover();
  await expect.poll(() => panelCode(page)).toContain('Finish application');
  await expectCopied(page);
  await page.close();
});

test('transformed page roots and viewport resizing do not clip the panel', async () => {
  const page = await newPage('/overlays.html');
  await page.evaluate(() => {
    Object.assign(document.documentElement.style, { transform: 'translate(37px, 23px)', overflow: 'hidden', contain: 'paint', height: '80vh', width: '85vw' });
  });
  await page.locator('#outside').hover();
  await expect.poll(() => panelCode(page)).toContain('Ordinary page action');
  await expectPanelInViewport(page);
  await expectCopied(page);
  await page.setViewportSize({ width: 320, height: 320 });
  await expect(() => expectPanelInViewport(page)).toPass({ timeout: 6000 });
  await expectCopied(page);
  await page.close();
});
