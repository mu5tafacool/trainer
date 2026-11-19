'use strict';
// Prova → Kalıp (seed v11+): patterns from learned lines; a card shows the pattern, its original line and a Turkish situation
// (read aloud), you say a new sentence; Göster plays an example; the 🎤 check looks for the pattern's fixed parts in order and
// frames ✓ Kurdum or ↺ Kuramadım. Kept in progress.kp only (not the review schedule, not Zorlandıklarım). Situations rotate;
// patterns you could not build come first next time. Speech is stubbed; patterns are compared with the seed at run time.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, dumpStore, writeStore, seedOf, stubSpeech, makeDue } = require('./helpers.cjs');

const card = (page) => page.locator('article.icard').first();
const spokenAll = (page) => page.evaluate(() => window.__spoken.filter((t) => t.trim()));
async function boot(page, learnAll) {
  requirePass(test);
  await page.route('**/audio*.bin', (r) => r.abort());
  await stubSpeech(page);
  await page.clock.install();
  await unlock(page);
  const seed = await seedOf();
  if (learnAll) { await makeDue(page, seed.answers, seed.data.kalip.map((k) => k.src)); await page.reload(); }
  await page.getByRole('button', { name: 'Prova', exact: true }).first().click();
  await page.locator('[data-act="rehMode"][data-m="kalip"]').click();
  return seed;
}
const byTr = (kalip) => { const m = {}; kalip.forEach((k) => k.durum.forEach((d, i) => { m[d.tr] = { k, i, d }; })); return m; };
const cur = async (page, m) => m[(await card(page).locator('.tr.big').textContent()).trim()];

test('seed: patterns with a known source line, 2+ situations, examples that contain the fixed parts in order', async () => {
  requirePass(test);
  const { data, answers } = await seedOf();
  const ids = new Set(); Object.values(answers).forEach((a) => a.lines.forEach((l) => ids.add(l.id)));
  expect(data.kalip.length).toBeGreaterThanOrEqual(10);
  data.kalip.forEach((k) => {
    expect(ids.has(k.src), k.id).toBe(true);
    expect(k.durum.length, k.id).toBeGreaterThanOrEqual(2);
    k.durum.forEach((d) => { let at = 0; const t = d.ex.toLowerCase(); k.need.forEach((n) => { const j = t.indexOf(n, at); expect(j, k.id + ': ' + n).toBeGreaterThanOrEqual(0); at = j + n.length; }); });
  });
});

test('🎤 check: fixed parts in order; contractions (with or without the apostrophe), case and punctuation do not count; a missing or swapped part does', async ({ page }) => {
  requirePass(test);
  await unlock(page);
  // made-up phrases (no real answer text in the public repo)
  const r = await page.evaluate(() => {
    const M = window.__kpMatch, need = ['as soon as it was', "we didn't stop the"];
    return [
      M(need, 'As soon as it was dark, we did not stop the robot.'),
      M(need, 'as soon as it was late we didnt stop the cook'),
      M(need, 'As soon as it was dark, we stopped the robot.'),
      M(need, "We didn't stop the robot as soon as it was dark."),
      M(['paint it in layers', 'from'], 'I would paint it in two layers from the wall to the door'),
    ].map((x) => [x.ok, x.miss]);
  });
  expect(r[0]).toEqual([true, []]);
  expect(r[1]).toEqual([true, []]);
  expect(r[2]).toEqual([false, ["we didn't stop the"]]);
  expect(r[3]).toEqual([false, ["we didn't stop the"]]); // order: the second part must come after the first
  expect(r[4][0]).toBe(false); // a part is one run of words
});

test('nothing learned: no session, a hint where patterns come from', async ({ page }) => {
  await boot(page, false);
  await expect(page.locator('[data-act="kpStart"]')).toHaveCount(0);
  await expect(page.getByText('geldikleri satırı öğrenince açılır')).toBeVisible();
});

test('a session: situation read aloud, 🎤 frames Kurdum, Göster plays the example, keys 1/2, result, kept in progress.kp only', async ({ page }) => {
  const { data } = await boot(page, true);
  const m = byTr(data.kalip), n = Math.min(6, data.kalip.length);
  await expect(page.locator('.alist .arow')).toHaveCount(data.kalip.length);
  const st0 = await dumpStore(page), srsBefore = Object.fromEntries(Object.entries(st0).filter(([k]) => k.includes('/srs_'))), hardBefore = (st0['data/users/local/progress'] || {}).hard || {};
  await page.locator('[data-act="kpStart"]').click();

  // card 1: pattern, original line, Turkish situation read aloud; 🎤 with the example → Kalıp geçti, ✓ Kurdum framed
  let c = await cur(page, m);
  await expect(card(page).locator('.kpat')).toHaveText(c.k.kalip);
  await expect(card(page).locator('.kporig')).toContainText('Orijinali:');
  await page.clock.fastForward(300);
  expect(await spokenAll(page)).toContain(c.d.tr);
  await page.locator('[data-act="dictOpen"]').click();
  await page.fill('#dict', c.d.ex);
  await page.locator('[data-act="kpCheck"]').click();
  await expect(page.locator('.dres')).toContainText('Kalıp geçti');
  await expect(page.locator('[data-act="kpMark"][data-ok="1"]')).toHaveClass(/sugg/);
  await expect(card(page).locator('.en .kp').first()).toBeVisible();
  await page.clock.fastForward(300);
  expect(await spokenAll(page)).toContain(c.d.ex);
  await page.locator('[data-act="kpMark"][data-ok="1"]').click();

  // card 2: 🎤 without the pattern → Kalıp eksik, ↺ framed; marked with key 1
  c = await cur(page, m);
  await expect(page.locator('#dict')).toHaveValue(''); // the 🎤 box stays open from the last card, empty
  await page.fill('#dict', 'Something else entirely.');
  await page.locator('[data-act="kpCheck"]').click();
  await expect(page.locator('.dres')).toContainText('Kalıp eksik');
  await expect(page.locator('[data-act="kpMark"][data-ok="0"]')).toHaveClass(/sugg/);
  await page.keyboard.press('1');
  const second = c.k.id;

  // the rest: Space shows (no framing without 🎤), 2 marks
  for (let i = 2; i < n; i++) {
    await expect(card(page).locator('.tr.big')).toBeVisible();
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await page.keyboard.press('Space');
    await expect(page.locator('[data-act="kpMark"]').first()).toBeVisible();
    await expect(page.locator('.btn.sugg')).toHaveCount(0);
    await page.keyboard.press('2');
  }
  await expect(page.getByText('Kalıp oturumu bitti')).toBeVisible();
  await expect(page.locator('.chainlist li')).toHaveCount(n);
  await page.clock.fastForward(1500);
  const st = await dumpStore(page), kp = st['data/users/local/progress'].kp;
  expect(Object.keys(kp).length).toBe(n);
  expect(kp[second]).toMatchObject({ n: 1, ok: false, di: 1 });
  Object.entries(st).filter(([k]) => k.includes('/srs_')).forEach(([k, v]) => expect(v).toEqual(srsBefore[k]));
  expect(st['data/users/local/progress'].hard || {}).toEqual(hardBefore);

  // next session: the one not built comes first, with its next situation
  await page.locator('[data-act="kpStart"]').click();
  c = await cur(page, m);
  expect(c.k.id).toBe(second);
  expect(c.i).toBe(1 % c.k.durum.length);
});
