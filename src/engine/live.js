/* ============================================================================
   ANVESHAN v5 - LAYER 10: LIVE (the online engine)
   A federated search engine that runs in the browser and queries free, public,
   keyless APIs directly: Wikipedia in many languages, Wikidata, OpenAlex,
   Crossref, Semantic Scholar, Open Library, the Internet Archive, Wikisource,
   Stack Exchange, GitHub, Openverse, Open-Meteo, USGS and the World Bank.

   Why federated instead of a central crawl? Because a crawl needs servers,
   bandwidth and a budget, and this project has none of those. What a browser
   can do is ask fifteen open collections the same question at the same time and
   then apply real verification to what comes back. Every result is fetched live
   from its origin, so the index cannot go stale.

   Politeness is part of the contract: each source has its own minimum interval,
   its own timeout, one retry, and a short cache. A source that fails is
   reported as failed, never quietly hidden.
   ========================================================================== */
(function (root) {
  "use strict";
  var ANV = root.ANV = root.ANV || {};
  var L = ANV.lang;

  /* ---------------------------------------------------------------- utils -- */
  function now() { return Date.now(); }
  function stripTags(s) {
    return String(s == null ? "" : s)
      .replace(/<[^>]+>/g, " ")
      .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ").trim();
  }
  function yearOf(s) {
    var m = String(s || "").match(/(1[5-9]\d{2}|20\d{2})/);
    return m ? parseInt(m[1], 10) : null;
  }
  function dateOf(s) {
    var m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[0];
    var y = yearOf(s);
    return y ? y + "-01-01" : "";
  }
  function domainOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
  }
  function firstSentences(text, n) {
    var parts = L.sentenceSplit(String(text || ""));
    return parts.slice(0, n || 3).join(" ");
  }
  function hash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (x && !s[x]) { s[x] = 1; o.push(x); } }); return o; }

  /* ------------------------------------------------------------- transport - */
  var CACHE_MS = 10 * 60 * 1000;
  var cache = {};
  var epoch = 0;   // bumped by clearCache so stale session entries cannot resurface
  var lastCall = {};
  var stats = { requests: 0, failures: 0, cacheHits: 0, bySource: {} };

  function cacheKey(id, url) { return "anv.live." + epoch + "." + id + "." + hash(url); }

  function readCache(key) {
    var mem = cache[key];
    if (mem && now() - mem.t < CACHE_MS) return mem.v;
    try {
      var raw = root.sessionStorage && sessionStorage.getItem(key);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (now() - parsed.t < CACHE_MS) { cache[key] = parsed; return parsed.v; }
      }
    } catch (e) {}
    return null;
  }
  function writeCache(key, v) {
    var rec = { t: now(), v: v };
    cache[key] = rec;
    try { if (root.sessionStorage) sessionStorage.setItem(key, JSON.stringify(rec)); } catch (e) {}
  }

  /**
   * Fetch JSON with a timeout, one retry, a per-source minimum interval and a
   * short cache. The interval is what keeps fifteen parallel sources polite:
   * without it a page that re-queries on every keystroke would be abusive.
   */
  async function getJSON(id, url, opts) {
    opts = opts || {};
    var key = cacheKey(id, url);
    var hit = readCache(key);
    if (hit) { stats.cacheHits++; return hit; }

    var minGap = (opts.minGap != null) ? opts.minGap : 400;
    var wait = Math.max(0, (lastCall[id] || 0) + minGap - now());
    if (wait > 0) await new Promise(function (r) { setTimeout(r, wait); });
    lastCall[id] = now();

    var attempt = 0, lastErr = null;
    while (attempt < 2) {
      attempt++;
      stats.requests++;
      var ctrl = (typeof AbortController === "function") ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeout || 8000) : null;
      try {
        var res = await root.fetch(url, {
          method: "GET",
          mode: "cors",
          credentials: "omit",
          redirect: "follow",
          signal: ctrl ? ctrl.signal : undefined,
          headers: opts.headers || {}
        });
        if (timer) clearTimeout(timer);
        if (!res.ok) throw new Error("HTTP " + res.status);
        var text = await res.text();
        var data;
        try { data = JSON.parse(text); }
        catch (e) { throw new Error("source did not return JSON (CORS proxy page?)"); }
        writeCache(key, data);
        return data;
      } catch (e) {
        if (timer) clearTimeout(timer);
        lastErr = e;
        if (attempt < 2) await new Promise(function (r) { setTimeout(r, 350); });
      }
    }
    stats.failures++;
    throw lastErr || new Error("request failed");
  }

  /* ------------------------------------------------------------- adapters -- */
  // `a` is the default authority for the source, on the same 1-5 scale the
  // offline library uses. It is a property of the issuer, not of the document.
  var WIKI_LANGS = ["en", "hi", "sa", "bn", "ta", "te", "mr", "gu", "kn", "ml", "pa", "ur"];

  function detectLang(q) {
    var s = L.scriptOf(q);
    if (s === "latin") return "en";
    var deva = (String(q).match(/[\u0900-\u097F]/g) || []).length;
    if (deva > 0) return /\b(अस्ति|भवति|च|अपि|सः|एव)\b/.test(q) ? "sa" : "hi";
    return "en";
  }

  var SOURCES = [
    {
      id: "wikipedia", label: "Wikipedia", group: "encyclopaedia", ty: "article", a: 3, minGap: 300,
      note: "Multilingual encyclopaedia; the language of the query decides which edition is asked",
      async search(q, ctx) {
        var lang = ctx.lang && WIKI_LANGS.indexOf(ctx.lang) >= 0 ? ctx.lang : "en";
        var url = "https://" + lang + ".wikipedia.org/w/api.php?action=query&format=json&origin=*" +
          "&list=search&srsearch=" + encodeURIComponent(q) + "&srlimit=" + (ctx.perSource || 6) + "&srprop=snippet|timestamp|wordcount";
        var data = await getJSON("wikipedia", url);
        var hits = (data && data.query && data.query.search) || [];
        if (!hits.length) return [];
        // one extra call for the intro text of the top pages: that is the
        // "crawl" for this source, and it keeps the snippet honest
        var titles = hits.slice(0, 5).map(function (h) { return h.title; }).join("|");
        var detail = {};
        try {
          var d = await getJSON("wikipedia", "https://" + lang + ".wikipedia.org/w/api.php?action=query&format=json&origin=*" +
            "&prop=extracts|pageprops|langlinks&exintro=1&explaintext=1&lllimit=8&redirects=1" +
            "&titles=" + encodeURIComponent(titles), { minGap: 300 });
          var pages = (d && d.query && d.query.pages) || {};
          Object.keys(pages).forEach(function (k) {
            var p = pages[k];
            if (p && p.title) detail[p.title.toLowerCase()] = p;
          });
        } catch (e) { /* the search list alone is still useful */ }
        return hits.map(function (h) {
          var det = detail[String(h.title).toLowerCase()] || {};
          var body = det.extract || stripTags(h.snippet);
          return {
            id: "wp-" + lang + "-" + hash(h.title), t: h.title, s: "Wikipedia (" + lang + ")",
            o: "Wikimedia Foundation", ty: "article", y: yearOf(h.timestamp), d: dateOf(h.timestamp),
            u: "https://" + lang + ".wikipedia.org/wiki/" + encodeURIComponent(h.title.replace(/ /g, "_")),
            l: lang, a: 3, k: L.tokenise(h.title).slice(0, 6), b: body,
            e: (det.pageprops && det.pageprops.wikibase_item) ? [h.title] : [h.title],
            live: { source: "wikipedia", lang: lang, wordcount: h.wordcount || 0,
                    translations: (det.langlinks || []).map(function (x) { return { lang: x.lang, title: x.lang + ":" + x["*"] }; }).slice(0, 6) }
          };
        });
      }
    },
    {
      id: "wikidata", label: "Wikidata", group: "knowledge graph", ty: "entity", a: 3, minGap: 300,
      note: "Entities, labels and descriptions; used to build the live knowledge graph",
      async search(q, ctx) {
        var lang = ctx.lang || "en";
        var url = "https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*" +
          "&language=" + lang + "&uselang=" + lang + "&limit=" + (ctx.perSource || 5) + "&search=" + encodeURIComponent(q);
        var data = await getJSON("wikidata", url);
        return (data.search || []).map(function (e) {
          return {
            id: "wd-" + e.id, t: e.label || e.id, s: "Wikidata", o: "Wikimedia Foundation",
            ty: "entity", y: null, d: "", u: e.concepturi || ("https://www.wikidata.org/wiki/" + e.id),
            l: lang, a: 3, k: [e.id], b: (e.description || "") + (e.aliases ? " · also known as " + e.aliases.join(", ") : ""),
            e: [e.label || e.id], live: { source: "wikidata", qid: e.id, description: e.description || "" }
          };
        });
      }
    },
    {
      id: "openalex", label: "OpenAlex", group: "scholarly", ty: "paper", a: 4, minGap: 250,
      note: "250M+ scholarly works with citation counts, open-access links and retraction flags",
      async search(q, ctx) {
        var url = "https://api.openalex.org/works?search=" + encodeURIComponent(q) +
          "&per-page=" + (ctx.perSource || 6) + "&mailto=anveshan@example.org";
        var data = await getJSON("openalex", url, { timeout: 9000 });
        return (data.results || []).map(function (w) {
          var host = (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || "OpenAlex";
          var inv = (w.abstract_inverted_index && Object.keys(w.abstract_inverted_index)) || [];
          var abstract = reconstructAbstract(w.abstract_inverted_index);
          return {
            id: "oa-" + (w.id || "").split("/").pop(), t: w.title || w.display_name || "(untitled work)",
            s: host, o: (w.authorships && w.authorships[0] && w.authorships[0].author && w.authorships[0].author.display_name) || host,
            ty: "paper", y: w.publication_year || null, d: dateOf(w.publication_date),
            u: w.doi || (w.primary_location && w.primary_location.landing_page_url) || w.id,
            l: "en", a: w.is_retracted ? 2 : 4,
            k: uniq((w.concepts || []).slice(0, 6).map(function (c) { return (c.display_name || "").toLowerCase(); }).filter(Boolean)),
            b: abstract || firstSentences(w.title || "", 1),
            e: (w.concepts || []).slice(0, 4).map(function (c) { return (c.display_name || "").toLowerCase(); }),
            live: { source: "openalex", citedBy: w.cited_by_count || 0, openAccess: !!(w.open_access && w.open_access.is_oa),
                    retracted: !!w.is_retracted, doi: w.doi || null, venue: host, concepts: inv.slice(0, 5) }
          };
        });
      }
    },
    {
      id: "crossref", label: "Crossref", group: "scholarly", ty: "paper", a: 4, minGap: 300,
      note: "DOI registry: publisher, type, licence and citation counts",
      async search(q, ctx) {
        var url = "https://api.crossref.org/works?query=" + encodeURIComponent(q) +
          "&rows=" + (ctx.perSource || 5) + "&select=DOI,title,abstract,issued,container-title,author,type,is-referenced-by-count,publisher&mailto=anveshan@example.org";
        var data = await getJSON("crossref", url, { timeout: 9000 });
        var items = (data && data.message && data.message.items) || [];
        return items.map(function (w) {
          var title = (w.title && w.title[0]) || "(untitled)";
          var parts = (w.issued && w.issued["date-parts"] && w.issued["date-parts"][0]) || [];
          return {
            id: "cr-" + hash(w.DOI || title), t: title, s: (w["container-title"] && w["container-title"][0]) || w.publisher || "Crossref",
            o: (w.author && w.author[0] && (w.author[0].family || w.author[0].name)) || w.publisher || "Crossref",
            ty: w.type === "posted-content" ? "preprint" : "paper",
            y: parts[0] || null, d: parts.length ? parts[0] + "-" + String(parts[1] || 1).padStart(2, "0") + "-" + String(parts[2] || 1).padStart(2, "0") : "",
            u: w.DOI ? "https://doi.org/" + w.DOI : "", l: "en", a: 4,
            k: L.tokenise(title).slice(0, 6), b: stripTags(w.abstract || title),
            e: L.tokenise(title).slice(0, 4),
            live: { source: "crossref", doi: w.DOI || null, citedBy: w["is-referenced-by-count"] || 0, type: w.type, venue: (w["container-title"] && w["container-title"][0]) || null }
          };
        });
      }
    },
    {
      id: "semanticscholar", label: "Semantic Scholar", group: "scholarly", ty: "paper", a: 4, minGap: 1200,
      note: "Paper abstracts and citation context; rate-limited without a key",
      async search(q, ctx) {
        var url = "https://api.semanticscholar.org/graph/v1/paper/search?query=" + encodeURIComponent(q) +
          "&limit=" + (ctx.perSource || 5) + "&fields=title,abstract,year,venue,authors,url,citationCount,externalIds,isOpenAccess";
        var data = await getJSON("semanticscholar", url, { timeout: 9000, minGap: 1200 });
        return (data.data || []).map(function (p) {
          return {
            id: "ss-" + (p.paperId || hash(p.title || "")), t: p.title || "(untitled)",
            s: p.venue || "Semantic Scholar", o: (p.authors && p.authors[0] && p.authors[0].name) || "Semantic Scholar",
            ty: "paper", y: p.year || null, d: p.year ? p.year + "-01-01" : "",
            u: p.url || "", l: "en", a: 4, k: L.tokenise(p.title || "").slice(0, 6),
            b: p.abstract || p.title || "", e: L.tokenise(p.title || "").slice(0, 4),
            live: { source: "semanticscholar", citedBy: p.citationCount || 0, openAccess: !!p.isOpenAccess, doi: (p.externalIds && p.externalIds.DOI) || null }
          };
        });
      }
    },
    {
      id: "openlibrary", label: "Open Library", group: "books", ty: "book", a: 3, minGap: 400,
      note: "Books, authors and editions, including public-domain scans",
      async search(q, ctx) {
        var url = "https://openlibrary.org/search.json?q=" + encodeURIComponent(q) +
          "&limit=" + (ctx.perSource || 4) + "&fields=key,title,author_name,first_publish_year,subject,language,edition_count";
        var data = await getJSON("openlibrary", url);
        return (data.docs || []).map(function (b) {
          return {
            id: "ol-" + hash(b.key || b.title), t: b.title || "(untitled book)",
            s: "Open Library", o: (b.author_name && b.author_name[0]) || "Unknown author",
            ty: "book", y: b.first_publish_year || null, d: b.first_publish_year ? b.first_publish_year + "-01-01" : "",
            u: "https://openlibrary.org" + (b.key || ""), l: (b.language && b.language[0]) || "en", a: 3,
            k: (b.subject || []).slice(0, 6).map(function (s) { return s.toLowerCase(); }),
            b: [b.title, (b.author_name || []).join(", "), (b.subject || []).slice(0, 8).join(", ")].filter(Boolean).join(". "),
            e: (b.subject || []).slice(0, 4), live: { source: "openlibrary", editions: b.edition_count || 0 }
          };
        });
      }
    },
    {
      id: "internetarchive", label: "Internet Archive", group: "archive", ty: "archive", a: 3, minGap: 500,
      note: "Scanned texts, manuscripts, audio and historical records",
      async search(q, ctx) {
        var url = "https://archive.org/advancedsearch.php?q=" + encodeURIComponent(q) +
          "&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year&fl%5B%5D=creator&fl%5B%5D=mediatype&fl%5B%5D=description" +
          "&rows=" + (ctx.perSource || 4) + "&page=1&output=json";
        var data = await getJSON("internetarchive", url, { timeout: 10000 });
        var docs = (data && data.response && data.response.docs) || [];
        return docs.map(function (d) {
          return {
            id: "ia-" + (d.identifier || hash(d.title || "")), t: d.title || d.identifier,
            s: "Internet Archive", o: d.creator || "Internet Archive",
            ty: d.mediatype === "audio" ? "audio" : d.mediatype === "movies" ? "video" : "archive",
            y: yearOf(d.year), d: d.year ? yearOf(d.year) + "-01-01" : "",
            u: "https://archive.org/details/" + d.identifier, l: "en", a: 3,
            k: L.tokenise(String(d.title || "")).slice(0, 6),
            b: stripTags(d.description || d.title || "").slice(0, 1200),
            e: [], live: { source: "internetarchive", mediatype: d.mediatype || null }
          };
        });
      }
    },
    {
      id: "wikisource", label: "Wikisource", group: "archive", ty: "text", a: 3, minGap: 400,
      note: "Primary texts: treaties, speeches, classical and historical documents",
      async search(q, ctx) {
        var lang = (ctx.lang === "hi" || ctx.lang === "sa") ? "sa" : "en";
        var url = "https://" + lang + ".wikisource.org/w/api.php?action=query&format=json&origin=*&list=search" +
          "&srsearch=" + encodeURIComponent(q) + "&srlimit=" + (ctx.perSource || 3);
        var data = await getJSON("wikisource", url);
        return ((data.query && data.query.search) || []).map(function (h) {
          return {
            id: "ws-" + hash(h.title), t: h.title, s: "Wikisource (" + lang + ")",
            o: "Wikimedia Foundation", ty: "text", y: yearOf(h.timestamp), d: dateOf(h.timestamp),
            u: "https://" + lang + ".wikisource.org/wiki/" + encodeURIComponent(h.title.replace(/ /g, "_")),
            l: lang, a: 3, k: L.tokenise(h.title).slice(0, 5), b: stripTags(h.snippet),
            e: [], live: { source: "wikisource" }
          };
        });
      }
    },
    {
      id: "stackexchange", label: "Stack Exchange", group: "community", ty: "question", a: 2, minGap: 400,
      note: "Technical questions and accepted answers, with vote counts",
      async search(q, ctx) {
        var url = "https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&site=stackoverflow" +
          "&pagesize=" + (ctx.perSource || 4) + "&q=" + encodeURIComponent(q) + "&filter=withbody";
        var data = await getJSON("stackexchange", url);
        return (data.items || []).map(function (it) {
          return {
            id: "se-" + it.question_id, t: stripTags(it.title), s: "Stack Overflow",
            o: it.owner ? it.owner.display_name : "community", ty: "question",
            y: yearOf(new Date(it.creation_date * 1000).toISOString()),
            d: new Date(it.creation_date * 1000).toISOString().slice(0, 10),
            u: it.link, l: "en", a: 2, k: it.tags || [], b: stripTags(it.body || "").slice(0, 1500),
            e: it.tags || [], live: { source: "stackexchange", score: it.score, answers: it.answer_count, accepted: !!it.accepted_answer_id }
          };
        });
      }
    },
    {
      id: "github", label: "GitHub", group: "code", ty: "code", a: 2, minGap: 2000,
      note: "Repositories and code; unauthenticated search allows a few requests a minute",
      async search(q, ctx) {
        var url = "https://api.github.com/search/repositories?q=" + encodeURIComponent(q) +
          "&sort=stars&order=desc&per_page=" + (ctx.perSource || 4);
        var data = await getJSON("github", url, { minGap: 2000, headers: { Accept: "application/vnd.github+json" } });
        return (data.items || []).map(function (r) {
          return {
            id: "gh-" + r.id, t: r.full_name, s: "GitHub", o: r.owner ? r.owner.login : "GitHub",
            ty: "code", y: yearOf(r.pushed_at), d: dateOf(r.pushed_at), u: r.html_url, l: r.language || "en",
            a: 2, k: (r.topics || []).slice(0, 6), b: (r.description || "") + " · " + (r.topics || []).join(", ") + " · " + (r.language || ""),
            e: r.topics || [], live: { source: "github", stars: r.stargazers_count, forks: r.forks_count, license: r.license && r.license.spdx_id }
          };
        });
      }
    },
    {
      id: "openverse", label: "Openverse", group: "media", ty: "image", a: 2, minGap: 400,
      note: "Openly licensed images and audio with attribution",
      async search(q, ctx) {
        var url = "https://api.openverse.org/v1/images/?q=" + encodeURIComponent(q) +
          "&page_size=" + (ctx.perSource || 4);
        var data = await getJSON("openverse", url);
        return (data.results || []).map(function (m) {
          return {
            id: "ov-" + m.id, t: m.title || "(untitled image)", s: m.source || "Openverse",
            o: m.creator || "unknown", ty: "image", y: null, d: "",
            u: m.foreign_landing_url || m.url, l: "en", a: 2,
            k: (m.tags || []).slice(0, 6).map(function (t) { return t.name || t; }),
            b: [m.title, (m.tags || []).map(function (t) { return t.name || t; }).join(", "), "licence " + (m.license || "")].filter(Boolean).join(". "),
            e: [], live: { source: "openverse", licence: m.license, thumb: m.thumbnail }
          };
        });
      }
    },
    {
      id: "openmeteo", label: "Open-Meteo", group: "observation", ty: "observation", a: 4, minGap: 400,
      note: "Live weather measurements for any place named in the query",
      async search(q, ctx) {
        var place = (q.match(/\b(?:in|at|near|for)\s+([A-Z][\w\s]{2,30})/) || [])[1];
        if (!place) return [];
        var geo = await getJSON("nominatim", "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(place),
          { minGap: 1200, headers: { Accept: "application/json" } });
        if (!geo || !geo.length) return [];
        var lat = geo[0].lat, lon = geo[0].lon;
        var w = await getJSON("openmeteo", "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon +
          "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation&timezone=auto", { timeout: 7000 });
        var c = (w && w.current) || {};
        return [{
          id: "om-" + lat + "-" + lon, t: "Live weather · " + geo[0].display_name,
          s: "Open-Meteo", o: "Open-Meteo (national weather models)", ty: "observation",
          y: new Date().getFullYear(), d: (c.time || "").slice(0, 10), u: "https://open-meteo.com/",
          l: "en", a: 4, k: ["weather", "measurement", place.toLowerCase()],
          b: "Measured at " + (c.time || "now") + ": temperature " + c.temperature_2m + " °C, humidity " +
             c.relative_humidity_2m + "%, wind " + c.wind_speed_10m + " km/h, precipitation " + c.precipitation + " mm.",
          e: [place], live: { source: "openmeteo", lat: +lat, lon: +lon, measured: c.time }
        }];
      }
    },
    {
      id: "usgs", label: "USGS earthquakes", group: "observation", ty: "observation", a: 5, minGap: 400,
      note: "Live seismic measurements from the last 30 days",
      async search(q, ctx) {
        if (!/earthquake|seismic|quake|tremor|भूकंप/i.test(q)) return [];
        var d = await getJSON("usgs", "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&limit=5&orderby=time&minmagnitude=4", { timeout: 8000 });
        return ((d && d.features) || []).map(function (f) {
          var p = f.properties || {}, g = f.geometry && f.geometry.coordinates;
          return {
            id: "usgs-" + f.id, t: "M" + p.mag + " · " + (p.place || "earthquake"),
            s: "USGS", o: "United States Geological Survey", ty: "observation",
            y: yearOf(new Date(p.time).toISOString()), d: new Date(p.time).toISOString().slice(0, 10),
            u: p.url, l: "en", a: 5, k: ["earthquake", "seismic", "measurement"],
            b: "Magnitude " + p.mag + " at " + p.place + ", depth " + (g ? g[2] : "?") + " km, recorded " + new Date(p.time).toISOString() + ".",
            e: [p.place || "earthquake"], live: { source: "usgs", mag: p.mag, lat: g && g[1], lon: g && g[0] }
          };
        });
      }
    },
    {
      id: "nominatim", label: "OpenStreetMap", group: "spatial", ty: "place", a: 3, minGap: 1200,
      note: "Geocoding from OpenStreetMap: places, coordinates and administrative context",
      async search(q, ctx) {
        var data = await getJSON("nominatim", "https://nominatim.openstreetmap.org/search?format=json&limit=" +
          (ctx.perSource || 3) + "&addressdetails=1&q=" + encodeURIComponent(q), { minGap: 1200, headers: { Accept: "application/json" } });
        return (data || []).map(function (p, i) {
          var addr = p.address || {};
          var name = p.display_name || p.name || "place";
          return {
            id: "osm-" + hash(name + i), t: name.split(",")[0], s: "OpenStreetMap", o: "OpenStreetMap contributors",
            ty: "place", y: null, d: "", u: "https://www.openstreetmap.org/?mlat=" + p.lat + "&mlon=" + p.lon + "#map=12/" + p.lat + "/" + p.lon,
            l: "en", a: 3, k: ["place", "geography", (p.type || "")].filter(Boolean),
            b: name + " · " + (addr.country || "") + (addr.state ? ", " + addr.state : "") +
               " · coordinates " + p.lat + ", " + p.lon,
            e: [name.split(",")[0]], live: { source: "nominatim", lat: +p.lat, lon: +p.lon, placeType: p.type || null }
          };
        });
      }
    },
    {
      id: "worldbank", label: "World Bank", group: "dataset", ty: "dataset", a: 5, minGap: 500,
      note: "Official country indicators: the numbers governments report",
      async search(q, ctx) {
        var country = (q.match(/\b(india|china|brazil|nigeria|kenya|indonesia|pakistan|bangladesh|usa|united states|uk)\b/i) || [])[1];
        if (!country) return [];
        var iso = { india: "IN", china: "CN", brazil: "BR", nigeria: "NG", kenya: "KE", indonesia: "ID", pakistan: "PK", bangladesh: "BD", usa: "US", "united states": "US", uk: "GB" }[country.toLowerCase()] || "IN";
        var d = await getJSON("worldbank", "https://api.worldbank.org/v2/country/" + iso + "/indicator/SP.POP.TOTL;NY.GDP.MKTP.CD;SE.XPD.TOTL.GD.ZS?format=json&per_page=9&date=2020:2024", { timeout: 8000 });
        var rows = (d && d[1]) || [];
        return rows.slice(0, 3).map(function (r, i) {
          return {
            id: "wb-" + iso + "-" + i, t: r.indicator.value + " · " + r.country.value,
            s: "World Bank", o: "World Bank (official statistics)", ty: "dataset",
            y: parseInt(r.date, 10), d: r.date + "-01-01", u: "https://data.worldbank.org/indicator/" + r.indicator.id,
            l: "en", a: 5, k: ["statistics", "indicator", country.toLowerCase()],
            b: r.indicator.value + " for " + r.country.value + " in " + r.date + " was " + (r.value != null ? r.value : "not reported") + ".",
            e: [r.country.value], live: { source: "worldbank", indicator: r.indicator.id, value: r.value }
          };
        });
      }
    }
  ];

  /** OpenAlex returns abstracts as an inverted index; this puts them back. */
  function reconstructAbstract(inv) {
    if (!inv) return "";
    var words = [];
    Object.keys(inv).forEach(function (w) {
      inv[w].forEach(function (pos) { words[pos] = w; });
    });
    return words.filter(Boolean).join(" ").slice(0, 1600);
  }

  /* ------------------------------------------------------- local semantic -- */
  /**
   * Build a small semantic space from the documents this query just fetched.
   * The corpus model cannot know the live web's vocabulary, so the engine
   * derives a per-query space instead: a tf-idf document matrix, a truncated
   * SVD by power iteration on the (small) document Gram matrix, and term
   * vectors from MᵀU. It is LSA over the result set, which is exactly the
   * information available at that moment.
   */
  function localSpace(docs, opts) {
    opts = opts || {};
    var k = Math.min(opts.dims || 16, Math.max(2, docs.length - 1));
    if (docs.length < 4) return null;
    var df = {}, postings = [];
    docs.forEach(function (d, i) {
      var toks = uniq(L.tokenise((d.t || "") + " " + (d.b || "")));
      var tf = {};
      L.tokenise((d.t || "") + " " + (d.b || "")).forEach(function (t) { tf[t] = (tf[t] || 0) + 1; });
      postings.push(tf);
      toks.forEach(function (t) { df[t] = (df[t] || 0) + 1; });
    });
    var vocab = Object.keys(df).filter(function (t) { return df[t] >= 2 && t.length > 2; }).slice(0, 4000);
    if (vocab.length < 20) {
      // a thin result set has few repeated terms; fall back to single-document
      // terms rather than refusing to build a space at all
      vocab = Object.keys(df).filter(function (t) { return t.length > 3; }).slice(0, 4000);
    }
    if (vocab.length < 12) return null;
    var idx = {};
    vocab.forEach(function (t, i) { idx[t] = i; });
    var n = docs.length, v = vocab.length;
    var idf = vocab.map(function (t) { return Math.log(1 + n / df[t]); });

    // document matrix M (n x v), L2 normalised per row
    var M = [];
    for (var i = 0; i < n; i++) {
      var row = new Float32Array(v);
      for (var j = 0; j < v; j++) {
        var f = postings[i][vocab[j]] || 0;
        if (f) row[j] = (1 + Math.log(f)) * idf[j];
      }
      var norm = 0;
      for (var q = 0; q < v; q++) norm += row[q] * row[q];
      norm = Math.sqrt(norm) || 1;
      for (var q2 = 0; q2 < v; q2++) row[q2] /= norm;
      M.push(row);
    }

    // Gram matrix G = M Mᵀ (n x n). Built from the inverted lists rather than by
    // multiplying dense rows: with 4000 terms and 80 documents the sparse form
    // is two orders of magnitude cheaper, which matters on every keystroke.
    var G = [];
    for (var a0 = 0; a0 < n; a0++) G.push(new Float64Array(n));
    var inv = {};
    for (var j0 = 0; j0 < v; j0++) {
      for (var i0 = 0; i0 < n; i0++) {
        var w0 = M[i0][j0];
        if (w0) (inv[j0] = inv[j0] || []).push([i0, w0]);
      }
    }
    Object.keys(inv).forEach(function (j1) {
      var docsWith = inv[j1];
      for (var p0 = 0; p0 < docsWith.length; p0++) {
        for (var p1 = p0; p1 < docsWith.length; p1++) {
          var prod = docsWith[p0][1] * docsWith[p1][1];
          G[docsWith[p0][0]][docsWith[p1][0]] += prod;
          if (p0 !== p1) G[docsWith[p1][0]][docsWith[p0][0]] += prod;
        }
      }
    });
    var U = [];   // each entry: Float64Array(n), orthonormalised
    var rng = 12345;
    function rand() { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff - 0.5; }
    for (var comp = 0; comp < k; comp++) {
      var u = new Float64Array(n);
      for (var t2 = 0; t2 < n; t2++) u[t2] = rand();
      for (var it = 0; it < 24; it++) {
        var nu = new Float64Array(n);
        for (var r2 = 0; r2 < n; r2++) {
          var acc = 0;
          for (var c2 = 0; c2 < n; c2++) acc += G[r2][c2] * u[c2];
          nu[r2] = acc;
        }
        // deflate against earlier components
        for (var e = 0; e < U.length; e++) {
          var dot = 0;
          for (var d2 = 0; d2 < n; d2++) dot += nu[d2] * U[e][d2];
          for (var d3 = 0; d3 < n; d3++) nu[d3] -= dot * U[e][d3];
        }
        var nn = 0;
        for (var d4 = 0; d4 < n; d4++) nn += nu[d4] * nu[d4];
        nn = Math.sqrt(nn) || 1;
        for (var d5 = 0; d5 < n; d5++) u[d5] = nu[d5] / nn;
      }
      U.push(u);
    }

    // term vectors: for each term, its coordinates in the SVD space
    var termVec = {};
    vocab.forEach(function (term, j2) {
      var vec = new Float32Array(k);
      for (var c3 = 0; c3 < k; c3++) {
        var sum = 0;
        for (var r3 = 0; r3 < n; r3++) {
          var w = M[r3][j2];
          if (w) sum += w * U[c3][r3];
        }
        vec[c3] = sum;
      }
      var nv = 0;
      for (var z = 0; z < k; z++) nv += vec[z] * vec[z];
      nv = Math.sqrt(nv) || 1;
      for (var z2 = 0; z2 < k; z2++) vec[z2] /= nv;
      termVec[term] = vec;
    });

    return {
      dims: k, vocab: vocab, termVec: termVec, docVectors: U, docs: docs,
      /** Query vector in the same space. */
      embed: function (query) {
        var vec = new Float32Array(k), used = 0;
        L.tokenise(query).forEach(function (t) {
          var tv = termVec[t];
          if (!tv) return;
          for (var i2 = 0; i2 < k; i2++) vec[i2] += tv[i2] * (idf[idx[t]] || 1);
          used++;
        });
        var nn2 = 0;
        for (var i3 = 0; i3 < k; i3++) nn2 += vec[i3] * vec[i3];
        nn2 = Math.sqrt(nn2) || 1;
        for (var i4 = 0; i4 < k; i4++) vec[i4] /= nn2;
        return used ? vec : null;
      },
      /** Terms the query did not use but the space says belong with it. */
      expand: function (query, limit) {
        var qv = this.embed(query);
        if (!qv) return [];
        var scored = [];
        Object.keys(termVec).forEach(function (t) {
          var tv = termVec[t], s = 0;
          for (var i5 = 0; i5 < k; i5++) s += tv[i5] * qv[i5];
          if (s > 0.55) scored.push({ term: t, score: +s.toFixed(3) });
        });
        return scored.sort(function (x, y) { return y.score - x.score; }).slice(0, limit || 6);
      },
      /** Cosine between the query and each document. */
      score: function (query) {
        var qv = this.embed(query);
        if (!qv) return [];
        return docs.map(function (d, i6) {
          var s2 = 0;
          for (var i7 = 0; i7 < k; i7++) s2 += U[i7][i6] * qv[i7];
          return { i: i6, s: Math.max(0, s2) };
        });
      }
    };
  }

  /* ------------------------------------------------------------- ranking --- */
  function dedupe(docs) {
    var byUrl = {}, byTitle = {}, out = [];
    docs.forEach(function (d) {
      var key = (d.u || "").replace(/^https?:\/\/(www\.)?/, "").replace(/[#?].*$/, "").toLowerCase();
      var tk = L.normalise(d.t || "").slice(0, 60);
      var bump = function (target) {
        if (!target.live) target.live = { source: "unknown" };
        target.live.alsoFoundBy = (target.live.alsoFoundBy || 0) + 1;
      };
      if (key && byUrl[key]) { bump(byUrl[key]); return; }
      if (tk && byTitle[tk]) { bump(byTitle[tk]); return; }
      if (key) byUrl[key] = d;
      if (tk) byTitle[tk] = d;
      out.push(d);
    });
    return out;
  }

  /**
   * Rank the federated result set. Three signals, all inspectable:
   *   lexical  - BM25F over the fetched text (built on the spot)
   *   semantic - cosine in the per-query LSA space
   *   authority - issuer standing, then recency
   * Then the learned reranker from the offline engine is applied on top.
   */
  function rank(docs, query, opts) {
    opts = opts || {};
    if (!docs.length) return { results: [], space: null, expanded: [] };
    var space = localSpace(docs);
    var expanded = space ? space.expand(query, 6) : [];
    var enriched = expanded.length ? query + " " + expanded.map(function (e) { return e.term; }).join(" ") : query;

    // a throwaway BM25 index over exactly these documents
    var mini = null;
    try { mini = root.buildIndex ? root.buildIndex(docs) : null; } catch (e) { mini = null; }
    var lexical = [];
    if (mini && root.search) {
      try {
        lexical = root.search(mini, enriched, { limit: docs.length });
      } catch (e) { lexical = []; }
    }
    var lexScore = {};
    lexical.forEach(function (r) { lexScore[r.doc.id] = r.score; });
    var maxLex = 0;
    Object.keys(lexScore).forEach(function (k) { if (lexScore[k] > maxLex) maxLex = lexScore[k]; });

    var semScore = {};
    if (space) {
      space.score(query).forEach(function (x) { semScore[docs[x.i].id] = x.s; });
    }
    var maxSem = 0;
    Object.keys(semScore).forEach(function (k2) { if (semScore[k2] > maxSem) maxSem = semScore[k2]; });

    var maxYear = new Date().getFullYear();
    var results = docs.map(function (d) {
      var lex = maxLex ? (lexScore[d.id] || 0) / maxLex : 0;
      var sem = maxSem ? (semScore[d.id] || 0) / maxSem : 0;
      var auth = (d.a || 3) / 5;
      var rec = d.y ? Math.max(0, 1 - (maxYear - d.y) / 30) : 0.4;
      var boost = 0;
      if (d.live && d.live.citedBy) boost += Math.min(0.12, Math.log10(1 + d.live.citedBy) / 25);
      if (d.live && d.live.retracted) boost -= 0.35;
      if (d.live && d.live.alsoFoundBy) boost += Math.min(0.06, d.live.alsoFoundBy * 0.02);
      var score = 0.42 * lex + 0.30 * sem + 0.16 * auth + 0.12 * rec + boost;
      return {
        doc: d, score: score, bm25: lexScore[d.id] || 0, cos: sem,
        why: { lexical: +lex.toFixed(3), semantic: +sem.toFixed(3), authority: +auth.toFixed(3),
               recency: +rec.toFixed(3), bonus: +boost.toFixed(3) },
        confidence: Math.max(0.2, Math.min(0.95, 0.35 + 0.4 * lex + 0.25 * sem))
      };
    });
    results.sort(function (a, b) { return b.score - a.score; });
    try {
      results = ANV.learn.rerank(results, {});
      // after the learned rerank the displayed score is the learned one, so the
      // list stays visibly ordered by the number the reader is looking at
      results.forEach(function (r) { if (r.learnScore != null) r.score = r.learnScore; });
    } catch (e) {}
    results.forEach(function (r) {
      r.snippet = r.doc.b ? (r.doc.b.length > 340 ? r.doc.b.slice(0, 320).replace(/\s+\S*$/, "") + "…" : r.doc.b) : (r.doc.t || "");
    });
    return { results: results, space: space, expanded: expanded };
  }

  /* ---------------------------------------------------------- federation --- */
  /**
   * Ask every source at once. Sources report as they land, so the interface can
   * paint partial results instead of waiting for the slowest one.
   */
  async function search(query, opts) {
    opts = opts || {};
    var q = String(query || "").trim();
    if (!q) return { query: q, results: [], sources: [], ms: 0 };
    var t0 = now();
    var ctx = {
      lang: opts.lang || detectLang(q),
      perSource: opts.perSource || 5
    };
    var active = opts.sources ? SOURCES.filter(function (s) { return opts.sources.indexOf(s.id) >= 0; }) : SOURCES.slice();
    var collected = [], reports = [];

    var jobs = active.map(function (src) {
      var started = now();
      return src.search(q, ctx).then(function (docs) {
        var clean = (docs || []).filter(function (d) { return d && d.t; });
        clean.forEach(function (d) { if (!d.live) d.live = {}; d.live.source = src.id; d.live.group = src.group; });
        collected = collected.concat(clean);
        var rep = { id: src.id, label: src.label, group: src.group, count: clean.length, ms: now() - started, ok: true };
        reports.push(rep);
        if (opts.onSource) { try { opts.onSource(rep, clean); } catch (e) {} }
        return rep;
      }).catch(function (err) {
        var rep = { id: src.id, label: src.label, group: src.group, count: 0, ms: now() - started, ok: false,
                    error: (err && err.message) || "unavailable" };
        reports.push(rep);
        if (opts.onSource) { try { opts.onSource(rep, []); } catch (e) {} }
        return rep;
      });
    });
    await Promise.all(jobs);

    var unique = dedupe(collected);
    var ranked = rank(unique, q, opts);
    var out = {
      query: q, lang: ctx.lang,
      results: ranked.results,
      space: ranked.space,
      expanded: ranked.expanded,
      sources: reports.sort(function (a, b) { return (b.count - a.count) || a.label.localeCompare(b.label); }),
      documents: unique.length,
      ms: now() - t0
    };
    stats.bySource = {};
    reports.forEach(function (r) { stats.bySource[r.id] = r; });
    return out;
  }

  /* --------------------------------------------------------- public API ---- */
  ANV.live = {
    SOURCES: SOURCES,
    search: search, rank: rank, localSpace: localSpace, dedupe: dedupe,
    getJSON: getJSON, detectLang: detectLang, domainOf: domainOf,
    stats: function () { return stats; },
    clearCache: function () {
      cache = {};
      epoch++;
      try {
        if (root.sessionStorage && typeof sessionStorage.length === "number") {
          var doomed = [];
          for (var i = 0; i < sessionStorage.length; i++) {
            var k = sessionStorage.key(i);
            if (k && k.indexOf("anv.live.") === 0) doomed.push(k);
          }
          doomed.forEach(function (k2) { sessionStorage.removeItem(k2); });
        }
      } catch (e) {}
    },
    /** Group definitions used by the interface for filtering. */
    GROUPS: [
      { id: "encyclopaedia", label: "Encyclopaedia" },
      { id: "knowledge graph", label: "Knowledge graph" },
      { id: "scholarly", label: "Peer-reviewed" },
      { id: "books", label: "Books" },
      { id: "archive", label: "Archives" },
      { id: "community", label: "Community" },
      { id: "code", label: "Code" },
      { id: "media", label: "Media" },
      { id: "observation", label: "Live measurement" },
      { id: "spatial", label: "Place" },
      { id: "dataset", label: "Official statistics" }
    ]
  };

  if (typeof module !== "undefined" && module.exports) module.exports = ANV.live;
})(typeof globalThis !== "undefined" ? globalThis : this);
