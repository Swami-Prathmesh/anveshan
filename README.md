# ANVESHAN - अन्वेषण

A sovereign research engine: **170 indexed sources**, an Indian-built retrieval core,
cryptographic provenance on every document, and three capabilities mainstream search does not have.

## What is inside

- **Retrieval**: BM25 (k1 1.45, b 0.72) over boosted title/tag fields, blended with a TF-IDF cosine pass
  and a trigram fallback for typos. Relevance floor keeps the tail short. Written from scratch, no dependencies.
- **Authority**: PageRank (damping 0.85, 28 iterations) over the index's own entity graph, blended with
  issuing-body tier. A document earns rank by sitting between topics, not by being popular.
- **Language**: script-aware tokeniser, roman-to-Devanagari transliteration, Indic domain thesaurus -
  Devanagari and Hinglish queries reach English sources.
- **Matbhed radar**: every numeric claim in the top sources is extracted, unit-normalised (crore, lakh,
  billion, million), grouped by entity and metric, and dated. Real conflicts are flagged; trajectories are
  labelled as trajectories. The engine never silently picks one number.
- **Research dossier**: six retrieval passes (definition, figures, timeline, mechanism, limits, context)
  assembled into a cited investigation, exportable as Markdown.
- **Provenance**: SHA-256 Merkle tree over all documents plus a hash-linked query chain, computed locally
  with the Web Crypto API. Every result can be verified leaf-to-root in the browser.
- **Pragya**: on-device agent with intent routing, MMR sentence selection and citation binding.
  Optional adapter to Sarvam-105B chat completions if you supply your own key.
- **Import**: drop .txt/.md/.csv/.json files and they are indexed, hashed and searchable immediately.
  Files never leave the device.

## Honest scope

170 documents is a curated research library, not the web. Google indexes hundreds of billions of pages and
crawls continuously; no browser-resident engine can match that, and claiming otherwise would be false.
What this does better is narrower and verifiable: every sentence is traceable to a named source, every
document is hash-verified, figures are reconciled across sources and dates rather than averaged, and nothing
you search is transmitted anywhere. The Merkle ledger is local - it is not a live Vishvasya network node.

## Run it

Open `index.html` in any modern browser. No server, no build step, no network.
