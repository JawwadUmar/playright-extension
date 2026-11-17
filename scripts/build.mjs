import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { getPlaywrightSource } from './playwright-source.mjs';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'extension');
await fs.mkdir(out, { recursive: true });
const source = await getPlaywrightSource();
for (const name of ['InjectedScript', 'getAriaRole', 'getElementAccessibleNameText', 'getElementLabels', 'elementText', 'isElementVisible', 'beginAriaCaches', 'endAriaCaches']) {
  if (!source.includes(name)) throw new Error(`Pinned Playwright adapter is missing ${name}`);
}
const adapter = `
  // Playwright ${require('playwright-core/package.json').version}, Apache-2.0.
  // Statically bundled; no source evaluation or page injection at runtime.
  const api = (() => {
    const module = { exports: {} };
    ${source}
    class ReadOnlyEvaluator extends InjectedScript {
      _setupGlobalListenersRemovalDetection() {}
      _setupHitTargetInterceptors() {}
      eval() { throw new Error('Dynamic evaluation is disabled in Locator Lens'); }
    }
    return { ReadOnlyEvaluator, getAriaRole, getElementAccessibleNameText, getElementLabels, elementText, isElementVisible, beginAriaCaches, endAriaCaches };
  })();
  export const { getAriaRole, getElementAccessibleNameText, getElementLabels, elementText, isElementVisible } = api;
  export function createEvaluator(window) {
    return new api.ReadOnlyEvaluator(window, {
      isUnderTest: false, sdkLanguage: 'javascript', testIdAttributeName: 'data-testid',
      stableRafCount: 1, browserName: 'chromium', customEngines: [], frameSeq: 0,
    });
  }
  export function withSnapshot(evaluator, work) {
    api.beginAriaCaches();
    evaluator._evaluator.begin();
    try { return work(); }
    finally { evaluator._evaluator.end(); api.endAriaCaches(); }
  }
`;
const adapterPlugin = {
  name: 'pinned-playwright-dom',
  setup(builder) {
    builder.onResolve({ filter: /^playwright-dom$/ }, () => ({ path: 'playwright-dom', namespace: 'adapter' }));
    builder.onLoad({ filter: /.*/, namespace: 'adapter' }, () => ({ contents: adapter, loader: 'js' }));
  },
};
await build({
  absWorkingDir: root,
  entryPoints: { content: 'src/content/index.js', background: 'src/background/index.js', popup: 'src/popup/popup.js', offscreen: 'src/offscreen/offscreen.js' },
  outdir: out, bundle: true, format: 'iife', platform: 'browser', target: 'chrome120',
  legalComments: 'eof', plugins: [adapterPlugin], logLevel: 'info',
});
// A test harness exercises the exact production engine without exposing it to websites.
await build({
  absWorkingDir: root, entryPoints: ['tests/engine-entry.js'], outfile: '.cache/engine-test.js',
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', plugins: [adapterPlugin],
});
for (const [from, to] of [
  ['src/manifest.json', 'manifest.json'], ['src/popup/popup.html', 'popup.html'], ['src/popup/popup.css', 'popup.css'],
  ['src/offscreen/offscreen.html', 'offscreen.html'],
]) await fs.copyFile(path.join(root, from), path.join(out, to));
await fs.cp(path.join(root, 'assets/icons'), path.join(out, 'icons'), { recursive: true });
for (const [from, to] of [['LICENSE', 'PLAYWRIGHT-LICENSE'], ['NOTICE', 'PLAYWRIGHT-NOTICE'], ['ThirdPartyNotices.txt', 'PLAYWRIGHT-ThirdPartyNotices.txt']]) {
  await fs.copyFile(path.join(path.dirname(require.resolve('playwright-core/package.json')), from), path.join(out, to));
}
await fs.copyFile(path.join(root, 'LICENSE'), path.join(out, 'LICENSE'));
await fs.copyFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(out, 'THIRD_PARTY_NOTICES.md'));
console.log('Ready to load: extension/');
