/* ============================================================================
   ANVESHAN v6 - LAYER 12: THE CENTRAL INDEX (client-side retrieval)
   A real, prebuilt inverted index with no server behind it.

   The crawler (crawler/, run by GitHub Actions on a schedule) splits its index
   into 64 term shards and 16 document shards and commits them to this
   repository. A browser fetches only the shards its query terms live in - two or
   three small files - scores them with BM25, then fetches one document shard for
   the winners and reranks with a semantic space built on the spot.

   The consequence is that the query cost is proportional to the query, not to
   the corpus, and the corpus can grow to tens of thousands of documents while
   staying a set of static files in git.
   ========================================================================== */
(function (root) {
  "use strict";
  var ANV = root.ANV = root.ANV || {};
  var L = ANV.lang;

  var TERM_SHARDS = 64, DOC_SHARDS = 16;
  var BASE = "index/";
  var manifest = null, manifestAt = 0;
  var shardCache = {}, docCache = {};
  var stats = { fetches: 0, bytes: 0, shards: 0, docShards: 0, cacheHits: 0 };

  /* The crawler computes these ids with the same FNV-1a; a mismatch would make
     the browser fetch files that do not contain its terms, so they are mirrored
     here character for character. */
  function fnv1a32(text) {
    var h = 0x811C9DC5;
    var bytes = utf8Bytes(String(text));
    for (var i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  function utf8Bytes(s) {
    if (typeof TextEncoder === "function") return new TextEncoder().encode(s);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }
  function shardOf(term) { return fnv1a32(term) % TERM_SHARDS; }
  function docShard(id) { return id % DOC_SHARDS; }

  /* ---------------------------------------------------------------- loading */
  async function getJSON(url, kind) {
    var cached = kind === "t" ? shardCache[url] : docCache[url];
    if (cached) { stats.cacheHits++; return cached; }
    stats.fetches++;
    var res = await root.fetch(url, { credentials: "omit", mode: "cors" });
    if (!res.ok) throw new Error(url + " -> HTTP " + res.status);
    var text = await res.text();
    stats.bytes += text.length;
    var data = JSON.parse(text);
    if (kind === "t") { shardCache[url] = data; stats.shards++; }
    else { docCache[url] = data; stats.docShards++; }
    return data;
  }

  async function load(base) {
    if (base) BASE = base.replace(/\/?$/, "/");
    if (manifest && Date.now() - manifestAt < 5 * 60 * 1000) return manifest;
    var url = BASE + "manifest.json";
    try {
      var res = await root.fetch(url, { credentials: "omit", mode: "cors", cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      manifest = await res.json();
      manifestAt = Date.now();
      TERM_SHARDS = manifest.termShards || 64;
      DOC_SHARDS = manifest.docShards || 16;
      return manifest;
    } catch (e) {
      manifest = null;
      throw new Error("no central index at " + url + " (" + (e.message || "unavailable") + ")");
    }
  }

  function available() { return !!manifest && manifest.docs > 0; }
  function info() {
    if (!manifest) return null;
    return {
      docs: manifest.docs, terms: manifest.terms, builtAt: manifest.builtAt,
      bytes: manifest.indexBytes || 0, sources: manifest.sources || {},
      runs: manifest.runs || [], avgdl: manifest.avgdl || 1
    };
  }

  /* --------------------------------------------------------------- retrieval */
  /**
   * Two-phase ranking. Phase one scores postings with a length-free BM25 variant
   * (document lengths live in the document shards, which are not fetched yet).
   * Phase two refetches the survivors with their real lengths and metadata, so
   * the final score is the exact BM25F plus authority, recency and semantics.
   */
  async function search(query, opts) {
    opts = opts || {};
    var t0 = (root.performance && performance.now) ? performance.now() : Date.now();
    if (!manifest) await load(opts.base);
    if (!manifest || !manifest.docs) return { results: [], meta: { empty: true } };

    var terms = uniq(L.tokenise(query, { keepStop: false }));
    if (!terms.length) terms = uniq(L.tokenise(query, { keepStop: true, noStem: true }));
    if (!terms.length) return { results: [], meta: { empty: true, reason: "no usable terms" } };

    var shards = uniq(terms.map(shardOf));
    var fetched = {};
    await Promise.all(shards.map(async function (s) {
      try { fetched[s] = await getJSON(BASE + "t/" + s + ".json", "t"); }
      catch (e) { fetched[s] = {}; }
    }));

    var N = manifest.docs;
    var scores = {};
    var matchedTerms = {};
    terms.forEach(function (term) {
      var shard = fetched[shardOf(term)] || {};
      var postings = shard[term];
      if (!postings || !postings.length) return;
      var df = postings.length;
      var idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (var i = 0; i < postings.length; i++) {
        var p = postings[i], docId = p[0], tf = p[1], titleHits = p[2] || 0;
        // length-free first pass: enough to find the right candidates cheaply
        var s = idf * (tf / (tf + 1.2)) * (1 + 0.9 * Math.min(2, titleHits));
        scores[docId] = (scores[docId] || 0) + s;
        (matchedTerms[docId] = matchedTerms[docId] || []).push(term);
      }
    });

    var ranked = Object.keys(scores).map(function (id) { return { id: +id, pre: scores[id] }; })
      .sort(function (a, b) { return b.pre - a.pre; })
      .slice(0, opts.candidates || 160);
    if (!ranked.length) {
      return { results: [], meta: { terms: terms, shards: shards.length, docs: 0, ms: elapsed(t0) } };
    }

    // phase two: fetch the document shards that hold the survivors
    var byShard = {};
    ranked.forEach(function (r) { (byShard[docShard(r.id)] = byShard[docShard(r.id)] || []).push(r.id); });
    var stores = {};
    await Promise.all(Object.keys(byShard).map(async function (s) {
      try { stores[s] = await getJSON(BASE + "d/" + s + ".json", "d"); }
      catch (e) { stores[s] = {}; }
    }));

    var k1 = 1.4, b = 0.72;
    var avgdl = manifest.avgdl || 120;
    var docs = [], maxYear = new Date().getFullYear();
    ranked.forEach(function (r) {
      var row = (stores[docShard(r.id)] || {})[String(r.id)];
      if (!row) return;
      var dl = row[8] || avgdl;
      var tfSum = 0;
      (matchedTerms[r.id] || []).forEach(function (term) {
        var shard = fetched[shardOf(term)] || {};
        var postings = shard[term] || [];
        for (var i = 0; i < postings.length; i++) {
          if (postings[i][0] === r.id) {
            var tf = postings[i][1], titleHits = postings[i][2] || 0;
            var df = postings.length;
            var idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
            tfSum += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgdl))) * (1 + 0.9 * Math.min(2, titleHits));
            break;
          }
        }
      });
      docs.push({
        id: "ix-" + r.id,
        t: row[1], s: row[2], o: row[3], d: row[4], l: row[5] || "en", ty: row[6] || "webpage",
        a: row[7] || 3, u: row[0], b: row[9] || "", k: (matchedTerms[r.id] || []).slice(0, 6),
        e: [], live: { source: "index", domain: row[10], citedBy: row[11] || 0, docId: r.id },
        bm25: tfSum
      });
    });

    // semantic rerank: an LSA space over the candidates, built on the spot
    var space = null, expanded = [];
    try {
      if (ANV.live && ANV.live.localSpace && docs.length >= 6) {
        space = ANV.live.localSpace(docs);
        if (space) expanded = space.expand(query, 5);
      }
    } catch (e) { space = null; }
    var semScores = {};
    if (space) space.score(query).forEach(function (x) { semScores[docs[x.i].id] = x.s; });

    var maxBm = 0;
    docs.forEach(function (d) { if (d.bm25 > maxBm) maxBm = d.bm25; });
    var results = docs.map(function (d) {
      var lex = maxBm ? d.bm25 / maxBm : 0;
      var sem = semScores[d.id] || 0;
      var auth = (d.a || 3) / 5;
      var year = parseInt(String(d.d || "").slice(0, 4), 10) || 0;
      var rec = year ? Math.max(0, 1 - (maxYear - year) / 25) : 0.35;
      var cited = d.live.citedBy ? Math.min(0.08, Math.log10(1 + d.live.citedBy) / 30) : 0;
      var score = 0.52 * lex + 0.24 * sem + 0.14 * auth + 0.10 * rec + cited;
      return {
        doc: d, score: score, bm25: d.bm25, cos: sem,
        why: { lexical: +lex.toFixed(3), semantic: +sem.toFixed(3), authority: +auth.toFixed(3),
               recency: +rec.toFixed(3), cited: +cited.toFixed(3) },
        confidence: Math.max(0.2, Math.min(0.96, 0.3 + 0.45 * lex + 0.25 * sem))
      };
    });
    results.sort(function (a, b2) { return b2.score - a.score; });
    try {
      results = ANV.learn.rerank(results, {});
      results.forEach(function (r) { if (r.learnScore != null) r.score = r.learnScore; });
    } catch (e) {}
    results.forEach(function (r) {
      r.snippet = r.doc.b ? (r.doc.b.length > 320 ? r.doc.b.slice(0, 300).replace(/\s+\S*$/, "") + "…" : r.doc.b) : r.doc.t;
    });

    return {
      results: results.slice(0, opts.limit || 60),
      space: space, expanded: expanded,
      meta: {
        terms: terms, shards: shards.length, candidates: ranked.length,
        matched: Object.keys(scores).length, ms: elapsed(t0),
        bytes: stats.bytes, corpus: manifest.docs, builtAt: manifest.builtAt
      }
    };
  }

  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (x && !s[x]) { s[x] = 1; o.push(x); } }); return o; }
  function elapsed(t0) {
    var t1 = (root.performance && performance.now) ? performance.now() : Date.now();
    return +(t1 - t0).toFixed(1);
  }

  ANV.central = {
    BASE: BASE, TERM_SHARDS: TERM_SHARDS, DOC_SHARDS: DOC_SHARDS,
    load: load, search: search, available: available, info: info,
    shardOf: shardOf, fnv1a32: fnv1a32,
    stats: function () { return stats; },
    reset: function () { shardCache = {}; docCache = {}; manifest = null; }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = ANV.central;
})(typeof globalThis !== "undefined" ? globalThis : this);
