'use strict';
// One timing block for every "say it" time: values for short and long lines, speech speed and Düşünme süresi, the 3 s
// floor and no ceiling; the card timer turns orange after the line's recall time; the speed test counts "in time" per line.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, dumpStore, writeStore, seedOf, makeDue, stubSpeech } = require('./helpers.cjs');

const words = (n) => Array.from({ length: n }, (_, k) => 'w' + k).join(' ');
async function boot(page, settings) {
  requirePass(test);
  await page.route('**/audio*.bin', (r) => r.abort());
  await stubSpeech(page);
  await page.clock.install();
  await unlock(page);
  if (settings) await set(page, settings);
}
async function set(page, settings) {
  const st = await dumpStore(page);
  await writeStore(page, { 'data/users/local/settings': { ...(st['data/users/local/settings'] || {}), ...settings } });
  await page.reload();
}
const T = (page, fn, ...a) => page.evaluate(([fn, a]) => window.__timing[fn](...a), [fn, a]);

test('recall time: (1.5 s + 0.42 s a word ÷ speed) × Düşünme süresi, at least 3 s, no ceiling', async ({ page }) => {
  await boot(page, { rateEn: 1, think: 'normal' });
  expect(await T(page, 'recallMs', words(2))).toBe(3000);
  expect(await T(page, 'recallMs', words(6))).toBe(4000);
  expect(await T(page, 'recallMs', words(12))).toBe(6500);
  expect(await T(page, 'recallMs', words(24))).toBe(11600);
  await set(page, { rateEn: 0.7 });
  expect(await T(page, 'recallMs', words(12))).toBe(8700);
  expect(await T(page, 'recallMs', words(24))).toBe(15900); // above the old 12 s ceiling: saying it alone takes ~14 s
  await set(page, { rateEn: 1, think: 'long' });
  expect(await T(page, 'recallMs', words(12))).toBe(8800);
  await set(page, { think: 'short' });
  expect(await T(page, 'recallMs', words(12))).toBe(4900);
});

test('echo gap follows the clip heard (or the estimate), Prova floor is ~170 words a minute', async ({ page }) => {
  await boot(page, { rateEn: 1 });
  expect(await T(page, 'echoMs', 2000, words(5))).toBe(2900);
  expect(Math.round(await T(page, 'echoMs', 0, words(10)))).toBe(Math.round(4200 * 1.15 + 600));
  expect(await T(page, 'fluentMs', [{ en: words(85) }, { en: words(85) }])).toBe(60000);
});

test('card timer: gray up to the line\'s recall time, then orange (not a flat 3 s)', async ({ page }) => {
  await boot(page);
  const { answers } = await seedOf();
  const all = Object.values(answers).flatMap((a) => a.lines);
  const long = all.filter((l) => l.en.split(/\s+/).length >= 16).slice(0, 1);
  await makeDue(page, answers, long.map((l) => l.id));
  await page.reload();
  await page.locator('[data-act="startReview"]').click();
  const lim = await T(page, 'recallMs', long[0].en);
  expect(lim).toBeGreaterThan(5000);
  // the timer starts once the card's own sound has finished
  for (let k = 0; k < 20; k++) { await page.clock.fastForward(200); await page.evaluate(() => window.__speechEnd()); }
  await page.clock.fastForward(3500);
  await expect(page.locator('#timer')).toHaveText(/\d/);
  await expect(page.locator('#timer')).not.toHaveClass(/slow/);
  await page.clock.fastForward(lim - 3500 + 1000);
  await expect(page.locator('#timer')).toHaveClass(/slow/);
});

test('speed test: "doğru ve süresinde" counts a long line said in 5 s as in time', async ({ page }) => {
  await boot(page);
  const { answers } = await seedOf();
  const all = Object.values(answers).flatMap((a) => a.lines);
  const long = all.filter((l) => l.en.split(/\s+/).length >= 16).slice(0, 1);
  await makeDue(page, answers, long.map((l) => l.id));
  await page.reload();
  await page.getByRole('button', { name: 'Prova', exact: true }).first().click();
  await page.locator('[data-act="rehMode"][data-m="test"]').click();
  await page.locator('[data-act="startTest"]').click();
  await page.clock.fastForward(5000);
  await page.locator('[data-act="testReveal"]').click();
  await expect(page.locator('#timer')).not.toHaveClass(/slow/);
  await page.locator('[data-act="testMark"][data-ok="1"]').click();
  await expect(page.locator('.result')).toContainText('doğru ve süresinde');
  await expect(page.locator('.result')).toContainText('%100');
  await expect(page.getByRole('heading', { name: 'Takılanlar' })).toHaveCount(0);
  await page.clock.fastForward(3000);
  const last = (await dumpStore(page))['data/users/local/tests'].list.slice(-1)[0];
  expect(last).toMatchObject({ n: 1, ok: 1, fast: 1, t: 'len' });
});
