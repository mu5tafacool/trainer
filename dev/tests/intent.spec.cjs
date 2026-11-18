'use strict';
// Niyet / iskelet (seed v10). Every line has an intent label (1–3 words, unique inside its answer).
// Yeni: a stop bar above the card (Durak k/N · previous › current › next, one segment per line).
// Prova (Cevap provası, round 1): "Başla · önce iskelet" → 20 s to say the stops → the stop list → "Tam cevaba başla";
// the answer's timer starts only then; the result shows each line's label. Not in round 2, not in Mülakat.
// Ayarlar → Akış → Niyet ve iskelet turns both off. An edited line takes the seed's label unless the user wrote their own.
// Speech is stubbed and time fast-forwarded; lines are compared with the seed at run time.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, dumpStore, writeStore, seedOf, stubSpeech } = require('./helpers.cjs');

const card = (page) => page.locator('article.icard').first();
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
const byEn = async () => { const { answers } = await seedOf(), m = {}; Object.values(answers).forEach((a) => a.lines.forEach((l) => { m[l.en] = { a, l }; })); return m; };
const bigAnswer = (answers) => Object.keys(answers).find((id) => answers[id].lines.length >= 5);
async function openProva(page, aid) {
  await page.getByRole('button', { name: 'Prova', exact: true }).first().click();
  await page.locator('[data-act="openReh"][data-id="' + aid + '"]').first().click();
}
async function checkBar(page, m) {
  const en = (await card(page).locator('.en').textContent()).trim();
  const { a, l } = m[en], k = a.lines.findIndex((x) => x.id === l.id), bar = page.locator('.durak');
  await expect(bar).toContainText('Durak ' + (k + 1) + '/' + a.lines.length);
  await expect(bar.locator('b')).toHaveText(l.intent);
  if (k > 0) await expect(bar).toContainText(a.lines[k - 1].intent + ' ›');
  if (k < a.lines.length - 1) await expect(bar).toContainText('› ' + a.lines[k + 1].intent);
  await expect(bar.locator('.dseg i')).toHaveCount(a.lines.length);
  await expect(bar.locator('.dseg i.did')).toHaveCount(k);
  await expect(bar.locator('.dseg i.on')).toHaveCount(1);
}

test('seed: every line has a 1–3 word label, unique inside its answer', async () => {
  requirePass(test);
  const { meta, answers } = await seedOf();
  expect(parseInt(meta.v.slice(1), 10)).toBeGreaterThanOrEqual(10);
  for (const a of Object.values(answers)) {
    const seen = new Set();
    for (const l of a.lines) {
      expect(String(l.intent || '').trim(), l.id).not.toBe('');
      expect(l.intent.trim().split(/\s+/).length, l.id).toBeLessThanOrEqual(3);
      expect(seen.has(l.intent), l.id).toBe(false);
      seen.add(l.intent);
    }
  }
});

test('Yeni: the stop bar shows where the line sits in its answer, and moves with the next line', async ({ page }) => {
  await boot(page);
  const m = await byEn();
  await page.locator('[data-act="startIntro"]').click();
  await end(page);
  await checkBar(page, m);
  await page.locator('[data-act="introSkip"]').first().click();
  await page.locator('[data-act="introNext"]').click();
  await end(page);
  await checkBar(page, m);
});

