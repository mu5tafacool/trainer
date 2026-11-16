// Marks a new release: bumps the cache version in sw.js (mt-vN → mt-vN+1), sets the same APP_VER in index.html and
// stamps APP_BUILT with the current UTC time. Settings shows it at the bottom ("Sürüm v44 · 2026-11-16 18:50 UTC").
// Usage: node dev/tools/release.cjs
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const swFile = path.join(ROOT, 'sw.js'), htmlFile = path.join(ROOT, 'index.html');
const sw = fs.readFileSync(swFile, 'utf8'), html = fs.readFileSync(htmlFile, 'utf8');
const m = sw.match(/const V = 'mt-v(\d+)';/);
if (!m) throw new Error('sw.js: no V');
const next = 'mt-v' + (Number(m[1]) + 1);
const d = new Date(), p = (n) => String(n).padStart(2, '0');
const built = d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
if (!/var APP_VER = '[^']+';/.test(html) || !/var APP_BUILT = '[^']+';/.test(html)) throw new Error('index.html: APP_VER / APP_BUILT not found');
fs.writeFileSync(swFile, sw.replace(m[0], "const V = '" + next + "';"));
fs.writeFileSync(htmlFile, html.replace(/var APP_VER = '[^']+';/, "var APP_VER = '" + next + "';").replace(/var APP_BUILT = '[^']+';/, "var APP_BUILT = '" + built + "';"));
console.log(next, built, 'UTC');
