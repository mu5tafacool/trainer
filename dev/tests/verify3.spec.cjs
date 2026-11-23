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
    ['fractions', 'x', '3 1/2 years, 2½ weeks, 1/2 day', '3.5 years 2.5 weeks 0.5 day'],
    ['fraction with "and"', 'x', '3 and 1/2 years', '3.5 years'],
    ['a number glued to /2 is not a fraction', 'x', 'on 11/2 we met', 'on 11 2 we met'],
    ['other slashes are left alone', 'x', 'support 24/7', 'support 24 7'],
    ['"and" inside a number', 'x', 'we baked seven hundred and twenty, sold one hundred and forty-five', 'we baked 720 sold 145'],
    ['"and" between two numbers stays', 'x', 'six hundred and four hundred and forty', '600 and 440'],
    ['years said in pairs', 'x', 'twenty thirty-one, nineteen ninety-nine, twenty oh five', '2031 1999 2005'],
    ['two small numbers are not a year', 'x', 'two or three, twenty', '2 or 3 20'],
    ['ordinals and plus', 'x', '1st and 2nd, a promo + a fee', 'first and second a promo plus a fee'],
    ['number look-alike next to a stutter', 'I talked to 2 people.', 'I talked to to people', 'i talked to 2 people'],
    ['number look-alike becomes the number the reference needs', 'We ran four checks for the team.', 'we ran for checks for the team', 'we ran 4 checks for the team'],
    ['look-alike stays a word when no number is needed', 'We did it for the team.', 'we did it for the team', 'we did it for the team'],
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

test.describe('meaning stems', () => {
  const MUST = ['used/use', 'using/use', 'shipping/ship', 'verified/verify', 'stories/story', 'parcels/parcel', 'notes/note', 'codes/code', 'lines/line', 'boxes/box', 'goes/go', 'agreed/agree', 'kept/keep', 'built/build', 'taught/teach'];
  const NEVER = ['notes/not', 'seed/see', 'seed/saw', 'need/ne', 'codes/cod', 'lines/lin', 'bus/bu', 'not/note', 'never/ever', 'no/not'];
  for (const p of MUST) test('match ' + p, () => { expect(v3.stemEq(...p.split('/'))).toBe(true); });
  for (const p of NEVER) test('no match ' + p, () => { expect(v3.stemEq(...p.split('/'))).toBe(false); });
  test('a negation does not hide a missing term', () => {
    const r = v3.check({ en: 'I added notes to the ticket.', tier: 'anlam' }, 'I did not add the ticket', LEX, null);
    expect(r.bag.miss).toContain('notes');
    expect(r.cov).toBeLessThan(1);
    expect(r.grade).toBe(0);
  });
});

test.describe('proper names (found from the texts, none in code)', () => {
  const texts = ['We moved to Zoltrix Corp last year.', 'The app Bx40 runs on Kelvaro.', 'First we tested it.'];
  const names = v3.findNames(texts);
  const R = v3.prepareRef('Zoltrix Corp builds games, and their best seller, Bx40, is a platform for chess clubs.', {}, names);
  const fix = (said) => v3.normalizeSaid(said, R).join(' ');
  test('names: capitalized mid-sentence or letter+digit; sentence-initial words are not names', () => {
    expect(names).toEqual({ zoltrix: 1, corp: 1, bx40: 1, kelvaro: 1 });
  });
  test('a name spelled by sound becomes the name (one word or two)', () => {
    expect(fix('zoltrex corp builds games')).toBe('zoltrix corp builds games');
    expect(fix('solar tricks corp builds games')).toBe('zoltrix corp builds games');
  });
  test('the number of a product code is not quizzed as a number', () => {
    expect(fix('their best seller bx 50 is a platform')).toBe('their best seller bx 40 is a platform');
    expect(v3.hardChecks(R, v3.normalizeSaid('their best seller bx 50 is a platform', R)).filter((x) => x.hard)).toEqual([]);
  });
  test('ordinary words are left alone', () => {
    expect(fix('a platform for chess clubs')).toBe('a platform for chess clubs');
  });
  test('month and day names are not names, so a misspelled name is not turned into one', () => {
    const n2 = v3.findNames(['In March 2024, I joined Quorvex Labs on a Monday.']);
    expect(n2).toEqual({ quorvex: 1, labs: 1 });
    const R2 = v3.prepareRef('In March 2024, I joined Quorvex Labs on a Monday.', {}, n2);
    expect(v3.normalizeSaid('in march 2024 i joined qourvex labs', R2).join(' ')).toBe('in march 2024 i joined quorvex labs');
  });
  test('the closest name wins, not the first one close enough', () => {
    const R3 = v3.prepareRef('We joined Delmark after Delmar.', {}, { delmar: 1, delmark: 1 });
    expect(v3.normalizeSaid('we joined delmarc', R3).join(' ')).toBe('we joined delmark');
  });
});

