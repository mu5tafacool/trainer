'use strict';
// Zorlandıklarım: points per struggle (Tekrar 3, Zor 2, …), joins at 3, leaves after good recalls on two different days,
// shown as a Dinle scope and a Hız testi pool; Dinle ✗ can be undone. Pekiştir keys: P, Space, R, Esc.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, dumpStore, writeStore, seedOf, makeDue, stubSpeech } = require('./helpers.cjs');

const card = (page) => page.locator('article.icard').first();
async function end(page) {
  for (let k = 0; k < 30; k++) { await page.clock.fastForward(100); if (await page.evaluate(() => window.__speechEnd())) return; }
  throw new Error('nothing was being spoken');
}
async function boot(page) {
  requirePass(test);
  await page.route('**/audio*.bin', (r) => r.abort());
  await stubSpeech(page);
  await page.clock.install({ time: new Date('2026-03-02T09:00:00') });
  await unlock(page);
}
const hard = async (page) => { await page.clock.fastForward(3000); return ((await dumpStore(page))['data/users/local/progress'] || {}).hard || {}; };
async function reviewOne(page, g) {
  for (let k = 0; k < 20 && !(await page.locator('[data-act="reveal"]').isVisible()); k++) { await page.evaluate(() => window.__speechEnd()); await page.clock.fastForward(300); }
  await page.locator('[data-act="reveal"]').click();
  await page.locator('[data-act="grade"][data-g="' + g + '"]').click();
}
async function dueLines(page, n) {
  const { answers } = await seedOf();
  const aid = Object.keys(answers).find((id) => answers[id].lines.length >= n);
  const lines = answers[aid].lines.slice(0, n);
  await makeDue(page, answers, lines.map((l) => l.id));
  // only the TR → EN direction is due, so each line is one card
  await page.reload();
  return lines;
}

test('one Tekrar puts a line in, one Zor does not; two good days take it out', async ({ page }) => {
  await boot(page);
  const lines = await dueLines(page, 2);
  await page.locator('[data-act="startReview"]').click();
  const seen = [];
  for (let k = 0; k < 2; k++) {
    const tr = (await card(page).locator('.tr').textContent()).trim();
    const l = lines.find((x) => x.tr === tr); seen.push(l);
    await reviewOne(page, k === 0 ? 0 : 1); // first: Tekrar, second: Zor
  }
  let h = await hard(page);
  expect(h[seen[0].id]).toMatchObject({ in: true, s: 3 });
  expect(h[seen[1].id].in).toBeFalsy();
  expect(h[seen[1].id].s).toBe(2);

  // Tekrar brings the card back today: İyi now counts as day 1
  await reviewOne(page, 2);
  h = await hard(page);
  expect(h[seen[0].id].in).toBe(true);
  expect(h[seen[0].id].ok).toHaveLength(1);
  // a second İyi on another day takes it out
  await page.evaluate(() => {});
  const st = await dumpStore(page);
  const p = st['data/users/local/progress'];
  p.hard[seen[0].id].ok = ['2026-03-01'];
  await writeStore(page, { 'data/users/local/progress': p });
  await page.reload();
  await makeDue(page, (await seedOf()).answers, [seen[0].id]);
  const st2 = await dumpStore(page);
  await writeStore(page, { 'data/users/local/progress': { ...st2['data/users/local/progress'], hard: p.hard, hardInit: '2026-03-01' } });
  await page.reload();
  await page.locator('[data-act="startReview"]').click();
  await reviewOne(page, 2);
  h = await hard(page);
  expect(h[seen[0].id].in).toBe(false);
});

