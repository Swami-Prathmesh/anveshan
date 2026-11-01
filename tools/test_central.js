#!/usr/bin/env node
/* Tests for the central index client: it must query a real sharded index built by
   the Python crawler, with no server, and agree with the crawler on every hash
   and stem. The fetch shim reads the shards from disk. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DIR = "/tmp/anv-fixture";

let pass = 0, fail = 0; const failures = [];
function check(n, ok, d) {
  if (ok) { pass++; console.log("  ok   " + n); }
  else { fail++; failures.push(n); console.log("  FAIL " + n + (d ? "  -> " + d : "")); }
}

console.log("\n== building a fixture index with the python crawler ==");
fs.rmSync(DIR, { recursive: true, force: true });
const pyOut = execFileSync("python3", [path.join(ROOT, "tools/test_index.py"), "--out", DIR], { encoding: "utf8" });
check("crawler built the fixture", fs.existsSync(path.join(DIR, "manifest.json")), pyOut.split("\n").slice(-2).join(" "));

const fetched = [];
const ctx = {
  console, performance: { now: () => Number(process.hrtime.bigint()) / 1e6 },
  TextEncoder, TextDecoder, Math, JSON, Date, Promise, Buffer,
  atob: (b) => Buffer.from(b, "base64").toString("binary"),
  fetch: async (url) => {
    fetched.push(String(url));
    const rel = String(url).replace(/^index\//, "");
    const file = path.join(DIR, rel);
    if (!fs.existsSync(file)) return { ok: false, status: 404, text: async () => "" };
    const body = fs.readFileSync(file, "utf8");
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  }
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
run("src/engine/live.js");       // localSpace is reused for semantic reranking
run("src/engine/central.js");
const C = ctx.ANV.central, LANG = ctx.ANV.lang;

(async () => {
  console.log("\n== manifest ==");
  const man = await C.load("index/");
  check("manifest loads", !!man && man.docs > 0, JSON.stringify(man && { docs: man.docs }));
  check("manifest reports terms", man.terms > 50, String(man.terms));
  check("manifest reports a build time", /^\d{4}-\d{2}-\d{2}T/.test(man.builtAt), man.builtAt);
  check("manifest lists sources", Object.keys(man.sources).length > 0);
  check("manifest records run history", Array.isArray(man.runs) && man.runs.length > 0);
  check("client knows the corpus size", C.info().docs === man.docs);

  console.log("\n== hash parity with the crawler ==");
  const pyStems = JSON.parse(fs.readFileSync(path.join(DIR, "stems.json"), "utf8"));
  const mismatched = Object.keys(pyStems).filter((w) => LANG.stem(w) !== pyStems[w]);
  check("stemmer agrees with python on every fixture word", mismatched.length === 0,
    mismatched.map((w) => `${w}: js=${LANG.stem(w)} py=${pyStems[w]}`).join(", "));
  // the shard the client computes must be the shard the crawler wrote
  const probe = ["aadhaar", "quantum", "photovoltaic", "mansabdar", "groundwater"];
  let shardOk = true, shardDetail = "";
  for (const term of probe) {
    const s = C.shardOf(term);
    const file = path.join(DIR, "t", s + ".json");
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!payload[term]) { shardOk = false; shardDetail += `${term}->shard${s} missing; `; }
  }
  check("client and crawler agree on term shards", shardOk, shardDetail);

  console.log("\n== retrieval ==");
  const cases = [
    ["UPI transaction growth", "upi"],
    ["Aadhaar eKYC authentication", "aadhaar"],
    ["retrieval augmented generation grounding", "rag"],
    ["quantum error correction surface code", "quantum"],
    ["groundwater depletion wells", "water"],
    ["Mughal mansabdar revenue", "mughal"],
    ["Bhashini language translation", "bhashini"],
    ["solar photovoltaic efficiency", "solar"]
  ];
  let hits = 0, mrr = 0;
  for (const [q, expect] of cases) {
    const out = await C.search(q, { limit: 8 });
    const rank = out.results.findIndex((r) => String(r.doc.u).includes(expect));
    if (rank === 0) hits++;
    if (rank >= 0) mrr += 1 / (rank + 1);
    console.log(`    ${rank >= 0 ? "hit " : "MISS"} rank=${rank + 1}  ${q}`);
    check("query returns results: " + q.slice(0, 28), out.results.length > 0, String(out.results.length));
  }
  check("precision@1 >= 0.75", hits / cases.length >= 0.75, (hits / cases.length).toFixed(2));
  check("MRR >= 0.8", mrr / cases.length >= 0.8, (mrr / cases.length).toFixed(3));

  console.log("\n== shard economics (the point of the design) ==");
  fetched.length = 0;
  const one = await C.search("groundwater depletion in the Thar region", { limit: 10 });
  const termFetches = fetched.filter((u) => u.includes("/t/")).length;
  check("a query fetches only a few term shards", termFetches <= 6, String(termFetches));
  check("it does not fetch the whole index", termFetches < 20, String(termFetches));
  check("meta reports the shards the query needs", one.meta.shards >= 1 && one.meta.shards <= 6, String(one.meta.shards));
  check("never fetches more shards than the query needs", termFetches <= one.meta.shards, `${termFetches} > ${one.meta.shards}`);
  check("meta reports corpus size", one.meta.corpus === man.docs);
  check("meta reports latency", one.meta.ms >= 0, String(one.meta.ms));

  const before = C.stats().cacheHits;
  await C.search("groundwater depletion in the Thar region", { limit: 10 });
  check("a repeated query is served from cache", C.stats().cacheHits > before);

  console.log("\n== result quality ==");
  const res = (await C.search("groundwater depletion wells survey", { limit: 5 })).results;
  check("results carry a url", res.every((r) => r.doc.u));
  check("results carry a date", res.every((r) => r.doc.d));
  check("results carry authority", res.every((r) => r.doc.a >= 1));
  check("results carry an explainable score", res.every((r) => r.why && r.why.lexical >= 0));
  check("results carry a snippet", res.every((r) => r.snippet && r.snippet.length > 20));
  check("scores are ordered", res.every((r, i, a) => i === 0 || a[i - 1].score >= r.score));
  check("title terms are boosted", (await C.search("Groundwater depletion", { limit: 3 })).results[0].doc.t.toLowerCase().includes("groundwater"));

  console.log("\n== honesty under failure ==");
  const empty = await C.search("zzzqqq flurbish nonsense", { limit: 5 });
  check("an unknown query returns nothing, cleanly", empty.results.length === 0);
  check("it still reports what it did", empty.meta && empty.meta.terms.length > 0);
  ctx.fetch = async () => ({ ok: false, status: 404, text: async () => "" });
  C.reset();
  let threw = null;
  try { await C.load("missing/"); } catch (e) { threw = e.message; }
  check("a missing index fails loudly", !!threw && /no central index/.test(threw), threw);

  console.log("\n" + (fail ? "FAILED " + fail : "ALL PASS") + "  (" + pass + " passed, " + fail + " failed)");
  if (fail) { console.log("failures: " + failures.join(" | ")); process.exit(1); }
  process.exit(0);
})();
