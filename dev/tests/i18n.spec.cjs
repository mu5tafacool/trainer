'use strict';
// Every text on screen has one place: the i18n block of index.html (i18n:start … i18n:end, MSG.tr). These checks keep it so:
// no interface text elsewhere, every key a screen uses exists, none is left over, each call gives the placeholders its text
// needs, and tm() / dates / numbers / the interface language work. No browser and no passphrase needed.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, dumpStore, writeStore } = require('./helpers.cjs');

const HTML = fs.readFileSync(path.resolve(__dirname, '..', '..', process.env.TRAINER_PAGE || 'index.html'), 'utf8');
const cut = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b) + b.length);
const I18N = cut(HTML, '/* i18n:start */', '/* i18n:end */');
const ICONS = cut(HTML, '/* icons:start */', '/* icons:end */');
const VERIFY = cut(HTML, '/* verify3:start */', '/* verify3:end */');
// the code that must hold no interface text: every script except the i18n block, the spoken check (English rules) and data
const CODE = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n').replace(I18N, '').replace(VERIFY, '').replace(ICONS, '');

// runs the i18n block alone, with a browser's languages and a stored choice
function block(opts) {
  opts = opts || {};
  let code = I18N;
  if (opts.extra) code = code.replace('var MSG = { tr: {', 'var MSG = { ' + opts.extra + ', tr: {');
  const win = {}, store = opts.store || {};
  const doc = { documentElement: {}, querySelectorAll: () => [] };
  new Function('window', 'document', 'navigator', 'localStorage', code)(win, doc,
    { languages: opts.languages || ['tr-TR'], language: (opts.languages || ['tr-TR'])[0] }, { getItem: (k) => (k in store ? store[k] : null) });
  return { i18n: win.__i18n, lang: doc.documentElement.lang };
}
const { i18n } = block();
const MSG = i18n.msg.tr;
const LABEL_KEYS = [...ICONS.matchAll(/^\s+(\w+): \['\w+'/gm)].concat([...ICONS.matchAll(/[,{] (\w+): \['\w+'/g)]).map((m) => m[1]);

// string literals of the code, comments left out
function literals(code) {
  const out = []; const re = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g; let m;
  while ((m = re.exec(code))) if (m[0][0] === "'" || m[0][0] === '"') out.push(m[0].slice(1, -1));
  return out;
}
// language data that moves to the language table in v0.81 (voice names, English rules); not interface text
const DATA_VARS = ['NOVELTY', 'CONTR', 'DICT_LEX', 'SPEED_PAIRS', 'EN_PREF', 'TR_PREF', 'NUMW', 'NUMT'];
const SCAN = DATA_VARS.reduce((c, v) => c.replace(new RegExp('var ' + v + ' = [\\s\\S]*?;\\n'), '\n'), CODE);
// a phrase on screen: Turkish letters, or two words or more; markup pieces, selectors, keys and internal error notes are not
function looksLikeText(s) {
  const t = s.replace(/<[^>]*>/g, ' ').replace(/&\w+;/g, ' ').trim();
  if (/^[\w.-]+\.[\w-]+$/.test(t) && MSG[t] !== undefined) return false;
  if (/[çğıöşüÇĞİÖŞÜ]/.test(t)) return true;
  if (/<|="/.test(s)) return false; // a piece of markup
  if (!/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(t)) return false;
  if (/[.#][a-z]|^(use strict|base page|missing document)$|\b(failed|missing|unavailable)$|^(no clip|mixed clips|check dot C J S)$/.test(t)) return false;
  return true;
}
const DATA = new Set(['Google Türkçe', 'Microsoft Emel', 'Microsoft Ahmet', 'Siri (Spoken Content)', 'Mülakat Trainer', 'Google US English',
  "I'm a QA automation engineer.", 'Microsoft Aria', 'Microsoft Jenny', 'Microsoft Guy', 'Microsoft Ava', 'Microsoft Andrew', 'Microsoft Emma', 'English (US) → Siri Voice 2',
  "Translate this English job-interview sentence into natural, everyday Turkish. Keep software terms (Playwright, pull request, CI, Stripe, Pest, Jest and similar) in English. Reply with the Turkish sentence only, no quotes.\\n\\n"]);

test('no interface text outside the table', () => {
  const found = literals(SCAN).filter((s) => looksLikeText(s) && !DATA.has(s.replace(/<[^>]*>/g, '').trim()));
  expect(found, 'move these into MSG.tr and call tm()').toEqual([]);
  // static markup: the visible Turkish text sits on an element with data-t (filled from the table)
  const body = HTML.slice(HTML.indexOf('<body>'), HTML.indexOf('<script'));
  const bare = [...body.matchAll(/<(\w+)([^>]*)>([^<]*[a-zçğıöşüÇĞİÖŞÜ][^<]*)</g)].filter((m) => looksLikeText(m[3]) && !/data-(t|lab)=/.test(m[2]) && m[3].trim() !== 'Mülakat Trainer');
  expect(bare.map((m) => m[3].trim())).toEqual([]);
});

test('every key used exists, every key is used, and each call gives the placeholders its text needs', () => {
  const code = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n').replace(I18N, '');
  const markup = HTML.slice(HTML.indexOf('<body>'), HTML.indexOf('<script'));
  const used = new Set([...code.matchAll(/\btm\('([^']+)'/g)].map((m) => m[1]).filter((k) => !k.endsWith('.')) // tm('btn.' + key): LABEL below
    .concat([...markup.matchAll(/data-t="([^"]+)"/g)].map((m) => m[1]))
    .concat([...markup.matchAll(/data-t-attr="([^"]+)"/g)].flatMap((m) => m[1].split(';').map((p) => p.split(':')[1])))
    .concat(LABEL_KEYS.map((k) => 'btn.' + k)).concat(['fmt.date']));
  expect([...used].filter((k) => MSG[k] === undefined), 'used but not in MSG.tr').toEqual([]);
  expect(Object.keys(MSG).filter((k) => !used.has(k)), 'in MSG.tr but no screen uses it').toEqual([]);
  // tm('key', { a: …, b: … }): the top-level names of the object literal
  const tx = new Set(LABEL_KEYS);
  const bad = [];
  for (const m of code.matchAll(/\btm\('([^']+)'(, \{)?/g)) {
    const names = new Set();
    if (m[2]) {
      let i = m.index + m[0].length, depth = 1, name = '', atName = true;
      for (; i < code.length && depth; i++) {
        const c = code[i];
        if (c === '{' || c === '(' || c === '[') depth++;
        else if (c === '}' || c === ')' || c === ']') depth--;
        else if (c === "'") { i++; while (code[i] !== "'") { if (code[i] === '\\') i++; i++; } }
        if (depth === 1 && atName && /\w/.test(c)) name += c;
        else if (depth === 1 && c === ':' && atName) { names.add(name.trim()); name = ''; atName = false; }
        else if (depth === 1 && c === ',') { atName = true; name = ''; }
      }
    }
    const need = [...(MSG[m[1]] || '').matchAll(/\{(\w+)(?:, plural[^}]*\})?\}/g)].map((x) => x[1]);
    need.filter((n) => !names.has(n) && !tx.has(n)).forEach((n) => bad.push(m[1] + ' needs {' + n + '}')); // {pk}: a button for tx()
    [...names].filter((n) => !need.includes(n)).forEach((n) => bad.push(m[1] + ' gets {' + n + '} it never shows'));
  }
  expect(bad).toEqual([]);
});

test('tm: placeholders, plural forms, unknown names and keys', () => {
  const { i18n: x } = block({ extra: "en: { 'k.cards': '{n, plural, one {# card} other {# cards}}', 'k.zero': '{n, plural, =0 {none} other {# left}}' }", languages: ['en-US'] });
  expect(x.profile.ui).toBe('en');
  expect(x.t('k.cards', { n: 1 })).toBe('1 card');
  expect(x.t('k.cards', { n: 3 })).toBe('3 cards');
  expect(x.t('k.zero', { n: 0 })).toBe('none');
  expect(x.t('k.zero', { n: 4 })).toBe('4 left');
  expect(x.t('fmt.secs', { n: 7 })).toBe('7 sn'); // a key the English pack lacks falls back to Turkish
  expect(x.t('no.such.key')).toBe('no.such.key');
  expect(i18n.t('fmt.secs', {})).toBe('{n} sn'); // a name not given stays, so tx() can still read {pk}
  expect(i18n.t('fmt.secs', { n: '<b>{x}</b>' })).toBe('<b>{x}</b> sn'); // values are not read again
});

test('the interface language: own choice, then the browser, then Turkish; html lang follows', () => {
  const en = "en: { 'k': 'x' }";
  expect(block({ languages: ['de-DE', 'fr'] }).i18n.profile.ui).toBe('tr');
  expect(block({ extra: en, languages: ['de-DE', 'en-GB'] }).i18n.profile.ui).toBe('en');
  expect(block({ extra: en, languages: ['en-US'], store: { 'mt1:__ui': 'tr' } }).i18n.profile.ui).toBe('tr');
  expect(block({ extra: en, languages: ['tr'], store: { 'mt1:__ui': 'xx' } }).i18n.profile.ui).toBe('tr');
  expect(block({ extra: en, languages: ['en-US'] }).lang).toBe('en');
  expect(i18n.profile).toEqual({ ui: 'tr', src: 'tr', tgt: 'en' });
});

test('dates and numbers come from Intl in the interface language', () => {
  expect(i18n.date(new Date(2026, 10, 26))).toBe('Per 26 Kas');
  expect(i18n.date(new Date(2026, 0, 4))).toBe('Paz 4 Oca');
  expect(i18n.dec1(3.45)).toBe('3,5');
  expect(i18n.dec1(12)).toBe('12,0');
});

test('the code reads languages by role: no l.en / l.tr, no en / tr literal outside the language table', () => {
  const code = CODE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''); // every script except the i18n block, verify3 and icons; no comments
  const member = [...code.matchAll(/\.(en|tr)\b(?!\w)/g)].map((m) => code.slice(Math.max(0, m.index - 30), m.index + 4).replace(/\s+/g, ' '));
  expect(member.filter((x) => !/https?:|\.tr\(|['"][^'"]*\.(en|tr)\b/.test(x)), 'read l[TGT] / l[SRC]').toEqual([]);
  expect(literals(code).filter((x) => x === 'en' || x === 'tr'), "use TGT / SRC").toEqual([]);
  expect(/\b(rateEn|rateTr|enVoice|trVoice|trAuto|trFirst)\b/.test(code.replace(/var SETTING_ROLES = [^\n]*/, '')), 'settings by role').toBe(false);
});

test('settings saved under the old names (rateEn, trFirst …) are read by role after the update', async ({ page }) => {
  requirePass(test);
  await page.route('**/audio*.bin', (r) => r.abort());
  await unlock(page);
  const st = await dumpStore(page);
  await writeStore(page, { 'data/users/local/settings': { ...(st['data/users/local/settings'] || {}), rateEn: 0.7, rateTr: 1.2, trFirst: 'always', trAuto: false } });
  await page.reload();
  await page.locator('nav.tabs [data-tab="settings"]').click();
  await expect(page.locator('#rate-en')).toHaveValue('0.7');
  await expect(page.locator('#rate-tr')).toHaveValue('1.2');
  await expect(page.locator('#set-trauto')).not.toBeChecked();
  await page.locator('nav.tabs [data-tab="track"]').click();
  await page.locator('[data-act="trackMode"][data-m="A"]').click();
  await expect(page.locator('[data-act="trFirstSet"][data-t="always"]')).toHaveAttribute('aria-pressed', 'true');
  // a new name wins over an old one left in the same document
  await writeStore(page, { 'data/users/local/settings': { ...(st['data/users/local/settings'] || {}), rateEn: 0.7, rateTgt: 1.1 } });
  await page.reload();
  await page.locator('nav.tabs [data-tab="settings"]').click();
  await expect(page.locator('#rate-en')).toHaveValue('1.1');
});
