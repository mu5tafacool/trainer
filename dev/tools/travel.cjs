// Builds the travel app (d26) from the interview app: travel.html = index.html with <meta name="mt-app" content="travel">,
// the open sentence set (dev/travel/set.json) as the seed, and its own title and manifest (travel.webmanifest).
// One code: change index.html, then run this; release.cjs runs it too. --check fails when travel.html is out of date.
// Usage: node dev/tools/travel.cjs [--check]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = read('index.html'), set = JSON.parse(read('dev/travel/set.json')), man = JSON.parse(read('manifest.webmanifest'));

function swap(s, a, b) { if (s.indexOf(a) < 0) throw new Error('travel.cjs: not found in index.html: ' + a.slice(0, 60)); return s.replace(a, () => b); }
const seed = JSON.stringify({ v: set.v, plain: { answers: set.answers } }).replace(/</g, '\\u003c');
let out = html;
out = swap(out, '<head>', '<head>\n<meta name="mt-app" content="travel">');
out = swap(out, '<title>Mülakat Trainer</title>', '<title>Seyahat Trainer</title>');
out = swap(out, '<link rel="manifest" href="manifest.webmanifest">', '<link rel="manifest" href="travel.webmanifest">');
out = swap(out, '<span class="brand">Mülakat Trainer</span>', '<span class="brand">Seyahat Trainer</span>');
out = swap(out, '"mediaMeta.mulakatTrainer": "Mülakat Trainer"', '"mediaMeta.mulakatTrainer": "Seyahat Trainer"'); // lock screen and headphones
out = swap(out, '"INST.mulakatTrainer": "Mülakat Trainer"', '"INST.mulakatTrainer": "Seyahat Trainer"'); // the install drawer
out = out.replace(/<script id="seed" type="application\/json">[\s\S]*?<\/script>/, () => '<script id="seed" type="application/json">' + seed + '</script>');
out = out.replace(/<script id="audio-meta" type="application\/json">[\s\S]*?<\/script>/, () => '<script id="audio-meta" type="application/json">{"v":"none","packs":[],"n":0}</script>'); // the device voice reads an open set
const tman = Object.assign({}, man, { id: './travel.html', name: 'Seyahat Trainer', short_name: 'Seyahat', start_url: './travel.html',
  description: 'Seyahat cümlelerini sesli ezberleme: İngilizce, İspanyolca, Fransızca. İnternetsiz çalışır.' });
const files = { 'travel.html': out, 'travel.webmanifest': JSON.stringify(tman, null, 1) + '\n' };

if (process.argv.includes('--check')) {
  const stale = Object.keys(files).filter((f) => !fs.existsSync(path.join(ROOT, f)) || read(f) !== files[f]);
  if (stale.length) { console.error('travel: out of date: ' + stale.join(', ') + ' (run node dev/tools/travel.cjs)'); process.exit(1); }
  console.log('travel up to date');
} else {
  Object.keys(files).forEach((f) => fs.writeFileSync(path.join(ROOT, f), files[f]));
  console.log('travel.html', set.v, Object.values(set.answers).reduce((n, a) => n + a.lines.length, 0), 'lines');
}
