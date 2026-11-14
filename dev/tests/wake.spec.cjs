'use strict';
// Keeping the screen on: held while studying, let go after 5 minutes untouched, kept while Dinle plays,
// let go when the app is hidden and taken back when it returns. navigator.wakeLock is stubbed; time is fast-forwarded.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, seedOf, makeDue, stubSpeech, stubWake } = require('./helpers.cjs');

const held = (page) => page.evaluate(() => window.__wake.held);

async function setup(page) {
  requirePass(test);
  await page.route('**/audio*.bin', (r) => r.abort());
  await stubSpeech(page);
  await stubWake(page);
  await page.clock.install();
  const { answers } = await seedOf();
  const aid = Object.keys(answers).find((id) => answers[id].lines.length >= 3);
  await unlock(page);
  await makeDue(page, answers, answers[aid].lines.slice(0, 3).map((l) => l.id));
  await page.reload();
}

test('study session: held, released after 5 idle minutes, back on touch, follows visibility', async ({ page }) => {
  await setup(page);
  expect(await held(page)).toBe(false);
  await page.locator('[data-act="startReview"]').click();
  await expect.poll(() => held(page)).toBe(true);

  await page.clock.fastForward(4 * 60 * 1000);
  expect(await held(page)).toBe(true);
  await page.clock.fastForward(90 * 1000); // past 5 minutes untouched; checked every 30 s
  await expect.poll(() => held(page)).toBe(false);

  await page.mouse.click(5, 5); // any touch takes it back
  await expect.poll(() => held(page)).toBe(true);

  await page.evaluate(() => window.__setVisible(false));
  await expect.poll(() => held(page)).toBe(false);
  await page.evaluate(() => window.__setVisible(true));
  await expect.poll(() => held(page)).toBe(true);
});

test('Dinle: kept while playing even untouched, released on pause', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Dinle', exact: true }).first().click();
  await page.locator('[data-act="trackPlay"]').click();
  await expect.poll(() => held(page)).toBe(true);
  await page.clock.fastForward(7 * 60 * 1000);
  expect(await held(page)).toBe(true);
  await page.locator('[data-act="trackToggle"]').click();
  await expect.poll(() => held(page)).toBe(false);
});
