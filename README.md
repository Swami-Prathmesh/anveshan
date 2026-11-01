# ANVESHAN - अन्वेषण

A research and discovery engine: **170 indexed sources**, hybrid retrieval, cryptographic provenance,
evidence science, and a capability matrix that audits itself.

**Live: https://swami-prathmesh.github.io/anveshan/**

## The capability matrix (in-app: "Capabilities")

172 requested properties, each with a status and the mechanism behind it:

| Status | Count | Meaning |
| --- | --- | --- |
| live | 89 | the code exists in this file and you can exercise it |
| partial | 55 | implemented with a stated limit |
| adapter | 6 | works once a connector (embeddings, MT, OCR, ASR, crawler) is added |
| not possible here | 22 | needs servers, sensors or trained models |

Nothing is marked live unless it actually runs. The matrix is generated from the same source as the engine,
so it cannot drift from reality without the engine changing too.

## What runs now

**Retrieval and query intelligence** - BM25 (k1 1.45, b 0.72) with title/tag field boosts, blended with
TF-IDF cosine and a trigram fallback; relevance floor; operators (`type: org: site: after: before: year:`,
`"phrase"`, `-exclude`); intent classification; multi-intent decomposition; follow-up context resolution
("and in 2024?" merges with the previous query); entity recognition over 4,000 terms; facet-based
disambiguation.

**Evidence science** - claim decomposition into evidence / interpretation / hypothesis with causal and numeric
flags; source-independence detection (shared issuer, near-duplicate wording); per-type half-life so stale
figures are flagged; figure reconciliation across crore/lakh/million/billion with conflict vs trajectory
separation; anomaly detection against group medians; consensus map (support vs hedge vs conflict);
rank-health verdict; evidence sufficiency by research facet.

**Knowledge organisation** - entity graph from co-occurrence, rendered as SVG; topic clustering by TF-IDF
centroid; timeline; concept evolution (term drift per era); intellectual genealogy (chronological document
chain per entity); cross-disciplinary bridges; near-duplicate grouping; 24-place gazetteer with region facet
and coordinate plot.

**Learning loop (local, inspectable)** - click-through query expansion, user correction flags that
down-weight a source, zero-result gap log, and Merkle-root version history. Learning changes which sources
surface, never what they say.

**Control and privacy** - four ranking sliders that *are* the ranking function; time machine that restricts
the index to a publication year; projects with notes; full JSON export of log, projects, corrections,
learning and versions; reading list; accessibility (skip link, ARIA live, contrast mode, reduced motion);
injection scan on imported text; zero network calls.

## Not implemented, and why

Live crawling, sensors, media forensics, neural embeddings, OCR, translation and forecasting need services a
static page cannot host. Those are marked `adapter` or `not possible here` in the matrix, with the specific
reason. The adapter panel lists the six slots and what each would unlock.

## Honest scope

170 documents is a curated research library, not the web. Google indexes hundreds of billions of pages and
crawls continuously; no browser-resident engine can match that. What this does better is narrower and
verifiable: every sentence traceable to a named source, every document hash-verified, figures reconciled
across sources and dates rather than averaged, gaps stated explicitly, ranking fully exposed, and nothing you
search transmitted anywhere.

## Run it

Open `index.html` in any modern browser. No server, no build step, no network.
