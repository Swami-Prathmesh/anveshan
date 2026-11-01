/* ============================================================================
   ANVESHAN v5 - LAYER 11: LIVE INTERFACE
   Makes the page an online search engine: the search box queries the fifteen
   live sources, results paint as each source lands, every card carries a
   credibility strip, and the whole v4 intelligence stack (paradigms,
   investigator, verification, learning) runs over the live result set.

   Nothing here is cached server-side because there is no server. The browser is
   the engine; the sources are the index.
   ========================================================================== */
(function (root) {
  "use strict";
  var ANV = root.ANV;
  var doc = root.document;
  if (!ANV || !doc || !ANV.live) return;

  var state = { mode: "web", last: null, index: null, docs: null, watch: [], alerts: [] };
  ANV.liveUI = state;

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function now() { return Date.now(); }
  function pct(x) { return Math.round((x || 0) * 100) + "%"; }
  function chip(t, cls) { return '<span class="v4-chip ' + (cls || "") + '">' + esc(t) + "</span>"; }
  function kv(k, v) { return '<div class="v4-kv"><span>' + esc(k) + "</span><b>" + v + "</b></div>"; }
  function block(t, inner, note) {
    return '<div class="v4-block"><h4>' + esc(t) + "</h4>" + (inner || "") + (note ? '<p class="v4-note">' + esc(note) + "</p>" : "") + "</div>";
  }
  function list(items, render) {
    if (!items || !items.length) return '<p class="v4-empty">nothing found</p>';
    return '<ul class="v4-list">' + items.map(function (x) { return "<li>" + render(x) + "</li>"; }).join("") + "</ul>";
  }

  /* ------------------------------------------------ live document registry -- */
  var LIVE = {};
  function remember(results) {
    results.forEach(function (r) { LIVE[r.doc.id] = r.doc; });
  }

  /* --------------------------------------------------------- result types -- */
  function extendTypeLabels() {
    if (typeof root.TYPE_LABEL !== "object") return;
    var extra = {
      article: "Encyclopaedia", entity: "Entity", paper: "Paper", preprint: "Preprint",
      book: "Book", archive: "Archive", text: "Primary text", question: "Q&A",
      code: "Code", image: "Image", observation: "Measurement", dataset: "Dataset",
      audio: "Audio", video: "Video"
    };
    Object.keys(extra).forEach(function (k) { if (!root.TYPE_LABEL[k]) root.TYPE_LABEL[k] = extra[k]; });
    if (typeof root.TYPE_LABELS_3 === "object") {
      Object.keys(extra).forEach(function (k) { if (!root.TYPE_LABELS_3[k]) root.TYPE_LABELS_3[k] = extra[k]; });
    }
  }

  /* -------------------------------------------------------------- patches -- */
  var legacyDoSearch = root.doSearch;
  var legacyApplyFilters = root.applyFilters;
  var legacyBrief = root.briefHTML;
  var legacyOpenDoc = root.openDoc;

  function installPatches() {
    extendTypeLabels();

    // 1. the search box queries the live sources in web mode
    root.doSearch = function (q, record) {
      q = String(q || "").trim();
      if (!q) { if (root.goHome) return root.goHome(); return; }
      if (state.mode === "library") return legacyDoSearch.apply(null, arguments);
      return runLive(q, record);
    };

    // 2. filters apply to what was already fetched instead of re-running the
    //    whole federation on every checkbox
    root.applyFilters = function () {
      if (state.mode !== "web" || !state.last) return legacyApplyFilters.apply(null, arguments);
      var S = root.S;
      var f = S.filters || {};
      var res = (state.last.results || []).filter(function (r) {
        var d = r.doc;
        if (f.type && f.type !== "all" && d.ty !== f.type) return false;
        if (f.org && f.org !== "all" && d.o !== f.org) return false;
        if (f.lang && f.lang !== "all" && d.l !== f.lang) return false;
        if (f.from && (d.y || 0) < f.from) return false;
        if (f.to && (d.y || 0) > f.to) return false;
        return true;
      });
      if (S.sort === "date") res = res.slice().sort(function (a, b) { return (b.doc.d || "").localeCompare(a.doc.d || ""); });
      if (S.sort === "authority") res = res.slice().sort(function (a, b) { return (b.doc.a || 0) - (a.doc.a || 0); });
      if (S.sort === "title") res = res.slice().sort(function (a, b) { return (a.doc.t || "").localeCompare(b.doc.t || ""); });
      S.results = res;
    };

    // 3. the brief for a live result set
    root.briefHTML = function () {
      if (state.mode !== "web" || !state.last) return legacyBrief.apply(null, arguments);
      return liveBrief(state.last);
    };

    // 4. live documents open in the drawer with their own provenance
    root.openDoc = function (id, verify) {
      if (state.mode === "web" && LIVE[id] && !(root.DOCS || []).some(function (d) { return d.id === id; })) {
        return openLiveDoc(LIVE[id]);
      }
      return legacyOpenDoc.apply(null, arguments);
    };

    // 5. renderResults rebuilds the whole results area, so the live source strip
    //    has to be re-attached after every paint, not just once
    var prevRender = root.renderResults;
    root.renderResults = function () {
      prevRender.apply(null, arguments);
      if (state.mode === "web" && state.last) {
        try { injectLiveStrip(); } catch (e) {}
      }
    };
  }

  /* --------------------------------------------------------------- search -- */
  function runLive(q, record) {
    var S = root.S;
    S.q = q;
    // A new search invalidates any federation still in flight: without this a
    // slow earlier query can paint over the results of a newer one.
    state.gen = (state.gen || 0) + 1;
    var gen = state.gen;
    doc.getElementById("hero").style.display = "none";
    var host = doc.getElementById("results");
    host.style.display = "block";
    var t0 = now();

    var U = ANV.understand;
    var rewrite = U.context.rewrite(q);
    var effective = rewrite.rewritten ? rewrite.text : q;
    var plan = U.plan(effective);
    if (ANV.ui) {
      ANV.ui.state.plan = plan;
      ANV.ui.state.rewrite = rewrite.rewritten ? rewrite : null;
    }

    host.innerHTML = liveShell(q, plan);
    var tbody = doc.getElementById("v4livebody");
    var sources = ANV.live.SOURCES.map(function (s) {
      return { id: s.id, label: s.label, group: s.group, count: 0, ms: 0, ok: null };
    });
    paintSources(sources, 0);

    var collected = [];
    ANV.live.search(effective, {
      lang: plan.language === "deva" ? ANV.live.detectLang(effective) : "en",
      perSource: 5,
      onSource: function (rep, docs) {
        if (gen !== state.gen) return;
        for (var i = 0; i < sources.length; i++) if (sources[i].id === rep.id) sources[i] = rep;
        collected = collected.concat(docs);
        paintSources(sources, collected.length);
      }
    }).then(function (out) {
      if (gen !== state.gen) return;      // a newer query already took over
      state.last = out;
      if (!out.results.length) {
        // a source that legitimately skips (no country named, no place in the
        // query) answers "0 hits, no error"; a network failure is different
        var allFailed = out.sources.length > 0 &&
          out.sources.every(function (s) { return !s.ok || s.count === 0; }) &&
          out.sources.some(function (s) { return !s.ok; });
        var body = doc.getElementById("v4livebody");
        if (body) {
          body.innerHTML = '<div class="v4-block"><h4>' + (allFailed ? "Every source failed" : "Nothing found") + "</h4>" +
            '<p class="v4-lead">' + (allFailed
              ? "No open source could be reached. This engine has no server to fall back on: if your browser cannot reach the public APIs, there is nothing to search."
              : "The sources answered but none of them had anything for this query. Try different words, or a broader question.") +
            "</p><p class='v4-note'>" + out.sources.map(function (s) {
              return esc(s.label) + ": " + (s.ok ? s.count + " hits" : "failed (" + (s.error || "unavailable") + ")");
            }).join(" · ") + "</p></div>";
        }
        paintSources(out.sources, 0, out.ms);
        return;
      }
      remember(out.results);
      S.base = out.results;
      S.results = out.results;
      S.filters = { type: "all", org: "all", lang: "all", from: null, to: null };
      state.docs = out.results.map(function (r) { return r.doc; });
      try {
        state.index = root.buildIndex ? root.buildIndex(state.docs) : null;
      } catch (e) { state.index = null; }
      // hand the live set to the v4 panels so Discover/Investigate/Verify run on
      // the documents this query actually returned
      if (ANV.ui) ANV.ui.state.override = { docs: state.docs, index: state.index };
      if (ANV.discovery) { ANV.discovery._cacheKey = null; }
      out.ms = now() - t0;
      if (ANV.ui) ANV.ui.state.lastRun = { query: effective, ms: out.ms };

      try {
        U.context.observe(effective, plan.intent, out.results.slice(0, 4).map(function (r) { return (r.doc.e || [])[0]; }).filter(Boolean));
        ANV.learn.logQuery(effective, out.results, { ms: out.ms, live: true });
      } catch (e) {}

      root.renderResults();
      paintSources(out.sources, out.documents, out.ms);
      var q2 = doc.getElementById("q2");
      if (q2) q2.value = q;
      if (record && root.addBlock) {
        root.addBlock(q, out.results.slice(0, 8).map(function (r) { return r.doc.id; }));
        try { history.replaceState(null, "", "#q=" + encodeURIComponent(q) + "&mode=web"); } catch (e) {}
      }
    }).catch(function (err) {
      if (gen !== state.gen) return;
      var body = doc.getElementById("v4livebody");
      if (body) {
        body.innerHTML = '<div class="v4-block"><h4>Every source failed</h4><p class="v4-lead">' +
          esc(err && err.message ? err.message : "network unavailable") +
          '</p><p class="v4-note">This engine has no server to fall back on: if the browser cannot reach the open APIs, there is nothing to search. Switch to Library mode to search the built-in collection offline.</p></div>';
      }
    });
  }

  function liveShell(q, plan) {
    var U = ANV.understand;
    var h = '<div class="resbar"><div class="inner">' +
      '<div class="mini"><span class="ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg></span>' +
      '<input id="q2" value="' + esc(q) + '" autocomplete="off" spellcheck="false"><span class="kbd">Enter</span></div>' +
      '<button class="nbtn" onclick="ANV.liveUI.toggleMode()">Library mode</button>' +
      '<button class="nbtn" onclick="ANV.ui && ANV.ui.voice && ANV.ui.voice()">Mic</button>' +
      "</div></div>";
    h += '<div class="v4bar"><div class="inner">' +
      '<span class="v4-tag">live</span>' +
      '<span class="v4-dim">' + esc(plan.intent) + "</span>" +
      '<span class="v4-dim">expects ' + esc(plan.answerType) + "</span>" +
      '<span class="v4-dim">' + esc(ANV.live.detectLang(q)) + " query</span>" +
      '<span class="v4-grow"></span>' +
      '<button class="v4-mini" onclick="openPanel(\'discover\')">Discover</button>' +
      '<button class="v4-mini" onclick="openPanel(\'investigate\')">Investigate</button>' +
      '<button class="v4-mini" onclick="openPanel(\'verify\')">Verify</button>' +
      '<button class="v4-mini" onclick="openPanel(\'sources\')">Sources</button>' +
      "</div>";
    h += '<div class="v4-src" id="v4src"></div></div>';
    h += '<div id="v4livebody"><p class="v4-note" style="padding:18px 2px">Querying ' + ANV.live.SOURCES.length + " open sources…</p></div>";
    return h;
  }

  /** Put the federation strip back into the freshly rendered results area. */
  function injectLiveStrip() {
    var host = doc.getElementById("results");
    if (!host || doc.getElementById("v4src")) return;
    var anchor = host.querySelector(".v4bar") || host.querySelector(".resbar");
    var strip = doc.createElement("div");
    strip.className = "v4-src";
    strip.id = "v4src";
    if (anchor && anchor.nextSibling) host.insertBefore(strip, anchor.nextSibling);
    else if (anchor) host.appendChild(strip);
    else host.insertBefore(strip, host.firstChild);
    paintSources(state.last.sources || [], state.last.documents || 0, state.last.ms);
    // mark the intelligence bar as live, so a screenshot cannot be mistaken for
    // the offline library
    var tag = host.querySelector(".v4bar .v4-tag");
    if (tag) {
      tag.textContent = "live";
      var dim = doc.createElement("span");
      dim.className = "v4-dim";
      dim.textContent = (state.last.sources || []).filter(function (s) { return s.ok; }).length + " sources answered";
      if (tag.nextSibling) host.querySelector(".v4bar .inner").insertBefore(dim, tag.nextSibling);
      else host.querySelector(".v4bar .inner").appendChild(dim);
    }
  }

  function paintSources(sources, docCount, ms) {
    var host = doc.getElementById("v4src");
    if (!host) return;
    var okCount = sources.filter(function (s) { return s.ok === true; }).length;
    var failCount = sources.filter(function (s) { return s.ok === false; }).length;
    var pending = sources.filter(function (s) { return s.ok === null; }).length;
    var h = sources.map(function (s) {
      var cls = s.ok === false ? "v4-bad" : s.ok === null ? "v4-pending" : s.count ? "v4-ok" : "v4-kind";
      var label = s.ok === false ? "failed" : s.ok === null ? "…" : s.count + " hit" + (s.count === 1 ? "" : "s");
      return '<span class="v4-chip ' + cls + '" title="' + esc(s.group + (s.error ? " · " + s.error : "") + " · " + s.ms + "ms") + '">' +
        esc(s.label) + " " + esc(label) + "</span>";
    }).join("");
    h += '<span class="v4-grow"></span><span class="v4-dim">' + docCount + " documents · " + okCount + " sources ok" +
      (failCount ? " · " + failCount + " failed" : "") + (pending ? " · " + pending + " pending" : "") +
      (ms ? " · " + ms + " ms" : "") + "</span>";
    host.innerHTML = h;
  }

  /* ---------------------------------------------------------------- brief -- */
  function liveBrief(out) {
    if (!out || !out.results.length) {
      return '<div class="brief"><div class="brief-top"><span class="brief-tag">No answer</span></div>' +
        '<p class="v4-lead">No open source returned anything for this query. Try fewer words, or switch to Library mode.</p></div>';
    }
    var terms = ANV.lang.tokenise(out.query);
    var picks = [];
    out.results.slice(0, 5).forEach(function (r) {
      var sents = ANV.lang.sentenceSplit(r.doc.b || "");
      var best = null, bestScore = 0;
      sents.forEach(function (s) {
        if (s.length < 60) return;
        var low = ANV.lang.normalise(s), hits = 0;
        terms.forEach(function (t) { if (low.indexOf(t) >= 0) hits++; });
        var sc = hits + (/\d/.test(s) ? 0.4 : 0) - s.length / 900;
        if (sc > bestScore) { bestScore = sc; best = s; }
      });
      if (best) picks.push({ text: best.trim(), doc: r.doc });
    });
    if (!picks.length) {
      picks = out.results.slice(0, 3).map(function (r) { return { text: (r.doc.b || r.doc.t || "").slice(0, 260), doc: r.doc }; });
    }
    picks = picks.slice(0, 4);
    var conf = out.results.slice(0, 3).reduce(function (a, r) { return a + (r.confidence || 0); }, 0) / Math.min(3, out.results.length);

    var body = picks.map(function (p, i) {
      return esc(p.text) + '<span class="cite" onclick="openDoc(\'' + esc(p.doc.id) + '\')" title="' + esc(p.doc.t) + '">' + (i + 1) + "</span>";
    }).join(" ");

    var srcs = picks.map(function (p, i) {
      var d = p.doc;
      var live = d.live || {};
      return '<a class="v4-srcitem" href="' + esc(d.u || "#") + '" target="_blank" rel="noopener noreferrer">' +
        "[" + (i + 1) + "] " + esc(d.t.slice(0, 90)) + " — " + esc(d.s || "") +
        (d.d ? ", " + esc(d.d.slice(0, 4)) : "") +
        (live.citedBy ? ", cited " + live.citedBy + "×" : "") +
        (live.retracted ? " · RETRACTED" : "") + "</a>";
    }).join("");

    var expanded = out.expanded && out.expanded.length
      ? '<div class="v4-note">The live result set suggested these related concepts: ' +
        out.expanded.map(function (e) { return chip(e.term + " " + e.score, "v4-kind"); }).join(" ") + "</div>"
      : "";

    return '<div class="brief"><div class="brief-top"><span class="brief-tag">Answer</span>' +
      '<span class="brief-model">' + out.documents + " documents from " + out.sources.filter(function (s) { return s.ok; }).length +
      " live sources · " + pct(conf) + " confidence · nothing generated, everything quoted</span></div>" +
      '<p class="brief-text">' + body + "</p>" +
      '<div class="v4-srcs">' + srcs + "</div>" + expanded +
      '<div class="v4-note">Quoted from sources fetched just now. They were not cross-verified against each other the way the offline library is — open Verify to run that check on this result set.</div>' +
      "</div>";
  }

  /* ------------------------------------------------------- live doc drawer -- */
  function openLiveDoc(d) {
    var ev = ANV.evidence;
    var cred = ev.credibility(d, {});
    doc.getElementById("dTitle").textContent = d.t;
    var h = '<div class="kv">' +
      "<dt>Type</dt><dd><span class=\"tbadge t-" + d.ty + '">' + esc((root.TYPE_LABEL && root.TYPE_LABEL[d.ty]) || d.ty) + "</span></dd>" +
      "<dt>Source</dt><dd>" + esc(d.s || "") + "</dd>" +
      "<dt>Issuer</dt><dd>" + esc(d.o || "") + "</dd>" +
      "<dt>Date</dt><dd>" + esc(d.d || "—") + "</dd>" +
      "<dt>Language</dt><dd>" + esc(d.l || "en") + "</dd>" +
      "<dt>Credibility</dt><dd>" + chip(cred.label + " " + pct(cred.score), "v4-cred-" + cred.label) + "</dd>" +
      (d.live && d.live.citedBy ? "<dt>Citations</dt><dd>" + d.live.citedBy + "</dd>" : "") +
      (d.live && d.live.retracted ? "<dt>Status</dt><dd>" + chip("RETRACTED", "v4-bad") + "</dd>" : "") +
      (d.u ? "<dt>Original</dt><dd><a href=\"" + esc(d.u) + "\" target=\"_blank\" rel=\"noopener noreferrer\">" + esc(d.u.slice(0, 70)) + "…</a></dd>" : "") +
      "</div>";
    h += '<div class="doc-body">' + esc(d.b || "") + "</div>";
    h += '<div class="v4-block"><h4>Why this score</h4><p class="v4-note">' +
      esc(cred.why) + "</p></div>";
    var contra = [];
    try { contra = ANV.evidence.contradictionLab(d.t, state.index || root.INDEX, { limit: 3 }); } catch (e) {}
    if (contra.length) {
      h += '<div class="v4-block"><h4>Conflicting figures nearby</h4>' + list(contra, function (c) {
        return "<b>" + esc(c.key) + "</b> " + chip(c.kind, c.kind === "conflict" ? "v4-warn" : "v4-kind");
      }) + "</div>";
    }
    h += '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:18px">' +
      (d.u ? '<a class="iact" href="' + esc(d.u) + '" target="_blank" rel="noopener noreferrer">Open original</a>' : "") +
      '<button class="iact" onclick="ANV.liveUI.flag(\'' + esc(d.id) + '\')">Flag as unreliable</button>' +
      '<button class="iact" onclick="ANV.liveUI.watchThis()">Watch this question</button>' +
      "</div>";
    doc.getElementById("dBody").innerHTML = h;
    doc.getElementById("drawer").classList.add("on");
    doc.getElementById("scrim").classList.add("on");
  }

  /* --------------------------------------------------------------- actions -- */
  state.toggleMode = function () {
    state.mode = state.mode === "web" ? "library" : "web";
    if (state.mode === "library" && ANV.ui) ANV.ui.state.override = null;
    if (root.S && root.S.q) root.doSearch(root.S.q, false);
    else if (root.toast) root.toast(state.mode === "web" ? "Live web mode: 15 open sources" : "Library mode: the offline collection");
    var btn = doc.querySelector(".resbar .nbtn");
  };

  state.flag = function (id) {
    var n = ANV.learn.flagCorrection(id, "flagged from live results", "unreliable");
    if (root.toast) root.toast("Flagged. " + n + " correction(s) now down-weight sources you distrust.");
  };

  state.watchThis = function () {
    var q = (root.S && root.S.q) || "";
    if (!q) return;
    var top = state.last && state.last.results.length ? state.last.results[0].doc.id : null;
    state.watch.push({ query: q, baseline: top, t: now() });
    if (root.toast) root.toast("Watching \"" + q + "\". Open Watch to re-check it.");
  };

  state.checkWatch = function () {
    if (!state.watch.length) return;
    var results = [];
    var jobs = state.watch.map(function (w) {
      return ANV.live.search(w.query, { perSource: 4 }).then(function (out) {
        var top = out.results.length ? out.results[0].doc.id : null;
        results.push({ query: w.query, baseline: w.baseline, now: top, changed: !!(w.baseline && top && w.baseline !== top),
          topTitle: out.results.length ? out.results[0].doc.t : "(nothing)" });
      }).catch(function () {
        results.push({ query: w.query, baseline: w.baseline, now: null, changed: false, topTitle: "(source unavailable)" });
      });
    });
    Promise.all(jobs).then(function () {
      state.alerts = results;
      var host = doc.getElementById("v4watchout");
      if (host) host.innerHTML = watchBody();
      var changed = results.filter(function (r) { return r.changed; }).length;
      if (root.toast) root.toast(changed ? changed + " watched question(s) now have a different top source" : "No watched question changed");
    });
  };

  function watchBody() {
    if (!state.watch.length) return '<p class="v4-empty">No questions watched yet. Search for something, then open a result and choose "Watch this question".</p>';
    var h = '<div class="v4-grid">' + kv("watched", state.watch.length) + kv("changed", state.alerts.filter(function (a) { return a.changed; }).length) + "</div>";
    h += block("Watched questions", list(state.watch, function (w) {
      return "<b>" + esc(w.query) + "</b>";
    }), "Re-checking runs the query again against every live source. There is no background process: it runs when you ask, in this tab.");
    if (state.alerts.length) {
      h += block("Last check", list(state.alerts, function (a) {
        return (a.changed ? chip("changed", "v4-warn") : chip("same", "v4-ok")) + " <b>" + esc(a.query) + "</b>" +
          '<div class="v4-sub2">top source now: ' + esc(a.topTitle) + "</div>";
      }), "A changed top source means the answer moved, not necessarily that the earlier answer was wrong.");
    }
    h += '<div class="v4-row"><button class="v4-btn" onclick="ANV.liveUI.checkWatch()">Check all now</button>' +
      '<button class="v4-btn ghost" onclick="ANV.liveUI.clearWatch()">Clear</button></div>';
    return h;
  }
  state.clearWatch = function () { state.watch = []; state.alerts = []; var h = doc.getElementById("v4watchout"); if (h) h.innerHTML = watchBody(); };

  /* ---------------------------------------------------------------- panels -- */
  function sourcesBody() {
    var st = ANV.live.stats();
    var h = '<div class="v4-grid">' + kv("sources", ANV.live.SOURCES.length) + kv("requests", st.requests) +
      kv("failures", st.failures) + kv("cache hits", st.cacheHits) + "</div>";
    h += '<p class="v4-note">Every source below is free, needs no API key, and allows cross-origin requests from a browser. ' +
      "The engine calls them directly from your device: no proxy, no server, no account.</p>";
    var groups = {};
    ANV.live.SOURCES.forEach(function (s) { (groups[s.group] = groups[s.group] || []).push(s); });
    Object.keys(groups).forEach(function (g) {
      h += block(g, groups[g].map(function (s) {
        var rep = st.bySource[s.id];
        var status = rep ? (rep.ok ? chip(rep.count + " hits", "v4-ok") : chip("failed", "v4-bad")) : chip("idle", "v4-kind");
        return '<div class="v4-field"><b>' + esc(s.label) + "</b> " + status + chip("authority " + s.a + "/5", "v4-kind") +
          '<div class="v4-sub2">' + esc(s.note) + "</div>" +
          '<div class="v4-sub2">minimum interval ' + s.minGap + " ms · " + esc(s.ty) + "</div></div>";
      }).join(""));
    });
    h += block("What this architecture cannot do", '<p class="v4-lead">It cannot crawl the whole web, and it cannot rank a billion pages, ' +
      "because that needs crawlers, storage and bandwidth that a free static page does not have.</p>" +
      '<p class="v4-note">What it does instead: ask the open collections that already did that work, then apply verification, ' +
      "contradiction detection, discovery paradigms and a learning loop to what comes back.</p>");
    h += block("Adding a source", '<p class="v4-note">A source is about twenty lines: a function that takes the query and returns documents with ' +
      "title, text, url, date and authority. Edit <code>src/engine/live.js</code>, add an entry to SOURCES, rebuild. " +
      "The licence is MIT, so nothing stops you.</p>");
    return h;
  }

  function injectNav() {
    var nav = doc.querySelector("nav.top-nav");
    if (!nav || doc.getElementById("navSources")) return;
    [["navSources", "Sources", "sources", "The fifteen live open collections"],
     ["navWatch", "Watch", "watch", "Re-check questions and see what changed"]].forEach(function (d) {
      var b = doc.createElement("button");
      b.className = "nbtn"; b.id = d[0]; b.textContent = d[1]; b.title = d[3];
      b.onclick = function () { root.openPanel(d[2]); };
      nav.insertBefore(b, nav.firstChild);
    });
  }

  /* ----------------------------------------------------------------- boot -- */
  function boot() {
    if (!root.INDEX || !root.S) { setTimeout(boot, 140); return; }
    installPatches();
    injectNav();
    var openPanel = root.openPanel;
    root.openPanel = function (which) {
      if (which === "sources" || which === "watch") {
        doc.getElementById("panelTitle").textContent = which === "sources" ? "Live sources" : "Watchlist";
        doc.getElementById("panelSub").textContent = which === "sources"
          ? "Free, keyless, cross-origin APIs called directly from your browser"
          : "Continuous discovery: ask the same question again and diff the answer";
        doc.getElementById("panelBody").innerHTML = '<div class="v4-panel">' +
          (which === "sources" ? sourcesBody() : '<div id="v4watchout">' + watchBody() + "</div>") + "</div>";
        doc.getElementById("panel").classList.add("on");
        return;
      }
      return openPanel.apply(null, arguments);
    };

    // live mode is the default: this is an online engine now
    var sub = doc.querySelector(".hero p.sub");
    if (sub) {
      sub.innerHTML = "An online research engine over <b>" + ANV.live.SOURCES.length +
        " free open collections</b> — Wikipedia in twelve languages, Wikidata, OpenAlex, Crossref, the Internet Archive, " +
        "Open Library, Wikisource, Stack Exchange, GitHub, Openverse, live weather and seismic measurements and World Bank statistics. " +
        "Results are fetched live in your browser, verified on arrival, and <b>nothing you type is stored anywhere</b>.";
    }
    var tag = doc.querySelector(".brand-txt small");
    if (tag) tag.textContent = "v5 · online knowledge engine";
    var st = doc.getElementById("stDocs");
    if (st) st.textContent = "15 sources";

    // the URL fragment carries the mode, so a link can point at either engine
    var hash = (root.location && location.hash) || "";
    var m = hash.match(/mode=(web|library)/);
    if (m) state.mode = m[1];
    var qm = hash.match(/#q=([^&]+)/);
    if (qm) {
      try { root.doSearch(decodeURIComponent(qm[1]), false); } catch (e) {}
    } else if (!hash) {
      // a first visit should show the live engine's own capability summary
      state.mode = "web";
    }
    state.ready = true;
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 80); });
  else setTimeout(boot, 80);
})(typeof globalThis !== "undefined" ? globalThis : this);