test('Prova: 20 s skeleton round, then the stops; the timer starts with the full answer; round 2 has none', async ({ page }) => {
  await boot(page);
  const { answers } = await seedOf(), aid = bigAnswer(answers), labels = answers[aid].lines.map((l) => l.intent);
  await openProva(page, aid);
  await page.locator('[data-act="skelStart"]').click();
  await expect(card(page)).toContainText('İskelet turu');
  await expect(card(page)).toContainText(labels.length + ' durak · 20 sn');
  await expect(page.locator('#skelleft')).toHaveText('20 sn');
  await expect(page.locator('ol.stops')).toHaveCount(0);
  await page.clock.fastForward(10000);
  await expect(page.locator('#skelleft')).toHaveText('10 sn');
  await page.clock.fastForward(10500); // time is up: the stops open by themselves
  await expect(page.locator('ol.stops li')).toHaveText(labels);
  await page.clock.fastForward(5000); // looking at the list does not count
  await page.locator('[data-act="rehStart"]').click();
  await expect(page.locator('#timer')).toHaveText('0:00');
  await page.clock.fastForward(30000);
  await page.locator('[data-act="rehStop"]').click();
  await expect(card(page).locator('.ctx')).toContainText('0:30');
  await expect(page.locator('.anslines .ilab')).toHaveText(labels);
  await page.locator('[data-act="rehRound"]').click();
  await expect(page.locator('[data-act="skelStart"]')).toHaveCount(0);
  await expect(page.locator('[data-act="rehStart"]')).toBeVisible();
});

test('Prova keys: Space shows the stops, then starts; İskeletsiz başla skips it; Mülakat has none', async ({ page }) => {
  await boot(page);
  const { answers } = await seedOf(), aid = bigAnswer(answers);
  await openProva(page, aid);
  await page.locator('[data-act="skelStart"]').click();
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await page.keyboard.press('Space');
  await expect(page.locator('ol.stops li')).toHaveCount(answers[aid].lines.length);
  await page.keyboard.press('Space');
  await expect(page.locator('#timer')).toBeVisible();

  await page.reload();
  await openProva(page, aid);
  await page.locator('[data-act="rehStart"]').click(); // İskeletsiz başla
  await expect(page.locator('#timer')).toBeVisible();
  await expect(page.locator('ol.stops')).toHaveCount(0);

  await page.reload();
  await page.getByRole('button', { name: 'Prova', exact: true }).first().click();
  await page.locator('[data-act="rehMode"][data-m="mock"]').click();
  await page.locator('[data-act="mockStart"]').click();
  await expect(page.locator('[data-act="rehStart"]')).toBeVisible();
  await expect(page.locator('[data-act="skelStart"]')).toHaveCount(0);
});

test('Ayarlar off: no stop bar in Yeni, no skeleton in Prova, no labels in the result', async ({ page }) => {
  await boot(page, { intent: false });
  const { answers } = await seedOf(), aid = bigAnswer(answers);
  await page.getByRole('button', { name: 'Ayarlar', exact: true }).first().click();
  await expect(page.locator('#set-intent')).not.toBeChecked();
  await page.getByRole('button', { name: 'Bugün', exact: true }).first().click();
  await page.locator('[data-act="startIntro"]').click();
  await end(page);
  await expect(page.locator('.durak')).toHaveCount(0);
  await page.reload();
  await openProva(page, aid);
  await expect(page.locator('[data-act="skelStart"]')).toHaveCount(0);
  await page.locator('[data-act="rehStart"]').click();
  await page.clock.fastForward(5000);
  await page.locator('[data-act="rehStop"]').click();
  await expect(page.locator('.anslines li')).toHaveCount(answers[aid].lines.length);
  await expect(page.locator('.anslines .ilab')).toHaveCount(0);
});

test('Cümleler: the label is editable; the user\'s own label is kept', async ({ page }) => {
  await boot(page);
  const { answers } = await seedOf(), aid = bigAnswer(answers), l = answers[aid].lines[1];
  await page.getByRole('button', { name: 'Cümleler', exact: true }).first().click();
  await page.locator('[data-act="toggleAns"][data-id="' + aid + '"]').click();
  await page.locator('[data-act="editLine"][data-id="' + l.id + '"]').click();
  await expect(page.locator('#ed-intent')).toHaveValue(l.intent);
  await page.fill('#ed-intent', '  Benim   durağım ');
  await page.locator('[data-act="saveEdit"]').click();
  await page.clock.fastForward(1500);
  const saved = (await dumpStore(page))['answers/' + aid].lines.find((x) => x.id === l.id);
  expect(saved.intent).toBe('Benim durağım');
  expect(saved.intentOwn).toBe(1);
  expect(saved.en).toBe(l.en);
  expect(saved.edited).toBeUndefined(); // a new label alone keeps the line on the seed (its text still updates)

  // changing the Turkish does mark it edited
  await page.locator('[data-act="editLine"][data-id="' + l.id + '"]').click();
  await page.fill('#ed-tr', l.tr + ' (düzeltildi)');
  await page.locator('[data-act="saveEdit"]').click();
  await page.clock.fastForward(1500);
  const again = (await dumpStore(page))['answers/' + aid].lines.find((x) => x.id === l.id);
  expect(again.edited).toBeTruthy();
  expect(again.intent).toBe('Benim durağım');
});

