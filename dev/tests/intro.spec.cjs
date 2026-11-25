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

test('Adımları atla (Dinle, Anlam) skips Hatırla too; the check after the batch and Ara ver → continue still work', async ({ page }) => {
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

/* ---- Atla on Gölgele and İmge goes to Hatırla (every state the button can be tapped in) ---- */
const skip = (page) => page.locator('[data-act="introSkip"]');
const onStep = (page) => page.locator('.steps .on');
// Hatırla is open, quiet and counting; the image hint shows only if the image step was seen
async function inRecall(page, image) {
  await expect(onStep(page)).toHaveText('Hatırla');
  await expect(card(page).locator('.en')).toHaveCount(0);
  await expect(card(page).locator('#recleft')).toHaveText(/^\d+ sn$/);
  await expect(skip(page)).toHaveCount(0); // no second Atla
  await expect(card(page).getByText('Önce imgeni düşün')).toHaveCount(image ? 1 : 0);
  expect(await page.evaluate(() => window.__speechEnd()), 'nothing is being spoken').toBe(false);
}
async function round(page, r) { // ends shadow rounds 1…r-1 and leaves round r with the voice playing
  await page.locator('[data-act="shadow"]').click();
  for (let k = 1; k < r; k++) { await end(page); await page.clock.fastForward(20000); }
  await expect(card(page).locator('.sayline')).toContainText(r + '/3');
  for (let k = 0; k < 5; k++) await page.clock.fastForward(100);
}
async function toImage(page) { await round(page, 3); await end(page); await page.clock.fastForward(600); await expect(card(page)).toContainText('kendi hayatından bir sahneye'); }

for (const r of [1, 2, 3]) test('Atla in shadow round ' + r + ' (voice playing): Hatırla, the voice and the rounds stop', async ({ page }) => {
  await start(page);
  await round(page, r);
  const n = await spoken(page);
  await skip(page).click();
  await inRecall(page, false);
  expect(await spoken(page)).toBe(n);
  await page.clock.fastForward(1500);
  await expect(onStep(page)).toHaveText('Hatırla'); // the old rounds don't come back
});

test('Atla in the shadow gap ("Tekrar et"): the pending round never starts, Hatırla opens by its own time', async ({ page }) => {
  await start(page);
  await round(page, 1); await end(page);
  await expect(card(page).locator('.sayline')).toHaveText('Tekrar et · 1/3');
  await skip(page).click();
  await inRecall(page, false);
  const n = await spoken(page);
  await page.clock.fastForward(60000); // the gap and the recall time are both over
  await expect(card(page).locator('.en')).toHaveCount(1);
  await expect(onStep(page)).toHaveText('Hatırla');
  await expect.poll(() => spoken(page)).toBe(n + 1); // the right sentence, once
});

test('Atla on İmge: Hatırla with the image hint; the image countdown does not start it again', async ({ page }) => {
  await start(page);
  await toImage(page);
  await page.clock.fastForward(1000);
  await skip(page).click();
  await inRecall(page, true);
  const left = async () => parseInt(await card(page).locator('#recleft').innerText(), 10);
  const a = await left();
  for (let k = 0; k < 2; k++) await page.clock.fastForward(1000);
  await expect.poll(left).toBeLessThan(a); // still the same countdown
});

test('after Atla: Göster, Pekiştir, the next line from Dinle; the hint is not left over from the line before', async ({ page }) => {
  await start(page);
  await toImage(page);
  await skip(page).click();
  await page.locator('[data-act="recShow"]').click();
  await expect(card(page).locator('.en')).toHaveCount(1);
  await page.locator('[data-act="pkStart"]').click();
  await expect(card(page)).toContainText('Pekiştir');
  await expect(skip(page)).toHaveCount(0);
  await page.locator('[data-act="pkDone"]').click();
  await page.locator('[data-act="introNext"]').click();
  await expect(page.locator('.sesshead .mono')).toContainText('Yeni · 2/');
  await expect(onStep(page)).toHaveText('Dinle');
  await end(page);
  await round(page, 1);
  await skip(page).click();
  await inRecall(page, false); // line 2 skipped before its image
});

test('after Atla the keys work (space: show, then next) and the 🎤 box checks the line', async ({ page }) => {
  await start(page);
  await round(page, 2);
  await skip(page).click();
  await page.locator('[data-act="dictOpen"]').click();
  await page.fill('#dict', 'something said here');
  await page.locator('[data-act="recCheck"]').click();
  await expect(page.locator('.dres')).toBeVisible();
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Space');
  await expect(page.locator('.sesshead .mono')).toContainText('Yeni · 2/');
});

test('Adımları atla, then Gölgele 3×, then Atla: Hatırla', async ({ page }) => {
  await start(page);
  await expect(skip(page)).toHaveText('Adımları atla');
  await skip(page).click();
  await expect(page.locator('[data-act="introNext"]')).toBeVisible();
  await expect(page.locator('[data-act="recShow"]')).toHaveCount(0);
  await page.locator('[data-act="shadow"]').click();
  for (let k = 0; k < 3; k++) await page.clock.fastForward(100);
  await expect(skip(page)).toHaveText('Atla');
  await skip(page).click();
  await inRecall(page, false);
});

test('Adımları atla while the first voice still plays: it stops, the line ends there', async ({ page }) => {
  await start(page);
  await skip(page).click();
  await page.locator('[data-act="introNext"]').click(); // line 2: the voice has just started
  for (let k = 0; k < 3; k++) await page.clock.fastForward(100);
  await skip(page).click();
  await expect(page.locator('[data-act="introNext"]')).toBeVisible();
  expect(await page.evaluate(() => window.__speechEnd())).toBe(false);
  await page.clock.fastForward(3000);
  await expect(page.locator('[data-act="introNext"]')).toBeVisible();
});

test('a late second tap on Atla does nothing in Hatırla or at the line end', async ({ page }) => {
  await start(page);
  const late = () => page.evaluate(() => { const b = document.createElement('button'); b.dataset.act = 'introSkip'; document.body.appendChild(b); b.click(); b.remove(); });
  await round(page, 1);
  await skip(page).click();
  await late(); await inRecall(page, false);
  await page.locator('[data-act="recShow"]').click();
  await late(); await expect(onStep(page)).toHaveText('Hatırla'); await expect(card(page).locator('.en')).toHaveCount(1);
  await page.locator('[data-act="introNext"]').click(); await end(page);
  await skip(page).click(); await late();
  await expect(page.locator('[data-act="introNext"]')).toBeVisible();
});

test('the last line of the batch: after Atla and Göster comes Kontrol, and it asks the skipped lines', async ({ page }) => {
  await start(page);
  let n = 0;
  for (; n < 6; n++) {
    await round(page, 1);
    await skip(page).click();
    await page.locator('[data-act="recShow"]').click();
    const next = page.locator('[data-act="introNext"]'), last = (await next.innerText()).includes('Kontrole geç');
    await next.click();
    if (last) break;
    await end(page);
  }
  await expect(page.locator('[data-act="quizReveal"]')).toBeVisible();
  await expect(page.locator('.sesshead .mono')).toHaveText('Kontrol · ' + (n + 1) + ' kaldı');
});

test('Atla saves nothing; Ara ver in Hatırla comes back to the same line from Dinle', async ({ page }) => {
  await start(page);
  await round(page, 1);
  await page.clock.fastForward(3000); // the place kept for Ara ver is written a moment after the line starts
  const before = await dumpStore(page);
  await skip(page).click();
  await page.clock.fastForward(3000);
  expect(await dumpStore(page)).toEqual(before);
  await page.locator('[data-act="endSess"]').click();
  await page.locator('[data-act="resumeIntro"]').click();
  await expect(page.locator('.sesshead .mono')).toContainText('Yeni · 1/');
  await expect(onStep(page)).toHaveText('Dinle');
});

async function toCheck(page) {
  for (let k = 0; k < 6 && !(await page.locator('[data-act="quizReveal"]').isVisible()); k++) {
    await page.locator('[data-act="introSkip"]').first().click();
    await page.locator('[data-act="introNext"]').click();
    if (!(await page.locator('[data-act="quizReveal"]').isVisible())) await end(page);
  }
  await expect(page.locator('[data-act="quizReveal"]')).toBeVisible();
}

test('Kontrol 🎤: the result suggests Söyledim for a right answer and Tekrar sor for a wrong one', async ({ page }) => {
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

