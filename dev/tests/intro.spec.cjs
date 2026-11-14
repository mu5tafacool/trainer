'use strict';
// New answers (Bugün → Yeni): shadowing's 3rd round is said together with the voice, then Hatırla (recall) after the image:
// Turkish only, English hidden and silent until the thinking time ends or Göster; Bir daha restarts it; 🎤 shows a result
// without a grade and saves nothing. Skip steps, the 4–5 line check and Ara ver → continue still work.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, dumpStore, writeStore, stubSpeech } = require('./helpers.cjs');

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
    await expect(card(page)).toContainText('gölge ' + r + '/3');
    await end(page);
    await expect(card(page)).toContainText('Şimdi sen söyle'); // rounds 1 and 2 keep the gap
    await page.clock.fastForward(20000);
  }
  await expect(card(page)).toContainText('gölge 3/3');
  await expect(card(page)).toContainText('Sesle birlikte söyle');
  await expect(card(page).locator('.en.masked')).toHaveCount(1);
  await end(page);
  await page.clock.fastForward(600); // no gap after the 3rd round: straight to the image
  await expect(card(page)).toContainText('kendi hayatından bir sahneye');
  await page.clock.fastForward(6000);
  await expect(card(page)).toContainText('İngilizcesini sen söyle');
}

test('shadow round 3 together with the voice, then Hatırla: hidden, Göster, Bir daha, timer, next', async ({ page }) => {
  await start(page);
  await toRecall(page);
  await expect(card(page).locator('.en')).toHaveCount(0); // English not on the page
  await expect(page.locator('#recleft')).toHaveText(/\d+ sn/);
  const n0 = await spoken(page);
  await page.clock.fastForward(1000);
  expect(await spoken(page)).toBe(n0); // and not played

  await page.locator('[data-act="recShow"]').click(); // Göster opens it early and plays it
  await expect(card(page).locator('.en')).toHaveCount(1);
  await expect.poll(() => spoken(page)).toBe(n0 + 1);

  await page.locator('[data-act="recAgain"]').click(); // Bir daha: hidden again, new thinking time
  await expect(card(page).locator('.en')).toHaveCount(0);
  await page.clock.fastForward(13000); // the thinking time (at most 12 s) ends: opens by itself
  await expect(card(page).locator('.en')).toHaveCount(1);

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
