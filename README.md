# ANVESHAN · अन्वेषण — v5, online

**Live: https://swami-prathmesh.github.io/anveshan/**

A free, open-source research engine that runs in your browser. It searches fifteen open
collections live, then applies semantic ranking, claim verification, contradiction detection, ten
discovery paradigms, an autonomous investigator and a learning loop to what comes back. No account,
no API key, no server, no tracking.

Open the link and type. Or open `index.html` from this repo — same engine, same result.

---

## What "online" means here, precisely

This is not a central crawl. A crawl needs crawlers, storage, bandwidth and a budget; a static page
has none of those, and pretending otherwise would be the dishonest version of this project.

So the engine federates instead. One query goes out to fifteen free, keyless, cross-origin APIs at
the same time, each of which already indexed its own corner of the world:

| Source | What it contributes | Group |
| --- | --- | --- |
| Wikipedia (en, hi, sa, bn, ta, te, mr, gu, kn, ml, pa, ur) | encyclopaedia articles, with intro text and cross-language links | encyclopaedia |
| Wikidata | entities, labels, descriptions, aliases | knowledge graph |
| OpenAlex | 250M+ scholarly works, citation counts, open-access links, retraction flags | peer-reviewed |
| Crossref | DOI registry: publisher, type, licence, citations | peer-reviewed |
| Semantic Scholar | abstracts and citation context | peer-reviewed |
| Open Library | books, authors, editions | books |
| Internet Archive | scanned texts, manuscripts, historical records | archives |
| Wikisource | primary texts: treaties, speeches, classical documents | archives |
| Stack Exchange | technical questions and accepted answers | community |
| GitHub | repositories, topics, licences | code |
| Openverse | openly licensed images and audio | media |
| OpenStreetMap | places, coordinates, administrative context | place |
| Open-Meteo | live weather measurements | live measurement |
| USGS | live seismic measurements | live measurement |
| World Bank | official country indicators | official statistics |

Because every result is fetched at query time, the index cannot go stale — a paper published this
morning is findable this morning.

**Honest limits.** Each API has a fair-use rate limit, so "unlimited" is not something this page can
promise and you should not believe any page that does. The engine stays polite on your behalf:
per-source minimum intervals, one retry, eight-second timeouts and a ten-minute cache. A source that
fails is shown as failed, with its error, rather than quietly dropped.

---

## The engine, in layers

```
user  →  intent + context + plan
          ↓
   fifteen live adapters  ──┐        (browser → public APIs, no proxy)
          ↓                 │
   normalise → dedupe → rank ┘
          ↓
   per-query semantic space (LSA over the fetched set)
          ↓
   evidence: credibility · contradiction · independence · retraction
          ↓
   discovery: 10 paradigms · gaps · forecast · hidden relations
          ↓
   investigator: multi-round trace, hypotheses, experiments
          ↓
   learning loop: clicks → weights → NDCG gate → version or rollback
```

| Layer | File | What it does |
| --- | --- | --- |
| language | `src/engine/lang.js` | script detection, Devanagari ⇄ Latin transliteration, Hindi/Sanskrit stemmers, sandhi splitting |
| semantic | `src/engine/semantic.js` | compiled PPMI+SVD embeddings, char-n-gram vectors, trilingual lexicon, hybrid BM25F + dense |
| understanding | `src/engine/understand.js` | 12-intent classifier, multi-intent decomposition, disambiguation, conversation state, completion, expertise |
| evidence | `src/engine/evidence.js` | six-factor credibility, primacy, claims, cross-verification, contradictions, independence, half-life, lineage |
| discovery | `src/engine/discovery.js` | ten paradigms, gap matrix, hidden relations, recombination, consequences, forecasting |
| agent | `src/engine/agent.js` | bounded multi-round investigator, hypotheses, experiment design, reproducibility, failure registry |
| learning | `src/engine/learn.js` | click-trained LTR with an NDCG gate, corrections, versions, rollback, monitoring, memory, export |
| ingest | `src/engine/ingest.js` | PDF, DOCX, PPTX, XLSX, ODT, CSV, JSON, HTML, Markdown, ZIP parsed in the tab |
| ui | `src/engine/ui.js` | evidence strip per result, intelligence strip, six panels |
| **live** | `src/engine/live.js` | the fifteen adapters, federation, politeness, per-query LSA, cross-source dedupe, live ranking |
| **live ui** | `src/engine/live-ui.js` | live search flow, source chips, live brief, live drawer, Watch, Sources |

### Why a per-query semantic space

The compiled model knows the vocabulary of the built-in library, not the live web's. So for each
result set the engine builds a small semantic space on the spot: a tf-idf document matrix, a
truncated SVD by power iteration on the document Gram matrix (cheap because the Gram matrix is
80×80, not 4000×4000), term vectors from MᵀU, and query expansion inside that space. It is LSA over
exactly the evidence available at that moment, and it adapts to what was actually fetched.

