# ANVESHAN · अन्वेषण — v6

**Live: https://swami-prathmesh.github.io/anveshan/**

A search engine with **its own crawled index**, running free on GitHub. A scheduled crawler builds a
sharded inverted index and commits it to this repository; the browser queries those static files
directly, with no server, no database and no account. Two more engines sit beside it: fifteen live
public APIs, and a verified 170-document library.

Open the link and type. Or open `index.html` from the repo — same engine.

---

## Three engines, one intelligence layer

| Engine | What it is | Freshness | Where |
| --- | --- | --- | --- |
| **Index** | its own crawled corpus, sharded and served as static files | every 6 hours (Actions) | default |
| **Live** | fifteen keyless public APIs queried at request time | at query time | `Live` button |
| **Library** | 170 curated documents with full verification | static | `Library` button |

The same verification, contradiction, discovery, investigator and learning code runs over all three.
That is the design decision that matters: coverage from the crawler, freshness from the federation,
depth from the library, and one honest evidence layer across them.

### Shard-and-fetch retrieval

The crawler splits its index into 64 term shards and 16 document shards. A browser computes
`fnv1a32(term) % 64` for its query terms and fetches **only those shards** — normally two or three
small files — scores them with BM25, then fetches one document shard for the winners and reranks with
an LSA space built on the spot.

The consequence: query cost is proportional to the query, not to the corpus, and the corpus can grow
to tens of thousands of documents while remaining a set of static files in git. Python and JavaScript
implement the same hash and the same stemmer, and the tests assert that parity — a mismatch would make
the browser fetch files that do not contain its terms.

Current index: **441 documents, 11,189 terms, 800 KB** (arXiv, Wikipedia English, Wikipedia Hindi,
Internet Archive), 2–4 shard fetches and single-digit-millisecond scoring per query.

## The "server"

GitHub cannot run a server, and this project does not pretend otherwise. What it does instead:

```
GitHub Actions (cron, free)  →  crawler → dedupe → index build → commit index/
                                                                       ↓
                                        GitHub Pages serves index/ as static files
                                                                       ↓
                                            browser fetches 2-4 shards, ranks, renders
```

`ops/crawl.yml` is that pipeline. GitHub blocks integrations from creating workflow files, so a human
copies it to `.github/workflows/crawl.yml` once — see `ops/README.md`. After that it runs every six
hours by itself, and public repositories do not pay for Actions minutes.

---

## The engine, in layers

| Layer | File | What it does |
| --- | --- | --- |
| crawler | `crawler/` | nine source adapters, robots.txt compliance, dedupe, index build, sharding |
| language | `src/engine/lang.js` | script detection, Devanagari ⇄ Latin transliteration, Hindi/Sanskrit stemmers, sandhi splitting |
| semantic | `src/engine/semantic.js` | compiled PPMI+SVD embeddings, char-n-gram vectors, trilingual lexicon, hybrid BM25F + dense |
| understanding | `src/engine/understand.js` | 12-intent classifier, multi-intent decomposition, disambiguation, conversation state, completion, expertise |
| evidence | `src/engine/evidence.js` | six-factor credibility, primacy, claims, cross-verification, contradictions, independence, half-life, lineage |
| discovery | `src/engine/discovery.js` | ten paradigms, gap matrix, hidden relations, recombination, consequences, forecasting |
| agent | `src/engine/agent.js` | bounded multi-round investigator, hypotheses, experiment design, reproducibility, failure registry |
| learning | `src/engine/learn.js` | click-trained LTR with an NDCG gate, corrections, versions, rollback, monitoring, memory, export |
| ingest | `src/engine/ingest.js` | PDF, DOCX, PPTX, XLSX, ODT, CSV, JSON, HTML, Markdown, ZIP parsed in the tab |
| ui | `src/engine/ui.js` | evidence strip per result, intelligence strip, six panels |
| live | `src/engine/live.js` | fifteen adapters, federation, politeness, per-query LSA, cross-source dedupe |
| live ui | `src/engine/live-ui.js` | live search flow, source chips, live brief, live drawer, Watch, Sources |
| **central** | `src/engine/central.js` | shard-and-fetch client: BM25 over the crawled index, no server |
| **central ui** | `src/engine/central-ui.js` | engine switcher, index status, index brief |

## Crawler

Nine adapters, each isolated so one failure cannot stop a run:

`feeds` (Nature, Science, Phys.org, arXiv RSS, MIT, NASA, The Hindu, Indian Express, PIB, World Bank,
WHO, Our World in Data) · `wikipedia` (12 languages) · `arxiv` · `openalex` · `crossref` ·
`internet_archive` · `wikisource` · `github` · `sitemap` (India Code, NITI Aayog, ISRO, RBI, arXiv,
PLOS)

