'use strict';
// v1 · 3b/5 (d26): one code, several apps. The interview app is unchanged (mt1:, one target language). A travel page
// (<meta name="mt-app" content="travel">) opens an unencrypted set without a passphrase, keeps each language pair apart
// (mt2:<lang>:), and lets the speaker pick the language and their gender in Ayarlar. Made-up sentences only.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, ROOT, PAGE } = require('./helpers.cjs');

const SET = { v: 't1', plain: { answers: {
  t1: { q: 'Temel', qtr: 'Temel', order: 1, tag: 'Temel', code: 'T1', lines: [
    { id: 't1-01', tr: 'Mavi kapı açık.', en: 'The blue door is open.', es: 'La puerta azul está abierta.', fr: 'La porte bleue est ouverte.', tier: 'anlam', intent: 'Kapı' },
    { id: 't1-02', tr: 'Yoruldum.', en: 'I am tired.', es: 'Estoy cansado.', 'es~f': 'Estoy cansada.', fr: 'Je suis fatigué.', 'fr~f': 'Je suis fatiguée.', tier: 'anlam', intent: 'Durum' }
  ] } } } };
async function travel(page) {
  const html = fs.readFileSync(path.join(ROOT, PAGE), 'utf8')
    .replace('<head>', '<head>\n<meta name="mt-app" content="travel">')
    .replace(/<script id="seed" type="application\/json">[\s\S]*?<\/script>/, '<script id="seed" type="application/json">' + JSON.stringify(SET) + '</script>');
  await page.route('**/travel-test.html', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.route('**/audio*.bin', (r) => r.abort());
  await page.goto('travel-test.html');
}
const keys = (page) => page.evaluate(() => Object.keys(localStorage).sort());
const lineText = async (page) => {
  await page.locator('nav.tabs [data-tab="lines"]').click();
  await page.locator('[data-act="toggleAns"]').first().click();
  return page.locator('li.line p.en').allTextContents();
};

test('the interview app is unchanged: mt1:, English, no language or gender choice', async ({ page }) => {
  requirePass(test);
  await unlock(page);
  expect(await page.evaluate(() => [window.__i18n.profile.app, window.__i18n.store, window.__i18n.profile.tgt])).toEqual(['interview', 'mt1:', 'en']);
  expect((await keys(page)).filter((k) => /^mt1:answers\//.test(k)).length).toBeGreaterThan(5);
  await page.locator('nav.tabs [data-tab="settings"]').click();
  await expect(page.locator('#app-panel')).toHaveCount(0);
});

test('travel: an open set needs no passphrase; each language keeps its own store; the language is picked in Ayarlar', async ({ page }) => {
  await travel(page);
  await expect(page.locator('#gate')).toBeHidden();
  expect(await page.evaluate(() => [window.__i18n.profile.app, window.__i18n.store])).toEqual(['travel', 'mt2:en:']);
  await expect.poll(() => keys(page)).toContain('mt2:en:answers/t1');
  expect((await keys(page)).filter((k) => k.indexOf('mt1:') === 0 && k !== 'mt1:__ui')).toEqual([]); // never touches the interview store
  expect(await lineText(page)).toEqual(['The blue door is open.', 'I am tired.']);

  await page.locator('nav.tabs [data-tab="settings"]').click();
  const panel = page.locator('#app-panel');
  await expect(panel.locator('[data-act="tgtSet"]')).toHaveText(['English', 'Español', 'Français']);
  await expect(panel.locator('[data-act="tgtSet"][aria-pressed="true"]')).toHaveText('English');
  await Promise.all([page.waitForEvent('load'), panel.locator('[data-act="tgtSet"][data-l="es"]').click()]);
  expect(await page.evaluate(() => [window.__i18n.profile.tgt, window.__i18n.store])).toEqual(['es', 'mt2:es:']);
  await expect.poll(() => keys(page)).toContain('mt2:es:answers/t1');
  expect(await keys(page)).toContain('mt2:en:answers/t1'); // English progress is kept
  expect(await lineText(page)).toEqual(['La puerta azul está abierta.', 'Estoy cansado.']);
});

test('travel: the speaker\'s gender picks the line\'s form; a line without one stays as it is', async ({ page }) => {
  await travel(page);
  await expect.poll(() => keys(page)).toContain('mt2:en:answers/t1');
  await page.evaluate(() => localStorage.setItem('mt2:__tgt', 'fr'));
  await page.reload();
  expect(await lineText(page)).toEqual(['La porte bleue est ouverte.', 'Je suis fatigué.']);
  await page.locator('nav.tabs [data-tab="settings"]').click();
  await expect(page.locator('#app-panel [data-act="genderSet"][aria-pressed="true"]')).toHaveText('Belirtme');
  await Promise.all([page.waitForEvent('load'), page.locator('#app-panel [data-act="genderSet"][data-g="f"]').click()]);
  expect(await lineText(page)).toEqual(['La porte bleue est ouverte.', 'Je suis fatiguée.']);
  await page.locator('nav.tabs [data-tab="settings"]').click();
  await Promise.all([page.waitForEvent('load'), page.locator('#app-panel [data-act="genderSet"][data-g="m"]').click()]);
  expect(await lineText(page)).toEqual(['La porte bleue est ouverte.', 'Je suis fatigué.']);
});

test('travel.html is built from index.html and the open set, and is up to date', () => {
  const r = require('node:child_process').spawnSync(process.execPath, [path.join(ROOT, 'dev/tools/travel.cjs'), '--check'], { encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  const set = JSON.parse(fs.readFileSync(path.join(ROOT, 'dev/travel/set.json'), 'utf8'));
  const lines = Object.values(set.answers).flatMap((a) => a.lines);
  expect(lines.length).toBeGreaterThan(40);
  for (const l of lines) { expect(Object.keys(l).filter((k) => ['tr', 'en', 'es', 'fr'].includes(k)).length, l.id).toBe(4); expect(l.intent, l.id).toBeTruthy(); }
  expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length);
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  expect(sw).toContain("'./travel.html'"); expect(sw).toContain("'./travel.webmanifest'");
});

test('the travel app shows only what it has: no rehearsal, mock interview or patterns; the guide follows', async ({ page }) => {
  await page.route('**/audio*.bin', (r) => r.abort());
  await page.goto('travel.html');
  await expect(page.locator('#gate')).toBeHidden();
  expect(await page.title()).toBe('Seyahat Trainer');
  await expect(page.locator('.topbar .brand')).toHaveText('Seyahat Trainer');
  await expect(page.locator('#view')).not.toContainText('Prova et');
  await page.locator('nav.tabs [data-tab="reh"]').click();
  await expect(page.locator('[data-act="rehMode"]')).toHaveCount(0); // one mode left: no switch
  await expect(page.locator('#view')).toContainText('Hız testi');
  await page.locator('nav.tabs [data-tab="settings"]').click();
  const titles = await page.locator('#help > details.howto > summary').allTextContents();
  expect(titles).toContain('Hız testi'); expect(titles).not.toContain('Prova, Mülakat, Hız testi, Kalıp');
  await expect(page.locator('#help details.howto').first()).not.toContainText('Prova et');
  await expect(page.locator('#app-panel [data-act="tgtSet"]')).toHaveCount(3);
});

test("an app's own words: every key exists in MSG.tr with the same placeholders; the travel app says konu, not cevap", async ({ page }) => {
  await page.route('**/audio*.bin', (r) => r.abort());
  await page.goto('travel.html');
  const r = await page.evaluate(() => {
    const I = window.__i18n, own = I.appText.travel.tr, ph = (t) => [...String(t).matchAll(/\{([\w.:]+)/g)].map((m) => m[1]).sort().join(',');
    return { missing: Object.keys(own).filter((k) => I.msg.tr[k] === undefined), ph: Object.keys(own).filter((k) => ph(own[k]) !== ph(I.msg.tr[k])),
      words: Object.keys(own).filter((k) => /cevap|cevab|mülakat/i.test(own[k])), t: I.t('renderToday.cevapSatirGundeBir', { answersLength: 2, total: 9 }) };
  });
  expect(r.missing).toEqual([]); expect(r.ph).toEqual([]); expect(r.words).toEqual([]);
  expect(r.t).toBe('2 konu, 9 satır. Günde bir yeni konu; nereden başlayacağını Yeni bölümünde seç.');
  for (const tab of ['today', 'reh', 'track', 'lines', 'settings']) {
    await page.locator('nav.tabs [data-tab="' + tab + '"]').click();
    await expect(page.locator('#view'), tab).not.toContainText(/cevap|cevab|mülakat/i);
  }
  await expect(page.locator('.tagchip')).toHaveCount(0); // a topic is its own group: no chip repeating its name
});

test('the interview app keeps its words', async ({ page }) => {
  await page.goto(PAGE);
  expect(await page.evaluate(() => window.__i18n.t('btn.startNew'))).toBe('Yeni cevaba başla');
});
