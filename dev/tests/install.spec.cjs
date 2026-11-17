'use strict';
// Install: Chrome/Edge use their own prompt (manifest with description and screenshots; the page does not catch it).
// Safari has none, so a note there: only in a tab, not in the installed app; Kapat for this visit, "Bir daha gösterme" for good.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock } = require('./helpers.cjs');

const inst = (page) => page.locator('#inst');

const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
test('Mac Safari tab: shown; Kapat hides it for this visit; a new visit shows it; Bir daha gösterme hides it for good', async ({ browser }) => {
  requirePass(test);
  const context = await browser.newContext({ userAgent: MAC_SAFARI });
  const page = await context.newPage();
  await page.route('**/audio*.bin', (r) => r.abort());
  await unlock(page);
  await expect(inst(page)).toBeVisible();
  await expect(inst(page)).toContainText("Dock'a Ekle");
  await inst(page).getByRole('button', { name: 'Kapat' }).click();
  await expect(inst(page)).toBeHidden();
  await page.reload();
  await expect(inst(page)).toBeHidden(); // same visit (tab)

  const p2 = await context.newPage();
  await p2.route('**/audio*.bin', (r) => r.abort());
  await p2.goto(page.url());
  await expect(inst(p2)).toBeVisible(); // a new visit
  await inst(p2).getByRole('button', { name: 'Bir daha gösterme' }).click();
  const p3 = await context.newPage();
  await p3.route('**/audio*.bin', (r) => r.abort());
  await p3.goto(page.url());
  await expect(p3.locator('.topbar')).toBeVisible();
  await expect(inst(p3)).toBeHidden();
  await context.close();
});

test('Chrome: no note of ours, the browser\'s own install prompt is left alone; the manifest has what its install sheet shows', async ({ page }) => {
  requirePass(test);
  await page.route('**/audio*.bin', (r) => r.abort());
  await unlock(page);
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(inst(page)).toBeHidden();
  const kept = await page.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); window.dispatchEvent(e); return !e.defaultPrevented; });
  expect(kept).toBe(true);
  const fs = require('node:fs'), path = require('node:path'), root = path.resolve(__dirname, '..', '..');
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  expect(m.description).toBeTruthy();
  expect(m.screenshots.map((s) => s.form_factor).sort()).toEqual(['narrow', 'wide']);
  m.screenshots.forEach((s) => expect(fs.existsSync(path.join(root, s.src))).toBe(true));
});

test('installed app (standalone): no note', async ({ page }) => {
  requirePass(test);
  await page.route('**/audio*.bin', (r) => r.abort());
  await page.addInitScript(() => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (q === '(display-mode: standalone)' ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q));
  });
  await unlock(page);
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(inst(page)).toBeHidden();
});

test('iPhone Safari: the note says Ana Ekrana Ekle and that Safari and the Home Screen app keep separate progress', async ({ browser }) => {
  requirePass(test);
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' });
  const page = await ctx.newPage();
  await page.route('**/audio*.bin', (r) => r.abort());
  await unlock(page);
  await expect(inst(page)).toContainText('Ana Ekrana Ekle');
  await expect(inst(page)).toContainText('kayıtları ayrıdır');
  await ctx.close();
});
