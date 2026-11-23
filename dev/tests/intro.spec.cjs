'use strict';
// New answers (Bugün → Yeni): shadowing's 3rd round is said together with the voice, then Hatırla (recall) after the image:
// Turkish only, English hidden and silent until the thinking time ends or Göster; Pekiştir replaces Bir daha; 🎤 shows a result
// without a grade and saves nothing. Skip steps, the 4–5 line check and Ara ver → continue still work.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, dumpStore, writeStore, stubSpeech, seedOf } = require('./helpers.cjs');

const card = (page) => page.locator('article.icard').first();
// ends the utterance being spoken; first lets the app's short pre-speech wait pass so the utterance exists
async function end(page) {
  for (let k = 0; k < 30; k++) { await page.clock.fastForward(100); if (await page.evaluate(() => window.__speechEnd())) return; }
  throw new Error('nothing was being spoken');
}
const spoken = (page) => page.evaluate(() => window.__spoken.length);

async function start(page, settings) {
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
  await page.locator('[data-act="startIntro"]').click();
  await end(page); // the first listen
  await expect(page.locator('[data-act="shadow"]')).toBeEnabled();
}

async function toRecall(page) {
  await page.locator('[data-act="shadow"]').click();
  for (let r = 1; r <= 2; r++) {
    // the shared status line (sayLine): grey while the voice plays ("Dinle ve oku" while the text shows), the step once
    await expect(card(page).locator('.sayline')).toHaveText((r === 1 ? 'Dinle ve oku' : 'Dinle') + ' · ' + r + '/3');
    await end(page);
    await expect(card(page).locator('.sayline')).toHaveText('Tekrar et · ' + r + '/3'); // rounds 1 and 2 keep the gap
    await page.clock.fastForward(20000);
  }
  await expect(card(page).locator('.sayline')).toHaveText('Birlikte söyle · 3/3');
  await expect(card(page).locator('.en.masked')).toHaveCount(1);
  await end(page);
  await page.clock.fastForward(600); // no gap after the 3rd round: straight to the image
  await expect(card(page)).toContainText('kendi hayatından bir sahneye');
  // the image countdown is a chain of 1 s waits: move the clock a second at a time so each step gets its turn
  for (let k = 0; k < 15 && !(await card(page).locator('.sayline').count()); k++) await page.clock.fastForward(1000);
  await expect(card(page).locator('.sayline')).toHaveText('Sen söyle');
  await expect(card(page)).toContainText('Önce imgeni düşün');
}

