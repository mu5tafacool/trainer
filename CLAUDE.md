# Trainer — notes for Claude

Offline PWA for practising spoken answers. Everything ships from branch `gh-pages` (GitHub Pages); `main` only has an old README.

## Files
- `index.html` is the whole app (two scripts: platform layer, then UI). The answer set is an encrypted `<script id="seed">` (AES-GCM, PBKDF2-SHA256 200k; passphrase normalized to lowercase a–z0–9).
- `sw.js` service worker; bump `V` (`mt-vNN`) on every release.
- `nli/` Transformers.js + ONNX Runtime wasm for the optional meaning check (byte-identical npm files, see README).
- `audio*.bin` encrypted voice packs, append-only; clips are looked up by `lang|text`. After any seed text change run `TRAINER_PASS=… KOKORO_DIR=… node dev/tools/voices.cjs` (`--dry` to only list): it voices every played text without a clip (EN Kokoro `am_fenrir`; TR `say` with the Mac's system voice set to Turkish Siri Voice 2) and adds one pack via `dev/tools/audio-pack.cjs`. Off macOS (cloud) only EN is made; run it on the Mac later for TR. Languages are rows in `LANGS` there. `audio.spec` checks every played text has a clip; the phone drops clips no line uses (`__pruneAudio`).
- `dev/` tools and Playwright tests. `dev/lib/verify3.js` is the spoken check; `index.html` carries a copy between `verify3:start` and `verify3:end` — after editing run `node dev/tools/sync-verify3.cjs`.

## Rules
- The repo is public. No plaintext answer sentences and no company or product names in any committed file. Real sentences, fixtures and the leak-scan name list live only in the private repo `mu5tafacool/trainer-data`.
- The passphrase is never written to a file, env file, commit or setting. Ask the user for it in chat when a step needs it.
- If seed data changes, bump the seed version and add `hist['v<prev>']` (all line ids of the previous version). User progress and edits survive through the merge (`mergeAnswer` / `withMk` / `applySeed`); extend it, don't build a second one.
- Run the tests before and after every change.
- Commit as `git -c user.name="mu5tafacool" -c user.email="mu5tafacool@users.noreply.github.com" commit ...` with **no Co-Authored-By or Claude-Session lines**. Push to `gh-pages`.
- After a push, check the Pages build (`gh api repos/mu5tafacool/trainer/actions/runs`, or the public REST API). On a 500, push one empty commit to retrigger, once.
- Read big files in parts (`grep -n`, line ranges); `index.html` is large.

## Tests
```
cd dev && npm i --no-save @playwright/test@1.63 && npx playwright install chromium && cd ..
TRAINER_PASS=<from the user> dev/node_modules/.bin/playwright test -c dev/playwright.config.cjs
```
- Without `TRAINER_PASS` the tests that need the seed are skipped.
- `TRAINER_DATA=<trainer-data checkout>` adds the private real-sentence fixtures.
- `TRAINER_MODELS=<folder>` serves the meaning model from disk; `TRAINER_MODELS=online` lets it download from Hugging Face.
- `TRAINER_ONLINE=1` runs `ondevice.spec` (downloads both on-device models, ~2 min).
- Before publishing, run the private leak scan: `node <trainer-data>/tools/leakscan.cjs . ` (needs `TRAINER_PASS`).
