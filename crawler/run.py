"""
ANVESHAN crawler - orchestrator.

    python3 -m crawler.run --out index --budget 20
    python3 -m crawler.run --sources arxiv,wikipedia --per-source 20 --out /tmp/t

Each adapter is isolated: one broken source reports its error and the crawl
continues. The run ends by writing the sharded index and a report of what
happened, which is committed to the repository by the workflow.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback

from . import core, index as index_mod, sources as src

DEFAULT_SEEDS = [
    # India: governance, infrastructure, science
    "IndiaAI Mission", "Aadhaar", "UPI payments NPCI", "Bhashini language translation",
    "Digital Public Infrastructure India", "ONDC open network", "BharatNet broadband",
    "ISRO missions", "Chandrayaan", "Aditya-L1 solar mission", "Indian Institutes of Technology",
    "National Education Policy India", "Ayushman Bharat health", "Jal Jeevan Mission",
    "India renewable energy solar", "India data protection DPDP", "India semiconductor mission",
    "Indian economy inflation RBI", "Mughal empire administration", "Vedic literature Sanskrit",
    # science and technology
    "retrieval augmented generation", "knowledge graph reasoning", "large language model evaluation",
    "quantum computing error correction", "CRISPR gene editing", "mRNA vaccine platforms",
    "climate tipping points", "groundwater depletion", "solar photovoltaics efficiency",
    "fusion energy tokamak", "gravitational waves", "exoplanet atmospheres",
    "continual learning catastrophic forgetting", "causal inference observational data",
    "misinformation detection", "open science reproducibility",
    # society and policy
    "digital privacy surveillance", "algorithmic accountability", "science funding policy",
    "urban air pollution health", "antimicrobial resistance",
]


def load_seeds(path: str | None) -> list[str]:
    if not path:
        return DEFAULT_SEEDS
    with open(path, encoding="utf-8") as f:
        seeds = [line.strip() for line in f if line.strip() and not line.startswith("#")]
    return seeds or DEFAULT_SEEDS


def run(out: str, source_ids: list[str], per_source: int, budget_s: float,
        seeds: list[str], verbose: bool = True) -> dict:
    started = time.time()
    collected: list[dict] = []
    report: dict = {"startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "sources": {}, "budgetSeconds": budget_s}

    def remaining() -> float:
        return budget_s - (time.time() - started)

    for sid in source_ids:
        if remaining() <= 5:
            report["sources"][sid] = {"ok": False, "error": "skipped: budget exhausted"}
            continue
        t0 = time.time()
        try:
            if sid == "arxiv":
                docs = src.arxiv(seeds[:14], per_query=max(4, per_source // 4))
            elif sid == "openalex":
                docs = src.openalex(seeds[:12], per_query=max(4, per_source // 4))
            elif sid == "crossref":
                docs = src.crossref(seeds[:10], per_query=max(3, per_source // 4))
            elif sid == "wikipedia":
                docs = src.wikipedia(seeds[:24], per_seed=max(2, per_source // 8), langs=("en", "hi"))
            elif sid == "wikisource":
                docs = src.wikisource(seeds[:8], per_seed=2)
            elif sid == "internet_archive":
                docs = src.internet_archive(seeds[:10], per_query=max(3, per_source // 6))
            elif sid == "github":
                docs = src.github(seeds[:8], per_query=max(3, per_source // 6))
            elif sid == "feeds":
                docs = src.feeds(limit_per_feed=max(2, per_source // 8))
            elif sid == "sitemap":
                docs = src.sitemap_pages(src.SITES, per_site=max(3, per_source // 6))
            else:
                report["sources"][sid] = {"ok": False, "error": "unknown source"}
                continue
            collected.extend(docs)
            report["sources"][sid] = {"ok": True, "documents": len(docs), "seconds": round(time.time() - t0, 1)}
            if verbose:
                print(f"  {sid:18s} {len(docs):5d} documents  {time.time() - t0:5.1f}s", flush=True)
        except Exception as exc:                       # noqa: BLE001 - reported, not swallowed
            report["sources"][sid] = {"ok": False, "error": f"{type(exc).__name__}: {exc}",
                                      "trace": traceback.format_exc(limit=2)[-400:]}
            if verbose:
                print(f"  {sid:18s} FAILED  {type(exc).__name__}: {exc}", flush=True)

    report["adapterErrors"] = src.ERRORS[-40:]
    report["collected"] = len(collected)
    result = index_mod.build_from_docs(collected, out, label=f"crawl {report['startedAt']}")
    report["added"] = result["added"]
    report["skipped"] = result["skipped"]
    report["docs"] = result["docs"]
    report["terms"] = result["manifest"]["terms"]
    report["indexBytes"] = result["bytes"]
    report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    report["seconds"] = round(time.time() - started, 1)

    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "last-run.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    return report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="crawler.run", description="Crawl open sources and rebuild the ANVESHAN index.")
    ap.add_argument("--out", default="index", help="index output directory")
    ap.add_argument("--sources", default="feeds,wikipedia,arxiv,openalex,crossref,internet_archive,github",
                    help="comma separated adapter ids")
    ap.add_argument("--per-source", type=int, default=120, help="soft cap of documents per source")
    ap.add_argument("--budget", type=float, default=25.0, help="wall-clock budget in minutes")
    ap.add_argument("--seeds", default=None, help="file of seed topics, one per line")
    ap.add_argument("--list", action="store_true", help="list adapters and exit")
    args = ap.parse_args(argv)

    if args.list:
        for sid in src.ADAPTERS:
            print(sid)
        return 0

    seeds = load_seeds(args.seeds)
    ids = [s.strip() for s in args.sources.split(",") if s.strip()]
    unknown = [s for s in ids if s not in src.ADAPTERS]
    if unknown:
        print(f"unknown sources: {', '.join(unknown)}", file=sys.stderr)
        return 2

    print(f"ANVESHAN crawl -> {args.out}  sources={len(ids)}  seeds={len(seeds)}  "
          f"budget={args.budget}min", flush=True)
    report = run(args.out, ids, args.per_source, args.budget * 60, seeds)
    print(f"\nadded {report['added']} documents, skipped {report['skipped']}")
    print(f"corpus now {report['docs']} documents, {report['terms']} terms, "
          f"{report['indexBytes'] / 1024:.0f} KB index, {report['seconds']}s")
    if report.get("adapterErrors"):
        print("adapter-level errors (each is one seed or feed, not the whole source):")
        for e in report["adapterErrors"][:8]:
            print(f"  {e['source']}: {e['where'][:50]} -> {e['error'][:110]}")
    failed = {k: v["error"] for k, v in report["sources"].items() if not v["ok"]}
    if failed:
        print("sources that failed (reported, not hidden):")
        for name, err in failed.items():
            print(f"  {name}: {err[:140]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
