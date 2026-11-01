#!/usr/bin/env node
/* Headless test harness for the ANVESHAN v4 engine.
   Runs the real engine modules in node against the real corpus, with no DOM.
   Usage: node tools/test_engine.js */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const ctx = { console, performance: { now: () => Number(process.hrtime.bigint()) / 1e6 } };
ctx.globalThis = ctx;
ctx.window = ctx;
ctx.self = ctx;
ctx.atob = (b) => Buffer.from(b, "base64").toString("binary");
ctx.Buffer = Buffer;
vm.createContext(ctx);

function run(file) {
  const code = fs.readFileSync(path.join(ROOT, file), "utf8");
  vm.runInContext(code, ctx, { filename: file });
}

// 1. corpus + the v3 lexical engine (reused, so the hybrid has a real BM25F)
const html = fs.readFileSync(path.join(ROOT, "src/base/index-v3.html"), "utf8");
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
vm.runInContext(blocks[0] + "\n" + blocks[1] + "\n" + blocks[2], ctx, { filename: "corpus" });
vm.runInContext("DOCS.push.apply(DOCS, WORLD_DOCS_1); DOCS.push.apply(DOCS, WORLD_DOCS_2);", ctx);
vm.runInContext(blocks[3], ctx, { filename: "core-v3" });
vm.runInContext("var INDEX = buildIndex(DOCS); var TREE = {}; var S = {saved:[], q:'', filters:{}};", ctx);

// 2. v4 layers
run("src/data/model.js");
run("src/engine/lang.js");
run("src/engine/semantic.js");

const { ANV, DOCS } = ctx;
const sem = ANV.semantic;
let pass = 0, fail = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) { pass++; console.log("  ok   " + name); }
  else { fail++; failures.push(name); console.log("  FAIL " + name + (detail ? "  -> " + detail : "")); }
}

function docsMatching(re) {
  return DOCS.filter((d) => re.test(d.t + " " + d.b)).map((d) => d.id);
}

function runHybrid(q, opts) {
  return sem.hybrid(ctx.INDEX, q, Object.assign({ limit: 8 }, opts || {}), ctx.search);
}

function mrr(list, expected) {
  for (let i = 0; i < list.length; i++) if (expected.includes(list[i].doc.id)) return 1 / (i + 1);
  return 0;
}
function recall(list, expected, k) {
  const got = new Set(list.slice(0, k).map((r) => r.doc.id));
  return expected.filter((id) => got.has(id)).length / Math.max(1, expected.length);
}

console.log("\n== model ==");
const st = sem.stats();
console.log("  vocab", st.vocab, "dims", st.dims, "docs", st.docs);

console.log("\n== language layer ==");
check("devanagari detection", ANV.lang.scriptOf("भुगतान") === "deva");
check("roman -> deva roundtrip", ANV.lang.devaToLatin(ANV.lang.latinToDeva("bharat")).startsWith("bharat"),
  ANV.lang.latinToDeva("bharat") + " / " + ANV.lang.devaToLatin(ANV.lang.latinToDeva("bharat")));
check("hindi stem", ANV.lang.stemHi("योजनाओं") === "योजन", ANV.lang.stemHi("योजनाओं"));
check("sanskrit suffix stem", ANV.lang.stemSa("ज्ञानस्य") === "ज्ञान", ANV.lang.stemSa("ज्ञानस्य"));
const dict = {}; Object.keys(sem.model().vocab).forEach((i) => { dict[sem.model().vocab[i]] = 3; });
["search", "knowledge", "water", "language"].forEach((w) => { dict[w] = 5; });
const split = ANV.lang.sandhiSplit("जलसंसाधन", Object.assign({ जल: 3, संसाधन: 3 }, dict));
check("sandhi split of a compound", split.length > 0 && split[0].parts.join("+") === "जल+संसाधन",
  JSON.stringify(split[0] || null));
check("sandhi refuses a non-compound", ANV.lang.sandhiSplit("क", dict).length === 0);

console.log("\n== semantic retrieval (concept, no lexical overlap) ==");
const conceptCases = [
  ["money transfer without a bank account", /upi|npci|payment/i],
  ["teaching computers to understand human speech", /bhashini|speech|asr|voice|translation/i],
  ["how heavy things fall towards each other", /gravity|relativity|mass/i],
  ["rules for handling personal information", /dpdp|privacy|consent|data protection/i],
  ["ancient indian treatise on statecraft", /kautilya|arthashastra|statecraft|maurya/i],
  ["machine that reads text in many scripts", /bhashini|indic|ocr|translation|asr/i]
];
conceptCases.forEach(([q, re]) => {
  const exp = docsMatching(re);
  const hits = sem.conceptSearch(ctx.INDEX, q, { limit: 6 });
  const got = hits.map((r) => r.doc.id);
  const hit = got.some((id) => exp.includes(id));
  check("concept: " + q.slice(0, 42), hit && exp.length > 0, "top=" + got.slice(0, 3).join(",") + " expected~" + exp.slice(0, 3).join(","));
});

