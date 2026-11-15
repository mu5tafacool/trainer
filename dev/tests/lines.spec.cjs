'use strict';
// Cümleler: each answer shows learned/total and a bar (green = settled, interval 7+ days; blue = learned, in review),
// and the group's total sits on top.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, writeStore, seedOf } = require('./helpers.cjs');

test('Cümleler: per-answer bar and group total', async ({ page }) => {
  requirePass(test);
  await page.route('**/audio*.bin', (r) => r.abort());
  const { answers } = await seedOf();
  const aid = Object.keys(answers).find((id) => answers[id].lines.length >= 7);
  const L = answers[aid].lines, N = L.length;
  await unlock(page);
  const c = {};
  L.slice(0, 2).forEach((l) => { c[l.id] = { p: { ivl: 10, ease: 2.5, due: '2026-12-30', reps: 4, lapses: 0 } }; }); // settled
  L.slice(2, 5).forEach((l) => { c[l.id] = { p: { ivl: 1, ease: 2.5, due: '2026-11-16', reps: 1, lapses: 0 } }; }); // learned
  await writeStore(page, { ['data/users/local/srs_' + aid]: { c }, 'data/users/local/progress': { intro: { [aid]: '2026-11-10' }, reh: {}, first: '2026-11-10' } });
  await page.reload();
  await page.getByRole('button', { name: 'Cümleler', exact: true }).first().click();

  const row = page.locator('.anshead[data-id="' + aid + '"]');
  await expect(row.locator('.cnt')).toHaveText('5/' + N);
  const w = (sel) => row.locator(sel).evaluate((e) => parseFloat(e.style.width));
  expect(await w('.lbar .ok')).toBeCloseTo(100 * 2 / N, 0);
  expect(await w('.lbar .lr')).toBeCloseTo(100 * 3 / N, 0);
  await expect(row.locator('.lmeta')).toHaveText('2 oturdu · ' + (N - 5) + ' yeni satır');
  await expect(page.locator('.lsum')).toContainText('5/');
  await expect(page.locator('.lsum')).toContainText('2 oturdu');
  const other = page.locator('.anshead').filter({ hasNot: page.locator('[data-id="' + aid + '"]') }).nth(1);
  await expect(other.locator('.lmeta')).not.toHaveText('');
});
