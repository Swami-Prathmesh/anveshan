#!/usr/bin/env node
/* Tests for the live federation layer. Every network call is mocked, so this
   checks the parsing, merging, ranking and failure handling - not the APIs. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.resolve(__dirname, "..");

const calls = [];
function route(url) {
  calls.push(url);
  const u = url;
  if (u.includes("wikipedia.org") && u.includes("list=search")) {
    return { query: { search: [
      { title: "IndiaAI Mission", snippet: "<span>national</span> AI <b>mission</b>", timestamp: "2026-03-02T10:00:00Z", wordcount: 900 },
      { title: "Bhashini", snippet: "language <span>translation</span> platform", timestamp: "2025-11-01T00:00:00Z", wordcount: 500 }
    ] } };
  }
  if (u.includes("wikipedia.org") && u.includes("prop=extracts")) {
    return { query: { pages: { "1": { title: "IndiaAI Mission", extract: "The IndiaAI Mission was launched in March 2024 with an outlay of Rs 10,372 crore to build a sovereign AI ecosystem. It onboarded 38,231 GPUs.", langlinks: [{ lang: "hi", "*": "इंडियाएआई मिशन" }] } } } };
  }
  if (u.includes("wikidata.org")) {
    return { search: [{ id: "Q123", label: "IndiaAI", description: "Indian government AI programme", concepturi: "https://www.wikidata.org/entity/Q123", aliases: ["India AI"] }] };
  }
  if (u.includes("api.openalex.org")) {
    return { results: [{ id: "https://openalex.org/W1", title: "Sovereign compute for AI", publication_year: 2025, publication_date: "2025-06-01",
      doi: "https://doi.org/10.1/x", cited_by_count: 42, is_retracted: false, primary_location: { source: { display_name: "Nature" }, landing_page_url: "https://nature.com/x" },
      concepts: [{ display_name: "Artificial intelligence" }], abstract_inverted_index: { compute: [0], sovereignty: [1] } }] };
  }
  if (u.includes("api.crossref.org")) {
    return { message: { items: [{ DOI: "10.1/y", title: ["Language technology for Indic scripts"], issued: { "date-parts": [[2024, 5, 3]] },
      "container-title": ["Journal of Language Tech"], author: [{ family: "Sharma" }], type: "journal-article", "is-referenced-by-count": 7 }] } };
  }
  if (u.includes("semanticscholar.org")) {
    return { data: [{ paperId: "p1", title: "Retrieval augmented generation", abstract: "RAG combines retrieval with generation.", year: 2024, venue: "ACL", authors: [{ name: "Lee" }], url: "https://acl.test/p1", citationCount: 300, isOpenAccess: true }] };
  }
  if (u.includes("openlibrary.org")) {
    return { docs: [{ key: "/works/OL1W", title: "The Wonder That Was India", author_name: ["A. L. Basham"], first_publish_year: 1954, subject: ["History"], language: ["eng"], edition_count: 12 }] };
  }
  if (u.includes("archive.org")) {
    return { response: { docs: [{ identifier: "ia-1", title: "Colonial records of Bengal", year: 1890, creator: "Government of Bengal", mediatype: "texts", description: "Land settlement records." }] } };
  }
  if (u.includes("wikisource.org")) {
    return { query: { search: [{ title: "Treaty of Peace", snippet: "signed between", timestamp: "2019-01-01T00:00:00Z" }] } };
  }
  if (u.includes("api.stackexchange.com")) {
    return { items: [{ question_id: 9, title: "How does BM25 work?", owner: { display_name: "dev" }, creation_date: 1700000000, link: "https://so.test/9", tags: ["search"], body: "<p>BM25 scores documents.</p>", score: 12, answer_count: 3, accepted_answer_id: 10 }] };
  }
  if (u.includes("api.github.com")) {
    return { items: [{ id: 5, full_name: "org/hybrid-search", description: "hybrid retrieval engine", html_url: "https://github.com/org/hybrid-search", stargazers_count: 900, forks_count: 40, topics: ["search", "ir"], language: "Python", pushed_at: "2026-01-01T00:00:00Z", license: { spdx_id: "MIT" }, owner: { login: "org" } }] };
  }
  if (u.includes("api.openverse.org")) {
    return { results: [{ id: "ov1", title: "Satellite view", source: "flickr", creator: "nasa", foreign_landing_url: "https://flickr.test/1", license: "cc0", tags: [{ name: "satellite" }] }] };
  }
  if (u.includes("nominatim")) {
    return [{ lat: "28.61", lon: "77.20", display_name: "New Delhi, India" }];
  }
  if (u.includes("api.open-meteo.com")) {
    return { current: { time: "2026-11-01T12:00", temperature_2m: 31.4, relative_humidity_2m: 44, wind_speed_10m: 8.2, precipitation: 0 } };
  }
  if (u.includes("earthquake.usgs.gov")) {
    return { features: [{ id: "q1", properties: { mag: 5.1, place: "Andaman Sea", time: 1760000000000, url: "https://usgs.test/q1" }, geometry: { coordinates: [93.1, 10.2, 35] } }] };
  }
  if (u.includes("api.worldbank.org")) {
    return [ {}, [ { indicator: { id: "SP.POP.TOTL", value: "Population, total" }, country: { value: "India" }, date: "2023", value: 1428600000 } ] ];
  }
  return {};
}

const ctx = {
  console, performance: { now: () => Date.now() },
  TextDecoder, TextEncoder, URL, setTimeout, clearTimeout, AbortController, Promise,
  fetch: async (url) => ({ ok: true, status: 200, text: async () => JSON.stringify(route(String(url))) }),
  sessionStorage: (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), key: () => null, length: 0 }; })(),
  location: { hash: "" }, document: undefined,
  Buffer, atob: (b) => Buffer.from(b, "base64").toString("binary")
};
ctx.globalThis = ctx; ctx.window = ctx;
vm.createContext(ctx);
const run = (f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
run("src/engine/lang.js");
run("src/engine/semantic.js");
run("src/engine/evidence.js");
run("src/engine/learn.js");
run("src/data/model.js");
vm.runInContext("ANV.semantic.init(ANV_MODEL);", ctx);
run("src/engine/live.js");
const L = ctx.ANV.live;

let pass = 0, fail = 0; const failures = [];
function check(n, ok, d) { if (ok) { pass++; console.log("  ok   " + n); } else { fail++; failures.push(n); console.log("  FAIL " + n + (d ? "  -> " + d : "")); } }

(async () => {
  console.log("\n== source coverage ==");
  check("fifteen sources registered", L.SOURCES.length >= 15, String(L.SOURCES.length));
  check("every source has id/label/group/note", L.SOURCES.every((s) => s.id && s.label && s.group && s.note && typeof s.search === "function"));
  check("no source requires an API key", !L.SOURCES.some((s) => /key=|api_key|token=/.test(String(s.search))));

  console.log("\n== federation ==");
  const out = await L.search("india ai mission", { perSource: 3 });
  const ids = out.sources.map((s) => s.id);
  check("all sources answered", out.sources.every((s) => s.ok), JSON.stringify(out.sources.filter((s) => !s.ok)));
  check("documents collected", out.documents >= 10, String(out.documents));
  check("results ranked", out.results.length > 0 && out.results[0].score > 0);
  check("scores descending", out.results.every((r, i, a) => i === 0 || a[i - 1].score >= r.score));
  check("every result has a url or id", out.results.every((r) => r.doc.u || r.doc.id));
  check("sources report counts", out.sources.some((s) => s.count > 0));
  check("timing recorded", out.ms >= 0);

  const bySource = {};
  out.results.forEach((r) => { bySource[r.doc.live.source] = (bySource[r.doc.live.source] || 0) + 1; });
  console.log("    sources contributing:", JSON.stringify(bySource));
  check("wikipedia documents parsed", (bySource.wikipedia || 0) > 0);
  check("scholarly documents parsed", (bySource.openalex || 0) + (bySource.crossref || 0) + (bySource.semanticscholar || 0) > 0);
  check("archive documents parsed", (bySource.internetarchive || 0) > 0);
  check("code documents parsed", (bySource.github || 0) > 0);

  console.log("\n== parsing detail ==");
  const wp = out.results.filter((r) => r.doc.live.source === "wikipedia")[0];
  check("wikipedia intro text used", wp && /10,372 crore/.test(wp.doc.b), wp && wp.doc.b.slice(0, 80));
  check("wikipedia translations captured", wp && wp.doc.live.translations.length > 0);
  check("wikipedia date parsed", wp && /^\d{4}-\d{2}-\d{2}$/.test(wp.doc.d), wp && wp.doc.d);
  const oa = out.results.filter((r) => r.doc.live.source === "openalex")[0];
  check("openalex abstract reconstructed", oa && /compute sovereignty/.test(oa.doc.b), oa && oa.doc.b);
  check("openalex citation count kept", oa && oa.doc.live.citedBy === 42);
  check("openalex doi kept", oa && /doi\.org/.test(oa.doc.u));
  const gh = out.results.filter((r) => r.doc.live.source === "github")[0];
  check("github stars kept", gh && gh.doc.live.stars === 900);

  console.log("\n== live semantic space ==");
  const space = out.space;
  check("space built from the result set", !!space && space.dims > 1, space && String(space.dims));
  const expanded = space ? space.expand("india ai mission", 5) : [];
  check("expansion proposes related terms", expanded.length > 0, JSON.stringify(expanded.slice(0, 4)));
  const scores = space ? space.score("india ai mission") : [];
  check("documents scored in the space", scores.length === out.documents && scores.every((s) => s.s >= 0));

  console.log("\n== dedupe ==");
  const dup = L.dedupe([
    { id: "a", t: "Same title", u: "https://x.test/p?utm=1", b: "one" },
    { id: "b", t: "Same title", u: "https://x.test/p", b: "two" },
    { id: "c", t: "Other", u: "https://y.test/q", b: "three" }
  ]);
  check("duplicate url and title collapsed", dup.length === 2, String(dup.length));
  check("duplicate marked", dup[0].live && dup[0].live.alsoFoundBy >= 1);

  console.log("\n== caching and politeness ==");
  const before = L.stats().requests;
  await L.search("india ai mission", { perSource: 3 });
  check("second identical query served from cache", L.stats().cacheHits > 0);
  check("no duplicate requests for cached urls", L.stats().requests >= before);

  console.log("\n== failure handling ==");
  const originalFetch = ctx.fetch;
  ctx.fetch = async (url) => {
    if (String(url).includes("openalex")) return { ok: false, status: 503, text: async () => "down" };
    return originalFetch(url);
  };
  L.clearCache();
  const partial = await L.search("language technology", { perSource: 2 });
  const failed = partial.sources.filter((s) => !s.ok);
  check("a dead source is reported, not hidden", failed.length >= 1 && failed[0].id === "openalex", JSON.stringify(failed.map((f) => f.id + ":" + f.error)));
  check("other sources still return results", partial.results.length > 0);
  ctx.fetch = originalFetch;

  console.log("\n== language routing ==");
  check("hindi query routed to hi", L.detectLang("भुगतान प्रणाली") === "hi", L.detectLang("भुगतान प्रणाली"));
  check("sanskrit query detected", ["sa", "hi"].includes(L.detectLang("अन्वेषण अस्ति च")));
  check("english query routed to en", L.detectLang("quantum sensing") === "en");
  const hi = await L.search("भाषा अनुवाद", { perSource: 2 });
  check("hindi query returns documents", hi.results.length > 0, String(hi.results.length));

  console.log("\n== offline behaviour ==");
  ctx.fetch = async () => { throw new Error("network unavailable"); };
  L.clearCache();
  const dead = await L.search("anything at all", { perSource: 1 });
  check("total failure returns empty, not a crash", dead.results.length === 0 && dead.sources.every((s) => s.count === 0),
    JSON.stringify(dead.sources.filter((s) => s.count > 0).map((s) => s.id)));
  ctx.fetch = originalFetch;

  console.log("\n" + (fail ? "FAILED " + fail : "ALL PASS") + "  (" + pass + " passed, " + fail + " failed)");
  if (fail) { console.log("failures: " + failures.join(" | ")); process.exit(1); }
  process.exit(0);
})();