test('upgrade: a line with only the user\'s label takes the seed\'s new text and keeps the label', async ({ page }) => {
  requirePass(test);
  const { meta, data, answers } = await seedOf();
  const order = data.order || [], prevV = order[order.indexOf(meta.v) - 1];
  test.skip(!prevV, 'no previous seed version');
  const aid = bigAnswer(answers), L2 = answers[aid].lines[2];
  await unlock(page);
  const before = await dumpStore(page);
  // as on a device from the previous seed: old text, a label the user wrote, never edited
  const old = { ...L2, en: 'Old text of this line before the fix.', tr: 'Düzeltmeden önceki eski metin.', intent: 'Benim adım', intentOwn: 1 };
  delete old.edited;
  await writeStore(page, {
    ['answers/' + aid]: { ...before['answers/' + aid], lines: before['answers/' + aid].lines.map((l) => (l.id === L2.id ? old : l)) },
    __seed: { v: prevV, at: '2026-01-01T00:00:00.000Z', from: null },
  });
  await page.reload();
  await expect.poll(async () => (await dumpStore(page)).__seed.v, { timeout: 30000 }).toBe(meta.v);
  const m = (await dumpStore(page))['answers/' + aid].lines.find((x) => x.id === L2.id);
  expect(m.en).toBe(L2.en);
  expect(m.tr).toBe(L2.tr);
  expect(m.intent).toBe('Benim adım');
  expect(m.intentOwn).toBe(1);
  expect(m.edited).toBeUndefined();
});

test('upgrade: an edited line takes the seed label; a label the user wrote stays; progress is untouched', async ({ page }) => {
  requirePass(test);
  const { meta, data, answers } = await seedOf();
  const order = data.order || [], prevV = order[order.indexOf(meta.v) - 1];
  test.skip(!prevV, 'no previous seed version');
  const aid = bigAnswer(answers), [L0, L1, ...rest] = answers[aid].lines;
  await unlock(page);
  const before = await dumpStore(page);
  const e0 = { ...L0, en: L0.en + ' And that is all.', edited: '2026-11-01' }; delete e0.intent;
  const e1 = { ...L1, edited: '2026-11-01', intent: 'Benim adım', intentOwn: 1 };
  const srs = { c: { [L0.id]: { p: { ivl: 4, ease: 2.5, due: '2026-12-02', reps: 2, lapses: 0 } } } };
  await writeStore(page, {
    ['answers/' + aid]: { ...before['answers/' + aid], lines: [e0, e1].concat(rest.map((l) => { const x = { ...l }; delete x.intent; return x; })) },
    ['data/users/local/srs_' + aid]: srs,
    __seed: { v: prevV, at: '2026-01-01T00:00:00.000Z', from: null },
  });
  await page.reload();
  await expect.poll(async () => (await dumpStore(page)).__seed.v, { timeout: 30000 }).toBe(meta.v);
  const after = await dumpStore(page), lines = after['answers/' + aid].lines, by = (id) => lines.find((x) => x.id === id);
  expect(by(L0.id).en).toBe(e0.en);
  expect(by(L0.id).intent).toBe(L0.intent);
  expect(by(L1.id).intent).toBe('Benim adım');
  rest.forEach((l) => expect(by(l.id).intent).toBe(l.intent));
  expect(after['data/users/local/srs_' + aid]).toEqual(srs);
});
