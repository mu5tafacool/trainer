'use strict';
// Behaviour the old test set covered: pattern highlight, continuing new learning where it was left, progress reset and
// its undo, Dinle A's "Önce Türkçe" and simultaneous last round, and Prova's per-line coverage. Speech is stubbed.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, dumpStore, writeStore, seedOf, makeDue, stubSpeech } = require('./helpers.cjs');

const card = (page) => page.locator('article.icard').first();
async function end(page) {
  for (let k = 0; k < 30; k++) { await page.clock.fastForward(100); if (await page.evaluate(() => window.__speechEnd())) return; }
  throw new Error('nothing was being spoken');
}
async function boot(page, settings, again) {
  requirePass(test);
  if (!again) {
    await page.route('**/audio*.bin', (r) => r.abort());
    await stubSpeech(page);
    await page.clock.install();
    await unlock(page);
  }
  if (settings) {
    const st = await dumpStore(page);
    await writeStore(page, { 'data/users/local/settings': { ...(st['data/users/local/settings'] || {}), ...settings } });
    await page.reload();
  }
}
const byEn = async () => { const { answers } = await seedOf(), m = {}; Object.values(answers).forEach((a) => a.lines.forEach((l) => { m[l.en] = l; })); return m; };

test('pattern highlight: the line\'s pattern chunks are blue; off in Settings, none', async ({ page }) => {
  await boot(page);
  const lines = await byEn();
  await page.locator('[data-act="startIntro"]').click();
  const en = card(page).locator('.en');
  const l = lines[(await en.textContent()).trim()];
  expect(l, 'the card shows a seed line').toBeTruthy();
  const kp = await en.locator('.kp').allTextContents();
  await expect(en.locator('[role="text"]')).toHaveCount(1); // one piece for Spoken Content
  await expect(en.locator('[role="text"] .kp')).toHaveCount(kp.length);
  expect(kp.length).toBeGreaterThan(0);
  kp.forEach((c) => expect(l.en).toContain(c));
  if ((l.mk || []).length) expect(kp).toEqual(l.mk.filter((c) => l.en.includes(c)));

  await boot(page, { hl: false }, true);
  await page.locator('[data-act="startIntro"], [data-act="resumeIntro"]').first().click();
  await expect(card(page).locator('.en')).toBeVisible();
  await expect(card(page).locator('.kp')).toHaveCount(0);
});

