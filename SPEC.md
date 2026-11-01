# ANVESHAN — engineering specification (v6)

This is the executable form of the brief. Every requirement below maps to code in this repo and to a
row in the in-app **Audit** panel. If a requirement is not met, the audit says so and says why.

---

## 1. Objective

A public, free, open-source search engine that is **online**: it crawls the open web on a schedule,
builds its own index, serves that index from static hosting, and additionally federates live APIs at
query time. It must answer the eight questions a normal engine cannot:

> What is missing? · What do we wrongly believe? · What has not been investigated? · What connections
> were overlooked? · What could be found in existing datasets? · What evidence would settle this? ·
> What knowledge is lost? · What should be investigated next?

## 2. Non-negotiable constraints

| Constraint | Consequence for the design |
| --- | --- |
| No paid infrastructure | Static hosting (GitHub Pages) for serving; GitHub Actions for crawling compute |
| No API keys | Only keyless public endpoints |
| No user accounts, no tracking | All personal state in `localStorage`; exports are plain JSON |
| No fabricated claims | Every statement traceable to a fetched document; "unverified" is a first-class verdict |
| Must work when a source dies | Each source degrades independently and reports its own failure |
| Must be honest about limits | The audit marks `partial` / `not possible here` rather than overclaiming |

## 3. Architecture

```
                    ┌──────────────── GitHub Actions (cron, free compute) ────────────────┐
                    │  crawler → extract → dedupe → language → index build → shard → commit │
                    └───────────────────────────────┬────────────────────────────────────┘
                                                    │  index/ (static files, git)
   browser ─────────────────────────────────────────┴──────────────────────────────────────
      │
      ├── ENGINE 1  central index   fetch only the term shards the query needs → BM25 → doc shards
      ├── ENGINE 2  live federation 15 keyless APIs in parallel → per-query LSA → rank
      └── ENGINE 3  local library   170 curated documents + anything you import
                                   ↓
        shared intelligence: intent · context · evidence · discovery · investigator · learning
```

Three retrieval engines, one intelligence layer. That is the design decision that matters: the
crawler gives coverage, the federation gives freshness, the library gives verified depth, and the
same verification, contradiction, discovery and learning code runs over all three.

## 4. Retrieval technology (the part that is actually new here)

**Shard-and-fetch retrieval.** A precomputed inverted index is split into `S` term shards by
`hash(term) mod S` and `D` document shards by `docId mod D`. A browser fetches only the shards its
query terms live in — typically 2–4 small files — plus one document shard for the winners. The index
lives in git, not in a database, so there is nothing to operate and nothing to pay for, while the
query cost stays proportional to the query, not to the corpus.

**Ranking.** BM25 over the central index, fused with: source authority, recency, evidence density,
citation count where the source provides one, and a learned per-user weight vector that is adopted
only when measured NDCG does not fall.

**Per-query semantic space.** Live results get an LSA space built on the spot (tf-idf matrix →
truncated SVD by power iteration → term vectors). This is how "search by concept" works without
shipping a 400MB model.

## 5. Requirement → implementation map

| # | Requirement | Where | Status |
| --- | --- | --- | --- |
| A1–A10 | semantic, intent, context, NL, multilingual, cross-language, entities, disambiguation, multi-intent, deep research | `src/engine/{lang,semantic,understand,agent}.js` | live |
| B11–B26 | credibility, primacy, peer review, archives, transparency, evidence ranking, fact-check, contradiction, misinformation, dates, history, fact/hypothesis split, confidence, citations, missing evidence | `src/engine/evidence.js` | live |
| C27–C37 | speed, operators, multimodal ingest, PDFs, concept search, cross-source, personalisation, custom ranking, history, accessibility | `src/engine/{semantic,ingest,ui}.js` | live / partial |
| D38–D48 | knowledge graph, relationships, timeline, geo, clustering, categorisation, duplicates, concept evolution, cross-disciplinary, extraction | `src/engine/discovery.js` | live |
| E49–E59 | privacy, minimal collection, no manipulation, no forced personalisation, memory, export, transparency, security, standards, adversarial | whole design | live / partial |
| F1–F54 | autonomous discovery, continuous learning, verification, self-maintenance, personalised intelligence | `crawler/` + `src/engine/{learn,discovery}.js` | live |
| G55–G86 | prediction, forecasting, gaps, unsolved problems, trends, alerts, hidden relations, causality, consequences, analogy, recombination, autonomous science, failure registry | `src/engine/{discovery,agent}.js` | live / partial |
| H | multimodal, spatial, scientific, astronomical | ingest + live adapters | partial / not possible |
| I1–I30 | the thirty innovations | mapped in the audit | live / partial |
| J1–J10 | the ten paradigms | `Discover` panel | live |

## 6. Definition of done

1. `python3 -m crawler.run` produces a valid sharded index from live sources.
2. `index/manifest.json` reports the corpus size, build time and per-source counts.
3. The browser retrieves from that index without any server: search works with the network on and
   with the API federation blocked.
4. Every result shows its source, date, authority and the factors behind its score.
5. The audit renders and every `live` row is exercisable.
6. Test suites pass: retrieval quality, layers, ingestion, live federation, central index, and both
   builds driven in a DOM.
7. The site is public, free, and needs no account.

## 7. What is explicitly out of scope, and why

- **Web-scale coverage** (billions of pages): needs a datacentre and a budget. The crawler targets
  tens of thousands of high-value documents per run, which is what free compute can carry.
- **Audio and video understanding**: needs codecs and models; transcripts are accepted instead.
- **Server-side personalisation**: there is no server. Learning is per device by design, not by
  accident.
- **Guaranteed uptime**: a static site plus public APIs has no SLA, and pretending otherwise would
  be a lie in a README.
