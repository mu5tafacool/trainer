'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { expect } = require('@playwright/test');
const { decryptSeed, answersOf } = require('../lib/seed.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = process.env.TRAINER_PAGE || 'index.html';
const PASS = process.env.TRAINER_PASS;

function requirePass(test) { test.skip(!PASS, 'TRAINER_PASS is not set'); }

async function unlock(page) {
  await page.goto(PAGE);
  await expect(page.locator('#gate')).toBeVisible();
  await page.fill('#gate-pass', PASS);
  await page.locator('#gate-form button[type=submit]').click();
  await expect(page.locator('#gate')).toBeHidden({ timeout: 60000 });
}

// Everything the app keeps under mt1:, parsed.
function dumpStore(page) {
  return page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('mt1:')) { try { out[k.slice(4)] = JSON.parse(localStorage.getItem(k)); } catch (e) { out[k.slice(4)] = localStorage.getItem(k); } }
    }
    return out;
  });
}

function writeStore(page, entries) {
  return page.evaluate((e) => { Object.keys(e).forEach((k) => localStorage.setItem('mt1:' + k, JSON.stringify(e[k]))); }, entries);
}

async function seedOf(file) {
  const html = fs.readFileSync(path.join(ROOT, file || PAGE), 'utf8');
  const { meta, data } = await decryptSeed(html, PASS);
  return { meta, data, answers: answersOf(data) };
}

// Private real-sentence fixtures (never committed): TRAINER_DATA/fixtures.json
function privateFixtures() {
  const dir = process.env.TRAINER_DATA;
  const f = dir && path.join(dir, 'fixtures.json');
  return f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

// Serves Hugging Face model files from a local folder (TRAINER_MODELS/<org>/<name>/...) so model tests run offline.
// TRAINER_MODELS=online leaves the requests alone (the model downloads from Hugging Face).
const MODELS = process.env.TRAINER_MODELS;
const MODELS_ONLINE = MODELS === 'online';
async function routeModels(page) {
  if (MODELS_ONLINE) return;
  await page.route('https://huggingface.co/**', (route) => {
    const m = route.request().url().match(/^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/[^/]+\/(.+?)(\?.*)?$/);
    const f = m && MODELS && path.join(MODELS, m[1], m[2]);
    if (f && fs.existsSync(f)) return route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': 'application/octet-stream', 'content-length': String(fs.statSync(f).size) } });
    return route.fulfill({ status: 404, body: '' });
  });
}

// Makes the given lines due as TR→EN review cards on this device (progress written the way the app stores it).
async function makeDue(page, answers, lineIds) {
  const entries = {}, intro = {};
  lineIds.forEach((id) => {
    const aid = Object.keys(answers).find((a) => answers[a].lines.some((l) => l.id === id));
    intro[aid] = '2026-01-01';
    const k = 'data/users/local/srs_' + aid;
    entries[k] = entries[k] || { c: {} };
    entries[k].c[id] = { p: { ivl: 1, ease: 2.5, due: '2026-01-02', reps: 1, lapses: 0 } };
  });
  entries['data/users/local/progress'] = { intro, reh: {}, first: '2026-01-01' };
  await writeStore(page, entries);
}

module.exports = { ROOT, PAGE, PASS, MODELS, MODELS_ONLINE, requirePass, unlock, dumpStore, writeStore, seedOf, privateFixtures, routeModels, makeDue };
