/* ============================================================================
   ANVESHAN v4 - LAYER 6: THE AUTONOMOUS INVESTIGATOR
   A bounded, multi-round research loop: plan -> retrieve -> read -> verify ->
   find the gap -> re-query -> synthesise. Every step is written to a trace so
   the investigation can be audited or reproduced.

   Also here: hypothesis generation, experiment design, discriminating tests,
   reproducibility checks, and a registry of failed hypotheses - because a
   system that only remembers its successes learns nothing.
   ========================================================================== */
(function (root) {
  "use strict";
  var ANV = root.ANV = root.ANV || {};
  var L = ANV.lang;

  function sem() { return ANV.semantic; }
  function ev() { return ANV.evidence; }
  function und() { return ANV.understand; }
  function disc() { return ANV.discovery; }
  function docsOf(index) { return (index && index.docs) || root.DOCS || []; }

  var FAILED_KEY = "anv.v4.failedHypotheses";

  function loadFailed() {
    try { var raw = root.localStorage && localStorage.getItem(FAILED_KEY); if (raw) return JSON.parse(raw); } catch (e) {}
    return [];
  }
  function saveFailed(list) {
    try { if (root.localStorage) localStorage.setItem(FAILED_KEY, JSON.stringify(list.slice(-60))); } catch (e) {}
  }

  /**
   * Investigate a question.
   * opts: { rounds, budget, asOfYear, onStep }
   */
  function investigate(query, index, opts) {
    opts = opts || {};
    var t0 = Date.now();
    var maxRounds = Math.max(1, Math.min(4, opts.rounds || 3));
    var budget = opts.budget || 18;
    var plan = und().plan(query);
    var trace = [], seen = {}, pool = [], claims = [], verified = [];
    var queriesRun = 0;

    function step(kind, detail) {
      var row = { n: trace.length + 1, kind: kind, detail: detail };
      trace.push(row);
      if (typeof opts.onStep === "function") { try { opts.onStep(row); } catch (e) {} }
      return row;
    }

    function retrieve(q, why, limit) {
      if (queriesRun >= budget) return [];
      queriesRun++;
      var res = sem().hybrid(index, q, { limit: limit || 8 }, root.search);
      var added = 0;
      res.forEach(function (r) {
        if (seen[r.doc.id]) return;
        seen[r.doc.id] = 1; pool.push(r); added++;
      });
      step("retrieve", { query: q, why: why, results: res.length, newDocuments: added });
      return res;
    }

    step("plan", { intent: plan.intent, answerType: plan.answerType, facets: plan.facets.map(function (f) { return f.id; }),
                   subQuestions: plan.subQuestions.map(function (s) { return s.text; }) });

    // ---- round 1: answer the question as asked
    plan.subQuestions.forEach(function (sub) { retrieve(sub.text, "primary question", 10); });

    // ---- round 2..n: walk the facets, then close the gaps the walk exposes
    var round = 1, openFacets = plan.facets.slice();
    while (round < maxRounds && openFacets.length && queriesRun < budget) {
      round++;
      var nextFacets = [];
      openFacets.forEach(function (f) {
        if (queriesRun >= budget) { nextFacets.push(f); return; }
        var probe = plan.subQuestions[0].text + " " + (f.probe || "");
        var res = retrieve(probe.trim(), "facet: " + f.label, 6);
        var best = res.length ? res[0].score : 0;
        if (best < 0.18) nextFacets.push(f);   // still unanswered: try another angle next round
      });
      // if a facet stayed empty, try its nearest concept instead of the literal wording
      if (nextFacets.length && round === maxRounds) {
        nextFacets.slice(0, 2).forEach(function (f) {
          var nb = sem().neighbours(plan.subQuestions[0].text.split(/\s+/).pop(), 3);
          if (nb.length) retrieve(plan.subQuestions[0].text + " " + nb.join(" "), "reformulated: " + f.label, 6);
        });
      }
      openFacets = nextFacets;
    }

    // ---- read: extract and verify claims from the strongest documents
    var top = pool.slice().sort(function (a, b) { return b.score - a.score; }).slice(0, 10);
    top.forEach(function (r) {
      var cs = ev().claimsOf(r.doc);
      claims.push.apply(claims, cs.slice(0, 4));
    });
    step("read", { documents: top.length, claims: claims.length });

    var checkable = claims.filter(function (c) { return c.numbers.length || c.kind === "evidence"; }).slice(0, 12);
    checkable.forEach(function (c) { verified.push(ev().verify(c, index)); });
    step("verify", {
      checked: verified.length,
      supported: verified.filter(function (v) { return v.verdict === "supported"; }).length,
      contradicted: verified.filter(function (v) { return v.verdict === "contradicted" || v.verdict === "disputed"; }).length,
      unverified: verified.filter(function (v) { return v.verdict === "unverified"; }).length
    });

    // ---- gap analysis on the facets that never got a strong answer
    var matrix = disc().gapMatrix(index, plan.subQuestions[0].text);
    step("gap", { gaps: matrix.gaps, covered: matrix.covered });

    // ---- contradictions and independence
    var contra = ev().contradictionLab(query, index, { limit: 6 });
    var indep = ev().independenceReport(top.map(function (r) { return r.doc; }));
    step("cross-check", { contradictions: contra.length, independentSources: indep.independentSources, verdict: indep.verdict });

    // ---- synthesis
    var supported = verified.filter(function (v) { return v.verdict === "supported"; })
      .sort(function (a, b) { return b.confidence - a.confidence; });
    var disputed = verified.filter(function (v) { return v.verdict === "contradicted" || v.verdict === "disputed"; });
    var findings = [];
    (supported.length ? supported : verified).slice(0, 6).forEach(function (v) {
      findings.push({
        statement: v.claim.sentence, kind: v.claim.kind, docId: v.claim.docId, org: v.claim.org, date: v.claim.date,
        verdict: v.verdict, confidence: v.confidence,
        corroboratedBy: v.support.map(function (s) { return s.id; }).slice(0, 3),
        disputedBy: v.contradict.map(function (s) { return s.id; }).slice(0, 3)
      });
    });
    if (!findings.length) {
      top.slice(0, 4).forEach(function (r) {
        findings.push({ statement: r.doc.b.split(/(?<=[.!?])\s+/)[0], kind: "statement", docId: r.doc.id,
                        org: r.doc.o, date: r.doc.d, verdict: "unverified", confidence: 0.3, corroboratedBy: [], disputedBy: [] });
      });
    }

    var confidence = findings.length
      ? +(findings.reduce(function (a, f) { return a + f.confidence; }, 0) / findings.length * (indep.independentSources >= 3 ? 1 : 0.8)).toFixed(2)
      : 0.1;

    var dossier = {
      question: query, plan: plan,
      findings: findings,
      contradictions: contra,
      gaps: matrix.rows.filter(function (r) { return r.state !== "covered"; }),
      coverage: sem().coverage(query),
      independence: indep,
      uncertainty: {
        verified: verified.length,
        supportedRatio: +(verified.filter(function (v) { return v.verdict === "supported"; }).length / Math.max(1, verified.length)).toFixed(2),
        note: verified.length ? "Statements were checked against the rest of the corpus, not against the world."
                              : "Nothing checkable was found; treat the findings as leads."
      },
      hypotheses: hypotheses(query, index).slice(0, 3),
      nextSteps: nextSteps(plan, matrix, contra),
      trace: trace,
      documents: top.map(function (r) { return { id: r.doc.id, title: r.doc.t, org: r.doc.o, date: r.doc.d, score: +r.score.toFixed(3) }; }),
      stats: { rounds: round, queries: queriesRun, documentsRead: top.length, ms: Date.now() - t0 },
      confidence: confidence,
      label: confidence > 0.7 ? "well supported inside this corpus" : confidence > 0.45 ? "partly supported" : "leads only"
    };
    dossier.markdown = toMarkdown(dossier);
    return dossier;
  }

  function nextSteps(plan, matrix, contra) {
    var out = [];
    matrix.rows.filter(function (r) { return r.state === "gap"; }).slice(0, 3).forEach(function (r) {
      out.push("Find a primary source on " + r.label.toLowerCase() + " for this subject - nothing in the index answers it.");
    });
    if (contra.length) out.push("Resolve the figure conflict on " + contra[0].key + " before quoting either number.");
    if (plan.multiIntent) out.push("Answer each sub-question separately; a single answer would conflate them.");
    out.push("Add the missing document with the Import panel: the engine will re-verify against it immediately.");
    return out.slice(0, 5);
  }

  function toMarkdown(d) {
    var md = [];
    md.push("# " + d.question);
    md.push("");
    md.push("_Confidence: " + d.confidence + " - " + d.label + ". " + d.stats.queries + " queries over " + d.stats.rounds + " rounds, " + d.stats.documentsRead + " documents read._");
    md.push("");
    md.push("## Findings");
    d.findings.forEach(function (f) {
      md.push("- **" + f.verdict + "** (" + f.org + ", " + f.date + "): " + f.statement);
      if (f.corroboratedBy.length) md.push("  - corroborated by " + f.corroboratedBy.join(", "));
      if (f.disputedBy.length) md.push("  - disputed by " + f.disputedBy.join(", "));
    });
    if (d.contradictions.length) {
      md.push("");
      md.push("## Unresolved conflicts");
      d.contradictions.forEach(function (c) { md.push("- " + c.key + ": " + c.note); });
    }
    if (d.gaps.length) {
      md.push("");
      md.push("## What this corpus cannot answer");
      d.gaps.forEach(function (g) { md.push("- " + g.label + " (" + g.state + ")"); });
    }
    md.push("");
    md.push("## Next steps");
    d.nextSteps.forEach(function (s) { md.push("- " + s); });
    md.push("");
    md.push("## Trace");
    d.trace.forEach(function (t) { md.push(t.n + ". " + t.kind + " - " + JSON.stringify(t.detail)); });
    md.push("");
    md.push("_Every statement above is quoted from an indexed document. Nothing was generated by a model._");
    return md.join("\n");
  }

  /* ============================== SCIENCE ================================ */
  /**
   * Testable hypotheses, derived from what the corpus does NOT settle. A
   * hypothesis is only offered when it names an observable outcome that could
   * turn out either way.
   */
  function hypotheses(query, index) {
    var matrix = disc().gapMatrix(index, query);
    var causal = disc().causal(query, index);
    var out = [];
    var weak = matrix.rows.filter(function (r) { return r.state !== "covered"; });
    if (!weak.length) {
      // nothing is outright missing: the weakest facet is still the open question
      weak = matrix.rows.slice().sort(function (a, b) { return a.strength - b.strength; }).slice(0, 1)
        .map(function (r) { return Object.assign({}, r, { state: "thin" }); });
    }
    weak.slice(0, 3).forEach(function (r) {
      out.push({
        text: "For \"" + query + "\", " + r.label.toLowerCase() + " is under-documented because the effect is small, not because it is absent.",
        tests: "Measure " + r.label.toLowerCase() + " directly in a sample where it should be visible.",
        prediction: "If the effect is real, a direct measurement will exceed the noise floor in the same units the corpus uses.",
        falsifiedIf: "A direct measurement returns a value indistinguishable from zero across independent samples.",
        source: "gap in facet: " + r.facet
      });
    });
    causal.chains.slice(0, 2).forEach(function (c) {
      out.push({
        text: "\"" + c.cause + "\" drives \"" + c.effect + "\" through a mechanism the sources assert but do not measure.",
        tests: "Intervene on " + c.cause + " and hold everything else fixed; watch " + c.effect + ".",
        prediction: "A change in " + c.cause + " should move " + c.effect + " in the same direction, with a lag.",
        falsifiedIf: c.effect + " moves independently of " + c.cause + ", or moves before it.",
        source: c.chain
      });
    });
    return out;
  }

  /** A design sketch for testing one hypothesis. Deliberately conservative. */
  function experimentDesign(hyp) {
    hyp = hyp || { text: "unspecified hypothesis" };
    return {
      hypothesis: hyp.text,
      variables: {
        independent: "the thing being changed: " + (hyp.tests || "the intervention"),
        dependent: "the measured outcome: " + (hyp.prediction || "the predicted quantity"),
        controls: ["same population definition", "same measurement instrument", "same time window", "same unit scale"]
      },
      arms: ["intervention", "no-change control"],
      measurement: "Use the units the corpus already reports so the result is comparable to the existing figures.",
      sample: "Pre-register the size before running; a result that only appears after looking at the data is not a result.",
      analysis: "Report the effect size and interval, not only a significance test.",
      stops: ["Stop if the control arm moves with the intervention arm: that means a shared cause, not an effect."],
      record: "Write the outcome into the failed-hypothesis registry whether it confirms or not."
    };
  }

  /** What result would separate two competing explanations? */
  function discriminatingExperiment(a, b) {
    return {
      a: a, b: b,
      design: "Find an observation where the two explanations predict different values, then measure only that.",
      question: "What would be true under \"" + a + "\" that would be false under \"" + b + "\"?",
      checklist: [
        "Both explanations must survive the same evidence so far - otherwise the question is already settled.",
        "The distinguishing observation must be measurable with the instruments you have.",
        "Pre-register the predicted values for both before measuring.",
        "A result consistent with both explanations has not discriminated anything."
      ]
    };
  }

  /** Reproducibility: does the document say enough for someone to repeat it? */
  function reproducibility(index) {
    var docs = docsOf(index);
    var rows = docs.filter(function (d) { return d.ty === "paper" || d.ty === "science" || d.ty === "dataset"; })
      .map(function (d) {
        var b = String(d.b || "");
        var marks = {
          method: /\b(method|methodology|protocol|procedure|design)\b/i.test(b),
          data: /\b(dataset|data set|sample|corpus|n\s*=\s*\d+|observations)\b/i.test(b),
          code: /\b(code|repository|github|notebook|script)\b/i.test(b),
          instrument: /\b(instrument|telescope|sensor|detector|assay|spectrometer)\b/i.test(b),
          uncertainty: /\b(uncertainty|confidence interval|error bar|standard deviation|margin of error)\b/i.test(b)
        };
        var score = Object.keys(marks).filter(function (k) { return marks[k]; }).length / 5;
        return { id: d.id, title: d.t, org: d.o, marks: marks, score: +score.toFixed(2),
                 verdict: score >= 0.6 ? "repeatable" : score >= 0.4 ? "partly repeatable" : "not repeatable from the text" };
      });
    return {
      rows: rows,
      summary: rows.length ? rows.filter(function (r) { return r.verdict === "repeatable"; }).length + " of " + rows.length + " research documents describe enough to repeat" : "no research documents indexed",
      note: "Judged from the abstract-level text only. A missing marker means the summary did not mention it, not that the study lacked it."
    };
  }

  /** Compare a projection made earlier with a measurement made later. */
  function predictedVersusObserved(index, query) {
    var pool = sem().hybrid(index, query, { limit: 12 }, root.search);
    var projections = [], observations = [];
    pool.forEach(function (r) {
      ev().claimsOf(r.doc).forEach(function (c) {
        if (!c.numbers.length) return;
        var isProj = c.target || /\b(target|projected|expected|by 20\d\d)\b/i.test(c.sentence);
        c.numbers.forEach(function (n) {
          if (n.family === "count") return;
          var row = { docId: r.doc.id, org: c.org, date: c.date, value: n.base, raw: n.raw, family: n.family, sentence: c.sentence };
          if (isProj) projections.push(row); else observations.push(row);
        });
      });
    });
    var comparisons = [];
    projections.forEach(function (p) {
      var obs = observations.filter(function (o) { return o.family === p.family && o.date > p.date; });
      if (!obs.length) return;
      var best = obs[obs.length - 1];
      comparisons.push({
        family: p.family, projected: p, observed: best,
        error: +(((best.value - p.value) / Math.max(1e-9, p.value)) * 100).toFixed(1),
        verdict: Math.abs((best.value - p.value) / Math.max(1e-9, p.value)) < 0.1 ? "on track" : best.value < p.value ? "behind projection" : "ahead of projection"
      });
    });
    return { comparisons: comparisons.slice(0, 6), projections: projections.length, observations: observations.length,
      note: comparisons.length ? "Projections compared against later measurements in the same unit family." : "No projection has a later measurement to compare against yet." };
  }

  var failed = loadFailed();

  ANV.agent = {
    investigate: investigate, toMarkdown: toMarkdown,
    hypotheses: hypotheses, experimentDesign: experimentDesign,
    discriminatingExperiment: discriminatingExperiment,
    reproducibility: reproducibility, predictedVersusObserved: predictedVersusObserved,
    failed: function () { return failed.slice(); },
    recordFailure: function (entry) {
      failed.push(Object.assign({ ts: Date.now() }, entry));
      saveFailed(failed);
      return failed.length;
    },
    clearFailures: function () { failed = []; saveFailed(failed); }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = ANV.agent;
})(typeof globalThis !== "undefined" ? globalThis : this);
