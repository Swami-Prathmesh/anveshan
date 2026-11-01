"""
ANVESHAN crawler - core utilities.

Standard library only: the crawler has to run inside a free GitHub Actions
runner with no install step, so nothing here may import a third-party package.

Contents:
  * HTTP client with a real user agent, retries, per-host politeness and
    robots.txt enforcement
  * text extraction from HTML, RSS and Atom
  * the multilingual tokeniser and stemmer, ported line-for-line from
    src/engine/lang.js so the browser and the crawler agree on what a term is
  * SimHash for near-duplicate detection
"""
from __future__ import annotations

import gzip
import hashlib
import html
import io
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from html.parser import HTMLParser

USER_AGENT = "ANVESHAN/6.0 (+https://github.com/Swami-Prathmesh/anveshan; open research crawler)"
DEFAULT_GAP = 1.0          # seconds between requests to the same host
TIMEOUT = 25

_host_last: dict[str, float] = {}
_robots: dict[str, urllib.robotparser.RobotFileParser] = {}


# --------------------------------------------------------------------------- http
def _wait_for_host(host: str, gap: float = DEFAULT_GAP) -> None:
    last = _host_last.get(host, 0.0)
    delta = time.time() - last
    if delta < gap:
        time.sleep(gap - delta)
    _host_last[host] = time.time()


def robots_allows(url: str) -> bool:
    """Honour robots.txt. A crawler that ignores it is not a crawler, it is abuse."""
    parts = urllib.parse.urlsplit(url)
    host = parts.netloc
    if host not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        rp.set_url(f"{parts.scheme}://{host}/robots.txt")
        try:
            rp.read()
        except Exception:
            rp.allow_all = True
        _robots[host] = rp
    try:
        return _robots[host].can_fetch(USER_AGENT, url)
    except Exception:
        return True


def fetch(url: str, *, gap: float = DEFAULT_GAP, accept: str | None = None,
          retries: int = 2, respect_robots: bool = True) -> tuple[bytes, str]:
    """Return (body, content_type). Raises on failure after retries."""
    if respect_robots and not robots_allows(url):
        raise PermissionError(f"robots.txt disallows {url}")
    host = urllib.parse.urlsplit(url).netloc
    headers = {"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"}
    if accept:
        headers["Accept"] = accept
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        _wait_for_host(host, gap)
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
                raw = res.read()
                if res.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
                return raw, res.headers.get("Content-Type", "")
        except Exception as exc:                     # noqa: BLE001 - retried below
            last_error = exc
            if isinstance(exc, urllib.error.HTTPError) and exc.code in (403, 404, 410):
                break
            time.sleep(1.5 * (attempt + 1))
    raise last_error or RuntimeError(f"could not fetch {url}")


def fetch_json(url: str, **kw) -> dict:
    body, _ = fetch(url, accept="application/json", **kw)
    return json.loads(body.decode("utf-8", "replace"))


def fetch_text(url: str, **kw) -> str:
    body, ctype = fetch(url, **kw)
    for enc in ("utf-8", "utf-16", "latin-1"):
        try:
            return body.decode(enc)
        except UnicodeDecodeError:
            continue
    return body.decode("utf-8", "replace")


# ------------------------------------------------------------------ html parsing
class _TextExtractor(HTMLParser):
    """Pulls readable text out of a page and drops the furniture."""

    SKIP = {"script", "style", "nav", "header", "footer", "aside", "form", "noscript", "svg"}
    BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.title = ""
        self.description = ""
        self._skip_depth = 0
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in self.SKIP:
            self._skip_depth += 1
        if tag == "title":
            self._in_title = True
        if tag in self.BLOCK:
            self.parts.append("\n")
        if tag == "meta":
            name = (attrs.get("name") or attrs.get("property") or "").lower()
            if name in ("description", "og:description") and attrs.get("content"):
                self.description = attrs["content"][:600]

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip_depth:
            self._skip_depth -= 1
        if tag == "title":
            self._in_title = False
        if tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if self._in_title:
            self.title += data
            return
        if self._skip_depth:
            return
        text = data.strip()
        if text:
            self.parts.append(text + " ")

    def text(self) -> str:
        joined = "".join(self.parts)
        joined = re.sub(r"[ \t\u00a0]+", " ", joined)
        joined = re.sub(r"\n\s*\n+", "\n", joined)
        return joined.strip()


