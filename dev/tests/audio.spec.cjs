'use strict';
// Voice packs are append-only: a device that already has the older packs downloads only the new one,
// and every line of the current seed then has a shipped English and Turkish clip (looked up by "lang|text").
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, dumpStore, writeStore, seedOf } = require('./helpers.cjs');
const fs = require('node:fs'), path = require('node:path');

// ready = this build's packs are installed (__audio.v) and the clip list is published. (META.n counts every clip in
// every pack; a re-voicing pack repeats keys, so the number of distinct clips is lower.)
const ready = (page, timeout) => page.waitForFunction((v) => { try { return JSON.parse(localStorage.getItem('mt1:__audio') || '{}').v === v && Object.keys(window.__LOCAL_AUDIO || {}).length > 100; } catch (e) { return false; } }, META_V(), { timeout: timeout || 120000 });
const META_V = () => META.v;
const META = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8').match(/<script id="audio-meta" type="application\/json">([\s\S]*?)<\/script>/)[1]);

// What the app plays: English questions, English and Turkish lines, Kalıp examples (EN) and situations (TR) (dev/tools/voices.cjs voices the same set).
test('every line has shipped clips in both languages', async ({ page }) => {
  requirePass(test);
  const { answers, data } = await seedOf();
  await unlock(page);
  await ready(page, 120000);
  const texts = [];
  Object.values(answers).forEach((a) => { texts.push('en|' + a.q); a.lines.forEach((l) => { texts.push('en|' + l.en); texts.push('tr|' + l.tr); }); });
  (data.kalip || []).forEach((k) => k.durum.forEach((d) => { texts.push('en|' + d.ex); texts.push('tr|' + d.tr); })); // Prova → Kalıp
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
  await ready(page, 60000);
  const texts = [];
  Object.values(answers).forEach((a) => a.lines.forEach((l) => { texts.push('en|' + l.en); texts.push('tr|' + l.tr); }));
  expect(await page.evaluate((t) => t.filter((k) => !window.__LOCAL_AUDIO[k]), texts)).toEqual([]);
});

// Clips of edited or deleted lines are removed on the device (shipped and voiced-on-device), without downloading again.
test('clips no line uses any more are removed from the device', async ({ page }) => {
  requirePass(test);
  const { answers } = await seedOf();
  await unlock(page);
  await ready(page, 120000);
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
  await ready(page, 120000);

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

// 9A: opening the app reads no clips (only the list of which text has which clip); a clip is read from the phone's
// storage when it is played, offline too, and only the last few stay in memory.
test('clips are read only when played, offline too, and few stay in memory', async ({ page, context }) => {
  requirePass(test);
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () { window.__played = (window.__played || []).concat(this.src); return Promise.resolve(); };
    // count full reads of the clip store (each one walks every clip with its sound)
    const oc = IDBObjectStore.prototype.openCursor;
    IDBObjectStore.prototype.openCursor = function () { if (this.name === 'clips') window.__clipScans = (window.__clipScans || 0) + 1; return oc.apply(this, arguments); };
  });
  await unlock(page);
  await ready(page, 120000);

  await page.reload(); // a normal opening, packs already installed
  await ready(page, 60000);
  const refs = await page.evaluate(() => Object.values(window.__LOCAL_AUDIO));
  expect(refs.every((r) => /^(idb|gen):/.test(r))).toBe(true);
  expect(await page.evaluate(() => window.__clipUrlsKept())).toBe(0);
  expect(await page.evaluate(() => window.__clipScans || 0)).toBe(0); // no clip was read to open the app
  expect((await dumpStore(page)).__clipidx.items.length).toBe(refs.filter((r) => r.startsWith('idb:')).length); // the cached list = the clips on the device

  // a phone from before this change has no list yet: it is built once, then openings read nothing again
  await page.evaluate(() => localStorage.removeItem('mt1:__clipidx'));
  await page.reload();
  await ready(page, 60000);
  expect(await page.evaluate(() => window.__clipScans || 0)).toBe(1);
  await page.reload();
  await ready(page, 60000);
  expect(await page.evaluate(() => window.__clipScans || 0)).toBe(0);

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Dinle', exact: true }).first().click();
  await page.locator('label.tchip', { has: page.locator('#tr-lock') }).click(); // off: clip by clip, with the timers
  await page.locator('[data-act="trackPlay"]').click();
  await expect.poll(() => page.evaluate(() => (window.__played || []).filter((s) => s.startsWith('blob:')).length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__clipUrlsKept())).toBeGreaterThan(0);

  const kept = await page.evaluate((r) => Promise.all(r.map((x) => window.__clipUrl(x))).then(() => window.__clipUrlsKept()), refs.slice(0, 20));
  expect(kept).toBeLessThanOrEqual(8);
});

