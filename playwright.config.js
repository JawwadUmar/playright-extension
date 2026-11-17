import { defineConfig } from '@playwright/test';
import { browserExecutable } from './scripts/browser.mjs';

export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.js', fullyParallel: false,
  workers: 1, retries: 0, timeout: 30000, expect: { timeout: 6000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { headless: true, viewport: { width: 1360, height: 960 }, launchOptions: { executablePath: browserExecutable() }, screenshot: 'only-on-failure' },
  globalSetup: './tests/global-setup.js',
});
