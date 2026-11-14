'use strict';
// A device on an older seed opens the current build: answers are merged with the stored key.
// Edited lines keep their text (and the seed's pattern chunks they still contain), deleted lines
// stay deleted, lines added on the device stay in place, new seed lines come in, progress is untouched.
const { test, expect } = require('@playwright/test');
const { requirePass, unlock, dumpStore, writeStore, seedOf } = require('./helpers.cjs');

// Same rule as withMk() in index.html.
function keptMk(en, mk) {
  let at = 0; const r = [];
  (mk || []).forEach((c) => { const k = en.indexOf(c, at); if (k >= 0) { r.push(c); at = k + c.length; } });
  return r;
}

test('older seed on the device is merged, not replaced', async ({ page }) => {
  requirePass(test);
  const { meta, data, answers } = await seedOf();
  const order = data.order || [];
  const prevV = order[order.indexOf(meta.v) - 1];
  test.skip(!prevV || !data.hist || !data.hist[prevV], 'no previous seed version in hist');
  const known = new Set(data.hist[prevV]);

  // An answer whose first four lines all existed in the previous version, and line 2 has a pattern chunk.
  const aid = Object.keys(answers).find((id) => {
    const L = answers[id].lines;
    return L.length >= 5 && L.slice(0, 4).every((l) => known.has(l.id)) && (L[2].mk || []).length >= 1;
  });
  test.skip(!aid, 'no suitable answer');
  const seedLines = answers[aid].lines;
  const [L0, L1, L2] = seedLines;
  // A line that is new in the current version (not in the previous hist), if any, anywhere in the seed.
  const fresh = Object.keys(answers).map((id) => [id, answers[id].lines.find((l) => !known.has(l.id) && !l.rep)]).find(([, l]) => l);

  await unlock(page);
  const before = await dumpStore(page);

  const edited0 = { ...L0, en: L0.en + ' And that is all.', edited: true };
  const edited2 = { ...L2, en: L2.en.replace(L2.mk[0], 'some other words'), edited: true };
  const added = { id: aid + '-x9001', en: 'This line was added on the device.', tr: 'Bu satır cihazda eklendi.', tier: 'anlam', added: true };
  const local = [edited0, edited2, added].concat(seedLines.slice(3)); // L1 deleted on the device
  const progress = { intro: { [aid]: '2026-01-01' }, reh: {}, first: '2026-01-01' };
  const srs = { c: { [L0.id]: { p: { ivl: 3, ease: 2.5, due: '2026-12-01', reps: 2, lapses: 0 } } } };
  const entries = {
    ['answers/' + aid]: { ...before['answers/' + aid], lines: local },
    'data/users/local/progress': progress,
    ['data/users/local/srs_' + aid]: srs,
    __seed: { v: prevV, at: '2026-01-01T00:00:00.000Z', from: null },
  };
  if (fresh) {
    const [fid, fl] = fresh;
    const cur = fid === aid ? entries['answers/' + aid] : before['answers/' + fid];
    entries['answers/' + fid] = { ...cur, lines: cur.lines.filter((l) => l.id !== fl.id) };
  }
  await writeStore(page, entries);

  await page.reload();
  await expect.poll(async () => (await dumpStore(page)).__seed.v, { timeout: 30000 }).toBe(meta.v);
  const after = await dumpStore(page);
  const lines = after['answers/' + aid].lines;
  const ids = lines.map((l) => l.id);

  const m0 = lines.find((l) => l.id === L0.id);
  expect(m0.en).toBe(edited0.en);
  expect(m0.mk || []).toEqual(keptMk(edited0.en, L0.mk));
  const m2 = lines.find((l) => l.id === L2.id);
  expect(m2.en).toBe(edited2.en);
  expect(m2.mk || []).toEqual(keptMk(edited2.en, L2.mk));
  expect(ids).not.toContain(L1.id);
  expect(ids.indexOf(added.id)).toBe(ids.indexOf(L2.id) + 1);
  if (fresh) expect(after['answers/' + fresh[0]].lines.map((l) => l.id)).toContain(fresh[1].id);
  expect(after['data/users/local/progress']).toEqual(progress);
  expect(after['data/users/local/srs_' + aid]).toEqual(srs);
});

// A line split in the current seed: on a device from the previous version the first half keeps its id (and progress),
// its text updates (it was not edited), and the new second half lands right after it as a new line.
test('a split line keeps its progress and the new half comes in after it', async ({ page }) => {
  requirePass(test);
  const { meta, data, answers } = await seedOf();
  const order = data.order || [];
  const prevV = order[order.indexOf(meta.v) - 1];
  test.skip(!prevV || !data.hist || !data.hist[prevV], 'no previous seed version in hist');
  const known = new Set(data.hist[prevV]);
  let aid, first, fresh;
  for (const id of Object.keys(answers)) {
    const L = answers[id].lines;
    for (let i = 1; i < L.length; i++) if (!known.has(L[i].id) && !L[i].rep && known.has(L[i - 1].id)) { aid = id; first = L[i - 1]; fresh = L[i]; break; }
    if (aid) break;
  }
  test.skip(!aid, 'no split line in this seed');

  await unlock(page);
  const before = await dumpStore(page);
  const oldFirst = { ...first, en: 'Old text of this line before the split.', tr: 'Bölünmeden önceki eski metin.', mk: [] };
  const local = answers[aid].lines.filter((l) => l.id !== fresh.id).map((l) => (l.id === first.id ? oldFirst : l));
  const srs = { c: { [first.id]: { p: { ivl: 5, ease: 2.4, due: '2026-12-05', reps: 3, lapses: 1 } } } };
  await writeStore(page, {
    ['answers/' + aid]: { ...before['answers/' + aid], lines: local },
    ['data/users/local/srs_' + aid]: srs,
    __seed: { v: prevV, at: '2026-01-01T00:00:00.000Z', from: null },
  });

  await page.reload();
  await expect.poll(async () => (await dumpStore(page)).__seed.v, { timeout: 30000 }).toBe(meta.v);
  const after = await dumpStore(page);
  const lines = after['answers/' + aid].lines, ids = lines.map((l) => l.id);
  expect(lines.find((l) => l.id === first.id).en).toBe(first.en);
  expect(lines.find((l) => l.id === first.id).mk).toEqual(first.mk);
  expect(ids.indexOf(fresh.id)).toBe(ids.indexOf(first.id) + 1);
  expect(after['data/users/local/srs_' + aid]).toEqual(srs);
});
