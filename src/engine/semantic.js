/* ============================================================================
   ANVESHAN v4 - LAYER 2: SEMANTIC RETRIEVAL
   A compiled distributional embedding model (PPMI -> randomised SVD, built by
   tools/build_model.py) plus a hybrid ranker:

       BM25F (lexical, exact)  +  dense cosine (semantic, fuzzy)
           fused with reciprocal rank fusion, then re-weighted by evidence
           factors the user can see and move.

   The point of the dense half is recall the lexical half cannot reach: a query
   about "money transfer" reaches documents that only ever say "UPI", and a
   Hindi or Sanskrit query reaches English documents through the bundled
   concept lexicon. Unknown words are embedded from character n-grams, so a
   misspelling or an unseen compound still lands near its neighbours.
   ========================================================================== */
(function (root) {
  "use strict";
  var ANV = root.ANV = root.ANV || {};
  var L = ANV.lang;

  var M = null;             // compiled model
  var WV = null;            // Float32Array(vocab*dims)
  var DV = null;            // Float32Array(docs*dims)
  var INDEX_OF = {};        // word -> row
  var DOCV = [];            // per-doc Float32Array
  var CONCEPT = {};         // surface (deva or roman) -> english concept
  var CONCEPT_OUT = {};     // english concept -> {hi:[], sa:[], ro:[]}
  var SKELETON = {};        // consonant skeleton of a roman surface -> concept
  var idfOf = function (w) { return (M && M.idf && M.idf[INDEX_OF[w]] != null) ? M.idf[INDEX_OF[w]] : 1.6; };

  function b64ToBytes(b64) {
    var bin = (typeof atob === "function") ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    var out = new Int8Array(bin.length);
    for (var i = 0; i < bin.length; i++) {
      var c = bin.charCodeAt(i);
      out[i] = c > 127 ? c - 256 : c;
    }
    return out;
  }

  function init(model) {
    M = model;
    var dims = model.dims, V = model.vocab.length;
    WV = new Float32Array(V * dims);
    var q = b64ToBytes(model.wq), sc = model.ws;
    for (var i = 0; i < V; i++) {
      INDEX_OF[model.vocab[i]] = i;
      for (var d = 0; d < dims; d++) WV[i * dims + d] = q[i * dims + d] * sc[d];
    }
    var dq = b64ToBytes(model.dq), ds = model.ds;
    DV = new Float32Array(model.stats.docs * dims);
    for (var j = 0; j < model.stats.docs; j++) {
      for (var e = 0; e < dims; e++) DV[j * dims + e] = dq[j * dims + e] * ds;
    }
    // concept lexicon in both directions. First entry wins, so the more common
    // reading of a shared spelling is the one that is kept.
    (model.lex || []).forEach(function (row) {
      var en = row.en;
      if (!CONCEPT_OUT[en]) CONCEPT_OUT[en] = { hi: row.hi || [], sa: row.sa || [], ro: row.ro || [] };
      var put = function (w) {
        if (!w) return;
        var n = L.normalise(w);
        if (!CONCEPT[w]) CONCEPT[w] = en;
        if (n && !CONCEPT[n]) CONCEPT[n] = en;
      };
      (row.hi || []).forEach(put);
      (row.sa || []).forEach(put);
      (row.ro || []).forEach(function (w) {
        put(w);
        // Hinglish spelling varies wildly (bhugtan / bhugataan / bhugtan);
        // the consonant skeleton is what actually stays stable.
        var sk = skeleton(w);
        if (sk && !SKELETON[sk]) SKELETON[sk] = en;
      });
      CONCEPT[en] = en;
      en.split(/\s+/).forEach(function (w) { if (!CONCEPT[w]) CONCEPT[w] = en; });
    });
    return api;
  }

  function ready() { return !!M; }

  /* ------------------------------------------------------------- vectors --- */
  function vecOf(word) {
    var i = INDEX_OF[word];
    if (i == null) return null;
    var dims = M.dims, v = new Float32Array(dims);
    for (var d = 0; d < dims; d++) v[d] = WV[i * dims + d];
    return v;
  }

  function docVec(i) {
    if (DOCV[i]) return DOCV[i];
    var dims = M.dims, v = new Float32Array(dims);
    for (var d = 0; d < dims; d++) v[d] = DV[i * dims + d];
    DOCV[i] = v;
    return v;
  }

  /* Character n-gram embedding for words the vocabulary never saw. Signed
     hashing into the same space: deterministic, and close to known words that
     share morphology ("digitalise" lands near "digital"). */
  function oovVec(word) {
    var dims = M.dims, v = new Float32Array(dims), w = "$" + word + "$";
    for (var i = 0; i < w.length - 2; i++) {
      var g = w.substr(i, 3), h = 2166136261;
      for (var k = 0; k < g.length; k++) { h ^= g.charCodeAt(k); h = (h * 16777619) >>> 0; }
      var slot = h % dims, sign = ((h >>> 16) & 1) ? 1 : -1;
      v[slot] += sign * 0.6;
    }
    // a near neighbour in the vocabulary is a better anchor than raw hashing
    var near = nearestWord(word, 0.66);
    if (near) {
      var nv = vecOf(near);
      for (var d = 0; d < dims; d++) v[d] = v[d] * 0.35 + nv[d] * 0.85;
    }
    return v;
  }

  function nearestWord(word, floor) {
    var best = null, bestSim = floor || 0;
    var vocab = M.vocab;
    for (var i = 0; i < vocab.length; i++) {
      var c = vocab[i];
      if (Math.abs(c.length - word.length) > 3) continue;
      var sim = tri(word, c);
      if (sim > bestSim) { bestSim = sim; best = c; }
    }
    return best;
  }

  function tri(a, b) {
    var g = {}, hit = 0, n = 0;
    for (var i = 0; i < a.length - 2; i++) { g[a.substr(i, 3)] = 1; n++; }
    for (var j = 0; j < b.length - 2; j++) if (g[b.substr(j, 3)]) hit++;
    return hit / Math.max(1, Math.min(n, Math.max(1, b.length - 2)));
  }

  function dot(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }
  function unit(v) {
    var s = 0, i;
    for (i = 0; i < v.length; i++) s += v[i] * v[i];
    s = Math.sqrt(s);
    if (!s) return v;
    for (i = 0; i < v.length; i++) v[i] /= s;
    return v;
  }

  /* ------------------------------------------------------- cross-language -- */
  function skeleton(w) {
    return String(w).toLowerCase()
      .replace(/aa/g, "a").replace(/ee/g, "i").replace(/oo/g, "u").replace(/ai/g, "e").replace(/au/g, "o")
      .replace(/[^a-z]/g, "").replace(/[aeiou]/g, "");
  }

  /**
   * Resolve a surface token to the English concept it denotes, when the
   * bundled lexicon knows it. Handles Devanagari, IAST-ish roman and common
   * Hinglish spellings. Returns null when there is no defensible mapping.
   */
  function conceptOf(token) {
    if (!token) return null;
    if (CONCEPT[token]) return CONCEPT[token];
    var norm = L.normalise(token);
    if (CONCEPT[norm]) return CONCEPT[norm];
    if (L.scriptOf(token) === "deva") {
      var rom = L.devaToLatin(token);
      if (CONCEPT[rom]) return CONCEPT[rom];
      var collapsed = rom.replace(/aa/g, "a").replace(/ee/g, "i").replace(/oo/g, "u");
      if (CONCEPT[collapsed]) return CONCEPT[collapsed];
      if (skeleton(rom).length >= 2 && SKELETON[skeleton(rom)]) return SKELETON[skeleton(rom)];
    } else {
      var sk = skeleton(norm);
      if (sk.length >= 2 && SKELETON[sk]) return SKELETON[sk];
    }
    // a Sanskrit compound that the dictionary can split
    if (L.scriptOf(token) === "deva" && M && M.senses) {
      var dict = {};
      Object.keys(INDEX_OF).forEach(function (w) { dict[w] = 2; });
      Object.keys(CONCEPT).forEach(function (w) { dict[w] = (dict[w] || 0) + 2; });
      var parts = L.sandhiSplit(token, dict);
      for (var i = 0; i < parts.length; i++) {
        var mapped = parts[i].parts.map(function (p) { return conceptOf(p); }).filter(Boolean);
        if (mapped.length) return mapped.join(" ");
      }
    }
    return null;
  }

  /** Translate a concept into Hindi/Sanskrit surfaces for cross-language output. */
  function renderConcept(en, target) {
    var row = CONCEPT_OUT[en];
    if (!row) return null;
    if (target === "hi") return (row.hi || [])[0] || null;
    if (target === "sa") return (row.sa || [])[0] || null;
    return (row.ro || [])[0] || null;
  }

  /* ------------------------------------------------------------ embedding -- */
  /**
   * Embed a query or passage. Each term is idf-weighted; Hindi/Sanskrit terms
   * contribute both their own distributional vector and the vector of the
   * English concept they map to, which is what makes cross-language retrieval
   * work without a translation model.
   */
  function embed(text, opts) {
    opts = opts || {};
    if (!M) return new Float32Array(1);
    var dims = M.dims, v = new Float32Array(dims);
    var raws = L.tokeniseRaw(text).filter(function (w) { return !L.STOP_ALL[w]; });
    if (!raws.length) raws = L.tokeniseRaw(text);
    var toks = [], used = 0, mapped = [];
    for (var i = 0; i < raws.length; i++) {
      var raw = raws[i], t = L.stem(raw);
      toks.push(t);
      var w = idfOf(t);
      var tv = vecOf(t);
      if (!tv) {
        // the concept lexicon is keyed on the surface form, not the stem
        // ("itihas" stems to "itiha"), so try the raw token first
        var c = conceptOf(raw) || conceptOf(t);
        if (c) {
          var cv = vecOf(c.split(" ")[0]);
          if (cv) { tv = cv; mapped.push({ from: raw, to: c }); }
        }
      }
      if (!tv) tv = oovVec(t);
      for (var d = 0; d < dims; d++) v[d] += tv[d] * w;
      used++;
    }
    if (opts.expand !== false) {
      // concept expansion: pull in distributional neighbours of the query terms
      var exp = expand(toks, 0.30);
      for (var e = 0; e < exp.length; e++) {
        var ev = vecOf(exp[e].term);
        if (!ev) continue;
        for (var d2 = 0; d2 < dims; d2++) v[d2] += ev[d2] * exp[e].weight;
      }
    }
    unit(v);
    v.__mapped = mapped;
    v.__used = used;
    return v;
  }

  /** Distributional neighbours of the query terms, with a weight per term. */
  function expand(tokens, baseWeight) {
    var out = [], seen = {};
    var nn = (M && M.nn) || [];
    for (var i = 0; i < tokens.length; i++) {
      var row = INDEX_OF[tokens[i]];
      if (row == null) continue;
      var list = nn[row] || [];
      for (var j = 0; j < Math.min(8, list.length); j++) {
        var w = list[j];
        if (!w || seen[w] || tokens.indexOf(w) >= 0) continue;
        seen[w] = 1;
        out.push({ term: w, weight: baseWeight * (1 - j / 10), source: tokens[i] });
      }
    }
    return out;
  }

  /* -------------------------------------------------------------- ranking -- */
  function denseScores(queryVec, docs) {
    var out = [];
    for (var i = 0; i < docs.length; i++) {
      var s = dot(queryVec, docVec(i));
      out.push({ i: i, s: s });
    }
    out.sort(function (a, b) { return b.s - a.s; });
    return out;
  }

  function rrf(rank) { return 1 / (60 + rank); }

  /**
   * Hybrid retrieval. `legacy` is the v3 lexical scorer, kept because a
   * hand-tuned BM25F with field boosts still beats a fused score on exact
   * identifiers like "Aadhaar" or "PRID".
   */
  function hybrid(index, query, opts, legacy) {
    opts = opts || {};
    var t0 = (root.performance && performance.now) ? performance.now() : Date.now();
    var docs = (index && index.docs) || root.DOCS || [];
    var qv = embed(query);
    var lex = [];
    try { lex = legacy ? legacy(index, query, Object.assign({}, opts, { limit: 400 })) : []; } catch (e) { lex = []; }
    var dense = denseScores(qv, docs);

    // reciprocal-rank fusion of the two candidate lists
    var fused = {};
    var rank = 0;
    lex.forEach(function (r) {
      var i = docs.indexOf(r.doc);
      if (i < 0) return;
      fused[i] = fused[i] || { i: i, doc: r.doc, lex: 0, den: 0, lexRank: rank, denRank: 1e9, snippet: r.snippet, bm25: r.bm25, cos: r.cos };
      fused[i].lex = r.score;
      fused[i].lexRank = rank;
      rank++;
    });
    var top = dense.length ? Math.max(dense[0].s, 1e-6) : 1;
    var dRank = 0;
    for (var d = 0; d < dense.length; d++) {
      if (dense[d].s <= 0.02 * top) break;
      var rec = fused[dense[d].i];
      if (!rec) {
        rec = fused[dense[d].i] = { i: dense[d].i, doc: docs[dense[d].i], lex: 0, den: 0, lexRank: 1e9, denRank: dRank, snippet: null };
      }
      rec.den = dense[d].s;
      rec.denRank = dRank;
      dRank++;
    }

    var W = opts.w || {};
    var wLex = (W.lex != null ? W.lex : 0.55), wSem = (W.sem != null ? W.sem : 0.35), wAuth = (W.auth != null ? W.auth : 0.10);

    // Rare-term protection. A query that names something specific ("Chandrayaan",
    // "38,231 GPUs") must not be swamped by a broad semantic neighbourhood, so
    // the two signals are normalised against their own best result and an exact
    // hit on a low-frequency term is added back explicitly.
    var maxLex = 0, maxDen = 0;
    for (var k1 in fused) { if (fused[k1].lex > maxLex) maxLex = fused[k1].lex; if (fused[k1].den > maxDen) maxDen = fused[k1].den; }
    var rare = [];
    var df = (index && index.df) || {};
    L.tokeniseRaw(query).forEach(function (w) {
      if (L.STOP_ALL[w]) return;
      var d = df[L.stem(w)];
      if (d != null && d <= 4) rare.push(w);
    });

    var out = [];
    for (var key in fused) {
      var f = fused[key];
      var lexNorm = maxLex ? f.lex / maxLex : 0;
      var semNorm = maxDen ? f.den / maxDen : 0;
      var fusion = rrf(f.lexRank) + rrf(f.denRank);
      var auth = (typeof root.authOf === "function") ? root.authOf(f.doc) : ((f.doc.a || 3) / 5);
      var exact = 0;
      if (rare.length) {
        var hay = L.normalise((f.doc.t || "") + " " + (f.doc.b || "") + " " + ((f.doc.k || []).join(" ")));
        for (var rq = 0; rq < rare.length; rq++) if (hay.indexOf(rare[rq]) >= 0) exact += 0.30;
        if (exact > 0.6) exact = 0.6;
      }
      var score = (wLex * lexNorm + wSem * semNorm) + wAuth * auth * 0.5 + fusion * 0.25 + exact;
      out.push({
        doc: f.doc, score: score, bm25: f.lex, cos: f.den,
        lexRank: f.lexRank, denRank: f.denRank,
        why: { lexical: +lexNorm.toFixed(3), semantic: +semNorm.toFixed(3), authority: +auth.toFixed(3),
               fusion: +fusion.toFixed(4), exact: +exact.toFixed(2) },
        snippet: f.snippet
      });
    }

    // hard filters the lexical layer may not have applied to dense candidates
    if (opts.type && opts.type !== "all") out = out.filter(function (r) { return r.doc.ty === opts.type; });
    if (opts.org && opts.org !== "all") out = out.filter(function (r) { return (r.doc.o || "").toLowerCase() === String(opts.org).toLowerCase(); });
    if (opts.lang && opts.lang !== "all") out = out.filter(function (r) { return (r.doc.l || "en") === opts.lang; });
    if (opts.from) out = out.filter(function (r) { return (r.doc.d || "") >= opts.from; });
    if (opts.to) out = out.filter(function (r) { return (r.doc.d || "") <= opts.to; });

    out.sort(function (a, b) { return b.score - a.score; });
    if (out.length) {
      var best = out[0].score;
      out = out.filter(function (r) { return r.score >= best * (opts.floor != null ? opts.floor : 0.12); });
    }
    var limit = opts.limit || 50;
    out = out.slice(0, limit);
    out.forEach(function (r) {
      if (!r.snippet) {
        r.snippet = (typeof root.makeSnippet === "function")
          ? root.makeSnippet(r.doc.b, L.tokenise(query, { keepStop: true, noStem: true }))
          : String(r.doc.b || "").slice(0, 280);
      }
      r.confidence = Math.max(0.18, Math.min(0.99, 1 - Math.exp(-r.score * 1.8)));
    });
    var t1 = (root.performance && performance.now) ? performance.now() : Date.now();
    lastRun = { ms: +(t1 - t0).toFixed(2), lex: lex.length, dense: dRank, fused: out.length, terms: qv.__used || 0 };
    return out;
  }

  var lastRun = null;

  /** Pure concept search: ignore exact wording entirely. */
  function conceptSearch(index, query, opts) {
    opts = opts || {};
    var docs = (index && index.docs) || root.DOCS || [];
    var qv = embed(query, { expand: true });
    var d = denseScores(qv, docs).slice(0, opts.limit || 20);
    return d.filter(function (r) { return r.s > 0.15; }).map(function (r) {
      return { doc: docs[r.i], score: r.s, cos: r.s, bm25: 0, confidence: Math.min(0.95, r.s * 1.4),
               why: { semantic: +r.s.toFixed(3) } };
    });
  }

  /** How much of the query the corpus can actually say something about. */
  function coverage(query) {
    var raws = L.tokeniseRaw(query).filter(function (w) { return !L.STOP_ALL[w]; });
    var toks = raws.map(function (w) { return L.stem(w); });
    var known = 0, unknown = [], weak = [];
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (INDEX_OF[t] != null || conceptOf(raws[i]) || conceptOf(t)) { known++; continue; }
      // a word the vocabulary never saw can still be covered when it is a
      // morphological neighbour of one it did (subsidy / subsidised)
      var near = nearestWord(t, 0.72);
      if (near) { known++; weak.push({ term: t, near: near }); }
      else unknown.push(t);
    }
    return { terms: toks.length, known: known, unknown: unknown, weak: weak,
             ratio: toks.length ? known / toks.length : 0 };
  }

  function senses(word) {
    if (!M || !M.senses) return null;
    var w = L.stem(word);
    return M.senses[w] || M.senses[word] || null;
  }

  function neighbours(word, k) {
    if (!M) return [];
    var row = INDEX_OF[L.stem(word)] != null ? INDEX_OF[L.stem(word)] : INDEX_OF[word];
    if (row == null) return [];
    return (M.nn[row] || []).slice(0, k || 10);
  }

  var api = {
    init: init, ready: ready, embed: embed, vecOf: vecOf, dot: dot, unit: unit,
    conceptOf: conceptOf, renderConcept: renderConcept, expand: expand,
    hybrid: hybrid, conceptSearch: conceptSearch, coverage: coverage,
    senses: senses, neighbours: neighbours, docVec: docVec,
    stats: function () { return M ? M.stats : null; },
    lastRun: function () { return lastRun; },
    vocab: function () { return M ? M.vocab : []; },
    model: function () { return M; }
  };
  ANV.semantic = api;

  // auto-init when the compiled model is already on the page
  if (root.ANV_MODEL) init(root.ANV_MODEL);

  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
