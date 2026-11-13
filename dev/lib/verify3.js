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
    s = s.replace(/(\d)\s*%/g, '$1 percent').replace(/%/g, ' percent').replace(/&/g, ' and ').replace(/[×x](?=\d)/g, ' by ');
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

  function phraseAt(toks, i, phrase) { for (var k = 0; k < phrase.length; k++) if (toks[i + k] !== phrase[k]) return false; return true; }
  function hasPhrase(toks, phrase) { for (var i = 0; i + phrase.length <= toks.length; i++) if (phraseAt(toks, i, phrase)) return true; return false; }

  // Prepares a reference once: its tokens and the lexicon entries whose term occurs in it.
  function prepareRef(en, lexicon) {
    var ref = baseTokens(en), lex = [];
    Object.keys(lexicon || {}).forEach(function (term) {
      if (term.charAt(0) === '_') return;
      var canon = baseTokens(term);
      if (!canon.length || !hasPhrase(ref, canon)) return;
      (lexicon[term] || []).forEach(function (v) { var a = baseTokens(v); if (a.length && a.join(' ') !== canon.join(' ')) lex.push({ from: a, to: canon }); });
    });
    lex.sort(function (a, b) { return b.from.length - a.from.length; });
    var vocab = {}; ref.forEach(function (t) { vocab[t] = 1; });
    return { en: en, tokens: ref, lex: lex, vocab: vocab };
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
    t = out; out = [];
    // "type script" → "typescript" when the reference has the joined word; stutters "i i" → "i"
    for (i = 0; i < t.length; i++) {
      if (i + 1 < t.length && !R.vocab[t[i]] && R.vocab[t[i] + t[i + 1]]) { out.push(t[i] + t[i + 1]); i++; continue; }
      if (out.length && out[out.length - 1] === t[i] && !hasPhrase(R.tokens, [t[i], t[i]])) continue;
      out.push(t[i]);
    }
    return out;
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

  /* Combines everything into a suggested grade (2 İyi, 1 Zor, 0 Tekrar).
     sig (optional) = { sim: cosine, nli: { fwd: {ent, neu, con}, back: {ent, neu, con} } }  — fwd: reference ⇒ said, back: said ⇒ reference. */
  // Chosen on the 85-case eval set (stable across the grid; see the prototype report).
  var T = { ezberGood: 0.94, ezberOk: 0.7, anlamCon: 0.5, anlamEnt: 0.7, anlamSimGood: 0.8, anlamSimOk: 0.6 };
  function check(line, said, lexicon, sig, opts) {
    opts = opts || {};
    var R = line._prep || prepareRef(line.en, lexicon), hyp = normalizeSaid(said, R);
    var a = align(R.tokens, hyp, R), acc = Math.max(0, 1 - a.err / (a.refW || 1));
    var issues = hardChecks(R, hyp), hard = issues.some(function (x) { return x.hard; });
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
        why.push('nli');
      } else if (useSim) {
        grade = sig.sim >= T.anlamSimGood ? 2 : sig.sim >= T.anlamSimOk ? 1 : 0;
        if (grade === 2 && issues.some(function (x) { return x.kind === 'number-missing'; })) grade = 1;
        why.push('sim');
      } else {
        // rules only: bag-of-content-words coverage (order ignored), function words ignored
        var refC = R.tokens.filter(function (w) { return !FUNC[w]; }), hv = {}; hyp.forEach(function (w) { hv[w] = 1; });
        var cov = refC.length ? refC.filter(function (w) { return hv[w] || hyp.some(function (h) { return tokEq(w, h); }); }).length / refC.length : 1;
        grade = cov >= 0.85 ? 2 : cov >= 0.6 ? 1 : 0; why.push('coverage ' + cov.toFixed(2));
      }
    }
    return { grade: grade, acc: acc, issues: issues, edits: a.edits, said: hyp, ref: R.tokens, con: con, entF: entF, entB: entB, why: why };
  }

  var api = { baseTokens: baseTokens, prepareRef: prepareRef, normalizeSaid: normalizeSaid, align: align, hardChecks: hardChecks, check: check, THRESHOLDS: T, isFunc: function (w) { return !!FUNC[w]; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.verify3 = api;
})(typeof window !== 'undefined' ? window : this);
