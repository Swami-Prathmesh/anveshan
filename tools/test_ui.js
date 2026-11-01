#!/usr/bin/env node
/* Drives the new interface in a DOM, for both builds. This is the test that says
   whether a first-time visitor can actually use the page. */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");

/* ---- a tiny fake internet: the shipped index from disk, plus the live APIs ---- */
function apiRoute(u) {
  if (u.includes("wikipedia.org") && u.includes("list=search"))
    return { query: { search: [{ title: "IndiaAI Mission", snippet: "national AI mission", timestamp: "2026-03-02T10:00:00Z", wordcount: 900 }] } };
  if (u.includes("wikipedia.org") && u.includes("prop=extracts"))
    return { query: { pages: { "1": { title: "IndiaAI Mission", extract: "The IndiaAI Mission was launched in March 2024 with an outlay of Rs 10,372 crore to build a sovereign AI ecosystem. It onboarded 38,231 GPUs for startups.", langlinks: [] } } } };
  if (u.includes("wikidata.org")) return { search: [{ id: "Q1", label: "IndiaAI", description: "Indian AI programme", concepturi: "https://www.wikidata.org/entity/Q1" }] };
  if (u.includes("api.openalex.org")) return { results: [{ id: "https://openalex.org/W1", title: "Sovereign compute for AI", publication_year: 2025, publication_date: "2025-06-01", doi: "https://doi.org/10.1/x", cited_by_count: 42, is_retracted: false, primary_location: { source: { display_name: "Nature" } }, concepts: [{ display_name: "Artificial intelligence" }], abstract_inverted_index: { compute: [0], sovereignty: [1] } }] };
  if (u.includes("api.crossref.org")) return { message: { items: [] } };
  if (u.includes("semanticscholar.org")) return { data: [] };
  if (u.includes("openlibrary.org")) return { docs: [] };
  if (u.includes("archive.org")) return { response: { docs: [] } };
  if (u.includes("wikisource.org")) return { query: { search: [] } };
  if (u.includes("api.stackexchange.com")) return { items: [] };
  if (u.includes("api.github.com")) return { items: [] };
  if (u.includes("api.openverse.org")) return { results: [] };
  if (u.includes("nominatim")) return [];
  if (u.includes("api.open-meteo.com")) return { current: { time: "2026-11-01T12:00", temperature_2m: 31, relative_humidity_2m: 44, wind_speed_10m: 8, precipitation: 0 } };
  if (u.includes("earthquake.usgs.gov")) return { features: [] };
  if (u.includes("api.worldbank.org")) return [{}, []];
  return {};
}

function makeDom(file) {
  const html = fs.readFileSync(path.join(ROOT, file), "utf8");
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push("jsdomError: " + e.message));
  vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    url: "https://swami-prathmesh.github.io/anveshan/",
    beforeParse(window) {
      window.scrollTo = () => {};
      window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
      window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
      window.fetch = async (url) => {
        const u = String(url);
        if (/^index\/.*\.json$/.test(u)) {
          const file2 = path.join(ROOT, u);
          if (!fs.existsSync(file2)) return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
          const body = fs.readFileSync(file2, "utf8");
          return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
        }
        const body = JSON.stringify(apiRoute(u));
        return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
      };
      try {
        const { webcrypto } = require("crypto");
        Object.defineProperty(window, "crypto", { value: webcrypto, configurable: true, writable: true });
      } catch (e) {}
      try {
        const util = require("util");
        if (!window.TextEncoder) window.TextEncoder = util.TextEncoder;
        if (!window.TextDecoder) window.TextDecoder = util.TextDecoder;
      } catch (e) {}
    }
  });
  return { dom, errors };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  ok   " + name); }
  else { fail++; failures.push(name); console.log("  FAIL " + name + (detail ? "  -> " + detail : "")); }
}

