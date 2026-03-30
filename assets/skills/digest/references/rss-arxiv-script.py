#!/usr/bin/env python3
"""
/digest RSS + arXiv fetch helper.

Input: JSON config from stdin.
Output: JSON result on stdout.

Example:
  echo '{"language":"en","rss":{"enabled":false},"arxiv":{"enabled":false},"days":7}' | python3 rss-arxiv-script.py
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone


ARXIV_API_URL = "http://export.arxiv.org/api/query"
OPENALEX_API_URL = "https://api.openalex.org/works"
REQUEST_HEADERS = {"User-Agent": "LifeOS digest/1.0"}
ARXIV_REQUEST_INTERVAL_SECONDS = 3
ARXIV_LINK_RE = re.compile(
    r"arxiv\.org/(?:abs|pdf)/((?:[a-z\-]+(?:\.[a-z\-]+)?/\d{7})|(?:\d{4}\.\d{4,5}))(?:v\d+)?(?:\.pdf)?",
    re.IGNORECASE,
)
CJK_RE = re.compile(r"[\u3400-\u9fff]")
WHITESPACE_RE = re.compile(r"\s+")
QUOTE_RE = re.compile(r'"([^"]+)"')
SOURCE_PRIORITY = {
    "arxiv": 2,
    "openalex": 1,
}


MESSAGES = {
    "zh": {
        "untitled": "无标题",
        "fetch_failed": "抓取失败",
        "arxiv_batch_failed": "arXiv 批次 {index} 抓取失败",
        "author_suffix": " 等",
    },
    "en": {
        "untitled": "Untitled",
        "fetch_failed": "Fetch failed",
        "arxiv_batch_failed": "arXiv batch {index} failed",
        "author_suffix": " et al.",
    },
}


def normalize_language(language: str | None) -> str:
    """Return a supported language key."""
    return "en" if language == "en" else "zh"


def get_messages(language: str | None) -> dict[str, str]:
    """Return the localized message bundle."""
    return MESSAGES[normalize_language(language)]


def format_authors(authors: list[str], language: str | None) -> str:
    """Format author names with a localized overflow suffix."""
    if not authors:
        return ""

    formatted = ", ".join(authors[:3])
    if len(authors) > 3:
        formatted += get_messages(language)["author_suffix"]
    return formatted


def build_failure_title(label: str, error: Exception) -> str:
    """Build a bracketed failure title that keeps the existing JSON contract stable."""
    return f"[{label}: {error}]"


def normalize_whitespace(value: str | None) -> str:
    """Collapse internal whitespace and trim."""
    return WHITESPACE_RE.sub(" ", value or "").strip()


def normalize_title_key(value: str) -> str:
    """Build a loose title key for deduplication."""
    lowered = normalize_whitespace(value).lower()
    return re.sub(r"[^a-z0-9]+", "", lowered)


def strip_arxiv_version(identifier: str) -> str:
    """Drop the trailing arXiv version suffix."""
    return re.sub(r"v\d+$", "", identifier)


def normalize_arxiv_link(link: str | None) -> str | None:
    """Normalize a raw arXiv URL or id to the canonical abs URL."""
    if not link:
        return None

    raw = normalize_whitespace(link)
    if not raw:
        return None

    if raw.startswith("arXiv:"):
        raw = raw[6:]

    bare_match = re.fullmatch(
        r"((?:[a-z\-]+(?:\.[a-z\-]+)?/\d{7})|(?:\d{4}\.\d{4,5}))(?:v\d+)?",
        raw,
        re.IGNORECASE,
    )
    if bare_match:
        return f"https://arxiv.org/abs/{strip_arxiv_version(bare_match.group(1))}"

    matched = ARXIV_LINK_RE.search(raw)
    if not matched:
        return None

    return f"https://arxiv.org/abs/{strip_arxiv_version(matched.group(1))}"


def build_error(module: str, source: str, message: str) -> dict[str, str]:
    """Return a structured error record."""
    return {
        "module": module,
        "source": source,
        "message": normalize_whitespace(message),
    }


def ensure_dependencies() -> None:
    """Install feedparser and requests on demand."""
    try:
        import feedparser  # noqa: F401
        import requests  # noqa: F401
    except ImportError:
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "feedparser",
                "requests",
                "--break-system-packages",
                "-q",
            ],
            check=True,
        )


def fetch_rss(feeds: list[dict[str, str]], cutoff: datetime, language: str) -> list[dict[str, str]]:
    """Fetch RSS articles published after the cutoff."""
    import feedparser
    import requests
    from email.utils import parsedate_to_datetime

    messages = get_messages(language)
    articles: list[dict[str, str]] = []

    for feed in feeds:
        url = feed["url"]
        if not url.startswith("http"):
            url = "https://" + url

        try:
            response = requests.get(url, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
            parsed = feedparser.parse(response.content)
            for entry in parsed.entries:
                published_at = None
                for attr in ["published", "updated"]:
                    if hasattr(entry, attr):
                        try:
                            published_at = parsedate_to_datetime(getattr(entry, attr))
                            break
                        except Exception:
                            pass
                if published_at is None:
                    published_at = datetime.now(timezone.utc)
                if published_at.tzinfo is None:
                    published_at = published_at.replace(tzinfo=timezone.utc)
                if published_at >= cutoff:
                    summary = re.sub(r"<[^>]+>", "", getattr(entry, "summary", "") or "")[:300]
                    articles.append(
                        {
                            "source": feed.get("name", ""),
                            "title": entry.get("title", messages["untitled"]),
                            "link": entry.get("link", ""),
                            "published": published_at.strftime("%Y-%m-%d"),
                            "summary": summary.strip(),
                        }
                    )
        except Exception as error:
            articles.append(
                {
                    "source": feed.get("name", ""),
                    "title": build_failure_title(messages["fetch_failed"], error),
                    "link": "",
                    "published": "",
                    "summary": "",
                }
            )

    return articles


def parse_arxiv_feed(xml_data: bytes, cutoff: datetime, language: str) -> list[dict[str, str]]:
    """Parse an arXiv Atom feed into normalized paper records."""
    papers: list[dict[str, str]] = []
    namespaces = {"atom": "http://www.w3.org/2005/Atom"}
    root = ET.fromstring(xml_data)

    for entry in root.findall("atom:entry", namespaces):
        identifier = entry.find("atom:id", namespaces)
        published_elem = entry.find("atom:published", namespaces)
        title_elem = entry.find("atom:title", namespaces)
        summary_elem = entry.find("atom:summary", namespaces)
        if (
            identifier is None
            or published_elem is None
            or title_elem is None
            or summary_elem is None
            or identifier.text is None
            or published_elem.text is None
            or title_elem.text is None
            or summary_elem.text is None
        ):
            continue

        normalized_link = normalize_arxiv_link(identifier.text)
        if normalized_link is None:
            continue

        published_at = datetime.fromisoformat(published_elem.text.replace("Z", "+00:00"))
        if published_at < cutoff:
            continue

        entry_categories = [category.get("term") or "" for category in entry.findall("atom:category", namespaces)]
        authors = [
            author_name.text
            for author in entry.findall("atom:author", namespaces)
            for author_name in [author.find("atom:name", namespaces)]
            if author_name is not None and author_name.text is not None
        ]
        papers.append(
            {
                "title": normalize_whitespace(title_elem.text),
                "link": normalized_link,
                "published": published_at.strftime("%Y-%m-%d"),
                "summary": normalize_whitespace(summary_elem.text)[:300],
                "categories": ", ".join(entry_categories[:5]),
                "authors": format_authors(authors, language),
                "source": "arxiv",
            }
        )

    return papers


def fetch_recent_arxiv_category(category: str, max_results: int) -> bytes:
    """Fetch recent papers for one arXiv category."""
    params = urllib.parse.urlencode(
        {
            "search_query": f"cat:{category}",
            "start": 0,
            "max_results": max_results,
            "sortBy": "submittedDate",
            "sortOrder": "descending",
        }
    )

    request = urllib.request.Request(
        f"{ARXIV_API_URL}?{params}",
        headers=REQUEST_HEADERS,
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def extract_openalex_abstract(work: dict) -> str:
    """Build a readable abstract from OpenAlex fields."""
    inverted_index = work.get("abstract_inverted_index")
    if isinstance(inverted_index, dict):
        tokens: list[tuple[int, str]] = []
        for word, positions in inverted_index.items():
            if not isinstance(word, str) or not isinstance(positions, list):
                continue
            for position in positions:
                if isinstance(position, int):
                    tokens.append((position, word))
        if tokens:
            return normalize_whitespace(" ".join(word for _, word in sorted(tokens)))[:300]

    abstract = work.get("abstract")
    if isinstance(abstract, str):
        return normalize_whitespace(abstract)[:300]

    return ""


def normalize_openalex_arxiv_link(work: dict) -> str | None:
    """Extract a canonical arXiv abs URL from an OpenAlex work."""
    ids = work.get("ids")
    if isinstance(ids, dict):
        for key in ["arxiv", "openalex"]:
            candidate = ids.get(key)
            if isinstance(candidate, str):
                normalized = normalize_arxiv_link(candidate)
                if normalized is not None:
                    return normalized

    location_candidates: list[object] = []
    for field in ["primary_location", "best_oa_location"]:
        location_candidates.append(work.get(field))
    locations = work.get("locations")
    if isinstance(locations, list):
        location_candidates.extend(locations)

    for location in location_candidates:
        if not isinstance(location, dict):
            continue
        for field in ["landing_page_url", "pdf_url"]:
            candidate = location.get(field)
            if isinstance(candidate, str):
                normalized = normalize_arxiv_link(candidate)
                if normalized is not None:
                    return normalized

    return None


def parse_openalex_results(
    payload: dict,
    cutoff: datetime,
    language: str,
    require_arxiv_link: bool = True,
) -> list[dict[str, str]]:
    """Parse OpenAlex results into normalized paper records."""
    messages = get_messages(language)
    papers: list[dict[str, str]] = []
    results = payload.get("results")
    if not isinstance(results, list):
        return papers

    for work in results:
        if not isinstance(work, dict):
            continue

        published_text = work.get("publication_date")
        if not isinstance(published_text, str):
            continue

        published_at = datetime.fromisoformat(published_text)
        if published_at.tzinfo is None:
            published_at = published_at.replace(tzinfo=timezone.utc)
        if published_at < cutoff:
            continue

        normalized_link = normalize_openalex_arxiv_link(work)
        if require_arxiv_link and normalized_link is None:
            continue

        title = work.get("display_name") or work.get("title") or messages["untitled"]
        authorships = work.get("authorships")
        author_names: list[str] = []
        if isinstance(authorships, list):
            for authorship in authorships:
                if not isinstance(authorship, dict):
                    continue
                author = authorship.get("author")
                if not isinstance(author, dict):
                    continue
                display_name = author.get("display_name")
                if isinstance(display_name, str):
                    author_names.append(display_name)

        category = ""
        primary_topic = work.get("primary_topic")
        if isinstance(primary_topic, dict):
            for field in ["subfield", "field", "domain"]:
                nested = primary_topic.get(field)
                if isinstance(nested, dict):
                    display_name = nested.get("display_name")
                    if isinstance(display_name, str) and display_name:
                        category = display_name
                        break

        papers.append(
            {
                "title": normalize_whitespace(str(title)),
                "link": normalized_link or "",
                "published": published_at.strftime("%Y-%m-%d"),
                "summary": extract_openalex_abstract(work),
                "categories": category,
                "authors": format_authors(author_names, language),
                "source": "openalex",
            }
        )

    return papers


def keyword_contains_non_english(keyword: str) -> bool:
    """Detect whether a keyword includes CJK characters."""
    return CJK_RE.search(keyword) is not None


def compile_keyword_expressions(keywords: list[str]) -> list[list[str]]:
    """Split configured keywords into exact phrases and plain English terms."""
    expressions: list[list[str]] = []
    for keyword in keywords:
        cleaned = normalize_whitespace(keyword)
        if not cleaned:
            continue

        phrases = [normalize_whitespace(value).lower() for value in QUOTE_RE.findall(cleaned)]
        remainder = QUOTE_RE.sub(" ", cleaned)
        terms = [part.lower() for part in remainder.split() if part]
        clauses = [clause for clause in [*phrases, *terms] if clause]
        if clauses:
            expressions.append(clauses)
    return expressions


def score_paper(paper: dict[str, str], expressions: list[list[str]]) -> int:
    """Score one paper against compiled keyword expressions."""
    title = paper.get("title", "").lower()
    summary = paper.get("summary", "").lower()
    best_score = 0

    for expression in expressions:
        expression_score = 0
        matched = True
        for clause in expression:
            if clause in title:
                expression_score += 4
            elif clause in summary:
                expression_score += 2
            else:
                matched = False
                break
        if matched:
            best_score = max(best_score, expression_score + len(expression))

    return best_score


def rank_papers(papers: list[dict[str, str]], expressions: list[list[str]]) -> list[dict[str, str]]:
    """Filter papers by keyword match and attach a ranking score."""
    if not expressions:
        return []

    ranked: list[dict[str, str]] = []
    for paper in papers:
        score = score_paper(paper, expressions)
        if score <= 0:
            continue
        ranked.append({**paper, "score": score})

    ranked.sort(
        key=lambda paper: (
            int(paper.get("score", 0)),
            paper.get("published", ""),
            SOURCE_PRIORITY.get(paper.get("source", ""), 0),
            len(paper.get("summary", "")),
        ),
        reverse=True,
    )
    return ranked


def strip_internal_fields(paper: dict[str, str]) -> dict[str, str]:
    """Remove helper-only fields before returning JSON."""
    return {
        "title": paper.get("title", ""),
        "link": paper.get("link", ""),
        "published": paper.get("published", ""),
        "summary": paper.get("summary", ""),
        "categories": paper.get("categories", ""),
        "authors": paper.get("authors", ""),
        "source": paper.get("source", ""),
    }


def deduplicate_papers(papers: list[dict[str, str]]) -> list[dict[str, str]]:
    """Merge duplicate papers, preferring official arXiv records."""
    chosen: dict[str, dict[str, str]] = {}

    for paper in papers:
        link_key = normalize_arxiv_link(paper.get("link"))
        title_key = normalize_title_key(paper.get("title", ""))
        dedupe_key = link_key or title_key
        if not dedupe_key:
            continue

        existing = chosen.get(dedupe_key)
        current_rank = (
            SOURCE_PRIORITY.get(paper.get("source", ""), 0),
            int(paper.get("score", 0)),
            paper.get("published", ""),
            len(paper.get("summary", "")),
        )
        if existing is None:
            chosen[dedupe_key] = paper
            continue

        existing_rank = (
            SOURCE_PRIORITY.get(existing.get("source", ""), 0),
            int(existing.get("score", 0)),
            existing.get("published", ""),
            len(existing.get("summary", "")),
        )
        if current_rank > existing_rank:
            chosen[dedupe_key] = paper

    normalized = [strip_internal_fields(paper) for paper in chosen.values()]
    normalized.sort(
        key=lambda paper: (
            paper.get("published", ""),
            SOURCE_PRIORITY.get(paper.get("source", ""), 0),
            normalize_title_key(paper.get("title", "")),
        ),
        reverse=True,
    )
    return normalized


def build_openalex_query(keywords: list[str]) -> str:
    """Build a simple OpenAlex fallback query string."""
    parts = [normalize_whitespace(keyword.replace('"', " ")) for keyword in keywords]
    return " ".join(part for part in parts if part)


def fetch_openalex_works(query: str, cutoff: datetime, max_results: int) -> dict:
    """Run an OpenAlex work search constrained by the digest date window."""
    params = urllib.parse.urlencode(
        {
            "search": query,
            "per-page": min(max_results, 100),
            "sort": "publication_date:desc",
            "filter": f"from_publication_date:{cutoff.date().isoformat()}",
        }
    )
    request = urllib.request.Request(
        f"{OPENALEX_API_URL}?{params}",
        headers=REQUEST_HEADERS,
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_arxiv(
    keywords: list[str], categories: list[str], max_results: int, cutoff: datetime, language: str
) -> list[dict[str, str]]:
    """Backward-compatible wrapper that returns only paper rows."""
    return collect_arxiv_papers(
        keywords=keywords,
        categories=categories,
        max_results=max_results,
        cutoff=cutoff,
        language=language,
    )["papers"]


def collect_arxiv_papers(
    keywords: list[str],
    categories: list[str],
    max_results: int,
    cutoff: datetime,
    language: str,
    fallback_enabled: bool = True,
    require_arxiv_link: bool = True,
) -> dict[str, list[dict[str, str]]]:
    """Collect arXiv papers using official feeds first and OpenAlex fallback second."""
    import time

    cleaned_keywords = [normalize_whitespace(keyword) for keyword in keywords if normalize_whitespace(keyword)]
    if any(keyword_contains_non_english(keyword) for keyword in cleaned_keywords):
        return {
            "papers": [],
            "errors": [build_error("arxiv", "config", "arXiv keywords must be English")],
        }

    expressions = compile_keyword_expressions(cleaned_keywords)
    if not expressions:
        return {
            "papers": [],
            "errors": [],
        }

    errors: list[dict[str, str]] = []
    primary_candidates: list[dict[str, str]] = []
    normalized_categories = [normalize_whitespace(category) for category in categories if normalize_whitespace(category)]
    per_category_results = max(50, min(100, max_results))

    if normalized_categories:
        for index, category in enumerate(dict.fromkeys(normalized_categories)):
            if index > 0:
                time.sleep(ARXIV_REQUEST_INTERVAL_SECONDS)
            try:
                xml_data = fetch_recent_arxiv_category(category, per_category_results)
                primary_candidates.extend(parse_arxiv_feed(xml_data, cutoff, language))
            except Exception as error:
                errors.append(build_error("arxiv", "arxiv-api", str(error)))

    primary_ranked = rank_papers(primary_candidates, expressions)
    primary_papers = deduplicate_papers(primary_ranked)[:max_results]
    if primary_papers:
        return {
            "papers": primary_papers,
            "errors": errors,
        }

    if not fallback_enabled:
        return {
            "papers": [],
            "errors": errors,
        }

    try:
        openalex_payload = fetch_openalex_works(build_openalex_query(cleaned_keywords), cutoff, max_results)
        fallback_candidates = parse_openalex_results(
            openalex_payload,
            cutoff,
            language,
            require_arxiv_link=require_arxiv_link,
        )
        fallback_ranked = rank_papers(fallback_candidates, expressions)
        return {
            "papers": deduplicate_papers(fallback_ranked)[:max_results],
            "errors": errors,
        }
    except Exception as error:
        errors.append(build_error("arxiv", "openalex", str(error)))
        return {
            "papers": [],
            "errors": errors,
        }


def main() -> None:
    """Read config from stdin, run enabled fetchers, and print JSON."""
    config = json.loads(sys.stdin.read())
    language = normalize_language(config.get("language"))
    days = config.get("days", 7)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    rss_articles: list[dict[str, str]] = []
    arxiv_papers: list[dict[str, str]] = []
    errors: list[dict[str, str]] = []

    rss_config = config.get("rss", {})
    if rss_config.get("enabled", False):
        ensure_dependencies()
        feeds = rss_config.get("feeds", [])
        rss_articles = fetch_rss(feeds, cutoff, language)

    arxiv_config = config.get("arxiv", {})
    if arxiv_config.get("enabled", False):
        keywords = arxiv_config.get("keywords", [])
        categories = arxiv_config.get("categories", [])
        max_results = arxiv_config.get("max_results", 100)
        fallback_enabled = arxiv_config.get("fallback_enabled", True)
        require_arxiv_link = arxiv_config.get("require_arxiv_link", True)
        arxiv_result = collect_arxiv_papers(
            keywords=keywords,
            categories=categories,
            max_results=max_results,
            cutoff=cutoff,
            language=language,
            fallback_enabled=fallback_enabled,
            require_arxiv_link=require_arxiv_link,
        )
        arxiv_papers = arxiv_result["papers"]
        errors.extend(arxiv_result["errors"])

    result = {
        "rss_articles": rss_articles,
        "arxiv_papers": arxiv_papers,
        "stats": {
            "rss_count": len([article for article in rss_articles if not article["title"].startswith("[")]),
            "arxiv_count": len(arxiv_papers),
        },
        "errors": errors,
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
