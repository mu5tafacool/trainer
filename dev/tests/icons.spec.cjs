'use strict';
// Icons and button words have one place in index.html (icons:start … icons:end: ICONS, LABEL). These checks keep it that way:
// every key a screen uses exists, nothing is left unused, no screen draws its own icon, and a button always has a name.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, stubSpeech, seedOf, makeDue } = require('./helpers.cjs');

const HTML = fs.readFileSync(path.resolve(__dirname, '..', '..', process.env.TRAINER_PAGE || 'index.html'), 'utf8');
const BLOCK = HTML.slice(HTML.indexOf('/* icons:start */'), HTML.indexOf('/* icons:end */'));
const I18N = HTML.slice(HTML.indexOf('/* i18n:start */'), HTML.indexOf('/* i18n:end */'));
const REST = HTML.replace(BLOCK, '').replace(I18N, '').replace(/<script id="(seed|audio-meta)"[\s\S]*?<\/script>/g, '');
// runs the block by itself: it needs nothing but a document and a window
function registry() {
  const win = {}, doc = { documentElement: {}, querySelectorAll: () => [] };
  new Function('window', 'document', 'navigator', 'localStorage', I18N)(win, doc, { languages: ['tr'] }, { getItem: () => null });
  const r = new Function('document', 'window', 'tm', BLOCK + '\nreturn { ICONS: ICONS, LABEL: LABEL, ico: ico, lab: lab, tx: tx };')(doc, {}, win.__i18n.t);
  r.word = (k) => win.__i18n.msg.tr['btn.' + k];
  return r;
}
const uses = (re) => [...REST.matchAll(re)].map((m) => m[1]);
const usesMsg = (re) => [...I18N.matchAll(re)].map((m) => m[1]); // help texts live in the i18n table