async function suite(file, label, expectIndex) {
  console.log(`\n=== ${label} ===`);
  const { dom, errors } = makeDom(file);
  const w = dom.window, d = w.document;
  for (let i = 0; i < 80 && !(w.ANV && w.ANV.ui && w.ANV.ui.ready); i++) await wait(100);

  console.log("\n-- first impression --");
  check("page boots", !!(w.ANV && w.ANV.ui && w.ANV.ui.ready), JSON.stringify(w.ANV && w.ANV.ui && w.ANV.ui.state && w.ANV.ui.state.ready));
  check("one search box on the home screen", d.querySelectorAll("#home input").length === 1);
  check("home screen is visible", d.getElementById("home").hidden === false);
  check("results are hidden until you search", d.getElementById("results").hidden === true);
  check("examples are offered", d.querySelectorAll("#examples button").length >= 3);
  check("engine choices rendered", d.querySelectorAll(".engine").length === 3, String(d.querySelectorAll(".engine").length));
  check("no jargon nav bar", d.querySelectorAll(".top .btn").length === 2, String(d.querySelectorAll(".top .btn").length));
  check("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));

  console.log("\n-- theme --");
  const before = d.documentElement.getAttribute("data-theme");
  d.getElementById("btnTheme").click();
  const after = d.documentElement.getAttribute("data-theme");
  check("theme toggles", before !== after, before + " -> " + after);
  d.getElementById("btnTheme").click();

  console.log("\n-- searching --");
  if (expectIndex) {
    check("index engine is the default", w.ANV.ui.state.engine === "index", w.ANV.ui.state.engine);
  } else {
    check("falls back to a working engine offline", ["live", "library"].includes(w.ANV.ui.state.engine), w.ANV.ui.state.engine);
  }
  w.ANV.ui.setEngine(expectIndex ? "index" : "library");
  d.getElementById("q").value = expectIndex ? "groundwater depletion wells survey" : "UPI transaction growth";
  d.getElementById("searchForm").dispatchEvent(new w.Event("submit", { cancelable: true }));
  await wait(1500);
  check("results appear", d.querySelectorAll("#cards .card").length > 0, String(d.querySelectorAll("#cards .card").length));
  check("home hides after searching", d.getElementById("home").hidden === true);
  check("an answer is written in plain sentences", !!d.querySelector("#answer .answer .text"), (d.querySelector("#answer") || {}).textContent?.slice(0, 60));
  check("the answer cites numbered sources", d.querySelectorAll("#answer ol li").length > 0);
  check("a result count is shown", /\d+ results?/.test(d.getElementById("count").textContent), d.getElementById("count").textContent);
  check("status shows speed", /ms/.test(d.getElementById("status").textContent), d.getElementById("status").textContent);
  check("each card has a title link", d.querySelectorAll("#cards .card h3 a").length > 0);
  check("each card names its source", d.querySelectorAll("#cards .card .src").length > 0);
  check("each card carries a plain-language credibility badge",
    /source/.test(d.querySelector("#cards .card .badges").textContent), d.querySelector("#cards .card .badges").textContent);
  check("search is logged for learning", w.ANV.learn.queries().length > 0);

  console.log("\n-- filters --");
  d.getElementById("btnFilters").click();
  await wait(80);
  check("filters open", d.getElementById("filters").hidden === false);
  check("filters are simple dropdowns", d.querySelectorAll("#filters select").length === 4, String(d.querySelectorAll("#filters select").length));
  const typeSel = d.querySelector('#filters select[data-filter="type"]');
  const option = typeSel && typeSel.options[1];
  if (option) {
    typeSel.value = option.value;
    typeSel.dispatchEvent(new w.Event("change"));
    await wait(80);
    check("filtering narrows the list", w.ANV.ui.state.results.length <= w.ANV.ui.state.base.length);
    check("count mentions the filter", /filtered/.test(d.getElementById("count").textContent) || w.ANV.ui.state.results.length === w.ANV.ui.state.base.length,
      d.getElementById("count").textContent);
    typeSel.value = "all";
    typeSel.dispatchEvent(new w.Event("change"));
  }

  console.log("\n-- reading one result --");
  const detail = d.querySelector("#cards [data-detail]");
  if (detail) {
    detail.click();
    await wait(80);
    check("detail panel opens", d.getElementById("drawer").hidden === false);
    check("detail shows the full text", d.querySelector("#drawerBody .doc-text").textContent.length > 100);
    check("detail explains the credibility score", /scores as it does/.test(d.getElementById("drawerBody").textContent));
    check("detail links to the original", !!d.querySelector('#drawerBody a[target="_blank"]'));
    d.getElementById("drawerClose").click();
    check("detail closes", d.getElementById("drawer").hidden === true);
  } else {
    check("detail button present", false, "no [data-detail] button");
  }

  console.log("\n-- tools --");
  d.getElementById("btnTools").click();
  await wait(100);
  check("tools open", d.getElementById("sheet").hidden === false);
  check("tools are grouped into seven tabs", d.querySelectorAll("#sheetTabs .tab").length === 7, String(d.querySelectorAll("#sheetTabs .tab").length));
  const tools = ["discover", "verify", "investigate", "add", "learning", "sources", "audit"];
  for (const t of tools) {
    w.ANV.ui.openSheet(t);
    await wait(120);
    const body = d.getElementById("sheetBody");
    check("tool renders: " + t, body.textContent.length > 60, body.textContent.slice(0, 50));
  }
  // run one paradigm through the UI
  w.ANV.ui.openSheet("discover");
  await wait(80);
  const chip = d.querySelector("#sheetBody [data-paradigm]");
  check("paradigms are offered as buttons", !!chip);
  if (chip) {
    chip.click();
    await wait(700);
    check("a paradigm produces readable output", d.getElementById("toolOut").textContent.length > 40,
      d.getElementById("toolOut").textContent.slice(0, 60));
  }
  // investigate
  w.ANV.ui.openSheet("investigate");
  await wait(80);
  d.getElementById("invQ").value = expectIndex ? "groundwater depletion" : "UPI growth";
  d.getElementById("invGo").click();
  await wait(2200);
  check("the investigator writes a report", /Findings|Confidence/.test(d.getElementById("invOut").textContent),
    d.getElementById("invOut").textContent.slice(0, 60));
  d.getElementById("sheetClose").click();
  check("tools close", d.getElementById("sheet").hidden === true);

  console.log("\n-- keyboard and escape --");
  const esc = new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
  d.dispatchEvent(esc);
  check("escape is harmless when nothing is open", d.getElementById("sheet").hidden === true);

  console.log("\n-- engine switch --");
  if (expectIndex) {
    w.ANV.ui.setEngine("live");
    d.getElementById("q2").value = "india ai mission";
    d.getElementById("searchForm2").dispatchEvent(new w.Event("submit", { cancelable: true }));
    await wait(1800);
    check("live engine returns results", d.querySelectorAll("#cards .card").length > 0,
      "cards=" + d.querySelectorAll("#cards .card").length + " status=" + d.getElementById("status").textContent);
    check("live status names the collections", /collections|documents/.test(d.getElementById("status").textContent),
      d.getElementById("status").textContent);
    w.ANV.ui.setEngine("library");
    d.getElementById("q2").value = "UPI transaction growth";
    d.getElementById("searchForm2").dispatchEvent(new w.Event("submit", { cancelable: true }));
    await wait(900);
    check("library engine returns results", d.querySelectorAll("#cards .card").length > 0);
  } else {
    check("offline build has no live engine", !w.ANV.live || !w.ANV.live.SOURCES.length);
    check("offline build still offers the library", d.querySelectorAll(".engine").length === 3);
  }

  console.log("\n-- honesty --");
  if (expectIndex) {
    w.ANV.ui.setEngine("index");
    d.getElementById("q2").value = "zzzqqq flurbish nonsense";
    d.getElementById("searchForm2").dispatchEvent(new w.Event("submit", { cancelable: true }));
    await wait(1200);
    check("an empty search explains itself", /No results|nothing/i.test(d.getElementById("cards").textContent),
      d.getElementById("cards").textContent.slice(0, 60));
    check("it offers a way forward", !!d.getElementById("btnFallback"));
  } else {
    check("the offline build answers every search or explains itself",
      d.querySelectorAll("#cards .card").length > 0 || /No results/i.test(d.getElementById("cards").textContent));
  }

  check("no runtime errors during the whole run", errors.length === 0, errors.slice(0, 3).join(" | "));
  try { dom.window.close(); } catch (e) {}
}

(async () => {
  await suite("index.html", "online build", true);
  await suite("offline.html", "offline build", false);
  console.log("\n" + (fail ? "FAILED " + fail : "ALL PASS") + "  (" + pass + " passed, " + fail + " failed)");
  if (fail) { console.log("failures: " + failures.join(" | ")); process.exit(1); }
  process.exit(0);
})();
