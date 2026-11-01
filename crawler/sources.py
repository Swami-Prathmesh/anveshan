"""
ANVESHAN crawler - source adapters.

Every adapter returns a list of documents in one shape:

    {id, url, title, text, source, issuer, date, lang, type, authority, tags}

`authority` is 1-5 on the same scale the interface uses, and it is a property of
the issuer, not of the individual document: a retraction-prone preprint server
does not become authoritative because one paper is good.

Adapters are written to fail independently. A source that breaks reports why and
the crawl continues - that is the difference between a crawler and a script.
"""
from __future__ import annotations

import json
import re
import urllib.parse
import xml.etree.ElementTree as ET

from . import core

ATOM = {"a": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}

# Adapters record why they returned nothing. A crawl report that cannot say which
# source failed is not a report, it is a hope.
ERRORS: list[dict] = []


def note_error(source: str, where: str, exc: Exception) -> None:
    ERRORS.append({"source": source, "where": where, "error": f"{type(exc).__name__}: {exc}"[:300]})


def api(url: str, **kw):
    """
    Call an official API endpoint.

    These endpoints publish their own usage policy and rate limits (arXiv asks for
    one request every three seconds, OpenAlex and Crossref want a mailto), and the
    adapters honour those explicitly with `gap`. A blanket robots.txt Disallow aimed
    at scrapers is not the governing document for a documented API, so the robots
    check is skipped *here only* - page fetches still honour it.
    """
    return core.fetch(url, respect_robots=False, **kw)


def api_json(url: str, **kw):
    return core.fetch_json(url, respect_robots=False, **kw)


def api_text(url: str, **kw):
    return core.fetch_text(url, respect_robots=False, **kw)


def _doc(*, url, title, text, source, issuer, date="", lang="en", type_="article",
         authority=3, tags=None, cited_by=None, extra=None):
    return {
        "id": core.url_id(url),
        "url": url,
        "title": (title or "").strip()[:300],
        "text": (text or "").strip()[:6000],
        "source": source,
        "issuer": (issuer or source)[:120],
        "date": core.iso_date(date),
        "lang": lang,
        "type": type_,
        "authority": authority,
        "tags": (tags or [])[:8],
        "cited_by": cited_by,
        "extra": extra or {},
    }


# ------------------------------------------------------------------- scholarly
def arxiv(queries: list[str], per_query: int = 40) -> list[dict]:
    """Newest submissions per query. arXiv is the freshest signal in science."""
    out = []
    for q in queries:
        url = ("https://export.arxiv.org/api/query?search_query="
               + urllib.parse.quote(f'all:"{q}"')
               + f"&sortBy=submittedDate&sortOrder=descending&max_results={per_query}")
        try:
            xml = api_text(url, gap=3.0, accept="application/atom+xml")
        except Exception as exc:
            note_error("arxiv", q, exc)
            continue
        try:
            root = ET.fromstring(xml)
        except ET.ParseError:
            continue
        for entry in root.findall("a:entry", ATOM):
            link = (entry.findtext("a:id", default="", namespaces=ATOM) or "").strip()
            title = re.sub(r"\s+", " ", entry.findtext("a:title", default="", namespaces=ATOM) or "")
            summary = re.sub(r"\s+", " ", entry.findtext("a:summary", default="", namespaces=ATOM) or "")
            published = entry.findtext("a:published", default="", namespaces=ATOM) or ""
            authors = [a.findtext("a:name", default="", namespaces=ATOM)
                       for a in entry.findall("a:author", ATOM)]
            cats = [c.get("term") for c in entry.findall("a:category", ATOM) if c.get("term")]
            if not (link and title):
                continue
            out.append(_doc(url=link, title=title, text=summary, source="arXiv",
                            issuer=(authors[0] if authors else "arXiv"), date=published,
                            type_="paper", authority=4, tags=cats[:6] + [q],
                            extra={"authors": authors[:6], "venue": "arXiv"}))
    return out


