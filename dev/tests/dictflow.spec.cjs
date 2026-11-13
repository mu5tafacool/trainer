'use strict';
// The card's "Söyle ve kontrol et" flow with the v3 checker, end to end in the page (model off).
// What is "said" is derived from the real line at run time, so no sentence text lives in this file.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, seedOf, makeDue } = require('./helpers.cjs');

const GRADE = ['Tekrar', 'Zor', 'İyi'];

function pickLines(answers) {
  const all = Object.values(answers).flatMap((a) => a.lines);
  const num = (l) => /\b\d{2,}\b/.test(l.en) && !/\d[,.]\d/.test(l.en);
  return {
    ezberNum: all.find((l) => l.tier === 'ezber' && num(l)) || all.find((l) => l.tier === 'ezber'),
    anlamNot: all.find((l) => l.tier === 'anlam' && /\bnot\b/.test(l.en)),
  };
}

async function openCard(page, line) {
  // Cards are shuffled: answer the other card with an empty skip until this line's Turkish text is shown.
  for (let k = 0; k < 4; k++) {
    if (await page.getByText(line.tr, { exact: false }).first().isVisible().catch(() => false)) return;
    await page.locator('[data-act="reveal"]').click();
    await page.locator('[data-act="grade"][data-g="2"]').click();
  }
  throw new Error('card not reached: ' + line.id);
}

async function check(page, said) {
  if (await page.locator('[data-act="dictOpen"]').isVisible()) await page.locator('[data-act="dictOpen"]').click();
  await page.fill('#dict', said);
  await page.locator('[data-act="dictCheck"]').click();
  await expect(page.locator('.dres')).toBeVisible();
  const sugg = await page.locator('.grade.sugg').textContent();
  return { sugg: GRADE.find((g) => sugg.includes(g)), text: await page.locator('.dres').textContent() };
}

test('spoken check v3 on review cards (rules only)', async ({ page }) => {
  requirePass(test);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/audio*.bin', (r) => r.abort());
  const { answers } = await seedOf();
  const { ezberNum, anlamNot } = pickLines(answers);
  await unlock(page);

  const runs = [
    [ezberNum, ezberNum.en, 'İyi', null],
    [ezberNum, ezberNum.en.replace(/\b(\d{2,})\b/, (m) => String(Number(m) + 7)), 'Tekrar', 'Sayı farklı'],
  ];
  if (anlamNot) runs.push([anlamNot, anlamNot.en.replace(/\bnot\b\s*/, ''), 'Tekrar', 'Olumsuzluk eksik']);
  if (anlamNot) runs.push([anlamNot, anlamNot.en, 'İyi', 'Anlam tam']);

  for (const [line, said, want, mustSay] of runs) {
    await makeDue(page, answers, [line.id]);
    await page.reload();
    await page.locator('[data-act="startReview"]').click();
    await openCard(page, line);
    const r = await check(page, said);
    expect(r.sugg, line.id + ' → ' + want).toBe(want);
    if (mustSay) expect(r.text).toContain(mustSay);
    if (line.tier === 'anlam') expect(r.text).toContain('Anlam modeli kapalı');
  }
  expect(errors).toEqual([]);
});
