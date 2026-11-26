'use strict';
// Pressed state: a control shows the touch at once (tint + slight shrink; tint only when motion is reduced). No passphrase:
// the gate's own button is enough for the real press, the style sheet for the rest.
const { test, expect } = require('@playwright/test');

const PRESS = ['.btn', '.chipbtn', '.seg button', '.mark', '.stage', '.arow', '.grps button', '.tchip', 'nav.tabs button', '.link', '.anshead'];

test('every kind of control has a pressed style, and iOS gets the touchstart it needs for it', async ({ page }) => {
  await page.goto(process.env.TRAINER_PAGE || 'index.html');
  const sels = await page.evaluate(() => [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch (e) { return []; } })
    .flatMap((r) => (r instanceof CSSMediaRule ? [...r.cssRules] : [r])).map((r) => r.selectorText || '').filter((t) => t.includes(':active')).join(' , '));
  PRESS.forEach((p) => expect(sels, p).toContain(p.split(' ')[0]));
  const html = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '..', '..', process.env.TRAINER_PAGE || 'index.html'), 'utf8');
  expect(html).toMatch(/addEventListener\('touchstart', function \(\) \{\}, \{ passive: true \}\)/);
});

test('a real press: the button shrinks and darkens while held, and comes back when let go; reduced motion keeps only the tint', async ({ page }) => {
  await page.goto(process.env.TRAINER_PAGE || 'index.html');
  const b = page.locator('#gate-form button[type=submit]');
  await expect(b).toBeVisible();
  const look = () => b.evaluate((e) => { const c = getComputedStyle(e); return { t: c.transform, f: c.filter }; });
  const box = await b.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  expect(await look()).toEqual({ t: 'none', f: 'none' });
  await page.mouse.down();
  await page.waitForTimeout(150);
  const held = await look();
  expect(held.t).toMatch(/^matrix\(0\.97/);
  expect(held.f).toContain('brightness');
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.move(box.x + 2, box.y + 2); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const calm = await look();
  await page.mouse.up();
  expect(calm.t).toBe('none');
  expect(calm.f).toContain('brightness');
});
