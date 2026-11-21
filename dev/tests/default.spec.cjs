'use strict';
// Cümleler: "Değişti" only on lines the user changed with Düzenle. It opens the app's default for that line (the seed's
// English and Turkish); "Varsayılana dön" drops the user's change and puts the line back on the seed (progress kept,
// a changed English starts its review again, as an edit does). When a seed update changes the default of a line the
// user changed, the box says so and shows the new default. Seed lines carry no old notes (orig/note) since seed v14.
// Lines come from the seed at run time.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, dumpStore, writeStore, seedOf } = require('./helpers.cjs');

async function boot(page) {
  requirePass(test);
  await page.route('**/audio*.bin', (r) => r.abort());
  await page.clock.install();
  await unlock(page);
  return seedOf();
}
const bigAnswer = (answers) => Object.keys(answers).find((id) => answers[id].lines.length >= 5);
const row = (page, l) => page.locator('li.line', { has: page.locator('[data-act="editLine"][data-id="' + l.id + '"]') });
async function openAnswer(page, aid) {
  await page.getByRole('button', { name: 'Cümleler', exact: true }).first().click();
  await page.locator('[data-act="toggleAns"][data-id="' + aid + '"]').click();
}

test('seed: no line carries the old orig / note fields', async () => {
  requirePass(test);
  const { meta, answers } = await seedOf();
  test.skip(parseInt(meta.v.slice(1), 10) < 14, 'seed before v14');
  Object.values(answers).forEach((a) => a.lines.forEach((l) => { expect(l.orig, l.id).toBeUndefined(); expect(l.note, l.id).toBeUndefined(); }));
});

test('Değişti appears only after Düzenle; it shows the default; Varsayılana dön puts the line back on the seed', async ({ page }) => {
  const { answers } = await boot(page);
  const aid = bigAnswer(answers), l = answers[aid].lines[1], other = answers[aid].lines[2];
  await openAnswer(page, aid);
  await expect(page.locator('[data-act="toggleDef"]')).toHaveCount(0); // seed lines: no chip

  // a label-only change is not an edit: still no chip
  await page.locator('[data-act="editLine"][data-id="' + other.id + '"]').click();
  await page.fill('#ed-intent', 'Benim etiketim');
  await page.locator('[data-act="saveEdit"]').click();
  await expect(row(page, other).locator('[data-act="toggleDef"]')).toHaveCount(0);

  // change the English and the Turkish
  await page.locator('[data-act="editLine"][data-id="' + l.id + '"]').click();
  await page.fill('#ed-en', 'A sentence I wrote myself for this line.');
  await page.fill('#ed-tr', 'Bu satır için kendi yazdığım cümle.');
  await page.locator('[data-act="saveEdit"]').click();
  const chip = row(page, l).locator('[data-act="toggleDef"]');
  await expect(chip).toHaveText('Değişti');
  await chip.click();
  await expect(chip).toHaveText('Gizle');
  const box = row(page, l).locator('.defbox');
  await expect(box).toContainText(l.en);
  await expect(box).toContainText(l.tr);
  await page.clock.fastForward(1500);
  let saved = (await dumpStore(page))['answers/' + aid].lines.find((x) => x.id === l.id);
  expect(saved.edited).toBeTruthy();
  expect(saved.def).toMatchObject({ en: l.en, tr: l.tr });

  await box.locator('[data-act="revertLine"]').click();
  await expect(row(page, l).locator('p.en')).toHaveText(l.en);
  await expect(row(page, l).locator('[data-act="toggleDef"]')).toHaveCount(0);
  await page.clock.fastForward(1500);
  saved = (await dumpStore(page))['answers/' + aid].lines.find((x) => x.id === l.id);
  expect(saved.en).toBe(l.en);
  expect(saved.tr).toBe(l.tr);
  expect(saved.edited).toBeUndefined();
  expect(saved.def).toBeUndefined();
});

test('upgrade: a line the user changed keeps its text, gets the new default, and the box says the default changed', async ({ page }) => {
  requirePass(test);
  const { meta, data, answers } = await seedOf();
  const order = data.order || [], prevV = order[order.indexOf(meta.v) - 1];
  test.skip(!prevV, 'no previous seed version');
  const aid = bigAnswer(answers), L = answers[aid].lines[3];
  await unlock(page);
  const before = await dumpStore(page);
  // as on a device from the previous seed: the user changed the line; its default then was an older text
  const mine = { ...L, en: 'My own version of this line.', tr: 'Bu satırın benim sürümüm.', edited: '2026-01-05', def: { en: 'The old default text.', tr: 'Eski varsayılan metin.', tier: L.tier } };
  await writeStore(page, {
    ['answers/' + aid]: { ...before['answers/' + aid], lines: before['answers/' + aid].lines.map((x) => (x.id === L.id ? mine : x)) },
    __seed: { v: prevV, at: '2026-01-01T00:00:00.000Z', from: null },
  });
  await page.reload();
  await expect.poll(async () => (await dumpStore(page)).__seed.v, { timeout: 30000 }).toBe(meta.v);
  const m = (await dumpStore(page))['answers/' + aid].lines.find((x) => x.id === L.id);
  expect(m.en).toBe('My own version of this line.');
  expect(m.def).toMatchObject({ en: L.en, tr: L.tr });
  expect(m.defNew).toBe(1);
  await openAnswer(page, aid);
  await row(page, L).locator('[data-act="toggleDef"]').click();
  await expect(row(page, L).locator('.defbox')).toContainText('Varsayılan güncellendi');
  await expect(row(page, L).locator('.defbox')).toContainText(L.en);
});
