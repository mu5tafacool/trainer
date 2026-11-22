'use strict';
// ↻ Pekiştir: on Hatırla in place of Bir daha; on Kontrol and Tekrar only when the 🎤 result is Zor or Tekrar.
// 1/3 text + say it back, 2/3 with the voice and no text, 3/3 from memory, then back to the card with its first result.
// The line is noted in progress.hard; Siri mode still plays a voice. Speech is stubbed and time fast-forwarded.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, dumpStore, writeStore, seedOf, makeDue, stubSpeech } = require('./helpers.cjs');
const v3 = require('../lib/verify3.js');

const card = (page) => page.locator('article.icard').first();
const spoken = (page) => page.evaluate(() => window.__spoken.filter((t) => t.trim()).length);
async function end(page) {
  for (let k = 0; k < 30; k++) { await page.clock.fastForward(100); if (await page.evaluate(() => window.__speechEnd())) return; }
  throw new Error('nothing was being spoken');
}
async function boot(page, settings) {
  requirePass(test);
  await page.route('**/audio*.bin', (r) => r.abort());
  await stubSpeech(page);
  await page.clock.install();
  await unlock(page);
  if (settings) {
    const st = await dumpStore(page);
    await writeStore(page, { 'data/users/local/settings': { ...(st['data/users/local/settings'] || {}), ...settings } });
    await page.reload();
  }
}
// the longest start of the line that the rules grade Zor
function zorPart(l) {
  const words = l.en.split(/\s+/);
  for (let k = words.length - 1; k > 0; k--) { const t = words.slice(0, k).join(' '); if (v3.check({ en: l.en, tier: l.tier === 'ezber' ? 'ezber' : 'anlam', mk: l.mk || [] }, t, {}, null).grade === 1) return t; }
  return words[0];
}
const byTr = async () => { const { answers } = await seedOf(), m = {}; Object.values(answers).forEach((a) => a.lines.forEach((l) => { m[l.tr] = l; })); return m; };

// runs the three steps and ends on the "shown" view
async function runPk(page) {
  await expect(card(page)).toContainText('↻ Pekiştir');
  await expect(card(page).locator('.pkstat')).toContainText('1/3 · metinle'); // the counter is in the status line, as on Gölgele
  await expect(card(page).locator('.ctx')).not.toContainText('/3');
  await expect(card(page).locator('.en:not(.masked)')).toHaveCount(1); // 1/3: with the text
  await end(page);
  await expect(card(page)).toContainText('Aynen tekrar et');
  await page.clock.fastForward(20000);
  await expect(card(page).locator('.pkstat')).toContainText('2/3 · metinsiz');
  await expect(card(page)).toContainText('Sesle birlikte söyle');
  await expect(card(page).locator('.en.masked')).toHaveCount(1); // 2/3: no text
  await end(page);
  await page.clock.fastForward(800);
  await expect(card(page).locator('.pkstat')).toContainText('3/3 · kendin');
  await expect(card(page)).toContainText('Şimdi bir kez sen söyle');
  await expect(card(page).locator('.en')).toHaveCount(0); // 3/3: from memory
  await expect(page.locator('#pkleft')).toHaveText(/\d+ sn/);
  await page.clock.fastForward(30000); // recall time ends: opens by itself
  await expect(card(page).locator('.en')).toHaveCount(1);
  await expect(page.locator('[data-act="pkDone"]')).toBeVisible();
}

test('Hatırla: Pekiştir in place of Bir daha, three steps, back to the card, line noted', async ({ page }) => {
  await boot(page);
  await page.locator('[data-act="startIntro"]').click();
  await end(page);
  await page.locator('[data-act="shadow"]').click();
  for (let r = 1; r <= 2; r++) { await end(page); await page.clock.fastForward(20000); }
  await end(page);
  await page.clock.fastForward(7000);
  await page.locator('[data-act="recShow"]').click();
  const tr = (await card(page).locator('.tr').textContent()).trim();
  await page.locator('[data-act="pkStart"]').click();
  await runPk(page);
  await page.locator('[data-act="pkDone"]').click();
  await expect(page.locator('[data-act="introNext"]')).toBeVisible(); // back on Hatırla, opened
  await expect(card(page).locator('.tr')).toHaveText(tr);
  await page.clock.fastForward(3000);
  const l = (await byTr())[tr];
  const hard = (await dumpStore(page))['data/users/local/progress'].hard;
  expect(hard[l.id].n).toBe(1);
});

