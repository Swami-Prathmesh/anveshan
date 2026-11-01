/* ============================================================================
   ANVESHAN v4 - LAYER 5: DISCOVERY
   The ten experimental paradigms, plus prediction, gap detection and the
   relationship-finding tools.

   Every function here answers a question a normal search engine cannot even
   ask: what is missing, what would have to be true, what causes what, what was
   forgotten, what does not fit, what connects. Each result carries the basis
   it was computed from, and speculative output is labelled as speculation
   rather than dressed up as finding.
   ========================================================================== */
(function (root) {
  "use strict";
  var ANV = root.ANV = root.ANV || {};
  var L = ANV.lang;

  function sem() { return ANV.semantic; }
  function ev() { return ANV.evidence; }
  function docsOf(index) { return (index && index.docs) || root.DOCS || []; }
  function searchPool(index, query, limit) {
    var s = sem();
    if (s && s.ready()) return s.hybrid(index, query, { limit: limit || 14 }, root.search);
    return root.search ? root.search(index, query, { limit: limit || 14 }) : [];
  }
  function pct(x) { return Math.round(x * 100) + "%"; }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (!s[x]) { s[x] = 1; o.push(x); } }); return o; }

  /* ------------------------------------------------------------- helpers -- */
  /** Co-mention graph over entities, used by several paradigms. */
  function entityGraph(index) {
    if (entityGraph._g && entityGraph._n === docsOf(index).length) return entityGraph._g;
    var docs = docsOf(index);
    var byEntity = {}, edges = {};
    docs.forEach(function (d) {
      var ents = uniq((d.e || []).concat((d.k || []).filter(function (k) { return k.length > 3; })));
      ents.forEach(function (e) {
        (byEntity[e] = byEntity[e] || []).push(d.id);
      });
      for (var i = 0; i < ents.length; i++) {
        for (var j = i + 1; j < ents.length; j++) {
          var k = ents[i] < ents[j] ? ents[i] + "||" + ents[j] : ents[j] + "||" + ents[i];
          edges[k] = (edges[k] || 0) + 1;
        }
      }
    });
    var g = { byEntity: byEntity, edges: edges, docCount: docs.length };
    entityGraph._g = g; entityGraph._n = docs.length;
    return g;
  }

  function visibility(index) {
    // a crude PageRank over the co-mention graph: which sources are central
    var g = entityGraph(index);
    var docs = docsOf(index);
    var rank = {};
    docs.forEach(function (d) { rank[d.id] = 1 / docs.length; });
    var keys = Object.keys(g.edges);
    for (var it = 0; it < 12; it++) {
      var next = {};
      docs.forEach(function (d) { next[d.id] = 0.15 / docs.length; });
      keys.forEach(function (k) {
        var parts = k.split("||"), w = g.edges[k];
        var da = g.byEntity[parts[0]] || [], db = g.byEntity[parts[1]] || [];
        da.forEach(function (a) { db.forEach(function (b) { if (a !== b) next[b] += 0.85 * rank[a] * (w / Math.max(1, da.length * db.length)); }); });
      });
      rank = next;
    }
    return rank;
  }

  /* ============================== 1. UNKNOWN SEARCH ======================= */
  function unknown(query, index) {
    var U = ANV.understand, s = sem(), cov = s.coverage(query);
    var pool = searchPool(index, query, 10);
    var subject = query.replace(/[?।]/g, "").trim();
    var facets = U.plan(query).facets;
    var gaps = [];
    facets.forEach(function (f) {
      if (!f.probe) return;
      var probe = searchPool(index, subject + " " + f.probe, 5);
      var best = probe.length ? probe[0].score : 0;
      var floor = pool.length ? Math.max(0.25, pool[0].score * 0.45) : 0.3;
      if (best < floor) {
        gaps.push({
          facet: f.id, label: f.label, strength: +best.toFixed(3), threshold: +floor.toFixed(3),
          question: "No indexed source says anything specific about " + f.label.toLowerCase() + " for \"" + subject + "\".",
          whatWouldHelp: helpFor(f.id, subject)
        });
      }
    });
    // unstudied combinations: entities that both exist but are never discussed together
    var g = entityGraph(index);
    var top = pool.slice(0, 5).map(function (p) { return p.doc; });
    var ents = uniq([].concat.apply([], top.map(function (d) { return (d.e || []); }))).slice(0, 8);
    var holes = [];
    for (var i = 0; i < ents.length; i++) {
      for (var j = i + 1; j < ents.length; j++) {
        var a = ents[i], b = ents[j];
        var key = a < b ? a + "||" + b : b + "||" + a;
        if (!g.edges[key]) holes.push({ pair: [a, b], aDocs: (g.byEntity[a] || []).length, bDocs: (g.byEntity[b] || []).length });
      }
    }
    return {
      paradigm: "unknown", query: query,
      summary: gaps.length
        ? gaps.length + " of " + facets.length + " research facets have no adequate answer in this corpus."
        : "The corpus covers every facet this engine probes. That is not the same as being complete.",
      coverage: cov,
      gaps: gaps,
      unstudiedCombinations: holes.slice(0, 6),
      unknownTerms: cov.unknown,
      nextQueries: gaps.slice(0, 4).map(function (g2) { return subject + " " + g2.facet; })
    };
  }
  function helpFor(facet, subject) {
    var map = {
      figures: "a published figure with a date and unit for " + subject,
      timeline: "a dated announcement or record showing when this began",
      mechanism: "a description of the process, not just the outcome",
      actors: "a named institution with a stated responsibility",
      limits: "an evaluation, audit or criticism that names a shortfall",
      evidence: "a measurement, survey or trial rather than a claim",
      future: "a target with a deadline and an owner",
      definition: "an official definition or scope statement"
    };
    return map[facet] || "a primary source that addresses it directly";
  }

  /* ============================ 2. POSSIBILITY =========================== */
  var MODAL = /\b(if|would|could|can be|target|aims? to|plans? to|proposed|expected|by 20\d\d|potential|scenario|assum(e|ing)|provided that)\b/i;

  function possibility(query, index) {
    var pool = searchPool(index, query, 16);
    var constraints = [], modal = [];
    pool.forEach(function (r) {
      ev().claimsOf(r.doc).forEach(function (c) {
        if (MODAL.test(c.sentence)) modal.push({ docId: r.doc.id, org: r.doc.org, date: c.date, sentence: c.sentence, numbers: c.numbers });
        c.numbers.forEach(function (n) {
          if (n.family === "count") return;
          constraints.push({ docId: r.doc.id, org: c.org, date: c.date, value: n.base, unit: n.unit, family: n.family, raw: n.raw });
        });
      });
    });
    // a projection built only from figures the sources actually give
    var scenarios = [];
    var byFam = {};
    constraints.forEach(function (c) { (byFam[c.family] = byFam[c.family] || []).push(c); });
    Object.keys(byFam).forEach(function (fam) {
      var rows = byFam[fam].filter(function (r) { return r.date; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
      if (rows.length < 2) return;
      var first = rows[0], last = rows[rows.length - 1];
      var y1 = parseInt(first.date.slice(0, 4), 10), y2 = parseInt(last.date.slice(0, 4), 10);
      if (!(y2 > y1) || !first.value) return;
      var cagr = Math.pow(last.value / first.value, 1 / (y2 - y1)) - 1;
      scenarios.push({
        family: fam, from: { date: first.date, value: first.value, raw: first.raw }, to: { date: last.date, value: last.value, raw: last.raw },
        cagr: +(cagr * 100).toFixed(1),
        projection: [2027, 2030, 2035].map(function (y) {
          return { year: y, value: last.value * Math.pow(1 + cagr, y - y2) };
        }),
        assumption: "straight-line compounding of the observed " + (cagr * 100).toFixed(1) + "% a year between " + first.date + " and " + last.date +
          ". This is arithmetic on two data points, not a forecast model: it assumes the rate holds, which real systems rarely do.",
        wouldHaveToBeTrue: ["the observed rate is measured the same way at both dates", "no cap, shock or policy change intervenes", "the underlying quantity keeps the same definition"]
      });
    });
    return {
      paradigm: "possibility", query: query,
      summary: modal.length + " conditional statements and " + scenarios.length + " quantified trajectories found. Scenarios below are arithmetic on cited figures.",
      modalStatements: modal.slice(0, 8),
      scenarios: scenarios.slice(0, 4),
      counterfactual: "What would have to be true for the alternative? The sources state " +
        (constraints.length ? constraints.length + " constraint figures" : "no hard constraints") + "; anything outside those is speculation."
    };
  }

  /* ============================== 3. CAUSAL ============================== */
  function causal(query, index) {
    var pool = searchPool(index, query, 20);
    var edges = {}, correlations = {};
    pool.forEach(function (r) {
      var e = ev();
      e.claimsOf(r.doc).forEach(function (c) {
        if (!c.causal) return;
        var m = c.sentence.match(/([^.;]{3,60}?)\s+(causes?|caused by|leads? to|led to|results? in|resulted in|drives?|drove|enables?|produces?|triggers?|gives rise to)\s+([^.;]{3,70})/i);
        if (!m) return;
        var from = m[1].replace(/^(the|a|an|this|that|these)\s+/i, "").trim();
        var to = m[3].trim();
        var key = from.toLowerCase() + " → " + to.toLowerCase();
        edges[key] = edges[key] || { cause: from, effect: to, verb: m[2].toLowerCase(), evidence: [] };
        edges[key].evidence.push({ docId: r.doc.id, org: r.doc.org, date: c.date, sentence: c.sentence, kind: c.kind });
      });
      // co-mention without a causal verb is correlation, and is kept separate
      (r.doc.e || []).forEach(function (x) {
        (r.doc.e || []).forEach(function (y) {
          if (x === y) return;
          var k = x + " ~ " + y;
          correlations[k] = (correlations[k] || 0) + 1;
        });
      });
    });
    var list = Object.keys(edges).map(function (k) {
      var e = edges[k];
      var kinds = uniq(e.evidence.map(function (x) { return x.kind; }));
      return {
        chain: k, cause: e.cause, effect: e.effect, verb: e.verb,
        support: e.evidence.length, independent: uniq(e.evidence.map(function (x) { return x.org; })).length,
        strength: +(e.evidence.length * (kinds.indexOf("evidence") >= 0 ? 1.4 : 0.8)).toFixed(2),
        evidence: e.evidence.slice(0, 3),
        caveat: kinds.indexOf("hypothesis") >= 0 ? "stated as a hypothesis, not a measurement" : "asserted as fact by the source; not independently tested here"
      };
    }).sort(function (a, b) { return b.strength - a.strength; });
    return {
      paradigm: "causal", query: query,
      summary: list.length + " causal chains extracted, " + Object.keys(correlations).length + " co-mentions that are not causal claims.",
      chains: list.slice(0, 10),
      correlationsOnly: Object.keys(correlations).sort(function (a, b) { return correlations[b] - correlations[a]; }).slice(0, 6)
        .map(function (k) { return { pair: k, coMentions: correlations[k], note: "appears together, no mechanism stated" }; }),
      method: "Cause is only recorded when the sentence itself uses a causal verb. Co-occurrence is reported separately because it is not causation."
    };
  }

  /* ============================ 4. LOST KNOWLEDGE ======================== */
  function lost(query, index) {
    var docs = docsOf(index), vis = visibility(index);
    var pool = searchPool(index, query, 60);
    var s = sem();
    var ranked = pool.map(function (r, i) {
      var v = vis[r.doc.id] || 0;
      var sources = docs.filter(function (d) { return d.id !== r.doc.id && ev().textSimilarity(d.b, r.doc.b) > 0.25; }).length;
      return {
        doc: r.doc, rank: i + 1, score: r.score, visibility: +v.toFixed(4),
        age: r.doc.d, type: r.doc.ty, singleSource: sources === 0, corroboratedBy: sources,
        forgotten: (i + 1) > 8 && r.score > 0.12,
        why: [
          sources === 0 ? "no other indexed source discusses it" : null,
          v < 0.02 ? "low connectivity in the entity graph" : null,
          (r.doc.y || 0) < 2024 ? "older than the current wave of documents" : null,
          /archive|manuscript|history|culture|colonial|ancient|vedic|temple|inscription/i.test((r.doc.t || "") + " " + (r.doc.b || "")) ? "archival or historical register" : null
        ].filter(Boolean)
      };
    });
    var forgotten = ranked.filter(function (r) { return r.forgotten || r.singleSource; })
      .sort(function (a, b) { return a.visibility - b.visibility; }).slice(0, 8);
    return {
      paradigm: "lost", query: query,
      summary: forgotten.length + " relevant documents are poorly connected or single-source: the places a mainstream ranking would bury.",
      forgotten: forgotten,
      method: "Visibility is PageRank over the entity co-mention graph. A relevant document with low visibility is knowledge that exists but is not reachable by authority."
    };
  }

  /* ============================== 5. ANOMALY ============================= */
  function anomaly(query, index) {
    var pool = searchPool(index, query, 20);
    var rows = [];
    pool.forEach(function (r) {
      ev().claimsOf(r.doc).forEach(function (c) {
        c.numbers.forEach(function (n) {
          if (n.family === "count" || n.family === "share") return;
          rows.push({ docId: r.doc.id, org: c.org, date: c.date, family: n.family, value: n.base, raw: n.raw, sentence: c.sentence });
        });
      });
    });
    var byFam = {};
    rows.forEach(function (r) { (byFam[r.family] = byFam[r.family] || []).push(r); });
    var out = [];
    Object.keys(byFam).forEach(function (fam) {
      var list = byFam[fam];
      if (list.length < 3) return;
      var vals = list.map(function (r) { return r.value; }).sort(function (a, b) { return a - b; });
      var med = vals[Math.floor(vals.length / 2)];
      var devs = vals.map(function (v) { return Math.abs(v - med); }).sort(function (a, b) { return a - b; });
      var mad = devs[Math.floor(devs.length / 2)] || 1e-9;
      list.forEach(function (r) {
        var z = 0.6745 * (r.value - med) / mad;
        if (Math.abs(z) > 2.5) {
          out.push({
            docId: r.docId, org: r.org, date: r.date, family: fam, raw: r.raw, value: r.value,
            median: med, z: +z.toFixed(2), direction: z > 0 ? "far above" : "far below",
            sentence: r.sentence,
            note: "This figure is " + Math.abs(z).toFixed(1) + " robust deviations from the median for " + fam + ". Either it measures something different, or one of the figures is wrong."
          });
        }
      });
    });
    // temporal anomalies: dates in the future relative to the index
    var future = docsOf(index).filter(function (d) { return (d.y || 0) > new Date().getFullYear(); })
      .map(function (d) { return { docId: d.id, date: d.d, note: "publication date is ahead of today" }; });
    return {
      paradigm: "anomaly", query: query,
      summary: out.length + " statistical outliers (median absolute deviation > 2.5) in the retrieved figures.",
      outliers: out.slice(0, 10), dateAnomalies: future,
      method: "Robust z-score against the median of the same unit family. A large deviation is a question to ask, not a finding."
    };
  }

  /* ========================= 6. INTERDISCIPLINARY ======================== */
  var FIELD = {
    policy: "governance", governance: "governance", scheme: "governance", press: "governance", standard: "governance",
    science: "science", space: "science", paper: "science", health: "health", tech: "technology",
    model: "technology", api: "technology", dataset: "technology", dashboard: "technology", report: "economics",
    economy: "economics", history: "history", culture: "history", geography: "geography"
  };
  function fieldOf(doc) { return FIELD[doc.ty] || "other"; }

  function interdisciplinary(query, index) {
    var docs = docsOf(index);
    var pool = searchPool(index, query, 24);
    var fields = {};
    pool.forEach(function (r) {
      var f = fieldOf(r.doc);
      (fields[f] = fields[f] || []).push({ id: r.doc.id, title: r.doc.t, score: +r.score.toFixed(3) });
    });
    // bridge concepts: shared vocabulary across fields
    var conceptFields = {};
    docs.forEach(function (d) {
      var f = fieldOf(d);
      uniq((d.e || []).concat((d.k || []))).forEach(function (c) {
        conceptFields[c] = conceptFields[c] || {};
        conceptFields[c][f] = (conceptFields[c][f] || 0) + 1;
      });
    });
    var bridges = Object.keys(conceptFields).map(function (c) {
      var fs = Object.keys(conceptFields[c]);
      return { concept: c, fields: fs, spread: fs.length, total: fs.reduce(function (a, f) { return a + conceptFields[c][f]; }, 0) };
    }).filter(function (b) { return b.spread >= 2; }).sort(function (a, b) { return b.spread - a.spread || b.total - a.total; }).slice(0, 8);

    // analogy: a concept from another field that sits near the query in vector space
    var analogies = [];
    var s = sem();
    if (s && s.ready()) {
      var qv = s.embed(query);
      var scored = docs.map(function (d) { return { d: d, sim: s.dot(qv, s.docVec(docs.indexOf(d))) }; })
        .sort(function (a, b) { return b.sim - a.sim; }).slice(0, 30);
      var own = fieldOf(scored[0] ? scored[0].d : {});
      scored.forEach(function (x) {
        var f = fieldOf(x.d);
        if (f !== own && x.sim > 0.25 && analogies.length < 5) {
          analogies.push({ field: f, fromField: own, title: x.d.t, id: x.d.id, similarity: +x.sim.toFixed(3),
            note: "same structure, different discipline: " + f + " rather than " + own });
        }
      });
    }
    return {
      paradigm: "interdisciplinary", query: query,
      summary: Object.keys(fields).length + " disciplines cover this question; " + bridges.length + " concepts bridge them.",
      fields: Object.keys(fields).map(function (f) { return { field: f, docs: fields[f] }; }),
      bridges: bridges, analogies: analogies,
      method: "Fields come from document type. Bridges are concepts that appear in two or more fields. Analogies are cross-field vector neighbours - suggestions to check, not equivalences."
    };
  }

  /* ============================== 7. REALITY ============================= */
  var MEASURED = /\b(measured|recorded|census|survey|audited|observed|actual|stood at|reported|as on|as of|according to the (data|report))\b/i;

  function reality(query, index) {
    var pool = searchPool(index, query, 18);
    var measured = [], projected = [], mixed = [];
    pool.forEach(function (r) {
      ev().claimsOf(r.doc).forEach(function (c) {
        var hasNum = c.numbers.length > 0;
        if (!hasNum) return;
        var isProjected = c.target || /\bby 20\d\d\b/i.test(c.sentence) || /\b(target|plan|aim|expected|projected|forecast)\b/i.test(c.sentence);
        var isMeasured = MEASURED.test(c.sentence) && !isProjected;
        var row = { docId: r.doc.id, org: c.org, date: c.date, sentence: c.sentence, numbers: c.numbers.map(function (n) { return n.raw; }) };
        if (isMeasured) measured.push(row);
        else if (isProjected) projected.push(row);
        else mixed.push(row);
      });
    });
    return {
      paradigm: "reality", query: query,
      summary: measured.length + " measured statements, " + projected.length + " projections or targets. The two are never averaged together here.",
      measured: measured.slice(0, 8), projected: projected.slice(0, 8),
      unclassified: mixed.slice(0, 4),
      grounding: projected.length && !measured.length
        ? "Every figure found is a target. There is no measurement in this corpus to check the target against."
        : measured.length ? "At least one measured figure exists, so a projection can be compared against something real." : "No quantified statements found.",
      method: "A statement is 'measured' only when it reports an observation with a date or a method. Targets and forecasts are labelled as such and kept in a separate list."
    };
  }

  /* ============================ 8. SIMULATION ============================ */
  function simulation(query, index, opts) {
    opts = opts || {};
    var pool = searchPool(index, query, 14);
    var series = {};
    pool.forEach(function (r) {
      ev().claimsOf(r.doc).forEach(function (c) {
        if (!c.date) return;
        c.numbers.forEach(function (n) {
          if (n.family === "count") return;
          (series[n.family] = series[n.family] || []).push({ date: c.date, value: n.base, raw: n.raw, docId: r.doc.id });
        });
      });
    });
    var models = Object.keys(series).map(function (fam) {
      var rows = series[fam].sort(function (a, b) { return a.date.localeCompare(b.date); });
      if (rows.length < 2) return null;
      var xs = rows.map(function (r) { return parseInt(r.date.slice(0, 4), 10) + (parseInt(r.date.slice(5, 7), 10) - 1) / 12; });
      var ys = rows.map(function (r) { return r.value; });
      var n = xs.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (var i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
      var slope = (n * sxy - sx * sy) / Math.max(1e-12, n * sxx - sx * sx);
      var intercept = (sy - slope * sx) / n;
      var resid = 0;
      for (var j = 0; j < n; j++) { var p = slope * xs[j] + intercept; resid += (ys[j] - p) * (ys[j] - p); }
      var sd = Math.sqrt(resid / Math.max(1, n - 2));
      var r2 = 1 - resid / Math.max(1e-12, ys.reduce(function (a, y) { return a + (y - sy / n) * (y - sy / n); }, 0));
      var lastX = xs[n - 1];
      return {
        family: fam, n: n, slope: +slope.toFixed(4), r2: +Math.max(0, r2).toFixed(3), sd: +sd.toFixed(3),
        observed: rows.slice(-4),
        predictions: [1, 3, 5].map(function (k) {
          var y = Math.round(lastX + k);
          var v = slope * (lastX + k) + intercept;
          return { year: y, value: v, lo: v - 1.96 * sd * Math.sqrt(1 + k / Math.max(1, n)), hi: v + 1.96 * sd * Math.sqrt(1 + k / Math.max(1, n)) };
        }),
        assumptions: ["the trend is linear in " + fam, "the same definition is used at every point", "no structural break"],
        caveat: n < 4 ? "only " + n + " observations: the interval is wide for a reason" : "r-squared " + Math.max(0, r2).toFixed(2) + " on " + n + " observations"
      };
    }).filter(Boolean);
    return {
      paradigm: "simulation", query: query,
      summary: models.length + " quantity series could be fitted. These are linear fits with prediction intervals, not validated simulations.",
      models: models.slice(0, 4),
      method: "Ordinary least squares on the figures the sources report, with a 95% prediction interval. Fitting is arithmetic; validation would need data this page does not have.",
      honesty: "A model is only as good as its assumptions. Both are printed above."
    };
  }

  /* ============================= 9. TEMPORAL ============================= */
  function temporal(query, index, asOfYear) {
    var docs = docsOf(index);
    var all = docs.slice();
    var scoped = asOfYear ? docs.filter(function (d) { return (d.y || 0) <= asOfYear; }) : docs;
    var scopedPool = asOfYear ? sem().hybrid({ docs: scoped, postings: null, df: {} }, query, { limit: 8 }, function () { return []; }) : [];
    // term evolution across years
    var years = uniq(docs.map(function (d) { return d.y; }).filter(Boolean)).sort();
    var terms = L.tokenise(query, { keepStop: false }).slice(0, 4);
    var evolution = terms.map(function (t) {
      var per = {};
      docs.forEach(function (d) {
        var hay = L.normalise(d.t + " " + d.b);
        if (hay.indexOf(t) >= 0) per[d.y] = (per[d.y] || 0) + 1;
      });
      var counts = years.map(function (y) { return { year: y, n: per[y] || 0 }; });
      var first = counts.filter(function (c) { return c.n > 0; })[0];
      var last = counts.filter(function (c) { return c.n > 0; }).slice(-1)[0];
      return { term: t, counts: counts, firstYear: first ? first.year : null, lastYear: last ? last.year : null,
               peak: counts.slice().sort(function (a, b) { return b.n - a.n; })[0] };
    });
    return {
      paradigm: "temporal", query: query, asOfYear: asOfYear || null,
      summary: asOfYear
        ? "Knowledge as it stood at the end of " + asOfYear + ": " + scoped.length + " of " + docs.length + " documents existed."
        : "Term usage across " + years[0] + "-" + years[years.length - 1] + ".",
      evolution: evolution,
      asOfResults: scopedPool.slice(0, 6).map(function (r) { return { id: r.doc.id, title: r.doc.t, date: r.doc.d, score: +r.score.toFixed(3) }; }),
      method: "The time machine filters the index to documents published on or before the chosen year. Nothing is rewritten: you see exactly what was known then."
    };
  }

  /* =========================== 10. EVOLUTIONARY ========================= */
  /** Self-tuning: score the engine against a built-in battery, perturb the
      ranking weights, keep only measured improvements, and log every attempt. */
  var BATTERY = [
    { q: "IndiaAI mission outlay", re: /indiaai/i },
    { q: "UPI transactions NPCI", re: /upi/i },
    { q: "Bhashini translation languages", re: /bhashini/i },
    { q: "Aadhaar authentication eKYC", re: /aadhaar/i },
    { q: "data protection consent DPDP", re: /dpdp|data protection/i },
    { q: "BharatNet broadband villages", re: /bharatnet/i },
    { q: "quantum entanglement", re: /entangle|quantum/i },
    { q: "Mughal empire administration", re: /mughal/i },
    { q: "ONDC open commerce network", re: /ondc/i },
    { q: "solar capacity gigawatt", re: /solar/i },
    { q: "Chandrayaan lunar mission", re: /chandrayaan/i },
    { q: "GPU compute subsidy hour", re: /gpu|compute/i }
  ];

  function evaluate(index, weights) {
    var hits = 0, mrr = 0, n = 0, misses = [];
    BATTERY.forEach(function (b) {
      var expected = docsOf(index).filter(function (d) { return b.re.test(d.t + " " + d.b); }).map(function (d) { return d.id; });
      if (!expected.length) return;
      n++;
      var res = sem().hybrid(index, b.q, { limit: 10, w: weights }, root.search);
      var rank = -1;
      for (var i = 0; i < res.length; i++) if (expected.indexOf(res[i].doc.id) >= 0) { rank = i + 1; break; }
      if (rank === 1) hits++;
      if (rank > 0) mrr += 1 / rank; else misses.push(b.q);
    });
    return { n: n, precisionAt1: +(hits / Math.max(1, n)).toFixed(3), mrr: +(mrr / Math.max(1, n)).toFixed(3), misses: misses };
  }

  function evolutionary(index, opts) {
    opts = opts || {};
    var before = evaluate(index, null);
    var best = { w: null, score: before.mrr + before.precisionAt1 };
    var grid = [
      { lex: 0.70, sem: 0.22, auth: 0.08 },
      { lex: 0.60, sem: 0.32, auth: 0.08 },
      { lex: 0.50, sem: 0.42, auth: 0.08 },
      { lex: 0.45, sem: 0.35, auth: 0.20 },
      { lex: 0.55, sem: 0.30, auth: 0.15 },
      { lex: 0.40, sem: 0.50, auth: 0.10 }
    ];
    var tried = [];
    grid.forEach(function (w) {
      var r = evaluate(index, w);
      var score = r.mrr + r.precisionAt1;
      tried.push({ weights: w, mrr: r.mrr, p1: r.precisionAt1 });
      if (score > best.score + 1e-6) best = { w: w, score: score, result: r };
    });
    var after = best.w ? best.result : before;
    return {
      paradigm: "evolutionary", query: opts.query || "engine self-test",
      summary: "Evaluated " + before.n + " labelled queries. MRR " + before.mrr + " → " + after.mrr +
        (best.w ? "; better weights found and adopted." : "; current weights already optimal on this battery."),
      before: before, after: after, tried: tried,
      adopted: best.w, changed: !!best.w,
      caveat: "The battery is small and written by the same people who wrote the engine. It catches regressions; it does not prove quality.",
      method: "Grid search over the lexical/semantic/authority weights, scored by mean reciprocal rank and precision@1, adopting only a measured improvement."
    };
  }

  /* ======================= PREDICTION AND GAPS =========================== */
  /** Emerging-term detection: a term whose share of documents rises sharply in
   *  the most recent year is a candidate signal, nothing more. */
  function emerging(index, limit) {
    var docs = docsOf(index);
    var years = uniq(docs.map(function (d) { return d.y; })).filter(Boolean).sort();
    if (years.length < 2) return [];
    var recent = years[years.length - 1], prior = years.slice(0, -1);
    var counts = {};
    docs.forEach(function (d) {
      uniq(L.tokenise(d.t + " " + d.b)).forEach(function (t) {
        if (t.length < 4) return;
        counts[t] = counts[t] || { recent: 0, prior: 0, years: {} };
        if (d.y === recent) counts[t].recent++;
        else counts[t].prior++;
        counts[t].years[d.y] = (counts[t].years[d.y] || 0) + 1;
      });
    });
    var nRecent = docs.filter(function (d) { return d.y === recent; }).length || 1;
    var nPrior = docs.filter(function (d) { return d.y !== recent; }).length || 1;
    var out = Object.keys(counts).map(function (t) {
      var c = counts[t];
      if (c.recent + c.prior < 3) return null;
      var rateRecent = c.recent / nRecent, ratePrior = c.prior / nPrior;
      var lift = rateRecent / Math.max(1e-9, ratePrior);
      return { term: t, recent: c.recent, prior: c.prior, lift: +lift.toFixed(2),
               share: +((c.recent + c.prior) / docs.length).toFixed(3),
               byYear: c.years, signal: lift > 2 ? "emerging" : lift > 1.3 ? "rising" : lift < 0.5 ? "fading" : "stable" };
    }).filter(function (x) { return x && x.signal !== "stable"; })
      .sort(function (a, b) { return b.lift - a.lift || b.recent - a.recent; });
    return out.slice(0, limit || 12);
  }

  /** Trend projection for one quantity, with an interval. */
  function forecast(index, query) {
    var sim = simulation(query, index, {});
    if (!sim.models.length) {
      return { available: false, note: "No two comparable dated figures for this question, so no projection is possible.", models: [] };
    }
    return {
      available: true, models: sim.models,
      note: "A projection is an extrapolation of reported figures. It is not a prediction of what will happen.",
      emerging: emerging(index, 8)
    };
  }

  /** Research-gap matrix: subject x facet, with the evidence strength per cell. */
  function gapMatrix(index, query) {
    var U = ANV.understand;
    var subject = String(query || "").replace(/[?।]/g, "").trim();
    var facets = U.FACETS;
    var rows = facets.map(function (f) {
      var probe = f.probe ? subject + " " + f.probe : subject;
      var res = searchPool(index, probe, 4);
      var strength = res.length ? res[0].score : 0;
      var support = res.filter(function (r) { return r.score > 0.12; }).length;
      return {
        facet: f.id, label: f.label, strength: +strength.toFixed(3), support: support,
        state: strength > 0.45 ? "covered" : strength > 0.2 ? "thin" : "gap",
        top: res.slice(0, 2).map(function (r) { return { id: r.doc.id, title: r.doc.t }; })
      };
    });
    return { subject: subject, rows: rows,
      gaps: rows.filter(function (r) { return r.state === "gap"; }).length,
      covered: rows.filter(function (r) { return r.state === "covered"; }).length };
  }

  /* ===================== RELATIONSHIP DISCOVERY ========================== */
  /** Hidden relationships: entities that are individually well attested but
   *  never discussed together, yet sit close in vector space. */
  function hiddenRelations(index, limit) {
    var g = entityGraph(index), s = sem();
    if (!s || !s.ready()) return [];
    var ents = Object.keys(g.byEntity).filter(function (e) { return g.byEntity[e].length >= 2; }).slice(0, 120);
    var out = [];
    for (var i = 0; i < ents.length; i++) {
      for (var j = i + 1; j < ents.length; j++) {
        var a = ents[i], b = ents[j];
        var key = a < b ? a + "||" + b : b + "||" + a;
        if (g.edges[key]) continue;                     // already co-mentioned
        var va = s.embed(a), vb = s.embed(b);
        var sim = s.dot(va, vb);
        if (sim > 0.55) {
          var shared = s.neighbours(a, 8).filter(function (n) { return s.neighbours(b, 8).indexOf(n) >= 0; });
          out.push({ a: a, b: b, similarity: +sim.toFixed(3), sharedNeighbours: shared.slice(0, 4),
            aDocs: g.byEntity[a].length, bDocs: g.byEntity[b].length,
            hypothesis: "Nothing in the corpus discusses " + a + " and " + b + " together, but they occupy the same region of the knowledge space" +
              (shared.length ? " (both sit near " + shared.slice(0, 3).join(", ") + ")" : "") + ". That is a question worth asking, not a finding." });
        }
      }
    }
    return out.sort(function (x, y) { return y.similarity - x.similarity; }).slice(0, limit || 8);
  }

  /** Analogy: a problem in one field and its structural twin in another. */
  function analogy(index, query) {
    var inter = interdisciplinary(query, index);
    return inter.analogies.map(function (a) {
      return Object.assign({}, a, {
        question: "If " + a.field + " has solved the same shape of problem, what would carry over to " + a.fromField + "?"
      });
    });
  }

  /** Knowledge recombination: two ideas from different fields whose union is
      an unexplored research question. */
  function recombination(index, limit) {
    var docs = docsOf(index);
    var byField = {};
    docs.forEach(function (d) {
      var f = fieldOf(d);
      (byField[f] = byField[f] || []).push(d);
    });
    var fields = Object.keys(byField);
    var s = sem();
    if (!s || !s.ready()) return [];
    var out = [];
    for (var i = 0; i < fields.length; i++) {
      for (var j = i + 1; j < fields.length; j++) {
        var a = byField[fields[i]][0], b = byField[fields[j]][0];
        if (!a || !b) continue;
        var sim = s.dot(s.docVec(docs.indexOf(a)), s.docVec(docs.indexOf(b)));
        if (sim > 0.3 && sim < 0.75) {
          out.push({
            fields: [fields[i], fields[j]], a: { id: a.id, title: a.t }, b: { id: b.id, title: b.t },
            similarity: +sim.toFixed(3),
            researchQuestion: "What would " + fields[i] + " and " + fields[j] + " produce if combined around: \"" + a.t.split(":")[0] + "\" and \"" + b.t.split(":")[0] + "\"?"
          });
        }
      }
    }
    return out.sort(function (x, y) { return y.similarity - x.similarity; }).slice(0, limit || 6);
  }

  /** Second- and third-order consequences, walked over the causal graph. */
  function consequences(index, query, depth) {
    var c = causal(query, index);
    var graph = {};
    c.chains.forEach(function (ch) {
      var from = ch.cause.toLowerCase(), to = ch.effect.toLowerCase();
      (graph[from] = graph[from] || []).push({ to: to, strength: ch.strength, support: ch.support });
    });
    var roots = c.chains.slice(0, 3).map(function (ch) { return ch.effect.toLowerCase(); });
    var orders = [{ order: 1, nodes: roots }];
    var seen = {};
    roots.forEach(function (r) { seen[r] = 1; });
    for (var d = 2; d <= (depth || 3); d++) {
      var next = [];
      var frontier = orders[orders.length - 1];
      if (!frontier) break;
      frontier.nodes.forEach(function (n) {
        (graph[n] || []).forEach(function (e) { if (!seen[e.to]) { seen[e.to] = 1; next.push(e.to); } });
      });
      if (!next.length) break;
      orders.push({ order: d, nodes: next });
    }
    return {
      orders: orders.map(function (o) {
        return { order: o.order, items: o.nodes.slice(0, 6),
          certainty: o.order === 1 ? "asserted by a source" : o.order === 2 ? "inferred from one causal link" : "speculative chain",
          label: o.order === 1 ? "direct effect" : o.order === 2 ? "second-order effect" : o.order + "rd-order effect" };
      }),
      caveat: "Beyond the first order, each step multiplies uncertainty. These are questions to investigate, not predictions."
    };
  }

  /** Knowledge compression: a traceable map of a subject in one screen. */
  function compress(index, query) {
    var pool = searchPool(index, query, 12);
    var claims = [];
    pool.forEach(function (r) { claims.push.apply(claims, ev().claimsOf(r.doc).slice(0, 3)); });
    var key = claims.filter(function (c) { return c.kind === "evidence"; }).slice(0, 6);
    var ents = {};
    pool.forEach(function (r) { (r.doc.e || []).forEach(function (e) { ents[e] = (ents[e] || 0) + 1; }); });
    var gaps = gapMatrix(index, query);
    return {
      subject: query,
      entities: Object.keys(ents).sort(function (a, b) { return ents[b] - ents[a]; }).slice(0, 10),
      keyClaims: key, documents: pool.length,
      gaps: gaps.rows.filter(function (r) { return r.state !== "covered"; }),
      oneLine: key.length ? key[0].sentence : (pool.length ? pool[0].doc.t : "Nothing indexed on this subject."),
      traceable: claims.length + " claims, each linked to its document"
    };
  }

  /** Consensus map: where sources agree, hedge and disagree. */
  function consensus(index, query) {
    var pool = searchPool(index, query, 14);
    var buckets = { evidence: [], interpretation: [], hypothesis: [], speculation: [] };
    var byOrg = {};
    pool.forEach(function (r) {
      ev().claimsOf(r.doc).forEach(function (c) {
        (buckets[c.kind] = buckets[c.kind] || []).push({ docId: r.doc.id, org: c.org, date: c.date, sentence: c.sentence });
        byOrg[c.org] = byOrg[c.org] || { evidence: 0, interpretation: 0, hypothesis: 0, speculation: 0 };
        byOrg[c.org][c.kind] = (byOrg[c.org][c.kind] || 0) + 1;
      });
    });
    var agree = ev().independenceReport(pool.map(function (r) { return r.doc; }));
    var ORDER = ["evidence", "interpretation", "hypothesis", "speculation"];
    return {
      agreement: agree.verdict, independentSources: agree.independentSources,
      buckets: ORDER.map(function (k) { return { kind: k, n: (buckets[k] || []).length, examples: (buckets[k] || []).slice(0, 3) }; }),
      byIssuer: Object.keys(byOrg).map(function (o) { return { org: o, mix: byOrg[o] }; }).slice(0, 8),
      note: agree.note
    };
  }

  /** Knowledge inequality: subjects people ask about that the corpus barely covers. */
  function inequality(index) {
    var log = (ANV.learn && ANV.learn.queries) ? ANV.learn.queries() : [];
    var seen = {};
    log.forEach(function (q) { seen[q.q.toLowerCase()] = (seen[q.q.toLowerCase()] || 0) + 1; });
    var asked = Object.keys(seen);
    var rows = asked.map(function (q) {
      var cov = sem().coverage(q);
      var res = searchPool(index, q, 3);
      return { query: q, asks: seen[q], coverage: cov.ratio, bestScore: res.length ? +res[0].score.toFixed(3) : 0,
               verdict: cov.ratio < 0.5 || !res.length ? "under-served" : "served" };
    });
    var under = rows.filter(function (r) { return r.verdict === "under-served"; });
    // subjects in the corpus with very few documents
    var thin = {};
    docsOf(index).forEach(function (d) { (d.k || []).forEach(function (k) { thin[k] = (thin[k] || 0) + 1; }); });
    return {
      asked: asked.length, underServed: under,
      thinTopics: Object.keys(thin).filter(function (k) { return thin[k] <= 1; }).slice(0, 12),
      note: under.length
        ? under.length + " of your " + asked.length + " questions were answered with less than half the query understood. Those are the gaps in this library."
        : "No under-served queries logged yet."
    };
  }

  /** Knowledge impact: how far a finding could travel, from graph position. */
  function impact(index, query) {
    var pool = searchPool(index, query, 10);
    var g = entityGraph(index), vis = visibility(index);
    var rows = pool.map(function (r) {
      var reach = (r.doc.e || []).reduce(function (a, e) { return a + ((g.byEntity[e] || []).length); }, 0);
      var fields = uniq((r.doc.k || []).map(function (k) { return k.split(" ")[0]; })).length;
      var recency = 1 / (1 + Math.abs(new Date().getFullYear() - (r.doc.y || 2024)));
      var score = Math.min(1, (reach / 60) * 0.5 + (fields / 7) * 0.3 + recency * 0.2);
      return { id: r.doc.id, title: r.doc.t, reach: reach, fields: fields, score: +score.toFixed(3),
        centrality: +(vis[r.doc.id] || 0).toFixed(4) };
    }).sort(function (a, b) { return b.score - a.score; });
    return { rows: rows,
      note: "Impact here means graph reach: how many other subjects this finding touches. It says nothing about whether the finding is true or important in the world." };
  }

  /** Ethical consequence prompt: questions a decision about this subject must answer. */
  function ethics(index, query) {
    var pool = searchPool(index, query, 10);
    var text = pool.map(function (r) { return r.doc.b; }).join(" ");
    var present = {
      excluded: /\b(exclu|marginal|rural|remote|disabled|tribal|women|unorganised|informal)\b/i.test(text),
      environment: /\b(emission|carbon|energy|water use|environment|waste|sustainab)\b/i.test(text),
      consent: /\b(consent|privacy|surveillance|data protection|autonom)\b/i.test(text),
      accountability: /\b(audit|accountab|grievance|redress|oversight|transparen)\b/i.test(text),
      labour: /\b(jobs?|employment|labour|labor|livelihood|worker)\b/i.test(text)
    };
    var questions = [
      { q: "Who is excluded from what this makes possible?", covered: present.excluded },
      { q: "What does it cost in energy, water and materials?", covered: present.environment },
      { q: "What consent does it require, and can it be withdrawn?", covered: present.consent },
      { q: "Who can be held to account when it fails?", covered: present.accountability },
      { q: "Which jobs change, and who absorbs the transition?", covered: present.labour }
    ];
    return { questions: questions,
      covered: questions.filter(function (x) { return x.covered; }).length,
      note: "These are prompts, not assessments. The corpus " + (questions.filter(function (x) { return x.covered; }).length ? "touches some of them" : "says nothing about any of them") + "." };
  }

  /** Negative knowledge: what the record says is absent, failed or impossible. */
  function negative(index, query) {
    var pool = searchPool(index, query, 20);
    var rows = [];
    pool.forEach(function (r) {
      ev().claimsOf(r.doc).forEach(function (c) {
        if (/\b(no evidence|not found|no data|absent|impossible|cannot be|failed|failure|lacks?|did not|does not|never)\b/i.test(c.sentence)) {
          rows.push({ docId: r.doc.id, org: c.org, date: c.date, sentence: c.sentence, kind: c.kind });
        }
      });
    });
    return { rows: rows.slice(0, 10),
      note: rows.length ? "These statements record absence, failure or impossibility - knowledge about what is not the case, which is usually thrown away."
        : "No explicit negative statements in the retrieved documents." };
  }

  /** Uncertainty navigator: where the evidence runs out. */
  function uncertaintyNavigator(index, query) {
    var pool = searchPool(index, query, 12);
    var claims = [];
    pool.forEach(function (r) { claims.push.apply(claims, ev().claimsOf(r.doc)); });
    var checked = claims.slice(0, 14).map(function (c) {
      var v = ev().verify(c, index);
      return { claim: c.sentence, kind: c.kind, verdict: v.verdict, support: v.support.length, contradict: v.contradict.length, confidence: v.confidence };
    });
    var supported = checked.filter(function (c) { return c.verdict === "supported"; }).length;
    return {
      checked: checked,
      frontier: checked.filter(function (c) { return c.verdict === "unverified"; }).slice(0, 5),
      ratio: +(supported / Math.max(1, checked.length)).toFixed(2),
      note: supported + " of " + checked.length + " statements could be cross-checked inside this corpus. The rest are single-source: that is exactly where certainty should stop."
    };
  }

  /** Proactive alert: has anything arrived that changes an earlier conclusion? */
  function alerts(index) {
    var watch = (ANV.learn && ANV.learn.watchlist) ? ANV.learn.watchlist() : [];
    return watch.map(function (w) {
      var res = searchPool(index, w.query, 5);
      var newDocs = res.filter(function (r) { return r.doc.y >= (w.sinceYear || 2026); });
      var nowTop = res.length ? res[0].doc.id : null;
      return {
        query: w.query, baselineTop: w.baselineTop, nowTop: nowTop,
        changed: w.baselineTop && nowTop && w.baselineTop !== nowTop,
        newDocuments: newDocs.map(function (r) { return { id: r.doc.id, date: r.doc.d, title: r.doc.t }; }),
        message: w.baselineTop && nowTop && w.baselineTop !== nowTop
          ? "A different document now answers this question. Re-read before reusing your earlier conclusion."
          : "Conclusion still holds: the same document is on top."
      };
    });
  }

  /* --------------------------------------------------------- registry ----- */
  var PARADIGMS = [
    { id: "unknown", label: "Unknown", question: "What is missing, unanswered or unstudied?", run: unknown },
    { id: "possibility", label: "Possibility", question: "What could be true under other conditions?", run: possibility },
    { id: "causal", label: "Causal", question: "What causes what, and on whose evidence?", run: causal },
    { id: "lost", label: "Lost knowledge", question: "What exists but has been forgotten or buried?", run: lost },
    { id: "anomaly", label: "Anomaly", question: "What does not fit the pattern?", run: anomaly },
    { id: "interdisciplinary", label: "Interdisciplinary", question: "Who else has solved this shape of problem?", run: interdisciplinary },
    { id: "reality", label: "Reality", question: "What was measured, as opposed to targeted?", run: reality },
    { id: "simulation", label: "Simulation", question: "What does the arithmetic say, with what interval?", run: simulation },
    { id: "temporal", label: "Temporal", question: "What was known then, and how did it change?", run: temporal },
    { id: "evolutionary", label: "Evolutionary", question: "Can the engine prove it improved?", run: evolutionary }
  ];

  ANV.discovery = {
    PARADIGMS: PARADIGMS, BATTERY: BATTERY,
    run: function (id, query, index, opts) {
      for (var i = 0; i < PARADIGMS.length; i++) if (PARADIGMS[i].id === id) return PARADIGMS[i].run(query, index, opts);
      return null;
    },
    unknown: unknown, possibility: possibility, causal: causal, lost: lost, anomaly: anomaly,
    interdisciplinary: interdisciplinary, reality: reality, simulation: simulation,
    temporal: temporal, evolutionary: evolutionary,
    emerging: emerging, forecast: forecast, gapMatrix: gapMatrix,
    hiddenRelations: hiddenRelations, analogy: analogy, recombination: recombination,
    consequences: consequences, compress: compress, consensus: consensus,
    inequality: inequality, impact: impact, ethics: ethics, negative: negative,
    uncertaintyNavigator: uncertaintyNavigator, alerts: alerts,
    entityGraph: entityGraph, visibility: visibility, fieldOf: fieldOf, evaluate: evaluate
  };

  if (typeof module !== "undefined" && module.exports) module.exports = ANV.discovery;
})(typeof globalThis !== "undefined" ? globalThis : this);
