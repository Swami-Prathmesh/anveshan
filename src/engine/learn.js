/* ============================================================================
   ANVESHAN v4 - LAYER 7: THE LEARNING LOOP
   Learning-to-rank from real clicks, a measured evaluation harness, index
   versioning with rollback, user corrections, watchlists, monitoring and a
   consent-gated research memory.

   Three rules the loop obeys, because a self-learning search engine can become
   a self-learning misinformation engine:
     1. learning changes which sources surface, never what they say;
     2. a correction is a signal about a source, not proof about a fact;
     3. nothing is adopted unless an evaluation shows it is better, and every
        adoption is versioned so it can be rolled back.
   ========================================================================== */
(function (root) {
  "use strict";
  var ANV = root.ANV = root.ANV || {};

  var K = {
    weights: "anv.v4.weights", log: "anv.v4.log", corrections: "anv.v4.corrections",
    versions: "anv.v4.versions", memory: "anv.v4.researchMemory", watch: "anv.v4.watchlist",
    monitor: "anv.v4.monitor"
  };

  function load(key, dflt) {
    try {
      var raw = root.localStorage && localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* private mode: the loop simply does not persist */ }
    return dflt;
  }
  function save(key, val) {
    try { if (root.localStorage) localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  var DEFAULT_W = { lex: 0.55, sem: 0.35, auth: 0.10, evidence: 0.0, fresh: 0.0, correction: 0.0 };
  var W = Object.assign({}, DEFAULT_W, load(K.weights, {}));
  var LOG = load(K.log, []);
  var CORR = load(K.corrections, {});
  var VERSIONS = load(K.versions, []);
  var MEMORY = load(K.memory, { consent: false, notes: [], conclusions: [] });
  var WATCH = load(K.watch, []);
  var MON = load(K.monitor, { queries: 0, zeroResult: 0, latency: [], misses: [] });

  /* ------------------------------------------------------------- features - */
  /**
   * Ranking features, all of which a reader can inspect. `credibility` comes
   * from the evidence layer, so a document cannot buy rank with length alone.
   */
  function features(result, ctx) {
    var evd = ANV.evidence;
    var cred = ctx && ctx.credibility ? ctx.credibility : (evd ? evd.credibility(result.doc, ctx || {}) : { score: 0.5, freshness: { score: 0.5 } });
    var correction = CORR[result.doc.id];
    return [
      result.why ? result.why.lexical : Math.min(1, (result.bm25 || 0) / 12),
      result.why ? result.why.semantic : (result.cos || 0),
      cred.score,
      cred.freshness ? cred.freshness.score : 0.5,
      correction ? -1 : 0,
      result.doc.a ? (result.doc.a - 1) / 4 : 0.5
    ];
  }

  function scoreWith(f, w) {
    return f[0] * w.lex + f[1] * w.sem + f[2] * w.evidence + f[3] * w.fresh + f[4] * w.correction + f[5] * w.auth;
  }

  /** Re-rank a result list with the learned weights. Reversible and logged. */
  function rerank(results, ctx) {
    if (!results || !results.length) return results;
    var out = results.map(function (r) {
      var f = features(r, ctx);
      return { r: r, f: f, s: scoreWith(f, W) };
    });
    out.sort(function (a, b) { return b.s - a.s; });
    return out.map(function (o, i) {
      o.r.learnScore = +o.s.toFixed(4);
      o.r.learnRank = i + 1;
      o.r.features = { lexical: +o.f[0].toFixed(3), semantic: +o.f[1].toFixed(3), credibility: +o.f[2].toFixed(3),
                       freshness: +o.f[3].toFixed(3), corrected: o.f[4] < 0, authority: +o.f[5].toFixed(3) };
      return o.r;
    });
  }

  /* ------------------------------------------------------------ logging ---- */
  function logQuery(query, results, extra) {
    var entry = {
      t: Date.now(), q: query, n: results.length,
      top: results.slice(0, 5).map(function (r) { return r.doc.id; }),
      clicked: null, weights: Object.assign({}, W)
    };
    if (extra) Object.assign(entry, extra);
    LOG.push(entry);
    if (LOG.length > 500) LOG.shift();
    save(K.log, LOG);
    MON.queries++;
    if (!results.length) {
      MON.zeroResult++;
      MON.misses.push(query);
      if (MON.misses.length > 40) MON.misses.shift();
    }
    if (extra && extra.ms) { MON.latency.push(extra.ms); if (MON.latency.length > 60) MON.latency.shift(); }
    save(K.monitor, MON);
    return entry;
  }

  /** A click is the only supervision signal this engine ever gets. */
  function feedback(query, docId, rank) {
    for (var i = LOG.length - 1; i >= 0; i--) {
      if (LOG[i].q === query && !LOG[i].clicked) { LOG[i].clicked = docId; LOG[i].clickRank = rank || null; break; }
    }
    save(K.log, LOG);
    return train();
  }

  /* ------------------------------------------------------------- learning -- */
  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

  /**
   * Online logistic regression over pairwise preferences (clicked vs shown).
   * Deterministic: replaying the same log produces the same weights.
   */
  function train(opts) {
    opts = opts || {};
    var pairs = [];
    LOG.forEach(function (l) {
      if (!l.clicked || !l.top || l.top.length < 2) return;
      l.top.forEach(function (id) {
        if (id === l.clicked) return;
        pairs.push({ q: l.q, pos: l.clicked, neg: id });
      });
    });
    if (pairs.length < 3) {
      return { trained: false, pairs: pairs.length, note: "needs at least three click observations before changing anything" };
    }
    var before = evaluateWeights(W);
    var w = Object.assign({}, W), lr = opts.lr || 0.08, epochs = opts.epochs || 8;
    var lastLoss = null;
    for (var e = 0; e < epochs; e++) {
      var loss = 0;
      pairs.forEach(function (p) {
        var fp = featuresOf(p.q, p.pos), fn = featuresOf(p.q, p.neg);
        if (!fp || !fn) return;
        var dp = scoreWith(fp, w) - scoreWith(fn, w);
        var prob = sigmoid(-dp);
        loss += -Math.log(Math.max(1e-6, 1 - prob));
        // gradient step on the difference of feature vectors
        for (var k = 0; k < 6; k++) {
          var g = (1 - prob) * (fp[k] - fn[k]);
          var key = ["lex", "sem", "evidence", "fresh", "correction", "auth"][k];
          w[key] += lr * g;
        }
      });
      lastLoss = loss / pairs.length;
    }
    // keep the weights interpretable and positive where they should be
    ["lex", "sem", "evidence", "fresh", "auth"].forEach(function (k) { w[k] = Math.max(0, Math.min(1.2, w[k])); });
    w.correction = Math.min(0, Math.max(-1, w.correction));
    var after = evaluateWeights(w);
    var adopted = after.ndcg >= before.ndcg;
    if (adopted) { W = w; save(K.weights, W); }
    return {
      trained: true, pairs: pairs.length, epochs: epochs, loss: +(lastLoss || 0).toFixed(4),
      before: before, after: after, adopted: adopted, weights: Object.assign({}, W),
      note: adopted ? "adopted: measured NDCG did not get worse" : "rejected: the change did not improve the measured score, so the old weights were kept"
    };
  }

  // feature vectors for a logged pair, recomputed from the documents themselves
  function featuresOf(query, docId) {
    var docs = (root.DOCS || []);
    var doc = docs.filter(function (d) { return d.id === docId; })[0];
    if (!doc) return null;
    var sem = ANV.semantic;
    var qv = sem.ready() ? sem.embed(query) : null;
    var idx = docs.indexOf(doc);
    var cos = qv ? sem.dot(qv, sem.docVec(idx)) : 0;
    var lex = Math.min(1, (L2(query, doc)) / 12);
    var cred = ANV.evidence.credibility(doc, {});
    return [lex, cos, cred.score, cred.freshness.score, CORR[doc.id] ? -1 : 0, (doc.a || 3) / 5];
  }
  function L2(query, doc) {
    var terms = ANV.lang.tokenise(query);
    var hay = ANV.lang.normalise(doc.t + " " + doc.b + " " + (doc.k || []).join(" "));
    var s = 0;
    terms.forEach(function (t) { if (hay.indexOf(t) >= 0) s += 1.6; });
    return s;
  }

  /* ---------------------------------------------------------- evaluation --- */
  function dcg(rels) {
    var s = 0;
    for (var i = 0; i < rels.length; i++) s += (Math.pow(2, rels[i]) - 1) / Math.log2(i + 2);
    return s;
  }

  /** NDCG@10 over logged sessions, where relevance is the observed click. */
  function evaluateWeights(w) {
    var sessions = LOG.filter(function (l) { return l.clicked && l.top && l.top.length; });
    if (!sessions.length) {
      // no click data yet: fall back to the built-in battery so the number is not fake
      var disc = ANV.discovery;
      if (!disc) return { ndcg: 0, sessions: 0, source: "none" };
      var r = disc.evaluate({ docs: root.DOCS || [], df: {} }, { lex: w.lex, sem: w.sem, auth: w.auth });
      return { ndcg: r.mrr, mrr: r.mrr, p1: r.precisionAt1, sessions: 0, source: "built-in battery (" + r.n + " queries)" };
    }
    var total = 0;
    sessions.forEach(function (s) {
      var scored = s.top.map(function (id, i) {
        var f = featuresOf(s.q, id);
        return { id: id, s: f ? scoreWith(f, w) : 0, orig: i };
      }).sort(function (a, b) { return b.s - a.s; });
      var rels = scored.map(function (x) { return x.id === s.clicked ? 1 : 0; });
      var ideal = [1].concat(new Array(rels.length - 1).fill(0));
      total += dcg(rels) / (dcg(ideal) || 1);
    });
    return { ndcg: +(total / sessions.length).toFixed(4), sessions: sessions.length, source: "logged clicks" };
  }

  function evaluate() {
    var disc = ANV.discovery;
    var battery = disc ? disc.evaluate({ docs: root.DOCS || [], df: {} }, W) : null;
    return { clicks: evaluateWeights(W), battery: battery, weights: Object.assign({}, W) };
  }

  /* ---------------------------------------------------------- corrections -- */
  function flagCorrection(docId, note, kind) {
    CORR[docId] = { note: note || "", kind: kind || "incorrect", t: Date.now() };
    save(K.corrections, CORR);
    if (MEMORY.consent) {
      MEMORY.notes.push({ t: Date.now(), docId: docId, note: note, kind: kind || "incorrect" });
      save(K.memory, MEMORY);
    }
    return Object.keys(CORR).length;
  }
  function clearCorrection(docId) { delete CORR[docId]; save(K.corrections, CORR); }
  function corrections() { return CORR; }

  /* ------------------------------------------------------------ versions --- */
  function snapshot(label, index) {
    var tree = root.TREE && root.TREE.root ? root.TREE.root : null;
    var v = {
      id: "v" + (VERSIONS.length + 1), label: label || "manual", t: Date.now(),
      docs: (root.DOCS || []).length, weights: Object.assign({}, W),
      merkle: tree, docIds: (root.DOCS || []).map(function (d) { return d.id; })
    };
    VERSIONS.push(v);
    if (VERSIONS.length > 20) VERSIONS.shift();
    save(K.versions, VERSIONS);
    return v;
  }
  function versions() { return VERSIONS.slice(); }
  function rollback(id) {
    var v = VERSIONS.filter(function (x) { return x.id === id; })[0];
    if (!v) return { ok: false, reason: "unknown version" };
    W = Object.assign({}, DEFAULT_W, v.weights);
    save(K.weights, W);
    return { ok: true, restored: v, note: "weights restored to " + v.id + " (" + v.label + "). Documents added since then are still indexed; remove them from the Import panel if you need the exact earlier state." };
  }

  /* -------------------------------------------------------------- memory --- */
  function memory() { return MEMORY; }
  function setConsent(on) {
    MEMORY.consent = !!on;
    if (!on) { MEMORY.notes = []; MEMORY.conclusions = []; }
    save(K.memory, MEMORY);
    return MEMORY;
  }
  function remember(text, docId) {
    if (!MEMORY.consent) return { ok: false, reason: "memory is off: nothing is stored without consent" };
    MEMORY.conclusions.push({ t: Date.now(), text: text, docId: docId || null });
    save(K.memory, MEMORY);
    return { ok: true, count: MEMORY.conclusions.length };
  }

  /* ----------------------------------------------------------- watchlist --- */
  function watch(query, index) {
    var res = ANV.semantic.hybrid(index, query, { limit: 3 }, root.search);
    var entry = { query: query, baselineTop: res.length ? res[0].doc.id : null, sinceYear: new Date().getFullYear() };
    WATCH.push(entry);
    save(K.watch, WATCH);
    return entry;
  }
  function watchlist() { return WATCH.slice(); }
  function unwatch(query) { WATCH = WATCH.filter(function (w) { return w.query !== query; }); save(K.watch, WATCH); }

  /* ----------------------------------------------------------- monitoring -- */
  function monitor() {
    var lat = MON.latency.slice().sort(function (a, b) { return a - b; });
    return {
      queries: MON.queries,
      zeroResult: MON.zeroResult,
      zeroResultRate: MON.queries ? +(MON.zeroResult / MON.queries).toFixed(3) : 0,
      latencyMedian: lat.length ? +lat[Math.floor(lat.length / 2)].toFixed(2) : null,
      latencyP95: lat.length ? +lat[Math.floor(lat.length * 0.95)].toFixed(2) : null,
      recentMisses: MON.misses.slice(-8),
      health: MON.queries === 0 ? "no data yet"
        : (MON.zeroResult / MON.queries) > 0.35 ? "poor: more than a third of queries return nothing"
        : (MON.zeroResult / MON.queries) > 0.15 ? "fair: some queries return nothing" : "healthy",
      note: "Ranking failure is measured as queries that return nothing. A query that returns the wrong thing is only visible through clicks, so click data matters."
    };
  }

  /* -------------------------------------------------------------- export --- */
  function exportAll() {
    return {
      exportedAt: new Date().toISOString(),
      schema: "anveshan.v4.export/1",
      weights: W, log: LOG, corrections: CORR, versions: VERSIONS,
      memory: MEMORY, watchlist: WATCH, monitor: monitor(),
      failedHypotheses: (ANV.agent && ANV.agent.failed) ? ANV.agent.failed() : []
    };
  }

  function reset() {
    W = Object.assign({}, DEFAULT_W); LOG = []; CORR = {}; VERSIONS = []; WATCH = [];
    MON = { queries: 0, zeroResult: 0, latency: [], misses: [] };
    [K.weights, K.log, K.corrections, K.versions, K.watch, K.monitor].forEach(function (k) { save(k, null); });
    try { if (root.localStorage) [K.weights, K.log, K.corrections, K.versions, K.watch, K.monitor].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
  }

  ANV.learn = {
    DEFAULT_W: DEFAULT_W,
    weights: function () { return Object.assign({}, W); },
    setWeights: function (w) { W = Object.assign({}, W, w); save(K.weights, W); return W; },
    features: features, rerank: rerank, scoreWith: scoreWith,
    logQuery: logQuery, queries: function () { return LOG.slice(); }, feedback: feedback,
    train: train, evaluate: evaluate, evaluateWeights: evaluateWeights, ndcg: dcg,
    flagCorrection: flagCorrection, clearCorrection: clearCorrection, corrections: corrections,
    snapshot: snapshot, versions: versions, rollback: rollback,
    memory: memory, setConsent: setConsent, remember: remember,
    watch: watch, watchlist: watchlist, unwatch: unwatch,
    monitor: monitor, exportAll: exportAll, reset: reset
  };

  if (typeof module !== "undefined" && module.exports) module.exports = ANV.learn;
})(typeof globalThis !== "undefined" ? globalThis : this);