---

## The self-learning property

Learning is real, gated and reversible:

1. A click is the only supervision signal. No click, no learning.
2. Pairwise logistic regression adjusts six ranking weights (lexical, semantic, authority,
   credibility, freshness, corrections).
3. The candidate weights are adopted **only** if measured NDCG does not fall. Otherwise they are
   discarded and the old ones stay.
4. Every adoption is versioned; rollback restores the previous weights.
5. Learning changes which sources surface. It never changes what a document says.

Learning lives in your browser's `localStorage`, not on a server, because there is no server. That
means your learning is yours alone — it does not pool across users. Pooling would need a backend and
a privacy design worth more care than a free static page can give it, and pretending otherwise would
be the usual privacy theatre.

---

## Verification

Source reliability and claim truth are two different numbers here and are never collapsed into one.
Credibility is six weighted factors, printed per result. Independence is checked at issuer level, so
two arms of one ministry count once. Figures are normalised across crore/lakh/million/billion before
comparison, and a difference across dates is called a trajectory, not a conflict. Retraction flags
come straight from OpenAlex. A claim is "supported" only when an independent document says the same
thing; everything else is "unverified", which is the most common and most honest verdict.

## The ten paradigms

Unknown · Possibility · Causal · Lost knowledge · Anomaly · Interdisciplinary · Reality · Simulation ·
Temporal · Evolutionary — each computed over the current result set (live or library), each printing
the basis it was computed from.

---

## Capability audit

`Audit` in the app lists every property from the specification with the mechanism behind it, and the
rule is: nothing is marked **live** unless the code does it and you can exercise it.

| Status | v4 (offline) | v5 (online) | Meaning |
| --- | --- | --- | --- |
| live | 140 | **155** | runs here, exercisable |
| partial | 49 | 55 | runs with a stated limit |
| adapter | 5 | 0 | seam exists, connector needed |
| not possible here | 14 | 9 | needs servers, sensors, models or scale |

219 properties, 13 groups, re-checked line by line against the code.

---

## Run, build, deploy

```bash
# just use it
open index.html                     # online engine (needs a network)
open offline.html                   # same engine, no network, 170 built-in sources

# rebuild after editing anything in src/
python3 tools/build.py --check      # writes index.html + offline.html, syntax-checks every block

# tests
npm install                         # jsdom, for the DOM suites
node tools/test_engine.js           # 33  retrieval quality, language layer, latency
node tools/test_layers.js           # 119 understanding, evidence, discovery, agent, learning, ingest
node tools/test_ingest.js           # 21  real PDF / DOCX / XLSX / ZIP fixtures
node tools/test_live.js             # 35  federation, adapters, LSA space, failures (network mocked)
node tools/test_dom.js              # 61  offline build driven in a DOM
node tools/test_online.js           # 26  online build driven in a DOM (network mocked)
```

295 checks. Deployment is GitHub Pages on `main` — push and it is live, because there is nothing to
deploy but a file.

### Adding a source

A source is about twenty lines. In `src/engine/live.js` add to `SOURCES`:

```js
{ id: "mysource", label: "My Source", group: "dataset", ty: "dataset", a: 4, minGap: 500,
  note: "what it contributes",
  async search(q, ctx) {
    const data = await getJSON("mysource", "https://api.example.org/search?q=" + encodeURIComponent(q));
    return (data.items || []).map(it => ({
      id: "ms-" + it.id, t: it.title, s: "My Source", o: it.publisher,
      ty: "dataset", y: it.year, d: it.date, u: it.url, l: "en", a: 4,
      k: [], b: it.summary, e: [], live: { source: "mysource" }
    }));
  } }
```

Then `python3 tools/build.py --check`. The source must send CORS headers, must not need a key, and
must tolerate being called from a browser.

---

## Repository layout

```
index.html                 online engine (GitHub Pages serves this)
offline.html               same engine with no network
src/base/index-v3.html     the v3 file this build extends
src/engine/*.js            eleven layers
src/data/model.js          compiled semantic model
src/data/v4_matrix.js      the capability audit
src/styles/v4.css          interface additions
tools/build_model.py       compiles the corpus into the semantic model
tools/build.py             assembles both artefacts and syntax-checks every block
tools/test_*.js            six suites
fixtures/                  real files the ingest tests read
corpus.json                the 170-document library, extracted
```

---

## Prior art and what is actually new

Nothing in the mathematics is invented here: BM25 and reciprocal rank fusion, PPMI and truncated SVD,
NDCG and learning-to-rank, claim decomposition, provenance ledgers, half-life staleness. The
novelty claimed is only the assembly — one free static file where live federated retrieval,
verification, discovery paradigms, prediction and a gated learning loop share a single inspectable
state, and where every number the reader sees can be traced to the code that produced it.

## Licence

MIT. Fork it, host it, change it, sell nothing — see `LICENSE`.
