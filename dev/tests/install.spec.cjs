'use strict';
// Install drawer: Chrome/Edge catch beforeinstallprompt and offer "Yükle" (opens the browser's install dialog);
// iPhone Safari shows the same drawer with Share → Add to Home Screen steps; never in the installed app;
// "Kapat" hides it for 7 days. The manifest has what the browser's install dialog shows.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock } = require('./helpers.cjs');

const drawer = (page) => page.locator('#idrawer');
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
// a stand-in for Chrome's event: prompt() is recorded, the choice is "accepted" unless told otherwise
const fire = (page, outcome) => page.evaluate((outcome) => {
  const e = new Event('beforeinstallprompt', { cancelable: true });
  e.prompt = () => { window.__prompted = (window.__prompted || 0) + 1; };
  e.userChoice = Promise.resolve({ outcome: outcome || 'accepted' });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}, outcome);

async function boot(page) {
  requirePass(test);
  await page.route('**/audio*.bin', (r) => r.abort());
  await page.clock.install();
  await unlock(page);
}

test('Chrome: the event is held back, the drawer slides up with icon, name, text, Yükle and Kapat; Yükle opens the browser dialog', async ({ page }) => {
  await boot(page);
  expect(await fire(page)).toBe(true); // the browser's own banner is held back
  await expect(drawer(page)).toHaveClass(/open/);
  await expect(drawer(page).locator('img')).toHaveAttribute('src', 'icon-192.png');
  await expect(drawer(page)).toContainText('Mülakat Trainer');
  await expect(drawer(page)).toContainText('Daha hızlı erişim ve tam ekran deneyimi');
  await drawer(page).getByRole('button', { name: 'Yükle' }).click();
  expect(await page.evaluate(() => window.__prompted)).toBe(1);
  await expect(drawer(page)).not.toHaveClass(/open/);
});

test('Kapat hides it for 7 days, then it may come back', async ({ page }) => {
  await boot(page);
  await fire(page);
  await drawer(page).getByRole('button', { name: 'Kapat' }).click();
  await expect(drawer(page)).not.toHaveClass(/open/);
  const until = await page.evaluate(() => +localStorage.getItem('mt-inst-until') - Date.now());
  expect(Math.round(until / 86400000)).toBe(7);
  await page.reload();
  await fire(page);
  await page.clock.fastForward(500);
  await expect(page.locator('#idrawer.open')).toHaveCount(0);
  await page.clock.fastForward(8 * 86400000);
  await page.reload();
  await fire(page);
  await expect(drawer(page)).toHaveClass(/open/);
});

test('cancelling the browser dialog also waits 7 days', async ({ page }) => {
  await boot(page);
  await fire(page, 'dismissed');
  await drawer(page).getByRole('button', { name: 'Yükle' }).click();
  await expect(drawer(page)).not.toHaveClass(/open/);
  expect(await page.evaluate(() => +localStorage.getItem('mt-inst-until') > Date.now())).toBe(true);
});

test('iPhone Safari: same drawer with the two Share steps and no Yükle button', async ({ browser }) => {
  requirePass(test);
  const ctx = await browser.newContext({ userAgent: IPHONE });
  const page = await ctx.newPage();
  await page.route('**/audio*.bin', (r) => r.abort());
  await unlock(page);
  await expect(drawer(page)).toHaveClass(/open/, { timeout: 10000 });
  await expect(drawer(page).locator('ol li')).toHaveCount(2);
  await expect(drawer(page)).toContainText('Paylaş');
  await expect(drawer(page)).toContainText('Ana Ekrana Ekle');
  await expect(drawer(page).getByRole('button', { name: 'Yükle' })).toHaveCount(0);
  await expect(drawer(page).getByRole('button', { name: 'Kapat' })).toBeVisible();
  await ctx.close();
});

test('installed app (standalone): never shown', async ({ page }) => {
  requirePass(test);
  await page.route('**/audio*.bin', (r) => r.abort());
  await page.addInitScript(() => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (q === '(display-mode: standalone)' ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q));
  });
  await unlock(page);
  expect(await fire(page)).toBe(false); // not even caught
  await expect(drawer(page)).toHaveCount(0);
});

test('manifest: name, icons, description and screenshots for the browser install dialog', async () => {
  const fs = require('node:fs'), path = require('node:path'), root = path.resolve(__dirname, '..', '..');
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  expect(m.name && m.short_name && m.start_url && m.display === 'standalone').toBeTruthy();
  expect(m.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(m.description).toBeTruthy();
  expect(m.screenshots.map((s) => s.form_factor).sort()).toEqual(['narrow', 'wide']);
  m.screenshots.forEach((s) => expect(fs.existsSync(path.join(root, s.src))).toBe(true));
});
