import { spawnSync } from 'node:child_process';
import { expression } from '../src/selector/serialize.js';

const texts = ['Easy Apply', 'x"y\'z', 'back\\slash', 'new\nline\r\t', 'literal >> [selector]', '雪 ₹ 🙂', '\u2028\u2029', '\0\x01'];
const expressions = [];
for (const value of texts) {
  for (const kind of ['role', 'label', 'placeholder', 'testId', 'text', 'css', 'xpath', 'filterText']) {
    const step = kind === 'role' ? { kind, value: 'button', name: value } : { kind, value };
    expressions.push(expression([step]));
    expressions.push(expression([{ kind: 'css', value: 'iframe[title="Payment"]' }, { kind: 'frame' }, step]));
    expressions.push(expression([{ kind: 'css', value: 'article' }, { kind: 'filterHas', steps: [step] }, { kind: 'role', value: 'button', name: 'Save' }, { kind: 'nth', index: 1 }]));
  }
}
const result = spawnSync(process.env.PYTHON ?? 'python', ['tests/validate_python.py'], { input: JSON.stringify(expressions), encoding: 'utf8' });
if (result.error) throw result.error;
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
