#!/usr/bin/env node
/* End-to-end test of the ONLINE build: boots index.html in a DOM with every
   network call mocked, then drives it like a visitor would. */
const fs = require("fs"), path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const calls = [];

function route(url) {
  calls.push(String(url));
  const u = String(url);
  if (u.includes("wikipedia.org") && u.includes("list=search"))
    return { query: { search: [
      { title: "IndiaAI Mission", snippet: "national <b>AI</b> mission", timestamp: "2026-03-02T10:00:00Z", wordcount: 900 },
      { title: "Bhashini", snippet: "language translation platform", timestamp: "2025-11-01T00:00:00Z", wordcount: 500 }] } };
  if (u.includes("wikipedia.org") && u.includes("prop=extracts"))
    return { query: { pages: { "1": { title: "IndiaAI Mission", extract: "The IndiaAI Mission was launched in March 2024 with an outlay of Rs 10,372 crore to build a sovereign AI ecosystem. It onboarded 38,231 GPUs for startups and academia.", langlinks: [{ lang: "hi", "*": "इंडियाएआई मिशन" }] } } } };
  if (u.includes("wikidata.org"))
    return { search: [{ id: "Q1", label: "IndiaAI", description: "Indian AI programme", concepturi: "https://www.wikidata.org/entity/Q1" }] };
  if (u.includes("api.openalex.org"))
    return { results: [{ id: "https://openalex.org/W1", title: "Sovereign compute for AI", publication_year: 2025, publication_date: "2025-06-01", doi: "https://doi.org/10.1/x", cited_by_count: 42, is_retracted: false, primary_location: { source: { display_name: "Nature" } }, concepts: [{ display_name: "Artificial intelligence" }], abstract_inverted_index: { compute: [0], sovereignty: [1] } }] };
  if (u.includes("api.crossref.org"))
    return { message: { items: [{ DOI: "10.1/y", title: ["Indic language technology"], issued: { "date-parts": [[2024, 5, 3]] }, "container-title": ["Journal of Language Tech"], author: [{ family: "Sharma" }], type: "journal-article", "is-referenced-by-count": 7 }] } };
  if (u.includes("semanticscholar.org"))
    return { data: [{ paperId: "p1", title: "Retrieval augmented generation", abstract: "RAG combines retrieval with generation for grounded answers.", year: 2024, venue: "ACL", authors: [{ name: "Lee" }], url: "https://acl.test/p1", citationCount: 300, isOpenAccess: true }] };
  if (u.includes("openlibrary.org"))
    return { docs: [{ key: "/works/OL1W", title: "The Wonder That Was India", author_name: ["A. L. Basham"], first_publish_year: 1954, subject: ["History"], edition_count: 12 }] };
  if (u.includes("archive.org"))
    return { response: { docs: [{ identifier: "ia-1", title: "Colonial records of Bengal", year: 1890, creator: "Government of Bengal", mediatype: "texts", description: "Land settlement records of the presidency." }] } };
  if (u.includes("wikisource.org"))
    return { query: { search: [{ title: "Treaty of Peace", snippet: "signed between the parties", timestamp: "2019-01-01T00:00:00Z" }] } };
  if (u.includes("api.stackexchange.com"))
    return { items: [{ question_id: 9, title: "How does BM25 work?", owner: { display_name: "dev" }, creation_date: 1700000000, link: "https://so.test/9", tags: ["search"], body: "<p>BM25 scores documents by term frequency.</p>", score: 12, answer_count: 3, accepted_answer_id: 10 }] };
  if (u.includes("api.github.com"))
    return { items: [{ id: 5, full_name: "org/hybrid-search", description: "hybrid retrieval engine", html_url: "https://github.com/org/hybrid-search", stargazers_count: 900, forks_count: 40, topics: ["search"], language: "Python", pushed_at: "2026-01-01T00:00:00Z", license: { spdx_id: "MIT" }, owner: { login: "org" } }] };
  if (u.includes("api.openverse.org"))
    return { results: [{ id: "ov1", title: "Satellite view", source: "flickr", creator: "nasa", foreign_landing_url: "https://flickr.test/1", license: "cc0", tags: [{ name: "satellite" }] }] };
  if (u.includes("nominatim"))
    return [{ lat: "28.61", lon: "77.20", display_name: "New Delhi, India" }];
  if (u.includes("api.open-meteo.com"))
    return { current: { time: "2026-11-01T12:00", temperature_2m: 31.4, relative_humidity_2m: 44, wind_speed_10m: 8.2, precipitation: 0 } };
  if (u.includes("earthquake.usgs.gov"))
    return { features: [{ id: "q1", properties: { mag: 5.1, place: "Andaman Sea", time: 1760000000000, url: "https://usgs.test/q1" }, geometry: { coordinates: [93.1, 10.2, 35] } }] };
  if (u.includes("api.worldbank.org"))
    return [{}, [{ indicator: { id: "SP.POP.TOTL", value: "Population, total" }, country: { value: "India" }, date: "2023", value: 1428600000 }]];
  return {};
}

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push("jsdomError: " + e.message));
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

