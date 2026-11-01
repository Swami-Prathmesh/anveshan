# ANVESHAN · अन्वेषण — v4

A research and discovery engine that runs entirely in one HTML file: **170 indexed sources**,
a compiled semantic model, claim-level verification, ten discovery paradigms, an autonomous
investigator and a learning loop that has to prove an improvement before it is allowed to change
anything.

**Live: https://swami-prathmesh.github.io/anveshan/**

Open `index.html` in any modern browser. No server, no build step, no network call, no account.

---

## What v4 adds

v3 was a lexical engine with good provenance. v4 keeps all of that and gives it the parts the
specification asked for that a static page can actually carry:

| Layer | What it does |
| --- | --- |
| `lang` | Script detection, Devanagari ⇄ Latin transliteration both ways, Hindi and Sanskrit stemmers, sandhi-aware compound splitting, multilingual stopwords |
| `semantic` | 72-dimension distributional embeddings compiled offline (PPMI → randomised SVD), character-n-gram vectors for unseen words, a 190-concept trilingual lexicon, hybrid retrieval |
| `understand` | 12-intent classifier with answer types, multi-intent decomposition, disambiguation over distributional senses, conversation state with pronoun resolution, query completion, expertise adaptation |
| `evidence` | Six-factor credibility, primary/secondary/archival classification, claim extraction, cross-verification, contradiction lab, issuer independence, unit normalisation, per-type half-life, truth decomposition, claim lineage |
| `discovery` | The ten paradigms, gap matrix, hidden relations, recombination, analogies, consequence walks, forecasting with intervals, emerging-term detection |
| `agent` | Bounded multi-round investigator with a full trace, hypothesis generation, experiment design, reproducibility checks, predicted-versus-observed, failed-hypothesis registry |
| `learn` | Click-trained learning-to-rank with an NDCG gate, corrections, version snapshots and rollback, monitoring, consent-gated memory, one-file export |
| `ingest` | PDF, DOCX, PPTX, XLSX, ODT, CSV, TSV, JSON, HTML, Markdown, text and ZIP parsed in the tab |
| `ui` | Six new panels plus an intelligence strip and an evidence strip on every result |

### Retrieval, measured

The semantic half is not decoration. On twelve labelled queries over the real corpus:

| | mean MRR | mean recall@5 |
| --- | --- | --- |
| v3 lexical only (BM25F + TF-IDF cosine) | 1.000 | 0.651 |
| v4 hybrid (BM25F + dense + fusion) | 1.000 | **0.824** |

MRR saturates at 1.000 for both, because the labelled set is small and every query has an obvious
top document. Recall@5 is the number that moves: the hybrid finds more of the relevant documents in
the first five. It is better on 7 of the 12 queries and worse on none. Mean query latency is 3–8 ms
for 170 documents, measured in the page and printed in the intelligence strip.

The gains come from three specific things, each of which is a place a lexical engine fails:
a paraphrase with no shared vocabulary ("money transfer without a bank account" → UPI documents),
a Hindi or Sanskrit query against English sources (भुगतान → payment → NPCI), and an unseen word
("subsidy" when the corpus only says "subsidised"). The one thing hybrid must not break is an
exact identifier, so low-frequency query terms get an explicit bonus — without it, adding the
semantic half made "Chandrayaan" *worse*, which the test suite now catches.

---

## The capability audit

`Audit` in the app lists every property in the specification with the mechanism behind it.
The rule for the file is simple: nothing is marked **live** unless the code in this build does it
and you can exercise it from the interface.

| Status | v3 | v4 | Meaning |
| --- | --- | --- | --- |
| live | 89 | **140** | the code exists here and runs |
| partial | 55 | 49 | implemented with a stated limit |
| adapter | 6 | 5 | the seam exists; a connector would light it up |
| not possible here | 22 | 14 | needs servers, sensors, models or scale a static page cannot have |

208 properties, 12 groups, re-audited line by line against the new code rather than carried over.

---

## The ten paradigms

Each is a computation over this library, not a description of one. `Discover` runs any of them on
any subject:

