'use strict';
// Both on-device models, end to end with the real model downloads (TRAINER_ONLINE=1; skipped otherwise):
// turned on once in Settings, they stay on after a reload and a seed update, the voice model fills in English lines
// that have no shipped clip, and "Kapat" / "Modeli sil" turn each one off (keeping or deleting only its own files).
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

  // a line edited on the phone has no shipped clip
  const { answers } = await seedOf();
  const aid = Object.keys(answers)[0], lid = answers[aid].lines[0].id;
  await page.evaluate(([id, l]) => {
    const k = 'mt1:answers/' + id, a = JSON.parse(localStorage.getItem(k));
    a.lines = a.lines.map((x) => (x.id === l ? { ...x, en: 'This sentence was written on the phone today.', edited: true } : x));
    localStorage.setItem(k, JSON.stringify(a));
  }, [aid, lid]);
  await page.reload();
  await page.waitForFunction(() => window.__LOCAL_AUDIO && Object.keys(window.__LOCAL_AUDIO).length > 100, null, { timeout: 120000 });
  const missing = await page.evaluate(() => window.__ttsMissing());
  expect(missing).toContain('This sentence was written on the phone today.');

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

  // Kapat / Modeli sil, from Settings
  page.on('dialog', (d) => d.accept());
  const cached = (id) => page.evaluate((m) => caches.open('transformers-cache').then((c) => c.keys()).then((ks) => ks.filter((r) => r.url.includes(m)).length), id);
  const gen = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('mt-audio', 2); r.onsuccess = () => { const q = r.result.transaction('gen').objectStore('gen').count(); q.onsuccess = () => res(q.result); }; }));
  const VOICE = 'onnx-community/Kokoro-82M-v1.0-ONNX', NLI = 'Xenova/mobilebert-uncased-mnli';
  expect(await cached(VOICE)).toBeGreaterThan(0);
  expect(await cached(NLI)).toBeGreaterThan(0);
  const clips = await gen();

  await page.getByRole('button', { name: 'Ayarlar', exact: true }).first().click();
  await page.locator('[data-act="nliOff"]').click();
  await expect.poll(() => page.evaluate(() => window.__nli.info().state)).toBe('off');
  expect((await dumpStore(page)).__nli_on).toBeUndefined();
  expect(await cached(NLI)).toBeGreaterThan(0); // files kept
  await page.reload();
  expect(await page.evaluate(() => window.__nli.info().state)).toBe('off');
  await page.getByRole('button', { name: 'Ayarlar', exact: true }).first().click();
  await page.locator('[data-act="nliEnable"]').click(); // back on from the kept files
  await expect.poll(() => page.evaluate(() => window.__nli.info().state), { timeout: 60000 }).toBe('ready');

  await page.locator('[data-act="ttsDrop"]').click();
  await expect.poll(() => cached(VOICE)).toBe(0);
  expect(await page.evaluate(() => window.__localTTS.info().state)).toBe('off');
  expect(await cached(NLI)).toBeGreaterThan(0); // the other model is untouched
  expect(await gen()).toBe(clips); // voiced clips stay

  await page.locator('[data-act="nliDrop"]').click();
  await expect.poll(() => cached(NLI)).toBe(0);
  const end = await dumpStore(page);
  expect([end.__tts_on, end.__nli_on]).toEqual([undefined, undefined]);
  expect(end['data/users/local/progress']).toEqual(st['data/users/local/progress']);
});
