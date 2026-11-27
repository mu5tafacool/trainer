'use strict';
// v1 · 3a/5 (d64): the general check with each language's rules (LANGS es, fr): accents, negation, numbers, the set's synonyms,
// and the same grade limits as before. Made-up sentences only. English keeps its own rules (verify3) and does not change.
const { test, expect } = require('@playwright/test');

async function run(page, fn, arg) {
  await page.goto(process.env.TRAINER_PAGE || 'index.html');
  return page.evaluate(fn, arg);
}
const kinds = (d) => d.issues.map((x) => x.kind);

test('accents and punctuation are not counted; ñ stays its own letter; Turkish keeps ı and ş apart', async ({ page }) => {
  const r = await run(page, () => {
    const any = window.__dict.any, T = window.__i18n.tokens;
    return {
      cafe: any({ es: 'Un café, por favor.', tier: 'ezber' }, 'un cafe por favor', 'es'),
      donde: any({ es: '¿Dónde está la estación?', tier: 'ezber' }, 'donde esta la estacion', 'es'),
      hotel: any({ fr: "L'hôtel est à côté.", tier: 'ezber' }, 'l hotel est a cote', 'fr'),
      quote: any({ fr: '« Merci beaucoup ! »', tier: 'ezber' }, 'merci beaucoup', 'fr'),
      tilde: T('El año', 'es'), notilde: T('El ano', 'es'),
      tr: [T('kışın', 'tr'), T('kisin', 'tr')]
    };
  });
  for (const k of ['cafe', 'donde', 'hotel', 'quote']) { expect(r[k].score, k).toBe(100); expect(r[k].grade, k).toBe(2); expect(r[k].issues, k).toEqual([]); }
  expect(r.tilde).toEqual(['el', 'año']); expect(r.notilde).toEqual(['el', 'ano']);
  expect(r.tr[0]).not.toEqual(r.tr[1]); // ş is a letter of its own in Turkish
});

test('negation: missing or extra is a warning and Tekrar; said right, no warning; a word that only contains one is not', async ({ page }) => {
  const r = await run(page, () => {
    const any = window.__dict.any;
    const es = { es: 'El hotel no está cerca.', tier: 'anlam' }, fr = { fr: 'Je ne parle pas italien.', tier: 'anlam' };
    return {
      esMiss: any(es, 'el hotel está cerca', 'es'), esOk: any(es, 'el hotel no esta cerca', 'es'), esNunca: any(es, 'el hotel nunca está cerca', 'es'),
      esExtra: any({ es: 'Me gusta nadar.', tier: 'anlam' }, 'no me gusta nadar', 'es'), nadar: any({ es: 'Me gusta nadar.', tier: 'ezber' }, 'me gusta nadar', 'es'),
      frMiss: any(fr, 'je parle italien', 'fr'), frOk: any(fr, 'je ne parle pas italien', 'fr'), frSpoken: any(fr, 'je parle pas italien', 'fr'),
      frElide: any({ fr: "Ce n'est jamais fermé.", tier: 'anlam' }, "c'est jamais fermé", 'fr'),
      frPlus: any({ fr: 'Il y a plus de place.', tier: 'ezber' }, 'il y a plus de place', 'fr')
    };
  });
  expect(kinds(r.esMiss)).toEqual(['negation']); expect(r.esMiss.issues[0]).toMatchObject({ ref: 1, said: 0 }); expect(r.esMiss.grade).toBe(0);
  expect(r.esOk.issues).toEqual([]); expect(r.esOk.grade).toBe(2);
  expect(kinds(r.esNunca)).toEqual([]); // another negative word: still negative
  expect(kinds(r.esExtra)).toEqual(['negation']); expect(r.esExtra.issues[0]).toMatchObject({ ref: 0, said: 1 });
  expect(r.nadar.issues).toEqual([]); // nadar contains "nada" but is not a negation
  expect(kinds(r.frMiss)).toEqual(['negation']); expect(r.frMiss.grade).toBe(0);
  expect(r.frOk.issues).toEqual([]);
  expect(kinds(r.frSpoken)).toEqual([]); // spoken French drops "ne": "pas" is enough
  expect(kinds(r.frElide)).toEqual([]);
  expect(r.frPlus.issues).toEqual([]); // "plus" = more, not a negation
});