test('every icon and label a screen names exists, and none is left over', () => {
  const { ICONS, LABEL } = registry();
  const labels = new Set([
    ...uses(/\blab\('(\w+)'/g), ...uses(/data-lab="(\w+)"/g), ...uses(/\bkey: '(\w+)'/g), ...uses(/tchip\('[\w-]+', '(\w+)'/g), ...uses(/\{(\w+)\}/g).filter((k) => LABEL[k]), ...usesMsg(/\{(\w+)\}/g).filter((k) => LABEL[k]),
    // lab(cond ? 'a' : 'b') and sessHead(…, 'pause')
    ...[...REST.matchAll(/\blab\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)].flatMap((m) => [...m[1].matchAll(/\?\s*'(\w+)'\s*:\s*'(\w+)'/g)].flatMap((x) => [x[1], x[2]])),
    ...uses(/sessHead\([^\n]*?, '(pause|end)'\)/g), 'end',
  ]);
  expect([...labels].filter((k) => !LABEL[k]), 'label named on a screen but not in LABEL').toEqual([]);
  expect(Object.keys(LABEL).filter((k) => !labels.has(k)), 'label nobody uses').toEqual([]);
  const icons = new Set([...Object.values(LABEL).map((l) => l[0]), ...uses(/\bico\('(\w+)'/g), ...uses(/\bicon\('(\w+)'/g), ...uses(/\{:(\w+)\}/g),
    ...[...REST.matchAll(/\bico\([^()]*\?\s*'(\w+)'\s*:\s*'(\w+)'/g)].flatMap((x) => [x[1], x[2]])]);
  expect([...icons].filter((k) => !ICONS[k]), 'icon named but not drawn').toEqual([]);
  expect(Object.keys(ICONS).filter((k) => !icons.has(k)), 'drawing nobody uses').toEqual([]);
  expect(usesMsg(/\{:(\w+)\}/g).length, 'help texts show icons').toBeGreaterThan(5);
});

test('the registry is the only place that draws: no other svg, emoji or arrow used as an icon', () => {
  expect(REST.match(/<svg/g) || []).toEqual([]);
  expect(REST.match(/data:image\/svg/g) || []).toEqual([]);
  expect(REST.match(/[▶↺↻✗]/g) || []).toEqual([]);
  expect(REST.match(/[←→] *<\/button>|<button[^>]*>[←→🎤✓]/g) || []).toEqual([]);
});

test('lab, tx: arrows forward sit after the word, words can be replaced, unknown tokens stay as they are', () => {
  const { LABEL, lab, tx } = registry();
  Object.keys(LABEL).forEach((k) => {
    expect(registry().word(k), k + ': word in MSG.tr').toBeTruthy();
    expect(LABEL[k][1] === 'end', k + ': side').toBe(['skip', 'fwd'].includes(LABEL[k][0]));
    const h = lab(k); expect(h.startsWith('<svg'), k).toBe(LABEL[k][1] !== 'end'); expect(h).toContain('aria-hidden="true"');
  });
  expect(lab('round', '2. tur')).toContain('<span>2. tur</span>');
  expect(lab('skip')).toMatch(/^<span>Atla<\/span><svg/);
  expect(tx('a {pk} b')).toContain('Pekiştir'); expect(tx('a {:no} b')).toContain('data-ico="no"');
  expect(tx('a {nope} {:nope} b')).toBe('a {nope} {:nope} b');
});

test('one icon, one word: a word is not written under two keys, and did it / did not never share an icon', () => {
  const { LABEL, word } = registry(), seen = {};
  Object.keys(LABEL).forEach((k) => { (seen[word(k)] = seen[word(k)] || []).push(k); });
  // Bitir is two things on purpose: it stops the sound (stop) or leaves the screen (back)
  expect(Object.values(seen).filter((v) => v.length > 1)).toEqual([['trStop', 'end']]);
  ['stuck', 'notBuilt', 'wrong'].forEach((k) => expect(LABEL[k][0]).toBe('no'));
  ['said', 'fluent', 'built', 'right'].forEach((k) => expect(LABEL[k][0]).toBe('ok'));
  expect(LABEL.askAgain[0]).toBe('again');
});

test('on screen: every button has a name, the tab bar has its five icons, icons take the text colour', async ({ page }) => {
  requirePass(test);
  await page.route('**/audio*.bin', (r) => r.abort());
  await stubSpeech(page); await page.clock.install(); await unlock(page);
  const { answers } = await seedOf(), aid = Object.keys(answers)[0];
  await makeDue(page, answers, answers[aid].lines.slice(0, 3).map((l) => l.id));
  await page.reload();
  const check = async (where) => {
    const bad = await page.evaluate(() => [...document.querySelectorAll('#view button, nav.tabs button')].filter((b) => b.offsetParent).map((b) => {
      const name = (b.getAttribute('aria-label') || b.textContent).trim(), svg = [...b.querySelectorAll('svg')];
      if (!name) return (b.dataset.act || '?') + ': no name';
      if (/[▶↺↻✗🎤←→]/.test(b.textContent)) return (b.dataset.act || '?') + ': a character as icon';
      if (svg.some((x) => !x.classList.contains('ico') || x.getAttribute('aria-hidden') !== 'true' || !x.firstElementChild || x.getBoundingClientRect().width < 12)) return (b.dataset.act || '?') + ': icon not drawn';
      return svg.some((x) => getComputedStyle(x).stroke === 'none') ? 'no stroke' : '';
    }).filter(Boolean));
    expect(bad, where).toEqual([]);
  };
  expect(await page.locator('nav.tabs [data-ico]').evaluateAll((l) => l.map((x) => x.dataset.ico))).toEqual(['cal', 'bubble', 'phones', 'list', 'gear']);
  await check('Bugün');
  await page.locator('[data-act="startReview"]').click(); await check('Tekrar');
  await page.locator('[data-act="reveal"]').click(); await check('Tekrar, shown');
  await page.locator('[data-act="endSess"]').click();
  await page.locator('[data-act="startIntro"]').click(); await check('Yeni');
  await page.locator('[data-act="introSkip"]').click(); await check('Yeni, line end');
  for (const t of ['reh', 'track', 'lines', 'settings']) { await page.locator('nav.tabs [data-tab="' + t + '"]').click(); await check(t); if (t === 'lines') { await page.locator('[data-act="toggleAns"]').first().click(); await check('lines, open'); } }
  await expect(page.locator('#help')).not.toContainText('{'); // every {key} of the help texts was found
});