def html_to_text(markup: str) -> tuple[str, str, str]:
    """Return (title, description, text)."""
    parser = _TextExtractor()
    try:
        parser.feed(markup)
    except Exception:
        pass
    return (html.unescape(parser.title.strip()), parser.description, parser.text())


def feed_items(xml: str) -> list[dict]:
    """Parse RSS 2.0 or Atom into [{title, link, summary, date}]."""
    items: list[dict] = []
    for block in re.findall(r"<(item|entry)\b.*?</\1>", xml, flags=re.S | re.I):
        pass
    for match in re.finditer(r"<(item|entry)\b(.*?)</\1>", xml, flags=re.S | re.I):
        body = match.group(2)

        def pick(*tags: str) -> str:
            for tag in tags:
                m = re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", body, flags=re.S | re.I)
                if m:
                    value = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", m.group(1), flags=re.S)
                    return html.unescape(re.sub(r"<[^>]+>", " ", value)).strip()
            return ""

        link = pick("link")
        if not link:
            m = re.search(r'<link[^>]*href="([^"]+)"', body, flags=re.I)
            link = m.group(1) if m else ""
        items.append({
            "title": pick("title"),
            "link": link,
            "summary": pick("description", "summary", "content"),
            "date": pick("pubDate", "published", "updated", "dc:date"),
        })
    return [i for i in items if i["title"] and i["link"]]


# ------------------------------------------------------------------------ text
STOP_EN = set("""a an and are as at be been but by for from had has have how i if in into is it its of on or
that the their then there these they this to was were what when where which who why will with you your
we our us do does did can could should would about me my more most other some such no not only own same
than too very s t just don now run runs work works tell give show need needs use used using also
may many much get gets like want wants please""".split())

STOP_HI = set("""का के की को और में से है हैं था थी थे पर यह वह कि जो एक लिए क्या कैसे कितना कितने कितनी कब कौन हो ने
नहीं हुआ हुई कर करने वाले साथ बारे लिये हम आप भी तो ही तक या एवं अपने उस इस वे वो कुछ सब बहुत अधिक कम
जैसे वैसे कहाँ क्यों द्वारा हेतु प्रति अनुसार""".split())

STOP_SA = set("""च अपि इति एव हि तु न चैव सः सा तत् ते त्वम् अहम् वयम् यत् यः या एतत् किम् कथम् कुत्र कदा
अत्र तत्र अस्ति सन्ति भवति नाम अथ ततः यथा तथा एवम् उत""".split())

STOP = STOP_EN | STOP_HI | STOP_SA
DEVA = re.compile(r"[\u0900-\u097F]")
TOKEN_RE = re.compile(r"[a-z][a-z'\-]+|[0-9]+|[\u0900-\u097F]+")

HI_SUFFIX = ["ियों", "ियां", "ाओं", "ओं", "ें", "ों", "िय", "ता", "ती", "ते", "ना", "ने", "कर", "पन", "वाला", "वाली"]
SA_SUFFIX = ["त्वम्", "त्व", "तया", "स्य", "योः", "ेषु", "ानि", "म्", "ः", "ा", "ी", "े", "ान्", "तु", "ति", "न्ति", "य", "क"]


