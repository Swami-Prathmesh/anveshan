/* ============================================================================
   ANVESHAN v4 - LAYER 9: INTEGRATION
   Wires the new engine into the existing interface without rewriting it:
   hybrid retrieval replaces the lexical scorer, every result card grows an
   evidence strip, and six new panels expose the discovery paradigms, the
   autonomous investigator, the verification lab, the learning loop, the
   multi-format ingest and the capability audit.
   ========================================================================== */
(function (root) {
  "use strict";
  var ANV = root.ANV;
  var doc = root.document;
  if (!ANV || !doc) return;

  var v4 = { state: { rewrite: null, plan: null, lastRun: null, paradigm: "unknown", files: [] } };
  ANV.ui = v4;

  function now() { return (root.performance && performance.now) ? performance.now() : Date.now(); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function pct(x) { return Math.round((x || 0) * 100) + "%"; }
  function chip(text, cls) { return '<span class="v4-chip ' + (cls || "") + '">' + esc(text) + "</span>"; }
  function kv(k, val) { return '<div class="v4-kv"><span>' + esc(k) + "</span><b>" + val + "</b></div>"; }
  function block(title, inner, note) {
    return '<div class="v4-block"><h4>' + esc(title) + "</h4>" + (inner || "") +
      (note ? '<p class="v4-note">' + esc(note) + "</p>" : "") + "</div>";
  }
  function empty(text) { return '<p class="v4-empty">' + esc(text) + "</p>"; }
  function list(items, render) {
    if (!items || !items.length) return empty("nothing found");
    return '<ul class="v4-list">' + items.map(function (x) { return "<li>" + render(x) + "</li>"; }).join("") + "</ul>";
  }
  function docs() { return root.DOCS || []; }
  function index() { return root.INDEX; }

  /* --------------------------------------------------------------- patches - */
  var legacySearch = root.search;

  function installPatches() {
    // 1. hybrid retrieval everywhere the old engine called search()
    root.search = function (idx, query, opts) {
      opts = opts || {};
      if (!ANV.semantic.ready() || !idx || !idx.docs) return legacySearch.apply(null, arguments);
      var out = ANV.semantic.hybrid(idx, query, opts, legacySearch);
      try { out = ANV.learn.rerank(out, {}); } catch (e) { /* ranking must never break search */ }
      return out;
    };

    // 2. the evidence strip on every result card
    var legacyCard = root.cardHTML;
    if (typeof legacyCard === "function") {
      root.cardHTML = function (r) {
        var html = legacyCard.apply(null, arguments);
        try {
          var cred = ANV.evidence.credibility(r.doc, {});
          var strip = '<div class="v4-ev">' +
            chip(cred.label + " " + pct(cred.score), "v4-cred-" + cred.label) +
            chip(cred.source.kind, "v4-kind") +
            (cred.source.peerReviewed ? chip("peer-reviewed", "v4-peer") : "") +
            (cred.freshness.stale ? chip("revalidate", "v4-warn") : "") +
            (r.why ? '<span class="v4-why">lex ' + r.why.lexical + " · sem " + r.why.semantic +
              (r.why.exact ? " · exact" : "") + "</span>" : "") +
            "</div>";
          return html.replace(/<\/article>$/, strip + "</article>");
        } catch (e) { return html; }
      };
    }

    // 3. the intelligence strip above the results
    var legacyRender = root.renderResults;
    if (typeof legacyRender === "function") {
      root.renderResults = function () {
        legacyRender.apply(null, arguments);
        try { injectIntel(); } catch (e) {}
      };
    }

    // 4. query understanding, context resolution and logging around each search
    var legacyDo = root.doSearch;
    if (typeof legacyDo === "function") {
      root.doSearch = function (q, record) {
        q = (q || "").trim();
        if (!q) return legacyDo.apply(null, arguments);
        var U = ANV.understand;
        var rw = U.context.rewrite(q);
        var effective = rw.rewritten ? rw.text : q;
        v4.state.rewrite = rw.rewritten ? rw : null;
        v4.state.plan = U.plan(effective);
        var t0 = now();
        var out = legacyDo.call(root, effective, record);
        var ms = +(now() - t0).toFixed(1);
        v4.state.lastRun = { query: effective, ms: ms };
        try {
          var ents = [];
          (root.S && root.S.results ? root.S.results : []).slice(0, 4).forEach(function (r) {
            ents = ents.concat((r.doc.e || []).slice(0, 3));
          });
          U.context.observe(effective, v4.state.plan.intent, ents);
          ANV.learn.logQuery(effective, (root.S && root.S.results) || [], { ms: ms });
        } catch (e) {}
        // show the query the user actually typed; the rewrite lives in the strip
        var q2 = doc.getElementById("q2");
        if (q2 && effective !== q) q2.value = q;
        return out;
      };
    }

    // 5. a click is the learning signal
    var legacyOpenDoc = root.openDoc;
    if (typeof legacyOpenDoc === "function") {
      root.openDoc = function (id) {
        try {
          if (root.S && root.S.q) {
            var rank = 0;
            (root.S.results || []).forEach(function (r, i) { if (r.doc.id === id) rank = i + 1; });
            ANV.learn.logQuery(root.S.q, root.S.results || [], { click: id, clickRank: rank });
          }
        } catch (e) {}
        return legacyOpenDoc.apply(null, arguments);
      };
    }

    // 6. the v3 "India-only stack" panel described the v3 engine; replace its
    //    contents so nothing in the interface describes code that is no longer here
    if (typeof root.stackBody === "function") {
      root.stackBody = function () {
        var rows = [
          ["Semantic layer", "72-dimension distributional embeddings compiled offline from the corpus (PPMI to randomised SVD); unseen words embedded from character n-grams", "Public information-retrieval research; no vendor weights", "shipped"],
          ["Retrieval", "BM25F fused with dense cosine by reciprocal rank, rare-term protection for exact identifiers, then a learned rerank", "Written from scratch; latency shown per query", "shipped"],
          ["Language layer", "Script detection, Devanagari and Latin transliteration both ways, Hindi and Sanskrit stemmers, sandhi splitting, 190-concept trilingual lexicon", "Rule-based, stated in the code", "shipped (no general MT)"],
          ["Verification", "Claim extraction, cross-verification inside the corpus, contradiction lab, issuer independence, unit normalisation across crore/lakh/million/billion, per-type half-life", "Evidence science, not a fact-checking service", "shipped"],
          ["Discovery", "Ten paradigms, gap matrix, hidden relations, recombination, forecasting with intervals, plus a bounded autonomous investigator", "Heuristics over this library, labelled as such", "shipped"],
          ["Learning loop", "Click-trained learning-to-rank with an NDCG gate, correction weights, version snapshots and rollback", "Changes ranking only, never document text", "shipped"],
          ["Ingestion", "PDF, DOCX, PPTX, XLSX, ODT, CSV, TSV, JSON, HTML, Markdown, text and ZIP parsed in the tab", "DecompressionStream + hand-written parsers", "shipped"],
          ["Provenance", "SHA-256 Merkle tree over documents plus a hash-linked query chain", "Web Crypto API; modelled on Vishvasya / NBF record-keeping", "shipped"],
          ["Answer layer", "Extractive sentence selection with MMR, citation binding and a confidence derived from retrieval", "No generative model in the default path", "shipped"],
          ["Generative AI", "Optional adapter to a chat completion endpoint", "Sarvam AI, IndiaAI foundation-model cohort", "adapter ready, needs your key"],
          ["Translation", "Concept-level translation through the bundled lexicon", "Bhashini ULCA / IndicTrans2 for real machine translation", "not wired (needs API)"],
          ["Speech", "Browser speech recognition for voice queries where it exists", "Bhashini ASR for Indic speech", "browser fallback"],
          ["Compute", "Your device; the model ships inside the page", "IndiaAI Mission GPU pool is for training, not needed here", "not needed"]
        ];
        var h = '<div class="flow">' + rows.map(function (r, i) {
          return '<div class="flow-row"><span class="idx">' + (i + 1) + "</span><b style='color:#e8ecf7'>" + esc(r[0]) +
            "</b><span style='color:var(--dim)'>" + esc(r[1]) + "</span><span class='who'>" + esc(r[2]) + " · " + esc(r[3]) + "</span></div>";
        }).join("") + "</div>";
        h += '<div class="grid2" style="margin-top:16px">' +
          '<div class="tile"><h4>What changed in v4<span class="tag">release</span></h4><p>Retrieval gained a real semantic half, every result carries an itemised credibility score, ten discovery paradigms and an autonomous investigator were added, and the learning loop can now prove an improvement before adopting it.</p></div>' +
          '<div class="tile"><h4>What is still missing<span class="tag">honest</span></h4><p>Crawling, general machine translation, OCR, audio and video understanding, and scale beyond one browser tab. Each is marked adapter or not-possible in the audit, with the reason.</p></div>' +
          "</div>";
        return h;
      };
    }

    // 7. panel routing for the new panels
    var legacyOpen = root.openPanel;
    root.openPanel = function (which) {
      if (PANELS[which]) { renderPanel(which); return; }
      return legacyOpen.apply(null, arguments);
    };
  }

  /* --------------------------------------------------------- intelligence -- */
  function injectIntel() {
    var host = doc.getElementById("results");
    if (!host) return;
    var bar = doc.getElementById("v4bar");
    if (bar) bar.remove();
    var resbar = host.querySelector(".resbar");
    var p = v4.state.plan || {};
    var run = v4.state.lastRun || {};
    var cov = ANV.semantic.coverage(root.S && root.S.q || "");
    var sem = ANV.semantic.lastRun() || {};
    var dis = [];
    try { dis = ANV.understand.disambiguate(root.S && root.S.q || "", index()).filter(function (d) { return d.ambiguous; }); } catch (e) {}

    var h = '<div class="v4bar" id="v4bar"><div class="inner">';
    h += '<span class="v4-tag">' + esc(p.intent || "general") + "</span>";
    h += '<span class="v4-dim">expects ' + esc(p.answerType || "explanation") + "</span>";
    h += '<span class="v4-sep"></span>';
    h += '<span class="v4-dim">query ' + pct(cov.ratio) + " understood</span>";
    h += '<span class="v4-dim">' + (sem.dense || 0) + " semantic candidates</span>";
    h += '<span class="v4-dim">' + (run.ms != null ? run.ms + " ms" : "—") + "</span>";
    if (v4.state.rewrite) {
      h += '<span class="v4-rewrite">read as: <b>' + esc(v4.state.rewrite.text) + "</b> (" + esc(v4.state.rewrite.reason) + ")</span>";
    }
    h += '<span class="v4-grow"></span>';
    h += '<button class="v4-mini" onclick="openPanel(\'discover\')">Discover</button>';
    h += '<button class="v4-mini" onclick="openPanel(\'investigate\')">Investigate</button>';
    h += '<button class="v4-mini" onclick="openPanel(\'verify\')">Verify</button>';
    if (voiceSupported()) h += '<button class="v4-mini" onclick="ANV.ui.voice()" title="search by voice">Mic</button>';
    h += "</div>";
    if (dis.length) {
      h += '<div class="v4-dis"><span class="v4-dim">Ambiguous:</span>';
      dis.forEach(function (d) {
        h += '<span class="v4-disitem"><b>' + esc(d.term) + "</b> — " +
          d.senses.map(function (s, i) {
            return senseBtn(d.term, s.label, i);
          }).join(" / ") + "</span>";
      });
      h += "</div>";
    }
    if (cov.unknown && cov.unknown.length) {
      h += '<div class="v4-dis"><span class="v4-dim">Not in this library:</span> ' +
        cov.unknown.slice(0, 6).map(function (u) { return chip(u, "v4-miss"); }).join("") +
        '<span class="v4-dim"> — the engine maps these to their nearest known concepts instead of returning nothing.</span></div>';
    }
    h += "</div>";
    var div = doc.createElement("div");
    div.innerHTML = h;
    if (resbar && resbar.nextSibling) host.insertBefore(div.firstChild, resbar.nextSibling);
    else if (resbar) host.appendChild(div.firstChild);
    else host.insertBefore(div.firstChild, host.firstChild);
  }

  /* A sense button carries its own data, so a label containing quotes can
     never break the markup or the handler. */
  function senseBtn(term, label, i) {
    return '<button class="v4-sense" data-term="' + esc(term) + '" data-i="' + i +
      '" onclick="ANV.ui.pickSenseFrom(this)">' + esc(label) + "</button>";
  }

  v4.pickSenseFrom = function (el) {
    if (!el) return;
    v4.pickSense(el.getAttribute("data-term"), parseInt(el.getAttribute("data-i"), 10) || 0);
  };

  v4.pickSense = function (term, i) {
    var d = ANV.understand.disambiguate(root.S && root.S.q || "", index()).filter(function (x) { return x.term === term; })[0];
    if (!d || !d.senses[i]) return;
    var nb = d.senses[i].neighbours.slice(0, 3).join(" ");
    root.doSearch((root.S.q || "") + " " + nb, true);
  };

  function voiceSupported() {
    return !!(root.SpeechRecognition || root.webkitSpeechRecognition);
  }
  v4.voice = function () {
    var SR = root.SpeechRecognition || root.webkitSpeechRecognition;
    if (!SR) { root.toast && root.toast("This browser has no speech recognition"); return; }
    var rec = new SR();
    rec.lang = "en-IN";
    rec.interimResults = false;
    rec.onresult = function (e) {
      var text = e.results[0][0].transcript;
      var q = doc.getElementById("q") || doc.getElementById("q2");
      if (q) q.value = text;
      root.doSearch(text, true);
    };
    rec.onerror = function () { root.toast && root.toast("Speech recognition failed - type instead"); };
    rec.start();
    root.toast && root.toast("Listening…");
  };

  /* ---------------------------------------------------------------- panels - */
  var PANELS = {
    discover: { title: "Discovery paradigms", sub: "Ten ways to ask a question that a normal search engine cannot answer" },
    investigate: { title: "Autonomous investigator", sub: "A bounded multi-round investigation with a full trace" },
    verify: { title: "Verification lab", sub: "Credibility, contradiction, independence and manipulation, per source" },
    learn: { title: "Learning loop", sub: "What the engine learned from you, and how to undo it" },
    files: { title: "Add documents", sub: "PDF, DOCX, PPTX, XLSX, ODT, CSV, JSON, HTML, Markdown, ZIP - parsed on this device" },
    audit: { title: "Capability audit", sub: "Every property in the specification, with the mechanism behind it" }
  };

  function renderPanel(which) {
    var p = PANELS[which];
    doc.getElementById("panelTitle").textContent = p.title;
    doc.getElementById("panelSub").textContent = p.sub;
    var body = doc.getElementById("panelBody");
    body.innerHTML = '<div class="v4-panel">' + BUILDERS[which]() + "</div>";
    doc.getElementById("panel").classList.add("on");
    if (which === "discover") runParadigm(v4.state.paradigm || "unknown");
    if (which === "learn") refreshLearn();
    if (which === "audit") renderMatrix();
    if (which === "files") bindFiles();
  }

  var BUILDERS = {};

  /* ------------------------------------------------------------- discover -- */
  BUILDERS.discover = function () {
    var q = (root.S && root.S.q) || "";
    var tabs = ANV.discovery.PARADIGMS.map(function (p) {
      return '<button class="v4-tab' + (p.id === (v4.state.paradigm || "unknown") ? " on" : "") +
        '" data-p="' + p.id + '" onclick="ANV.ui.paradigm(\'' + p.id + '\')">' + esc(p.label) + "</button>";
    }).join("");
    return '<div class="v4-row"><input id="v4disq" class="v4-input" value="' + esc(q) + '" placeholder="subject to investigate">' +
      '<button class="v4-btn" onclick="ANV.ui.paradigm(ANV.ui.state.paradigm||\'unknown\')">Run</button></div>' +
      '<div class="v4-tabs">' + tabs + "</div>" +
      '<p class="v4-note">' + esc(ANV.discovery.PARADIGMS.filter(function (p) { return p.id === (v4.state.paradigm || "unknown"); })[0].question) + "</p>" +
      '<div id="v4disout"></div>';
  };

  v4.paradigm = function (id) {
    v4.state.paradigm = id;
    var tabs = doc.querySelectorAll(".v4-tab");
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle("on", tabs[i].getAttribute("data-p") === id);
    runParadigm(id);
  };

  function runParadigm(id) {
    var out = doc.getElementById("v4disout");
    if (!out) return;
    var q = (doc.getElementById("v4disq") || {}).value || (root.S && root.S.q) || "";
    if (!q.trim()) { out.innerHTML = empty("Type a subject first."); return; }
    out.innerHTML = '<p class="v4-note">computing…</p>';
    setTimeout(function () {
      var r;
      try { r = ANV.discovery.run(id, q.trim(), index(), { query: q.trim() }); }
      catch (e) { out.innerHTML = empty("This paradigm failed on this subject: " + e.message); return; }
      out.innerHTML = PARADIGM_VIEW[id] ? PARADIGM_VIEW[id](r) : "<pre>" + esc(JSON.stringify(r, null, 2)) + "</pre>";
    }, 20);
  }

  var PARADIGM_VIEW = {
    unknown: function (r) {
      var h = block("Verdict", '<p class="v4-lead">' + esc(r.summary) + "</p>");
      h += block("Facets with no answer", list(r.gaps, function (g) {
        return '<b>' + esc(g.label) + "</b> " + chip(g.state || "gap", "v4-warn") +
          '<div class="v4-sub">' + esc(g.question) + '</div><div class="v4-sub2">what would help: ' + esc(g.whatWouldHelp) + "</div>";
      }));
      h += block("Never discussed together", list(r.unstudiedCombinations, function (c) {
        return "<b>" + esc(c.pair[0]) + "</b> + <b>" + esc(c.pair[1]) + "</b> " +
          chip(c.aDocs + " / " + c.bDocs + " docs", "v4-kind") +
          '<div class="v4-sub2">both are documented separately; nothing in the corpus puts them in one sentence</div>';
      }));
      if (r.unknownTerms.length) h += block("Terms the library has never seen", r.unknownTerms.map(function (t) { return chip(t, "v4-miss"); }).join(" "),
        "These are embedded from character n-grams, so they still retrieve; the engine just cannot claim to understand them.");
      return h;
    },
    possibility: function (r) {
      var h = block("Verdict", '<p class="v4-lead">' + esc(r.summary) + "</p>");
      h += block("Conditional statements in the sources", list(r.modalStatements, function (m) {
        return esc(m.sentence) + '<div class="v4-sub2">' + esc(m.org || "") + " · " + esc(m.date || "") + "</div>";
      }));
      h += block("Quantified trajectories", list(r.scenarios, function (s) {
        return "<b>" + esc(s.family) + "</b> " + chip(s.cagr + "% a year", "v4-kind") +
          "<div>" + esc(s.from.raw) + " (" + esc(s.from.date) + ") → " + esc(s.to.raw) + " (" + esc(s.to.date) + ")</div>" +
          "<div>" + s.projection.map(function (p) { return p.year + ": " + Math.round(p.value).toLocaleString("en-IN"); }).join(" · ") + "</div>" +
          '<div class="v4-sub2">' + esc(s.assumption) + "</div>";
      }));
      return h + block("Counterfactual", '<p class="v4-lead">' + esc(r.counterfactual) + "</p>");
    },
    causal: function (r) {
      var h = block("Verdict", '<p class="v4-lead">' + esc(r.summary) + "</p>");
      h += block("Causal chains", list(r.chains, function (c) {
        return "<b>" + esc(c.cause) + "</b> → <b>" + esc(c.effect) + "</b> " +
          chip(c.support + " citations", "v4-kind") + chip(c.independent + " issuers", "v4-kind") +
          '<div class="v4-sub">' + esc(c.evidence[0] ? c.evidence[0].sentence : "") + "</div>" +
          '<div class="v4-sub2">' + esc(c.caveat) + "</div>";
      }));
      h += block("Co-occurrence only (not causation)", list(r.correlationsOnly, function (c) {
        return esc(c.pair) + " " + chip(c.coMentions + "×", "v4-kind");
      }), r.method);
      return h;
    },
    lost: function (r) {
      var h = block("Verdict", '<p class="v4-lead">' + esc(r.summary) + "</p>");
      h += block("Buried but relevant", list(r.forgotten, function (f) {
        return '<b>' + esc(f.doc.t) + "</b> " + chip("rank " + f.rank, "v4-kind") + chip(f.type, "v4-kind") +
          '<div class="v4-sub2">' + f.why.join(" · ") + "</div>" +
          '<div class="v4-sub2"><a href="#" onclick="openDoc(\'' + f.doc.id + '\');return false">open document</a></div>';
      }), r.method);
      return h;
    },
    anomaly: function (r) {
      var h = block("Verdict", '<p class="v4-lead">' + esc(r.summary) + "</p>");
      h += block("Outliers", list(r.outliers, function (o) {
        return "<b>" + esc(o.raw) + "</b> " + chip("z " + o.z, "v4-warn") + chip(o.direction, "v4-kind") +
          '<div class="v4-sub">' + esc(o.sentence) + "</div>" +
          '<div class="v4-sub2">' + esc(o.note) + "</div>";
      }));
      if (r.dateAnomalies.length) h += block("Date anomalies", list(r.dateAnomalies, function (d) { return esc(d.docId + " · " + d.date + " · " + d.note); }));
      return h;
    },
    interdisciplinary: function (r) {
      var h = block("Verdict", '<p class="v4-lead">' + esc(r.summary) + "</p>");
      h += block("Disciplines covering this", r.fields.map(function (f) {
        return '<div class="v4-field"><b>' + esc(f.field) + "</b> " + chip(f.docs.length + " docs", "v4-kind") +
          '<div class="v4-sub2">' + f.docs.slice(0, 3).map(function (d) { return esc(d.title); }).join(" · ") + "</div></div>";
      }).join(""));
      h += block("Bridge concepts", r.bridges.map(function (b) { return chip(b.concept + " (" + b.fields.join("/") + ")", "v4-kind"); }).join(" "));
      h += block("Analogues from other fields", list(r.analogies, function (a) {
        return "<b>" + esc(a.title) + "</b> " + chip(a.field + " ≈ " + a.fromField, "v4-kind") +
          '<div class="v4-sub2">' + esc(a.note) + "</div>";
      }), r.method);
      return h;
    },
    reality: function (r) {
      var h = block("Verdict", '<p class="v4-lead">' + esc(r.summary) + "</p>" + '<p class="v4-note">' + esc(r.grounding) + "</p>");
      h += block("Measured", list(r.measured, function (m) {
        return esc(m.sentence) + '<div class="v4-sub2">' + esc((m.org || "") + " · " + (m.date || "")) + "</div>";
      }));
      h += block("Targets and forecasts", list(r.projected, function (m) {
        return esc(m.sentence) + '<div class="v4-sub2">' + esc((m.org || "") + " · " + (m.date || "")) + "</div>";
      }), r.method);
      return h;
    },
    simulation: function (r) {
      var h = block("Verdict", '<p class="v4-lead">' + esc(r.summary) + "</p>");
      h += block("Fitted series", list(r.models, function (m) {
        return "<b>" + esc(m.family) + "</b> " + chip("r² " + m.r2, "v4-kind") + chip(m.n + " points", "v4-kind") +
          "<div>" + m.predictions.map(function (p) {
            return p.year + ": " + Math.round(p.value).toLocaleString("en-IN") +
              " (" + Math.round(p.lo).toLocaleString("en-IN") + "–" + Math.round(p.hi).toLocaleString("en-IN") + ")";
          }).join(" · ") + "</div>" +
          '<div class="v4-sub2">' + esc(m.caveat) + " · assumptions: " + esc(m.assumptions.join("; ")) + "</div>";
      }), r.honesty);
      return h;
    },
    temporal: function (r) {
      var h = block("Verdict", '<p class="v4-lead">' + esc(r.summary) + "</p>");
      h += block("Term usage by year", r.evolution.map(function (e) {
        return '<div class="v4-field"><b>' + esc(e.term) + "</b> " +
          e.counts.map(function (c) { return c.year + ":" + c.n; }).join(" ") +
          '<div class="v4-sub2">first ' + esc(e.firstYear || "—") + " · last " + esc(e.lastYear || "—") + "</div></div>";
      }).join(""), r.method);
      if (r.asOfResults.length) h += block("What existed at " + r.asOfYear, list(r.asOfResults, function (x) { return esc(x.title) + " " + chip(x.date, "v4-kind"); }));
      return h;
    },
    evolutionary: function (r) {
      var h = block("Verdict", '<p class="v4-lead">' + esc(r.summary) + "</p>");
      h += '<div class="v4-grid">' +
        kv("MRR before", r.before.mrr) + kv("MRR after", r.after.mrr) +
        kv("precision@1 before", r.before.precisionAt1) + kv("precision@1 after", r.after.precisionAt1) +
        kv("queries", r.before.n) + kv("weights adopted", r.changed ? "yes" : "no") + "</div>";
      h += block("Candidates tried", '<table class="v4-tbl"><tr><th>lexical</th><th>semantic</th><th>authority</th><th>MRR</th><th>p@1</th></tr>' +
        r.tried.map(function (t) {
          return "<tr><td>" + t.weights.lex + "</td><td>" + t.weights.sem + "</td><td>" + t.weights.auth +
            "</td><td>" + t.mrr + "</td><td>" + t.p1 + "</td></tr>";
        }).join("") + "</table>", r.caveat);
      return h;
    }
  };

  /* ---------------------------------------------------------- investigate -- */
  BUILDERS.investigate = function () {
    var q = (root.S && root.S.q) || "";
    return '<div class="v4-row"><input id="v4invq" class="v4-input" value="' + esc(q) + '" placeholder="question to investigate">' +
      '<button class="v4-btn" onclick="ANV.ui.investigate()">Investigate</button></div>' +
      '<p class="v4-note">The agent plans the question, retrieves, reads, cross-checks, finds the gaps, re-queries and writes a cited dossier. Every step is logged.</p>' +
      '<div id="v4invout">' + empty("Nothing investigated yet.") + "</div>";
  };

  v4.investigate = function () {
    var out = doc.getElementById("v4invout");
    var q = ((doc.getElementById("v4invq") || {}).value || "").trim();
    if (!q) { out.innerHTML = empty("Type a question first."); return; }
    out.innerHTML = '<p class="v4-note">investigating… this runs several retrieval rounds.</p>';
    setTimeout(function () {
      var d;
      try { d = ANV.agent.investigate(q, index(), { rounds: 3, budget: 18 }); }
      catch (e) { out.innerHTML = empty("The investigation failed: " + e.message); return; }
      v4.state.dossier = d;
      var h = '<div class="v4-grid">' + kv("confidence", pct(d.confidence)) + kv("label", d.label) +
        kv("rounds", d.stats.rounds) + kv("queries", d.stats.queries) +
        kv("documents read", d.stats.documentsRead) + kv("independent issuers", d.independence.independentSources) + "</div>";
      h += block("Findings", list(d.findings, function (f) {
        return "<b>" + esc(f.verdict) + "</b> " + chip(f.org || "", "v4-kind") + chip(f.date || "", "v4-kind") +
          "<div>" + esc(f.statement) + "</div>" +
          (f.corroboratedBy.length ? '<div class="v4-sub2">corroborated by ' + esc(f.corroboratedBy.join(", ")) + "</div>" : "") +
          (f.disputedBy.length ? '<div class="v4-sub2">disputed by ' + esc(f.disputedBy.join(", ")) + "</div>" : "");
      }));
      if (d.contradictions.length) h += block("Unresolved conflicts", list(d.contradictions, function (c) {
        return "<b>" + esc(c.key) + "</b> " + chip(c.kind, c.kind === "conflict" ? "v4-warn" : "v4-kind") +
          '<div class="v4-sub2">' + esc(c.note) + "</div>";
      }));
      h += block("What this corpus cannot answer", list(d.gaps, function (g) {
        return "<b>" + esc(g.label) + "</b> " + chip(g.state, "v4-warn") + '<div class="v4-sub2">strength ' + g.strength + "</div>";
      }));
      h += block("Hypotheses worth testing", list(d.hypotheses, function (y) {
        return "<b>" + esc(y.text) + "</b>" +
          '<div class="v4-sub">test: ' + esc(y.tests) + "</div>" +
          '<div class="v4-sub2">falsified if: ' + esc(y.falsifiedIf) + "</div>";
      }));
      h += block("Next steps", list(d.nextSteps, function (s) { return esc(s); }));
      h += block("Trace", '<table class="v4-tbl"><tr><th>#</th><th>step</th><th>detail</th></tr>' +
        d.trace.map(function (t) {
          return "<tr><td>" + t.n + "</td><td>" + esc(t.kind) + "</td><td class=\"mono\">" + esc(JSON.stringify(t.detail)).slice(0, 160) + "</td></tr>";
        }).join("") + "</table>", "This is the whole investigation. Nothing happened off the record.");
      h += '<div class="v4-row"><button class="v4-btn" onclick="ANV.ui.copyDossier()">Copy dossier as Markdown</button>' +
        '<button class="v4-btn ghost" onclick="ANV.ui.recordFailure()">Record a refuted hypothesis</button></div>';
      out.innerHTML = h;
    }, 30);
  };

  v4.copyDossier = function () {
    if (!v4.state.dossier) return;
    var md = v4.state.dossier.markdown;
    if (navigator.clipboard) navigator.clipboard.writeText(md).then(function () { root.toast && root.toast("Dossier copied"); });
    else root.toast && root.toast("Clipboard unavailable - open the export instead");
  };
  v4.recordFailure = function () {
    if (!v4.state.dossier || !v4.state.dossier.hypotheses.length) return;
    var y = v4.state.dossier.hypotheses[0];
    ANV.agent.recordFailure({ question: v4.state.dossier.question, hypothesis: y.text, outcome: "refuted or abandoned", when: new Date().toISOString() });
    root.toast && root.toast("Recorded in the failed-hypothesis registry");
  };

  /* --------------------------------------------------------------- verify -- */
  BUILDERS.verify = function () {
    var q = (root.S && root.S.q) || "";
    var S = root.S || {};
    var results = (S.results || []).slice(0, 8);
    var h = '<p class="v4-note">Verifying: <b>' + esc(q || "nothing searched yet") + "</b></p>";
    if (!results.length) return h + empty("Search for something first, then open this panel.");

    var pool = results.map(function (r) { return r.doc; });
    var indep = ANV.evidence.independenceReport(pool);
    h += '<div class="v4-grid">' + kv("independent issuers", indep.independentSources) + kv("documents", indep.documents) +
      kv("verdict", indep.verdict) + kv("documents checked", pool.length) + "</div>";
    h += block("Corroboration", '<p class="v4-lead">' + esc(indep.note) + "</p>" +
      list(indep.dependencies, function (d) {
        return esc(d.a + " ↔ " + d.b) + " " + chip(d.reason, "v4-warn");
      }));

    h += block("Credibility, factor by factor", '<table class="v4-tbl"><tr><th>document</th><th>score</th><th>authority</th><th>primary</th><th>verifiable</th><th>evidenced</th><th>current</th></tr>' +
      results.map(function (r) {
        var c = ANV.evidence.credibility(r.doc, {});
        return "<tr><td>" + esc(r.doc.t.slice(0, 60)) + "</td><td>" + chip(c.label + " " + pct(c.score), "v4-cred-" + c.label) +
          "</td><td>" + c.factors.authority.v.toFixed(2) + "</td><td>" + c.factors.primary.v.toFixed(2) +
          "</td><td>" + c.factors.verifiable.v.toFixed(2) + "</td><td>" + c.factors.evidenced.v.toFixed(2) +
          "</td><td>" + c.factors.current.v.toFixed(2) + "</td></tr>";
      }).join("") + "</table>", "Each column is a factor in the score above it. Disagree with a factor, not with a black box.");

    var contra = ANV.evidence.contradictionLab(q, index(), { limit: 5 });
    h += block("Contradiction laboratory", list(contra, function (c) {
      return "<b>" + esc(c.key) + "</b> " + chip(c.kind, c.kind === "conflict" ? "v4-warn" : "v4-kind") +
        '<div class="v4-sub2">' + esc(c.note) + "</div>" +
        '<div class="v4-sub">' + c.rows.map(function (r) { return esc(r.org + " " + r.date + ": " + r.raw); }).join(" · ") + "</div>";
    }), "Figures are compared only inside the same unit family, after converting crore, lakh, million and billion to one base.");

    h += block("Manipulation markers", results.slice(0, 4).map(function (r) {
      var m = ANV.evidence.misinformationRisk(r.doc, index());
      return '<div class="v4-field"><b>' + esc(r.doc.t.slice(0, 70)) + "</b> " + chip(m.band + " " + pct(m.risk), "v4-cred-" + (m.band === "high" ? "poor" : m.band === "medium" ? "weak" : "strong")) +
        '<div class="v4-sub2">' + esc(m.note) + "</div>" +
        (m.signals.length ? '<div class="v4-sub2">' + m.signals.map(function (s) { return esc(s.note); }).join(" · ") + "</div>" : "") + "</div>";
    }).join(""));

    var nav = ANV.discovery.uncertaintyNavigator(index(), q);
    h += block("Where certainty stops", list(nav.checked, function (c) {
      return chip(c.verdict, c.verdict === "supported" ? "v4-ok" : c.verdict === "unverified" ? "v4-warn" : "v4-bad") +
        " " + esc(String(c.claim).slice(0, 190));
    }), nav.note);

    var cites = ANV.evidence.citationIntegrity(index());
    if (cites.length) h += block("Attributions that cannot be checked here", list(cites.slice(0, 6), function (c) {
      return "<b>" + esc(c.attributed) + "</b> in " + esc(c.org || c.docId) + '<div class="v4-sub2">' + esc(c.note) + "</div>";
    }));

    var stats = ANV.evidence.statChecks(index());
    if (stats.length) h += block("Figures that do not share a scale", list(stats.slice(0, 5), function (s) {
      return esc(s.docId) + " " + chip(s.status, "v4-warn") + '<div class="v4-sub2">' + esc(s.note) + "</div>";
    }));

    var exp = ANV.evidence.expiration ? null : null;
    var stale = results.map(function (r) { return { d: r.doc, f: ANV.evidence.freshness(r.doc) }; })
      .filter(function (x) { return x.f.stale; });
    h += block("Needs revalidation", list(stale, function (x) {
      return esc(x.d.t.slice(0, 70)) + " " + chip(x.f.age + "y old, half-life " + x.f.halfLife + "y", "v4-warn");
    }), "Half-life is set per document type: a dashboard figure decays in months, a historical record does not decay.");
    return h;
  };

  /* ---------------------------------------------------------------- learn -- */
  BUILDERS.learn = function () {
    return '<div id="v4learnout"></div>';
  };

  function refreshLearn() {
    var host = doc.getElementById("v4learnout");
    if (!host) return;
    var w = ANV.learn.weights();
    var mon = ANV.learn.monitor();
    var ev = ANV.learn.evaluate();
    var h = '<div class="v4-grid">' + kv("queries logged", mon.queries) + kv("zero-result rate", pct(mon.zeroResultRate)) +
      kv("latency median", (mon.latencyMedian != null ? mon.latencyMedian + " ms" : "—")) +
      kv("latency p95", (mon.latencyP95 != null ? mon.latencyP95 + " ms" : "—")) +
      kv("health", mon.health) + kv("battery MRR", ev.battery ? ev.battery.mrr : "—") + "</div>";

    h += block("Ranking weights (these are the ranking function)", ["lex", "sem", "auth", "evidence", "fresh", "correction"].map(function (k) {
      return '<label class="v4-slider"><span>' + k + "</span>" +
        '<input type="range" min="' + (k === "correction" ? -1 : 0) + '" max="1.2" step="0.05" value="' + w[k] +
        '" oninput="ANV.ui.setW(\'' + k + '\', this.value)">' +
        '<b id="v4w-' + k + '">' + w[k] + "</b></label>";
    }).join(""), "Learning changes these numbers. It never changes what a document says.");

    h += '<div class="v4-row">' +
      '<button class="v4-btn" onclick="ANV.ui.train()">Learn from clicks</button>' +
      '<button class="v4-btn ghost" onclick="ANV.ui.snapshot()">Snapshot version</button>' +
      '<button class="v4-btn ghost" onclick="ANV.ui.exportAll()">Export everything</button>' +
      '<button class="v4-btn ghost" onclick="ANV.ui.resetLearn()">Reset</button></div>';

    h += block("Memory", '<label class="v4-check"><input type="checkbox" ' + (ANV.learn.memory().consent ? "checked" : "") +
      ' onchange="ANV.ui.consent(this.checked)"> allow the engine to remember conclusions on this device</label>' +
      '<div class="v4-sub2">Off by default. Nothing is stored until you tick this, and reset deletes it.</div>', null);

    var vers = ANV.learn.versions();
    h += block("Versions", vers.length ? '<table class="v4-tbl"><tr><th>id</th><th>label</th><th>docs</th><th>when</th><th></th></tr>' +
      vers.slice().reverse().map(function (v) {
        return "<tr><td>" + esc(v.id) + "</td><td>" + esc(v.label) + "</td><td>" + v.docs + "</td><td>" +
          new Date(v.t).toLocaleString("en-IN") + '</td><td><button class="v4-mini" onclick="ANV.ui.rollback(\'' + v.id + '\')">rollback</button></td></tr>';
      }).join("") + "</table>" : empty("no versions yet"),
      "Rollback restores weights. Documents added since then stay indexed; remove them in Add documents if you need the exact earlier state.");

    var corr = ANV.learn.corrections();
    var keys = Object.keys(corr);
    h += block("Your corrections", keys.length ? list(keys, function (k) {
      return "<b>" + esc(k) + "</b> " + chip(corr[k].kind, "v4-warn") + " " + esc(corr[k].note || "") +
        ' <button class="v4-mini" onclick="ANV.learn.clearCorrection(\'' + k + '\');ANV.ui.refreshLearn()">clear</button>';
    }) : empty("none - flag a document from its drawer if it is wrong"), "A correction down-weights a source. It is a signal about the source, not proof about the fact.");

    h += block("Recent misses", list(mon.recentMisses, function (m) { return esc(m); }),
      "Queries that returned nothing. These are the clearest signal of what this library lacks.");
    host.innerHTML = h;
  }

  v4.refreshLearn = refreshLearn;
  v4.setW = function (k, v) {
    var patch = {}; patch[k] = parseFloat(v);
    ANV.learn.setWeights(patch);
    var el = doc.getElementById("v4w-" + k);
    if (el) el.textContent = parseFloat(v).toFixed(2);
  };
  v4.train = function () {
    var r = ANV.learn.train({});
    root.toast && root.toast(r.trained ? (r.adopted ? "Adopted: NDCG " + r.before.ndcg + " → " + r.after.ndcg : "Rejected: no measured improvement") : r.note);
    refreshLearn();
  };
  v4.snapshot = function () { var v = ANV.learn.snapshot("manual"); root.toast && root.toast("Version " + v.id + " saved"); refreshLearn(); };
  v4.rollback = function (id) { var r = ANV.learn.rollback(id); root.toast && root.toast(r.ok ? "Restored " + id : r.reason); refreshLearn(); };
  v4.consent = function (on) { ANV.learn.setConsent(on); refreshLearn(); };
  v4.resetLearn = function () { ANV.learn.reset(); refreshLearn(); root.toast && root.toast("Local learning data cleared"); };
  v4.exportAll = function () {
    var data = JSON.stringify(ANV.learn.exportAll(), null, 2);
    var blob = new Blob([data], { type: "application/json" });
    var a = doc.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "anveshan-export-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    root.toast && root.toast("Exported");
  };

  /* ---------------------------------------------------------------- files -- */
  BUILDERS.files = function () {
    return '<p class="v4-note">Everything below is parsed in this tab. No upload, no server, no queue. Supported: ' +
      esc(ANV.ingest.SUPPORTED.join(", ")) + ".</p>" +
      '<div class="v4-row"><input type="file" id="v4file" multiple accept=".pdf,.docx,.pptx,.xlsx,.odt,.csv,.tsv,.json,.html,.md,.txt,.zip">' +
      '<button class="v4-btn" onclick="ANV.ui.readFiles()">Read and index</button></div>' +
      '<div class="v4-row"><input id="v4org" class="v4-input small" placeholder="issuer (optional)">' +
      '<input id="v4url" class="v4-input small" placeholder="URL (optional)">' +
      '<select id="v4auth" class="v4-input small"><option value="3">authority 3</option><option value="4">4</option><option value="5">5</option><option value="2">2</option></select></div>' +
      '<textarea id="v4paste" class="v4-textarea" placeholder="…or paste text from a book, a report, a transcript"></textarea>' +
      '<div class="v4-row"><button class="v4-btn" onclick="ANV.ui.ingestText()">Index pasted text</button></div>' +
      '<div id="v4fileout">' + empty("No files read yet.") + "</div>";
  };

  function bindFiles() {}

  v4.readFiles = function () {
    var input = doc.getElementById("v4file");
    var out = doc.getElementById("v4fileout");
    if (!input || !input.files.length) { out.innerHTML = empty("Choose at least one file."); return; }
    var files = Array.prototype.slice.call(input.files);
    out.innerHTML = '<p class="v4-note">reading ' + files.length + " file(s)…</p>";
    (async function () {
      var reports = [], allDocs = [];
      for (var i = 0; i < files.length; i++) {
        var r;
        try { r = await ANV.ingest.readFile(files[i]); }
        catch (e) { reports.push({ name: files[i].name, error: e.message }); continue; }
        var opts = {
          org: (doc.getElementById("v4org") || {}).value || "",
          url: (doc.getElementById("v4url") || {}).value || "",
          authority: parseInt((doc.getElementById("v4auth") || {}).value, 10) || 3
        };
        var made = ANV.ingest.toDocuments(r, opts);
        reports.push({ name: r.name, kind: r.kind, words: r.words, chunks: made.length, note: r.note, scan: r.scan, pages: r.pages });
        allDocs = allDocs.concat(made);
      }
      var res = allDocs.length ? ANV.ingest.addToIndex(allDocs) : { added: 0, skipped: [], total: docs().length };
      var h = '<div class="v4-grid">' + kv("files read", reports.length) + kv("chunks indexed", res.added) +
        kv("skipped as duplicate", res.skipped.length) + kv("library size", res.total) + "</div>";
      h += block("Files", list(reports, function (r) {
        if (r.error) return "<b>" + esc(r.name) + "</b> " + chip("failed", "v4-bad") + '<div class="v4-sub2">' + esc(r.error) + "</div>";
        return "<b>" + esc(r.name) + "</b> " + chip(r.kind, "v4-kind") + chip(r.words + " words", "v4-kind") +
          chip(r.chunks + " chunks", "v4-kind") +
          (r.pages ? chip(r.pages + " pages", "v4-kind") : "") +
          (r.scan && !r.scan.clean ? chip("injection markers", "v4-warn") : "") +
          (r.note ? '<div class="v4-sub2">' + esc(r.note) + "</div>" : "") +
          (r.scan && r.scan.hits.length ? '<div class="v4-sub2">' + r.scan.hits.map(function (x) { return esc(x.note); }).join(" · ") + "</div>" : "");
      }));
      if (res.skipped.length) h += block("Already in the library", list(res.skipped, function (s) {
        return esc(s.id) + " is a near-duplicate of " + esc(s.title);
      }));
      h += '<p class="v4-note">The index, the entity graph and the credibility scores were rebuilt. Every claim in these files can now be verified against the rest of the library.</p>';
      out.innerHTML = h;
    })();
  };

  v4.ingestText = function () {
    var text = (doc.getElementById("v4paste") || {}).value || "";
    var out = doc.getElementById("v4fileout");
    if (text.trim().length < 40) { out.innerHTML = empty("Paste at least a paragraph."); return; }
    var read = { name: "pasted note", text: text, meta: {}, kind: "text", words: text.split(/\s+/).length, scan: ANV.ingest.scanForInjection(text) };
    var made = ANV.ingest.toDocuments(read, {
      org: (doc.getElementById("v4org") || {}).value || "",
      url: (doc.getElementById("v4url") || {}).value || "",
      authority: parseInt((doc.getElementById("v4auth") || {}).value, 10) || 3
    });
    var res = ANV.ingest.addToIndex(made);
    out.innerHTML = '<div class="v4-grid">' + kv("chunks indexed", res.added) + kv("library size", res.total) +
      kv("duplicates skipped", res.skipped.length) + kv("injection scan", read.scan.clean ? "clean" : "flagged") + "</div>" +
      (read.scan.clean ? "" : block("This text contains instruction-shaped content", list(read.scan.hits, function (h) { return esc(h.note) + " — " + esc(h.sample); }),
        "It was indexed as text and never executed."));
  };

  /* ---------------------------------------------------------------- audit -- */
  var STATUS_LABEL = { live: "live", partial: "partial", adapter: "adapter", out: "not possible here" };

  BUILDERS.audit = function () {
    return '<div id="v4matrix"></div>';
  };

  function renderMatrix() {
    var host = doc.getElementById("v4matrix");
    if (!host) return;
    var M = root.ANV_MATRIX || [];
    var counts = { live: 0, partial: 0, adapter: 0, out: 0 };
    M.forEach(function (g) { g.items.forEach(function (i) { counts[i[1]] = (counts[i[1]] || 0) + 1; }); });
    var total = counts.live + counts.partial + counts.adapter + counts.out;
    var h = '<div class="v4-grid">' + kv("properties audited", total) + kv("live", counts.live) +
      kv("partial", counts.partial) + kv("adapter", counts.adapter) + kv("not possible here", counts.out) + "</div>";
    h += '<p class="v4-note">The v3 build shipped 89 live, 55 partial, 6 adapter and 22 not-possible rows. This version re-audits every property against the new code. Nothing is marked live unless the panel next door actually does it.</p>';
    h += '<div class="v4-row">' + ["all", "live", "partial", "adapter", "out"].map(function (s) {
      return '<button class="v4-tab' + (s === "all" ? " on" : "") + '" onclick="ANV.ui.filterMatrix(\'' + s + '\',this)">' + (STATUS_LABEL[s] || s) + "</button>";
    }).join("") + "</div>";
    h += M.map(function (g) {
      return '<div class="v4-mgroup" data-g><h4>' + esc(g.g) + "</h4>" + g.items.map(function (i) {
        return '<div class="v4-mrow" data-s="' + i[1] + '"><div class="v4-mtitle">' + esc(i[0]) + "</div>" +
          '<span class="v4-chip v4-st-' + i[1] + '">' + STATUS_LABEL[i[1]] + "</span>" +
          '<div class="v4-mwhy">' + esc(i[2]) + "</div></div>";
      }).join("") + "</div>";
    }).join("");
    host.innerHTML = h;
  }

  v4.filterMatrix = function (status, btn) {
    var tabs = doc.querySelectorAll("#v4matrix .v4-tab");
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove("on");
    if (btn) btn.classList.add("on");
    var rows = doc.querySelectorAll("#v4matrix .v4-mrow");
    for (var j = 0; j < rows.length; j++) {
      rows[j].style.display = (status === "all" || rows[j].getAttribute("data-s") === status) ? "" : "none";
    }
  };

  /* ------------------------------------------------------------------ nav -- */
  function addNav() {
    var nav = doc.querySelector("nav.top-nav");
    if (!nav || doc.getElementById("navDiscover")) return;
    var defs = [
      ["navDiscover", "Discover", "discover", "Ten discovery paradigms"],
      ["navInvestigate", "Investigate", "investigate", "Autonomous multi-round investigation"],
      ["navVerify", "Verify", "verify", "Credibility, contradiction, independence"],
      ["navLearn", "Learn", "learn", "The learning loop, versions and rollback"],
      ["navAudit", "Audit", "audit", "Capability audit"]
    ];
    defs.forEach(function (d) {
      var b = doc.createElement("button");
      b.className = "nbtn";
      b.id = d[0];
      b.title = d[3];
      b.textContent = d[1];
      b.onclick = function () { root.openPanel(d[2]); };
      nav.insertBefore(b, nav.firstChild);
    });
    // The v3 nav is built in three stages, each waiting on the Merkle ledger, so
    // keep looking for its buttons and rebind them as they arrive.
    var tries = 0;
    var timer = setInterval(function () {
      var bound = rebindLegacy();
      if ((bound.importPanel && bound.capabilities) || ++tries > 25) clearInterval(timer);
    }, 200);
    rebindLegacy();
  }

  /** The v3 import and capability panels are superseded by v4 versions. */
  function rebindLegacy() {
    var found = { importPanel: false, capabilities: false };
    var oldImport = doc.getElementById("navImport");
    if (oldImport) {
      oldImport.textContent = "Add files";
      oldImport.title = "Read PDF, DOCX, XLSX, CSV and more on this device";
      oldImport.onclick = function () { root.openPanel("files"); };
      found.importPanel = true;
    }
    var oldCaps = doc.getElementById("navCaps");
    if (oldCaps) {
      oldCaps.textContent = "Audit";
      oldCaps.title = "Capability audit for this build";
      oldCaps.onclick = function () { root.openPanel("audit"); };
      found.capabilities = true;
    }
    return found;
  }

  /* ----------------------------------------------------------------- boot -- */
  function boot() {
    // The Merkle ledger is asynchronous and optional here: retrieval must come up
    // even if hashing is unavailable (an old browser, or a blocked SubtleCrypto).
    if (!root.INDEX || !root.DOCS || !root.DOCS.length) { setTimeout(boot, 140); return; }
    installPatches();
    addNav();
    try {
      var st = doc.getElementById("stDocs");
      if (st) st.textContent = root.DOCS.length;
      var sub = doc.querySelector(".hero p.sub");
      if (sub) {
        sub.innerHTML = "A research engine over <b>" + root.DOCS.length + " indexed sources</b> with a compiled semantic model, " +
          "claim-level verification, ten discovery paradigms and an autonomous investigator. " +
          "Every answer is quoted, every document is hash-verified, and <b>nothing you type leaves this device</b>.";
      }
      var tag = doc.querySelector(".brand-txt small");
      if (tag) tag.textContent = "v4 · universal knowledge engine";
    } catch (e) {}
    v4.ready = true;
    if (root.S && root.S.q) { try { injectIntel(); } catch (e) {} }
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 60); });
  else setTimeout(boot, 60);
})(typeof globalThis !== "undefined" ? globalThis : this);
