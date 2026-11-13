'use strict';
// Copies dev/lib/verify3.js into index.html between the verify3 markers. Run after changing verify3.js.
// Usage: node dev/tools/sync-verify3.cjs [--check]   (--check exits 1 if index.html is out of date)
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const htmlPath = path.join(root, 'index.html'), src = fs.readFileSync(path.join(root, 'dev', 'lib', 'verify3.js'), 'utf8').trim();
const html = fs.readFileSync(htmlPath, 'utf8');
const re = /(\/\* verify3:start \*\/\n)[\s\S]*?(\/\* verify3:end \*\/)/;
if (!re.test(html)) { console.error('verify3 markers not found in index.html'); process.exit(1); }
const next = html.replace(re, (m, a, b) => a + src + '\n' + b);
if (process.argv.includes('--check')) { if (next !== html) { console.error('index.html verify3 block is out of date'); process.exit(1); } console.log('verify3 block up to date'); process.exit(0); }
fs.writeFileSync(htmlPath, next);
console.log(next === html ? 'unchanged' : 'index.html updated');
