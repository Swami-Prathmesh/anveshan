/* ============================================================================
   ANVESHAN v4 - LAYER 4: EVIDENCE SCIENCE
   Credibility, primary-source detection, claim decomposition, cross-
   verification, contradiction detection, statistical checking, staleness,
   uncertainty and provenance.

   The governing rule: reliability of a source and truth of a claim are two
   different numbers and are never collapsed into one. A government press
   release is a reliable source for what the government announced; it is not
   evidence that the announcement is true. Every score here is decomposed into
   the factors that produced it, so a reader can disagree with a specific
   factor instead of a black box.
   ========================================================================== */
(function (root) {
  "use strict";
  var ANV = root.ANV = root.ANV || {};
  var L = ANV.lang;

  /* ------------------------------------------------------------ units ------ */
  // Indian and international scales, normalised to a common base so that
  // "10.37 thousand crore" and "Rs 1.03 lakh crore" are comparable.
  var SCALE = {
    "crore": 1e7, "cr": 1e7, "lakh": 1e5, "lakhs": 1e5, "million": 1e6, "mn": 1e6,
    "billion": 1e9, "bn": 1e9, "trillion": 1e12, "thousand": 1e3, "k": 1e3,
    "gw": 1e9, "gigawatt": 1e9, "mw": 1e6, "megawatt": 1e6, "kw": 1e3, "kilowatt": 1e3,
    "watt": 1, "gwpeak": 1e9, "gwh": 1e9, "twh": 1e12, "mwh": 1e6, "kwh": 1e3,
    "km": 1e3, "kilometre": 1e3, "kilometres": 1e3, "metre": 1, "metres": 1,
    "kg": 1e3, "gram": 1, "tonne": 1e6, "tonnes": 1e6, "g": 1,
    "per cent": 1, "percent": 1, "%": 1, "bps": 0.01, "basis points": 0.01,
    "hours": 1, "hour": 1, "hrs": 1, "minutes": 1 / 60, "seconds": 1 / 3600,
    "days": 24, "years": 8760, "months": 730
  };
  var UNIT_FAMILY = {
    "crore": "money", "cr": "money", "lakh": "money", "lakhs": "money", "million": "money",
    "mn": "money", "billion": "money", "bn": "money", "trillion": "money", "thousand": "money",
    "k": "money", "gw": "power", "gigawatt": "power", "mw": "power", "megawatt": "power",
    "kw": "power", "kilowatt": "power", "watt": "power", "gwpeak": "power", "gwh": "energy",
    "twh": "energy", "mwh": "energy", "kwh": "energy", "km": "length", "kilometre": "length",
    "kilometres": "length", "metre": "length", "metres": "length", "kg": "mass",
    "gram": "mass", "tonne": "mass", "tonnes": "mass", "g": "mass", "per cent": "share",
    "percent": "share", "%": "share", "bps": "share", "basis points": "share",
    "hours": "time", "hour": "time", "hrs": "time", "minutes": "time", "seconds": "time",
    "days": "time", "years": "time", "months": "time"
  };

  var NUM_RE = /(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(crore|lakhs?|million|billion|trillion|thousand|bn|mn|cr|gw|gigawatts?|mw|megawatts?|kw|kilowatts?|gwh|twh|mwh|kwh|km|kilometres?|metres?|kg|tonnes?|per cent|percent|%|bps|basis points|hours?|hrs|minutes|seconds|days|years|months)?/gi;

  function parseNumber(s) {
    var n = parseFloat(String(s).replace(/,/g, ""));
    return isNaN(n) ? null : n;
  }

  /** Convert a value+unit to the base of its family (rupees, watts, metres...). */
  function toBase(value, unit) {
    if (value == null) return null;
    var u = String(unit || "").toLowerCase().trim();
    if (!u) return { value: value, family: "count", base: value };
    var scale = SCALE[u];
    if (scale == null) return { value: value, family: UNIT_FAMILY[u] || "other", base: value };
    return { value: value, family: UNIT_FAMILY[u] || "other", base: value * scale };
  }

  function numbersIn(text) {
    var out = [], m;
    NUM_RE.lastIndex = 0;
    while ((m = NUM_RE.exec(String(text))) !== null) {
      var v = parseNumber(m[1]);
      if (v == null) continue;
      var conv = toBase(v, m[2]);
      out.push({ raw: m[0], value: v, unit: (m[2] || "").toLowerCase(), family: conv.family, base: conv.base });
    }
    return out;
  }

  /* ------------------------------------------------- source classification - */
  var PRIMARY_TYPES = { policy: 1, press: 1, dashboard: 1, dataset: 1, api: 1, model: 1, standard: 1, paper: 1 };
  var SECONDARY_TYPES = { report: 1, news: 1, import: 1 };
  var ARCHIVAL_TYPES = { history: 1, culture: 1, geography: 1 };

  var GOV_HOST = /(\.gov\.in|\.gov|\.nic\.in|\.ac\.in|\.edu|\.edu\.in|\.org\.in|\.res\.in|isro\.gov|rbi\.org|niti\.gov)/i;
  var PEER = /\b(journal|doi|arxiv|peer[- ]reviewed|proceedings|preprint|ssrn|nature|science|ieee|acm|springer|elsevier|wiley|plos)\b/i;
  var ARCHIVE = /\b(archive|manuscript|museum|inscription|excavation|colonial record|gazetteer|palm-leaf|palm leaf)\b/i;
  var PROMO = /\b(revolutionary|world[- ]class|unprecedented|game[- ]chang(er|ing)|best[- ]in[- ]class|cutting[- ]edge|leapfrog)\b/i;
  var HEDGE = /\b(may|might|could|would|suggests?|proposes?|hypothesi[sz]|likely|probably|appears? to|seems? to|is expected|is believed|estimate[sd]?|forecast|projection|if |assuming|in theory|potential(ly)?|aims? to|targets?|plans? to)\b/i;
  var EVIDENCE_MARK = /\b(according to|data|survey|report(ed|s)?|census|measured|recorded|found that|figures?|statistics|per cent|percent|audited|trial|study|sample|n\s*=\s*\d+)\b/i;
  var INTERP = /\b(argues|contends|interprets?|means that|implies|therefore|suggests that|indicates that|signals?|reflects?|demonstrates|should be read as)\b/i;
  var SPECULATION = /\b(could become|might one day|some believe|it is said|rumou?r|reportedly|allegedly|if all goes well|in principle)\b/i;
  var CAUSAL = /\b(causes?|caused by|leads? to|led to|results? in|resulted in|drives?|drove|because of|due to|attributable|effect of|enables?|produces?|gives rise to|triggers?)\b/i;
  var NEGATION = /\b(not|no longer|never|failed to|did not|does not|has not|cannot|fails?|without|lacks?)\b/i;
  var TARGET = /\b(target|goal|aim|plan|proposed|expected to reach|by 20\d\d|deadline|committed|pledged)\b/i;

  function classifySource(doc) {
    var ty = doc.ty || "", s = String(doc.s || ""), u = String(doc.u || ""), b = String(doc.b || "");
    var primary = !!PRIMARY_TYPES[ty];
    var peer = ty === "paper" || PEER.test(s + " " + u + " " + b);
    var archival = !!ARCHIVAL_TYPES[ty] || ARCHIVE.test(s + " " + b);
    var kind = primary ? "primary" : (SECONDARY_TYPES[ty] ? "secondary" : archival ? "archival" : "reference");
    return {
      kind: kind, primary: primary, peerReviewed: peer, archival: archival,
      official: GOV_HOST.test(u) || /\b(ministry|government|authority|commission|pib|press information)\b/i.test(s + " " + (doc.o || "")),
      hasUrl: /^https?:\/\//.test(u), dated: /^\d{4}-\d{2}-\d{2}$/.test(String(doc.d || ""))
    };
  }

  /* ------------------------------------------------------- credibility ----- */
  var HALF_LIFE = { // years before a figure of this type should be revalidated
    dashboard: 0.5, press: 1, policy: 3, report: 2, paper: 5, dataset: 1,
    standard: 4, api: 1, model: 2, scheme: 3, science: 6, space: 6, tech: 2,
    health: 3, history: 100, geography: 20, economy: 1, governance: 4,
    culture: 50, import: 2
  };

  function ageYears(doc, now) {
    var d = String(doc.d || "");
    var t = Date.parse(d);
    if (isNaN(t)) return null;
    var n = now ? now.getTime() : Date.now();
    return Math.max(0, (n - t) / (365.25 * 24 * 3600 * 1000));
  }

  function halfLife(doc) { return HALF_LIFE[doc.ty] || 3; }

  function freshness(doc, now) {
    var age = ageYears(doc, now);
    if (age == null) return { age: null, halfLife: halfLife(doc), score: 0.5, stale: null };
    var hl = halfLife(doc);
    var score = Math.pow(0.5, age / hl);
    return {
      age: +age.toFixed(2), halfLife: hl, score: +score.toFixed(3),
      stale: age > hl, needsRevalidation: age > hl * 0.75
    };
  }

  /**
   * Credibility = a weighted, fully itemised set of factors. `independence`
   * is passed in from the query context, because corroboration is a property
   * of the result set, not of one document.
   */
  function credibility(doc, ctx) {
    ctx = ctx || {};
    var src = classifySource(doc);
    var fresh = freshness(doc, ctx.now);
    var body = String(doc.b || "");
    var nums = numbersIn(body).length;
    var words = body.split(/\s+/).length || 1;
    var factors = {
      // does the issuer have standing for this claim?
      authority: { w: 0.22, v: Math.max(0, Math.min(1, ((doc.a || 3) - 1) / 4)),
                   why: "issuer authority " + (doc.a || 3) + "/5" },
      // is this the origin of the claim or a retelling?
      primary: { w: 0.20, v: src.primary ? 1 : src.archival ? 0.6 : 0.35,
                 why: src.kind + " source" },
      // can the reader check it?
      verifiable: { w: 0.16, v: (src.hasUrl ? 0.6 : 0) + (src.dated ? 0.4 : 0),
                    why: (src.hasUrl ? "public URL" : "no URL") + ", " + (src.dated ? "dated" : "undated") },
      // does it show its working?
      evidenced: { w: 0.16, v: Math.min(1, (EVIDENCE_MARK.test(body) ? 0.45 : 0) + Math.min(0.55, (nums / Math.max(8, words / 40)) * 0.55)),
                   why: nums + " figures in " + words + " words" },
      // is it current enough for its own type?
      current: { w: 0.14, v: fresh.score, why: fresh.age == null ? "undated" : fresh.age + "y old, half-life " + fresh.halfLife + "y" },
      // independent corroboration, supplied by the caller
      corroboration: { w: 0.12, v: ctx.independence != null ? ctx.independence : 0.5,
                       why: ctx.independence != null ? (ctx.independentSources || 0) + " independent sources" : "not yet assessed" }
    };
    var score = 0, why = [];
    for (var k in factors) {
      score += factors[k].w * factors[k].v;
      why.push(k + "=" + factors[k].v.toFixed(2));
    }
    // penalties that are not averages: promotion and unsupported certainty
    var penalty = 0;
    if (PROMO.test(body)) penalty += 0.06;
    if (/\b(100%|guaranteed|certain(ly)?|undoubtedly|proves?)\b/i.test(body) && !EVIDENCE_MARK.test(body)) penalty += 0.05;
    return {
      score: +Math.max(0, Math.min(1, score - penalty)).toFixed(3),
      factors: factors, penalty: +penalty.toFixed(3), why: why.join(" "),
      source: src, freshness: fresh,
      label: score > 0.72 ? "strong" : score > 0.55 ? "fair" : score > 0.4 ? "weak" : "poor"
    };
  }

  /* ---------------------------------------------------------- claims ------- */
  function splitSentences(text) { return L.sentenceSplit(text); }

  function kindOf(sentence) {
    if (SPECULATION.test(sentence)) return "speculation";
    if (HEDGE.test(sentence)) return "hypothesis";
    if (INTERP.test(sentence)) return "interpretation";
    if (EVIDENCE_MARK.test(sentence) || numbersIn(sentence).length) return "evidence";
    return "statement";
  }

  /** Subject of a sentence: the noun phrase before the first finite verb. */
  function subjectOf(sentence) {
    var s = String(sentence).replace(/^(the|a|an|in|on|as|by|from|however|but|and)\s+/i, "");
    var m = s.match(/^([\w\u0900-\u097F][^,.;:]{2,60}?)\s+(is|are|was|were|has|have|had|will|can|may|reached|stood|grew|rose|fell|fell|accounts?|represents?|includes?|covers?|runs?|builds?|uses?|causes?|leads?|drives?|enables?|produced?|generated?|reported?|said|announced|launched|plans?|aims?)\b/i);
    return m ? m[1].trim() : s.split(/\s+/).slice(0, 6).join(" ");
  }

  function claimsOf(doc, opts) {
    opts = opts || {};
    var sents = splitSentences(doc.b || "");
    var out = [];
    for (var i = 0; i < sents.length; i++) {
      var s = sents[i];
      if (s.length < 40) continue;
      var nums = numbersIn(s);
      var kind = kindOf(s);
      var causal = CAUSAL.test(s);
      var attr = s.match(/\b(?:according to|as per|reported by|stated by|per)\s+([A-Z][\w&.\- ]{2,40})/);
      var claim = {
        id: (doc.id || "x") + "-c" + i,
        docId: doc.id, title: doc.t, org: doc.o, date: doc.d, year: doc.y, type: doc.ty,
        sentence: s.trim(), kind: kind, causal: causal,
        subject: subjectOf(s),
        numbers: nums,
        attribution: attr ? attr[1].trim() : null,
        negated: NEGATION.test(s),
        target: TARGET.test(s),
        hedged: HEDGE.test(s),
        interpretation: INTERP.test(s),
        confidence: kind === "evidence" ? 0.75 : kind === "statement" ? 0.55 : kind === "interpretation" ? 0.45 : kind === "hypothesis" ? 0.3 : 0.2
      };
      out.push(claim);
    }
    return out;
  }

  function allClaims(index) {
    if (cache.claims && cache.key === (index && index.docs.length)) return cache.claims;
    var docs = (index && index.docs) || [];
    var out = [];
    docs.forEach(function (d) { out.push.apply(out, claimsOf(d)); });
    cache.claims = out; cache.key = docs.length;
    return out;
  }
  var cache = {};

  /* ------------------------------------------------------ verification ---- */
  function keyTerms(text) {
    return L.tokenise(text, { keepStop: false }).filter(function (t) { return t.length > 2; });
  }

  /**
   * Check a claim against the rest of the corpus. Support requires an
   * independent document making the same assertion; a number is only
   * "supported" when a comparable figure appears in the same unit family.
   */
  function verify(claim, index) {
    var docs = (index && index.docs) || [];
    var terms = keyTerms(claim.subject + " " + claim.sentence).slice(0, 10);
    var support = [], contradict = [], related = [];
    docs.forEach(function (d) {
      if (d.id === claim.docId) return;
      var hay = L.normalise(d.t + " " + d.b);
      var hits = 0;
      for (var i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) >= 0) hits++;
      if (hits < Math.max(2, Math.ceil(terms.length * 0.4))) return;
      // compare the numeric content
      if (claim.numbers.length) {
        var fams = {};
        claim.numbers.forEach(function (n) { if (n.family !== "count") fams[n.family] = n.base; });
        var theirs = numbersIn(d.b);
        var compared = false, agrees = null;
        theirs.forEach(function (n) {
          if (fams[n.family] != null) {
            compared = true;
            var ratio = n.base / fams[n.family];
            if (ratio > 0.95 && ratio < 1.05) agrees = (agrees === false) ? false : true;
            else if (ratio > 1.25 || ratio < 0.8) agrees = false;
          }
        });
        if (compared) {
          if (agrees === true) support.push({ id: d.id, org: d.o, date: d.d, basis: "same figure, same unit family" });
          else if (agrees === false) contradict.push({ id: d.id, org: d.o, date: d.d, basis: "different figure for the same quantity" });
          else related.push({ id: d.id, org: d.o, date: d.d });
          return;
        }
      }
      var samePolarity = NEGATION.test(d.b) === claim.negated;
      if (samePolarity) support.push({ id: d.id, org: d.o, date: d.d, basis: "same assertion, no conflicting figure" });
      else contradict.push({ id: d.id, org: d.o, date: d.d, basis: "opposite polarity" });
    });
    var verdict = contradict.length && !support.length ? "contradicted"
      : support.length && contradict.length ? "disputed"
      : support.length ? "supported" : "unverified";
    return {
      claim: claim, verdict: verdict, support: support, contradict: contradict, related: related,
      confidence: +(verdict === "supported" ? Math.min(0.9, 0.45 + support.length * 0.12)
        : verdict === "contradicted" ? Math.min(0.85, 0.4 + contradict.length * 0.12)
        : verdict === "disputed" ? 0.5 : 0.2).toFixed(2)
    };
  }

  /* --------------------------------------------- independence of sources --- */
  var ISSUER_FAMILY = [
    [/\bpib|press information bureau\b/i, "government-press"],
    [/\bmeity|ministry of electronics\b/i, "meity"],
    [/\bniti aayog\b/i, "niti"],
    [/\brbi|reserve bank\b/i, "rbi"],
    [/\bnpci\b/i, "npci"],
    [/\buidai\b/i, "uidai"],
    [/\bisro\b/i, "isro"],
    [/\bwho\b|world health/i, "who"],
    [/\bun\b|united nations/i, "un"],
    [/\bworld bank\b/i, "worldbank"],
    [/\boecd\b/i, "oecd"]
  ];
  function issuerFamily(doc) {
    var s = String((doc && (doc.o || "")) + " " + ((doc && doc.s) || ""));
    for (var i = 0; i < ISSUER_FAMILY.length; i++) if (ISSUER_FAMILY[i][0].test(s)) return ISSUER_FAMILY[i][1];
    return L.normalise(s).split(" ").slice(0, 2).join("-") || "unknown";
  }

  /** Two documents that share an issuer family, or repeat each other's
      wording, are one source wearing two hats. */
  function independence(a, b) {
    var famA = issuerFamily(a), famB = issuerFamily(b);
    var same = famA === famB;
    var sim = textSimilarity(a.b || "", b.b || "");
    var circular = (a.u && b.b && b.b.indexOf(a.u) >= 0) || (b.u && a.b && a.b.indexOf(b.u) >= 0);
    return {
      a: a.id, b: b.id, sameIssuer: same, issuer: famA,
      similarity: +sim.toFixed(3), circularCitation: !!circular,
      independent: !same && sim < 0.45 && !circular,
      reason: same ? "same issuer family (" + famA + ")" : circular ? "one cites the other" : sim >= 0.45 ? "near-duplicate wording" : "independent"
    };
  }

  function textSimilarity(a, b) {
    var A = {}, B = {};
    L.tokenise(a).forEach(function (w) { A[w] = (A[w] || 0) + 1; });
    L.tokenise(b).forEach(function (w) { B[w] = (B[w] || 0) + 1; });
    var dot = 0, na = 0, nb = 0;
    for (var k in A) { na += A[k] * A[k]; if (B[k]) dot += A[k] * B[k]; }
    for (var k2 in B) nb += B[k2] * B[k2];
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  }

  /** Corroboration for a set of documents: how many truly independent voices. */
  function independenceReport(docs) {
    var families = {}, pairs = [];
    docs.forEach(function (d) {
      var f = issuerFamily(d);
      families[f] = (families[f] || 0) + 1;
    });
    for (var i = 0; i < docs.length; i++) {
      for (var j = i + 1; j < docs.length; j++) {
        var r = independence(docs[i], docs[j]);
        if (!r.independent) pairs.push(r);
      }
    }
    var independentCount = Object.keys(families).length;
    return {
      documents: docs.length, families: families, independentSources: independentCount,
      dependencies: pairs.slice(0, 12),
      verdict: independentCount >= 3 ? "corroborated" : independentCount === 2 ? "thin" : "single-source",
      note: independentCount >= 3
        ? independentCount + " independent issuers among " + docs.length + " documents"
        : "only " + independentCount + " independent issuer(s): treat as one account, not a consensus"
    };
  }

  /* ---------------------------------------------------- contradiction ----- */
  function contradictionLab(query, index, opts) {
    opts = opts || {};
    var sem = ANV.semantic;
    var docs = (index && index.docs) || [];
    var hits = sem ? sem.hybrid(index, query, { limit: 12 }, root.search) : [];
    var pool = hits.map(function (h) { return h.doc; });
    var groups = {};
    pool.forEach(function (d) {
      claimsOf(d).forEach(function (c) {
        c.numbers.forEach(function (n) {
          if (n.family === "count") return;
          var key = L.stem(c.subject.split(/\s+/).slice(-2).join(" ")) + "|" + n.family;
          groups[key] = groups[key] || [];
          groups[key].push({ docId: d.id, org: d.o, date: d.d, year: d.y, value: n.base, raw: n.raw, sentence: c.sentence, subject: c.subject });
        });
      });
    });
    var out = [];
    Object.keys(groups).forEach(function (k) {
      var rows = groups[k];
      if (rows.length < 2) return;
      var vals = rows.map(function (r) { return r.value; });
      var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
      if (max / Math.max(1e-9, min) < 1.15) return;           // within noise: agreement
      var years = rows.map(function (r) { return r.year; });
      var sameYear = Math.max.apply(null, years) === Math.min.apply(null, years);
      out.push({
        key: k.replace("|", " · "), kind: sameYear ? "conflict" : "trajectory",
        rows: rows.slice(0, 6), spread: +((max - min) / Math.max(1e-9, min)).toFixed(2),
        note: sameYear
          ? "Two sources give different figures for the same period. One of them is wrong, or they measure different things."
          : "Figures differ across dates: this is a change over time, not a disagreement."
      });
    });
    out.sort(function (a, b) { return (b.kind === "conflict" ? 1 : 0) - (a.kind === "conflict" ? 1 : 0) || b.spread - a.spread; });
    return out.slice(0, opts.limit || 8);
  }

  /* ------------------------------------------------- citation integrity --- */
  /** Does the citing document actually support what it attributes? */
  function citationIntegrity(index) {
    var docs = (index && index.docs) || [];
    var out = [];
    docs.forEach(function (d) {
      var body = String(d.b || "");
      var m = body.match(/\b(?:according to|as per|reported by|stated by|per)\s+([A-Z][\w&.\- ]{2,40})/g);
      if (!m) return;
      m.forEach(function (phrase) {
        var who = phrase.replace(/^.*?\b(according to|as per|reported by|stated by|per)\s+/i, "").trim();
        var known = docs.some(function (o) {
          return o.id !== d.id && L.normalise(o.o + " " + o.s).indexOf(L.normalise(who)) >= 0;
        });
        if (!known) out.push({ docId: d.id, org: d.o, attributed: who, status: "unmatched",
          note: "attributes a claim to \"" + who + "\", which is not in the indexed record. It may exist elsewhere; it cannot be checked here." });
      });
    });
    return out.slice(0, 20);
  }

  /* --------------------------------------------------- statistical checks - */
  /** Internal arithmetic: do the figures in one document add up? */
  function statChecks(index) {
    var docs = (index && index.docs) || [];
    var out = [];
    docs.forEach(function (d) {
      var nums = numbersIn(d.b || "");
      if (nums.length < 2) return;
      // parts vs total: "14 providers ... 38,231 GPUs" is fine; "38,231 GPUs
      // from 14 providers, 40,000 total" is not.
      var byFam = {};
      nums.forEach(function (n) { (byFam[n.family] = byFam[n.family] || []).push(n); });
      Object.keys(byFam).forEach(function (fam) {
        var list = byFam[fam];
        if (list.length < 2) return;
        var vals = list.map(function (n) { return n.base; }).filter(function (v) { return v > 0; });
        var max = Math.max.apply(null, vals);
        var sumSmall = vals.filter(function (v) { return v < max; }).reduce(function (a, b) { return a + b; }, 0);
        if (vals.length >= 3 && sumSmall > max * 1.6 && sumSmall < max * 1.6) return;
        if (vals.length >= 3 && Math.abs(sumSmall - max) / max > 2.5 && fam !== "count") {
          out.push({
            docId: d.id, org: d.o, family: fam, largest: max, sumOfOthers: sumSmall,
            status: "parts exceed whole by " + (sumSmall / max).toFixed(1) + "x",
            note: "The figures in this document are not in the same scale. Check units before quoting any of them."
          });
        }
      });
    });
    return out.slice(0, 12);
  }

  /* --------------------------------------------------- misinformation ----- */
  var MANIPULATION = [
    { id: "absolute", re: /\b(100%|always|never|everyone|no one|guaranteed|proven beyond)\b/gi, w: 0.10, note: "absolute language" },
    { id: "unsourced-number", re: null, w: 0.15, note: "precise figures with no attribution" },
    { id: "promo", re: PROMO, w: 0.10, note: "promotional register" },
    { id: "anonymous", re: /\b(sources say|it is said|reportedly|allegedly|some believe)\b/gi, w: 0.12, note: "anonymous attribution" },
    { id: "urgency", re: /\b(breaking|shocking|must share|viral|secret)\b/gi, w: 0.08, note: "urgency framing" },
    { id: "circular", re: null, w: 0.20, note: "circular citation" }
  ];

  function misinformationRisk(doc, index) {
    var body = String(doc.b || "");
    var src = classifySource(doc);
    var signals = [], risk = 0;
    MANIPULATION.forEach(function (m) {
      if (m.re) {
        var hits = (body.match(new RegExp(m.re.source, "gi")) || []).length;
        if (hits) { signals.push({ id: m.id, note: m.note, hits: hits }); risk += m.w * Math.min(1, hits / 2); }
      }
    });
    if (numbersIn(body).length >= 3 && !EVIDENCE_MARK.test(body)) {
      signals.push({ id: "unsourced-number", note: "precise figures with no attribution", hits: numbersIn(body).length });
      risk += 0.15;
    }
    if (!src.hasUrl) { signals.push({ id: "no-url", note: "no public URL to check", hits: 1 }); risk += 0.10; }
    if (!src.dated) { signals.push({ id: "undated", note: "no publication date", hits: 1 }); risk += 0.08; }
    var docs = (index && index.docs) || [];
    var sameOrg = docs.filter(function (o) { return o.id !== doc.id && issuerFamily(o) === issuerFamily(doc); });
    if (sameOrg.length && sameOrg.every(function (o) { return textSimilarity(o.b, body) > 0.4; })) {
      signals.push({ id: "circular", note: "the only documents that agree are from the same issuer", hits: sameOrg.length });
      risk += 0.20;
    }
    return {
      risk: +Math.min(0.95, risk).toFixed(2),
      band: risk > 0.45 ? "high" : risk > 0.25 ? "medium" : "low",
      signals: signals,
      note: risk > 0.45
        ? "Several manipulation markers. Do not quote this without an independent source."
        : risk > 0.25 ? "Some markers. Cross-check the figures before relying on them."
        : "No manipulation markers found in the text itself. That is not proof of accuracy."
    };
  }

  /* ------------------------------------------------------- uncertainty ---- */
  /** Aggregate several numeric claims into a range, not a false point value. */
  function uncertainty(values, label) {
    var vals = values.filter(function (v) { return v != null && isFinite(v); }).sort(function (a, b) { return a - b; });
    if (!vals.length) return { label: label, n: 0, point: null, lo: null, hi: null, note: "no comparable figures" };
    var median = vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
    return {
      label: label, n: vals.length, point: median, lo: vals[0], hi: vals[vals.length - 1],
      spread: +((vals[vals.length - 1] - vals[0]) / Math.max(1e-9, median)).toFixed(2),
      note: vals.length === 1 ? "single figure, no cross-check possible"
        : vals.length === 2 ? "two figures: the range is the honest answer"
        : "range across " + vals.length + " independent figures"
    };
  }

  /** Truth decomposition: break a compound claim into checkable atoms. */
  function decomposeClaim(text) {
    var atoms = [];
    var sents = splitSentences(text);
    sents.forEach(function (s) {
      // split on coordinating conjunctions that join independent clauses
      var parts = s.split(/;\s*|\s+(?:and|but|while|whereas|although|which|that)\s+(?=[a-z]{3,})/i);
      parts.forEach(function (p) {
        p = p.trim().replace(/^[,;]\s*/, "");
        if (p.split(/\s+/).length < 4) return;
        atoms.push({
          text: p, kind: kindOf(p), numbers: numbersIn(p),
          causal: CAUSAL.test(p), negated: NEGATION.test(p),
          checkable: /\d|according to|reported|measured/.test(p),
          why: /\d/.test(p) ? "has a figure that can be looked up"
            : CAUSAL.test(p) ? "asserts a cause that can be tested"
            : EVIDENCE_MARK.test(p) ? "cites a body of evidence" : "interpretation, not directly checkable"
        });
      });
    });
    return atoms;
  }

  /* -------------------------------------------------------- provenance ---- */
  /** Knowledge DNA: where a claim came from and what happened to it since. */
  function lineage(claim, index) {
    var docs = (index && index.docs) || [];
    var origin = docs.filter(function (d) { return d.id === claim.docId; })[0];
    if (!origin) return null;
    var restatements = docs.filter(function (d) {
      if (d.id === origin.id) return false;
      return textSimilarity(d.b, origin.b) > 0.3;
    }).map(function (d) {
      return { id: d.id, org: d.o, date: d.d, independent: independence(origin, d).independent };
    });
    return {
      claim: claim.id, origin: { id: origin.id, org: origin.o, source: origin.s, date: origin.d, url: origin.u },
      restatements: restatements,
      independentRestatements: restatements.filter(function (r) { return r.independent; }).length,
      chain: [origin.id].concat(restatements.map(function (r) { return r.id; })),
      note: restatements.length
        ? restatements.length + " document(s) restate this, " + restatements.filter(function (r) { return r.independent; }).length + " independently"
        : "this document is the only place the claim appears in the index"
    };
  }

  ANV.evidence = {
    SCALE: SCALE, UNIT_FAMILY: UNIT_FAMILY,
    numbersIn: numbersIn, toBase: toBase, parseNumber: parseNumber,
    classifySource: classifySource, credibility: credibility, freshness: freshness, halfLife: halfLife,
    claimsOf: claimsOf, allClaims: allClaims, kindOf: kindOf, subjectOf: subjectOf,
    verify: verify, independence: independence, independenceReport: independenceReport,
    issuerFamily: issuerFamily, textSimilarity: textSimilarity,
    contradictionLab: contradictionLab, citationIntegrity: citationIntegrity,
    statChecks: statChecks, misinformationRisk: misinformationRisk,
    uncertainty: uncertainty, decomposeClaim: decomposeClaim, lineage: lineage,
    splitSentences: splitSentences
  };

  if (typeof module !== "undefined" && module.exports) module.exports = ANV.evidence;
})(typeof globalThis !== "undefined" ? globalThis : this);
