'use strict';
// Prova 4/3/2 rounds (targets 85% and 70% of round 1, rounded to 5 s, never faster than ~170 words a minute),
// the follow-up chain, and Mülakat (starts with S1; a group of H answers runs in order of their H number and ends with H8).
// Time is fast-forwarded; speech is stubbed. Questions are compared with the seed at run time.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, dumpStore, seedOf, stubSpeech, mmss } = require('./helpers.cjs');

function target(a, t1, r) {
  const words = a.lines.reduce((n, l) => n + l.en.split(/\s+/).length, 0);
  return Math.max(Math.round(words / 170 * 60) * 1000, Math.round(t1 * (r === 2 ? 0.85 : 0.7) / 5000) * 5000);
}

async function setup(page) {
  requirePass(test);
  await page.route('**/audio*.bin', (r) => r.abort());
  await stubSpeech(page);
  await page.clock.install();
  const seed = await seedOf();
  await unlock(page);
  await page.getByRole('button', { name: 'Prova', exact: true }).first().click();
  return seed;
}

async function talk(page, ms) {
  await page.locator('[data-act="rehStart"]').click();
  await page.clock.fastForward(ms);
  await page.locator('[data-act="rehStop"]').click();
}

test('Prova: three rounds with targets, then the follow-up question', async ({ page }) => {
  const { answers } = await setup(page);
  const a = Object.values(answers).find((x) => (x.fu || []).some((id) => answers[id]) && x.lines.length >= 3);
  const aid = Object.keys(answers).find((id) => answers[id] === a);
  await page.locator('[data-act="openReh"][data-id="' + aid + '"]').first().click();

  // 2:00 first: 85% → 1:40 and 70% → 1:25 (a wrong factor would round to a different 5 s step)
  await talk(page, 120000);
  await expect(page.locator('[data-act="rehRound"]')).toContainText('2. tur · hedef ' + mmss(target(a, 120000, 2)));
  await page.locator('[data-act="rehRound"]').click();
  await expect(page.locator('.ctx').first()).toContainText('tur 2/3 · hedef ' + mmss(target(a, 120000, 2)));
  await talk(page, 100000);
  await expect(page.locator('[data-act="rehRound"]')).toContainText('3. tur · hedef ' + mmss(target(a, 120000, 3)));
  await page.locator('[data-act="rehSave"][data-ok="1"]').click();

  // follow-up chain: the next question is a follow-up of this answer
  await expect(page.locator('.bigq')).toHaveText(answers[a.fu.find((id) => answers[id])].q);
  await page.clock.fastForward(1500);
  const r = (await dumpStore(page))['data/users/local/progress'].reh[aid];
  expect(r.r.length).toBe(2);
  expect(Math.abs(r.r[0] - 120000)).toBeLessThan(2000);
  expect(Math.abs(r.r[1] - 100000)).toBeLessThan(2000);
  expect(r.ok).toBe(true);
});

async function runMock(page, n) {
  const asked = [];
  await page.locator('[data-act="rehMode"][data-m="mock"]').click();
  await page.locator('[data-act="mockStart"]').click();
  for (let k = 0; k < n; k++) {
    asked.push(await page.locator('.bigq').textContent());
    await talk(page, 20000);
    await page.locator('[data-act="rehSave"][data-ok="1"]').click();
  }
  await expect(page.getByRole('heading', { name: 'Mülakat bitti' })).toBeVisible();
  await expect(page.locator('.chainlist li')).toHaveCount(n);
  return asked;
}

test('Mülakat: five questions, starting with S1', async ({ page }) => {
  const { answers } = await setup(page);
  const s1 = Object.values(answers).find((a) => a.code === 'S1');
  test.skip(!s1, 'no S1 answer');
  const asked = await runMock(page, 5);
  expect(asked[0]).toBe(s1.q);
  expect(new Set(asked).size).toBe(5);
});

test('Mülakat in the H group: starts with H1 and ends with H8', async ({ page }) => {
  const { answers } = await setup(page);
  const h = Object.values(answers).filter((a) => /^H\d+$/.test(a.code || ''));
  const h1 = h.find((a) => a.code === 'H1'), h8 = h.find((a) => a.code === 'H8');
  test.skip(!h1 || !h8 || !h1.tag, 'no H group');
  await page.locator('[data-act="grp"][data-g="' + h1.tag + '"]').first().click();
  const asked = await runMock(page, Math.min(5, h.length));
  expect(asked[0]).toBe(h1.q);
  expect(asked[asked.length - 1]).toBe(h8.q);
});
