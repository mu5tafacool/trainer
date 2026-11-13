// Seed helpers shared by tests and build tools. Mirrors index.html (deriveRaw / decryptAnswers).
// The passphrase is never stored: callers pass it in (tests read it from TRAINER_PASS).
'use strict';
const fs = require('node:fs');
const { webcrypto: crypto } = require('node:crypto');

const SEED_RE = /<script id="seed" type="application\/json">([\s\S]*?)<\/script>/;
const b64d = (s) => Uint8Array.from(Buffer.from(s, 'base64'));
const b64e = (u) => Buffer.from(u).toString('base64');

function readSeedMeta(html) {
  const m = html.match(SEED_RE);
  if (!m) throw new Error('seed <script> not found');
  return JSON.parse(m[1]);
}

async function deriveKey(pass, meta, usages) {
  const norm = String(pass).toLowerCase().replace(/[^0-9a-z]/g, '');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(norm), 'PBKDF2', false, ['deriveBits']);
  const raw = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: b64d(meta.s), iterations: meta.n, hash: 'SHA-256' }, base, 256);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usages);
}

async function decryptSeed(html, pass) {
  const meta = readSeedMeta(html);
  const key = await deriveKey(pass, meta, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(meta.i) }, key, b64d(meta.c));
  return { meta, data: JSON.parse(new TextDecoder().decode(pt)) };
}

// Re-encrypts data with the same salt and iteration count (so the stored device key stays valid)
// and a fresh IV; returns index.html with the seed <script> replaced.
async function encryptSeed(html, pass, data, version) {
  const meta = readSeedMeta(html);
  const key = await deriveKey(pass, meta, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  const next = { v: version, n: meta.n, s: meta.s, i: b64e(iv), c: b64e(new Uint8Array(ct)) };
  return html.replace(SEED_RE, () => '<script id="seed" type="application/json">' + JSON.stringify(next) + '</script>');
}

const answersOf = (data) => (Array.isArray(data.answers) ? Object.fromEntries(data.answers.map((a) => [a._id, a])) : data.answers);

module.exports = { readSeedMeta, decryptSeed, encryptSeed, answersOf, readFile: (p) => fs.readFileSync(p, 'utf8') };