// A pack that re-voices texts of an older pack (dev/tools/voices.cjs --redo) wins: the clip stored for that key is the newer one.
test('a re-voicing pack replaces the older clips of the same lines', async ({ page }) => {
  requirePass(test);
  const newest = META.packs[META.packs.length - 1];
  await unlock(page);
  await ready(page, 120000);
  const stored = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('mt-audio', 2);
    r.onsuccess = () => { const out = {}, cur = r.result.transaction('clips').objectStore('clips').openCursor();
      cur.onsuccess = () => { const c = cur.result; if (c) { out[c.key] = c.value.p; c.continue(); } else res(out); }; };
  }));
  const fromNewest = Object.keys(stored).filter((k) => stored[k] === newest.v);
  expect(fromNewest.length).toBe(newest.n); // every clip of the newest pack is the one kept for its key
});

// Dinle with the shipped clips: each card is one track in memory, so it goes on while the screen is locked.
test('Dinle: cards are joined from the shipped clips; next, pause, marks, the end of a card and the lock screen', async ({ page }) => {
  requirePass(test);
  const { answers } = await seedOf();
  await unlock(page);
  await ready(page, 120000);
  const fmt = await page.evaluate(async () => {
    const out = {}; // every shipped clip has one format, so any two can be joined
    for (const ref of Object.values(window.__LOCAL_AUDIO)) { const v = await window.__clipBuf(ref); let s; try { s = window.__lock.mp3Clip(new Uint8Array(v.buf)).sig; } catch (e) { s = String(e.message); } out[s] = (out[s] || 0) + 1; }
    return out;
  });
  expect(Object.keys(fmt)).toEqual(['24000 mono 48']);
  await page.evaluate(() => { const ms = navigator.mediaSession, set = ms.setPositionState.bind(ms), on = ms.setActionHandler.bind(ms); window.__pos = []; window.__h = {}; ms.setPositionState = (p) => { if (p) window.__pos.push(p); return set(p); }; ms.setActionHandler = (n, f) => { window.__h[n] = f; return on(n, f); }; });
  const [sid, s1] = Object.entries(answers).find(([, a]) => a.code === 'S1'), N = s1.lines.length;
  await page.getByRole('button', { name: 'Dinle', exact: true }).first().click();
  await page.locator('#tr-scope').selectOption(sid);
  await expect(page.locator('.hero .sub')).toHaveText('Ekran kilitliyken de çalar.');
  const count = page.locator('#player .ctx .mono'), st = (f) => page.evaluate(f);
  const state = () => st(() => { const t = window.__lock.t; return [t.el.paused, t.z.paused]; });
  const jumpToEnd = () => st(() => { const a = window.__lock.t.el; a.currentTime = a.duration - 0.2; });
  const keys = () => st(() => Object.keys(localStorage).sort().join(' '));
  const before = await keys();
  for (const one of [false, true]) for (const m of ['A', 'B', 'C']) {
    await page.evaluate((v) => { window.__lock.t.one = v; }, one);
    await page.locator(`[data-act="trackMode"][data-m="${m}"]`).click();
    await page.locator('[data-act="trackPlay"]').click();
    await expect(count).toHaveText('1/' + N);
    await expect.poll(() => st(() => window.__lock.t.el.currentTime > 0.3 && !window.__lock.t.el.paused)).toBe(true);
    await expect.poll(() => st(() => navigator.mediaSession.metadata.title)).toBe(s1.lines[0].en);
    await page.evaluate(() => { window.__meta = navigator.mediaSession.metadata; window.__pos.length = 0; });
    // lock screen: next, the new sentence on the same metadata object, with its own length, from its start
    await page.evaluate(() => window.__h.nexttrack({ action: 'nexttrack' }));
    await expect(count).toHaveText('2/' + N);
    await expect.poll(() => st(() => navigator.mediaSession.metadata.title)).toBe(s1.lines[1].en);
    const ui = await st(() => ({ same: navigator.mediaSession.metadata === window.__meta, pos: window.__pos[0] }));
    expect(ui.same).toBe(true); expect(ui.pos.position).toBeLessThan(0.6); expect(ui.pos.duration).toBeGreaterThan(1);
    if (!one) expect(Math.abs(ui.pos.duration - await st(() => window.__lock.t.el.duration))).toBeLessThan(0.3);
    // pause keeps the place and the silent player on (an iPhone home-screen app sleeps without it); resume goes on from there
    await expect.poll(state).toEqual([false, false]);
    await expect.poll(() => st(() => window.__lock.t.el.currentTime > 0.3)).toBe(true);
    await page.evaluate(() => window.__h.pause({ action: 'pause' }));
    await expect.poll(state).toEqual([true, false]);
    await expect(page.locator('#player')).toContainText('Duraklatıldı');
    const at = await st(() => window.__lock.t.el.currentTime);
    await page.evaluate(() => window.__h.play({ action: 'play' }));
    await expect.poll(state).toEqual([false, false]);
    expect(await st(() => window.__lock.t.el.currentTime)).toBeGreaterThanOrEqual(at - 0.05);
    await expect(page.locator('[data-act="trackToggle"]')).toContainText('Duraklat');
    if (!one) { await jumpToEnd(); await expect(count).toHaveText('3/' + N); await expect.poll(state).toEqual([false, false]); }
    await page.locator('[data-act="trackPrev"]').click();
    await expect(count).toHaveText((one ? 1 : 2) + '/' + N);
    await page.locator('[data-act="trackStop"]').click();
    await expect(page.locator('[data-act="trackPlay"]')).toBeVisible();
    expect(await state()).toEqual([true, true]);
  }
  await page.evaluate(() => { window.__lock.t.one = false; });
  expect(await keys()).toBe(before); // listening writes no log

  // B: ✓ opens with the English, moves on; ✗ brings the card back later; another sound ends Dinle
  await page.locator('[data-act="trackMode"][data-m="B"]').click();
  await page.locator('[data-act="trackPlay"]').click();
  await expect(count).toHaveText('1/' + N);
  const ok = page.locator('[data-act="mark"][data-v="ok"]');
  await expect(ok).toBeDisabled();
  await expect.poll(() => st(() => window.__lock.t.el.duration > 1)).toBe(true);
  await page.evaluate(() => { const a = window.__lock.t.el; a.currentTime = a.duration * 0.6; });
  await expect(ok).toBeEnabled();
  await ok.click();
  await expect(count).toHaveText('2/' + N);
  await expect.poll(() => st(() => window.__lock.t.el.duration > 1 && !window.__lock.t.el.paused && window.__lock.t.el.currentTime < 5)).toBe(true);
  await page.evaluate(() => { const a = window.__lock.t.el; a.currentTime = a.duration * 0.6; });
  const no = page.locator('[data-act="mark"][data-v="no"]');
  await expect(no).toBeEnabled();
  await no.click();
  await expect(count).toHaveText('2/' + (N + 1));
  await page.getByRole('button', { name: 'Bugün', exact: true }).first().click();
  await page.getByRole('button', { name: 'Dinle', exact: true }).first().click();
  await expect(count).toHaveText(/^\d+\//); // still playing after a look at another tab
  await page.locator('[data-act="trackStop"]').click();

  // a clip that went missing: the timers play the rest
  await page.locator('[data-act="trackPlay"]').click();
  await expect(count).toHaveText('1/' + N);
  await page.evaluate(() => { window.__clipBuf = () => Promise.reject(new Error('clip missing')); });
  for (let i = 0; i < 4; i++) await page.locator('[data-act="trackNext"]').click();
  await expect(count).toHaveText('5/' + N);
  await expect.poll(() => st(() => window.__lock.t.el.paused && window.__lock.t.z.paused)).toBe(true);
  await page.locator('[data-act="trackStop"]').click();
});
