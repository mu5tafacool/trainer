'use strict';
// Dinle (Listen): previous / pause / next, and ✓ / ✗ marks with undo in mode B. Speech is stubbed and time is fast-forwarded.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, dumpStore, seedOf, makeDue, stubSpeech } = require('./helpers.cjs');

const pos = (page) => page.locator('#player .ctx .mono').first();

async function setup(page) {
  requirePass(test);
  await page.route('**/audio*.bin', (r) => r.abort());
  await stubSpeech(page);
  await page.clock.install();
  const { answers } = await seedOf();
  const aid = Object.keys(answers).find((id) => answers[id].lines.length >= 4);
  const lines = answers[aid].lines.slice(0, 4);
  await unlock(page);
  await makeDue(page, answers, lines.map((l) => l.id));
  await page.reload();
  await page.getByRole('button', { name: 'Dinle', exact: true }).first().click();
  return { aid, lines };
}

test('Dinle: previous, pause, next', async ({ page }) => {
  await setup(page);
  await page.locator('[data-act="trackPlay"]').click();
  await expect(pos(page)).toHaveText(/^1\/4/);
  await page.locator('[data-act="trackNext"]').click();
  await expect(pos(page)).toHaveText(/^2\/4/);
  await page.locator('[data-act="trackNext"]').click();
  await expect(pos(page)).toHaveText(/^3\/4/);
  await page.locator('[data-act="trackPrev"]').click();
  await expect(pos(page)).toHaveText(/^2\/4/);
  await page.locator('[data-act="trackToggle"]').click();
  await expect(page.locator('[data-act="trackToggle"]')).toContainText('Devam');
  await expect(page.locator('#player')).toContainText('Duraklatıldı');
  await page.locator('[data-act="trackToggle"]').click();
  await expect(page.locator('[data-act="trackToggle"]')).toContainText('Duraklat');
  await page.locator('[data-act="trackStop"]').click();
  await expect(page.locator('[data-act="trackPlay"]')).toBeVisible();
});

test('Dinle B: ✓ and ✗ marks change the schedule and can be undone', async ({ page }) => {
  const { aid, lines } = await setup(page);
  // progress is written a moment after a change; let that moment pass before reading it
  const srs = async () => { await page.clock.fastForward(3000); return ((await dumpStore(page))['data/users/local/srs_' + aid] || { c: {} }).c; };
  const before = await srs();
  await page.locator('[data-act="trackPlay"]').click();
  await expect(pos(page)).toHaveText(/^1\/4/);
  const ok = page.locator('[data-act="mark"][data-v="ok"]'), no = page.locator('[data-act="mark"][data-v="no"]');
  await expect(ok).toBeDisabled(); // nothing to grade before the answer is shown
  const reveal = async () => { for (let k = 0; k < 30 && await ok.isDisabled(); k++) { await page.evaluate(() => window.__speechEnd()); await page.clock.fastForward(1500); } await expect(ok).toBeEnabled(); };

  await reveal();
  await ok.click();
  await expect(page.locator('.undo')).toContainText('✓ Bildim');
  expect((await srs())[lines[0].id]).not.toEqual(before[lines[0].id]);
  await expect(pos(page)).toHaveText(/^2\/4/); // ✓ moves on
  await page.locator('[data-act="trackUndo"]').click();
  await expect(pos(page)).toHaveText(/^1\/4/);
  expect((await srs())[lines[0].id]).toEqual(before[lines[0].id]);

  await reveal();
  await no.click();
  await expect(page.locator('.undo')).toContainText('✗');
  await expect(pos(page)).toHaveText(/^1\/5/); // the card comes back later in this session
  await no.click(); // tapping the marked box again undoes it
  await expect(pos(page)).toHaveText(/^1\/4/);
  expect((await srs())[lines[0].id]).toEqual(before[lines[0].id]);
});

