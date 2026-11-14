'use strict';
// Voice packs are append-only: a device that already has the older packs downloads only the new one,
// and every line of the current seed then has a shipped English and Turkish clip (looked up by "lang|text").
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, dumpStore, writeStore, seedOf } = require('./helpers.cjs');
const fs = require('node:fs'), path = require('node:path');

const META = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8').match(/<script id="audio-meta" type="application\/json">([\s\S]*?)<\/script>/)[1]);

test('every line has shipped clips in both languages', async ({ page }) => {
  requirePass(test);
  const { answers } = await seedOf();
  await unlock(page);
  await page.waitForFunction((n) => window.__LOCAL_AUDIO && Object.keys(window.__LOCAL_AUDIO).length >= n, META.n - 50, { timeout: 120000 });
  const texts = [];
  Object.values(answers).forEach((a) => a.lines.forEach((l) => { texts.push('en|' + l.en); texts.push('tr|' + l.tr); }));
  const missing = await page.evaluate((t) => t.filter((k) => !window.__LOCAL_AUDIO[k]), texts);
  expect(missing).toEqual([]);
});

test('a device with the older packs downloads only the new pack', async ({ page }) => {
  requirePass(test);
  test.skip(META.packs.length < 2, 'only one pack');
  const { answers } = await seedOf();
  const newest = META.packs[META.packs.length - 1];
  await unlock(page);
  await page.waitForFunction(() => window.__LOCAL_AUDIO && Object.keys(window.__LOCAL_AUDIO).length > 100, null, { timeout: 120000 });

  // pretend this device was installed before the newest pack: drop its clips and its id
  await page.evaluate((v) => new Promise((res, rej) => {
    const r = indexedDB.open('mt-audio', 2);
    r.onsuccess = () => {
      const tx = r.result.transaction('clips', 'readwrite'), cur = tx.objectStore('clips').openCursor();
      cur.onsuccess = () => { const c = cur.result; if (!c) return; if (c.value.p === v) c.delete(); c.continue(); };
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    };
  }), newest.v);
  const st = await dumpStore(page);
  await writeStore(page, { __audio: { ...st.__audio, v: 'a-old', packs: st.__audio.packs.filter((v) => v !== newest.v) } });

  const fetched = [];
  page.on('request', (r) => { const m = r.url().match(/\/(audio[^/]*\.bin)$/); if (m) fetched.push(m[1]); });
  await page.reload();
  await expect.poll(async () => ((await dumpStore(page)).__audio || {}).v, { timeout: 60000 }).toBe(META.v);
  expect(fetched).toEqual([newest.file]);

  // the new pack's lines play its clips, not the device voice
  await page.waitForFunction((n) => Object.keys(window.__LOCAL_AUDIO || {}).length >= n, META.n - 50, { timeout: 60000 });
  const texts = [];
  Object.values(answers).forEach((a) => a.lines.forEach((l) => { texts.push('en|' + l.en); texts.push('tr|' + l.tr); }));
  expect(await page.evaluate((t) => t.filter((k) => !window.__LOCAL_AUDIO[k]), texts)).toEqual([]);
});