Politeness is enforced, not promised: robots.txt is fetched and obeyed for every page, official APIs
are called under their own published policies (arXiv one request per three seconds; OpenAlex and
Crossref with a contact address; GitHub inside its unauthenticated limit), one request per host per
second by default, with retries and backoff.

```bash
python3 -m crawler.run --out index --budget 20 --per-source 200
python3 -m crawler.run --list
python3 -m crawler.run --sources arxiv,wikipedia --budget 5 --out /tmp/ix
```

The run writes `index/last-run.json` with per-source counts, timings and every adapter error. A source
that fails is named there; nothing is silently dropped.

## The self-learning property

1. A click is the only supervision signal. No click, no learning.
2. Pairwise logistic regression adjusts six ranking weights.
3. Candidate weights are adopted **only** if measured NDCG does not fall; otherwise discarded.
4. Every adoption is versioned; rollback restores the previous weights.
5. Learning changes which sources surface, never what a document says.

Learning lives in `localStorage`, not on a server, because there is no server. It is per device by
design, not by accident — pooling it would need a backend and a privacy design worth more care than a
free static page can give.

## Verification

Source reliability and claim truth are two different numbers and are never collapsed into one.
Credibility is six weighted factors, printed per result. Independence is checked at issuer level, so
two arms of one ministry count once. Figures are normalised across crore/lakh/million/billion before
comparison, and a difference across dates is a trajectory, not a conflict. Retraction flags come
straight from OpenAlex. A claim is "supported" only when an independent document says the same thing;
everything else is "unverified", which is the most common and most honest verdict.

## Capability audit

`Audit` in the app lists every property from the specification with the mechanism behind it. Nothing is
marked **live** unless the code does it and you can exercise it.

| Status | v5 | v6 | Meaning |
| --- | --- | --- | --- |
| live | 155 | 167 | runs here, exercisable |
| partial | 55 | 53 | runs with a stated limit |
| adapter | 0 | 0 | seam exists, connector needed |
| not possible here | 9 | 9 | needs servers, sensors, models or scale |

229 properties, 14 groups.

## Run, build, deploy

```bash
# use it
open index.html                     # the engine (index + live + library)
open offline.html                   # no network at all

# rebuild the page after editing src/
python3 tools/build.py --check      # writes index.html + offline.html, syntax-checks every block

# refresh the crawled index
python3 -m crawler.run --out index --budget 20
```

### Tests — 374 checks in eight suites

```bash
npm install                          # jsdom, for the DOM suites
node tools/test_engine.js            #  33  retrieval quality, language layer, latency
node tools/test_layers.js            # 119  understanding, evidence, discovery, agent, learning, ingest
node tools/test_ingest.js            #  21  real PDF / DOCX / XLSX / ZIP fixtures
node tools/test_live.js              #  38  federation, adapters, LSA, rate limits (network mocked)
node tools/test_central.js           #  36  the real sharded index, hash parity, shard economics
python3 tools/test_index.py          #  28  crawler, index format, dedupe, incremental update
node tools/test_dom.js               #  61  offline build driven in a DOM
node tools/test_online.js            #  38  online build driven in a DOM, all three engines
```

## Repository layout

```
index.html                 the engine (served by Pages)
offline.html               same engine, no network
index/                     the crawled, sharded index (committed by the crawler)
crawler/                   crawler: core, sources, index, run
src/engine/*.js            thirteen layers
src/data/model.js          compiled semantic model
src/data/v4_matrix.js      the capability audit
src/styles/v4.css          interface additions
tools/build.py             assembles both artefacts, syntax-checks every block
tools/build_model.py       compiles the corpus into the semantic model
tools/test_*.js|py         eight suites
ops/crawl.yml              the GitHub Actions pipeline
ops/README.md              how to activate it, index format, politeness policy
SPEC.md                    the engineering specification this build is judged against
```

## Honest limits

- **Not web-scale.** Tens of thousands of documents per run is what free compute carries. Google
  crawls billions of pages with a datacentre; this does not, and says so.
- **No audio or video understanding.** Needs codecs and models; transcripts are accepted instead.
- **No server-side personalisation.** No server exists. Learning is per device.
- **No uptime guarantee.** A static site plus public APIs has no SLA.
- **Index growth is bounded by the repository.** Around 50k documents the index reaches ~80 MB; past
  that this design needs sharding across repositories or an object store.

## Prior art

Nothing in the mathematics is invented here: BM25 and reciprocal rank fusion, PPMI and truncated SVD,
NDCG and learning-to-rank, SimHash deduplication, claim decomposition, provenance ledgers, half-life
staleness, and client-side sharded indexes. The novelty claimed is the assembly — one free static
deployment where a scheduled crawler, a live federation, a verified library, ten discovery paradigms,
an autonomous investigator and a gated learning loop share one inspectable state, and every number the
reader sees is traceable to the code that produced it.

## Licence

MIT — see `LICENSE`.
