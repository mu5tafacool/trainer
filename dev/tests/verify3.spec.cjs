'use strict';
// Rule layer of the v3 checker (no models): normalization and objective contradiction checks. Synthetic text only.
const { test, expect } = require('@playwright/test');
const v3 = require('../lib/verify3.js');

const LEX = { SaaS: ['sass', 'sauce'], TypeScript: ['type script'], PR: ['p r', 'pull request'] };
const norm = (ref, said) => v3.normalizeSaid(said, v3.prepareRef(ref, LEX)).join(' ');
const issues = (ref, said) => v3.hardChecks(v3.prepareRef(ref, LEX), v3.normalizeSaid(said, v3.prepareRef(ref, LEX))).filter((x) => x.hard).map((x) => x.kind);

test.describe('normalization', () => {
  const cases = [
    ['numbers: words to digits', 'x', 'three and a half years, fifteen hundred tests, twenty five days', '3.5 years 1500 tests 25 days'],
    ['numbers: digits, commas, k, percent', 'x', '1,500 tests, 1.5k runs, 10% off', '1500 tests 1500 runs 10 percent off'],
    ['numbers: point', 'x', 'three point five', '3.5'],
    ['"one" stays a word alone', 'x', 'the one person', 'the one person'],
    ['contractions with and without apostrophe', 'x', "I'm sure it didn't, dont worry", 'i am sure it did not do not worry'],
    ['hyphens and slashes', 'x', 'end-to-end go/no-go', 'end to end go no go'],
    ['dictation variant only when the term is in the reference', 'We sell a SaaS product.', 'we sell a sauce product', 'we sell a saas product'],
    ['no variant when the term is not in the reference', 'We sell a sauce.', 'we sell a sauce', 'we sell a sauce'],
    ['split compound joined when the reference has it', 'We use TypeScript.', 'we use type script', 'we use typescript'],
    ['fillers removed unless the reference uses them', 'I wrote the report.', 'um so I like wrote the report', 'i wrote the report'],
    ['self-correction keeps the corrected value', 'It was fourteen percent.', 'it was forty sorry fourteen percent', 'it was 14 percent'],
    ['stutter collapsed', 'I worked there.', 'I I worked there', 'i worked there'],
  ];
  for (const [name, ref, said, want] of cases) test(name, () => { expect(norm(ref, said)).toBe(want); });
});

test.describe('objective contradictions', () => {
  const cases = [
    ['different number', 'The fix took four hours.', 'the fix took fourteen hours', ['number']],
    ['same number as digits is fine', 'It has three hundred tests.', 'it has 300 tests', []],
    ['dropped negation', 'The agent does not merge anything.', 'the agent does merge anything', ['negation']],
    ['negation moved but kept is not flagged here', "The robot doesn't move anything.", 'the robot moves nothing', []],
    ['antonym swap', 'We run it before every release.', 'we run it after every release', ['antonym']],
    ['from/to reversed', 'The bus ride went from nine hours to seven.', 'the bus ride went from seven hours to nine', ['order']],
    ['instead of reversed', 'Members pay 120 instead of 95.', 'members pay 95 instead of 120', ['order']],
    ['expected/got reversed', 'The check failed: expected 42, got 51.', 'the check failed expected 51 got 42', ['order']],
    ['correct paraphrase has no hard issue', 'The bus ride went from nine hours to under seven.', 'the trip went from 9 hours to under 7', []],
  ];
  for (const [name, ref, said, want] of cases) test(name, () => { expect(issues(ref, said)).toEqual(want); });
});

test('index.html carries the same verify3 as dev/lib/verify3.js', () => {
  const fs = require('node:fs'), path = require('node:path');
  const root = path.resolve(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const block = html.match(/\/\* verify3:start \*\/\n([\s\S]*?)\n\/\* verify3:end \*\//);
  expect(block, 'markers in index.html').toBeTruthy();
  expect(block[1], 'run: node dev/tools/sync-verify3.cjs').toBe(fs.readFileSync(path.join(root, 'dev', 'lib', 'verify3.js'), 'utf8').trim());
});

test.describe('grades without models', () => {
  const g = (tier, ref, said) => v3.check({ en: ref, tier }, said, LEX, null).grade;
  test('ezber: exact and dictation-only are İyi', () => {
    expect(g('ezber', 'I sell a SaaS product.', 'i sell a saas product')).toBe(2);
    expect(g('ezber', 'I sell a SaaS product.', 'I sell a sauce product')).toBe(2);
  });
  test('ezber: a hard contradiction is Tekrar even with few word errors', () => {
    expect(g('ezber', "I'm not going to the party tonight.", "I'm going to the party tonight")).toBe(0);
  });
  test('meaning cards list words order-free: a reordered word is neither missing nor extra', () => {
    const r = v3.check({ en: 'We keep the old recipe in a folder that the whole kitchen can open.', tier: 'anlam' }, 'the whole kitchen can open the folder with the old recipe', LEX, null);
    expect(r.bag).toEqual({ miss: ['keep'], extra: [] });
    const s = v3.check({ en: 'We keep the old recipe in a folder that the whole kitchen can open.', tier: 'anlam' }, 'we keep the old receipt in a folder the kitchen can open', LEX, null);
    expect(s.bag).toEqual({ miss: ['recipe', 'whole'], extra: ['receipt'] });
  });
  test('empty answer is Tekrar', () => { expect(g('anlam', 'We ship weekly.', '')).toBe(0); });
});