def openalex(queries: list[str], per_query: int = 40, since: str = "") -> list[dict]:
    """250M+ works, with citation counts and retraction flags."""
    out = []
    for q in queries:
        filt = f",from_publication_date:{since}" if since else ""
        url = ("https://api.openalex.org/works?search=" + urllib.parse.quote(q)
               + f"&per-page={per_query}&sort=publication_date:desc{filt}&mailto=anveshan@example.org")
        try:
            data = api_json(url, gap=1.0)
        except Exception as exc:
            note_error("openalex", q, exc)
            continue
        for w in data.get("results", []):
            inv = w.get("abstract_inverted_index") or {}
            words: list[str] = []
            for term, positions in inv.items():
                for pos in positions:
                    if pos < 4000:
                        words.append((pos, term))
            abstract = " ".join(t for _, t in sorted(words))[:4000]
            host = ((w.get("primary_location") or {}).get("source") or {}).get("display_name") or "OpenAlex"
            authors = [a.get("author", {}).get("display_name", "")
                       for a in (w.get("authorships") or [])[:4]]
            out.append(_doc(
                url=w.get("doi") or w.get("id") or "", title=w.get("title") or "",
                text=abstract, source=host, issuer=(authors[0] if authors else host),
                date=w.get("publication_date") or "", type_="paper",
                authority=2 if w.get("is_retracted") else 4,
                tags=[c.get("display_name", "").lower() for c in (w.get("concepts") or [])[:6]],
                cited_by=w.get("cited_by_count"),
                extra={"retracted": bool(w.get("is_retracted")),
                       "open_access": bool((w.get("open_access") or {}).get("is_oa")),
                       "venue": host}))
    return out


def crossref(queries: list[str], per_query: int = 30) -> list[dict]:
    out = []
    for q in queries:
        url = ("https://api.crossref.org/works?query=" + urllib.parse.quote(q)
               + f"&rows={per_query}&sort=published&order=desc&select=DOI,title,abstract,issued,"
                 "container-title,author,type,is-referenced-by-count,publisher&mailto=anveshan@example.org")
        try:
            data = api_json(url, gap=1.0)
        except Exception as exc:
            note_error("crossref", q, exc)
            continue
        for w in (data.get("message") or {}).get("items", []):
            title = (w.get("title") or [""])[0]
            parts = ((w.get("issued") or {}).get("date-parts") or [[None]])[0]
            date = f"{parts[0]}-{parts[1] or 1:02d}-{parts[2] or 1:02d}" if parts and parts[0] else ""
            venue = (w.get("container-title") or [w.get("publisher") or "Crossref"])[0]
            out.append(_doc(
                url=f"https://doi.org/{w['DOI']}" if w.get("DOI") else "", title=title,
                text=re.sub(r"<[^>]+>", " ", w.get("abstract") or title), source=venue,
                issuer=((w.get("author") or [{}])[0].get("family") or w.get("publisher") or venue),
                date=date, type_="preprint" if w.get("type") == "posted-content" else "paper",
                authority=4, cited_by=w.get("is-referenced-by-count"),
                extra={"doi": w.get("DOI"), "venue": venue}))
    return out


# ---------------------------------------------------------------- encyclopaedic
def wikipedia(seeds: list[str], per_seed: int = 6, langs=("en",)) -> list[dict]:
    out = []
    for lang in langs:
        for seed in seeds:
            api = f"https://{lang}.wikipedia.org/w/api.php"
            try:
                search = api_json(
                    f"{api}?action=query&format=json&list=search&srsearch={urllib.parse.quote(seed)}"
                    f"&srlimit={per_seed}&srprop=timestamp", gap=1.2)
            except Exception:
                continue
            titles = [h["title"] for h in (search.get("query") or {}).get("search", [])]
            if not titles:
                continue
            try:
                detail = api_json(
                    f"{api}?action=query&format=json&prop=extracts|pageprops|info&exintro=1&explaintext=1"
                    f"&inprop=url&redirects=1&titles={urllib.parse.quote('|'.join(titles))}", gap=1.2)
            except Exception:
                continue
            for page in ((detail.get("query") or {}).get("pages") or {}).values():
                text = page.get("extract") or ""
                if len(text) < 200:
                    continue
                out.append(_doc(
                    url=page.get("fullurl") or f"https://{lang}.wikipedia.org/wiki/{page.get('title', '')}",
                    title=page.get("title", ""), text=text, source=f"Wikipedia ({lang})",
                    issuer="Wikimedia Foundation", lang=lang, type_="article", authority=3,
                    tags=core.tokenise(seed)[:4]))
    return out