test('numbers: digits and words are equal, a different number is a warning and Tekrar, "a / one" stays a word', async ({ page }) => {
  const r = await run(page, () => {
    const any = window.__dict.any, P = (t, l) => window.__dict.prep(t, l).t.join(' ');
    return {
      frWrong: any({ fr: "J'ai trois valises.", tier: 'ezber' }, "j'ai deux valises", 'fr'),
      frDigit: any({ fr: "J'ai trois valises.", tier: 'ezber' }, "j'ai 3 valises", 'fr'),
      es21: any({ es: 'La habitación veintiuno.', tier: 'ezber' }, 'la habitacion 21', 'es'),
      esMissing: any({ es: 'Son las ocho y media.', tier: 'anlam' }, 'son las y media', 'es'),
      one: any({ es: 'Quiero una habitación.', tier: 'ezber' }, 'quiero 1 habitacion', 'es'),
      oneArt: any({ fr: 'Un billet, s’il vous plaît.', tier: 'ezber' }, 'le billet s il vous plait', 'fr'),
      parse: [P('treinta y uno', 'es'), P('ciento veinte', 'es'), P('dos mil quinientos', 'es'), P('quatre-vingt-dix', 'fr'), P('soixante et onze', 'fr'),
        P('quatre-vingts', 'fr'), P('deux cents', 'fr'), P('mille deux cents', 'fr'), P('dix-sept', 'fr'), P('vingt et un', 'fr'), P('1 500', 'fr'), P('1.500', 'es'),
        P('cinq six', 'fr'), P('una mesa', 'es'), P('un', 'fr')]
    };
  });
  expect(kinds(r.frWrong)).toEqual(['number']); expect(r.frWrong.issues[0]).toMatchObject({ ref: '3', said: '2' }); expect(r.frWrong.grade).toBe(0);
  expect(r.frDigit.score).toBe(100); expect(r.frDigit.issues).toEqual([]);
  expect(r.es21.score).toBe(100); expect(r.es21.issues).toEqual([]);
  expect(kinds(r.esMissing)).toEqual(['number-missing']);
  expect(r.one.score).toBe(100); expect(r.one.issues).toEqual([]); // una = 1
  expect(r.oneArt.issues).toEqual([]); // un as an article left out: a missing word, not a missing number
  expect(r.parse).toEqual(['31', '120', '2500', '90', '71', '80', '200', '1200', '17', '21', '1500', '1500', '5 6', 'una mesa', 'un']);
});

test("synonyms: the set's list counts as the same words, phrases too; a word not in the list is missing", async ({ page }) => {
  const r = await run(page, () => {
    const any = window.__dict.any;
    window.__dict.setSyn('es', [['quiero', 'me gustaría', 'quisiera']]);
    const l = { es: 'Quiero un café.', tier: 'ezber' };
    const out = { phrase: any(l, 'me gustaría un café', 'es'), word: any(l, 'quisiera un cafe', 'es'), other: any(l, 'necesito un café', 'es'),
      kp: window.__dict.kpAny(['quiero un'], 'me gustaria un te', 'es').ok };
    window.__dict.setSyn('es', []);
    out.off = any(l, 'me gustaría un café', 'es');
    return out;
  });
  expect(r.phrase.score).toBe(100); expect(r.word.score).toBe(100);
  expect(r.other.miss).toEqual(['quiero']); expect(r.other.extra).toEqual(['necesito']);
  expect(r.kp).toBe(true);
  expect(r.off.score).toBeLessThan(100);
});

test('grade limits on both sides: ezber 94 / 70, anlam 85 / 70', async ({ page }) => {
  const r = await run(page, () => {
    const any = window.__dict.any, W = 'uno dos tres cuatro cinco seis siete ocho nueve diez'.split(' ').map((x, i) => 'palabra' + 'abcdefghijklmnopqrst'[i]);
    const ref = W.concat(W.slice(0, 7).map((w) => w + 'x')).join(' '); // 17 words
    const drop = (k) => ref.split(' ').slice(k).join(' ');
    const g = (tier, k) => { const d = any({ es: ref, tier }, drop(k), 'es'); return [d.score, d.grade]; };
    return { e0: g('ezber', 0), e1: g('ezber', 1), e5: g('ezber', 5), e6: g('ezber', 6), a2: g('anlam', 2), a3: g('anlam', 3) };
  });
  expect(r.e0).toEqual([100, 2]);
  expect(r.e1).toEqual([94, 2]); // 16/17 = 94.1%
  expect(r.e5).toEqual([71, 1]); // 12/17 = 70.6%
  expect(r.e6).toEqual([65, 0]);
  expect(r.a2).toEqual([88, 2]); // 15/17 = 88.2%
  expect(r.a3).toEqual([82, 1]);
});

test('the warnings draw like the English ones and fit at 320 px; English keeps its own rules', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const r = await run(page, () => {
    const d = window.__dict.any({ es: 'No tengo tres maletas.', tier: 'anlam' }, 'tengo dos maletas', 'es');
    const box = document.createElement('div'); box.style.width = '288px'; box.innerHTML = window.__dict.res(d, d.text); document.body.prepend(box);
    const over = [...box.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > 320).length;
    return { kinds: d.issues.map((x) => x.kind), html: box.textContent, over, en: window.__i18n.langs.en.check, es: window.__i18n.langs.es.check, fr: window.__i18n.langs.fr.check };
  });
  expect(r.kinds).toEqual(['number', 'negation']);
  expect(r.html).toContain('Sayı farklı'); expect(r.html).toContain('Olumsuzluk eksik');
  expect(r.over).toBe(0);
  expect([r.en, r.es, r.fr]).toEqual(['verify3', '', '']);
});
