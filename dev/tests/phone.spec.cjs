'use strict';
// Phone flows: the hand check of v0.56–v0.59 automated. Runs at the smallest and the largest iPhone screens with touch
// (taps, not clicks). On every screen of a flow: the page never scrolls sideways, no control sticks out of the screen or
// has its text spill out, and each control the step needs can be tapped: brought to the middle of the screen, the finger
// lands on it and not on the fixed tab bar, a toast or another layer.
// What each step does is checked in the feature specs; this file checks it works on a phone screen:
//   version line → speed.spec · progress kept on update → upgrade.spec, intent.spec · skeleton round, timer, labels → intent.spec
//   suggestion, Bitir, save → prova-save.spec · Kalıp → kalip.spec · clips offline → audio.spec · Ayarlar off, stop bar → intent.spec
// Left for the phone itself: real dictation, the Siri voice, airplane mode, the screen dimming.
// Speech is stubbed, time fast-forwarded; lines and patterns come from the seed at run time.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, dumpStore, writeStore, seedOf, stubSpeech, makeDue } = require('./helpers.cjs');

const PHONES = [
  { name: 'small iPhone (375×667)', viewport: { width: 375, height: 667 } },
  { name: 'large iPhone (430×932)', viewport: { width: 430, height: 932 } },
];

// Nothing wider than the screen; no control outside it; no button whose text spills out.
async function fits(page, where) {
  const bad = await page.evaluate(() => {
    const W = document.documentElement.clientWidth, out = [];
    if (document.documentElement.scrollWidth > W + 1) out.push('page scrolls sideways (' + document.documentElement.scrollWidth + ' > ' + W + ')');
    document.querySelectorAll('#view button, #view input, #view textarea, #view select, #view .btn, nav.tabs button').forEach((el) => {
      const b = el.getBoundingClientRect(); if (!b.width || !b.height || getComputedStyle(el).visibility === 'hidden') return;
      const name = el.dataset.act || el.id || el.textContent.trim().slice(0, 24);
      if (b.left < -1 || b.right > W + 1) out.push(name + ' sticks out (' + Math.round(b.left) + '…' + Math.round(b.right) + ' of ' + W + ')');
      if (el.matches('button, .btn') && el.scrollWidth > el.clientWidth + 2) out.push(name + ': text spills out of the button');
    });
    return out;
  });
  expect(bad, where).toEqual([]);
}
// Brings the control to the middle of the screen (as far as the page scrolls), checks the finger would land on it, taps it.
async function tap(page, loc, where) {
  await expect(loc, where).toBeVisible();
  const at = await loc.evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
    const b = el.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2, hit = document.elementFromPoint(x, y);
    const by = !hit ? 'nothing' : hit.closest('nav.tabs') ? 'the tab bar' : hit.closest('.toast') ? 'a toast' : hit.closest('#idrawer') ? 'the install drawer' : hit.tagName + '.' + hit.className;
    return { ok: !!hit && (hit === el || el.contains(hit)), y: Math.round(y), screen: innerHeight, under: by };
  });
  expect(at.ok, where + ': covered by ' + at.under + ' at y=' + at.y + ' of ' + at.screen).toBe(true);
  await loc.tap();
}
const tab = (page, name) => page.locator('nav.tabs button', { hasText: name }).first();
const card = (page) => page.locator('article.icard').first();

async function boot(page, settings) {
  requirePass(test);
  await page.route('**/audio*.bin', (r) => r.abort());
  await stubSpeech(page);
  await page.clock.install();
  await unlock(page);
  const st = await dumpStore(page);
  await writeStore(page, { 'data/users/local/settings': { ...(st['data/users/local/settings'] || {}), fuOn: false, ...(settings || {}) } });
  return seedOf();
}

