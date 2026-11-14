'use strict';
// Voice packs are append-only: a device that already has the older packs downloads only the new one,
// and every line of the current seed then has a shipped English and Turkish clip (looked up by "lang|text").
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, dumpStore, writeStore, seedOf } = require('./helpers.cjs');
const fs = require('node:fs'), path = require('node:path');

const META = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8').match(/<script id="audio-meta" type="application\/json">([\s\S]*?)<\/script>/)[1]);

// What the app plays: English questions, English and Turkish lines (dev/tools/voices.cjs voices the same set).
test('every line has shipped clips in both languages', async ({ page }) => {
  requirePass(test);
  const { answers } = await seedOf();
  await unlock(page);
  await page.waitForFunction((n) => window.__LOCAL_AUDIO && Object.keys(window.__LOCAL_AUDIO).length >= n, META.n - 50, { timeout: 120000 });
  const texts = [];
  Object.values(answers).forEach((a) => { texts.push('en|' + a.q); a.lines.forEach((l) => { texts.push('en|' + l.en); texts.push('tr|' + l.tr); }); });
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

// Clips of edited or deleted lines are removed on the device (shipped and voiced-on-device), without downloading again.
test('clips no line uses any more are removed from the device', async ({ page }) => {
  requirePass(test);
  const { answers } = await seedOf();
  await unlock(page);
  await page.waitForFunction((n) => window.__LOCAL_AUDIO && Object.keys(window.__LOCAL_AUDIO).length >= n, META.n - 50, { timeout: 120000 });
  const count = (store) => page.evaluate((st) => new Promise((res) => { const r = indexedDB.open('mt-audio', 2); r.onsuccess = () => { const q = r.result.transaction(st).objectStore(st).count(); q.onsuccess = () => res(q.result); }; }), store);
  await expect.poll(() => page.evaluate(() => window.__pruneAudio()).then(() => count('clips')), { timeout: 30000 }).toBeLessThan(META.n + 1);
  const before = await count('clips');

  // a device-voiced clip for a text no line uses, and one for a text a pack already covers
  const aid = Object.keys(answers)[0], line = answers[aid].lines[0];
  await page.evaluate(([t1, t2]) => new Promise((res) => {
    const r = indexedDB.open('mt-audio', 2);
    r.onsuccess = () => { const tx = r.result.transaction('gen', 'readwrite'); const st = tx.objectStore('gen');
      st.put({ text: t1, type: 'audio/wav', buf: new ArrayBuffer(8) }, 'en|' + t1); st.put({ text: t2, type: 'audio/wav', buf: new ArrayBuffer(8) }, 'en|' + t2); tx.oncomplete = res; };
  }), ['A sentence that no answer has any more.', line.en]);
  await page.reload();
  await page.waitForFunction((n) => window.__LOCAL_AUDIO && Object.keys(window.__LOCAL_AUDIO).length >= n, META.n - 50, { timeout: 120000 });

  // the user edits a line: its old clips (en + tr) go a few seconds later
  const fetched = [];
  page.on('request', (r) => { if (/\/audio[^/]*\.bin$/.test(r.url())) fetched.push(r.url()); });
  await page.evaluate(([id, lid]) => {
    const k = 'mt1:answers/' + id, a = JSON.parse(localStorage.getItem(k));
    a.lines = a.lines.map((l) => (l.id === lid ? { ...l, en: l.en + ' Edited.', tr: l.tr + ' Düzenlendi.', edited: true } : l));
    localStorage.setItem(k, JSON.stringify(a));
  }, [aid, line.id]);
  await page.reload();
  await expect.poll(() => count('gen'), { timeout: 30000 }).toBe(0);
  await expect.poll(() => count('clips'), { timeout: 30000 }).toBe(before - 2);
  expect(await page.evaluate(([e, t]) => [!!window.__LOCAL_AUDIO['en|' + e], !!window.__LOCAL_AUDIO['tr|' + t]], [line.en, line.tr])).toEqual([false, false]);
  expect(fetched).toEqual([]);
});
