import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expression, quote, toSelector } from '../../src/selector/serialize.js';
import { isStable, cssString } from '../../src/selector/dom.js';

test('serializes exact Python and JavaScript role locators', () => {
  const steps = [{ kind: 'role', value: 'button', name: 'Easy Apply' }];
  assert.equal(expression(steps), 'page.get_by_role("button", name="Easy Apply", exact=True)');
  assert.equal(expression(steps, 'javascript'), 'page.getByRole("button", { name: "Easy Apply", exact: true })');
  assert.equal(toSelector(steps), 'internal:role=button[name="Easy Apply"s]');
});

test('quotes cannot escape copied JavaScript expressions', () => {
  const name = 'x" ); throw new Error("injected"); // \\ \n\t >> [x] \u2028\u2029 雪';
  const code = expression([{ kind: 'text', value: name }], 'javascript');
  const calls = [];
  const page = { getByText: (...args) => calls.push(args) };
  new Function('page', `return (${code});`)(page);
  assert.deepEqual(calls, [[name, { exact: true }]]);
  assert.equal(JSON.parse(quote(name)), name);
});

test('nested filter locators and frame boundaries preserve complete expressions', () => {
  const steps = [
    { kind: 'css', value: 'iframe[title="Payment"]' }, { kind: 'frame' },
    { kind: 'css', value: 'article' }, { kind: 'filterHas', steps: [{ kind: 'role', value: 'heading', name: 'Plan "Pro"' }] },
    { kind: 'role', value: 'button', name: 'Subscribe' }, { kind: 'nth', index: 1 },
  ];
  assert.match(expression(steps), /\.content_frame\.locator\("article"\)\.filter\(has=page\.get_by_role/);
  assert.match(expression(steps, 'javascript'), /\.contentFrame\(\)\.locator\("article"\)\.filter\(\{ has: page\.getByRole/);
  assert.ok(expression(steps).endsWith('.nth(1)'));
});

test('rejects unstable ID formats without discarding readable identifiers', () => {
  for (const value of ['ember462981', ':r18:', '0aefc123-1234-4321-abcd-abcdef012345', 'react-93824', 'css-31a93b2f', 'mui-1234', 'auto_2738']) assert.equal(isStable(value), false, value);
  for (const value of ['save-button', 'checkout', 'profile:address.primary', 'account_settings', 'address2']) assert.equal(isStable(value), true, value);
});

test('CSS attribute values escape quotes, backslashes, and control characters', () => {
  assert.equal(cssString('a"b\\c\nd'), '"a\\"b\\\\c\\a d"');
});

test('custom test ID attributes keep their actual attribute name', () => {
  const code = expression([{ kind: 'css', value: 'button[data-cy="save"]' }]);
  assert.equal(code, 'page.locator("button[data-cy=\\"save\\"]")');
});
