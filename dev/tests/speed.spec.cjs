'use strict';
// Settings → Anlam kontrolü → Hızı ölç: off while the model is off; with the model it writes a short report in the
// agreed format (version, device, timings; no sentences) that Kopyala puts on the clipboard. Model files served
// locally (TRAINER_MODELS) — skipped otherwise.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { MODELS, MODELS_ONLINE, requirePass, unlock, routeModels, seedOf, stubWake } = require('./helpers.cjs');

const MODEL = 'Xenova/mobilebert-uncased-mnli';
const settings = (page) => page.getByRole('button', { name: 'Ayarlar', exact: true }).first().click();

const showSpeed = (page) => page.evaluate(() => { location.hash = 'hiz'; });

test('the app version in index.html matches sw.js', () => {
  const root = path.resolve(__dirname, '..', '..');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8').match(/const V = '([^']+)'/)[1];
  const app = fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/var APP_VER = '([^']+)'/)[1];
  expect(app).toBe(sw);
});

test('Hızı ölç: off without the model, then a copyable report', async ({ page, context }) => {
  requirePass(test);
  test.skip(!MODELS_ONLINE && (!MODELS || !fs.existsSync(path.join(MODELS, MODEL, 'onnx', 'model_quantized.onnx'))), 'TRAINER_MODELS not available');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('**/audio*.bin', (r) => r.abort());
  await routeModels(page);
  const { answers } = await seedOf();
  await unlock(page);
  await showSpeed(page);
  await expect(page.locator('[data-act="nliSpeed"]')).toBeDisabled();
  await expect(page.locator('.speedbox')).toContainText('Önce Anlam kontrolünü aç');

  await page.locator('[data-act="nliEnable"]').click();
  await expect.poll(() => page.evaluate(() => window.__nli.info().state), { timeout: 60000 }).toBe('ready');
  await page.locator('[data-act="nliSpeed"]').click();
  const rep = page.locator('#nlirep');
  await expect(rep).toBeVisible({ timeout: 60000 });
  const txt = await rep.inputValue();
  const lines = txt.split('\n');
  expect(lines[0]).toMatch(/^trainer mt-v\d+ · .+ \(.*\) · model mobilebert-mnli$/);
  expect(lines[1]).toMatch(/^yükleme: (zaten yüklü|\d+\.\d sn \((önbellekten|ilk indirme)\))   ilk kontrol: \d+\.\d sn$/);
  expect(lines[2]).toMatch(/^9 kontrol: medyan \d+ ms · en yavaş \d+ ms$/);
  expect(lines[3]).toMatch(/^gerçek kullanım(: henüz yok| \(son \d+\): medyan \d+ ms)$/);
  // nothing from the answers in the report
  Object.values(answers).forEach((a) => a.lines.forEach((l) => expect(txt).not.toContain(l.en.slice(0, 30))));

  await page.locator('[data-act="nliCopy"]').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(txt);
  console.log('sample report:\n' + txt);
});

test('Hızı ölç: going to the background stops it ("yarıda kaldı"); the screen is kept on while it runs', async ({ page }) => {
  requirePass(test);
  test.skip(!MODELS_ONLINE && (!MODELS || !fs.existsSync(path.join(MODELS, MODEL, 'onnx', 'model_quantized.onnx'))), 'TRAINER_MODELS not available');
  await stubWake(page);
  await page.route('**/audio*.bin', (r) => r.abort());
  await routeModels(page);
  await unlock(page);
  await showSpeed(page);
  await page.locator('[data-act="nliEnable"]').click();
  await expect.poll(() => page.evaluate(() => window.__nli.info().state), { timeout: 60000 }).toBe('ready');
  // slow each check down so there is time to leave in the middle
  await page.evaluate(() => { const j = window.__nli.judge; window.__nli.judge = (a, b) => new Promise((r) => setTimeout(r, 300)).then(() => j(a, b)); });
  await page.locator('[data-act="nliSpeed"]').click();
  await expect.poll(() => page.evaluate(() => window.__wake.held)).toBe(true);
  await page.evaluate(() => window.__setVisible(false));
  await page.evaluate(() => window.__setVisible(true));
  await expect(page.locator('.speedbox')).toContainText('yarıda kaldı', { timeout: 15000 });
  await expect(page.locator('#nlirep')).toHaveCount(0);
});

test('Hızı ölç is hidden until the app is opened with #hiz, and Gizle hides it again', async ({ page }) => {
  requirePass(test);
  await page.route('**/audio*.bin', (r) => r.abort());
  await unlock(page);
  await settings(page);
  await expect(page.locator('[data-act="nliSpeed"]')).toHaveCount(0);
  await showSpeed(page);
  await expect(page.locator('[data-act="nliSpeed"]')).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe(''); // the address is cleaned
  await page.reload();
  await settings(page);
  await expect(page.locator('[data-act="nliSpeed"]')).toBeVisible(); // remembered on this device
  await page.locator('[data-act="speedHide"]').click();
  await expect(page.locator('[data-act="nliSpeed"]')).toHaveCount(0);
});

test('Settings ends with the version, its UTC time and the answer-set version', async ({ page }) => {
  requirePass(test);
  await page.route('**/audio*.bin', (r) => r.abort());
  const root = path.resolve(__dirname, '..', '..');
  const v = fs.readFileSync(path.join(root, 'sw.js'), 'utf8').match(/const V = 'mt-(v\d+)'/)[1];
  const { meta } = await seedOf();
  await unlock(page);
  await settings(page);
  await expect(page.locator('.verline')).toHaveText(new RegExp('^Sürüm ' + v + ' · \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} UTC · cevaplar ' + meta.v + '$'));
});

