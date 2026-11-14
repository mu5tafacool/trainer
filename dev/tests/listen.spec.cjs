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
