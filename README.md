# ANVESHAN - अन्वेषण

A sovereign research engine. **170 indexed sources**, an Indian-built retrieval core, cryptographic
provenance on every document, and a set of evidence and discovery layers that mainstream search does not have.

## Implemented (runs entirely in your browser, zero network calls)

**Search accuracy and intelligence**
- Hybrid retrieval: BM25 (k1 1.45, b 0.72) over boosted title/tag fields, blended with TF-IDF cosine and a
  trigram fallback. Relevance floor keeps the tail short.
- Intent detection (definition / quantitative / temporal / procedural / comparative / list / evidence).
- Multi-intent decomposition: compound questions are split into sub-questions you can run individually.
- Natural-language and incomplete queries accepted; operators: `type:`, `org:`, `site:`, `after:`, `before:`,
  `year:`, `"exact phrase"`, `-exclude`.
- Multilingual: script-aware tokeniser, roman-to-Devanagari transliteration, Indic domain thesaurus.
- Entity recognition over a 4,000-term index vocabulary, with word-boundary matching.
- Disambiguation by facet: results that span several domains are presented as a choice, not a guess.
- Deep research: six-pass dossier (definition, figures, timeline, mechanism, limits, context).

**Information quality**
- Source authority: PageRank (damping 0.85, 28 iterations) over the index's entity graph, blended with
  issuing-body tier. Not popularity.
- Claim decomposition with heuristic typing: evidence / interpretation / hypothesis / statement, plus causal
  and numeric flags.
- Source independence detection: same issuer or near-duplicate wording is not corroboration.
- Figure reconciliation (Matbhed radar): every numeric claim in scope is unit-normalised across crore, lakh,
  million and billion, grouped by entity and metric, dated, and checked for genuine conflict within 200 days.
- Information age: per-type half-life; decayed figures are flagged for revalidation.
- Contradiction laboratory: conflicts and trajectories reported separately.
- Evidence sufficiency: which research facets have no supporting sentence.
- Citation traceability: every sentence carries a document id; every document carries a Merkle leaf.

**Knowledge organisation**
- Entity graph rendered from co-occurrence in the top results.
- Topic clustering by TF-IDF centroid similarity.
- Timeline of publication dates.
- Cross-disciplinary bridges and serendipity: documents from other domains that are still semantically close.

**User control and privacy**
- User-controlled ranking: four sliders (lexical, semantic, authority, recency) that *are* the ranking function.
- Time machine: restrict the index to documents published up to a chosen year.
- Research projects, query log and information-gap record, all in localStorage.
- Reading list, Markdown export, command palette, voice query, high-contrast mode, skip link, ARIA live region.
- Zero network calls. No analytics. No accounts. Imported files never leave the device.

**Integrity**
- SHA-256 Merkle tree over all documents, verified leaf-to-root in the browser.
- Append-only hash-linked query chain.
- Injection scan on imported text: instruction-like content is indexed as data and never executed.

## Not implemented, and why

- **Live crawling and continuous discovery of new sources.** A static file cannot crawl. Import covers
  private corpora; a crawler needs servers, scheduling and politeness policy.
- **Multimodal search (image, audio, video, 3D, satellite).** Needs encoders and storage. Voice input works
  through the browser's own speech engine.
- **Neural semantic embeddings, translation, generation.** Would need model files or an API. The optional
  Sarvam-105B adapter covers generation with your own key.
- **Predictive forecasting, simulation, hypothesis generation, causal proof.** These need domain models,
  live data and compute. The Discovery panel computes gaps, mention lift, cross-domain similarity and
  hedged-language separation from a fixed corpus, and labels each as what it is.
- **Self-modifying learning.** The engine does not rewrite its own ranking. It records gaps and failed
  queries; a human decides what to add.

## Honest scope

170 documents is a curated research library, not the web. Google indexes hundreds of billions of pages and
crawls continuously; no browser-resident engine can match that, and claiming otherwise would be false.
What this does better is narrower and verifiable: every sentence traceable to a named source, every document
hash-verified, figures reconciled across sources and dates rather than averaged, gaps stated explicitly, and
nothing you search transmitted anywhere. The Merkle ledger is local - it is not a live Vishvasya network node.

## Run it

Open `index.html` in any modern browser. No server, no build step, no network.