test('Siri mode: the page stays silent, but Pekiştir plays a voice', async ({ page }) => {
  await boot(page, { voiceMode: 'siri' });
  await page.locator('[data-act="startIntro"]').click();
  await page.clock.fastForward(8000);
  await page.locator('[data-act="shadow"]').click();
  for (let k = 0; k < 40 && !(await page.locator('[data-act="recShow"]').isVisible()); k++) await page.clock.fastForward(2000);
  await page.locator('[data-act="recShow"]').click();
  await page.clock.fastForward(8000);
  expect(await spoken(page)).toBe(0); // Siri mode: nothing played by the page so far
  await page.locator('[data-act="pkStart"]').click();
  await page.clock.fastForward(300);
  expect(await spoken(page)).toBe(1);
});

test('Kontrol: Pekiştir only for Zor/Tekrar; the first result and buttons stay after it', async ({ page }) => {
  await boot(page);
  await page.locator('[data-act="startIntro"]').click();
  await end(page);
  for (let k = 0; k < 6 && !(await page.locator('[data-act="quizReveal"]').isVisible()); k++) {
    await page.locator('[data-act="introSkip"]').first().click();
    await page.locator('[data-act="introNext"]').click();
    if (!(await page.locator('[data-act="quizReveal"]').isVisible())) await end(page);
  }
  const lines = await byTr();
  const line = async () => lines[(await card(page).locator('.tr.big').textContent()).trim()];

  let l = await line();
  await page.locator('[data-act="dictOpen"]').click();
  await page.fill('#dict', l.en);
  await page.locator('[data-act="quizCheck"]').click();
  await expect(page.locator('[data-act="quizOk"]')).toHaveClass(/sugg/);
  await expect(page.locator('[data-act="pkStart"]')).toHaveCount(0); // İyi: no Pekiştir
  await page.locator('[data-act="quizAgain"]').click();

  l = await line();
  await page.locator('[data-act="dictOpen"]').click();
  await page.fill('#dict', zorPart(l));
  await page.locator('[data-act="quizCheck"]').click();
  await expect(page.getByText('Arada: kalıbı tam söyleyemediysen')).toBeVisible();
  const before = await page.locator('.dres').first().textContent();
  await page.locator('[data-act="pkStart"]').click();
  await runPk(page);
  await page.locator('[data-act="pkDone"]').click();
  await expect(page.locator('[data-act="quizAgain"]')).toBeVisible();
  await expect(page.locator('.dres').first()).toHaveText(before); // the first try's result is kept
  await expect(page.locator('.btn.sugg')).toHaveCount(0);
});

test('Tekrar: Pekiştir next to EN dinle when Zor; 🎤 inside shows a percentage only; the suggestion stays', async ({ page }) => {
  await boot(page);
  const { answers } = await seedOf();
  const aid = Object.keys(answers)[0], l = answers[aid].lines[0];
  await makeDue(page, answers, [l.id]);
  await page.reload();
  await page.locator('[data-act="startReview"]').click();
  for (let k = 0; k < 20 && !(await page.locator('[data-act="dictOpen"]').count()); k++) {
    await page.evaluate(() => window.__speechEnd()); await page.clock.fastForward(300);
    if (await page.locator('[data-act="reveal"]').isVisible() && !(await page.locator('[data-act="dictOpen"]').count())) { await page.locator('[data-act="reveal"]').click(); await page.locator('[data-act="grade"][data-g="2"]').click(); }
  }
  const cur = (await byTr())[(await card(page).locator('.tr').textContent()).trim()];
  await page.locator('[data-act="dictOpen"]').click();
  await page.fill('#dict', zorPart(cur));
  await page.locator('[data-act="dictCheck"]').click();
  await expect(page.locator('[data-act="grade"][data-g="1"]')).toHaveClass(/sugg/);
  const pk = page.locator('.row [data-act="pkStart"]');
  await expect(pk).toBeVisible();
  await expect(page.locator('.row:has([data-act="replayEn"]) [data-act="pkStart"]')).toHaveCount(1);
  await pk.click();
  await end(page);
  await page.clock.fastForward(20000);
  await end(page);
  await page.clock.fastForward(800);
  await expect(card(page)).toContainText('3/3');
  await page.locator('[data-act="dictOpen"]').click();
  await page.fill('#dict', cur.en);
  await page.locator('[data-act="pkCheck"]').click();
  await expect(page.locator('.dres')).toContainText('%100');
  await expect(page.locator('.dres')).not.toContainText('Anlam');
  await page.locator('[data-act="pkDone"]').click();
  await expect(page.locator('[data-act="grade"][data-g="1"]')).toHaveClass(/sugg/); // still Zor from the first try
});
