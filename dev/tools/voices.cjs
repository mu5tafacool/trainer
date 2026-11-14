// Finds every text the answers use that has no shipped clip, voices it with the engine set for its language,
// and adds one new pack (dev/tools/audio-pack.cjs). Nothing to do → exits without changes.
//
//   TRAINER_PASS=... KOKORO_DIR=<folder with kokoro-v1.0.onnx + voices-v1.0.bin> node dev/tools/voices.cjs [--dry] [--langs=en,tr]
//
// Languages: one row each in LANGS. A language whose engine is not available here (e.g. `say` off macOS, in a cloud
// session) is skipped and reported; run the script again on the Mac later and only those clips are added.
// Clip keys: "<line id>.<lang>" for lines, "q-<answer id>.<lang>" for questions; the app looks clips up by "lang|text".
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { webcrypto: crypto } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const { decryptSeed, answersOf } = require(path.join(ROOT, 'dev', 'lib', 'seed.cjs'));

// Where each language's text lives and how it is voiced: only what the app plays (English questions are played,
// Turkish questions are not). A future language = one more row (and the app storing and playing that field).
const LANGS = {
  en: { question: 'q', line: 'en', engine: 'kokoro', voice: 'am_fenrir' }, // Kokoro-82M (Apache-2.0)
  tr: { question: null, line: 'tr', engine: 'say' }, // macOS system voice; set it to Turkish Siri Voice 2 first
};

const has = (cmd) => spawnSync('which', [cmd]).status === 0;
const ENGINES = {
  kokoro: () => !!process.env.KOKORO_DIR && fs.existsSync(path.join(process.env.KOKORO_DIR, 'kokoro-v1.0.onnx')) && (has('uv') || fs.existsSync('/opt/homebrew/bin/uv')),
  say: () => process.platform === 'darwin' && has('say') && has('afconvert'),
};

function packTexts(html, key) {
  const meta = JSON.parse(html.match(/<script id="audio-meta" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const have = new Set();
  return Promise.all(meta.packs.map(async (p) => {
    const buf = fs.readFileSync(path.join(ROOT, p.file));
    const pt = Buffer.from(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.subarray(0, 12) }, key, buf.subarray(12)));
    const hl = pt.readUInt32BE(0);
    JSON.parse(pt.subarray(4, 4 + hl).toString()).items.forEach((it) => have.add(it.k.split('.').pop() + '|' + it.text));
  })).then(() => have);
}

async function seedKey(html, pass) {
  const seed = JSON.parse(html.match(/<script id="seed" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const norm = String(pass).toLowerCase().replace(/[^0-9a-z]/g, '');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(norm), 'PBKDF2', false, ['deriveBits']);
  const raw = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: Buffer.from(seed.s, 'base64'), iterations: seed.n, hash: 'SHA-256' }, base, 256);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
}

// The app's own pronunciation tweaks for English (sayEn in index.html); the clip key stays the original text.
function sayEnFrom(html) {
  const m = html.match(/function sayEn\(t\) \{([\s\S]*?)\n  \}/);
  return m ? new Function('t', m[1]) : (t) => t;
}

const trim = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse';
function toMp3(src, out) { execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-af', trim, '-ar', '24000', '-ac', '1', '-b:a', '48k', out]); }

function voiceKokoro(jobs, dir, lang, sayEn) {
  const list = path.join(dir, 'kokoro.json');
  fs.writeFileSync(list, JSON.stringify(jobs.map((j) => ({ text: sayEn(j.text), wav: path.join(dir, j.k + '.wav') }))));
  const py = [
    'import json, sys, soundfile as sf', 'from kokoro_onnx import Kokoro',
    'jobs = json.load(open(sys.argv[1])); d = sys.argv[2]',
    "k = Kokoro(d + '/kokoro-v1.0.onnx', d + '/voices-v1.0.bin')",
    "for j in jobs:\n    s, sr = k.create(j['text'], voice=sys.argv[3], speed=1.0, lang='en-us')\n    sf.write(j['wav'], s, sr)",
  ].join('\n');
  const uv = has('uv') ? 'uv' : '/opt/homebrew/bin/uv';
  execFileSync(uv, ['run', '--quiet', '--python', '3.12', '--with', 'kokoro-onnx', '--with', 'soundfile', 'python', '-c', py, list, process.env.KOKORO_DIR, LANGS[lang].voice], { stdio: ['ignore', 'inherit', 'inherit'] });
  jobs.forEach((j) => { toMp3(path.join(dir, j.k + '.wav'), path.join(dir, j.k + '.mp3')); });
}

function voiceSay(jobs, dir) {
  jobs.forEach((j) => {
    const aiff = path.join(dir, j.k + '.aiff');
    for (let n = 0; n < 3; n++) {
      spawnSync('say', ['-o', aiff, j.text], { timeout: 60000 });
      if (fs.existsSync(aiff) && fs.statSync(aiff).size > 0) break;
    }
    if (!fs.existsSync(aiff)) throw new Error('say failed for ' + j.k);
    execFileSync('afconvert', ['-f', 'mp4f', '-d', 'aac', aiff, path.join(dir, j.k + '.mp4')]);
    toMp3(path.join(dir, j.k + '.mp4'), path.join(dir, j.k + '.mp3'));
  });
}

(async () => {
  const pass = process.env.TRAINER_PASS;
  if (!pass) throw new Error('TRAINER_PASS is not set');
  const dry = process.argv.includes('--dry');
  const only = (process.argv.find((a) => a.startsWith('--langs=')) || '').slice(8).split(',').filter(Boolean);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const { data } = await decryptSeed(html, pass);
  const have = await packTexts(html, await seedKey(html, pass));

  // every text in use, once, with a stable key
  const want = {};
  Object.entries(answersOf(data)).forEach(([aid, a]) => Object.keys(LANGS).forEach((lang) => {
    const L = LANGS[lang], add = (k, text) => { if (text && !have.has(lang + '|' + text) && !want[lang + '|' + text]) want[lang + '|' + text] = { k, lang, text }; };
    if (L.question) add('q-' + aid + '.' + lang, a[L.question]);
    (a.lines || []).forEach((l) => add(l.id + '.' + lang, l[L.line]));
  }));
  const jobs = Object.values(want).filter((j) => !only.length || only.includes(j.lang));
  const byLang = {};
  jobs.forEach((j) => { (byLang[j.lang] = byLang[j.lang] || []).push(j); });
  Object.keys(LANGS).forEach((lang) => console.log(lang + ':', (byLang[lang] || []).length, 'missing', ENGINES[LANGS[lang].engine]() ? '' : '(engine not available here: ' + LANGS[lang].engine + ')'));
  if (dry || !jobs.length) return;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voices-'));
  const done = [], waiting = [];
  try {
    for (const [lang, list] of Object.entries(byLang)) {
      const eng = LANGS[lang].engine;
      if (!ENGINES[eng]()) { waiting.push(lang); continue; }
      if (eng === 'kokoro') voiceKokoro(list, dir, lang, sayEnFrom(html)); else voiceSay(list, dir);
      list.forEach((j) => done.push({ k: j.k, text: j.text, file: path.join(dir, j.k + '.mp3') }));
    }
    if (done.length) {
      const manifest = path.join(dir, 'manifest.json');
      fs.writeFileSync(manifest, JSON.stringify({ items: done }));
      execFileSync('node', [path.join(__dirname, 'audio-pack.cjs'), manifest], { stdio: 'inherit', env: process.env });
    }
    if (waiting.length) console.log('Waiting for a machine with the engine:', waiting.join(', '), '— run this again there.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
