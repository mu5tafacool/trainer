// Run from the repo root (see CLAUDE.md):
//   TRAINER_PASS=... dev/node_modules/.bin/playwright test -c dev/playwright.config.cjs
// Optional: TRAINER_DATA=<private data checkout> adds the real-sentence fixtures; TRAINER_MODELS=<folder>|online for the model test.
'use strict';
const path = require('node:path');
const { defineConfig } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const PORT = Number(process.env.TRAINER_PORT || 8765);

module.exports = defineConfig({
  testDir: path.join(__dirname, 'tests'),
  testMatch: /.*\.spec\.cjs$/,
  outputDir: process.env.TRAINER_OUT || require('node:os').tmpdir() + '/trainer-test-results',
  timeout: 90000,
  // every test gets its own browser context (own storage), so files and tests run side by side
  fullyParallel: true,
  workers: process.env.TRAINER_WORKERS || '75%',
  reporter: [['dot'], ['html', { outputFolder: require('node:os').tmpdir() + '/trainer-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:' + PORT + '/',
    channel: process.env.TRAINER_CHANNEL || undefined,
    serviceWorkers: 'block',
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: 'node dev/tools/serve.cjs ' + PORT, // handles many parallel connections (python's http.server dropped some)
    cwd: root,
    url: 'http://127.0.0.1:' + PORT + '/index.html',
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
