/* ============================================================================
   ANVESHAN - interface
   One search box. Plain-language results. Everything advanced behind "Tools".

   This file owns the whole interface; the engine layers underneath are unchanged.
   The rule followed throughout: a first-time visitor should be able to search
   without reading anything, and a researcher should be able to reach every
   capability in two clicks.
   ========================================================================== */
(function (root) {
  "use strict";
  var ANV = root.ANV;
  var d = root.document;
  if (!ANV || !d) return;

  /* ------------------------------------------------------------------ utils */
  function $(sel, el) { return (el || d).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || d).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function pct(x) { return Math.round((x || 0) * 100) + "%"; }
  function year(s) { var m = String(s || "").match(/(1[5-9]\d{2}|20\d{2})/); return m ? m[1] : ""; }
  function host(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
  }
  function kb(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.round((b || 0) / 1024) + " KB"; }
  function toast(msg, ms) {
    var box = $("#toasts");
    var el = d.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, ms || 3200);
  }
  function highlight(text, terms) {
    var safe = esc(text);
    (terms || []).filter(function (t) { return t && t.length > 2; }).slice(0, 12).forEach(function (t) {
      try {
        safe = safe.replace(new RegExp("(" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi"), "<mark>$1</mark>");
      } catch (e) {}
    });
    return safe;
  }

  /* ------------------------------------------------------------------ state */
  var state = {
    engine: "index", q: "", results: [], base: [], shown: 10,
    filters: { type: "all", source: "all", year: "all", lang: "all" },
    centralReady: false, liveReady: !!(ANV.live && ANV.live.SOURCES && ANV.live.SOURCES.length),
    indexInfo: null, liveInfo: null, tool: "discover", lastMeta: null, busy: false
  };

  var ENGINES = [
    { id: "index", label: "Everything crawled", tip: "Our own index of the open web, refreshed on a schedule" },
    { id: "live", label: "The live web", tip: "Fifteen public collections, queried right now" },
    { id: "library", label: "Verified library", tip: "170 curated documents with full cross-checking" }
  ];

  /* ------------------------------------------------------------------ theme */
  function applyTheme(t) {
    d.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("anv.theme", t); } catch (e) {}
  }
  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem("anv.theme"); } catch (e) {}
    if (!saved) saved = (root.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    applyTheme(saved);
    $("#btnTheme").addEventListener("click", function () {
      applyTheme(d.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
    });
  }

  /* ---------------------------------------------------------------- engines */
  function renderEngines() {
    var box = $("#engines");
    box.innerHTML = ENGINES.map(function (e) {
      var ready = e.id === "index" ? state.centralReady : e.id === "live" ? state.liveReady : true;
      return '<button class="engine" role="radio" aria-checked="' + (state.engine === e.id) +
        '" data-engine="' + e.id + '" title="' + esc(e.tip) + '"' + (ready ? "" : " disabled") + ">" +
        '<span class="dot" aria-hidden="true"></span>' + esc(e.label) +
        (ready ? "" : " · soon") + "</button>";
    }).join("");
    $$(".engine", box).forEach(function (b) {
      b.addEventListener("click", function () {
        state.engine = b.getAttribute("data-engine");
        renderEngines();
        updateHint();
        if (state.q) runSearch(state.q);
      });
    });
    updateHint();
  }
  function updateHint() {
    var e = ENGINES.filter(function (x) { return x.id === state.engine; })[0];
    var extra = "";
    if (state.engine === "index" && state.indexInfo) {
      extra = " · " + state.indexInfo.docs.toLocaleString("en-IN") + " documents, rebuilt " + String(state.indexInfo.builtAt || "").slice(0, 10);
    } else if (state.engine === "live" && state.liveInfo) {
      extra = " · " + state.liveInfo.sources + " collections";
    } else if (state.engine === "library") {
      extra = " · 170 documents, cross-checked";
    }
    $("#hint").textContent = (e ? e.tip : "") + extra;
  }

  var EXAMPLES = [
    "how much water does Indian agriculture use",
    "what is retrieval augmented generation",
    "भुगतान प्रणाली कैसे काम करती है",
    "quantum error correction progress",
    "what does the DPDP Act require"
  ];
  function renderExamples() {
    $("#examples").innerHTML = EXAMPLES.map(function (q) {
      return '<li><button type="button" data-q="' + esc(q) + '">' + esc(q) + "</button></li>";
    }).join("");
    $$("#examples button").forEach(function (b) {
      b.addEventListener("click", function () {
        $("#q").value = b.getAttribute("data-q");
        $("#q").focus();
        $("#searchForm").dispatchEvent(new Event("submit", { cancelable: true }));
      });
    });
  }

  /* ----------------------------------------------------------------- search */
  function showResults(on) {
    $("#home").hidden = on;
    $("#results").hidden = !on;
  }

  function setBusy(msg) {
    state.busy = true;
    $("#status").innerHTML = msg ? '<span class="badge info">' + esc(msg) + "</span>" : "";
  }

  async function runSearch(q) {
    q = String(q || "").trim();
    if (!q) return;
    state.q = q;
    state.filters = { type: "all", source: "all", year: "all", lang: "all" };
    state.shown = 10;
    showResults(true);
    $("#q2").value = q;
    $("#answer").innerHTML = "";
    $("#cards").innerHTML = "";
    $("#more").innerHTML = "";
    $("#count").textContent = "";
    $("#filters").hidden = true;
    $("#btnFilters").setAttribute("aria-expanded", "false");
    setBusy(state.engine === "live" ? "asking the live collections…" : "searching…");

    var t0 = performance.now ? performance.now() : Date.now();
    try {
      var out = state.engine === "index" ? await searchIndex(q)
        : state.engine === "live" ? await searchLive(q)
        : searchLibrary(q);
      var ms = Math.round((performance.now ? performance.now() : Date.now()) - t0);
      state.base = out.results || [];
      state.results = state.base;
      state.lastMeta = Object.assign({ ms: ms }, out.meta || {});
      renderStatus(out);
      renderAnswer(q, out);
      applyFilters();
      try { ANV.learn.logQuery(q, state.results, { ms: ms, engine: state.engine }); } catch (e) {}
      try {
        ANV.understand.context.observe(q, ANV.understand.classify(q).intent, []);
      } catch (e) {}
    } catch (err) {
      state.base = []; state.results = [];
      renderEmpty(err && err.message ? err.message : "something went wrong", true);
      $("#status").innerHTML = "";
    } finally {
      state.busy = false;
      try { history.replaceState(null, "", "#q=" + encodeURIComponent(q) + "&engine=" + state.engine); } catch (e) {}
    }
  }

  async function searchIndex(q) {
    if (!ANV.central) throw new Error("the index is not available in this build");
    var out = await ANV.central.search(q, { limit: 60 });
    return {
      results: out.results,
      meta: { corpus: out.meta.corpus, shards: out.meta.shards, bytes: out.meta.bytes, matched: out.meta.matched, expanded: out.expanded },
      kind: "index"
    };
  }

  async function searchLive(q) {
    if (!ANV.live) throw new Error("live search is not available in this build");
    var out = await ANV.live.search(q, { perSource: 5 });
    var ok = out.sources.filter(function (s) { return s.ok && s.count; }).length;
    return {
      results: out.results,
      meta: { sources: out.sources.length, answered: ok, failed: out.sources.filter(function (s) { return !s.ok; }).length,
              expanded: out.expanded, documents: out.documents },
      kind: "live", sources: out.sources
    };
  }

  function searchLibrary(q) {
    var raw = root.search(root.INDEX, q, { limit: 60 }) || [];
    var results = raw.map(function (r) {
      return { doc: r.doc, score: r.score, confidence: r.confidence, why: { lexical: +((r.bm25 || 0) / 12).toFixed(2), semantic: +(r.cos || 0).toFixed(2) } };
    });
    try { results = ANV.learn.rerank(results, {}); } catch (e) {}
    return { results: results, meta: { corpus: (root.DOCS || []).length, matched: results.length }, kind: "library" };
  }

  /* ----------------------------------------------------------------- render */
  function renderStatus(out) {
    var m = state.lastMeta || {};
    var bits = [];
    if (out.kind === "index") {
      bits.push(m.matched + " documents matched");
      bits.push(m.shards + " index shards read");
      bits.push(kb(m.bytes) + " downloaded");
    } else if (out.kind === "live") {
      bits.push(m.documents + " documents from " + m.answered + " live collections");
      if (m.failed) bits.push(m.failed + " unavailable");
    } else {
      bits.push(m.matched + " documents matched in the library");
    }
    bits.push(m.ms + " ms");
    $("#status").innerHTML = bits.map(function (b) { return '<span class="badge">' + esc(b) + "</span>"; }).join(" ");
  }

  function renderAnswer(q, out) {
    var host = $("#answer");
    if (!out.results.length) { host.innerHTML = ""; return; }
    var terms = ANV.lang.tokenise(q);
    var picks = [];
    out.results.slice(0, 5).forEach(function (r) {
      var sents = ANV.lang.sentenceSplit(r.doc.b || "");
      var best = null, bestScore = 0;
      sents.forEach(function (s) {
        if (s.length < 55) return;
        var low = ANV.lang.normalise(s), hits = 0;
        terms.forEach(function (t) { if (low.indexOf(t) >= 0) hits++; });
        var sc = hits + (/\d/.test(s) ? 0.35 : 0) - s.length / 900;
        if (sc > bestScore) { bestScore = sc; best = s; }
      });
      if (best) picks.push({ text: best.trim(), doc: r.doc });
    });
    if (!picks.length) picks = out.results.slice(0, 2).map(function (r) {
      return { text: String(r.doc.b || r.doc.t || "").slice(0, 260), doc: r.doc };
    });
    picks = picks.slice(0, 3);
    if (!picks.length) { host.innerHTML = ""; return; }

    var text = picks.map(function (p, i) {
      return highlight(p.text, terms) + '<sup><a href="#r' + (i + 1) + '" onclick="return false" title="' + esc(p.doc.t) + '">[' + (i + 1) + "]</a></sup>";
    }).join(" ");
    var srcs = picks.map(function (p, i) {
      var u = p.doc.u || "";
      return "<li>" + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' : "<span>") +
        esc(String(p.doc.t).slice(0, 110)) + (u ? "</a>" : "</span>") +
        " — " + esc(p.doc.s || host(u) || "") + (p.doc.d ? ", " + esc(year(p.doc.d)) : "") + "</li>";
    }).join("");

    host.innerHTML = '<div class="answer"><h2>Answer</h2>' +
      '<p class="text">' + text + "</p>" +
      '<div class="foot"><span class="badge accent">quoted, not generated</span>' +
      "<span>" + picks.length + " source" + (picks.length === 1 ? "" : "s") + "</span>" +
      '<details><summary>Show sources</summary><ol>' + srcs + "</ol></details></div></div>";
  }

  function badgeFor(doc) {
    var out = [];
    try {
      var cred = ANV.evidence.credibility(doc, {});
      out.push('<span class="badge ' + (cred.label === "strong" ? "ok" : cred.label === "fair" ? "info" : cred.label === "weak" ? "warn" : "bad") +
        '" title="' + esc(cred.why) + '">' + esc(cred.label) + " source</span>");
      if (cred.source.peerReviewed) out.push('<span class="badge ok">peer-reviewed</span>');
      if (doc.live && doc.live.retracted) out.push('<span class="badge bad">retracted</span>');
      if (cred.freshness && cred.freshness.stale) out.push('<span class="badge warn">check the date</span>');
    } catch (e) {}
    return out.join("");
  }

  function cardHTML(r, i) {
    var doc = r.doc;
    var terms = ANV.lang.tokenise(state.q);
    var url = doc.u || "";
    var meta = [doc.s, host(url), year(doc.d)].filter(Boolean);
    return '<article class="card" id="r' + (i + 1) + '">' +
      "<h3>" + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(doc.t) + "</a>" : esc(doc.t)) + "</h3>" +
      '<p class="src">' + meta.map(function (m) { return esc(m); }).join('<span class="sep">·</span>') + "</p>" +
      '<p class="snip">' + highlight(r.snippet || doc.b || "", terms) + "</p>" +
      '<div class="badges">' + badgeFor(doc) + "</div>" +
      '<div class="acts">' +
      (url ? '<a class="btn ghost" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Open source</a>' : "") +
      '<button class="btn ghost" data-detail="' + esc(doc.id) + '">Details</button>' +
      "</div></article>";
  }

  function renderCards() {
    var list = state.results.slice(0, state.shown);
    $("#cards").innerHTML = list.map(cardHTML).join("");
    $$("#cards [data-detail]").forEach(function (b) {
      b.addEventListener("click", function () { openDetail(b.getAttribute("data-detail")); });
    });
    var more = state.results.length - state.shown;
    $("#more").innerHTML = more > 0
      ? '<button class="btn" id="btnMore">Show ' + Math.min(10, more) + " more</button>" : "";
    if (more > 0) $("#btnMore").addEventListener("click", function () { state.shown += 10; renderCards(); });
  }

  function renderEmpty(msg, isError) {
    $("#cards").innerHTML = '<div class="empty"><h3>' + (isError ? "That did not work" : "No results") + "</h3>" +
      "<p>" + esc(msg) + "</p>" +
      (isError ? '<button class="btn" id="btnFallback">Try the live web instead</button>'
        : '<button class="btn" id="btnFallback">Search the live web instead</button>') + "</div>";
    $("#more").innerHTML = "";
    var b = $("#btnFallback");
    if (b) b.addEventListener("click", function () {
      state.engine = "live";
      renderEngines();
      runSearch(state.q);
    });
  }

  /* ---------------------------------------------------------------- filters */
  function buildFilters() {
    var by = { type: {}, source: {}, year: {}, lang: {} };
    state.base.forEach(function (r) {
      var doc = r.doc;
      by.type[doc.ty || "other"] = (by.type[doc.ty || "other"] || 0) + 1;
      if (doc.s) by.source[doc.s] = (by.source[doc.s] || 0) + 1;
      var y = year(doc.d);
      if (y) by.year[y] = (by.year[y] || 0) + 1;
      if (doc.l) by.lang[doc.l] = (by.lang[doc.l] || 0) + 1;
    });
    function opts(obj, label, current, pretty) {
      var keys = Object.keys(obj).sort(function (a, b) {
        return label === "year" ? b.localeCompare(a) : obj[b] - obj[a];
      }).slice(0, 12);
      return '<div><label for="f-' + label + '">' + label + "</label><select id=\"f-" + label + "\" data-filter=\"" + label + "\">" +
        '<option value="all">All</option>' +
        keys.map(function (k) {
          return '<option value="' + esc(k) + '"' + (current === k ? " selected" : "") + ">" +
            esc(pretty ? pretty(k) : k) + " (" + obj[k] + ")</option>";
        }).join("") + "</select></div>";
    }
    $("#filters").innerHTML =
      opts(by.type, "type", state.filters.type) +
      opts(by.source, "source", state.filters.source) +
      opts(by.year, "year", state.filters.year) +
      opts(by.lang, "lang", state.filters.lang);
    $$("#filters select").forEach(function (s) {
      s.addEventListener("change", function () {
        state.filters[s.getAttribute("data-filter")] = s.value;
        state.shown = 10;
        applyFilters();
      });
    });
  }

  function applyFilters() {
    var f = state.filters;
    state.results = state.base.filter(function (r) {
      var doc = r.doc;
      if (f.type !== "all" && (doc.ty || "other") !== f.type) return false;
      if (f.source !== "all" && doc.s !== f.source) return false;
      if (f.year !== "all" && year(doc.d) !== f.year) return false;
      if (f.lang !== "all" && doc.l !== f.lang) return false;
      return true;
    });
    if (!state.base.length) { renderEmpty(emptyMessage(), false); return; }
    $("#count").textContent = state.results.length + (state.results.length === 1 ? " result" : " results") +
      (state.results.length !== state.base.length ? " (filtered from " + state.base.length + ")" : "");
    if (!state.results.length) {
      $("#cards").innerHTML = '<div class="empty"><h3>Nothing matches those filters</h3><p>Try widening them.</p></div>';
      $("#more").innerHTML = "";
      return;
    }
    renderCards();
    buildFilters();
  }

  function emptyMessage() {
    if (state.engine === "index") return "The crawled index has nothing for that. The live web may: it searches fifteen collections in real time.";
    if (state.engine === "live") return "The open collections returned nothing. Try fewer words, or switch to the crawled index.";
    return "The library has nothing for that. Try the crawled index or the live web.";
  }

  /* ----------------------------------------------------------------- drawer */
  function openDetail(id) {
    var r = state.results.concat(state.base).filter(function (x) { return x.doc.id === id; })[0];
    if (!r) return;
    var doc = r.doc;
    var cred = {};
    try { cred = ANV.evidence.credibility(doc, {}); } catch (e) {}
    $("#drawerTitle").textContent = doc.t;
    var body = '<div class="doc-meta">' +
      '<span class="badge">' + esc((root.TYPE_LABEL && root.TYPE_LABEL[doc.ty]) || doc.ty || "document") + "</span>" +
      (doc.s ? '<span class="badge">' + esc(doc.s) + "</span>" : "") +
      (doc.d ? '<span class="badge">' + esc(doc.d) + "</span>" : "") +
      (cred.score != null ? '<span class="badge ' + (cred.label === "strong" ? "ok" : cred.label === "fair" ? "info" : "warn") + '">' +
        esc(cred.label) + " · " + pct(cred.score) + "</span>" : "") +
      "</div>";
    body += '<div class="doc-text">' + esc(doc.b || "No text was captured for this document.").split(/\n+/).map(function (p) {
      return "<p>" + p + "</p>";
    }).join("") + "</div>";
    if (cred.why) body += '<h3>Why this source scores as it does</h3><p class="lede">' + esc(cred.why) + "</p>";
    body += '<div class="row">' +
      (doc.u ? '<a class="btn primary" href="' + esc(doc.u) + '" target="_blank" rel="noopener noreferrer">Open the original</a>' : "") +
      '<button class="btn ghost" id="btnFlag">This looks wrong</button></div>';
    $("#drawerBody").innerHTML = body;
    $("#drawer").hidden = false;
    $("#drawerClose").focus();
    var flag = $("#btnFlag");
    if (flag) flag.addEventListener("click", function () {
      try { ANV.learn.flagCorrection(doc.id, "flagged by reader", "unreliable"); } catch (e) {}
      toast("Noted. That source will rank lower for you.");
    });
  }

  /* ------------------------------------------------------------------ sheet */
  var TOOLS = [
    { id: "discover", label: "Discover" },
    { id: "verify", label: "Check" },
    { id: "investigate", label: "Research" },
    { id: "add", label: "Add documents" },
    { id: "learning", label: "Learning" },
    { id: "sources", label: "Sources" },
    { id: "audit", label: "What works" }
  ];

  function openSheet(tool) {
    state.tool = tool || state.tool;
    $("#sheetTabs").innerHTML = TOOLS.map(function (t) {
      return '<button class="tab" role="tab" data-tool="' + t.id + '" aria-selected="' + (state.tool === t.id) + '">' + esc(t.label) + "</button>";
    }).join("");
    $$("#sheetTabs .tab").forEach(function (b) {
      b.addEventListener("click", function () { state.tool = b.getAttribute("data-tool"); openSheet(state.tool); });
    });
    $("#sheetTitle").textContent = (TOOLS.filter(function (t) { return t.id === state.tool; })[0] || {}).label || "Tools";
    $("#sheetBody").innerHTML = TOOL_VIEWS[state.tool] ? TOOL_VIEWS[state.tool]() : "";
    $("#sheet").hidden = false;
    $("#btnTools").setAttribute("aria-expanded", "true");
    var first = $("#sheetTabs .tab[aria-selected='true']");
    if (first) first.focus();
    if (TOOL_AFTER[state.tool]) TOOL_AFTER[state.tool]();
  }
  function closeSheet() {
    $("#sheet").hidden = true;
    $("#btnTools").setAttribute("aria-expanded", "false");
  }

  /* ------------------------------------------------------------- tool views */
  var TOOL_VIEWS = {}, TOOL_AFTER = {};

  TOOL_VIEWS.discover = function () {
    var paradigms = (ANV.discovery && ANV.discovery.PARADIGMS) || [];
    return '<p class="lede">Ordinary search asks what exists. These ask what is missing, what caused what, what was forgotten, and what does not fit.</p>' +
      '<div class="row" style="flex-wrap:wrap">' + paradigms.map(function (p) {
        return '<button class="tab" data-paradigm="' + p.id + '">' + esc(p.label) + "</button>";
      }).join("") + "</div>" +
      '<div id="toolOut"><p class="lede">Pick one to run it on: <b>' + esc(state.q || "no search yet") + "</b></p></div>";
  };
  TOOL_AFTER.discover = function () {
    $$("#sheetBody [data-paradigm]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-paradigm");
        var out = $("#toolOut");
        if (!state.q) { out.innerHTML = '<p class="lede">Search for something first, then run a paradigm on it.</p>'; return; }
        out.innerHTML = '<p class="lede">running…</p>';
        setTimeout(function () {
          try {
            var r = ANV.discovery.run(id, state.q, currentIndex(), { query: state.q });
            out.innerHTML = renderParadigm(id, r);
          } catch (e) {
            out.innerHTML = '<p class="lede">That did not run: ' + esc(e.message) + "</p>";
          }
        }, 30);
      });
    });
  };

  function currentIndex() {
    if (state.engine === "library") return root.INDEX;
    var docs = state.base.map(function (r) { return r.doc; });
    try { return docs.length ? root.buildIndex(docs) : root.INDEX; } catch (e) { return root.INDEX; }
  }

  function renderParadigm(id, r) {
    if (!r) return '<p class="lede">Nothing came back.</p>';
    var h = "";
    if (r.summary) h += "<p>" + esc(r.summary) + "</p>";
    if (r.gaps && r.gaps.length) {
      h += "<h3>What nobody has answered</h3><ul>" + r.gaps.map(function (g) {
        return "<li><b>" + esc(g.label) + "</b> — " + esc(g.question || "") + "</li>";
      }).join("") + "</ul>";
    }
    if (r.chains && r.chains.length) {
      h += "<h3>What causes what</h3><ul>" + r.chains.slice(0, 6).map(function (c) {
        return "<li><b>" + esc(c.cause) + "</b> → " + esc(c.effect) + " " +
          '<span class="badge">' + c.support + " citation" + (c.support === 1 ? "" : "s") + "</span></li>";
      }).join("") + "</ul>";
    }
    if (r.outliers && r.outliers.length) {
      h += "<h3>Figures that do not fit</h3><ul>" + r.outliers.slice(0, 5).map(function (o) {
        return "<li><b>" + esc(o.raw) + "</b> — " + esc(o.note) + "</li>";
      }).join("") + "</ul>";
    }
    if (r.forgotten && r.forgotten.length) {
      h += "<h3>Relevant but buried</h3><ul>" + r.forgotten.slice(0, 5).map(function (f) {
        return "<li>" + esc(f.doc.t) + "</li>";
      }).join("") + "</ul>";
    }
    if (r.measured) {
      h += "<h3>Measured, not promised</h3><ul>" + r.measured.slice(0, 4).map(function (m) {
        return "<li>" + esc(m.sentence) + "</li>";
      }).join("") + "</ul>";
      if (r.projected && r.projected.length) {
        h += "<h3>Targets and forecasts</h3><ul>" + r.projected.slice(0, 4).map(function (m) {
          return "<li>" + esc(m.sentence) + "</li>";
        }).join("") + "</ul>";
      }
    }
    if (r.models && r.models.length) {
      h += "<h3>Arithmetic on the reported figures</h3><ul>" + r.models.map(function (m) {
        return "<li><b>" + esc(m.family) + "</b> — " + m.predictions.map(function (p) {
          return p.year + ": " + Math.round(p.value).toLocaleString("en-IN");
        }).join(", ") + ' <span class="badge">' + esc(m.caveat) + "</span></li>";
      }).join("") + "</ul>";
    }
    if (r.bridges && r.bridges.length) {
      h += "<h3>Other fields working on this</h3><p>" + r.bridges.slice(0, 8).map(function (b) {
        return '<span class="badge info">' + esc(b.concept) + " · " + esc(b.fields.join(", ")) + "</span>";
      }).join(" ") + "</p>";
    }
    if (r.evolution) {
      h += "<h3>How the words moved over time</h3><ul>" + r.evolution.map(function (e) {
        return "<li><b>" + esc(e.term) + "</b> " + e.counts.map(function (c) { return c.year + ":" + c.n; }).join(" ") + "</li>";
      }).join("") + "</ul>";
    }
    if (r.orders) {
      h += "<h3>Knock-on effects</h3>" + r.orders.map(function (o) {
        return "<p><b>" + esc(o.label) + "</b>: " + o.items.map(esc).join(", ") + ' <span class="badge">' + esc(o.certainty) + "</span></p>";
      }).join("");
    }
    if (r.before && r.after) {
      h += "<h3>Did it improve?</h3><p>Ranking quality before: " + r.before.mrr + ", after: " + r.after.mrr + ". " + esc(r.caveat || "") + "</p>";
    }
    if (r.unstudiedCombinations && r.unstudiedCombinations.length) {
      h += "<h3>Never discussed together</h3><ul>" + r.unstudiedCombinations.slice(0, 5).map(function (c) {
        return "<li>" + esc(c.pair[0]) + " + " + esc(c.pair[1]) + "</li>";
      }).join("") + "</ul>";
    }
    return h || '<p class="lede">Nothing notable came back for that.</p>';
  }

  TOOL_VIEWS.verify = function () {
    if (!state.results.length) return '<p class="lede">Search first, then come back: this checks the results against each other.</p>';
    var pool = state.results.slice(0, 8).map(function (r) { return r.doc; });
    var h = '<p class="lede">Do the sources actually back each other up?</p>';
    try {
      var ind = ANV.evidence.independenceReport(pool);
      h += '<div class="kv"><div><span>Independent voices</span><b>' + ind.independentSources + "</b></div>" +
        "<div><span>Documents</span><b>" + ind.documents + "</b></div>" +
        "<div><span>Verdict</span><b>" + esc(ind.verdict) + "</b></div></div>" +
        "<p>" + esc(ind.note) + "</p>";
    } catch (e) {}
    h += "<h3>Source by source</h3><table class='tbl'><tr><th>Document</th><th>Score</th></tr>" +
      state.results.slice(0, 6).map(function (r) {
        var c = {};
        try { c = ANV.evidence.credibility(r.doc, {}); } catch (e) {}
        return "<tr><td>" + esc(String(r.doc.t).slice(0, 70)) + "</td><td>" + esc(c.label || "—") + " " + pct(c.score) + "</td></tr>";
      }).join("") + "</table>";
    try {
      var contra = ANV.evidence.contradictionLab(state.q, currentIndex(), { limit: 4 });
      if (contra.length) {
        h += "<h3>Where the numbers disagree</h3><ul>" + contra.map(function (c) {
          return "<li><b>" + esc(c.key) + "</b> — " + esc(c.note) + "</li>";
        }).join("") + "</ul>";
      } else {
        h += "<h3>Where the numbers disagree</h3><p class='lede'>No conflicting figures found in this result set.</p>";
      }
    } catch (e) {}
    return h;
  };

  TOOL_VIEWS.investigate = function () {
    return '<p class="lede">A multi-step investigation: plan, read, cross-check, find the gaps, then write it up with citations.</p>' +
      '<div class="row"><input type="text" id="invQ" value="' + esc(state.q || "") + '" placeholder="What should be investigated?">' +
      '<button class="btn primary" id="invGo">Investigate</button></div><div id="invOut"></div>';
  };
  TOOL_AFTER.investigate = function () {
    var go = $("#invGo");
    if (!go) return;
    go.addEventListener("click", function () {
      var q = ($("#invQ") || {}).value || "";
      if (!q.trim()) return;
      var out = $("#invOut");
      out.innerHTML = '<p class="lede">working… this takes a moment.</p>';
      setTimeout(function () {
        try {
          var dossier = ANV.agent.investigate(q.trim(), currentIndex(), { rounds: 3, budget: 16 });
          out.innerHTML = '<div class="kv"><div><span>Confidence</span><b>' + pct(dossier.confidence) + "</b></div>" +
            "<div><span>Documents read</span><b>" + dossier.stats.documentsRead + "</b></div>" +
            "<div><span>Queries run</span><b>" + dossier.stats.queries + "</b></div></div>" +
            "<h3>Findings</h3><ul>" + dossier.findings.map(function (f) {
              return "<li>" + esc(f.statement) + ' <span class="badge">' + esc(f.verdict) + "</span></li>";
            }).join("") + "</ul>" +
            (dossier.gaps.length ? "<h3>Still unanswered</h3><ul>" + dossier.gaps.map(function (g) {
              return "<li>" + esc(g.label) + "</li>";
            }).join("") + "</ul>" : "") +
            "<h3>What to do next</h3><ul>" + dossier.nextSteps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ul>" +
            '<div class="row"><button class="btn ghost" id="invCopy">Copy as Markdown</button></div>';
          var copy = $("#invCopy");
          if (copy) copy.addEventListener("click", function () {
            if (navigator.clipboard) navigator.clipboard.writeText(dossier.markdown).then(function () { toast("Copied"); });
          });
        } catch (e) {
          out.innerHTML = '<p class="lede">The investigation failed: ' + esc(e.message) + "</p>";
        }
      }, 40);
    });
  };

  TOOL_VIEWS.add = function () {
    return '<p class="lede">PDF, Word, PowerPoint, Excel, CSV, JSON, HTML, Markdown, text and ZIP — read in this tab and added to your own searchable set.</p>' +
      '<div class="row"><input type="file" id="files" multiple accept=".pdf,.docx,.pptx,.xlsx,.odt,.csv,.tsv,.json,.html,.md,.txt,.zip"></div>' +
      '<div class="row"><button class="btn primary" id="addGo">Read and add</button></div>' +
      '<h3>Or paste text</h3><textarea id="paste" placeholder="Paste a report, a chapter, a transcript…"></textarea>' +
      '<div class="row"><button class="btn" id="pasteGo">Add pasted text</button></div><div id="addOut"></div>';
  };
  TOOL_AFTER.add = function () {
    function report(res) {
      $("#addOut").innerHTML = '<div class="kv"><div><span>Added</span><b>' + res.added + "</b></div>" +
        "<div><span>Duplicates skipped</span><b>" + (res.skipped || []).length + "</b></div>" +
        "<div><span>Your library</span><b>" + res.total + "</b></div></div>" +
        '<p class="lede">Search it from the "Verified library" engine.</p>';
    }
    var go = $("#addGo");
    if (go) go.addEventListener("click", async function () {
      var input = $("#files");
      if (!input.files.length) { toast("Choose a file first"); return; }
      var all = [];
      for (var i = 0; i < input.files.length; i++) {
        try {
          var read = await ANV.ingest.readFile(input.files[i]);
          all = all.concat(ANV.ingest.toDocuments(read, { org: "Your import" }));
        } catch (e) { toast("Could not read " + input.files[i].name); }
      }
      report(all.length ? ANV.ingest.addToIndex(all) : { added: 0, skipped: [], total: (root.DOCS || []).length });
      try { root.INDEX = root.buildIndex(root.DOCS); } catch (e) {}
    });
    var pg = $("#pasteGo");
    if (pg) pg.addEventListener("click", function () {
      var text = ($("#paste") || {}).value || "";
      if (text.trim().length < 40) { toast("Paste at least a paragraph"); return; }
      var read = { name: "pasted note", text: text, meta: {}, kind: "text", words: text.split(/\s+/).length, scan: ANV.ingest.scanForInjection(text) };
      var docs = ANV.ingest.toDocuments(read, { org: "Your import" });
      report(ANV.ingest.addToIndex(docs));
      try { root.INDEX = root.buildIndex(root.DOCS); } catch (e) {}
    });
  };

  TOOL_VIEWS.learning = function () {
    var w = {}, mon = {};
    try { w = ANV.learn.weights(); mon = ANV.learn.monitor(); } catch (e) {}
    return '<p class="lede">What the engine has learned from your clicks — and how to undo it. It changes which sources surface, never what they say.</p>' +
      '<div class="kv"><div><span>Searches</span><b>' + (mon.queries || 0) + "</b></div>" +
      "<div><span>Empty results</span><b>" + pct(mon.zeroResultRate) + "</b></div>" +
      "<div><span>Typical speed</span><b>" + (mon.latencyMedian != null ? mon.latencyMedian + " ms" : "—") + "</b></div></div>" +
      '<h3>Ranking weights</h3><table class="tbl"><tr><th>Signal</th><th>Weight</th></tr>' +
      Object.keys(w).map(function (k) { return "<tr><td>" + esc(k) + "</td><td>" + w[k] + "</td></tr>"; }).join("") + "</table>" +
      '<div class="row"><button class="btn" id="learnTrain">Learn from my clicks</button>' +
      '<button class="btn ghost" id="learnExport">Export my data</button>' +
      '<button class="btn ghost" id="learnReset">Forget everything</button></div><div id="learnOut"></div>';
  };
  TOOL_AFTER.learning = function () {
    var t = $("#learnTrain");
    if (t) t.addEventListener("click", function () {
      var r = ANV.learn.train({});
      $("#learnOut").innerHTML = "<p>" + esc(r.trained ? (r.adopted ? "Updated: ranking quality " + r.before.ndcg + " → " + r.after.ndcg : "No improvement measured, so nothing changed.") : r.note) + "</p>";
    });
    var e = $("#learnExport");
    if (e) e.addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(ANV.learn.exportAll(), null, 2)], { type: "application/json" });
      var a = d.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "anveshan-my-data.json";
      a.click();
    });
    var r = $("#learnReset");
    if (r) r.addEventListener("click", function () { ANV.learn.reset(); toast("Local learning data cleared"); openSheet("learning"); });
  };

  TOOL_VIEWS.sources = function () {
    var h = "";
    if (state.indexInfo) {
      var srcs = Object.keys(state.indexInfo.sources || {}).map(function (k) {
        return "<li>" + esc(k) + " — " + state.indexInfo.sources[k].count + " documents</li>";
      }).join("");
      h += "<h3>Our own index</h3><div class='kv'><div><span>Documents</span><b>" + state.indexInfo.docs.toLocaleString("en-IN") + "</b></div>" +
        "<div><span>Terms</span><b>" + state.indexInfo.terms.toLocaleString("en-IN") + "</b></div>" +
        "<div><span>Size</span><b>" + kb(state.indexInfo.bytes) + "</b></div></div>" +
        "<p class='lede'>Rebuilt " + esc(String(state.indexInfo.builtAt).slice(0, 16).replace("T", " ")) + " by a crawler on a schedule.</p>" +
        "<ul>" + srcs + "</ul>";
    }
    if (ANV.live) {
      h += "<h3>Live collections</h3><p class='lede'>Queried directly from your browser. Free, no keys.</p><ul>" +
        ANV.live.SOURCES.map(function (s) { return "<li><b>" + esc(s.label) + "</b> — " + esc(s.note) + "</li>"; }).join("") + "</ul>";
    }
    h += "<h3>Library</h3><p class='lede'>170 curated documents with full cross-checking, built in.</p>";
    return h;
  };

  TOOL_VIEWS.audit = function () {
    var M = root.ANV_MATRIX || [];
    var counts = { live: 0, partial: 0, adapter: 0, out: 0 };
    M.forEach(function (g) { g.items.forEach(function (i) { counts[i[1]] = (counts[i[1]] || 0) + 1; }); });
    var h = '<p class="lede">Every promise this engine makes, checked against the code. Nothing says "working" unless you can try it.</p>' +
      '<div class="kv"><div><span>Working</span><b>' + counts.live + "</b></div>" +
      "<div><span>Partly</span><b>" + counts.partial + "</b></div>" +
      "<div><span>Needs a service</span><b>" + counts.adapter + "</b></div>" +
      "<div><span>Not possible here</span><b>" + counts.out + "</b></div></div>";
    h += M.map(function (g) {
      var rows = g.items.map(function (i) {
        var cls = i[1] === "live" ? "ok" : i[1] === "partial" ? "info" : i[1] === "adapter" ? "warn" : "bad";
        var word = i[1] === "live" ? "working" : i[1] === "partial" ? "partly" : i[1] === "adapter" ? "needs a service" : "not here";
        return '<tr><td><b>' + esc(i[0]) + "</b><br><span class=\"lede\">" + esc(i[2]) + '</span></td><td><span class="badge ' + cls + '">' + word + "</span></td></tr>";
      }).join("");
      return "<h3>" + esc(g.g) + "</h3><table class='tbl'>" + rows + "</table>";
    }).join("");
    return h;
  };

  /* -------------------------------------------------------------------- boot */
  function bindChrome() {
    $("#searchForm").addEventListener("submit", function (e) { e.preventDefault(); runSearch($("#q").value); });
    $("#searchForm2").addEventListener("submit", function (e) { e.preventDefault(); runSearch($("#q2").value); });
    $("#homeLink").addEventListener("click", function (e) {
      e.preventDefault();
      showResults(false);
      $("#q").focus();
      try { history.replaceState(null, "", location.pathname); } catch (err) {}
    });
    $("#btnTools").addEventListener("click", function () { openSheet(); });
    $("#sheetClose").addEventListener("click", closeSheet);
    $("#drawerClose").addEventListener("click", function () { $("#drawer").hidden = true; });
    $("#sheet").addEventListener("click", function (e) { if (e.target === $("#sheet")) closeSheet(); });
    $("#drawer").addEventListener("click", function (e) { if (e.target === $("#drawer")) $("#drawer").hidden = true; });
    $("#btnFilters").addEventListener("click", function () {
      var box = $("#filters");
      box.hidden = !box.hidden;
      this.setAttribute("aria-expanded", String(!box.hidden));
      if (!box.hidden) buildFilters();
    });
    d.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closeSheet(); $("#drawer").hidden = true; }
      if (e.key === "/" && !/^(INPUT|TEXTAREA)$/.test(d.activeElement.tagName)) {
        e.preventDefault();
        (state.q ? $("#q2") : $("#q")).focus();
      }
    });
  }

  async function boot() {
    if (typeof root.DOCS === "undefined" || typeof root.buildIndex !== "function") { setTimeout(boot, 60); return; }
    // merge the world corpus into the library and build its index once
    try {
      if (root.WORLD_DOCS_1) DOCS.push.apply(DOCS, root.WORLD_DOCS_1);
      if (root.WORLD_DOCS_2) DOCS.push.apply(DOCS, root.WORLD_DOCS_2);
    } catch (e) {}
    root.INDEX = root.buildIndex(root.DOCS);
    try { root.computeAuthority && root.computeAuthority(root.DOCS); } catch (e) {}

    initTheme();
    bindChrome();
    renderExamples();

    if (ANV.central) {
      try {
        var man = await ANV.central.load("index/");
        state.centralReady = !!(man && man.docs > 0);
        state.indexInfo = ANV.central.info();
      } catch (e) { state.centralReady = false; }
    }
    if (ANV.live) state.liveInfo = { sources: ANV.live.SOURCES.length };
    if (!state.centralReady) state.engine = state.liveReady ? "live" : "library";
    renderEngines();

    var hash = (root.location && location.hash) || "";
    var em = hash.match(/engine=(index|live|library)/);
    if (em) { state.engine = em[1]; renderEngines(); }
    var qm = hash.match(/[#&]q=([^&]+)/);
    if (qm) {
      var q = decodeURIComponent(qm[1]);
      $("#q").value = q;
      runSearch(q);
    } else {
      $("#q").focus();
    }
    state.ready = true;
  }

  /* exposed for tests and for the rare power user */
  ANV.ui = {
    state: state, runSearch: runSearch, openSheet: openSheet, openDetail: openDetail,
    setEngine: function (id) { state.engine = id; renderEngines(); },
    ready: false
  };
  Object.defineProperty(ANV.ui, "ready", { get: function () { return !!state.ready; } });

  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 0); });
  else setTimeout(boot, 0);
})(typeof globalThis !== "undefined" ? globalThis : this);
