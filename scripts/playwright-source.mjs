import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
export async function getPlaywrightSource() {
  const file = require.resolve('playwright-core/lib/coreBundle');
  const bundle = await fs.readFile(file, 'utf8');
  const start = bundle.indexOf('// packages/playwright-core/src/generated/injectedScriptSource.ts');
  const section = bundle.slice(start, bundle.indexOf('\n});', start) + 4);
  const literal = section.match(/\bsource\d* = ('(?:\\.|[^'\\])*');/s)?.[1];
  if (!literal) throw new Error('Playwright internal format changed; review the pinned adapter.');
  // Build time only: decode the trusted, pinned package's JavaScript string literal.
  return vm.runInNewContext(literal, Object.create(null), { timeout: 1000 });
}

if (process.argv.includes('--inspect')) {
  const source = await getPlaywrightSource();
  for (const needle of process.argv.filter(arg => arg.startsWith('--find=')).map(arg => arg.slice(7)).concat(process.argv.some(arg => arg.startsWith('--find=')) ? [] : ['var InjectedScript =', 'constructor(', 'getElementAccessibleName(', 'getElementLabels(', 'parseSelector(selector)', 'querySelectorAll(selector', 'customEngines', 'eval('])) {
    const start = source.indexOf(needle, needle === 'constructor(' ? source.indexOf('var InjectedScript =') : 0);
    console.log(needle, start, source.slice(start, start + 1500));
  }
  console.log('ending:', source.slice(-600));
}
