'use strict';
// Pins the CURRENT spoken-check scoring (window.__dict.score = dictScore in index.html).
// When the scorer is redesigned, cases whose expectation changes on purpose move to the new spec
// with a note; any other change here is a regression.
const { test, expect } = require('@playwright/test');
const { PAGE, requirePass, seedOf, privateFixtures } = require('./helpers.cjs');

const CASES = [
  // name, reference, said, score, miss, extra
  ['exact', 'We run the regression suite every night.', 'We run the regression suite every night', 100, [], []],
  ['contraction', "I'm not planning to move abroad.", 'I am not planning to move abroad', 100, [], []],
  ['reordered', 'We run the regression suite every night.', 'Every night we run the regression suite', 71, ['every', 'night'], ['every', 'night']],
  ['before-after', 'We run the smoke tests before every release.', 'We run the smoke tests after every release', 88, ['before'], ['after']],
  ['number-words-vs-digits', 'The suite has three hundred tests.', 'The suite has 300 tests', 67, ['three', 'hundred'], ['300']],
  ['wrong-number', 'The fix took about four hours.', 'The fix took about fourteen hours', 83, ['four'], ['14']],
  ['dropped-not', 'The agent does not merge anything.', 'The agent does merge anything', 83, ['not'], []],
  ['typo-long-word', 'She built the automation framework herself.', 'She built the automaton framework herself', 100, [], []],
  ['missing-articles', 'We sent a long summary to the client.', 'We sent long summary to client', 75, ['a', 'the'], []],
  ['empty', 'We sent a long summary to the client.', '', 0, ['We', 'sent', 'a', 'long', 'summary', 'to', 'the', 'client'], []],
  ['fillers', 'We sent a long summary to the client.', 'um so we sent like a long summary to the client', 100, [], ['um', 'so', 'like']],
  ['split-compound', 'We use TypeScript for the tests.', 'We use type script for the tests', 100, [], []],
];

test.describe('current dictation scoring', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE);
    await page.waitForFunction(() => window.__dict && typeof window.__dict.score === 'function');
  });

  for (const [name, ref, said, score, miss, extra] of CASES) {
    test(name, async ({ page }) => {
      const d = await page.evaluate(([r, s]) => window.__dict.score(r, s), [ref, said]);
      expect(d.score).toBe(score);
      expect(d.miss).toEqual(miss);
      expect(d.extra).toEqual(extra);
    });
  }

  test('real lines from the screenshots (private fixtures)', async ({ page }) => {
    const fx = privateFixtures();
    test.skip(!fx, 'TRAINER_DATA/fixtures.json not available');
    requirePass(test);
    const { answers } = await seedOf();
    const lines = {};
    Object.values(answers).forEach((a) => (a.lines || []).forEach((l) => { lines[l.id] = l; }));
    for (const c of fx.dict) {
      const d = await page.evaluate(([r, s]) => window.__dict.score(r, s), [lines[c.id].en, c.said]);
      expect(d.score, c.id).toBe(c.score);
      expect(d.miss, c.id).toEqual(c.miss);
      expect(d.extra, c.id).toEqual(c.extra);
    }
  });
});