test('Dinle B: going back to a card marked ✓ plays its English again', async ({ page }) => {
  const { lines } = await setup(page);
  await page.locator('[data-act="trackPlay"]').click();
  const ok = page.locator('[data-act="mark"][data-v="ok"]');
  for (let k = 0; k < 30 && await ok.isDisabled(); k++) { await page.evaluate(() => window.__speechEnd()); await page.clock.fastForward(1500); }
  await ok.click();
  await expect(pos(page)).toHaveText(/^2\/4/);
  await page.locator('[data-act="trackPrev"]').click();
  await expect(pos(page)).toHaveText(/^1\/4/);
  const n = () => page.evaluate((en) => window.__spoken.filter((t) => t === en).length, lines[0].en);
  const before = await n();
  for (let k = 0; k < 20 && await n() === before; k++) { await page.evaluate(() => window.__speechEnd()); await page.clock.fastForward(1500); }
  expect(await n()).toBe(before + 1);
  await expect(page.locator('#player .sayline')).toHaveText(/^Dinle ve oku · 1\//);
  await expect(ok).toHaveAttribute('aria-pressed', 'true'); // the mark stays
});

test('Dinle: Kilitte çal needs a shipped clip for every line; without one the timers play and the screen says so', async ({ page }) => {
  await setup(page); // no voice packs here
  const sub = page.locator('.hero .sub'), chip = page.locator('#tr-lock');
  await expect(chip).toBeChecked();
  await expect(sub).toHaveText('Ekran açık kalmalı; kilitlenince ses durur. Bu kapsamda 4 cümlenin hazır sesi yok.');
  await page.locator('[data-act="trackPlay"]').click();
  await expect(pos(page)).toHaveText(/^1\/4/);
  expect(await page.evaluate(() => !window.__lock.t.el || window.__lock.t.el.paused)).toBe(true);
  await page.locator('label.tchip', { has: chip }).click(); // off: stops Dinle, kept
  await expect(page.locator('[data-act="trackPlay"]')).toBeVisible();
  await expect(sub).toHaveText('Ekran açık kalmalı; kilitlenince ses durur.');
  await page.clock.fastForward(3000);
  await page.reload();
  await page.getByRole('button', { name: 'Dinle', exact: true }).first().click();
  await expect(chip).not.toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('an old playback report on the device is removed on opening', async ({ page }) => {
  await page.goto('index.html');
  await page.evaluate(() => localStorage.setItem('mt1:__locklog', 'x'));
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem('mt1:__locklog'))).toBe(null);
});

test('Dinle: clips and waits are joined with the shared times (made-up clips, no passphrase)', async ({ page }) => {
  await page.goto('index.html');
  const r = await page.evaluate(() => {
    const L = window.__lock;
    // 24 kHz mono 48 kb/s frames: 144 bytes, 24 ms; first an ID3 tag and an Info frame, which are left out
    const frame = (tag) => { const f = new Uint8Array(144); f.set([0xff, 0xf3, 0x64, 0xc4]); if (tag) f.set([73, 110, 102, 111], 13); return f; };
    const mk = (n) => { const id3 = [0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 5, 1, 2, 3, 4, 5], u = new Uint8Array(15 + 144 * (n + 1)); u.set(id3); u.set(frame(true), 15); for (let i = 1; i <= n; i++) u.set(frame(), 15 + 144 * i); return u; };
    const en = L.mp3Clip(mk(100)), tr = L.mp3Clip(mk(50)), it = (id) => ({ a: { id: 'x', q: 'Where is the bakery?', lines: [] }, l: { id, en: 'The bakery opens at seven.', tr: 'Fırın yedide açılır.' } });
    const clip = (lang) => (lang === 'en' ? en : tr), items = [it('x1'), it('x2'), it('x3')], out = { n: en.n, sig: en.sig, ms: en.ms };
    const steps = (mode, q) => L.steps(items[0], mode, clip, q).map((s) => (s.ref ? s.ph : Math.round(s.ms)));
    out.B = steps('B'); out.C = steps('C', true); out.C2 = steps('C');
    out.rates = [...new Set(L.steps(items[0], 'B', clip).map((s) => s.ph + ' ' + s.rate))];
    out.recall = window.__timing.recallMs(items[0].l.en); out.echo = Math.round(window.__timing.echoMs(2400 / 0.9, items[0].l.en) - 100);
    const size = (t) => t.parts.reduce((m, p) => m + p.length, 0), all = L.join(items.map((x) => ({ it: x })), 'B', clip), one = items.map((x) => L.join([{ it: x }], 'B', clip));
    out.all = { dur: all.dur, bytes: size(all), cards: [...new Set(all.cues.map((c) => c.it.l.id))] };
    out.sum = { dur: one.reduce((n, t) => n + t.dur, 0), bytes: one.reduce((n, t) => n + size(t), 0) };
    out.ends = all.cues.every((c, i) => Math.abs(c.end - (all.cues[i + 1] ? all.cues[i + 1].at : all.dur)) < 1e-9);
    out.bad = (() => { try { L.mp3Clip(new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])); return 'ok'; } catch (e) { return 'thrown'; } })();
    return out;
  });
  expect(r.n).toBe(100); expect(r.sig).toBe('24000 mono 48'); expect(r.ms).toBeCloseTo(2400, 3);
  expect(r.B).toEqual(['tr', r.recall, 'en', r.echo, 'en', r.echo, 'en', r.echo, 600]);
  expect(r.C).toEqual(['q', 900, 'en', 650]); expect(r.C2).toEqual(['en', 650]);
  expect(r.rates).toEqual(['tr 1', 'gap 0.9', 'en 0.9', 'you 0.9', ' 0.9']); // Turkish at its own speed
  // one recording for the list holds the same as a track per card; waits are stored at speed 0.9
  expect(r.all.cards).toEqual(['x1', 'x2', 'x3']);
  expect(r.sum.dur).toBeCloseTo(r.all.dur, 6); expect(r.sum.bytes).toBe(r.all.bytes); expect(r.ends).toBe(true);
  const want = 3 * (1.2 + 3 * 2.4 + (r.recall + 3 * r.echo + 600) / 1000 * 0.9);
  expect(Math.abs(r.all.dur - want)).toBeLessThan(0.2);
  expect(r.all.bytes).toBe(Math.round(r.all.dur / 0.024) * 144);
  expect(r.bad).toBe('thrown');
});