def wikisource(seeds: list[str], per_seed: int = 3, lang: str = "en") -> list[dict]:
    out = []
    for seed in seeds:
        try:
            data = api_json(
                f"https://{lang}.wikisource.org/w/api.php?action=query&format=json&list=search"
                f"&srsearch={urllib.parse.quote(seed)}&srlimit={per_seed}", gap=1.2)
        except Exception:
            continue
        for hit in (data.get("query") or {}).get("search", []):
            title = hit["title"]
            try:
                page = api_json(
                    f"https://{lang}.wikisource.org/w/api.php?action=query&format=json&prop=extracts"
                    f"&explaintext=1&exchars=4000&titles={urllib.parse.quote(title)}", gap=1.2)
            except Exception:
                continue
            for p in ((page.get("query") or {}).get("pages") or {}).values():
                if len(p.get("extract") or "") < 200:
                    continue
                out.append(_doc(url=f"https://{lang}.wikisource.org/wiki/{title.replace(' ', '_')}",
                                title=title, text=p["extract"], source=f"Wikisource ({lang})",
                                issuer="Wikimedia Foundation", type_="text", authority=3))
    return out


# ---------------------------------------------------------------------- archive
def internet_archive(queries: list[str], per_query: int = 20) -> list[dict]:
    out = []
    for q in queries:
        url = ("https://archive.org/advancedsearch.php?q=" + urllib.parse.quote(q)
               + "&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year&fl%5B%5D=creator"
                 "&fl%5B%5D=mediatype&fl%5B%5D=description"
               + f"&rows={per_query}&page=1&output=json&sort%5B%5D=date+desc")
        try:
            data = api_json(url, gap=1.5)
        except Exception:
            continue
        for d in ((data.get("response") or {}).get("docs") or []):
            ident = d.get("identifier")
            if not ident:
                continue
            out.append(_doc(url=f"https://archive.org/details/{ident}",
                            title=d.get("title") or ident,
                            text=re.sub(r"<[^>]+>", " ", str(d.get("description") or ""))[:3000],
                            source="Internet Archive", issuer=d.get("creator") or "Internet Archive",
                            date=str(d.get("year") or ""), type_="archive", authority=3,
                            tags=core.tokenise(q)[:4],
                            extra={"mediatype": d.get("mediatype")}))
    return out


# ------------------------------------------------------------------------- code
def github(queries: list[str], per_query: int = 20) -> list[dict]:
    out = []
    for q in queries:
        url = ("https://api.github.com/search/repositories?q=" + urllib.parse.quote(q)
               + f"&sort=updated&order=desc&per_page={per_query}")
        try:
            data = api_json(url, gap=2.5, accept="application/vnd.github+json")
        except Exception as exc:
            note_error("github", q, exc)
            continue
        for r in data.get("items", []):
            out.append(_doc(url=r.get("html_url") or "", title=r.get("full_name") or "",
                            text=(r.get("description") or "") + " · " + " ".join(r.get("topics") or []),
                            source="GitHub", issuer=(r.get("owner") or {}).get("login") or "GitHub",
                            date=r.get("pushed_at") or "", lang=r.get("language") or "en",
                            type_="code", authority=2, tags=(r.get("topics") or [])[:6],
                            extra={"stars": r.get("stargazers_count"),
                                   "licence": (r.get("license") or {}).get("spdx_id")}))
    return out


