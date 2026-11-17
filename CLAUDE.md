# Trainer — notes for Claude

Offline PWA for practising spoken answers. Everything ships from branch `gh-pages` (GitHub Pages); `main` only has an old README.

## Files
- `index.html` is the whole app (two scripts: platform layer, then UI). The answer set is an encrypted `<script id="seed">` (AES-GCM, PBKDF2-SHA256 200k; passphrase normalized to lowercase a–z0–9).
- `sw.js` service worker. Every release: `node dev/tools/release.cjs` (bumps `V` to the next `mt-vNN`, sets the same `APP_VER` in `index.html` and stamps `APP_BUILT` with UTC time; Settings shows "Sürüm v0.NN · date time UTC · cümleler vN" at the bottom, a test checks they match). Versions read v0.NN (`APP_MAJOR = 0`) until the core tasks are done; then `gh-pages` is merged into `main` and it becomes v1.
- Timing: every "say it" time comes from one block in `index.html` (`speakMs`, `echoMs`, `recallMs`, `fluentMs`, after `wait`); don't add timing constants elsewhere.
- Hızı ölç (Settings → Anlam kontrolü) is hidden; opening the app once with `#hiz` shows it on that device until *Gizle*.
- `shot-narrow.png`, `shot-wide.png`: manifest screenshots (Chrome's install sheet), Settings only, no answer text; remake with `TRAINER_PASS=… node dev/tools/screenshots.cjs` and look at them before committing.
- `nli/` Transformers.js + ONNX Runtime wasm for the optional meaning check (byte-identical npm files, see README).
- `audio*.bin` encrypted voice packs, append-only; clips are looked up by `lang|text`. After any seed text change run `TRAINER_PASS=… KOKORO_DIR=… node dev/tools/voices.cjs` (`--dry` to only list): it voices every played text without a clip (EN Kokoro `am_fenrir`; TR `say` with the Mac's system voice set to Turkish Siri Voice 2) and adds one pack via `dev/tools/audio-pack.cjs`. Off macOS (cloud) only EN is made; run it on the Mac later for TR. Languages are rows in `LANGS` there. `audio.spec` checks every played text has a clip; the phone drops clips no line uses (`__pruneAudio`). Clips stay in IndexedDB and are read only when played (`__clipUrl`, last 8 kept); the text→clip list is cached in `__clipidx`, so opening the app reads no clips.
- `dev/` tools and Playwright tests. `dev/lib/verify3.js` is the spoken check; `index.html` carries a copy between `verify3:start` and `verify3:end` — after editing run `node dev/tools/sync-verify3.cjs`.

## Rules
- The repo is public. No plaintext answer sentences and no company or product names in any committed file. Real sentences, fixtures and the leak-scan name list live only in the private repo `mu5tafacool/trainer-data`.
- The passphrase is never written to a file, env file, commit or setting. Ask the user for it in chat when a step needs it.
- If seed data changes, bump the seed version and add `hist['v<prev>']` (all line ids of the previous version). User progress and edits survive through the merge (`mergeAnswer` / `withMk` / `applySeed`); extend it, don't build a second one.
- Line `intent` (seed v10+) is a 1–3 word Turkish stop label; edited lines take the seed's label in the merge (`fromSeed`) unless `intentOwn` is set (the user wrote one). Shown only in Yeni (stop bar) and Prova round 1 (skeleton round) and the Prova result; `U.settings.intent === false` turns it off.
- Run the tests before and after every change.
- Commit as `git -c user.name="mu5tafacool" -c user.email="mu5tafacool@users.noreply.github.com" commit ...` with **no Co-Authored-By or Claude-Session lines**. Push to `gh-pages`.
- After a push, check the Pages build (`gh api repos/mu5tafacool/trainer/actions/runs`, or the public REST API). On a 500, push one empty commit to retrigger, once.
- Read big files in parts (`grep -n`, line ranges); `index.html` is large.

## Tests
```
cd dev && npm i --no-save @playwright/test@1.63 && npx playwright install chromium && cd ..
TRAINER_PASS=<from the user> dev/node_modules/.bin/playwright test -c dev/playwright.config.cjs
```
- Tests run in parallel (`fullyParallel`, 75% of cores; `TRAINER_WORKERS=1` for one at a time), ~10 s for the suite; HTML report in `$TMPDIR/trainer-report`.
- Speech and the wake lock are stubbed (`stubSpeech`, `stubWake` in helpers) and time is fast-forwarded with `page.clock`, so Dinle, Prova, Mülakat and wake-lock tests don't wait in real time.
- Without `TRAINER_PASS` the tests that need the seed are skipped.
- `TRAINER_DATA=<trainer-data checkout>` adds the private real-sentence fixtures.
- `TRAINER_MODELS=<folder>` serves the meaning model from disk; `TRAINER_MODELS=online` lets it download from Hugging Face.
- `TRAINER_ONLINE=1` runs `ondevice.spec` (downloads both on-device models, ~2 min).
- Before publishing, run the private leak scan: `node <trainer-data>/tools/leakscan.cjs . ` (needs `TRAINER_PASS`).
