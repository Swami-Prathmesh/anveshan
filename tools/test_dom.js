#!/usr/bin/env node
/* End-to-end smoke test of the built single-file app in a real DOM.
   Boots index.html in jsdom, then drives the interface the way a user would:
   search, open panels, run a paradigm, run the investigator, read the audit.
   This is what catches integration bugs that unit tests cannot see. */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push("jsdomError: " + e.message));
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  ok   " + name); }
  else { fail++; failures.push(name); console.log("  FAIL " + name + (detail ? "  -> " + detail : "")); }
}

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: "https://example.test/anveshan/",
  beforeParse(window) {
    // jsdom has no layout engine; these are the only things we stub
    window.scrollTo = () => {};
    // the Merkle ledger needs SubtleCrypto, which jsdom does not provide
    try {
      const { webcrypto } = require("crypto");
      Object.defineProperty(window, "crypto", { value: webcrypto, configurable: true, writable: true });
    } catch (e) {}
    try {
      const util = require("util");
      if (!window.TextEncoder) window.TextEncoder = util.TextEncoder;
      if (!window.TextDecoder) window.TextDecoder = util.TextDecoder;
    } catch (e) {}
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
    window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    // jsdom has no canvas backend; the aurora background only needs a context
    const noop = () => {};
    const fakeCtx = new Proxy({}, {
      get: (t, k) => {
        if (k === "canvas") return { width: 800, height: 600 };
        if (k === "createLinearGradient" || k === "createRadialGradient") return () => ({ addColorStop: noop });
        if (k === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
        if (k === "measureText") return () => ({ width: 10 });
        return typeof t[k] === "function" ? t[k] : noop;
      },
      set: () => true
    });
    window.HTMLCanvasElement.prototype.getContext = () => fakeCtx;
  }
});

