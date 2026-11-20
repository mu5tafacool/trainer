'use strict';
// Prova result: the round is saved only with ↺ Takıldım / ✓ Akıcıydı. Those two are suggested (framed, the choice stays
// yours): over the round's target or under half said (🎤) → Takıldım; 85%+ said within the target → Akıcıydı.
// ← Bitir on an unsaved result asks first: Vazgeç stays, Kaydetmeden çık leaves without a record.
// Time is fast-forwarded; speech is stubbed; the answer text comes from the seed at run time.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, dumpStore, writeStore, seedOf, stubSpeech } = require('./helpers.cjs');

async function boot(page) {
  requirePass(test);
  await page.route('**/audio*.bin', (r) => r.abort());
  await stubSpeech(page);
  await page.clock.install();
  await unlock(page);
  const st = await dumpStore(page);
  await writeStore(page, { 'data/users/local/settings': { ...(st['data/users/local/settings'] || {}), fuOn: false } });
  await page.reload();
  const { answers } = await seedOf(), aid = Object.keys(answers).find((id) => answers[id].lines.length >= 5);
  await page.getByRole('button', { name: 'Prova', exact: true }).first().click();
  await page.locator('[data-act="openReh"][data-id="' + aid + '"]').first().click();
  return { aid, a: answers[aid] };
}
async function round(page, ms, said) {
  await page.locator('[data-act="rehStart"]').first().click();
  if (said != null) {
    if (await page.locator('[data-act="dictOpen"]').count()) await page.locator('[data-act="dictOpen"]').click();
    await page.fill('#dict', said);
  }
  await page.clock.fastForward(ms);
  await page.locator('[data-act="rehStop"]').click();
}
const sugg = (page) => page.locator('[data-act="rehSave"].sugg');

test('suggestion: under half said → Takıldım; all said → Akıcıydı; no 🎤 → none; over the target → Takıldım', async ({ page }) => {
  const { aid, a } = await boot(page);
  await round(page, 60000, null);
  await expect(sugg(page)).toHaveCount(0);

  await page.locator('[data-act="rehRound"]').click(); // round 2, target = 85% of 1:00 → over it at 1:30
  await round(page, 90000, a.lines.map((l) => l.en).join(' '));
  await expect(sugg(page)).toHaveAttribute('data-ok', '0');
  await expect(page.getByText('hedef süre aşıldı')).toBeVisible();
  await page.locator('[data-act="rehSave"][data-ok="0"]').click();

  // a fresh rehearsal of the same answer, from the Prova list
  await page.locator('[data-act="openReh"][data-id="' + aid + '"]').first().click();
  await round(page, 30000, a.lines[0].en);
  await expect(sugg(page)).toHaveAttribute('data-ok', '0');
  await expect(page.locator('p.hint', { hasText: 'Çerçeveli düğme öneri (söylenen %' })).toBeVisible();
  await page.locator('[data-act="rehRound"]').click();
  await round(page, 20000, a.lines.map((l) => l.en).join(' '));
  await expect(sugg(page)).toHaveAttribute('data-ok', '1');
});

test('Bitir on an unsaved result asks first; Vazgeç stays; Kaydetmeden çık leaves with no record; saving still works', async ({ page }) => {
  const { aid } = await boot(page);
  await round(page, 40000, null);
  await page.locator('[data-act="endSess"]').click();
  await expect(page.locator('.confirm.leave')).toContainText('henüz kaydedilmedi');
  await page.locator('[data-act="rehLeaveNo"]').click();
  await expect(page.locator('.confirm.leave')).toHaveCount(0);
  await expect(page.locator('[data-act="rehSave"]').first()).toBeVisible();

  await page.locator('[data-act="endSess"]').click();
  await page.locator('[data-act="rehLeave"]').click();
  await expect(page.locator('[data-act="rehMode"]').first()).toBeVisible(); // back on the Prova page
  await page.clock.fastForward(1500);
  expect(((await dumpStore(page))['data/users/local/progress'] || { reh: {} }).reh[aid]).toBeUndefined();

  // Bitir while talking (nothing to lose yet) leaves at once
  await page.locator('[data-act="openReh"][data-id="' + aid + '"]').first().click();
  await page.locator('[data-act="rehStart"]').first().click();
  await page.locator('[data-act="endSess"]').click();
  await expect(page.locator('[data-act="rehMode"]').first()).toBeVisible();

  // asked, then saved from the result
  await page.locator('[data-act="openReh"][data-id="' + aid + '"]').first().click();
  await round(page, 40000, null);
  await page.locator('[data-act="endSess"]').click();
  await page.locator('[data-act="rehSave"][data-ok="1"]').click();
  await page.clock.fastForward(1500);
  expect((await dumpStore(page))['data/users/local/progress'].reh[aid]).toMatchObject({ ok: true, n: 1 });
});
