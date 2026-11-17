import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const manifest = JSON.parse(await fs.readFile('extension/manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.ok(manifest.content_scripts.every(script => script.all_frames && script.world === 'ISOLATED'));
assert.ok(!manifest.content_security_policy.extension_pages.includes('unsafe-eval'));
for (const file of ['background.js','content.js','popup.js','offscreen.js']) {
  const result = spawnSync(process.execPath, ['--check', `extension/${file}`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
const files = [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(script => script.js), 'popup.css', 'offscreen.html', 'PLAYWRIGHT-LICENSE'];
for (const file of files) await fs.access(`extension/${file}`);
const result = spawnSync(process.execPath, ['--test', 'tests/unit/serialize.test.mjs'], { stdio: 'inherit' });
if (result.status) process.exit(result.status);
console.log('Manifest, packaged files, JavaScript syntax, and serialization checks passed.');
