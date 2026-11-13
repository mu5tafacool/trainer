'use strict';
// The on-device NLI model: turned on from Settings, loads offline from local files, judges a pair,
// and the card result switches from rules-only to a model verdict. Needs TRAINER_MODELS (model files, or 'online') — skipped otherwise.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { MODELS, MODELS_ONLINE, requirePass, unlock, seedOf, makeDue, routeModels } = require('./helpers.cjs');

const MODEL = 'Xenova/mobilebert-uncased-mnli';

test('meaning model: enable in Settings, judge, use on a card', async ({ page }) => {
  requirePass(test);
  test.skip(!MODELS_ONLINE && (!MODELS || !fs.existsSync(path.join(MODELS, MODEL, 'onnx', 'model_quantized.onnx'))), 'TRAINER_MODELS with ' + MODEL + ' not available');
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/audio*.bin', (r) => r.abort());
  await routeModels(page);
  const { answers } = await seedOf();
  await unlock(page);

  await page.getByRole('button', { name: 'Ayarlar', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Anlam kontrolü' })).toBeVisible();
  await page.locator('[data-act="nliEnable"]').click();
  await expect.poll(() => page.evaluate(() => window.__nli.info().state), { timeout: 60000 }).toBe('ready');
  await expect(page.locator('section', { has: page.getByRole('heading', { name: 'Anlam kontrolü' }) }).getByText('Açık.')).toBeVisible();

  const same = await page.evaluate(() => window.__nli.judge('We run the smoke tests before every release.', 'We run the smoke tests before every release.'));
  expect(same.fwd.ent).toBeGreaterThan(0.7);
  expect(same.back.ent).toBeGreaterThan(0.7);

  // the setting survives a reload (state "idle" = on, loads on first use)
  await page.reload();
  expect(await page.evaluate(() => window.__nli.info().state)).toBe('idle');

  // on a card: an anlam line said exactly → model verdict "Anlam tam", no "model off" note
  const line = Object.values(answers).flatMap((a) => a.lines).find((l) => l.tier === 'anlam');
  await makeDue(page, answers, [line.id]);
  await page.reload();
  await page.locator('[data-act="startReview"]').click();
  await page.locator('[data-act="dictOpen"]').click();
  await page.fill('#dict', line.en);
  await page.locator('[data-act="dictCheck"]').click();
  await expect(page.locator('.dres')).not.toContainText('kontrol ediliyor', { timeout: 60000 });
  await expect(page.locator('.dres')).toContainText('Anlam tam');
  await expect(page.locator('.dres')).not.toContainText('Anlam modeli kapalı');
  expect(errors).toEqual([]);
});