def stem_en(w: str) -> str:
    """Ported exactly from src/engine/lang.js; parity is asserted by a test."""
    n = len(w)
    if n > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if n > 4 and (w.endswith("ses") or w.endswith("xes") or w.endswith("ches") or w.endswith("shes")):
        return w[:-2]
    if n > 3 and w.endswith("s") and not w.endswith("ss") and not w.endswith("us"):
        return w[:-1]
    if n > 6 and w.endswith("ingly"):
        return w[:-5]
    if n > 5 and w.endswith("ing"):
        return w[:-3]
    if n > 5 and w.endswith("edly"):
        return w[:-4]
    if n > 4 and w.endswith("ed") and not w.endswith("eed"):
        return w[:-2]
    if n > 5 and w.endswith("tion"):
        return w[:-3]
    if n > 5 and w.endswith("ment"):
        return w[:-4]
    if n > 5 and w.endswith("ness"):
        return w[:-4]
    if n > 4 and w.endswith("ly"):
        return w[:-2]
    return w


def stem_hi(w: str) -> str:
    for suffix in HI_SUFFIX:
        if len(w) > len(suffix) + 2 and w.endswith(suffix):
            return w[: -len(suffix)]
    return w


def stem_sa(w: str) -> str:
    for suffix in SA_SUFFIX:
        if len(w) > len(suffix) + 2 and w.endswith(suffix):
            return w[: -len(suffix)]
    return w


def stem(w: str) -> str:
    if not w:
        return w
    if DEVA.match(w[0]):
        return stem_sa(stem_hi(w))
    return stem_en(w)


def normalise(text: str) -> str:
    text = (text or "").lower().replace("\u2019", "'").replace("\u2013", "-").replace("\u2014", "-")
    return re.sub(r"\s+", " ", text).strip()


def tokenise(text: str, *, keep_stop: bool = False, stem_terms: bool = True) -> list[str]:
    out: list[str] = []
    for tok in TOKEN_RE.findall(normalise(text)):
        tok = tok.strip("'-")
        if not tok or tok in STOP and not keep_stop:
            continue
        if len(tok) < 2 and not DEVA.match(tok[0]):
            continue
        out.append(stem(tok) if stem_terms else tok)
    return out


def simhash(tokens: list[str]) -> int:
    """64-bit SimHash over term frequencies, for near-duplicate detection."""
    if not tokens:
        return 0
    counts: dict[str, int] = {}
    for t in tokens:
        counts[t] = counts.get(t, 0) + 1
    bits = [0] * 64
    for term, count in counts.items():
        h = int(hashlib.blake2b(term.encode("utf-8"), digest_size=8).hexdigest(), 16)
        for i in range(64):
            bits[i] += count if (h >> i) & 1 else -count
    value = 0
    for i in range(64):
        if bits[i] > 0:
            value |= 1 << i
    return value


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def fnv1a32(text: str) -> int:
    """FNV-1a, 32-bit. Chosen because it is trivial to reproduce exactly in
    JavaScript with Math.imul, and the browser has to compute the same shard ids
    as the crawler or it will fetch the wrong files."""
    h = 0x811C9DC5
    for byte in text.encode("utf-8"):
        h ^= byte
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def url_id(url: str) -> str:
    """Stable document id: two FNV passes so 32-bit collisions cannot drop a page."""
    u = url.strip()
    return f"{fnv1a32(u):08x}{fnv1a32(u + '#anv'):08x}"


def domain_of(url: str) -> str:
    host = urllib.parse.urlsplit(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def iso_date(value: str) -> str:
    """Best-effort ISO date from the many formats feeds use."""
    value = (value or "").strip()
    if not value:
        return ""
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", value)
    if m:
        return m.group(0)
    m = re.search(r"(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})", value)
    if m:
        months = {name: i + 1 for i, name in enumerate(
            ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
        month = months.get(m.group(2).lower())
        if month:
            return f"{int(m.group(3)):04d}-{month:02d}-{int(m.group(1)):02d}"
    m = re.search(r"(1[5-9]\d{2}|20\d{2})", value)
    return f"{m.group(1)}-01-01" if m else ""
