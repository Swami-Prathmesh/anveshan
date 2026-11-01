#!/usr/bin/env python3
"""
ANVESHAN build.

Assembles two self-contained pages from the engine library, the compiled model,
the engine layers and the interface:

    index.html     index engine + live engine + library
    offline.html   library only, no network at all

    python3 tools/build.py [--check]
"""
import os
import re
import subprocess
import sys
import tempfile

SHELL = "src/ui/shell.html"
STYLE = "src/ui/shell.css"

# Order matters. The engine library defines the corpus and the lexical core; the
# layers above it depend on those globals existing first.
ENGINE = [
    ("src/base/engine-v3.js", "engine library (corpus, BM25 core, authority, claims)"),
    ("src/data/model.js", "compiled semantic model"),
    ("src/engine/lang.js", "language layer"),
    ("src/engine/semantic.js", "semantic retrieval"),
    ("src/engine/understand.js", "query understanding"),
    ("src/engine/evidence.js", "evidence science"),
    ("src/engine/discovery.js", "discovery paradigms"),
    ("src/engine/agent.js", "autonomous investigator"),
    ("src/engine/learn.js", "learning loop"),
    ("src/engine/ingest.js", "ingestion"),
    ("src/data/v4_matrix.js", "capability audit data"),
]
ONLINE = [
    ("src/engine/live.js", "live federation"),
    ("src/engine/central.js", "central index client"),
]
UI = [
    ("src/ui/shim.js", "ui globals"),
    ("src/ui/shell.js", "interface"),
]

TITLE = "ANVESHAN — search everything"
DESC = ("A free, open-source search engine with its own crawled index, fifteen live open-web sources "
        "and a verified library. Semantic ranking, claim verification, ten discovery paradigms and a "
        "self-learning loop. No account, no tracking.")
OFFLINE_TITLE = "ANVESHAN — offline library"
OFFLINE_DESC = ("ANVESHAN with no network at all: 170 curated documents, a compiled semantic model, "
                "claim verification and discovery tools in one file.")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def build(target, live, title, desc):
    html = read(SHELL)
    css = read(STYLE)
    blocks = []
    for path, label in ENGINE + (ONLINE if live else []) + UI:
        blocks.append("<!-- %s -->\n<script>\n%s\n</script>" % (label, read(path)))
    payload = "\n".join(blocks)
    html = html.replace("{{STYLE}}", "<style>\n" + css + "\n</style>")
    html = html.replace("{{SCRIPTS}}", payload)
    html = html.replace("<title>ANVESHAN — search everything</title>", "<title>" + title + "</title>")
    html = re.sub(r'<meta name="description" content="[^"]*">',
                  '<meta name="description" content="' + desc + '">', html, count=1)
    if "{{" in html:
        raise SystemExit("unreplaced placeholder in shell template")
    with open(target, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"wrote {target}: {len(html.encode()) / 1024:.0f} KB, "
          f"{len(ENGINE) + (len(ONLINE) if live else 0) + len(UI)} blocks, live={'yes' if live else 'no'}")
    return html


def check(target):
    html = read(target)
    blocks = re.findall(r"<script>(.*?)</script>", html, re.S)
    bad = 0
    for i, b in enumerate(blocks):
        if not b.strip():
            continue
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
            f.write(b)
            path = f.name
        r = subprocess.run(["node", "--check", path], capture_output=True, text=True)
        os.unlink(path)
        if r.returncode != 0:
            bad += 1
            print(f"  block {i} FAILED:\n{r.stderr.splitlines()[:5]}")
    print(f"syntax: {len(blocks)} blocks, {bad} broken")
    return bad == 0


if __name__ == "__main__":
    build("index.html", True, TITLE, DESC)
    build("offline.html", False, OFFLINE_TITLE, OFFLINE_DESC)
    ok = check("index.html") and check("offline.html")
    if "--check" in sys.argv and not ok:
        raise SystemExit(1)
