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
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:' + PORT + '/',
    channel: process.env.TRAINER_CHANNEL || undefined,
    serviceWorkers: 'block',
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: 'python3 -m http.server ' + PORT + ' --bind 127.0.0.1',
    cwd: root,
    url: 'http://127.0.0.1:' + PORT + '/index.html',
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