test('shadow round 3 together with the voice, then Hatırla: hidden, Göster, timer, Pekiştir in place of Bir daha, next', async ({ page }) => {
  await start(page);
  await toRecall(page);
  await expect(card(page).locator('.en')).toHaveCount(0); // English not on the page
  await expect(card(page).locator('.cardfoot #recleft')).toHaveText(/^\d+ sn$/); // the countdown sits in the card foot
  // on a phone the seconds stay at the card's bottom right, in view; from 375 px on, on the same row as the tag
  for (const w of [320, 375, 390]) {
    await page.setViewportSize({ width: w, height: 760 });
    const b = await card(page).evaluate((c) => {
      const r = (e) => e.getBoundingClientRect(), f = r(c.querySelector('.cardfoot')), t = r(c.querySelector('#recleft')), g = r(c.querySelector('.cardfoot .tier'));
      return { right: f.right - t.right, inFoot: t.bottom <= f.bottom + 1 && t.left >= f.left, sameRow: Math.abs(t.top - g.top) < g.height, inView: t.right <= innerWidth };
    });
    expect(b.right, w + ' px').toBeLessThan(1);
    expect(b.inFoot && b.inView, w + ' px').toBe(true);
    if (w >= 375) expect(b.sameRow, w + ' px').toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const n0 = await spoken(page);
  await page.clock.fastForward(1000);
  expect(await spoken(page)).toBe(n0); // and not played

  await page.locator('[data-act="recShow"]').click(); // Göster opens it early and plays it
  await expect(card(page).locator('.en')).toHaveCount(1);
  await expect.poll(() => spoken(page)).toBe(n0 + 1);

  await expect(page.locator('[data-act="recAgain"]')).toHaveCount(0);
  await expect(page.locator('[data-act="pkStart"]')).toBeVisible();

  await expect(page.locator('.sesshead .mono')).toContainText('Yeni · 1/');
  await page.locator('[data-act="introNext"]').click();
  await expect(page.locator('.sesshead .mono')).toContainText('Yeni · 2/');
});

test('Hatırla 🎤: result without a grade, nothing saved', async ({ page }) => {
  await start(page);
  await toRecall(page);
  await page.locator('[data-act="dictOpen"]').click();
  await page.fill('#dict', 'something said here');
  await page.locator('[data-act="recCheck"]').click();
  await expect(page.locator('.dres')).toBeVisible();
  await expect(card(page).locator('.en')).toHaveCount(1);
  await expect(page.locator('[data-act="grade"]')).toHaveCount(0);
  await page.clock.fastForward(2000);
  const st = await dumpStore(page);
  expect(Object.keys(st).filter((k) => k.startsWith('data/users/local/srs_') && Object.keys(st[k].c || {}).length)).toEqual([]);
});

test('Hatırla without 🎤 when "Söyle ve kontrol et" is off', async ({ page }) => {
  await start(page, { dict: false });
  await toRecall(page);
  await expect(page.locator('[data-act="dictOpen"]')).toHaveCount(0);
  await expect(page.locator('[data-act="recShow"]')).toBeVisible();
});

test('skip steps skips Hatırla too; the check after the batch and Ara ver → continue still work', async ({ page }) => {
  await start(page);
  for (let k = 0; k < 6; k++) {
    if (await page.getByText('TR → EN · sesli söyle').first().isVisible() && await page.locator('[data-act="quizReveal"]').isVisible()) break;
    await page.locator('[data-act="introSkip"]').first().click();
    await expect(page.locator('[data-act="recShow"]')).toHaveCount(0);
    await page.locator('[data-act="introNext"]').click();
    await end(page);
  }
  await expect(page.locator('[data-act="quizReveal"]')).toBeVisible(); // the 4–5 line check
  await page.locator('[data-act="endSess"]').click(); // Ara ver
  await page.locator('[data-act="resumeIntro"]').click();
  await expect(page.locator('[data-act="quizReveal"]')).toBeVisible();
});

async function toCheck(page) {
  for (let k = 0; k < 6 && !(await page.locator('[data-act="quizReveal"]').isVisible()); k++) {
    await page.locator('[data-act="introSkip"]').first().click();
    await page.locator('[data-act="introNext"]').click();
    if (!(await page.locator('[data-act="quizReveal"]').isVisible())) await end(page);
  }
  await expect(page.locator('[data-act="quizReveal"]')).toBeVisible();
}

test('Kontrol 🎤: the result suggests ✓ for a right answer and ↺ for a wrong one', async ({ page }) => {
  await start(page);
  await toCheck(page);
  const { answers } = await seedOf();
  const byTr = {}; Object.values(answers).forEach((a) => a.lines.forEach((l) => { byTr[l.tr] = l; }));
  const line = async () => byTr[(await page.locator('article.icard .tr.big').textContent()).trim()];

  let l = await line();
  await page.locator('[data-act="dictOpen"]').click();
  await page.fill('#dict', l.en);
  await page.locator('[data-act="quizCheck"]').click();
  await expect(page.locator('.dres')).toBeVisible();
  await expect(card(page).locator('.en')).toHaveCount(1);
  await expect(page.locator('[data-act="quizOk"]')).toHaveClass(/sugg/);
  await expect(page.locator('[data-act="quizAgain"]')).not.toHaveClass(/sugg/);
  await page.locator('[data-act="quizAgain"]').click(); // ask it again later; the next card starts with an empty box

  l = await line();
  await page.locator('[data-act="dictOpen"]').click();
  await expect(page.locator('#dict')).toHaveValue('');
  await page.fill('#dict', 'the weather is nice and the bus was late');
  await page.locator('[data-act="quizCheck"]').click();
  await expect(page.locator('[data-act="quizAgain"]')).toHaveClass(/sugg/);
  await expect(page.locator('[data-act="quizOk"]')).not.toHaveClass(/sugg/);
  await page.locator('[data-act="quizAgain"]').click();

  // about three quarters said: Zor, so neither button is framed and the hint says why
  l = await line();
  const v3 = require('../lib/verify3.js'), words = l.en.split(/\s+/);
  let part = l.en; // the longest start of the line the rules grade Zor
  for (let k = words.length - 1; k > 0; k--) { const t = words.slice(0, k).join(' '); if (v3.check({ en: l.en, tier: l.tier === 'ezber' ? 'ezber' : 'anlam', mk: l.mk || [] }, t, {}, null).grade === 1) { part = t; break; } }
  await page.locator('[data-act="dictOpen"]').click();
  await page.fill('#dict', part);
  await page.locator('[data-act="quizCheck"]').click();
  await expect(page.locator('.dres')).toBeVisible();
  await expect(page.locator('.btn.sugg')).toHaveCount(0);
  await expect(page.getByText('Arada: kalıbı tam söyleyemediysen')).toBeVisible();
  await expect(page.getByText('Çerçeveli düğme')).toHaveCount(0);
});

test('Kontrol without 🎤 when "Söyle ve kontrol et" is off', async ({ page }) => {
  await start(page, { dict: false });
  await toCheck(page);
  await expect(page.locator('[data-act="dictOpen"]')).toHaveCount(0);
  await expect(page.locator('[data-act="quizReveal"]')).toBeVisible();
});

