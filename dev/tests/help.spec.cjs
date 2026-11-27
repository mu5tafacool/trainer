'use strict';
// The guide (Ayarlar → Nasıl çalışır, v0.85): 12 sections in the app's own order, short ones first, the long texts in a closed
// Ayrıntılar at the end. It is written for any sentence set: no group codes, no internal words.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, stubSpeech } = require('./helpers.cjs');

const HTML = fs.readFileSync(path.resolve(__dirname, '..', '..', process.env.TRAINER_PAGE || 'index.html'), 'utf8');
const I18N = HTML.slice(HTML.indexOf('/* i18n:start */'), HTML.indexOf('/* i18n:end */'));
const HELP = [...I18N.matchAll(/"(help(?:Panel)?\.\w+)": "((?:[^"\\]|\\.)*)"/g)].map((m) => [m[1], m[2]]);

test('guide texts name no set: no group codes, no internal words', () => {
  expect(HELP.length).toBeGreaterThan(60);
  const bad = HELP.filter(([, v]) => /\b[SH]\d{1,2}\b|\bseed\b|\brecall\b|Speak Screen|dokümandaki/i.test(v)).map(([k]) => k);
  expect(bad).toEqual([]);
  expect(I18N).toContain('"renderTrack.bSesliRecall": "B · Hatırlama"'); // fits the narrow Dinle switch on a phone
});

test('on screen: 12 sections, the first open, Ayrıntılar closed at the end, the short part stays short', async ({ page }) => {
  requirePass(test);
  await page.route('**/audio*.bin', (r) => r.abort());
  await stubSpeech(page); await unlock(page);
  await page.locator('nav.tabs [data-tab="settings"]').click();
  const help = page.locator('#help');
  const s = await help.evaluate((h) => [...h.querySelectorAll(':scope > details.howto')].map((d) => ({ t: d.querySelector('summary').textContent.trim(), open: d.open, words: d.textContent.trim().split(/\s+/).length })));
  expect(s.map((x) => x.t)).toEqual(['Hızlı başlangıç', 'Bir gün nasıl geçer', 'Yeni satır öğrenmek', 'Tekrar ve puan', 'Söyle ve kontrol et', 'Zorlandıklarım', 'Dinle',
    'Prova, Mülakat, Hız testi, Kalıp', 'Cümleler ve düzenleme', 'Kayıt, cihazlar, güncelleme', 'Kısayollar', 'Ayrıntılar']);
  expect(s.map((x) => x.open)).toEqual([true].concat(Array(11).fill(false)));
  const short = s.slice(0, 10).reduce((n, x) => n + x.words, 0);
  expect(short, 'sections 1–10 in words').toBeLessThan(900);
  expect(await help.locator('details.howto').last().locator('p.k').count()).toBe(9);
  await expect(help).not.toContainText('{');
  await expect(help.locator('details.howto').first()).toContainText('Tekrarlara başla');
});
