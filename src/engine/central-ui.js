/* ============================================================================
   ANVESHAN v6 - LAYER 13: THE CENTRAL-INDEX INTERFACE
   Engine 1 of three. The crawler commits a sharded index to this repository;
   this layer queries it directly from the browser, with no server in between.

   Engine order in the interface:
     Index    the crawled corpus (fast, offline-capable once cached, grows on a
              schedule via GitHub Actions)
     Live     fifteen public APIs queried at request time (freshest)
     Library  the curated 170-document set with full verification (deepest)

   All three feed the same evidence, discovery, investigator and learning code.
   ========================================================================== */
(function (root) {
  "use strict";
  var ANV = root.ANV;
  var doc = root.document;
  if (!ANV || !doc || !ANV.central) return;

  var state = { mode: "index", indexReady: false, indexInfo: null, last: null, error: null };
  ANV.centralUI = state;

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function pct(x) { return Math.round((x || 0) * 100) + "%"; }
  function kb(bytes) { return bytes > 1024 * 1024 ? (bytes / 1048576).toFixed(1) + " MB" : Math.round(bytes / 1024) + " KB"; }
  function chip(t, cls) { return '<span class="v4-chip ' + (cls || "") + '">' + esc(t) + "</span>"; }
  function now() { return Date.now(); }

  var LEGACY = {};
  var LIVE = {};

  /* ------------------------------------------------------------ mode switch */
  function setMode(mode) {
    state.mode = mode;
    if (ANV.liveUI) ANV.liveUI.mode = mode === "live" ? "web" : "library";
    if (ANV.ui) ANV.ui.state.override = null;
    if (root.S && root.S.q) root.doSearch(root.S.q, false);
    else if (root.toast) {
      root.toast(mode === "index" ? "Index engine: the crawled corpus"
        : mode === "live" ? "Live engine: fifteen open APIs"
        : "Library engine: the verified offline collection");
    }
  }

  /* ----------------------------------------------------------------- search */
  function runIndex(q, record) {
    var S = root.S;
    S.q = q;
    state.gen = (state.gen || 0) + 1;
    var gen = state.gen;
    doc.getElementById("hero").style.display = "none";
    var host = doc.getElementById("results");
    host.style.display = "block";

    var U = ANV.understand;
    var rewrite = U.context.rewrite(q);
    var effective = rewrite.rewritten ? rewrite.text : q;
    var plan = U.plan(effective);
    if (ANV.ui) {
      ANV.ui.state.plan = plan;
      ANV.ui.state.rewrite = rewrite.rewritten ? rewrite : null;
    }

    host.innerHTML = shell(q, plan);
    var t0 = now();

    ANV.central.search(effective, { limit: 60 }).then(function (out) {
      if (gen !== state.gen) return;
      state.last = out;
      S.base = out.results;
      S.results = out.results;
      S.filters = { type: "all", org: "all", lang: "all", from: null, to: null };
      var docs = out.results.map(function (r) { return r.doc; });
      docs.forEach(function (d) { LIVE[d.id] = d; });
      var mini = null;
      try { mini = root.buildIndex ? root.buildIndex(docs) : null; } catch (e) { mini = null; }
      if (ANV.ui) {
        ANV.ui.state.override = { docs: docs, index: mini };
        ANV.ui.state.lastRun = { query: effective, ms: out.meta.ms };
      }
      try {
        U.context.observe(effective, plan.intent, out.results.slice(0, 4).map(function (r) { return (r.doc.k || [])[0]; }).filter(Boolean));
        ANV.learn.logQuery(effective, out.results, { ms: out.meta.ms, engine: "index" });
      } catch (e) {}
      root.renderResults();
      var q2 = doc.getElementById("q2");
      if (q2) q2.value = q;
      if (record && root.addBlock) {
        root.addBlock(q, out.results.slice(0, 8).map(function (r) { return r.doc.id; }));
        try { history.replaceState(null, "", "#q=" + encodeURIComponent(q) + "&engine=index"); } catch (e) {}
      }
    }).catch(function (err) {
      if (gen !== state.gen) return;
      var body = doc.getElementById("v4ixbody");
      if (body) {
        body.innerHTML = '<div class="v4-block"><h4>The index could not be read</h4><p class="v4-lead">' +
          esc(err && err.message ? err.message : "unavailable") +
          "</p><p class='v4-note'>The central index is a set of static files in the repository. If they are missing or blocked, use the Live engine, which queries the open APIs directly.</p>" +
          '<div class="v4-row"><button class="v4-btn" onclick="ANV.centralUI.setMode(\'live\')">Switch to Live</button>' +
          '<button class="v4-btn ghost" onclick="ANV.centralUI.setMode(\'library\')">Switch to Library</button></div></div>';
      }
    });
  }

  function shell(q, plan) {
    var info = state.indexInfo || {};
    var h = '<div class="resbar"><div class="inner">' +
      '<div class="mini"><span class="ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg></span>' +
      '<input id="q2" value="' + esc(q) + '" autocomplete="off" spellcheck="false"><span class="kbd">Enter</span></div>' +
      modeButtons() +
      "</div></div>";
    h += '<div class="v4bar"><div class="inner">' +
      '<span class="v4-tag">index</span>' +
      '<span class="v4-dim">' + esc(plan.intent) + "</span>" +
      '<span class="v4-dim">expects ' + esc(plan.answerType) + "</span>" +
      '<span class="v4-dim">' + (info.docs || 0) + " documents · built " + esc(String(info.builtAt || "").slice(0, 10)) + "</span>" +
      '<span class="v4-grow"></span>' +
      '<button class="v4-mini" onclick="openPanel(\'discover\')">Discover</button>' +
      '<button class="v4-mini" onclick="openPanel(\'investigate\')">Investigate</button>' +
      '<button class="v4-mini" onclick="openPanel(\'verify\')">Verify</button>' +
      "</div>";
    h += '<div class="v4-src" id="v4ixmeta"></div></div>';
    h += '<div id="v4ixbody"><p class="v4-note" style="padding:18px 2px">Retrieving from the index…</p></div>';
    return h;
  }

  function modeButtons() {
    var modes = [["index", "Index"], ["live", "Live"], ["library", "Library"]];
    return modes.map(function (m) {
      return '<button class="nbtn' + (state.mode === m[0] ? " on" : "") +
        '" onclick="ANV.centralUI.setMode(\'' + m[0] + '\')" title="' +
        (m[0] === "index" ? "the crawled corpus, served as static files"
          : m[0] === "live" ? "fifteen public APIs, queried now"
          : "the curated offline collection") + '">' + m[1] + "</button>";
    }).join("");
  }

  /* -------------------------------------------------------------- painting */
  /** Keep an engine switcher in the results bar after any repaint. */
  function injectModeBar() {
    if (doc.getElementById("v4modes")) return;
    var inner = doc.querySelector("#results .resbar .inner");
    if (!inner) return;
    var box = doc.createElement("span");
    box.id = "v4modes";
    box.style.display = "inline-flex";
    box.style.gap = "4px";
    box.innerHTML = modeButtons();
    inner.appendChild(box);
  }

  function injectMeta() {
    var host = doc.getElementById("results");
    if (!host || !state.last) return;
    if (doc.getElementById("v4ixmeta")) return;
    var anchor = host.querySelector(".v4bar") || host.querySelector(".resbar");
    var strip = doc.createElement("div");
    strip.className = "v4-src";
    strip.id = "v4ixmeta";
    var m = state.last.meta || {};
    var info = state.indexInfo || {};
    strip.innerHTML =
      chip((m.matched || 0) + " documents matched", "v4-ok") +
      chip(m.shards + " term shards", "v4-kind") +
      chip(kb(m.bytes || 0) + " fetched", "v4-kind") +
      chip(m.ms + " ms", "v4-kind") +
      '<span class="v4-grow"></span><span class="v4-dim">corpus ' + (m.corpus || info.docs || 0) +
      " documents · " + (info.terms || 0) + " terms · " + kb(info.bytes || 0) + " index</span>";
    if (anchor && anchor.nextSibling) host.insertBefore(strip, anchor.nextSibling);
    else if (anchor) host.appendChild(strip);
    else host.insertBefore(strip, host.firstChild);
    var tag = host.querySelector(".v4bar .v4-tag");
    if (tag) tag.textContent = "index";
  }

  function indexBrief(out) {
    if (!out || !out.results.length) {
      return '<div class="brief"><div class="brief-top"><span class="brief-tag">No match</span></div>' +
        '<p class="v4-lead">No document in the crawled corpus matched. The index covers what the crawler has reached so far — try the Live engine for the freshest material.</p></div>';
    }
    var terms = ANV.lang.tokenise(out.query || (root.S && root.S.q) || "");
    var picks = [];
    out.results.slice(0, 5).forEach(function (r) {
      var sents = ANV.lang.sentenceSplit(r.doc.b || "");
      var best = null, bestScore = 0;
      sents.forEach(function (s) {
        if (s.length < 50) return;
        var low = ANV.lang.normalise(s), hits = 0;
        terms.forEach(function (t) { if (low.indexOf(t) >= 0) hits++; });
        var sc = hits + (/\d/.test(s) ? 0.4 : 0) - s.length / 900;
        if (sc > bestScore) { bestScore = sc; best = s; }
      });
      if (best) picks.push({ text: best.trim(), doc: r.doc });
    });
    if (!picks.length) picks = out.results.slice(0, 3).map(function (r) { return { text: (r.doc.b || r.doc.t).slice(0, 240), doc: r.doc }; });
    picks = picks.slice(0, 4);
    var conf = out.results.slice(0, 3).reduce(function (a, r) { return a + (r.confidence || 0); }, 0) / Math.min(3, out.results.length);
    var body = picks.map(function (p, i) {
      return esc(p.text) + '<span class="cite" onclick="openDoc(\'' + esc(p.doc.id) + '\')" title="' + esc(p.doc.t) + '">' + (i + 1) + "</span>";
    }).join(" ");
    var srcs = picks.map(function (p, i) {
      var d = p.doc;
      return '<a class="v4-srcitem" href="' + esc(d.u || "#") + '" target="_blank" rel="noopener noreferrer">[' + (i + 1) + "] " +
        esc(String(d.t).slice(0, 90)) + " — " + esc(d.s || "") + (d.d ? ", " + esc(String(d.d).slice(0, 4)) : "") + "</a>";
    }).join("");
    var expanded = out.expanded && out.expanded.length
      ? '<div class="v4-note">Related concepts from this result set: ' + out.expanded.map(function (e) { return chip(e.term, "v4-kind"); }).join(" ") + "</div>"
      : "";
    return '<div class="brief"><div class="brief-top"><span class="brief-tag">Answer</span>' +
      '<span class="brief-model">' + (out.meta.matched || 0) + " documents matched · " + pct(conf) +
      " confidence · quoted from the crawled corpus, nothing generated</span></div>" +
      '<p class="brief-text">' + body + "</p>" +
      '<div class="v4-srcs">' + srcs + "</div>" + expanded +
      '<div class="v4-note">Retrieved from a prebuilt index served as static files: ' + (out.meta.shards || 0) +
      " term shards fetched, " + kb(out.meta.bytes || 0) + ", " + out.meta.ms + " ms. Open Verify to cross-check these documents against each other.</div></div>";
  }

  /* ---------------------------------------------------------------- patches */
  function installPatches() {
    var prevDoSearch = root.doSearch;
    LEGACY.doSearch = prevDoSearch;

    root.doSearch = function (q, record) {
      q = String(q || "").trim();
      if (!q) { if (root.goHome) return root.goHome(); return; }
      if (state.mode === "index" && state.indexReady) return runIndex(q, record);
      return prevDoSearch.apply(null, arguments);
    };

    var prevBrief = root.briefHTML;
    root.briefHTML = function () {
      if (state.mode === "index" && state.last) return indexBrief(state.last);
      return prevBrief.apply(null, arguments);
    };

    var prevRender = root.renderResults;
    root.renderResults = function () {
      prevRender.apply(null, arguments);
      if (state.mode === "index" && state.last) { try { injectMeta(); } catch (e) {} }
      // the engine switcher must survive every repaint, whatever engine painted
      try { injectModeBar(); } catch (e) {}
    };

    var prevApply = root.applyFilters;
    root.applyFilters = function () {
      if (state.mode !== "index" || !state.last) return prevApply.apply(null, arguments);
      var S = root.S, f = S.filters || {};
      var res = (state.last.results || []).filter(function (r) {
        var d = r.doc;
        if (f.type && f.type !== "all" && d.ty !== f.type) return false;
        if (f.org && f.org !== "all" && d.o !== f.org) return false;
        if (f.lang && f.lang !== "all" && d.l !== f.lang) return false;
        if (f.from && (parseInt(String(d.d).slice(0, 4), 10) || 0) < f.from) return false;
        if (f.to && (parseInt(String(d.d).slice(0, 4), 10) || 0) > f.to) return false;
        return true;
      });
      S.results = res;
    };
  }

  /* ------------------------------------------------------------------- boot */
  async function boot() {
    if (!root.INDEX || !root.S) { setTimeout(boot, 140); return; }
    installPatches();

    try {
      var man = await ANV.central.load("index/");
      state.indexReady = !!(man && man.docs > 0);
      state.indexInfo = ANV.central.info();
    } catch (e) {
      state.indexReady = false;
      state.error = e.message;
    }

    if (!state.indexReady && ANV.liveUI) {
      state.mode = "web" === ANV.liveUI.mode ? "live" : "library";
      if (ANV.liveUI) ANV.liveUI.mode = state.mode === "live" ? "web" : "library";
    }

    var hash = (root.location && location.hash) || "";
    var em = hash.match(/engine=(index|live|library)/);
    if (em) state.mode = em[1];
    else if (state.indexReady) state.mode = "index";

    var sub = doc.querySelector(".hero p.sub");
    if (sub && state.indexReady) {
      var info = state.indexInfo;
      var srcs = Object.keys(info.sources || {}).length;
      sub.innerHTML = "A search engine over its own <b>" + info.docs.toLocaleString("en-IN") + "-document index</b>, crawled from " +
        srcs + " open sources and served as static files — plus <b>" + (ANV.live ? ANV.live.SOURCES.length : 15) +
        " live APIs</b> and a verified offline library. Three engines, one verification layer, <b>nothing you type is stored anywhere</b>.";
    }
    var tag = doc.querySelector(".brand-txt small");
    if (tag) tag.textContent = "v6 · universal knowledge engine";
    var st = doc.getElementById("stDocs");
    if (st) st.textContent = state.indexReady ? state.indexInfo.docs.toLocaleString("en-IN") : "15 sources";

    state.ready = true;
    var qm = hash.match(/[#&]q=([^&]+)/);
    if (qm) { try { root.doSearch(decodeURIComponent(qm[1]), false); } catch (e) {} }
  }

  state.setMode = setMode;
  state.info = function () { return { mode: state.mode, ready: state.indexReady, index: state.indexInfo, error: state.error }; };

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 100); });
  else setTimeout(boot, 100);
})(typeof globalThis !== "undefined" ? globalThis : this);