test('Dinle: Zorlandıklarım scope lists the lines in the list, with the hint; ✗ adds points and undo removes them', async ({ page }) => {
  await boot(page);
  const lines = await dueLines(page, 4);
  const st = await dumpStore(page);
  const prog = st['data/users/local/progress'];
  prog.hardInit = '2026-03-01';
  prog.hard = { [lines[0].id]: { s: 3, at: '2026-03-02', in: true, ok: [] }, [lines[1].id]: { s: 2, at: '2026-03-02' } };
  await writeStore(page, { 'data/users/local/progress': prog });
  await page.reload();
  await page.getByRole('button', { name: 'Dinle', exact: true }).first().click();
  await expect(page.locator('#tr-scope option[value="hard"]')).toHaveText('Zorlandıklarım (1)');
  await page.selectOption('#tr-scope', 'hard');
  await expect(page.getByText('iki ayrı günde doğru söyleyince listeden çıkar')).toBeVisible();

  // ✗ on the line with 2 points brings it to 4 → in; undo restores it
  await page.selectOption('#tr-scope', 'learned');
  await page.locator('[data-act="trackMode"][data-m="B"]').click();
  await page.locator('[data-act="trackPlay"]').click();
  const no = page.locator('[data-act="mark"][data-v="no"]');
  for (let k = 0; k < 4; k++) {
    for (let j = 0; j < 30 && await no.isDisabled(); j++) { await page.evaluate(() => window.__speechEnd()); await page.clock.fastForward(1500); }
    const pos = await page.locator('#player .ctx .mono').first().textContent();
    if (pos.startsWith('2/')) break;
    await page.locator('[data-act="trackNext"]').click();
  }
  await no.click();
  let h = await hard(page);
  expect(h[lines[1].id]).toMatchObject({ in: true, s: 4 });
  await page.locator('[data-act="trackUndo"]').click();
  h = await hard(page);
  expect(h[lines[1].id]).toEqual({ s: 2, at: '2026-03-02' });
});

test('Hız testi: Zorlandıklarım pool', async ({ page }) => {
  await boot(page);
  const lines = await dueLines(page, 3);
  const st = await dumpStore(page);
  const prog = st['data/users/local/progress'];
  prog.hardInit = '2026-03-01';
  prog.hard = { [lines[2].id]: { s: 3, at: '2026-03-02', in: true, ok: [] } };
  await writeStore(page, { 'data/users/local/progress': prog });
  await page.reload();
  await page.getByRole('button', { name: 'Prova', exact: true }).first().click();
  await page.locator('[data-act="rehMode"][data-m="test"]').click();
  await page.locator('[data-act="testHard"][data-v="1"]').click();
  await expect(page.locator('[data-act="startTest"]')).toHaveText('Testi başlat (1 kart)');
  await page.locator('[data-act="startTest"]').click();
  await expect(card(page).locator('.tr')).toHaveText(lines[2].tr);
});

test('first run: forgotten lines on short intervals start in the list', async ({ page }) => {
  await boot(page);
  const { answers } = await seedOf();
  const aid = Object.keys(answers)[0], l = answers[aid].lines[0];
  await page.clock.fastForward(3000); // let the app's own first save happen before the store is replaced
  await writeStore(page, { ['data/users/local/srs_' + aid]: { c: { [l.id]: { p: { ivl: 1, ease: 2.1, due: '2026-03-03', reps: 4, lapses: 1 } } } }, 'data/users/local/progress': { intro: { [aid]: '2026-01-01' }, reh: {}, first: '2026-01-01' } });
  await page.reload();
  await page.getByRole('button', { name: 'Dinle', exact: true }).first().click();
  await expect(page.locator('#tr-scope option[value="hard"]')).toHaveText('Zorlandıklarım (1)');
});

test('Pekiştir keys: P opens it, Esc leaves, Space shows and returns, R runs another round', async ({ page }) => {
  await boot(page);
  await page.locator('[data-act="startIntro"]').click();
  await end(page);
  await page.locator('[data-act="shadow"]').click();
  for (let r = 1; r <= 2; r++) { await end(page); await page.clock.fastForward(20000); }
  await end(page);
  await page.clock.fastForward(7000);
  await page.locator('[data-act="recShow"]').click();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('p');
  await expect(card(page)).toContainText('↻ Pekiştir');
  await page.keyboard.press('Escape');
  await page.clock.fastForward(200);
  await expect(page.locator('[data-act="introNext"]')).toBeVisible();
  await page.keyboard.press('p');
  for (let k = 0; k < 20 && !(await page.locator('[data-act="pkShow"]').isVisible()); k++) { await page.evaluate(() => window.__speechEnd()); await page.clock.fastForward(2000); }
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Karta dön' })).toBeVisible();
  await page.keyboard.press('r');
  await expect(card(page)).toContainText('1/3');
  const back = page.getByRole('button', { name: 'Karta dön' });
  for (let k = 0; k < 30 && !(await back.isVisible()); k++) { await page.evaluate(() => window.__speechEnd()); await page.clock.fastForward(2000); }
  await page.keyboard.press('Enter');
  await page.clock.fastForward(200);
  await expect(page.locator('[data-act="introNext"]')).toBeVisible();
});
