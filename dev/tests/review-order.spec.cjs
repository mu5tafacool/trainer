'use strict';
// Tekrar: order and "Bugün geç".
// Order: short intervals first (a day's delay costs a fresh card the most, a mature card little); cards of the same interval
// are mixed, answers interleaved (the answer with most cards left goes next, never the same answer twice when another is left).
// "Bugün geç →" (before Göster, or key G): the card leaves today's list (a second session today doesn't bring it back), its
// schedule and grade don't change, it comes back tomorrow; the head counts "x geçildi", so does the end screen and Bugün.
// A card passed over on 3+ days in a row shows a note; a grade clears the count. Kept in progress.skip only.
// Speech is stubbed; lines come from the seed at run time.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, dumpStore, writeStore, seedOf, stubSpeech } = require('./helpers.cjs');

const card = (page) => page.locator('article.icard').first();
const ymdIn = (page, back) => page.evaluate((b) => { const d = new Date(); d.setDate(d.getDate() - b); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }, back);

async function boot(page) {
  requirePass(test);
  await page.route('**/audio*.bin', (r) => r.abort());
  await stubSpeech(page);
  await page.clock.install();
  await unlock(page);
  return seedOf();
}
// Lines with unique Turkish text, n from each of the given answers (answers with enough lines).
function pick(answers, counts) {
  const seen = new Set(), out = [];
  const ids = Object.keys(answers).filter((id) => answers[id].lines.length >= 4);
  counts.forEach((n, i) => {
    const a = answers[ids[i]], got = [];
    for (const l of a.lines) { if (got.length < n && !seen.has(l.tr)) { seen.add(l.tr); got.push(l); } }
    got.forEach((l) => out.push({ aid: a._id || ids[i], l }));
  });
  return out;
}
// Due today as TR→EN cards with the given interval; progress as the app stores it.
async function due(page, items, progress) {
  const entries = {}, intro = {};
  items.forEach(({ aid, l, ivl }) => {
    intro[aid] = '2026-01-01';
    const k = 'data/users/local/srs_' + aid;
    entries[k] = entries[k] || { c: {} };
    entries[k].c[l.id] = { p: { ivl, ease: 2.5, due: '2026-01-02', reps: 2, lapses: 0 } };
  });
  entries['data/users/local/progress'] = { intro, reh: {}, first: '2026-01-01', ...(progress || {}) };
  await writeStore(page, entries);
  await page.reload();
}
const shownLine = async (page, items) => { const tr = (await card(page).locator('.tr.big').textContent()).trim(); return items.find((x) => x.l.tr === tr); };
async function gradeGood(page) { await page.locator('[data-act="reveal"]').click(); await page.locator('[data-act="grade"][data-g="2"]').click(); }
const srsOf = (st) => Object.fromEntries(Object.entries(st).filter(([k]) => k.includes('/srs_')));

test('order: shortest interval first; inside one interval the answers take turns', async ({ page }) => {
  const { answers } = await boot(page);
  const [a8, b1, c1, d3] = [0, 1, 2, 3].map((i) => pick(answers, [0, 0, 0, 0].map((_, j) => (j === i ? (i === 0 ? 3 : 2) : 0))));
  const items = [...a8.map((x) => ({ ...x, ivl: 8 })), ...b1.map((x) => ({ ...x, ivl: 1 })), ...c1.map((x) => ({ ...x, ivl: 1 })), ...d3.map((x) => ({ ...x, ivl: 3 }))];
  await due(page, items);
  await page.locator('[data-act="startReview"]').click();
  const seen = [];
  for (let i = 0; i < items.length; i++) { seen.push(await shownLine(page, items)); await gradeGood(page); }
  expect(seen.map((x) => x.ivl)).toEqual([1, 1, 1, 1, 3, 3, 8, 8, 8]);
  for (let i = 1; i < 4; i++) expect(seen[i].aid, 'interval 1, card ' + (i + 1)).not.toBe(seen[i - 1].aid);
  await expect(page.getByText('Tekrarlar bitti')).toBeVisible();
});

test('Bugün geç: off today\'s list with no grade and no schedule change, counted, back tomorrow', async ({ page }) => {
  const { answers } = await boot(page);
  const items = pick(answers, [3]).map((x) => ({ ...x, ivl: 1 }));
  await due(page, items);
  const before = srsOf(await dumpStore(page)), t = await ymdIn(page, 0), y = await ymdIn(page, 1);
  await page.locator('[data-act="startReview"]').click();
  const first = await shownLine(page, items);
  await expect(page.locator('[data-act="revSkip"]')).toBeVisible();
  await page.locator('[data-act="revSkip"]').click();
  await expect(page.locator('.sesshead')).toContainText('2 kaldı · 1 geçildi');
  const second = await shownLine(page, items);
  expect(second.l.id).not.toBe(first.l.id);
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await page.keyboard.press('g'); // key G does the same
  await expect(page.locator('.sesshead')).toContainText('1 kaldı · 2 geçildi');
  await page.locator('[data-act="reveal"]').click();
  await expect(page.locator('[data-act="revSkip"]')).toHaveCount(0); // not after Göster: then you grade
  await page.locator('[data-act="grade"][data-g="2"]').click();
  await expect(page.locator('#view')).toContainText('2 geçildi');
  await page.clock.fastForward(1500);
  const st = await dumpStore(page), skip = st['data/users/local/progress'].skip;
  expect(skip[first.l.id + '|p']).toEqual({ d: t, n: 1 });
  expect(skip[second.l.id + '|p']).toEqual({ d: t, n: 1 });
  [first, second].forEach((x) => expect(st['data/users/local/srs_' + x.aid].c[x.l.id]).toEqual(before['data/users/local/srs_' + x.aid].c[x.l.id]));

  // Bugün: nothing left today, the passed-over cards are counted
  await page.locator('[data-act="endSess"]').click();
  await expect(page.locator('[data-act="startReview"]')).toBeDisabled();
  await expect(page.locator('#view')).toContainText('2 kart bugün geçildi');

  // tomorrow (as if passed over yesterday): back in the list, no note after one day
  await writeStore(page, { 'data/users/local/progress': { ...st['data/users/local/progress'], skip: { ...skip, [first.l.id + '|p']: { d: y, n: 1 } } } });
  await page.reload();
  await expect(page.locator('[data-act="startReview"]')).toBeEnabled();
  await page.locator('[data-act="startReview"]').click();
  expect((await shownLine(page, items)).l.id).toBe(first.l.id);
  await expect(page.locator('.skipnote')).toHaveCount(0);
  await page.locator('[data-act="revSkip"]').click(); // passed over a second day in a row
  await page.clock.fastForward(1500);
  expect((await dumpStore(page))['data/users/local/progress'].skip[first.l.id + '|p']).toEqual({ d: t, n: 2 });
});

test('a card passed over on 3 days in a row shows a note; a grade clears the count', async ({ page }) => {
  const { answers } = await boot(page);
  const items = pick(answers, [1]).map((x) => ({ ...x, ivl: 1 })), x = items[0], y = await ymdIn(page, 1);
  await due(page, items, { skip: { [x.l.id + '|p']: { d: y, n: 3 } } });
  await page.locator('[data-act="startReview"]').click();
  await expect(page.locator('.skipnote')).toContainText('3 gündür geçiyorsun');
  await gradeGood(page);
  await page.clock.fastForward(1500);
  expect(((await dumpStore(page))['data/users/local/progress'].skip || {})[x.l.id + '|p']).toBeUndefined();
});