# ------------------------------------------------------------- news and feeds
FEEDS = [
    ("Nature", "https://www.nature.com/nature.rss", 5, "science"),
    ("Science", "https://www.science.org/rss/news_current.xml", 4, "science"),
    ("Phys.org", "https://phys.org/rss-feed/", 4, "science"),
    ("arXiv cs.AI", "https://rss.arxiv.org/rss/cs.AI", 5, "paper"),
    ("MIT News", "https://news.mit.edu/rss/feed", 4, "science"),
    ("NASA", "https://www.nasa.gov/news-release/feed/", 5, "space"),
    ("The Hindu", "https://www.thehindu.com/news/national/feeder/default.rss", 3, "news"),
    ("Indian Express", "https://indianexpress.com/section/india/feed/", 3, "news"),
    ("PIB India", "https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3", 5, "policy"),
    ("World Bank", "https://www.worldbank.org/en/news/all?format=rss", 5, "dataset"),
    ("WHO", "https://www.who.int/rss-feeds/news-english.xml", 5, "health"),
    ("Our World in Data", "https://ourworldindata.org/atom.xml", 4, "dataset"),
]


def feeds(limit_per_feed: int = 12) -> list[dict]:
    out = []
    for name, url, authority, kind in FEEDS:
        try:
            xml = core.fetch_text(url, gap=1.5, accept="application/rss+xml, application/atom+xml")
        except Exception as exc:
            note_error("feeds", name, exc)
            continue
        for item in core.feed_items(xml)[:limit_per_feed]:
            summary = item["summary"]
            if len(summary) < 120:            # a headline alone is not a document
                try:
                    page = core.fetch_text(item["link"], gap=1.5)
                    _, desc, text = core.html_to_text(page)
                    summary = (desc + " " + text)[:4000] or summary
                except Exception:
                    pass
            if len(summary) < 80:
                continue
            out.append(_doc(url=item["link"], title=item["title"], text=summary,
                            source=name, issuer=name, date=item["date"],
                            type_=kind, authority=authority,
                            tags=core.tokenise(item["title"])[:5]))
    return out


# ---------------------------------------------------------------- open web pages
def sitemap_pages(sites: list[tuple[str, int, str]], per_site: int = 40) -> list[dict]:
    """
    Crawl recent pages from a site's sitemap, respecting robots.txt.
    `sites` is [(sitemap_url, authority, label)].
    """
    out = []
    for sitemap_url, authority, label in sites:
        try:
            xml = core.fetch_text(sitemap_url, gap=1.0, accept="application/xml")
        except Exception:
            continue
        locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml)
        # prefer dated entries when the sitemap carries them
        dated = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>\s*<lastmod>\s*([^<\s]+)", xml)
        urls = [u for u, _ in sorted(dated, key=lambda p: p[1], reverse=True)] or locs
        if sitemap_url.endswith(".xml") and any(u.endswith(".xml") for u in urls[:5]):
            urls = [u for u in urls if not u.endswith(".xml")]      # index files: skip nesting
        for url in urls[:per_site]:
            try:
                page = core.fetch_text(url, gap=1.5)
            except Exception:
                continue
            title, desc, text = core.html_to_text(page)
            body = (desc + " " + text)[:6000]
            if len(body) < 300:
                continue
            out.append(_doc(url=url, title=title or url, text=body, source=label,
                            issuer=core.domain_of(url), type_="webpage", authority=authority,
                            tags=core.tokenise(title)[:5]))
    return out


SITES = [
    ("https://www.indiacode.nic.in/sitemap.xml", 5, "India Code"),
    ("https://niti.gov.in/sitemap.xml", 5, "NITI Aayog"),
    ("https://www.isro.gov.in/sitemap.xml", 5, "ISRO"),
    ("https://www.rbi.org.in/sitemap.xml", 5, "RBI"),
    ("https://arxiv.org/sitemap.xml", 4, "arXiv"),
    ("https://plos.org/sitemap.xml", 4, "PLOS"),
]

ADAPTERS = {
    "arxiv": arxiv,
    "openalex": openalex,
    "crossref": crossref,
    "wikipedia": wikipedia,
    "wikisource": wikisource,
    "internet_archive": internet_archive,
    "github": github,
    "feeds": feeds,
    "sitemap": sitemap_pages,
}
