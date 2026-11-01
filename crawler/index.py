"""
ANVESHAN crawler - index builder.

The output is a *sharded* inverted index that a browser can query directly:

    index/manifest.json      corpus statistics, shard counts, per-source counts
    index/t/<s>.json         term shard s:  {term: [[docId, tf, titleHits], ...]}
    index/d/<s>.json         doc shard s:   {docId: [url, title, source, issuer,
                                                  date, lang, type, authority,
                                                  dl, snippet, domain, citedBy]}
    index/urls.json          url-hash -> docId, so re-crawls never duplicate
    index/sig.json           docId -> SimHash, for near-duplicate rejection

Sharding by hash(term) mod S means a query fetches only the shards its own terms
land in - usually two or three small files - instead of downloading an index. That
is what makes a real, prebuilt index usable with no server at all.

Runs are incremental: new documents are appended to existing postings, document ids
are never reused, and nothing is deleted silently.
"""
from __future__ import annotations

import json
import os
import time

from . import core

TERM_SHARDS = 64
DOC_SHARDS = 16
MAX_DOCS = 120000


def shard_of(term: str, mod: int) -> int:
    """Term shard. Must match src/engine/central.js exactly."""
    return core.fnv1a32(term) % mod


def doc_shard(doc_id: int) -> int:
    return doc_id % DOC_SHARDS


def _load(path: str, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _write(path: str, obj) -> int:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)
    return os.path.getsize(path)


class Index:
    def __init__(self, out_dir: str):
        self.out = out_dir
        self.manifest = _load(os.path.join(out_dir, "manifest.json"), {
            "version": 1, "builtAt": "", "docs": 0, "terms": 0, "nextDocId": 0,
            "termShards": TERM_SHARDS, "docShards": DOC_SHARDS, "avgdl": 0.0,
            "sources": {}, "runs": [],
        })
        self.urls = _load(os.path.join(out_dir, "urls.json"), {})
        self.sig = _load(os.path.join(out_dir, "sig.json"), {})
        self.term_cache: dict[int, dict] = {}
        self.doc_cache: dict[int, dict] = {}

    # ------------------------------------------------------------------ shards
    def term_shard(self, s: int) -> dict:
        if s not in self.term_cache:
            self.term_cache[s] = _load(os.path.join(self.out, "t", f"{s}.json"), {})
        return self.term_cache[s]

    def doc_store(self, s: int) -> dict:
        if s not in self.doc_cache:
            self.doc_cache[s] = _load(os.path.join(self.out, "d", f"{s}.json"), {})
        return self.doc_cache[s]

    # -------------------------------------------------------------------- add
    def is_duplicate(self, doc: dict) -> str | None:
        """
        Exact URL, or near-duplicate text.

        SimHash alone is unreliable on short documents - two unrelated paragraphs
        about payments can sit within three bits of each other - and dropping a real
        document is worse than keeping a duplicate. So the threshold tightens with
        document length, and a length ratio has to agree as well.
        """
        if doc["id"] in self.urls:
            return "same-url"
        tokens = core.tokenise(doc["title"] + " " + doc["text"])
        if len(tokens) < 8:          # a headline with no body is not indexable
            return "too-short"
        sig = core.simhash(tokens)
        threshold = 2 if len(tokens) < 120 else 3
        for other, entry in self.sig.items():
            other_sig, other_len = entry if isinstance(entry, list) else (entry, 0)
            if not other_len:
                continue
            ratio = len(tokens) / max(1, other_len)
            if ratio < 0.6 or ratio > 1.7:
                continue
            if core.hamming(sig, other_sig) <= threshold:
                return f"near-duplicate-of-{other}"
        doc["_sig"] = sig
        doc["_len"] = len(tokens)
        return None

    def add(self, docs: list[dict], *, batch_label: str = "") -> dict:
        added, skipped = 0, {}
        total_len = self.manifest["avgdl"] * max(1, self.manifest["docs"])
        for doc in docs:
            if self.manifest["docs"] >= MAX_DOCS:
                skipped["cap-reached"] = skipped.get("cap-reached", 0) + 1
                continue
            reason = self.is_duplicate(doc)
            if reason:
                key = "same-url" if reason == "same-url" else "near-duplicate" if reason.startswith("near") else reason
                skipped[key] = skipped.get(key, 0) + 1
                continue
            doc_id = self.manifest["nextDocId"]
            self.manifest["nextDocId"] += 1
            tokens = core.tokenise(doc["title"] + " " + doc["text"])
            title_tokens = core.tokenise(doc["title"])
            title_counts: dict[str, int] = {}
            for t in title_tokens:
                title_counts[t] = title_counts.get(t, 0) + 1
            counts: dict[str, int] = {}
            for t in tokens:
                counts[t] = counts.get(t, 0) + 1
            dl = len(tokens)
            for term, tf in counts.items():
                s = shard_of(term, TERM_SHARDS)
                shard = self.term_shard(s)
                shard.setdefault(term, []).append([doc_id, tf, title_counts.get(term, 0)])
            store = self.doc_store(doc_shard(doc_id))
            store[str(doc_id)] = [
                doc["url"], doc["title"], doc["source"], doc["issuer"], doc["date"],
                doc["lang"], doc["type"], doc["authority"], dl,
                doc["text"][:300].replace("\n", " "), core.domain_of(doc["url"]),
                doc.get("cited_by") or 0,
            ]
            self.urls[doc["id"]] = doc_id
            self.sig[str(doc_id)] = [doc.get("_sig") or core.simhash(tokens), doc.get("_len") or len(tokens)]
            src = self.manifest["sources"].setdefault(doc["source"], {"count": 0, "authority": doc["authority"]})
            src["count"] += 1
            total_len += dl
            added += 1
            self.manifest["docs"] += 1

        self.manifest["avgdl"] = round(total_len / max(1, self.manifest["docs"]), 3)
        self.manifest["terms"] = self._count_terms()
        self.manifest["builtAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        self.manifest["runs"] = (self.manifest.get("runs") or [])[-19:] + [{
            "at": self.manifest["builtAt"], "label": batch_label,
            "added": added, "skipped": skipped, "docs": self.manifest["docs"],
        }]
        self.flush()
        return {"added": added, "skipped": skipped, "docs": self.manifest["docs"]}

    def _count_terms(self) -> int:
        count = 0
        for s in range(TERM_SHARDS):
            count += len(self.term_shard(s))
        return count

    # ------------------------------------------------------------------ flush
    def flush(self) -> dict:
        sizes = {}
        for s, shard in self.term_cache.items():
            if shard:
                sizes[f"t/{s}.json"] = _write(os.path.join(self.out, "t", f"{s}.json"), shard)
        for s, store in self.doc_cache.items():
            if store:
                sizes[f"d/{s}.json"] = _write(os.path.join(self.out, "d", f"{s}.json"), store)
        sizes["urls.json"] = _write(os.path.join(self.out, "urls.json"), self.urls)
        sizes["sig.json"] = _write(os.path.join(self.out, "sig.json"), self.sig)
        self.manifest["indexBytes"] = sum(sizes.values())
        sizes["manifest.json"] = _write(os.path.join(self.out, "manifest.json"), self.manifest)
        return sizes


def build_from_docs(docs: list[dict], out_dir: str, label: str = "") -> dict:
    idx = Index(out_dir)
    result = idx.add(docs, batch_label=label or f"{len(docs)} documents")
    result["manifest"] = idx.manifest
    result["bytes"] = idx.manifest.get("indexBytes", 0)
    return result
