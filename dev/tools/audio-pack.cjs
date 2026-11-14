// Builds a new append-only voice pack in the app's format and registers it in index.html (audio-meta).
// Format (same as fetchPack in index.html): file = IV(12) + AES-GCM(seed key, plaintext);
// plaintext = uint32 BE header length + JSON header {voice, type, items:[{k, text, off, len}]} + clip bytes.
// k = "<line id>.<en|tr>", text = the line's exact en/tr text (the app looks clips up by "lang|text").
// Usage: TRAINER_PASS=... node dev/tools/audio-pack.cjs <manifest.json>
//   manifest: { "items": [{ "k": "id.en", "text": "...", "file": "/path/clip.mp3" }, ...] }  (keep it out of the repo)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto: crypto, createHash } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const META_RE = /<script id="audio-meta" type="application\/json">([\s\S]*?)<\/script>/;
const SEED_RE = /<script id="seed" type="application\/json">([\s\S]*?)<\/script>/;

async function seedKey(html, pass) {
  const seed = JSON.parse(html.match(SEED_RE)[1]);
  const norm = String(pass).toLowerCase().replace(/[^0-9a-z]/g, '');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(norm), 'PBKDF2', false, ['deriveBits']);
  const raw = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: Buffer.from(seed.s, 'base64'), iterations: seed.n, hash: 'SHA-256' }, base, 256);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

(async () => {
  const pass = process.env.TRAINER_PASS;
  if (!pass) throw new Error('TRAINER_PASS is not set');
  const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const file = path.join(ROOT, 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  const meta = JSON.parse(html.match(META_RE)[1]);
  const key = await seedKey(html, pass);

  const bufs = [], items = [];
  let off = 0;
  for (const it of manifest.items) {
    if (!/^[\w-]+\.(en|tr)$/.test(it.k) || !it.text) throw new Error('bad item ' + JSON.stringify(it.k));
    const b = fs.readFileSync(it.file);
    items.push({ k: it.k, text: it.text, off, len: b.length });
    bufs.push(b); off += b.length;
  }
  const hdr = Buffer.from(JSON.stringify({ voice: meta.voice, type: 'audio/mpeg', items }));
  const len = Buffer.alloc(4); len.writeUInt32BE(hdr.length, 0);
  const plain = Buffer.concat([len, hdr].concat(bufs));
  const h = createHash('sha256').update(plain).digest('hex').slice(0, 10);
  const name = 'audio-' + h + '.bin';
  if (meta.packs.some((p) => p.file === name)) throw new Error(name + ' is already registered');

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = Buffer.from(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  fs.writeFileSync(path.join(ROOT, name), Buffer.concat([Buffer.from(iv), ct]));

  // read it back the way the app does
  const back = fs.readFileSync(path.join(ROOT, name));
  const pt = Buffer.from(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: back.subarray(0, 12) }, key, back.subarray(12)));
  const hl = pt.readUInt32BE(0), hb = JSON.parse(pt.subarray(4, 4 + hl).toString());
  hb.items.forEach((it, i) => { if (!pt.subarray(4 + hl + it.off, 4 + hl + it.off + it.len).equals(bufs[i])) throw new Error('round trip failed at ' + it.k); });

  meta.packs.push({ file: name, v: 'p-' + h, n: items.length });
  meta.n = meta.packs.reduce((n, p) => n + p.n, 0);
  meta.v = 'a-' + createHash('sha256').update(meta.packs.map((p) => p.v).join(',')).digest('hex').slice(0, 10);
  fs.writeFileSync(file, html.replace(META_RE, () => '<script id="audio-meta" type="application/json">' + JSON.stringify(meta) + '</script>'));
  console.log(name, items.length, 'clips,', back.length, 'bytes; audio-meta', meta.v, 'packs', meta.packs.length, 'n', meta.n);
})().catch((e) => { console.error(e.message); process.exit(1); });
