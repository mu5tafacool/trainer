// Store screenshots for the manifest (Chrome's install sheet shows them). Only screens without answer text: Settings.
//   TRAINER_PASS=... node dev/tools/screenshots.cjs   → shot-narrow.png (780×1688), shot-wide.png (1280×800)
'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));
const ROOT = path.resolve(__dirname, '..', '..'), PORT = 8791;
(async () => {
  if (!process.env.TRAINER_PASS) throw new Error('TRAINER_PASS is not set');
  const srv = spawn('node', [path.join(__dirname, 'serve.cjs'), String(PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const b = await chromium.launch();
  try {
    for (const [name, vp, scale] of [['shot-narrow.png', { width: 390, height: 844 }, 2], ['shot-wide.png', { width: 1280, height: 800 }, 1]]) {
      const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: scale, colorScheme: 'light' });
      const page = await ctx.newPage();
      await page.route('**/audio*.bin', (r) => r.abort());
      await page.goto('http://127.0.0.1:' + PORT + '/index.html');
      await page.fill('#gate-pass', process.env.TRAINER_PASS);
      await page.locator('#gate-form button[type=submit]').click();
      await page.locator('#gate').waitFor({ state: 'hidden', timeout: 60000 });
      await page.getByRole('button', { name: 'Ayarlar', exact: true }).first().click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(ROOT, name) });
      await ctx.close();
    }
  } finally { await b.close(); srv.kill(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
