# Interview Trainer

A personal, offline study app for memorising spoken interview answers, so that recall becomes automatic in both directions: Turkish → English and English → Turkish.

It is a single-page progressive web app (PWA) served from this repository with GitHub Pages. The answer texts and the audio are encrypted; this repository only holds the built site.

## How a day works

The **Today** tab (Bugün) lays out the day in order:

1. **Review** (Tekrar): the cards whose date has come.
2. **New** (Yeni): one group of new answers per day. One button per group chooses where new answers start: the basics (S0–S12), the preparation set (S13–S22) or the second-interview set (H1–H17). When the chosen group is finished, the others follow. "Start the next one early" adds another group the same day.
3. **Rehearse** (Prova): a suggested answer to say from start to finish.
4. **Listen on the go** (Yolda dinle): a shortcut to recall-mode listening.

## Features

### Answers, lines and groups

- Each answer is a question plus short lines (about 20 words or fewer), each with a Turkish translation.
- Every answer has a code from the source document: **S0–S12** basics, **S13–S22** preparation set, **H1–H17** second-interview set.
- Answers carry a group tag, shown as a chip and usable as a filter on every list.
- Lines are either **ezber** (word for word: openings, closings and key sentences, marked with a red edge) or **anlam** (meaning: main idea and terms are enough).
- Answers can include:
  - a key sentence;
  - a skeleton or keywords (used as hints);
  - words to say clearly;
  - Turkish notes.

### Learning new answers

- Each line goes through **listen → meaning → shadow 3× → 5-second image**. The first shadowing pass shows the text; the later passes hide it.
- A short check every 4–5 lines: see the Turkish, say the English.

### Spaced review

- Two card types per line:
  - **TR → EN**: read or hear the Turkish, say the English aloud.
  - **EN audio → TR**: hear the English, say what it means.
- Four grades (Again, Hard, Good, Easy). Each button shows the next interval.
- The scheduler is SM-2-like:
  - intervals grow with each success, for example 1 → 3 → 8 → 20 days;
  - a miss brings the card back the same day.
- Listen-mode ✓/✗ marks and speed-test misses feed the same schedule.

### Listen

Three modes:

- **A · Shadowing**: English N times (2/3/5/7), repeat after each. The text hides after the second pass.
- **B · Spoken recall**:
  - Turkish, then a 4-second gap to say the English yourself, then English N times (1/2/3/5).
  - After the English starts, two boxes in the card's top corners grade the recall:
    - **✓ known**: moves on and pushes the next review out.
    - **✗ not known**: the card returns later in the session.
  - To undo a mark: tap the filled box again, use *Undo* (shown for 5 s), or go back with *Previous*.
- **Flow** (Akış): whole answers in order, each preceded by its question.

Listen options:

- **Scope**:
  - *Due today*: lines whose date has come; modes A and B only.
  - Learned lines.
  - Everything.
  - A group: all its lines, or only the learned ones.
  - A single answer.
- **Options**: shuffle (off by default) and show text.
- **Controls**:
  - **Previous · Pause/Resume · Next** stay above the tab bar; *Finish* ends the session.
  - Headphone and lock-screen buttons (next, previous, pause) work while Listen is running, through the Media Session API.
- The screen has to stay on: a wake lock is requested, and iOS stops page audio when the screen locks.

### Rehearse and speed test

- **Answer rehearsal**:
  - Hear the question, press start and say the whole answer, then stop the timer.
  - *Show hint* reveals the keywords.
  - The result shows every line, the key sentence and the notes.
  - Mark it as fluent or stuck. The target is 60–90 seconds without pausing.
- **Speed test**:
  - See the Turkish, say the English, reveal.
  - The target is correct and under 3 seconds.
  - Results keep the accuracy and median time, and misses go to today's review.
- Both can be narrowed to one group.

### Lines tab

- **List**:
  - each answer shows its code, tag, status (✓ learned, +N lines still to learn, #N place in the new-answer queue) and line count;
  - opening an answer shows its hints and notes.
- **Editing**:
  - Edit a line's English, Turkish or type, add lines, or delete lines.
  - Changing a line's English resets that line's review history.
  - Edits survive updates.
- **Export to Notes**: copies the text, English only or Turkish + English, for iOS Speak Screen.

### Audio

- English clips use the Kokoro *Fenrir* voice and Turkish clips use the macOS Siri voice. Both are pre-generated and play at the chosen speed (default 0.9).
- A line without a clip falls back to the device voice.
- Optional on-device voicing: new or edited English lines are generated in the browser with Kokoro.
  - Turned on once in Settings.
  - Downloads a model of about 115 MB, then works offline.
- An alternative *Siri* mode keeps the page silent and lets Apple Spoken Content read the selected sentence.

### Offline, privacy and updates

- Installable to the home screen. A service worker caches the app shell, so the app works offline.
- The answers and audio packs are encrypted with AES-GCM, using a key derived from a passphrase (PBKDF2-SHA256, 200,000 iterations).
  - The passphrase is asked once per device; the derived key is then kept on that device.
- Progress (review state, rehearsals, tests and settings) stays in the browser's local storage on each device.
  - It moves between devices with an export/import code in Settings.
- **Answer updates are merged**, not replaced:
  - new answers and lines are added;
  - lines changed upstream replace the old ones;
  - lines you edited or added are kept, and lines you deleted stay deleted;
  - review progress is untouched.
- **Audio packs are append-only.** An update downloads only the new pack, and earlier packs stay cached.

## Shortcuts

| Where | Keys (Mac) |
|---|---|
| Review | Space/Enter = reveal · 1–4 = grade |
| New answer check | Space = reveal · 1 = ask again · 2 = said it |
| Speed test | Space = reveal · 1 = wrong · 2 = right |
| Listen | ← previous · → next · Space = pause/resume |
| Listen, mode B | 1 = ✗ not known · 2 = ✓ known |
| Headphones / lock screen | next · previous · pause (while Listen is running) |

On AirPods, double and triple tap can be set to next/previous track in the iPhone's Bluetooth settings.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app: markup, styles, script, the encrypted answer set and the audio pack list |
| `sw.js` | Service worker for offline use |
| `audio.bin`, `audio-*.bin` | Encrypted audio packs |
| `tts/` | Browser bundle for optional on-device voicing (kokoro-js with the ONNX Runtime Web WebAssembly files) |
| `manifest.webmanifest`, `icon-*.png` | Home-screen install |

## Credits

- [kokoro-js](https://github.com/hexgrad/kokoro) and the Kokoro-82M model (Apache-2.0).
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT).
- Fonts from Google Fonts: Bricolage Grotesque, IBM Plex Sans and IBM Plex Mono (SIL OFL).