const w = dom.window;
const d = w.document;

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  // give the boot chain (v3 postBoot + v4 boot poll) time to run
  for (let i = 0; i < 40 && !(w.ANV && w.ANV.ui && w.ANV.ui.ready); i++) await wait(100);

  console.log("\n== boot ==");
  check("engine booted", !!(w.ANV && w.ANV.ui && w.ANV.ui.ready));
  check("semantic model loaded", w.ANV.semantic.stats().vocab > 1000, JSON.stringify(w.ANV.semantic.stats()));
  check("index built", w.INDEX && w.INDEX.docs.length === 170, String(w.INDEX && w.INDEX.docs.length));
  check("search patched to hybrid", w.search.toString().includes("hybrid"));
  check("v4 stylesheet present", !!d.getElementById("v4-style"));
  check("nav buttons added", !!d.getElementById("navDiscover") && !!d.getElementById("navAudit"));
  for (let i = 0; i < 30 && !d.getElementById("navImport"); i++) await wait(200);
  const oldImp = d.getElementById("navImport");
  check("legacy nav present", !!oldImp);
  check("old import panel rebound", oldImp && oldImp.textContent === "Add files", oldImp && oldImp.textContent);
  const oldCaps = d.getElementById("navCaps");
  check("old capability panel rebound", oldCaps && oldCaps.textContent === "Audit", oldCaps && oldCaps.textContent);
  check("no boot errors", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log("\n== search flow ==");
  w.doSearch("india ai mission compute", true);
  await wait(120);
  const cards = d.querySelectorAll("#results .card");
  check("results rendered", cards.length > 0, String(cards.length));
  check("evidence strip on cards", !!d.querySelector("#results .v4-ev"), "no .v4-ev found");
  check("credibility chip present", !!d.querySelector("#results .v4-cred-strong, #results .v4-cred-fair, #results .v4-cred-weak, #results .v4-cred-poor"));
  check("intelligence bar injected", !!d.getElementById("v4bar"));
  check("intent shown in bar", /definition|quantitative|exploratory|general/.test(d.getElementById("v4bar").textContent));
  check("brief still renders", !!d.querySelector("#results .brief"));
  check("query logged", w.ANV.learn.queries().length >= 1, String(w.ANV.learn.queries().length));

  console.log("\n== follow-up context ==");
  w.doSearch("and in 2026?", true);
  await wait(120);
  check("follow-up rewritten", !!d.querySelector("#v4bar .v4-rewrite"), d.getElementById("v4bar") && d.getElementById("v4bar").textContent.slice(0, 120));

  console.log("\n== hindi query ==");
  w.doSearch("भुगतान प्रणाली", true);
  await wait(150);
  check("hindi query returns results", d.querySelectorAll("#results .card").length > 0);
  check("hindi query understood", /understood/.test(d.getElementById("v4bar").textContent));

  console.log("\n== panels ==");
  const panels = ["discover", "investigate", "verify", "learn", "files", "audit"];
  panels.forEach((p) => {
    errors.length = 0;
    try { w.openPanel(p); } catch (e) { errors.push(e.message); }
    const body = d.getElementById("panelBody");
    check("panel opens: " + p, d.getElementById("panel").classList.contains("on") && body.innerHTML.length > 100,
      body.innerHTML.slice(0, 80));
    check("panel clean: " + p, errors.length === 0, errors.slice(0, 2).join(" | "));
  });

  console.log("\n== discover paradigm run ==");
  w.openPanel("discover");
  await wait(200);
  const out = d.getElementById("v4disout");
  check("default paradigm computed", out && out.innerHTML.length > 200, out && out.innerHTML.slice(0, 100));
  const paradigmIds = w.ANV.discovery.PARADIGMS.map((p) => p.id);
  for (const id of paradigmIds) {
    w.ANV.ui.paradigm(id);
    await wait(160);
    const el = d.getElementById("v4disout");
    check("paradigm renders: " + id, el && el.innerHTML.length > 120 && !/failed on this subject/.test(el.innerHTML),
      el && el.innerHTML.slice(0, 120));
  }

  console.log("\n== investigator ==");
  w.openPanel("investigate");
  d.getElementById("v4invq").value = "how is India building sovereign AI compute";
  w.ANV.ui.investigate();
  await wait(900);
  const inv = d.getElementById("v4invout");
  check("dossier rendered", inv.innerHTML.includes("Findings") && inv.innerHTML.includes("Trace"), inv.innerHTML.slice(0, 120));
  check("dossier has confidence", /confidence/.test(inv.innerHTML));

  console.log("\n== verify panel with a live query ==");
  w.doSearch("UPI transactions npci", true);
  await wait(150);
  w.openPanel("verify");
  const vf = d.getElementById("panelBody").innerHTML;
  check("verify shows credibility table", vf.includes("Credibility, factor by factor"));
  check("verify shows contradiction lab", vf.includes("Contradiction laboratory"));
  check("verify shows uncertainty", vf.includes("Where certainty stops"));

  console.log("\n== learning loop ==");
  w.openPanel("learn");
  await wait(80);
  const lb = d.getElementById("v4learnout");
  check("learn panel renders weights", lb.innerHTML.includes("Ranking weights"));
  check("learn panel shows monitor", /zero-result rate/.test(lb.innerHTML));
  w.ANV.ui.setW("sem", "0.45");
  check("weight slider updates engine", w.ANV.learn.weights().sem === 0.45, String(w.ANV.learn.weights().sem));
  w.ANV.ui.snapshot();
  check("snapshot taken", w.ANV.learn.versions().length >= 1);
  w.ANV.ui.rollback("v1");
  check("rollback runs", true);

  console.log("\n== audit ==");
  w.openPanel("audit");
  await wait(80);
  const m = d.getElementById("v4matrix");
  const rows = m.querySelectorAll(".v4-mrow");
  check("matrix rendered", rows.length > 100, String(rows.length));
  check("matrix has status chips", m.querySelectorAll(".v4-chip").length > 100);
  w.ANV.ui.filterMatrix("live", null);
  const hidden = [...m.querySelectorAll(".v4-mrow")].filter((r) => r.style.display === "none").length;
  check("matrix filter hides non-live rows", hidden > 0, String(hidden));

  console.log("\n== ingest (text path) ==");
  w.openPanel("files");
  d.getElementById("v4paste").value = "The Ministry of Electronics published a new compute note. " +
    "It reports 45,000 GPUs available to startups at about Rs 61 per GPU hour, and targets 100,000 GPUs by 2028. ".repeat(3);
  const before = w.DOCS.length;
  w.ANV.ui.ingestText();
  await wait(200);
  check("pasted text indexed", w.DOCS.length > before, before + " -> " + w.DOCS.length);
  check("ingest reports result", /chunks indexed/.test(d.getElementById("v4fileout").innerHTML));
  w.doSearch("how many GPUs at what price", true);
  await wait(150);
  check("new document is retrievable", d.querySelectorAll("#results .card").length > 0);
  check("imported doc appears in results", /Your import/.test(d.querySelector("#results").textContent), "not found");

  console.log("\n== runtime health ==");
  const hard = errors.filter((e) => !/Not implemented|Could not parse CSS|css/i.test(e));
  check("no runtime errors during the whole run", hard.length === 0, hard.slice(0, 3).join(" | "));

  console.log("\n" + (fail ? "FAILED " + fail : "ALL PASS") + "  (" + pass + " passed, " + fail + " failed)");
  try { dom.window.close(); } catch (e) {}
  if (fail) { console.log("failures: " + failures.join(" | ")); process.exit(1); }
  process.exit(0);
})();