let pass = 0, fail = 0; const failures = [];
function check(n, ok, d) { if (ok) { pass++; console.log("  ok   " + n); } else { fail++; failures.push(n); console.log("  FAIL " + n + (d ? "  -> " + d : "")); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const dom = new JSDOM(html, {
  runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
  url: "https://swami-prathmesh.github.io/anveshan/",
  beforeParse(window) {
    window.scrollTo = () => {};
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
    window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    window.fetch = async (url) => ({ ok: true, status: 200, text: async () => JSON.stringify(route(url)) });
    try {
      const { webcrypto } = require("crypto");
      Object.defineProperty(window, "crypto", { value: webcrypto, configurable: true, writable: true });
    } catch (e) {}
    try {
      const util = require("util");
      if (!window.TextEncoder) window.TextEncoder = util.TextEncoder;
      if (!window.TextDecoder) window.TextDecoder = util.TextDecoder;
    } catch (e) {}
    const noop = () => {};
    const fakeCtx = new Proxy({}, { get: (t, k) => k === "canvas" ? { width: 800, height: 600 } : (k === "createLinearGradient" || k === "createRadialGradient") ? () => ({ addColorStop: noop }) : noop, set: () => true });
    window.HTMLCanvasElement.prototype.getContext = () => fakeCtx;
  }
});
const w = dom.window, d = w.document;

(async () => {
  for (let i = 0; i < 50 && !(w.ANV && w.ANV.liveUI && w.ANV.liveUI.ready); i++) await wait(100);

  console.log("\n== boot ==");
  check("online engine booted", !!(w.ANV && w.ANV.liveUI && w.ANV.liveUI.ready));
  check("live layer present", !!w.ANV.live && w.ANV.live.SOURCES.length >= 15, String(w.ANV.live && w.ANV.live.SOURCES.length));
  check("default mode is web", w.ANV.liveUI.mode === "web", w.ANV.liveUI.mode);
  check("sources nav added", !!d.getElementById("navSources") && !!d.getElementById("navWatch"));
  check("hero describes live sources", /open collections/.test(d.querySelector(".hero p.sub").textContent), d.querySelector(".hero p.sub").textContent.slice(0, 80));
  check("no boot errors", errors.length === 0, errors.slice(0, 2).join(" | "));

  console.log("\n== live search ==");
  w.doSearch("india ai mission", true);
  await wait(1500);
  const cards = d.querySelectorAll("#results .card");
  check("results painted", cards.length > 0, String(cards.length));
  check("source chips rendered", d.querySelectorAll("#v4src .v4-chip").length >= 15, String(d.querySelectorAll("#v4src .v4-chip").length));
  check("some sources report hits", /hit/.test(d.getElementById("v4src").textContent));
  check("brief rendered", !!d.querySelector("#results .brief"));
  check("brief cites sources", d.querySelectorAll("#results .v4-srcitem").length > 0);
  check("evidence strip on cards", !!d.querySelector("#results .v4-ev"));
  check("intelligence bar shows live mode", /live/.test(d.querySelector(".v4bar").textContent));
  check("network was actually called", calls.length > 5, String(calls.length));
  check("no network errors", errors.length === 0, errors.slice(0, 2).join(" | "));

  console.log("\n== live document drawer ==");
  const firstId = w.S.results[0].doc.id;
  w.openDoc(firstId);
  await wait(80);
  check("drawer opened for a live doc", d.getElementById("drawer").classList.contains("on"));
  check("drawer links to the original", /Open original/.test(d.getElementById("dBody").innerHTML));
  check("drawer shows credibility", /Credibility/.test(d.getElementById("dBody").innerHTML));
  w.closeDrawer && w.closeDrawer();

  console.log("\n== panels on the live set ==");
  w.openPanel("discover");
  await wait(120);
  w.ANV.ui.paradigm("unknown");
  await wait(300);
  const dis = d.getElementById("v4disout");
  check("discover runs over live documents", dis && dis.innerHTML.length > 150 && !/failed on this subject/.test(dis.innerHTML), dis && dis.innerHTML.slice(0, 100));
  w.openPanel("sources");
  const src = d.getElementById("panelBody").innerHTML;
  check("sources panel lists adapters", /OpenAlex/.test(src) && /Internet Archive/.test(src));
  check("sources panel states the limits", /cannot crawl the whole web/.test(src));
  w.openPanel("watch");
  check("watch panel renders", /No questions watched yet/.test(d.getElementById("panelBody").innerHTML));

  console.log("\n== mode toggle ==");
  w.ANV.liveUI.toggleMode();
  await wait(400);
  check("switched to library mode", w.ANV.liveUI.mode === "library");
  check("library mode searches the built-in corpus", d.querySelectorAll("#results .card").length > 0);
  w.ANV.liveUI.toggleMode();
  await wait(1200);
  check("switched back to web mode", w.ANV.liveUI.mode === "web");

  console.log("\n== failure honesty ==");
  w.fetch = async () => { throw new Error("network unavailable"); };
  w.ANV.live.clearCache();
  w.doSearch("a query with no network", false);
  await wait(2500);
  const body = d.getElementById("v4livebody");
  check("failure is reported, not faked", body && /no server to fall back on/.test(body.innerHTML), body && body.innerHTML.slice(0, 120));

  console.log("\n" + (fail ? "FAILED " + fail : "ALL PASS") + "  (" + pass + " passed, " + fail + " failed)");
  try { dom.window.close(); } catch (e) {}
  if (fail) { console.log("failures: " + failures.join(" | ")); process.exit(1); }
  process.exit(0);
})();