for (const phone of PHONES) {
  test.describe(phone.name, () => {
    test.use({ viewport: phone.viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('every tab and Prova mode fits the screen', async ({ page }) => {
      const { answers } = await boot(page);
      await page.reload();
      await fits(page, 'Bugün');
      for (const name of ['Prova', 'Dinle', 'Cümleler', 'Ayarlar']) {
        await tap(page, tab(page, name), name + ' tab');
        await fits(page, name);
      }
      await tap(page, tab(page, 'Prova'), 'Prova tab');
      for (const m of ['answer', 'mock', 'speed', 'kalip']) {
        const b = page.locator('[data-act="rehMode"][data-m="' + m + '"]');
        if (!(await b.count())) continue;
        await tap(page, b, 'Prova mode ' + m);
        await fits(page, 'Prova · ' + m);
      }
      // Cümleler: an open answer and the edit form
      const aid = Object.keys(answers)[0], l = answers[aid].lines[0];
      await tap(page, tab(page, 'Cümleler'), 'Cümleler tab');
      await tap(page, page.locator('[data-act="toggleAns"][data-id="' + aid + '"]'), 'open an answer');
      await fits(page, 'Cümleler · open answer');
      await tap(page, page.locator('[data-act="editLine"][data-id="' + l.id + '"]'), 'Düzenle');
      await fits(page, 'Cümleler · edit form');
      await tap(page, page.locator('[data-act="saveEdit"]'), 'Kaydet in the edit form');
    });

    test('Bugün → Tekrar: the card, the 🎤 box, TR dinle / Göster, the grades and Bitir can all be tapped', async ({ page }) => {
      const { answers } = await boot(page);
      const aid = Object.keys(answers).find((id) => answers[id].lines.length >= 3), ids = answers[aid].lines.slice(0, 3).map((l) => l.id);
      await makeDue(page, answers, ids);
      await page.reload();
      await fits(page, 'Bugün with due cards');
      await tap(page, page.locator('[data-act="startReview"]'), 'Tekrarlara başla');
      await expect(card(page)).toBeVisible();
      await fits(page, 'Tekrar card');
      if (await page.locator('[data-act="dictOpen"]').count()) await tap(page, page.locator('[data-act="dictOpen"]'), 'open 🎤');
      await expect(page.locator('#dict')).toBeVisible();
      await tap(page, page.locator('#dict'), 'the 🎤 box');
      await fits(page, 'Tekrar card, 🎤 box open');
      await tap(page, page.locator('[data-act="replayCard"]'), 'TR dinle');
      await tap(page, page.locator('[data-act="reveal"]'), 'Göster');
      await fits(page, 'Tekrar card shown');
      for (let g = 0; g < 4; g++) await expect(page.locator('[data-act="grade"][data-g="' + g + '"]')).toBeVisible();
      await tap(page, page.locator('[data-act="grade"][data-g="2"]'), 'İyi');
      await expect(card(page)).toBeVisible(); // the next card
      await tap(page, page.locator('[data-act="revSkip"]'), 'Bugün geç');
      await expect(page.locator('.sesshead')).toContainText('1 geçildi');
      await fits(page, 'Tekrar card after Bugün geç');
      await tap(page, page.locator('[data-act="endSess"]'), 'Bitir');
      await expect(page.locator('[data-act="startReview"]')).toBeVisible();
    });

    test('Prova: skeleton round on the longest answer → full answer → result → Bitir asks → Akıcıydı saves', async ({ page }) => {
      const { answers } = await boot(page);
      await page.reload();
      const aid = Object.keys(answers).sort((x, y) => answers[y].lines.length - answers[x].lines.length)[0], a = answers[aid];
      await tap(page, tab(page, 'Prova'), 'Prova tab');
      await tap(page, page.locator('[data-act="openReh"][data-id="' + aid + '"]').first(), 'open the answer');
      await fits(page, 'Prova start');
      await tap(page, page.locator('[data-act="skelStart"]'), 'Başla · önce iskelet');
      await fits(page, 'skeleton countdown');
      await page.clock.fastForward(20500); // time is up: the stop list opens
      await expect(page.locator('ol.stops li')).toHaveCount(a.lines.length);
      await fits(page, 'stop list (' + a.lines.length + ' stops)');
      await tap(page, page.locator('[data-act="rehStart"]'), 'Tam cevaba başla, under the longest stop list');
      await expect(page.locator('#timer')).toHaveText('0:00');
      await fits(page, 'talking');
      if (await page.locator('[data-act="dictOpen"]').count()) await tap(page, page.locator('[data-act="dictOpen"]'), 'open 🎤');
      await page.fill('#dict', a.lines[0].en);
      await page.clock.fastForward(30000);
      await tap(page, page.locator('[data-act="rehStop"]'), 'Bitti');
      await expect(page.locator('.anslines .ilab')).toHaveCount(a.lines.length);
      await fits(page, 'result');
      await expect(page.locator('[data-act="rehSave"].sugg')).toHaveAttribute('data-ok', '0'); // a line of many said → Takıldım
      await tap(page, page.locator('[data-act="endSess"]'), 'Bitir on the unsaved result');
      await expect(page.locator('.confirm.leave')).toBeVisible();
      await fits(page, 'Bitir warning');
      await tap(page, page.locator('[data-act="rehLeaveNo"]'), 'Vazgeç');
      await tap(page, page.locator('[data-act="rehSave"][data-ok="1"]'), 'Akıcıydı');
      await page.clock.fastForward(1500);
      expect((await dumpStore(page))['data/users/local/progress'].reh[aid]).toMatchObject({ ok: true, n: 1 });
    });

    test('Kalıp: list, built and not built cards with the 🎤 box open, Göster, the result, the next session', async ({ page }) => {
      const { answers, data } = await boot(page);
      await makeDue(page, answers, data.kalip.map((k) => k.src));
      await page.reload();
      const byTr = {}; data.kalip.forEach((k) => k.durum.forEach((d, i) => { byTr[d.tr] = { k, i, d }; }));
      const cur = async () => byTr[(await card(page).locator('.tr.big').textContent()).trim()];
      await tap(page, tab(page, 'Prova'), 'Prova tab');
      await tap(page, page.locator('[data-act="rehMode"][data-m="kalip"]'), 'Kalıp');
      await expect(page.locator('.alist .arow')).toHaveCount(data.kalip.length);
      await fits(page, 'Kalıp list');
      await tap(page, page.locator('[data-act="kpStart"]'), 'Kalıp oturumu başlat');

      let c = await cur();
      await fits(page, 'Kalıp card');
      if (await page.locator('[data-act="dictOpen"]').count()) await tap(page, page.locator('[data-act="dictOpen"]'), 'open 🎤');
      await page.fill('#dict', c.d.ex);
      await fits(page, 'Kalıp card, 🎤 box open');
      await tap(page, page.locator('[data-act="kpCheck"]'), 'Kontrol et');
      await expect(page.locator('.dres')).toContainText('Kalıp geçti');
      await fits(page, 'Kalıp built');
      await tap(page, page.locator('[data-act="kpMark"][data-ok="1"]'), 'Kurdum');

      c = await cur(); const missed = c.k.id;
      await expect(page.locator('#dict')).toHaveValue('');
      await page.fill('#dict', 'Something else entirely.');
      await tap(page, page.locator('[data-act="kpCheck"]'), 'Kontrol et (not built)');
      await expect(page.locator('.dres')).toContainText('Kalıp eksik');
      await fits(page, 'Kalıp not built');
      await tap(page, page.locator('[data-act="kpMark"][data-ok="0"]'), 'Kuramadım');

      const n = Math.min(6, data.kalip.length);
      for (let i = 2; i < n; i++) {
        await tap(page, page.locator('[data-act="kpShow"]'), 'Göster, card ' + (i + 1));
        await fits(page, 'Kalıp shown, card ' + (i + 1));
        await tap(page, page.locator('[data-act="kpMark"][data-ok="1"]'), 'Kurdum, card ' + (i + 1));
      }
      await expect(page.getByText('Kalıp oturumu bitti')).toBeVisible();
      await fits(page, 'Kalıp result');
      await tap(page, page.locator('[data-act="kpStart"]'), 'Yeni oturum');
      c = await cur();
      expect(c.k.id).toBe(missed); // the one not built comes first, with its next situation
      expect(c.i).toBe(1 % c.k.durum.length);
    });

    test('Yeni: the stop bar and the learning steps fit; Ayarlar switch turns the skeleton off', async ({ page }) => {
      const { answers } = await boot(page);
      await page.reload();
      await tap(page, page.locator('[data-act="startIntro"]'), 'Yeni');
      await expect(page.locator('.durak')).toBeVisible();
      await fits(page, 'Yeni card with the stop bar');
      await tap(page, page.locator('[data-act="introSkip"]').first(), 'Adımları atla');
      await fits(page, 'Yeni, steps skipped');
      await tap(page, page.locator('[data-act="endSess"]'), 'Bitir');
      await tap(page, tab(page, 'Ayarlar'), 'Ayarlar tab');
      const sw = page.locator('#set-intent');
      await expect(sw).toBeChecked(); // waits for the page to settle (it may render twice)
      await sw.tap(); // the switch may be a styled checkbox: tapping its box is what a finger does
      await expect(sw).not.toBeChecked();
      const aid = Object.keys(answers).find((id) => answers[id].lines.length >= 5);
      await tap(page, tab(page, 'Prova'), 'Prova tab');
      await tap(page, page.locator('[data-act="rehMode"][data-m="answer"]'), 'Cevap provası');
      await tap(page, page.locator('[data-act="openReh"][data-id="' + aid + '"]').first(), 'open the answer');
      await expect(page.locator('[data-act="skelStart"]')).toHaveCount(0);
      await expect(page.locator('[data-act="rehStart"]')).toBeVisible();
    });
  });
}
