import { test, expect } from '@playwright/test';
import path from 'node:path';

test.beforeEach(async ({ page }) => {
  await page.goto('http://127.0.0.1:4173');
  await page.addScriptTag({ path: path.resolve('.cache/engine-test.js') });
});

async function inspect(page, caseName, expectedCase = caseName) {
  const raw = page.locator(`[data-case="${caseName}"]`).first();
  const model = await raw.evaluate(node => window.locatorLensTest.inspect(node));
  expect(model.status, JSON.stringify(model)).toBe('verified');
  expect(model.count).toBe(1);
  expect(model.identityVerified).toBe(true);
  // Execute the complete copied JavaScript using the real Playwright client.
  const locator = new Function('page', `return (${model.javascript});`)(page);
  await expect(locator).toHaveCount(1);
  const expected = await page.locator(`[data-case="${expectedCase}"]`).first().elementHandle();
  expect(await locator.evaluate((node, target) => node === target, expected), model.javascript).toBe(true);
  expect(model.python).toMatch(/^page\./);
  return model;
}

for (const name of ['save','link','icon','disabled','text','image','custom-role','name','password','color-input','textarea','select','checkbox','radio','labelledby','placeholder','placeholder-only','label-only','stable-name','test-id','alt-test','dynamic-id','no-attributes','quoted','selector-chars','odd-attribute','css-id']) {
  test(`real Playwright resolves the exact ${name} element`, async ({ page }) => { await inspect(page, name); });
}

for (const [raw, target] of [['nested-span','nested'],['nested-svg','nested'],['nested-path','nested'],['icon-circle','icon'],['apply-b-span','apply-b']]) {
  test(`normalizes ${raw} to its meaningful interactive parent`, async ({ page }) => {
    const model = await inspect(page, raw, target);
    expect(model.normalized).toBe(true);
  });
}

for (const name of ['apply-a','apply-b','cart-a','cart-b','row-a','row-b','shipping-email','billing-email']) {
  test(`uses parent context for duplicate ${name}`, async ({ page }) => {
    const model = await inspect(page, name);
    expect(model.scoped).toBe(true);
    expect(model.fragile).toBe(false);
    expect(model.javascript).not.toContain('.nth(');
  });
}

test('marks indistinguishable siblings as fragile, but verifies the exact sibling', async ({ page }) => {
  const model = await inspect(page, 'identical-b');
  expect(model.fragile).toBe(true);
  expect(model.confidence).toBe('Fragile');
  expect(model.javascript).toContain('.nth(');
});

test('never uses generated IDs or CSS classes', async ({ page }) => {
  const model = await inspect(page, 'dynamic-id');
  expect(model.javascript).not.toMatch(/ember|css-8fb|jss|class=/);
  expect(model.strategy).toBe('Role');
});

test('uses the requested semantic strategy order', async ({ page }) => {
  expect((await inspect(page, 'save')).strategy).toBe('Role');
  expect((await inspect(page, 'label-only')).strategy).toBe('Label');
  expect((await inspect(page, 'placeholder-only')).strategy).toBe('Placeholder');
  expect((await inspect(page, 'test-id')).strategy).toBe('Test ID');
  expect((await inspect(page, 'text')).strategy).toBe('Text');
});

test('open and nested shadow roots match the real Playwright implementation', async ({ page }) => {
  const raw = page.locator('lens-component').first().locator('[data-case="shadow-span"]');
  const model = await raw.evaluate(node => window.locatorLensTest.inspect(node));
  const locator = new Function('page', `return (${model.javascript})`)(page);
  await expect(locator).toHaveCount(1);
  await expect(locator).toHaveAccessibleName('Shadow primary');
  const deep = await page.locator('[data-case="deep-shadow"]').first().evaluate(node => window.locatorLensTest.inspect(node));
  const deepLocator = new Function('page', `return (${deep.javascript})`)(page);
  await expect(deepLocator).toHaveCount(1);
  expect(await deepLocator.evaluate((node, target) => node === target, await page.locator('[data-case="deep-shadow"]').first().elementHandle())).toBe(true);
});

test('revalidates after SPA replacement and dynamically inserted duplicates', async ({ page }) => {
  const original = await inspect(page, 'save');
  await page.locator('[data-case="save"]').evaluate(node => {
    const duplicate = node.cloneNode(true); duplicate.dataset.case = 'other-save'; node.after(duplicate);
  });
  const staleMatches = await page.evaluate(steps => window.locatorLensTest.query(steps).length, original.steps);
  expect(staleMatches).toBe(2);
  const fresh = await inspect(page, 'save');
  expect(fresh.javascript).not.toBe(original.javascript);
  await page.locator('[data-case="save"]').evaluate(node => node.outerHTML = '<button data-case="save">Save a new version</button>');
  await inspect(page, 'save');
  await page.locator('[data-case="insert"]').click();
  await inspect(page, 'inserted');
});

test('handles hidden elements without falsely validating a visible duplicate', async ({ page }) => {
  const model = await inspect(page, 'hidden-save');
  expect(model.warnings.join(' ')).toContain('not visible');
});

test('accessible names honor label references, hidden reference text, and whitespace', async ({ page }) => {
  await page.evaluate(() => {
    const label = document.createElement('span'); label.id = 'complex-label'; label.hidden = true; label.textContent = '  Send    final   report  ';
    const button = document.createElement('button'); button.dataset.case = 'complex-name'; button.setAttribute('aria-labelledby', label.id); button.textContent = 'Different visible text';
    document.body.append(label, button);
  });
  const model = await inspect(page, 'complex-name');
  expect(model.strategy).toBe('Role');
  expect(model.javascript).toContain('Send final report');
});

test('large repeated lists keep semantic parent scopes and avoid positional locators', async ({ page }) => {
  await page.evaluate(() => {
    const root = document.createElement('section');
    for (let i = 0; i < 600; i++) {
      const article = document.createElement('article');
      const heading = document.createElement('h3'); heading.textContent = `Generated product ${i}`;
      const button = document.createElement('button'); button.textContent = 'Purchase item'; button.dataset.case = `bulk-${i}`;
      article.append(heading, button); root.append(article);
    }
    document.body.append(root);
  });
  const model = await inspect(page, 'bulk-407');
  expect(model.scoped, JSON.stringify(model)).toBe(true);
  expect(model.fragile).toBe(false);
  expect(model.javascript).not.toContain('.nth(');
  test.info().annotations.push({ type: 'performance', description: `${model.elapsedMs} ms for 600 repeated cards` });
});
