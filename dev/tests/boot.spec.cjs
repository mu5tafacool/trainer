'use strict';
// First unlock on a fresh device: the whole seed lands in storage, the key is kept, the app renders.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, dumpStore, seedOf } = require('./helpers.cjs');

test('first unlock stores every answer and line of the seed', async ({ page }) => {
  requirePass(test);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const { meta, answers } = await seedOf();

  await unlock(page);
  const store = await dumpStore(page);

  expect(store.__seed && store.__seed.v).toBe(meta.v);
  expect(store.__key && store.__key.s).toBe(meta.s);
  const ids = Object.keys(answers).sort();
  expect(Object.keys(store).filter((k) => k.startsWith('answers/')).map((k) => k.slice(8)).sort()).toEqual(ids);
  for (const id of ids) {
    expect(store['answers/' + id].lines.map((l) => l.id), id).toEqual(answers[id].lines.map((l) => l.id));
  }
  for (const tab of ['Bugün', 'Prova', 'Dinle', 'Cümleler', 'Ayarlar']) {
    await expect(page.getByRole('button', { name: tab, exact: true }).or(page.getByRole('tab', { name: tab, exact: true })).first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});
