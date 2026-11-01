#!/usr/bin/env python3
"""Crawler and index tests. Runs offline against a synthetic corpus, so it tests
the pipeline rather than the network."""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from crawler import core, index as index_mod  # noqa: E402

PASS = FAIL = 0
FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        FAILURES.append(name)
        print(f"  FAIL {name}" + (f"  -> {detail}" if detail else ""))


def doc(url, title, text, source="Test", authority=3, date="2026-01-01", type_="article", cited=None):
    return {
        "id": core.url_id(url), "url": url, "title": title, "text": text, "source": source,
        "issuer": source, "date": date, "lang": "en", "type": type_, "authority": authority,
        "tags": [], "cited_by": cited, "extra": {},
    }


CORPUS = [
    doc("https://a.example/upi", "UPI transaction growth in India",
        "The Unified Payments Interface processed 172 billion transactions in 2026. "
        "NPCI operates the real time payment rails used by every Indian bank.", authority=5, cited=40),
    doc("https://a.example/aadhaar", "Aadhaar authentication volumes",
        "Aadhaar eKYC authentication requests reached 2.4 billion in 2026 across banks. "
        "UIDAI issues the identity numbers and runs the authentication service.", authority=5),
    doc("https://b.example/rag", "Retrieval augmented generation for grounded answers",
        "Retrieval augmented generation combines a retrieval step with a language model so that "
        "answers are grounded in documents. Evaluation of grounding remains an open problem.",
        type_="paper", authority=4, cited=310),
    doc("https://b.example/quantum", "Quantum error correction milestones",
        "Surface code quantum error correction has crossed the break-even point in several "
        "laboratories, a prerequisite for fault tolerant quantum computing.", type_="paper", authority=4),
    doc("https://c.example/water", "Groundwater depletion in the Thar region",
        "Groundwater levels fell by 1.4 metres across eleven districts. The survey measured 2300 "
        "wells and attributed the decline to irrigation demand and weak recharge.", authority=4),
    doc("https://c.example/solar", "Solar photovoltaic capacity growth",
        "Installed solar photovoltaic capacity reached 100 gigawatts. Efficiency of commercial "
        "modules improved to 23 per cent while tariffs fell.", authority=4),
    doc("https://d.example/mughal", "Mughal administration and the mansabdar system",
        "The Mughal empire administered its provinces through mansabdars holding ranked positions. "
        "Revenue was assessed through the zabt system and recorded in Persian registers.", type_="history", authority=3),
    doc("https://d.example/vedic", "Vedic oral transmission and the Sanskrit corpus",
        "The Vedic corpus was transmitted orally with extraordinary fidelity using recitational "
        "techniques before being written down in Sanskrit manuscripts.", type_="history", authority=3),
    doc("https://e.example/privacy", "Data protection and consent architecture",
        "The data protection framework requires purpose limitation, consent and a grievance "
        "redress mechanism for every processing activity.", authority=4),
    doc("https://e.example/bhashini", "Bhashini language translation platform",
        "Bhashini provides speech recognition and translation across 22 scheduled Indian languages "
        "through an open API used by public services.", authority=5),
]
# Thirty genuinely different documents, so the near-duplicate detector is tested
# by the two deliberate near-duplicates below rather than by a templated corpus.
BULK_TOPICS = [
    ("canal irrigation scheduling", "Warabandi rotation schedules allocate canal water by turns across holdings."),
    ("drip irrigation adoption", "Drip systems cut water use by 40 per cent in horticulture but need capital."),
    ("watershed treatment", "Contour bunding and check dams raise recharge in semi-arid catchments."),
    ("crop water productivity", "Rice consumes three times the water of millet for the same calorie output."),
    ("aquifer mapping", "Electrical resistivity surveys map fresh and saline zones in coastal aquifers."),
    ("rainwater harvesting", "Rooftop harvesting in Jaipur supplies 60 litres per person per day in monsoon."),
    ("lift irrigation cooperatives", "Farmer cooperatives share pump sets to cut diesel costs in Bihar."),
    ("reservoir sedimentation", "Silt reduces live storage in Bhakra by 0.4 per cent a year."),
    ("flood irrigation losses", "Unlevelled fields lose a quarter of applied water to runoff."),
    ("sprinkler subsidies", "State subsidies for sprinklers vary from 40 to 80 per cent of capital cost."),
    ("soil moisture sensors", "Capacitive probes let farmers irrigate on measurement rather than habit."),
    ("conjunctive use", "Mixing surface and groundwater stabilises water tables in Punjab."),
    ("urban water demand", "Bengaluru's per capita supply is 90 litres against a norm of 135."),
    ("desalination energy cost", "Reverse osmosis needs 3 to 4 kilowatt hours per cubic metre."),
    ("interbasin transfer debate", "River linking proposals trade upstream storage against downstream flow."),
    ("wetland recharge", "East Kolkata wetlands treat sewage and recharge the aquifer beneath the city."),
    ("spring recharge Himalayas", "Springs in Uttarakhand discharge less each decade as snowfall declines."),
    ("irrigation efficiency paradox", "Efficiency gains often increase total consumption by expanding area."),
    ("pricing reforms", "Volumetric pricing is rare because metering farm wells is politically costly."),
    ("groundwater governance", "Model groundwater bills give states a framework but little enforcement power."),
    ("crop diversification", "Shifting from paddy to pulses cuts water demand sharply in Punjab."),
    ("energy water nexus", "Free farm power encourages over-extraction because pumping costs nothing."),
    ("arsenic contamination", "Arsenic exceeds 50 micrograms per litre in parts of the Ganges plain."),
    ("fluoride belts", "Fluoride contamination affects 66 million people across 20 states."),
    ("glacier mass balance", "Himalayan glaciers lost mass faster in the 2010s than in the 1990s."),
    ("monsoon variability", "Extreme rainfall days increased while seasonal totals stayed flat."),
    ("drought declaration", "Drought is declared on rainfall, not on soil moisture or crop loss."),
    ("water quality monitoring", "Only a third of monitoring stations test biological parameters."),
    ("rural piped supply", "Jal Jeevan Mission added 90 million household connections since 2019."),
    ("industrial water reuse", "Surat's textile cluster recycles a fifth of its process water."),
]
CORPUS += [
    doc(f"https://f.example/bulk{i}", f"{topic[0].title()} in India",
        topic[1] + " Regional data and district level evidence are summarised with measurement years. " * 2,
        authority=2)
    for i, topic in enumerate(BULK_TOPICS)
]