test('a negation said another way is not a missing term ("nothing" ~ "did not", "never" ~ "not")', () => {
  const r = v3.check({ en: 'The robot ships nothing until the cook agrees.', tier: 'anlam' }, 'the robot did not ship until the cook agrees', LEX, null);
  expect(r.bag.miss).toEqual([]);
  expect(r.cov).toBe(1);
  const s = v3.check({ en: 'The robot ships nothing until the cook agrees.', tier: 'anlam' }, 'the robot ships everything until the cook agrees', LEX, null);
  expect(s.bag.miss).toContain('nothing');
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
  test('meaning cards ignore word endings: plural, -ed, -ing, irregular verbs', () => {
    const r = v3.check({ en: 'The robots kept shipping parcels and verified labels.', tier: 'anlam' }, 'the robot keep ship parcel and verify label', LEX, null);
    expect(r.bag).toEqual({ miss: [], extra: [] });
    expect(r.cov).toBe(1);
  });
  test('meaning: the model alone cannot give İyi when fewer than half the terms are there', () => {
    const yes = { fwd: { ent: 0.99, neu: 0.01, con: 0 }, back: { ent: 0.99, neu: 0.01, con: 0 } };
    expect(v3.check({ en: 'Our gardener waters the tomatoes early and trims the hedges weekly.', tier: 'anlam' }, 'gardener waters early', LEX, { nli: yes }).grade).toBe(1);
    expect(v3.check({ en: 'Our gardener waters the tomatoes early and trims the hedges weekly.', tier: 'anlam' }, 'the gardener waters tomatoes early and trims hedges every week', LEX, { nli: yes }).grade).toBe(2);
  });
  test('pattern chunks: ezber needs every word of them for İyi; anlam only lists the missing ones', () => {
    const ez = { en: 'Second, check the boat early, especially where wind and rain are strong.', tier: 'ezber', mk: ['Second, check', 'especially where'] };
    const r = v3.check(ez, 'second check the boat early especially wind and rain are strong', LEX, null);
    expect(r.mkMiss).toEqual(['where']);
    expect(r.acc).toBeGreaterThan(0.94);
    expect(r.grade).toBe(1);
    expect(v3.check(ez, 'second check the boat early especially where wind and rain are strong', LEX, null).grade).toBe(2);
    const an = { en: 'That is the craft behind a map that both a sailor and a farmer can read.', tier: 'anlam', mk: ['That is the craft behind'] };
    const s = v3.check(an, 'it is behind a map that both a sailor and a farmer can read', LEX, null);
    expect(s.mkMiss).toEqual(['craft']);
    expect(s.grade).toBe(2);
  });
  test('meaning: model unsure both ways, no contradiction, some terms said → Zor; few terms or a contradiction → Tekrar', () => {
    const unsure = (con) => ({ fwd: { ent: 0.5, neu: 0.5 - con, con }, back: { ent: 0.05, neu: 0.9, con: 0.05 } });
    const line = { en: 'Our gardener waters the tomatoes early and trims the hedges every week.', tier: 'anlam' };
    expect(v3.check(line, 'the gardener waters tomatoes and cuts grass', LEX, { nli: unsure(0.4) }).grade).toBe(1);
    expect(v3.check(line, 'the gardener sleeps', LEX, { nli: unsure(0.4) }).grade).toBe(0);
    expect(v3.check(line, 'the gardener waters tomatoes and cuts grass', LEX, { nli: unsure(0.6) }).grade).toBe(0);
  });
  test('ezber: one dropped a / an / the outside the pattern chunks is İyi; inside a chunk, or with anything else wrong, it is not', () => {
    const line = { en: 'I keep the map, the compass and the rope.', tier: 'ezber', mk: ['I keep the map'] };
    const r = (said, l) => v3.check(l || line, said, LEX, null);
    expect(r('I keep the map, the compass and the rope').grade).toBe(2);
    const out = r('I keep the map, compass and the rope');
    expect(out.acc).toBeLessThan(0.94);
    expect(out.grade).toBe(2);
    expect(out.why).toContain('article');
    expect(r('I keep map, the compass and the rope').grade).toBe(1); // inside "I keep the map"
    expect(r('I keep the map, compass and rope').grade).toBe(1); // two articles
    expect(r('I keep the map, a compass and the rope').grade).toBe(1); // swapped, not dropped
    expect(r('I keep the map, compass and the rope', { ...line, tier: 'anlam' }).why).not.toContain('article');
    // works from the line's own text and chunks, so an edited line or a new one follows the same rule
    const edited = { en: 'I keep the map, the compass and the rope.', tier: 'ezber', mk: ['the compass and'] };
    expect(r('I keep the map, compass and the rope', edited).grade).toBe(1);
    expect(r('I keep map, the compass and the rope', edited).grade).toBe(2);
    // a chunk that no longer fits the text (its words said, but not found in the line) forgives nothing
    expect(r('I keep the map, compass and the rope', { ...line, mk: ['rope and'] }).grade).toBe(1);
    // the slip must be small: on a short line one article is too large a share of the words (under 90%)
    expect(r('Open box now', { en: 'Open the box now.', tier: 'ezber', mk: ['box now'] }).grade).toBe(1);
    // two dropped articles stay Zor even on a long line where the words are still 90%+ right
    const long = { en: 'I keep the map, the compass, the rope and the lamp in the red bag by the door.', tier: 'ezber', mk: ['I keep'] };
    const two = r('I keep map, the compass, rope and the lamp in the red bag by the door', long);
    expect(two.acc).toBeGreaterThanOrEqual(0.9);
    expect(two.grade).toBe(1);
    // only a / an / the: a dropped content word stays Zor at the same share
    const red = r('I keep the map, the compass, the rope and the lamp in the bag by the door', long);
    expect(red.acc).toBeGreaterThanOrEqual(0.9);
    expect(red.grade).toBe(1);
  });
  test('the model reads numbers and symbols in one form, the rest as written', () => {
    expect(v3.forModel('Baked seven hundred and twenty, sold six hundred.')).toBe('Baked 720, sold 600.');
    expect(v3.forModel('a coupon + a 5% tax')).toBe(v3.forModel('a coupon plus a five-percent tax'));
    expect(v3.forModel('From June twenty thirty-one, 2,400 jars at 300×250')).toBe('From June 2031, 2400 jars at 300 by 250');
    expect(v3.forModel('The one person ran a one-year course: I own it.')).toBe('The one person ran a one-year course: I own it.');
  });
  test('"one" said for the digit 1 matches; "one" as a word stays', () => {
    const R = v3.prepareRef('Set quantity 1 for the one item.', LEX);
    expect(v3.normalizeSaid('set quantity one for the one item', R).join(' ')).toBe('set quantity 1 for the one item');
  });
  test('meaning: the same words after normalization are İyi even if the model calls them a contradiction', () => {
    const line = { en: 'The bakery sold 740, not 650.', tier: 'anlam' };
    const con = { fwd: { ent: 0.01, neu: 0.04, con: 0.95 }, back: { ent: 0.01, neu: 0.04, con: 0.95 } };
    expect(v3.check(line, 'the bakery sold seven hundred and forty, not six hundred and fifty', LEX, { nli: con }).grade).toBe(2);
    expect(v3.check(line, 'the bakery sold 740, not 650 at all', LEX, { nli: con }).grade).toBe(0);
  });
  test('meaning: a heap of the right words, almost none in order, is not İyi', () => {
    const yes = { fwd: { ent: 0.99, neu: 0.01, con: 0 }, back: { ent: 0.99, neu: 0.01, con: 0 } };
    const line = { en: 'After the kitchen moved to gas, I wrote a cookbook with more than 300 recipes.', tier: 'anlam' };
    const heap = v3.check(line, 'cookbook recipes 300 gas kitchen wrote moved', LEX, { nli: yes });
    expect(heap.cov).toBeGreaterThan(0.7);
    expect(heap.acc).toBeLessThan(0.2);
    expect(heap.grade).toBe(1);
    expect(v3.check(line, 'I wrote a cookbook with over 300 recipes after the kitchen moved to gas', LEX, { nli: yes }).grade).toBe(2);
  });
  test('empty answer is Tekrar', () => { expect(g('anlam', 'We ship weekly.', '')).toBe(0); });
});
