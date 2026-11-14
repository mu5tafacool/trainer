/* Spoken-answer checker, prototype v3 (plain ES5, no dependencies; works in the page and in node).
   Layers:
   1. normalize(): one canonical form for both texts — case, punctuation, contractions, number words → digits,
      hyphens, fillers and self-corrections, dictation variants from a lexicon (only for terms in the reference).
   2. align(): weighted word error rate (Levenshtein over tokens) — the standard ASR metric, used for ezber.
   3. hardChecks(): objective contradictions found without any per-line data — a different number, a lost or
      added negation, an antonym swap, reversed from…to / instead of / expected…got pairs.
   4. grade(): combines the above with optional model signals (sentence similarity, NLI) for anlam lines.
   No sentence text lives in this file. */
(function (root) {
  'use strict';

  var CONTR = { "i'm": 'i am', "i've": 'i have', "i'd": 'i would', "i'll": 'i will', "it's": 'it is', "it'd": 'it would', "that's": 'that is', "there's": 'there is', "what's": 'what is', "let's": 'let us',
    "we're": 'we are', "we've": 'we have', "we'd": 'we would', "we'll": 'we will', "they're": 'they are', "they've": 'they have', "they'd": 'they would', "you're": 'you are', "you'll": 'you will', "you'd": 'you would',
    "he's": 'he is', "she's": 'she is', "don't": 'do not', "doesn't": 'does not', "didn't": 'did not', "isn't": 'is not', "wasn't": 'was not', "aren't": 'are not', "weren't": 'were not', "can't": 'can not', cannot: 'can not',
    "won't": 'will not', "wouldn't": 'would not', "couldn't": 'could not', "shouldn't": 'should not', "haven't": 'have not', "hasn't": 'has not', "hadn't": 'had not',
    dont: 'do not', doesnt: 'does not', didnt: 'did not', isnt: 'is not', wasnt: 'was not', arent: 'are not', cant: 'can not', wont: 'will not', havent: 'have not', hasnt: 'has not', im: 'i am', ive: 'i have', id: 'i would' };
  var UNITS = { zero: 0, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  var TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  var FILLERS = ['um', 'uh', 'er', 'erm', 'hmm', 'like', 'so', 'well', 'you know', 'i mean', 'basically', 'actually', 'okay', 'ok'];
  var CORRECTION = ['sorry', 'i mean', 'no wait', 'wait', 'rather'];
  var NEG = { not: 1, no: 1, never: 1, nothing: 1, none: 1, without: 1, nobody: 1, neither: 1, nor: 1 };
  var FUNC = {};
  ('a an the of to in on at for by with from and or but so as is are was were be been am do does did have has had i it this that these those my our your their its we they he she you me us them there here which who what when where how if than then also just very really any some each every all both either about into over under up out off').split(' ').forEach(function (w) { FUNC[w] = 1; });
  var ANTONYMS = [['before', 'after'], ['early', 'late'], ['earlier', 'later'], ['bigger', 'smaller'], ['more', 'less'], ['more', 'fewer'], ['over', 'under'], ['grew', 'shrank'], ['joined', 'left'], ['first', 'last'], ['always', 'never'], ['increase', 'decrease'], ['faster', 'slower'], ['remotely', 'office'], ['small', 'big'], ['small', 'large'], ['few', 'many'], ['only', 'many'], ['all', 'only'], ['hold', 'ship'], ['holding', 'shipping'], ['removed', 'added'], ['real', 'stubbed'], ['stubbed', 'called']];

  function numberize(tokens) {
    // Folds number words into digits across the token list: "three and a half" → 3.5, "fifteen hundred" → 1500,
    // "twenty five" → 25, "three point five" → 3.5, "1.5k" → 1500. "one" stays a word unless it is part of a bigger number.
    var out = [], i = 0;
    function isNumWord(w) { return UNITS[w] !== undefined || TENS[w] !== undefined || w === 'hundred' || w === 'thousand' || /^\d+(\.\d+)?$/.test(w); }
    while (i < tokens.length) {
      var w = tokens[i];
      var startsNum = UNITS[w] !== undefined || TENS[w] !== undefined || /^\d+(\.\d+)?$/.test(w) || (w === 'one' && i + 1 < tokens.length && (tokens[i + 1] === 'hundred' || tokens[i + 1] === 'thousand' || tokens[i + 1] === 'point'));
      if (!startsNum) { out.push(w); i++; continue; }
      var total = 0, cur = 0, j = i, lastTens = false;
      if (/^\d+(\.\d+)?$/.test(w)) { cur = parseFloat(w); j = i + 1; }
      else {
        while (j < tokens.length) {
          var t = tokens[j];
          if (t === 'one' && (j === i || lastTens)) { cur += 1; lastTens = false; j++; continue; }
          if (UNITS[t] !== undefined && (j === i || lastTens)) { cur += UNITS[t]; lastTens = false; j++; continue; }
          if (TENS[t] !== undefined && cur % 100 === 0) { cur += TENS[t]; lastTens = true; j++; continue; }
          if (t === 'hundred' && cur > 0) { cur *= 100; lastTens = false; j++; continue; }
          if (t === 'thousand') { total += (cur || 1) * 1000; cur = 0; lastTens = false; j++; continue; }
          break;
        }
      }
      var val = total + cur;
      if (tokens[j] === 'point' && j + 1 < tokens.length && (UNITS[tokens[j + 1]] !== undefined || tokens[j + 1] === 'zero' || /^\d$/.test(tokens[j + 1]))) {
        val = parseFloat(String(val) + '.' + (UNITS[tokens[j + 1]] !== undefined ? UNITS[tokens[j + 1]] : tokens[j + 1])); j += 2;
      }
      if (tokens[j] === 'and' && tokens[j + 1] === 'a' && tokens[j + 2] === 'half') { val += 0.5; j += 3; }
      else if (tokens[j] === 'and' && tokens[j + 1] === 'half') { val += 0.5; j += 2; }
      out.push(String(val)); i = j;
    }
    return out;
  }

  function baseTokens(text) {
    var s = String(text || '').toLowerCase().replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"');
    s = s.replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/(\d+(?:\.\d+)?)k\b/g, function (m, n) { return String(Math.round(parseFloat(n) * 1000)); });
    // fractions: "3 1/2", "3 and 1/2" (a space or "and" is required, so "11/2" stays a date or ratio), "3½", "3 ½";
    // a lone "1/2" or "½" only at the start or after a space. Any other a/b is left alone.
    var frac = function (v) { return function (m, n) { return String(parseInt(n, 10) + v); }; };
    s = s.replace(/(\d+)(?:\s+and)?\s+1\/2(?![\d\/])/g, frac(0.5)).replace(/(\d+)(?:\s+and)?\s+1\/4(?![\d\/])/g, frac(0.25))
      .replace(/(\d+)(?:\s+and)?\s*½/g, frac(0.5)).replace(/(\d+)(?:\s+and)?\s*¼/g, frac(0.25))
      .replace(/(^|\s)(?:1\/2(?![\d\/])|½)/g, '$10.5').replace(/(^|\s)(?:1\/4(?![\d\/])|¼)/g, '$10.25');
    s = s.replace(/(\d)\s*%/g, '$1 percent').replace(/%/g, ' percent').replace(/&/g, ' and ').replace(/(\d)\s*[×x](?=\d)/g, '$1 by ');
    s = s.replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2');
    s = s.replace(/(\d)\.(\d)/g, '$1§$2').replace(/[\/\-–—_]+/g, ' ').replace(/[^a-z0-9§' ]+/g, ' ').replace(/§/g, '.');
    var out = [];
    s.split(/\s+/).forEach(function (t) {
      t = t.replace(/^'+|'+$/g, ''); if (!t) return;
      if (CONTR[t]) { out.push.apply(out, CONTR[t].split(' ')); return; }
      if (/n't$/.test(t)) { out.push(t.slice(0, -3), 'not'); return; }
      t = t.replace(/'s$/, '').replace(/'/g, ''); if (t) out.push(t);
    });
    return numberize(out);
  }

  // Dictation writes some spoken numbers as words that sound the same ("four" → "for"). Fixed only when the reference has
  // that number, the answer lacks it, and the answer has more of the look-alike word than the reference.
  var HOMO = { 'for': '4', fore: '4', to: '2', too: '2', ate: '8' };
  function fixHomophones(t, ref) {
    var cnt = function (arr, w) { var c = 0; arr.forEach(function (x) { if (x === w) c++; }); return c; };
    var out = t.slice();
    Object.keys(HOMO).forEach(function (w) {
      var n = HOMO[w], need = cnt(ref, n) - cnt(out, n), extra = cnt(out, w) - cnt(ref, w);
      while (need > 0 && extra > 0) {
        // prefer the occurrence with the same neighbour the number has in the reference ("talked to to people" → "to 2")
        var at = ref.indexOf(n), prev = ref[at - 1], next = ref[at + 1], best = -1, score = -1;
        for (var i = 0; i < out.length; i++) if (out[i] === w) {
          var sc = (out[i - 1] === prev ? 2 : 0) + (out[i + 1] === next ? 1 : 0);
          if (sc > score) { score = sc; best = i; }
        }
        if (best < 0) break;
        out[best] = n; need--; extra--;
      }
    });
    return out;
  }

  // Dictation spells names it doesn't know by sound ("Solar tricks" for a name like "Zoltrix"). A said word (or two said
  // words written together) that sounds like a name of this line becomes that name; a number right after a name's
  // letter head becomes the name's number (product codes are not quizzed as numbers).
  function fixNames(t, R) {
    var names = Object.keys(R.names || {}); if (!names.length && !Object.keys(R.nameHeads || {}).length) return t;
    var out = [];
    for (var i = 0; i < t.length; i++) {
      var w = t[i], done = false;
      if (!R.vocab[w] && !FUNC[w] && !isNum(w)) {
        for (var k = 0; k < names.length && !done; k++) {
          var n = names[k];
          if (i + 1 < t.length && !R.vocab[t[i + 1]] && !isNum(t[i + 1]) && soundsLike(w + t[i + 1], n) && !soundsLike(w, n)) { out.push(n); i++; done = true; }
          else if (soundsLike(w, n)) { out.push(n); done = true; }
        }
      }
      if (done) continue;
      if (isNum(w) && out.length && R.nameHeads && R.nameHeads[out[out.length - 1]] && !R.nameNums[w]) {
        var head = out[out.length - 1], k2 = R.tokens.indexOf(head);
        if (k2 >= 0 && isNum(R.tokens[k2 + 1] || '')) { out.push(R.tokens[k2 + 1]); continue; }
      }
      out.push(w);
    }
    return out;
  }

  function phraseAt(toks, i, phrase) { for (var k = 0; k < phrase.length; k++) if (toks[i + k] !== phrase[k]) return false; return true; }
  function hasPhrase(toks, phrase) { for (var i = 0; i + phrase.length <= toks.length; i++) if (phraseAt(toks, i, phrase)) return true; return false; }

  // Proper names, found from the texts themselves (no list in code): a word written with a capital in the middle of a
  // sentence (not after . : ; ! ? or a quote), or a word mixing letters and digits. Returns lowercase name words.
  var NAME_RE = /(^|[.:;!?"(\u201c]\s*)?\b([A-Z][A-Za-z]*[A-Za-z0-9]*|[A-Za-z]+\d+[A-Za-z0-9]*)\b/g;
  function findNames(texts) {
    var out = {};
    (texts || []).forEach(function (t) {
      var m; NAME_RE.lastIndex = 0;
      while ((m = NAME_RE.exec(String(t || '')))) {
        var w = m[2], initial = m.index === 0 || (m[1] !== undefined && m[1] !== '');
        if (w === 'I' || w.length < 2) continue;
        if (/\d/.test(w) || !initial) out[w.toLowerCase()] = 1;
      }
    });
    return out;
  }
  // A rough sound key (Metaphone-like): similar-sounding spellings of a name get the same or a close key.
  function sound(w) {
    var s = String(w).toLowerCase().replace(/[^a-z]/g, '').replace(/^(kn|gn|pn|wr)/, function (m) { return m.charAt(1); })
      .replace(/ch/g, 'x').replace(/sh/g, 'x').replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/qu?/g, 'k').replace(/x/g, 'ks')
      .replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/dg/g, 'j').replace(/gh/g, '').replace(/z/g, 's');
    if (!s) return '';
    return (s.charAt(0) + s.slice(1).replace(/[aeiouyhw]/g, '')).replace(/(.)\1+/g, '$1');
  }
  function levN(a, b) {
    var d = [], i, j; for (i = 0; i <= a.length; i++) { d.push([i]); }
    for (j = 1; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
    return d[a.length][b.length];
  }
  function soundsLike(a, b) {
    var x = sound(a), y = sound(b);
    if (x.length < 3 || y.length < 3) return false;
    return x === y || levN(x, y) <= 1;
  }

  // Prepares a reference once: its tokens and the lexicon entries whose term occurs in it.
  // names (optional): lowercase name words found across all lines (findNames); names in this line are added too.
  function prepareRef(en, lexicon, names) {
    var ref = baseTokens(en), lex = [];
    Object.keys(lexicon || {}).forEach(function (term) {
      if (term.charAt(0) === '_') return;
      var canon = baseTokens(term);
      if (!canon.length || !hasPhrase(ref, canon)) return;
      (lexicon[term] || []).forEach(function (v) { var a = baseTokens(v); if (a.length && a.join(' ') !== canon.join(' ')) lex.push({ from: a, to: canon }); });
    });
    lex.sort(function (a, b) { return b.from.length - a.from.length; });
    var vocab = {}; ref.forEach(function (t) { vocab[t] = 1; });
    // name tokens of this line; for letter+digit names (ab360) the letters are the head and the digits a name number
    var own = findNames([en]), all = {}, nm = {}, heads = {}, nameNums = {};
    Object.keys(names || {}).forEach(function (k) { all[k] = 1; }); Object.keys(own).forEach(function (k) { all[k] = 1; });
    (String(en).match(/[A-Za-z0-9]+/g) || []).forEach(function (w) {
      if (!all[w.toLowerCase()]) return;
      var parts = baseTokens(w);
      parts.forEach(function (p, i) { if (isNum(p)) { if (i > 0) { heads[parts[i - 1]] = 1; nameNums[p] = 1; } } else if (!FUNC[p]) nm[p] = 1; });
    });
    return { en: en, tokens: ref, lex: lex, vocab: vocab, names: nm, nameHeads: heads, nameNums: nameNums };
  }

  function normalizeSaid(said, R) {
    var t = baseTokens(said), out = [], i, k;
    // self-corrections: "forty, sorry, fourteen" → keep what follows the marker, drop the word before it
    for (i = 0; i < t.length; i++) {
      var hit = null;
      for (k = 0; k < CORRECTION.length; k++) { var ph = CORRECTION[k].split(' '); if (phraseAt(t, i, ph) && !hasPhrase(R.tokens, ph)) { hit = ph; break; } }
      if (hit && out.length) { out.pop(); i += hit.length - 1; continue; }
      out.push(t[i]);
    }
    t = out; out = [];
    // fillers the reference doesn't use
    for (i = 0; i < t.length; i++) {
      var f = null;
      for (k = 0; k < FILLERS.length; k++) { var fp = FILLERS[k].split(' '); if (phraseAt(t, i, fp) && !hasPhrase(R.tokens, fp)) { f = fp; break; } }
      if (f) { i += f.length - 1; continue; }
      out.push(t[i]);
    }
    t = out; out = [];
    // dictation variants → canonical term (only terms that are in the reference)
    for (i = 0; i < t.length; i++) {
      var rep = null;
      for (k = 0; k < R.lex.length; k++) if (phraseAt(t, i, R.lex[k].from)) { rep = R.lex[k]; break; }
      if (rep) { out.push.apply(out, rep.to); i += rep.from.length - 1; continue; }
      out.push(t[i]);
    }
    t = fixHomophones(out, R.tokens); out = [];
    // "type script" → "typescript" when the reference has the joined word; stutters "i i" → "i"
    for (i = 0; i < t.length; i++) {
      if (i + 1 < t.length && !R.vocab[t[i]] && R.vocab[t[i] + t[i + 1]]) { out.push(t[i] + t[i + 1]); i++; continue; }
      if (out.length && out[out.length - 1] === t[i] && !hasPhrase(R.tokens, [t[i], t[i]])) continue;
      out.push(t[i]);
    }
    return fixNames(out, R);
  }

  function lev1(a, b) {
    var i = 0, j = 0, d = 0;
    while (i < a.length && j < b.length) {
      if (a.charAt(i) === b.charAt(j)) { i++; j++; continue; }
      if (++d > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return d + (a.length - i) + (b.length - j) <= 1;
  }
  // Light stemmer for meaning cards only (ezber stays exact): plural, -ed, -ing, -ies and common irregular verbs.
  var IRR = {};
  ('keep kept|run ran|build built|teach taught|go went gone goes|do did done|be was were is are been|make made|find found|write wrote written|lead led|leave left|pay paid|sell sold|get got gotten|give gave given|take took taken|see saw seen|say said|tell told|think thought|bring brought|buy bought|catch caught|feel felt|hear heard|hold held|know knew known|mean meant|meet met|send sent|spend spent|stand stood|understand understood|win won|begin began begun|break broke broken|choose chose chosen|drive drove driven|fall fell fallen|grow grew grown|have had has|show shown|split split|set set|cut cut|let let|put put|lose lost|sit sat|speak spoke spoken|fly flew flown|rise rose risen|shake shook shaken|wear wore worn|fight fought|seek sought|deal dealt|learn learnt')
    .split('|').forEach(function (g) { var w = g.split(' '); w.forEach(function (x) { IRR[x] = w[0]; }); });
  // Possible base forms of a word: itself, irregular base, and the word without -s/-es/-ies, -d/-ed/-ied, -ing (with an
  // undoubled consonant or an added e). Two words match when their sets meet, so "used/use", "shipping/ship", "verified/verify".
  var EED = {}; 'need seed feed speed succeed proceed exceed indeed deed breed bleed greed weed'.split(' ').forEach(function (w) { EED[w] = 1; });
  function stems(w) {
    var out = [w];
    if (IRR[w]) out.push(IRR[w]);
    if (w.length <= 3 || /^\d/.test(w)) return out;
    // candidate base forms are at least 3 letters; doubled final consonants are also tried undoubled
    var add = function (x) { if (x.length >= 3) { out.push(x); if (/([bdgklmnprt])\1$/.test(x) && x.length >= 4) out.push(x.slice(0, -1)); } };
    if (/ies$/.test(w)) add(w.slice(0, -3) + 'y');
    else if (/(s|x|z|ch|sh|o)es$/.test(w)) add(w.slice(0, -2)); // boxes → box, goes → go
    if (/s$/.test(w) && !/(ss|us|is|ies)$/.test(w)) add(w.slice(0, -1)); // notes → note, codes → code
    if (!EED[w]) {
      if (/ied$/.test(w)) add(w.slice(0, -3) + 'y');
      else if (/ed$/.test(w)) { add(w.slice(0, -2)); add(w.slice(0, -1)); }
    }
    if (/ing$/.test(w) && w.length >= 5) { add(w.slice(0, -3)); add(w.slice(0, -3) + 'e'); }
    return out;
  }
  function stem(w) { var c = stems(w); return c[c.length - 1]; }
  function stemEq(a, b) {
    if (a === b || tokEq(a, b)) return true;
    if (FUNC[a] || FUNC[b] || NEG[a] || NEG[b]) return false; // "not", "no", "the"… match only exactly
    var x = stems(a), y = stems(b); return x.some(function (v) { return y.indexOf(v) >= 0; }); }
  function isNum(w) { return /^\d+(\.\d+)?$/.test(w); }
  function tokEq(a, b) { return a === b || (!isNum(a) && !isNum(b) && a.length >= 5 && b.length >= 5 && lev1(a, b)); }
  function weight(w, R) { if (isNum(w) || NEG[w]) return 2; if (FUNC[w]) return 0.5; return 1; }

  // Weighted Levenshtein alignment. Returns error weight, reference weight and the edit list.
  function align(ref, hyp, R) {
    var n = ref.length, m = hyp.length, D = [], B = [], i, j;
    for (i = 0; i <= n; i++) { D.push(new Float64Array(m + 1)); B.push(new Uint8Array(m + 1)); }
    for (i = 1; i <= n; i++) { D[i][0] = D[i - 1][0] + weight(ref[i - 1], R); B[i][0] = 2; }
    for (j = 1; j <= m; j++) { D[0][j] = D[0][j - 1] + weight(hyp[j - 1], R) * 0.5; B[0][j] = 3; }
    for (i = 1; i <= n; i++) for (j = 1; j <= m; j++) {
      var wr = weight(ref[i - 1], R), same = tokEq(ref[i - 1], hyp[j - 1]);
      var sub = D[i - 1][j - 1] + (same ? 0 : Math.max(wr, weight(hyp[j - 1], R))), del = D[i - 1][j] + wr, ins = D[i][j - 1] + weight(hyp[j - 1], R) * 0.5;
      if (sub <= del && sub <= ins) { D[i][j] = sub; B[i][j] = same ? 0 : 1; } else if (del <= ins) { D[i][j] = del; B[i][j] = 2; } else { D[i][j] = ins; B[i][j] = 3; }
    }
    var edits = []; i = n; j = m;
    while (i > 0 || j > 0) {
      var b = B[i][j];
      if (i > 0 && j > 0 && (b === 0 || b === 1)) { if (b === 1) edits.push({ op: 'sub', ref: ref[i - 1], said: hyp[j - 1] }); i--; j--; }
      else if (i > 0 && (j === 0 || b === 2)) { edits.push({ op: 'del', ref: ref[i - 1] }); i--; }
      else { edits.push({ op: 'ins', said: hyp[j - 1] }); j--; }
    }
    edits.reverse();
    var refW = 0; ref.forEach(function (w) { refW += weight(w, R); });
    return { err: D[n][m], refW: refW, edits: edits };
  }

  function count(toks, set) { var c = 0; toks.forEach(function (w) { if (set[w]) c++; }); return c; }
  function nums(toks) { return toks.filter(isNum); }
  function pairAfter(toks, a, b) { // "from X to Y" → [X, Y] with X, Y the first token after each marker
    var res = [];
    for (var i = 0; i < toks.length; i++) if (phraseAt(toks, i, a)) {
      for (var j = i + a.length + 1; j < Math.min(toks.length, i + a.length + 7); j++) if (phraseAt(toks, j, b)) {
        var x = toks.slice(i + a.length, j).filter(function (w) { return !FUNC[w]; }), y = toks.slice(j + b.length, j + b.length + 4).filter(function (w) { return !FUNC[w]; });
        if (x.length && y.length) res.push([x[0], y[0]]);
        break;
      }
    }
    return res;
  }
  function insteadOf(toks) {
    var res = [];
    for (var i = 1; i + 2 < toks.length; i++) if (toks[i] === 'instead' && toks[i + 1] === 'of') {
      var x = toks.slice(Math.max(0, i - 4), i).filter(function (w) { return !FUNC[w]; }), y = toks.slice(i + 2, i + 6).filter(function (w) { return !FUNC[w]; });
      if (x.length && y.length) res.push([x[x.length - 1], y[0]]);
    }
    return res;
  }

  // Objective contradictions and omissions, no per-line data needed.
  function hardChecks(R, hyp) {
    var ref = R.tokens, issues = [];
    var rn = nums(ref), hn = nums(hyp), left = hn.slice(), missingNums = [];
    rn.forEach(function (x) { var k = left.indexOf(x); if (k >= 0) left.splice(k, 1); else missingNums.push(x); });
    if (missingNums.length && left.length) issues.push({ kind: 'number', ref: missingNums.join(', '), said: left.join(', '), hard: true });
    else if (missingNums.length) issues.push({ kind: 'number-missing', ref: missingNums.join(', ') });
    var rneg = count(ref, NEG), hneg = count(hyp, NEG);
    if (rneg !== hneg) issues.push({ kind: 'negation', ref: rneg, said: hneg, hard: true });
    var hv = {}; hyp.forEach(function (w) { hv[w] = 1; });
    ANTONYMS.forEach(function (p) {
      for (var s = 0; s < 2; s++) {
        var a = p[s], b = p[1 - s];
        if (R.vocab[a] && !R.vocab[b] && hv[b] && !hv[a]) issues.push({ kind: 'antonym', ref: a, said: b, hard: true });
      }
    });
    var checks = [function (t) { return pairAfter(t, ['from'], ['to']); }, insteadOf, function (t) { return pairAfter(t, ['expected'], ['got']); }];
    checks.forEach(function (fn) {
      var rp = fn(ref), hp = fn(hyp);
      rp.forEach(function (r) { hp.forEach(function (h) { if (tokEq(r[0], h[1]) && tokEq(r[1], h[0])) issues.push({ kind: 'order', ref: r.join(' → '), said: h.join(' → '), hard: true }); }); });
    });
    return issues;
  }

  // Order-free word lists for meaning cards: content words of the reference not said, and said content words not in the reference.
  // Each said word matches at most one reference word, so a reordered word is never listed as both missing and extra.
  function bagDiff(ref, hyp) {
    var left = hyp.filter(function (w) { return !FUNC[w]; }), miss = [];
    ref.forEach(function (w) {
      if (FUNC[w]) return;
      var k = left.indexOf(w); if (k < 0) for (var i = 0; i < left.length && k < 0; i++) if (stemEq(w, left[i])) k = i;
      if (k >= 0) left.splice(k, 1); else miss.push(w);
    });
    return { miss: miss, extra: left };
  }

  /* Combines everything into a suggested grade (2 İyi, 1 Zor, 0 Tekrar).
     sig (optional) = { sim: cosine, nli: { fwd: {ent, neu, con}, back: {ent, neu, con} } }  — fwd: reference ⇒ said, back: said ⇒ reference. */
  // Chosen on the 85-case eval set (stable across the grid; see the prototype report).
  var T = { ezberGood: 0.94, ezberOk: 0.7, anlamCon: 0.5, anlamEnt: 0.7, anlamSimGood: 0.8, anlamSimOk: 0.6, anlamCovGood: 0.5 };
  function check(line, said, lexicon, sig, opts) {
    opts = opts || {};
    var R = line._prep || prepareRef(line.en, lexicon), hyp = normalizeSaid(said, R);
    var a = align(R.tokens, hyp, R), acc = Math.max(0, 1 - a.err / (a.refW || 1));
    var issues = hardChecks(R, hyp), hard = issues.some(function (x) { return x.hard; });
    var bag = bagDiff(R.tokens, hyp), nC = R.tokens.filter(function (w) { return !FUNC[w]; }).length, cov = nC ? 1 - bag.miss.length / nC : 1;
    var con = 0, entF = null, entB = null;
    // Contradiction is read only as "reference ⇒ said": the reverse direction raised false alarms on reordered answers.
    if (sig && sig.nli) { con = sig.nli.fwd.con; entF = sig.nli.fwd.ent; entB = sig.nli.back.ent; }
    var useNli = sig && sig.nli && opts.nli !== false, useSim = sig && typeof sig.sim === 'number' && opts.sim !== false;
    var grade, why = [];
    if (!hyp.length) { grade = 0; why.push('empty'); }
    else if (line.tier === 'ezber') {
      grade = acc >= T.ezberGood ? 2 : acc >= T.ezberOk ? 1 : 0;
      if (hard) { grade = 0; why.push('hard'); }
      else if (useNli && con >= T.anlamCon && acc < 0.999) { grade = 0; why.push('nli-contradiction'); }
    } else {
      if (hard) { grade = 0; why.push('hard'); }
      else if (useNli && con >= T.anlamCon) { grade = 0; why.push('nli-contradiction'); }
      else if (acc >= 0.97) grade = 2;
      else if (useNli) {
        var both = entF >= T.anlamEnt && entB >= T.anlamEnt, one = entF >= T.anlamEnt || entB >= T.anlamEnt;
        grade = both ? 2 : one ? 1 : (useSim && sig.sim >= T.anlamSimOk ? 1 : 0);
        if (grade === 2 && issues.some(function (x) { return x.kind === 'number-missing'; })) grade = 1;
        // The model can call a short, garbled answer "entailed"; most of the reference's terms must be there for İyi.
        if (grade === 2 && cov < T.anlamCovGood) { grade = 1; why.push('low-coverage'); }
        why.push('nli');
      } else if (useSim) {
        grade = sig.sim >= T.anlamSimGood ? 2 : sig.sim >= T.anlamSimOk ? 1 : 0;
        if (grade === 2 && issues.some(function (x) { return x.kind === 'number-missing'; })) grade = 1;
        why.push('sim');
      } else {
        // rules only: bag-of-content-words coverage (order and word endings ignored), function words ignored
        grade = cov >= 0.85 ? 2 : cov >= 0.6 ? 1 : 0; why.push('coverage ' + cov.toFixed(2));
      }
    }
    return { grade: grade, acc: acc, issues: issues, edits: a.edits, bag: bag, cov: cov, said: hyp, ref: R.tokens, con: con, entF: entF, entB: entB, why: why };
  }

  var api = { baseTokens: baseTokens, prepareRef: prepareRef, normalizeSaid: normalizeSaid, align: align, hardChecks: hardChecks, check: check, stemEq: stemEq, findNames: findNames, sound: sound, THRESHOLDS: T, isFunc: function (w) { return !!FUNC[w]; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.verify3 = api;
})(typeof window !== 'undefined' ? window : this);