def main() -> int:
    keep = None
    if "--out" in sys.argv:
        keep = sys.argv[sys.argv.index("--out") + 1]
        os.makedirs(keep, exist_ok=True)
    out = keep or tempfile.mkdtemp(prefix="anv-index-")
    try:
        print("\n== tokeniser and stemmer ==")
        check("stemming reduces plurals", core.stem_en("transactions") == "transaction")
        check("stemming reduces -ing", core.stem_en("processing") == "process")
        check("devanagari tokenised", core.tokenise("भुगतान प्रणाली") == ["भुगतान", "प्रणाल"])
        check("stopwords removed", "the" not in core.tokenise("the payment system"))
        check("dates normalised", core.iso_date("Tue, 15 Oct 2026 10:00:00 GMT") == "2026-10-15")
        check("fnv1a32 is stable", core.fnv1a32("quantum") == 0x83641F82,
              hex(core.fnv1a32("quantum")))

        print("\n== index build ==")
        result = index_mod.build_from_docs(CORPUS, out, label="test")
        man = result["manifest"]
        check("documents added", result["added"] == len(CORPUS), str(result["added"]))
        check("manifest records the corpus size", man["docs"] == len(CORPUS))
        check("manifest has a build time", bool(man["builtAt"]))
        check("average length computed", man["avgdl"] > 10, str(man["avgdl"]))
        check("terms counted", man["terms"] > 60, str(man["terms"]))
        check("index bytes reported", man["indexBytes"] > 1000, str(man["indexBytes"]))

        shard_files = os.listdir(os.path.join(out, "t"))
        doc_files = os.listdir(os.path.join(out, "d"))
        check("term shards written", 5 <= len(shard_files) <= 64, str(len(shard_files)))
        check("document shards written", 1 <= len(doc_files) <= 16, str(len(doc_files)))
        check("url map written", os.path.exists(os.path.join(out, "urls.json")))
        check("signature map written", os.path.exists(os.path.join(out, "sig.json")))

        # postings must be reachable through the shard the browser would compute
        shard = index_mod.shard_of("aadhaar", man["termShards"])
        with open(os.path.join(out, "t", f"{shard}.json"), encoding="utf-8") as f:
            payload = json.load(f)
        check("postings land in the expected shard", "aadhaar" in payload, f"shard {shard}")
        check("postings carry tf and title hits",
              all(len(p) == 3 for p in payload["aadhaar"]), str(payload["aadhaar"][:2]))
        check("title terms are marked", any(p[2] > 0 for p in payload["aadhaar"]))

        print("\n== deduplication ==")
        again = index_mod.build_from_docs([CORPUS[0]], out, label="dup")
        check("same url is refused", again["added"] == 0 and again["skipped"].get("same-url") == 1,
              json.dumps(again["skipped"]))
        near = doc("https://g.example/near", CORPUS[2]["title"], CORPUS[2]["text"])
        third = index_mod.build_from_docs([near], out, label="near")
        check("near duplicate text is refused", third["added"] == 0 and
              (third["skipped"].get("near-duplicate", 0) == 1), json.dumps(third["skipped"]))
        check("document ids are never reused", third["manifest"]["nextDocId"] >= len(CORPUS),
              f"nextDocId={third['manifest']['nextDocId']} docs={len(CORPUS)}")

        print("\n== incremental update ==")
        fresh = doc("https://h.example/new", "New open access policy announced",
                    "A new open access policy requires deposited preprints for publicly funded work. " * 2)
        inc = index_mod.build_from_docs([fresh], out, label="incremental")
        check("incremental add works", inc["added"] == 1, json.dumps(inc["skipped"]))
        check("corpus grew", inc["manifest"]["docs"] == len(CORPUS) + 1)
        check("the new document took the next id, not a freed one",
              inc["manifest"]["nextDocId"] == len(CORPUS) + 1)
        check("run history recorded", len(inc["manifest"]["runs"]) >= 3, str(len(inc["manifest"]["runs"])))
        shard = index_mod.shard_of("preprint", inc["manifest"]["termShards"])
        with open(os.path.join(out, "t", f"{shard}.json"), encoding="utf-8") as f:
            payload = json.load(f)
        check("new document's terms are searchable", "preprint" in payload)

        print("\n== parity fixture for the browser ==")
        words = ["transactions", "processing", "evaluations", "repositories", "relational",
                 "quantum", "photovoltaic", "irrigation", "groundwater", "administration",
                 "authentications", "generation", "grounding", "correction", "capacity"]
        stems = {w: core.stem_en(w) for w in words}
        with open(os.path.join(out, "stems.json"), "w", encoding="utf-8") as f:
            json.dump(stems, f)
        check("parity fixture written", os.path.exists(os.path.join(out, "stems.json")))

        print(f"\n{'FAILED ' + str(FAIL) if FAIL else 'ALL PASS'}  ({PASS} passed, {FAIL} failed)")
        if FAIL:
            print("failures: " + " | ".join(FAILURES))
        print(f"INDEX_DIR={out}")
        return 1 if FAIL else 0
    finally:
        if keep:
            print(f"(fixture index kept at {out})")
        elif FAIL:
            print(f"(kept failing index at {out})")
        else:
            shutil.rmtree(out, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
