#!/usr/bin/env python3
"""
ANVESHAN v4 - build.

Takes the v3 single-file engine as the base, appends the v4 layers in
dependency order, adds the v4 stylesheet, and writes one self-contained
index.html that still needs no server and makes no network calls.

    python3 tools/build.py            -> index.html
    python3 tools/build.py --check    -> also syntax-check every script block
"""
import re
import subprocess
import sys
import tempfile
import os

BASE = "src/base/index-v3.html"
OUT = "index.html"

# Order matters: the model must load before the semantic layer reads it.
LAYERS = [
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
    ("src/engine/ui.js", "integration"),
]

# The online build adds the live layers; the offline build stops at ui.js so the
# same sources produce both artefacts.
LIVE_LAYERS = [
    ("src/engine/live.js", "live federation"),
    ("src/engine/live-ui.js", "live interface"),
    ("src/engine/central.js", "central index client"),
    ("src/engine/central-ui.js", "central index interface"),
]

TITLE = "ANVESHAN - a search engine with its own index"
OFFLINE_TITLE = "ANVESHAN - offline knowledge engine"
DESC = ("ANVESHAN is a free, open-source search engine with its own crawled index: a scheduled crawler builds a "
        "sharded inverted index that the browser queries directly from static files, plus fifteen live open APIs "
        "and a verified offline library. Semantic reranking, claim verification, contradiction detection, ten "
        "discovery paradigms, an autonomous investigator and a gated self-learning loop. No account, no tracking.")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def build(target=OUT, live=True, title=None, desc=None):
    html = read(BASE)
    if "ANV_MATRIX" in html or "v4bar" in html:
        raise SystemExit("base file already contains a v4 build; rebuild from the pristine v3 file")

    css = read("src/styles/v4.css")
    style = '\n<style id="v4-style">\n' + css + "\n</style>\n"

    blocks = []
    for path, label in (LAYERS + (LIVE_LAYERS if live else [])):
        code = read(path)
        blocks.append("<!-- layer: %s -->\n<script>\n%s\n</script>" % (label, code))
    payload = "\n".join(blocks)

    # 1. stylesheet before </head>
    if "</head>" not in html:
        raise SystemExit("no </head> in base file")
    html = html.replace("</head>", style + "</head>", 1)

    # 2. title and description
    html = re.sub(r"<title>.*?</title>", "<title>" + (title or TITLE) + "</title>", html, count=1, flags=re.S)
    html = re.sub(r'<meta name="description" content=".*?">',
                  '<meta name="description" content="' + (desc or DESC) + '">', html, count=1, flags=re.S)

    # 3. scripts before </body>
    if "</body>" not in html:
        raise SystemExit("no </body> in base file")
    html = html.replace("</body>", payload + "\n</body>", 1)

    with open(target, "w", encoding="utf-8") as f:
        f.write(html)
    size = len(html.encode("utf-8"))
    n = len(LAYERS) + (len(LIVE_LAYERS) if live else 0)
    print(f"wrote {target}: {size/1024:.0f} KB, {n} layers, live={'yes' if live else 'no'}")
    return html


def check_syntax(target=OUT):
    """Every script block must parse. A build that does not parse is not a build."""
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
            print(f"  block {i} FAILED to parse:\n{r.stderr.splitlines()[:6]}")
    print(f"syntax: {len(blocks)} script blocks, {bad} broken")
    return bad == 0


OFFLINE_DESC = ("ANVESHAN offline: the same engine with no network at all - 170 curated sources, a compiled "
                "semantic model, claim verification, ten discovery paradigms and a learning loop in one file.")

if __name__ == "__main__":
    build("index.html", live=True)
    build("offline.html", live=False, title=OFFLINE_TITLE, desc=OFFLINE_DESC)
    ok = check_syntax("index.html") and check_syntax("offline.html")
    if "--check" in sys.argv and not ok:
        raise SystemExit(1)