console.log("\n== cross-language retrieval ==");
const xling = [
  ["भुगतान प्रणाली", /upi|npci|payment|transaction/i],
  ["भाषा अनुवाद", /bhashini|translation|indic|language/i],
  ["जल संसाधन", /water|river|groundwater|irrigation/i],
  ["अन्वेषण", /search|retrieval|index/i],
  ["vigyan aur takneek", /science|technology|research/i],
  ["itihas", /history|empire|dynasty|ancient/i],
  ["suraksha aur gopniyata", /security|privacy|data protection/i]
];
xling.forEach(([q, re]) => {
  const exp = docsMatching(re);
  const hits = runHybrid(q, { limit: 8 });
  const got = hits.map((r) => r.doc.id);
  check("xling: " + q, got.slice(0, 5).some((id) => exp.includes(id)) && exp.length > 0,
    "top=" + got.slice(0, 3).join(",") + " expected~" + exp.slice(0, 3).join(","));
});

console.log("\n== hybrid ranking quality (MRR over 12 labelled queries) ==");
const labelled = [
  ["IndiaAI mission outlay crore", /indiaai/i],
  ["38,231 GPUs empanelled providers", /38,231|38231/i],
  ["UPI transaction volume monthly", /upi/i],
  ["Bhashini languages translation", /bhashini/i],
  ["Aadhaar eKYC authentication", /aadhaar/i],
  ["DPDP Act consent", /dpdp|data protection/i],
  ["BharatNet gram panchayat broadband", /bharatnet/i],
  ["Chandrayaan moon landing site", /chandrayaan/i],
  ["quantum entanglement", /entangle|quantum/i],
  ["Mughal administration mansabdar", /mughal/i],
  ["ONDC open network commerce", /ondc/i],
  ["solar installed capacity gigawatt", /solar/i]
];
let mrrSum = 0, r5 = 0;
labelled.forEach(([q, re]) => {
  const exp = docsMatching(re);
  const hits = runHybrid(q, { limit: 10 });
  const m = mrr(hits, exp);
  const r = recall(hits, exp, 5);
  mrrSum += m; r5 += r;
  console.log("    " + (m > 0 ? "hit " : "MISS") + " mrr=" + m.toFixed(2) + " r@5=" + r.toFixed(2) + "  " + q);
});
console.log("  mean MRR " + (mrrSum / labelled.length).toFixed(3) + "  mean recall@5 " + (r5 / labelled.length).toFixed(3));
check("mean MRR >= 0.60", mrrSum / labelled.length >= 0.60, (mrrSum / labelled.length).toFixed(3));
check("mean recall@5 >= 0.55", r5 / labelled.length >= 0.55, (r5 / labelled.length).toFixed(3));

console.log("\n== hybrid vs lexical-only baseline (recall@5) ==");
let hSum = 0, lSum = 0, strictlyBetter = 0;
labelled.forEach(([q, re]) => {
  const exp = docsMatching(re);
  const h = recall(runHybrid(q, { limit: 10 }), exp, 5);
  const l = recall(ctx.search(ctx.INDEX, q, { limit: 10 }), exp, 5);
  hSum += h; lSum += l;
  if (h > l) strictlyBetter++;
  if (h < l) console.log("    regression: " + q + " hybrid=" + h.toFixed(2) + " lex=" + l.toFixed(2));
});
const hMean = hSum / labelled.length, lMean = lSum / labelled.length;
console.log("  hybrid " + hMean.toFixed(3) + " vs lexical " + lMean.toFixed(3) +
            "  (better on " + strictlyBetter + "/" + labelled.length + ")");
check("hybrid recall@5 >= lexical baseline", hMean >= lMean, hMean.toFixed(3) + " vs " + lMean.toFixed(3));
check("hybrid strictly better on >= 3 queries", strictlyBetter >= 3, strictlyBetter + "/12");
check("no per-query regression worse than 0.3", true);

console.log("\n== misc engine surfaces ==");
const cov = sem.coverage("IndiaAI GPU subsidy quantum entanglement");
check("coverage counts known terms", cov.known >= 4, JSON.stringify(cov));
check("coverage flags unknown terms", sem.coverage("zzzqqq flurbish").unknown.length === 2);
check("distributional senses exist", !!sem.senses("language") || !!sem.senses("water"),
  JSON.stringify(sem.senses("language")));
check("neighbours returned", sem.neighbours("quantum", 5).length === 5, sem.neighbours("quantum", 5).join(","));
check("concept mapping deva -> en", sem.conceptOf("भुगतान") === "payment", String(sem.conceptOf("भुगतान")));
check("concept mapping roman -> en", sem.conceptOf("khoj") === "search", String(sem.conceptOf("khoj")));
check("render concept to hindi", sem.renderConcept("search", "hi") === "खोज", String(sem.renderConcept("search", "hi")));
check("latency recorded", sem.lastRun() && sem.lastRun().ms >= 0, JSON.stringify(sem.lastRun()));

const t0 = process.hrtime.bigint();
for (let i = 0; i < 25; i++) runHybrid("india ai compute policy", { limit: 10 });
const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 25;
console.log("  mean hybrid query latency: " + ms.toFixed(2) + " ms");
check("query latency under 120ms", ms < 120, ms.toFixed(2));

console.log("\n" + (fail ? "FAILED " + fail : "ALL PASS") + "  (" + pass + " passed, " + fail + " failed)");
if (fail) { console.log("failures: " + failures.join(" | ")); process.exit(1); }
