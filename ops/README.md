# Operations

The engine has three ways of getting documents, and this folder is about the first.

| Engine | Where it runs | Freshness |
| --- | --- | --- |
| **Index** | `crawler/` runs on GitHub Actions, commits `index/`, browser queries it | every six hours |
| **Live** | the browser calls fifteen public APIs directly | at query time |
| **Library** | the 170 curated documents inside the page | static |

## Activating the crawler (once)

GitHub blocks apps and integrations from creating files under `.github/workflows/`,
so this step needs a human:

1. copy `ops/crawl.yml` to `.github/workflows/crawl.yml`
2. commit it
3. open **Actions → crawl-and-index → Run workflow**

From then on it runs every six hours by itself. Public repositories do not pay for
Actions minutes, so the whole thing stays free.

## Running it by hand

```bash
python3 -m crawler.run --out index --budget 20 --per-source 200
python3 -m crawler.run --list                       # available adapters
python3 -m crawler.run --sources arxiv,wikipedia --budget 5 --out /tmp/ix
python3 -m crawler.run --seeds my-topics.txt        # your own seed list
```

The run writes `index/last-run.json`, which records per-source counts, timings and
every adapter-level error. A source that fails is named in that file.

## Politeness

- `robots.txt` is fetched and obeyed for every page the crawler fetches.
- Official API endpoints are called under their own published policies: arXiv one
  request every three seconds, OpenAlex and Crossref with a contact address,
  GitHub inside its unauthenticated search limit.
- One request per host per second by default, with retries and backoff.
- No page is fetched more than once per run; documents are deduplicated by URL and
  by SimHash before they reach the index.

## The index format

```
index/manifest.json   corpus stats: docs, terms, avgdl, shard counts, per-source counts, run history
index/t/<0..63>.json  term shard:  {term: [[docId, tf, titleHits], ...]}
index/d/<0..15>.json  doc shard:   {docId: [url, title, source, issuer, date, lang, type,
                                             authority, length, snippet, domain, citedBy]}
index/urls.json       url hash -> docId, so a re-crawl never duplicates
index/sig.json        docId -> [SimHash, length], for near-duplicate rejection
```

A browser computes `fnv1a32(term) % 64` and fetches only those shards — normally two
or three files — then one document shard for the winners. Python and JavaScript
implement the same hash, and a test asserts they agree, because a mismatch would
make the browser fetch files that do not contain its terms.

## Size

At 441 documents the index is 800 KB. At 50,000 documents expect roughly 60–90 MB,
which still fits a repository and is served by Pages as static files. Beyond that,
the honest answer is that this design needs sharding across repositories or a real
object store.