test('new learning: Ara ver on the 2nd line → Kaldığın yerden devam opens that line', async ({ page }) => {
  await boot(page);
  await page.locator('[data-act="startIntro"]').click();
  await end(page);
  await page.locator('[data-act="introSkip"]').first().click();
  await page.locator('[data-act="introNext"]').click();
  await expect(page.locator('.sesshead .mono')).toHaveText(/^Yeni · 2\//);
  await end(page);
  const tr = await card(page).locator('.tr').textContent();
  await page.locator('[data-act="endSess"]').click();
  await page.locator('[data-act="resumeIntro"]').click();
  await expect(page.locator('.sesshead .mono')).toHaveText(/^Yeni · 2\//);
  await end(page);
  await expect(card(page).locator('.tr')).toHaveText(tr);
});

test('progress reset needs SIFIRLA, clears the schedule, and Sıfırlamayı geri al brings it back', async ({ page }) => {
  await boot(page);
  const { answers } = await seedOf();
  const aid = Object.keys(answers)[0], ids = answers[aid].lines.slice(0, 2).map((l) => l.id);
  await makeDue(page, answers, ids);
  await page.reload();
  const srs = async () => { await page.clock.fastForward(3000); return ((await dumpStore(page))['data/users/local/srs_' + aid] || { c: {} }).c; };
  const before = await srs();
  expect(Object.keys(before)).toEqual(ids);

  await page.getByRole('button', { name: 'Ayarlar', exact: true }).first().click();
  await page.locator('[data-act="resetAsk"]').click();
  await expect(page.locator('#reset-do')).toBeDisabled();
  await page.fill('#reset-ok', 'sıfırla');
  await expect(page.locator('#reset-do')).toBeEnabled();
  await page.locator('#reset-do').click();
  await expect(page.getByText('İlerleme sıfırlandı')).toBeVisible();
  expect(await srs()).toEqual({});

  await page.getByRole('button', { name: 'Ayarlar', exact: true }).first().click();
  await page.locator('[data-act="resetUndo"]').click();
  await expect(page.getByText('Sıfırlama geri alındı')).toBeVisible();
  expect(await srs()).toEqual(before);
});

async function dinleA(page, settings, again) {
  await boot(page, null, again);
  const { answers } = await seedOf();
  const aid = Object.keys(answers).find((id) => answers[id].lines.length >= 4);
  const lines = answers[aid].lines.slice(0, 4);
  await makeDue(page, answers, lines.map((l) => l.id)); // started lines, none forgotten
  const st = await dumpStore(page);
  await writeStore(page, { 'data/users/local/settings': { ...(st['data/users/local/settings'] || {}), repA: 2, ...settings } });
  await page.reload();
  await page.getByRole('button', { name: 'Dinle', exact: true }).first().click();
  await page.locator('[data-act="trackMode"][data-m="A"]').click();
  await page.locator('[data-act="trackPlay"]').click();
  await page.clock.fastForward(200);
  return lines;
}
const spoken = (page) => page.evaluate(() => window.__spoken.filter((t) => t.trim())); // " " is the tap that wakes speech

test('Dinle A · Önce Türkçe: Otomatik skips TR on learned lines; Her zaman starts with TR', async ({ page }) => {
  let lines = await dinleA(page, { srcFirst: 'auto' });
  let s = await spoken(page);
  expect(s.length).toBe(1);
  expect(lines.map((l) => l.tr)).not.toContain(s[0]);

  lines = await dinleA(page, { srcFirst: 'always' }, true);
  s = await spoken(page);
  expect(lines.map((l) => l.tr)).toContain(s[0]);
  await expect(page.locator('#player')).toContainText('Anlam');
});

test('Dinle A · Eşzamanlı: the last round is said with the voice, only when it is on', async ({ page }) => {
  const seen = async () => {
    const phases = [];
    for (let k = 0; k < 6; k++) { phases.push(await page.locator('#player').textContent()); await end(page); await page.clock.fastForward(15000); }
    return phases.join(' | ');
  };
  await dinleA(page, { srcFirst: 'off', simul: true });
  expect(await seen()).toContain('Birlikte söyle · 2/2');
  await dinleA(page, { srcFirst: 'off', simul: false }, true);
  expect(await seen()).not.toContain('Birlikte söyle');
});

test('Dinle: the status line is the shared one, with the step once and the seconds bottom right', async ({ page }) => {
  await dinleA(page, { srcFirst: 'off', repA: 3, simul: false });
  const line = page.locator('#player .sayline');
  for (let r = 1; r <= 3; r++) {
    await expect(line).toHaveText((r < 3 ? 'Dinle ve oku' : 'Dinle') + ' · ' + r + '/3'); // round 3 is blurred
    await expect(page.locator('#player .ctx')).not.toContainText('tekrar');
    await end(page); await page.clock.fastForward(50);
    await expect(line).toHaveText('Tekrar et · ' + r + '/3');
    await page.clock.fastForward(15000);
  }
  await page.locator('[data-act="trackStop"]').click();
  await page.locator('[data-act="trackMode"][data-m="B"]').click();
  await page.locator('[data-act="trackPlay"]').click();
  await page.clock.fastForward(1500);
  await expect(line).toHaveText('Dinle'); // the Turkish plays
  await end(page); await page.clock.fastForward(50);
  await expect(line).toHaveText('Sen söyle');
  await expect(page.locator('#player .cardfoot #gapleft')).toHaveText(/^\d+ sn$/);
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const gap = await page.evaluate(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(); return r('#player .cardfoot').right - r('#gapleft').right; });
    expect(Math.abs(gap)).toBeLessThan(1);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.fastForward(60000);
  await expect(line).toHaveText(/^Dinle ve oku · 1\//);
});

test('Prova 🎤: each line shows how much of it was said, and the total', async ({ page }) => {
  await boot(page);
  const { answers } = await seedOf();
  const aid = Object.keys(answers).find((id) => answers[id].lines.length >= 3);
  const a = answers[aid];
  await page.getByRole('button', { name: 'Prova', exact: true }).first().click();
  await page.locator('[data-act="openReh"][data-id="' + aid + '"]').first().click();
  await page.locator('[data-act="rehStart"]').click();
  await page.locator('[data-act="dictOpen"]').click();
  await page.fill('#dict', a.lines[0].en);
  await page.locator('[data-act="rehStop"]').click();
  const cov = page.locator('.anslines li .cov');
  await expect(cov).toHaveCount(a.lines.length);
  await expect(cov.first()).toHaveText('%100');
  const rest = (await cov.allTextContents()).slice(1).map((t) => +t.slice(1));
  expect(Math.max(...rest)).toBeLessThan(100);
  await expect(page.locator('.ctx').filter({ hasText: 'söylenen' })).toContainText(/söylenen %\d+/);
});
