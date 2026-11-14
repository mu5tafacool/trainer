'use strict';
// Both on-device models, end to end with the real model downloads (TRAINER_ONLINE=1; skipped otherwise):
// turned on once in Settings, they stay on after a reload and a seed update, and the
// voice model fills in English lines that have no shipped clip.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, dumpStore, seedOf } = require('./helpers.cjs');

test.setTimeout(15 * 60 * 1000);

test('auto voice and meaning check stay on and keep working', async ({ page }) => {
  requirePass(test);
  test.skip(process.env.TRAINER_ONLINE !== '1', 'set TRAINER_ONLINE=1 to download the models');
  const { meta, data } = await seedOf();
  await page.route('**/audio*.bin', (r) => r.continue());
  await unlock(page);
  await page.waitForFunction(() => window.__LOCAL_AUDIO && Object.keys(window.__LOCAL_AUDIO).length > 100, null, { timeout: 120000 });

  // English lines of the current seed with no shipped clip (e.g. lines whose text changed).
  const missing = await page.evaluate(() => window.__ttsMissing());
  expect(missing.length).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Ayarlar', exact: true }).first().click();
  await page.locator('[data-act="nliEnable"]').click();
  await page.locator('[data-act="ttsEnable"]').click();
  await expect.poll(() => page.evaluate(() => window.__nli.info().state), { timeout: 600000 }).toBe('ready');
  await expect.poll(() => page.evaluate(() => window.__localTTS.info().state), { timeout: 600000 }).toBe('ready');
  // the enable button queues the missing lines; each becomes a stored clip
  await expect.poll(() => page.evaluate((m) => m.filter((t) => !window.__LOCAL_AUDIO['en|' + t]).length, missing), { timeout: 600000 }).toBe(0);

  // reload: still on (idle until first use), clips still there
  await page.reload();
  await page.waitForFunction(() => window.__localTTS && window.__nli);
  expect(await page.evaluate(() => [window.__localTTS.info().state, window.__nli.info().state])).toEqual(['idle', 'idle']);
  await page.waitForFunction((m) => m.every((t) => window.__LOCAL_AUDIO && window.__LOCAL_AUDIO['en|' + t]), missing, { timeout: 60000 });

  // a seed update from the previous version keeps both settings
  const order = data.order || [];
  const prevV = order[order.indexOf(meta.v) - 1];
  await page.evaluate((v) => localStorage.setItem('mt1:__seed', JSON.stringify({ v, at: '2026-01-01T00:00:00.000Z', from: null })), prevV);
  await page.reload();
  await expect.poll(async () => (await dumpStore(page)).__seed.v, { timeout: 30000 }).toBe(meta.v);
  const st = await dumpStore(page);
  expect([st.__tts_on, st.__nli_on]).toEqual([true, true]);

  // the meaning model answers after the reload (loads on first use)
  const sig = await page.evaluate(() => window.__nli.judge('The cat sat on the mat.', 'A cat was sitting on a mat.'));
  expect(sig.fwd.ent).toBeGreaterThan(0.5);
});
