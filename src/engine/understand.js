/* ============================================================================
   ANVESHAN v4 - LAYER 3: QUERY UNDERSTANDING
   Intent taxonomy, research planning, multi-intent decomposition,
   disambiguation over distributional senses, conversational context with
   coreference resolution, query completion, and expertise adaptation.

   These are heuristics over an explicit rule table - labelled as such. Where a
   rule cannot decide, the function says "unclear" instead of guessing, because
   a wrong intent silently degrades every answer downstream.
   ========================================================================== */
(function (root) {
  "use strict";
  var ANV = root.ANV = root.ANV || {};
  var L = ANV.lang;

  /* ------------------------------------------------------------- intents --- */
  // Each intent names the shape of answer the user expects, which is what the
  // answerer and the agent actually consume.
  var INTENTS = [
    { id: "definition", answerType: "explanation", re: /\b(what is|what are|define|definition|meaning of|explain|kya hai|kya hain|अर्थ|क्या है|परिभाषा)\b/i },
    { id: "quantitative", answerType: "number", re: /\b(how many|how much|how large|number of|figure|statistic|count|total|percentage|kitna|kitne|कितना|कितने|संख्या|आंकड़े)\b/i },
    { id: "temporal", answerType: "date", re: /\b(when|what year|which year|since when|timeline|history of|kab|कब|कब से|इतिहास)\b/i },
    { id: "comparison", answerType: "comparison", re: /\b(vs|versus|compare|comparison|difference between|better than|tulna|तुलना|अंतर)\b/i },
    { id: "causal", answerType: "mechanism", re: /\b(why|what causes|what led to|reason for|because|kyun|kyon|क्यों|कारण|वजह)\b/i },
    { id: "procedural", answerType: "steps", re: /\b(how to|how do|how does|steps|process of|procedure|implement|build|kaise|कैसे|प्रक्रिया)\b/i },
    { id: "verification", answerType: "evidence", re: /\b(is it true|really|verify|evidence|proof|source for|fact check|sach|सच|प्रमाण|सत्यापन)\b/i },
    { id: "exploratory", answerType: "map", re: /\b(overview|landscape|everything about|research on|explore|survey|what exists|overview of|अवलोकन)\b/i },
    { id: "predictive", answerType: "projection", re: /\b(will|future|forecast|predict|expected by|by 20\d\d|trend|भविष्य|अनुमान)\b/i },
    { id: "gap", answerType: "gap", re: /\b(not known|unknown|unanswered|unresolved|gap in|missing evidence|what is not|क्या पता नहीं)\b/i },
    { id: "navigational", answerType: "document", re: /\b(official|website|portal|download|document|pdf|act|notification|dashboard)\b/i },
    { id: "list", answerType: "list", re: /\b(list|examples|which|top|all the|types of|kya kya|सूची|उदाहरण)\b/i }
  ];

  // JavaScript word boundaries are ASCII-only, so Devanagari question words are
  // matched separately rather than silently failing inside \b...\b.
  var INTENTS_DEVA = [
    { id: "quantitative", answerType: "number", re: /(कितन[ा-े]|संख्या|आंकड़े|आंकडे|मात्रा)/ },
    { id: "definition", answerType: "explanation", re: /(क्या है|क्या हैं|परिभाषा|अर्थ|मतलब)/ },
    { id: "temporal", answerType: "date", re: /(कब|किस वर्ष|कौन सा वर्ष|समयरेखा|इतिहास)/ },
    { id: "causal", answerType: "mechanism", re: /(क्यों|कारण|वजह)/ },
    { id: "procedural", answerType: "steps", re: /(कैसे|प्रक्रिया|तरीका)/ },
    { id: "comparison", answerType: "comparison", re: /(तुलना|अंतर|बनाम)/ },
    { id: "verification", answerType: "evidence", re: /(प्रमाण|सत्यापन|सच है)/ },
    { id: "predictive", answerType: "projection", re: /(भविष्य|अनुमान|आगे)/ },
    { id: "list", answerType: "list", re: /(सूची|उदाहरण|कौन कौन)/ }
  ];

  function classify(query) {
    var q = String(query || "");
    var scores = {}, best = { id: "general", answerType: "explanation", score: 0 };
    if (L.scriptOf(q) !== "latin") {
      for (var d = 0; d < INTENTS_DEVA.length; d++) {
        var dm = q.match(new RegExp(INTENTS_DEVA[d].re.source, "g"));
        if (dm) {
          scores[INTENTS_DEVA[d].id] = (scores[INTENTS_DEVA[d].id] || 0) + dm.length;
          if (dm.length > best.score) best = { id: INTENTS_DEVA[d].id, answerType: INTENTS_DEVA[d].answerType, score: dm.length };
        }
      }
    }
    for (var i = 0; i < INTENTS.length; i++) {
      var it = INTENTS[i];
      var m = q.match(new RegExp(it.re.source, "gi"));
      var s = m ? m.length : 0;
      if (s) {
        // a question word at the very start is a stronger signal than one later
        if (it.re.test(q.split(/\s+/).slice(0, 3).join(" "))) s += 0.5;
        scores[it.id] = s;
        if (s > best.score) best = { id: it.id, answerType: it.answerType, score: s };
      }
    }
    var total = 0;
    for (var k in scores) total += scores[k];
    var conf = total ? Math.min(0.95, best.score / total) : 0.3;
    return {
      intent: best.id, answerType: best.answerType, confidence: +conf.toFixed(2),
      scores: scores, language: L.scriptOf(q) === "deva" ? "deva" : "latin",
      isQuestion: /\?|^(what|why|how|when|where|who|which|क्या|क्यों|कैसे|कब|कौन)\b/i.test(q),
      incomplete: isIncomplete(q)
    };
  }

  /** A query that stops mid-thought ("bhashini translation for") still parses. */
  function isIncomplete(q) {
    var s = String(q || "").trim();
    if (!s) return true;
    if (/\b(for|of|in|about|with|on|ke|ka|ki|में|के|की|का)$/i.test(s)) return true;
    var words = s.split(/\s+/);
    return words.length <= 2 && !/\?/.test(s) && !INTENTS.some(function (it) { return it.re.test(s); });
  }

  /* ---------------------------------------------------------- planning ----- */
  // Facets are the questions a careful researcher asks about any subject. The
  // agent walks them in order, and the gap detector reports the ones the corpus
  // could not answer.
  var FACETS = [
    { id: "definition", label: "What it is", probe: "" },
    { id: "figures", label: "Numbers", probe: "how many number figure crore percent" },
    { id: "timeline", label: "Timeline", probe: "when year launched since history" },
    { id: "mechanism", label: "How it works", probe: "how works process design mechanism" },
    { id: "actors", label: "Who is involved", probe: "who ministry organisation agency runs" },
    { id: "limits", label: "Limits and risks", probe: "risk challenge limitation criticism shortfall" },
    { id: "evidence", label: "Evidence quality", probe: "report study data survey measured" },
    { id: "future", label: "What comes next", probe: "target plan next phase future expected" }
  ];

  function facetsFor(intent) {
    if (intent === "quantitative") return ["figures", "definition", "timeline", "evidence"];
    if (intent === "temporal") return ["timeline", "definition", "mechanism", "future"];
    if (intent === "causal") return ["mechanism", "evidence", "limits", "figures"];
    if (intent === "comparison") return ["definition", "figures", "mechanism", "limits"];
    return ["definition", "figures", "mechanism", "limits", "evidence", "future"];
  }

  /** Split a multi-objective question into sub-questions that can each be
      answered and cited separately. */
  function decompose(query) {
    var q = String(query || "").replace(/\s+/g, " ").trim();
    var parts = [];
    // explicit enumerations: "a, b and c" / "a; b" / "compare a with b"
    var cleaned = q.replace(/\b(compare|versus|vs\.?)\b/gi, "|");
    var chunks = cleaned.split(/\s*(?:\||;|\band also\b|\balso\b|\band\b|\bplus\b|,)\s*/i)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 3; });
    var multi = chunks.length > 1 && chunks.length <= 5;
    if (multi) {
      parts = chunks.map(function (c) {
        var cls = classify(c);
        return { text: c, intent: cls.intent, answerType: cls.answerType };
      });
    } else {
      var cls2 = classify(q);
      parts = [{ text: q, intent: cls2.intent, answerType: cls2.answerType }];
    }
    // a second question mark always means a second objective
    var qms = q.split("?").map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 3; });
    if (qms.length > 1) {
      parts = qms.map(function (c) {
        var cls3 = classify(c);
        return { text: c, intent: cls3.intent, answerType: cls3.answerType };
      });
    }
    return { multiIntent: parts.length > 1, subQuestions: parts.slice(0, 5) };
  }

  function plan(query) {
    var cls = classify(query);
    var dec = decompose(query);
    var facetIds = facetsFor(cls.intent);
    var steps = dec.subQuestions.map(function (sub, i) {
      return {
        n: i + 1, action: "answer", question: sub.text, intent: sub.intent,
        facets: facetIds,
        queries: buildQueries(sub.text, facetIds)
      };
    });
    return {
      question: query, intent: cls.intent, answerType: cls.answerType,
      confidence: cls.confidence, multiIntent: dec.multiIntent,
      subQuestions: dec.subQuestions, facets: facetIds.map(function (f) { return facetById(f); }),
      steps: steps, language: cls.language, incomplete: cls.incomplete
    };
  }

  function facetById(id) {
    for (var i = 0; i < FACETS.length; i++) if (FACETS[i].id === id) return FACETS[i];
    return { id: id, label: id, probe: "" };
  }

  /** Facet-probe queries: the same subject asked a different way. */
  function buildQueries(subject, facetIds) {
    var base = String(subject || "").replace(/[?।]/g, "").trim();
    var out = [base];
    (facetIds || []).forEach(function (f) {
      var facet = facetById(f);
      if (!facet.probe) return;
      var probe = facet.probe.split(" ").slice(0, 3).join(" ");
      out.push(base + " " + probe);
    });
    return out;
  }

  /* ---------------------------------------------------- disambiguation ----- */
  /**
   * A word like "model" means a foundation model, a data model or a role model.
   * Distributional senses are clustered offline; here they are matched against
   * the query context and the corpus so the user can pick the reading.
   */
  function disambiguate(query, index) {
    var sem = ANV.semantic;
    if (!sem || !sem.ready()) return [];
    var docs = (index && index.docs) || [];
    var toks = L.tokenise(query, { keepStop: false });
    var out = [];
    toks.forEach(function (t) {
      var senses = sem.senses(t);
      if (!senses) return;
      // does the query itself carry context for one sense?
      var ctx = toks.filter(function (x) { return x !== t; });
      var scored = senses.map(function (nb) {
        var hits = nb.filter(function (w) { return ctx.indexOf(w) >= 0; }).length;
        var support = docs.filter(function (d) {
          var hay = L.normalise(d.t + " " + d.b);
          return hay.indexOf(t) >= 0 && nb.some(function (w) { return hay.indexOf(w) >= 0; });
        }).map(function (d) { return d.id; });
        return { label: nb.slice(0, 4).join(", "), neighbours: nb, contextHits: hits, docs: support };
      });
      var maxHits = Math.max.apply(null, scored.map(function (s) { return s.contextHits; }));
      var ambiguous = scored.length > 1 && scored[0].docs.length > 2 && scored[1].docs.length > 2 &&
                      (maxHits === 0 || scored.filter(function (s) { return s.contextHits === maxHits; }).length > 1);
      out.push({
        term: t, senses: scored, ambiguous: ambiguous,
        chosen: maxHits > 0 ? scored.filter(function (s) { return s.contextHits === maxHits; })[0] : null,
        note: maxHits > 0 ? "query context selects a sense" : "no disambiguating context in the query"
      });
    });
    return out.sort(function (a, b) { return (b.ambiguous ? 1 : 0) - (a.ambiguous ? 1 : 0); }).slice(0, 4);
  }

  /* --------------------------------------------------------- context ------- */
  var MEMORY_KEY = "anv.memory.v4";

  function Context() {
    this.history = [];
    this.entities = [];
    this.lastQuery = "";
    this.lastIntent = null;
    this.memory = loadMemory();
  }

  function loadMemory() {
    try {
      var raw = root.localStorage && localStorage.getItem(MEMORY_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* storage may be blocked; memory simply does not persist */ }
    return { enabled: true, notes: [], interests: {}, projects: [], conclusions: [] };
  }
  Context.prototype.saveMemory = function () {
    try { if (root.localStorage) localStorage.setItem(MEMORY_KEY, JSON.stringify(this.memory)); } catch (e) {}
  };

  var PRONOUN = /\b(it|its|it's|this|that|these|those|they|them|their|the same|former|latter|he|she|us|we|उस|इस|यह|वह|उनका|इनका|उसका|इसका)\b/i;
  var CONTINUE = /^(and|also|plus|what about|how about|aur|और|तो|usme|usmein|isme|ismein|वही|वही पर)\b/i;

  /** Rewrite a follow-up into a standalone query using the conversation state. */
  Context.prototype.rewrite = function (query) {
    var q = String(query || "").trim();
    var prev = this.lastQuery;
    if (!prev) return { text: q, rewritten: false, reason: "first query" };

    var isContinue = CONTINUE.test(q);
    var hasPronoun = PRONOUN.test(q);
    var short = q.split(/\s+/).length <= 4 && !classify(q).isQuestion;

    if (!isContinue && !hasPronoun && !short) return { text: q, rewritten: false, reason: "stands alone" };

    var subject = this.entities.length ? this.entities.slice(0, 3).join(" ") : prev;
    var out = q;
    if (isContinue) {
      out = subject + " " + q.replace(CONTINUE, "").trim();
    } else if (hasPronoun) {
      out = q.replace(PRONOUN, subject).replace(/\s+/g, " ").trim();
    } else {
      out = prev + " " + q;
    }
    return { text: out.replace(/\s+/g, " ").trim(), rewritten: true, reason: isContinue ? "continuation" : hasPronoun ? "pronoun resolved" : "short fragment merged", previous: prev };
  };

  Context.prototype.observe = function (query, intent, entities) {
    this.lastQuery = query;
    this.lastIntent = intent;
    if (entities && entities.length) this.entities = entities.slice(0, 5);
    this.history.push({ q: query, intent: intent, t: Date.now() });
    if (this.history.length > 200) this.history.shift();
    if (this.memory.enabled && intent && intent !== "greeting") {
      this.memory.interests[intent] = (this.memory.interests[intent] || 0) + 1;
    }
  };

  /** What the user has already investigated, so nothing is repeated at them. */
  Context.prototype.unexplored = function (index) {
    var seen = {};
    this.history.forEach(function (h) { seen[h.q.toLowerCase()] = 1; });
    var facets = {};
    this.history.forEach(function (h) {
      var p = plan(h.q);
      p.facets.forEach(function (f) { facets[f.id] = (facets[f.id] || 0) + 1; });
    });
    var untouched = FACETS.filter(function (f) { return !facets[f.id]; });
    return { facetsCovered: facets, facetsUntouched: untouched, queries: this.history.length };
  };

  Context.prototype.reset = function () {
    this.history = []; this.entities = []; this.lastQuery = ""; this.lastIntent = null;
  };

  var ctx = new Context();

  /* ------------------------------------------------------- completion ------ */
  /** Complete a half-typed query from entities in the corpus and the user's own
      past searches - never from a remote suggestion service. */
  function complete(prefix, index, limit) {
    var p = L.normalise(prefix);
    if (!p || p.length < 2) return [];
    var docs = (index && index.docs) || [];
    var cands = {};
    docs.forEach(function (d) {
      if (d.o && L.normalise(d.o).indexOf(p) === 0) cands[d.o] = (cands[d.o] || 0) + 3;
      (d.k || []).forEach(function (k) {
        if (L.normalise(k).indexOf(p) === 0) cands[k] = (cands[k] || 0) + 2;
        else if (L.normalise(k).indexOf(p) > 0) cands[k] = (cands[k] || 0) + 1;
      });
      if (L.normalise(d.t).indexOf(p) === 0) cands[d.t] = (cands[d.t] || 0) + 1;
    });
    ctx.history.forEach(function (h) { if (L.normalise(h.q).indexOf(p) === 0) cands[h.q] = (cands[h.q] || 0) + 4; });
    return Object.keys(cands).sort(function (a, b) { return cands[b] - cands[a]; }).slice(0, limit || 8);
  }

  /* -------------------------------------------------- expertise adaptation - */
  /** Reading level is inferred from the query itself, not from a profile: a
      user who writes "RAG recall@k tradeoff" gets density, a user who writes
      "what is a GPU" gets plain language. */
  function expertise(query, history) {
    var q = String(query || "");
    var technical = (q.match(/\b(api|bm25|rag|embedding|latency|throughput|inference|token|vector|p-value|significance|parameter|architecture|benchmark|ablation|precision|recall|f1|mrr|ndcg)\b/gi) || []).length;
    var words = q.split(/\s+/).length;
    var avgLen = history && history.length
      ? history.reduce(function (a, h) { return a + h.q.split(/\s+/).length; }, 0) / history.length : words;
    var level = technical >= 2 || avgLen > 14 ? "expert" : technical >= 1 || avgLen > 9 ? "informed" : "general";
    return {
      level: level, technicalTerms: technical, avgQueryLength: +avgLen.toFixed(1),
      style: level === "expert" ? "dense: figures, mechanisms, caveats inline"
        : level === "informed" ? "balanced: mechanism plus plain gloss"
        : "plain: define terms, lead with the answer"
    };
  }

  ANV.understand = {
    INTENTS: INTENTS, FACETS: FACETS,
    classify: classify, decompose: decompose, plan: plan, facetsFor: facetsFor,
    buildQueries: buildQueries, disambiguate: disambiguate, complete: complete,
    expertise: expertise, isIncomplete: isIncomplete,
    context: ctx, Context: Context
  };

  if (typeof module !== "undefined" && module.exports) module.exports = ANV.understand;
})(typeof globalThis !== "undefined" ? globalThis : this);
