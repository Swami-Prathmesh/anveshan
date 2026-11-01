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

TITLE = "ANVESHAN - universal knowledge engine"
DESC = ("ANVESHAN v4 is an offline, Indic-first research and discovery engine: a compiled semantic model "
        "(PPMI + SVD embeddings) fused with BM25F, claim-level verification, contradiction detection, "
        "ten discovery paradigms, an autonomous investigator, and a self-learning ranking loop. "
        "170 indexed sources, Merkle provenance, zero network calls.")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def build():
    html = read(BASE)
    if "ANV_MATRIX" in html or "v4bar" in html:
        raise SystemExit("base file already contains a v4 build; rebuild from the pristine v3 file")

    css = read("src/styles/v4.css")
    style = '\n<style id="v4-style">\n' + css + "\n</style>\n"

    blocks = []
    for path, label in LAYERS:
        code = read(path)
        blocks.append("<!-- v4 layer: %s -->\n<script>\n%s\n</script>" % (label, code))
    payload = "\n".join(blocks)

    # 1. stylesheet before </head>
    if "</head>" not in html:
        raise SystemExit("no </head> in base file")
    html = html.replace("</head>", style + "</head>", 1)

    # 2. title and description
    html = re.sub(r"<title>.*?</title>", "<title>" + TITLE + "</title>", html, count=1, flags=re.S)
    html = re.sub(r'<meta name="description" content=".*?">',
                  '<meta name="description" content="' + DESC + '">', html, count=1, flags=re.S)

    # 3. scripts before </body>
    if "</body>" not in html:
        raise SystemExit("no </body> in base file")
    html = html.replace("</body>", payload + "\n</body>", 1)

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    size = len(html.encode("utf-8"))
    print(f"wrote {OUT}: {size/1024:.0f} KB, {len(LAYERS)} v4 layers, base {len(read(BASE).encode())/1024:.0f} KB")
    return html


def check_syntax():
    """Every script block must parse. A build that does not parse is not a build."""
    html = read(OUT)
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


if __name__ == "__main__":
    build()
    ok = check_syntax()
    if "--check" in sys.argv and not ok:
        raise SystemExit(1)