| Paradigm | The question it answers |
| --- | --- |
| Unknown | Which facets have no evidence, and which entities are never discussed together? |
| Possibility | What conditional statements and quantified trajectories exist, with what assumptions? |
| Causal | Which mechanisms are actually asserted, as opposed to co-mentioned? |
| Lost knowledge | What is relevant but buried by low connectivity or a single source? |
| Anomaly | Which figures sit far from the median of their own unit family? |
| Interdisciplinary | Which other disciplines cover this, and what is the structural analogue? |
| Reality | What was measured, as opposed to targeted or forecast? |
| Simulation | What does a linear fit say, with what prediction interval? |
| Temporal | What existed at a chosen date, and how did the terminology move? |
| Evolutionary | Can the engine demonstrate that it improved, on a fixed battery? |

---

## Verification, in one paragraph per idea

A source's reliability and a claim's truth are two different numbers here and are never collapsed
into one. Credibility is six weighted factors, printed. Independence is checked at the level of the
*issuer family*, so two arms of one ministry count once. Figures are normalised across crore, lakh,
million and billion before comparison, and a difference across dates is called a trajectory rather
than a conflict. A claim is only "supported" when an independent document says the same thing; the
rest are "unverified", which is the most common and most honest verdict. Manipulation markers,
unmatched attributions, circular citation and figures that do not share a scale are surfaced
separately, because each is a different kind of problem.

## Learning, with a gate

Clicks are the only supervision signal. Pairwise logistic regression adjusts six ranking weights,
and the result is adopted **only** if measured NDCG does not fall; otherwise it is discarded and the
old weights stay. Every adoption is versioned and reversible. Learning changes which sources
surface. It never changes what a document says, and it is off until you allow it.

---

## Repository layout

```
index.html                 the built engine (this is what GitHub Pages serves)
src/base/index-v3.html     the v3 single-file engine this build extends
src/engine/*.js            the nine v4 layers
src/data/model.js          compiled semantic model (embeddings, senses, gazetteer, lexicon)
src/data/v4_matrix.js      the capability audit
src/styles/v4.css          interface additions
tools/build_model.py       compiles the corpus into the semantic model
tools/build.py             assembles index.html and syntax-checks every block
tools/test_engine.js       retrieval quality, language layer, latency
tools/test_layers.js       understanding, evidence, discovery, agent, learning, ingest
tools/test_ingest.js       real PDF / DOCX / XLSX / ZIP fixtures
tools/test_dom.js          boots the built page in a DOM and drives the interface
fixtures/                  real files the ingest tests read
```

Rebuild after editing anything under `src/`:

```bash
python3 tools/build_model.py corpus.json src/data/model.js   # only if the corpus changes
python3 tools/build.py --check                               # assemble + syntax check
```

### Tests

```bash
node tools/test_engine.js    # 33 checks: MRR, recall, cross-language, latency
node tools/test_layers.js    # 119 checks: every layer
node tools/test_ingest.js    # 21 checks: real documents
node tools/test_dom.js       # 61 checks: the built page, driven like a user
```

234 checks. `test_dom.js` needs `npm install jsdom@24` (jsdom 29 pulls a WASM parser that some
sandboxes cannot instantiate).

---

## Honest scope

170 documents is a curated research library, not the web. Google indexes hundreds of billions of
pages and crawls continuously; no browser-resident engine can match that, and this one does not
pretend to. Live crawling, general machine translation, OCR, audio and video understanding, and
scale beyond one tab are marked `adapter` or `not possible here` in the audit, each with the reason.

What this does better is narrower and verifiable: every sentence traceable to a named source, every
document hash-verified, figures reconciled across sources and dates instead of averaged, claims
checked against each other with independence accounted for, gaps stated explicitly, ranking fully
exposed and reversible, and nothing you search transmitted anywhere.

## Prior art

The architecture is a synthesis of published work, not an invention: BM25 and reciprocal rank
fusion from information retrieval; PPMI and truncated SVD from distributional semantics; NDCG and
learning-to-rank from ranking research; claim decomposition and provenance tracking from
retrieval-augmented generation and knowledge-graph work; half-life based staleness from
evidence-based medicine. The novelty claimed here is only the assembly: one offline file where
retrieval, verification, discovery, prediction and learning share a single inspectable state.

## Licence

MIT — see `LICENSE`.
