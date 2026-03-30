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
CHEMRXIV_OPENALEX_REPOSITORY_ID = "S4393918830"
ARXIV_LINK_RE = re.compile(
    r"arxiv\.org/(?:abs|pdf)/((?:[a-z\-]+(?:\.[a-z\-]+)?/\d{7})|(?:\d{4}\.\d{4,5}))(?:v\d+)?(?:\.pdf)?",
    re.IGNORECASE,
)
CHEMRXIV_DOI_RE = re.compile(r"10\.26434/chemrxiv[0-9A-Za-z./_-]*", re.IGNORECASE)
CJK_RE = re.compile(r"[\u3400-\u9fff]")
WHITESPACE_RE = re.compile(r"\s+")
QUOTE_RE = re.compile(r'"([^"]+)"')
SOURCE_PRIORITY = {
    "arxiv": 4,
    "biorxiv": 3,
    "medrxiv": 3,
    "chemrxiv": 3,
    "openalex": 1,
}

SOURCE_DISPLAY_NAMES = {
    "arxiv": "arXiv",
    "biorxiv": "bioRxiv",
    "medrxiv": "medRxiv",
    "chemrxiv": "ChemRxiv",
    "openalex": "openalex",
}

SUPPORTED_PAPER_SOURCE_KEYS = {"arxiv", "biorxiv", "medrxiv", "chemrxiv"}


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


def normalize_source_type(source_type: str | None) -> str:
    """Return a canonical lowercase paper source key."""
    if not source_type:
        return ""

    normalized = normalize_whitespace(source_type).lower().replace(" ", "")
    aliases = {
        "arxiv": "arxiv",
        "biorxiv": "biorxiv",
        "medrxiv": "medrxiv",
        "chemrxiv": "chemrxiv",
        "openalex": "openalex",
    }
    return aliases.get(normalized, normalized)


def display_source_type(source_type: str | None) -> str:
    """Return the canonical display name for a paper source."""
    source_key = normalize_source_type(source_type)
    if not source_key:
        return ""
    return SOURCE_DISPLAY_NAMES.get(source_key, source_key)


def normalize_string_list(value: object) -> list[str]:
    """Normalize a config or record field into a flat string list."""
    if value is None:
        return []

    if isinstance(value, list):
        items: list[str] = []
        for item in value:
            if isinstance(item, str):
                cleaned = normalize_whitespace(item)
                if cleaned:
                    items.append(cleaned)
            elif item is not None:
                cleaned = normalize_whitespace(str(item))
                if cleaned:
                    items.append(cleaned)
        return items

    if isinstance(value, str):
        parts = [normalize_whitespace(part) for part in value.split(",")]
        return [part for part in parts if part]

    cleaned = normalize_whitespace(str(value))
    return [cleaned] if cleaned else []


def normalize_published_date(value: object) -> str:
    """Return a YYYY-MM-DD date string when possible."""
    if value is None:
        return ""

    text = normalize_whitespace(str(value))
    if not text:
        return ""

    try:
        published_at = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return published_at.strftime("%Y-%m-%d")
    except Exception:
        match = re.search(r"\d{4}-\d{2}-\d{2}", text)
        return match.group(0) if match else ""


def normalize_paper_title(value: object, language: str | None) -> str:
    """Return a stable title string for a paper record."""
    title = normalize_whitespace(str(value)) if value is not None else ""
    return title or get_messages(language)["untitled"]


def normalize_paper_authors(authors: object, language: str | None) -> str:
    """Normalize paper authors from list or string input."""
    if isinstance(authors, list):
        names = [normalize_whitespace(str(author)) for author in authors if normalize_whitespace(str(author))]
        return format_authors(names, language)

    if isinstance(authors, str):
        return normalize_whitespace(authors)

    if authors is None:
        return ""

    return normalize_whitespace(str(authors))


def normalize_paper_record(
    source_type: str,
    record: dict,
    scope: str,
    language: str | None,
) -> dict[str, str]:
    """Normalize a source-specific record into the unified paper schema."""
    source_key = normalize_source_type(source_type)
    raw_link = record.get("link") or record.get("url") or record.get("doi")
    link = normalize_whitespace(str(raw_link)) if raw_link is not None else ""
    if source_key == "arxiv" and link:
        normalized_link = normalize_arxiv_link(link)
        if normalized_link is not None:
            link = normalized_link
    elif source_key == "openalex" and link:
        normalized_link = normalize_arxiv_link(link)
        if normalized_link is not None:
            link = normalized_link

    categories_value = (
        record.get("categories")
        or record.get("category")
        or record.get("preprint_category")
        or record.get("scope")
        or scope
        or ""
    )
    categories = normalize_whitespace(str(categories_value))
    published = normalize_published_date(
        record.get("published")
        or record.get("published_date")
        or record.get("preprint_date")
        or record.get("date")
        or record.get("publication_date")
    )
    summary_value = (
        record.get("summary")
        or record.get("abstract")
        or record.get("preprint_abstract")
        or record.get("description")
        or ""
    )
    summary = normalize_whitespace(str(summary_value))[:300]
    title = normalize_paper_title(
        record.get("title")
        or record.get("display_name")
        or record.get("preprint_title")
        or record.get("name"),
        language,
    )
    authors = normalize_paper_authors(
        record.get("authors") or record.get("preprint_authors") or record.get("author_names"),
        language,
    )

    normalized_scope = normalize_whitespace(str(record.get("scope") or scope or categories))
    return {
        "title": title,
        "link": link,
        "published": published,
        "summary": summary,
        "categories": categories,
        "authors": authors,
        "source": source_key,
        "source_type": display_source_type(source_key),
        "scope": normalized_scope,
    }


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
            normalize_paper_record(
                "arXiv",
                {
                    "title": normalize_whitespace(title_elem.text),
                    "link": normalized_link,
                    "published": published_at.strftime("%Y-%m-%d"),
                    "summary": normalize_whitespace(summary_elem.text)[:300],
                    "categories": ", ".join(entry_categories[:5]),
                    "authors": authors,
                },
                ", ".join(entry_categories[:5]),
                language,
            )
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


def extract_openalex_author_names(work: dict) -> list[str]:
    """Collect OpenAlex author display names."""
    author_names: list[str] = []
    authorships = work.get("authorships")
    if not isinstance(authorships, list):
        return author_names

    for authorship in authorships:
        if not isinstance(authorship, dict):
            continue
        author = authorship.get("author")
        if not isinstance(author, dict):
            continue
        display_name = author.get("display_name")
        if isinstance(display_name, str):
            author_names.append(display_name)

    return author_names


def extract_openalex_category(work: dict) -> str:
    """Extract the most specific OpenAlex topic label available."""
    primary_topic = work.get("primary_topic")
    if not isinstance(primary_topic, dict):
        return ""

    for field in ["subfield", "field", "domain"]:
        nested = primary_topic.get(field)
        if not isinstance(nested, dict):
            continue
        display_name = nested.get("display_name")
        if isinstance(display_name, str) and display_name:
            return display_name

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


def normalize_openalex_chemrxiv_link(work: dict) -> str | None:
    """Extract a canonical ChemRxiv DOI URL from an OpenAlex work."""
    candidates: list[object] = [work.get("doi")]
    ids = work.get("ids")
    if isinstance(ids, dict):
        candidates.append(ids.get("doi"))

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
            candidates.append(location.get(field))

    for candidate in candidates:
        if not isinstance(candidate, str):
            continue
        matched = CHEMRXIV_DOI_RE.search(normalize_whitespace(candidate))
        if matched:
            return f"https://doi.org/{matched.group(0)}"

    return None


def is_openalex_chemrxiv_work(work: dict) -> bool:
    """Return whether an OpenAlex work can be attributed to ChemRxiv."""
    if normalize_openalex_chemrxiv_link(work) is not None:
        return True

    location_candidates: list[object] = []
    for field in ["primary_location", "best_oa_location"]:
        location_candidates.append(work.get(field))
    locations = work.get("locations")
    if isinstance(locations, list):
        location_candidates.extend(locations)

    for location in location_candidates:
        if not isinstance(location, dict):
            continue
        source = location.get("source")
        if not isinstance(source, dict):
            continue

        source_id = normalize_whitespace(str(source.get("id") or ""))
        display_name = normalize_whitespace(str(source.get("display_name") or ""))
        if source_id.endswith(f"/{CHEMRXIV_OPENALEX_REPOSITORY_ID}") or display_name == "ChemRxiv":
            return True

    return False


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
        author_names = extract_openalex_author_names(work)
        category = extract_openalex_category(work)

        papers.append(
            normalize_paper_record(
                "openalex",
                {
                    "title": normalize_whitespace(str(title)),
                    "link": normalized_link or "",
                    "published": published_at.strftime("%Y-%m-%d"),
                    "summary": extract_openalex_abstract(work),
                    "categories": category,
                    "authors": author_names,
                },
                category,
                language,
            )
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
    source = paper.get("source", "")
    return {
        "title": paper.get("title", ""),
        "link": paper.get("link", ""),
        "published": paper.get("published", ""),
        "summary": paper.get("summary", ""),
        "categories": paper.get("categories", ""),
        "authors": paper.get("authors", ""),
        "source": source,
        "source_type": paper.get("source_type", "") or display_source_type(source),
        "scope": paper.get("scope", "") or paper.get("categories", ""),
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


def fetch_openalex_works(
    query: str,
    cutoff: datetime,
    max_results: int,
    extra_filters: list[str] | None = None,
) -> dict:
    """Run an OpenAlex work search constrained by the digest date window."""
    filters = [f"from_publication_date:{cutoff.date().isoformat()}"]
    if extra_filters:
        filters.extend(filter(None, extra_filters))

    params = urllib.parse.urlencode(
        {
            "search": query,
            "per-page": min(max_results, 100),
            "sort": "publication_date:desc",
            "filter": ",".join(filters),
        }
    )
    request = urllib.request.Request(
        f"{OPENALEX_API_URL}?{params}",
        headers=REQUEST_HEADERS,
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def normalize_paper_sources(config: dict) -> list[dict[str, object]]:
    """Normalize legacy and phase-1 paper source config into runtime entries."""
    sources: list[dict[str, object]] = []

    paper_sources = config.get("paper_sources")
    if isinstance(paper_sources, list):
        for row in paper_sources:
            if not isinstance(row, dict):
                continue

            source_key = normalize_source_type(row.get("source_type"))
            if not source_key:
                continue

            enabled_value = row.get("enabled")
            sources.append(
                {
                    "enabled": bool(enabled_value) if enabled_value is not None else True,
                    "source_type": display_source_type(source_key),
                    "queries": normalize_string_list(row.get("queries") or row.get("query") or row.get("keywords")),
                    "scope": normalize_whitespace(str(row.get("scope") or row.get("categories") or "")),
                    "notes": normalize_whitespace(str(row.get("notes") or "")),
                    "max_results": int(row.get("max_results", 200)) if row.get("max_results") is not None else 200,
                    "fallback_enabled": bool(row.get("fallback_enabled", True)),
                    "require_arxiv_link": bool(row.get("require_arxiv_link", True)),
                }
            )

    arxiv_config = config.get("arxiv")
    if isinstance(arxiv_config, dict) and arxiv_config.get("enabled", False):
        sources.append(
            {
                "enabled": True,
                "source_type": "arXiv",
                "queries": normalize_string_list(arxiv_config.get("keywords")),
                "scope": ", ".join(normalize_string_list(arxiv_config.get("categories"))),
                "notes": "",
                "max_results": int(arxiv_config.get("max_results", 200)),
                "fallback_enabled": bool(arxiv_config.get("fallback_enabled", True)),
                "require_arxiv_link": bool(arxiv_config.get("require_arxiv_link", True)),
            }
        )

    return sources


def parse_biorxiv_results(
    payload: dict,
    cutoff: datetime,
    language: str,
    source_type: str,
    scope: str,
) -> list[dict[str, str]]:
    """Parse bioRxiv/medRxiv API payloads into unified paper records."""
    papers: list[dict[str, str]] = []
    collection = payload.get("collection")
    if not isinstance(collection, list):
        return papers

    for item in collection:
        if not isinstance(item, dict):
            continue

        published = normalize_published_date(item.get("preprint_date") or item.get("published_date") or item.get("date"))
        if not published:
            continue

        published_at = datetime.fromisoformat(f"{published}T00:00:00+00:00")
        if published_at < cutoff:
            continue

        category = normalize_whitespace(str(item.get("preprint_category") or item.get("category") or ""))
        if scope:
            scope_terms = normalize_string_list(scope)
            if scope_terms and not any(term.lower() in category.lower() for term in scope_terms):
                continue

        doi = item.get("biorxiv_doi") or item.get("doi")
        link = ""
        if isinstance(doi, str) and doi:
            link = f"https://doi.org/{normalize_whitespace(doi)}"

        papers.append(
            normalize_paper_record(
                source_type,
                {
                    "title": item.get("preprint_title") or item.get("title"),
                    "link": link,
                    "published": published,
                    "summary": item.get("preprint_abstract") or item.get("abstract"),
                    "authors": item.get("preprint_authors") or item.get("authors"),
                    "categories": category,
                },
                scope or category,
                language,
            )
        )

    return papers


def parse_chemrxiv_results(
    payload: object,
    cutoff: datetime,
    language: str,
    scope: str,
) -> list[dict[str, str]]:
    """Parse ChemRxiv adapter payloads into unified paper records."""
    papers: list[dict[str, str]] = []
    if isinstance(payload, dict):
        records = payload.get("results") or payload.get("collection") or payload.get("items")
    else:
        records = payload

    if not isinstance(records, list):
        return papers

    for item in records:
        if not isinstance(item, dict):
            continue

        is_openalex_record = any(
            key in item for key in ["publication_date", "authorships", "primary_location", "best_oa_location"]
        )
        if is_openalex_record and not is_openalex_chemrxiv_work(item):
            continue

        published = normalize_published_date(
            item.get("published") or item.get("published_date") or item.get("date") or item.get("publication_date")
        )
        if not published:
            continue

        published_at = datetime.fromisoformat(f"{published}T00:00:00+00:00")
        if published_at < cutoff:
            continue

        category_value = item.get("categories") or item.get("category") or extract_openalex_category(item) or scope or ""
        category = normalize_whitespace(str(category_value))
        if scope:
            scope_terms = normalize_string_list(scope)
            if scope_terms and not any(term.lower() in category.lower() for term in scope_terms):
                continue

        link = item.get("link") or item.get("url") or item.get("doi")
        if not link and is_openalex_record:
            link = normalize_openalex_chemrxiv_link(item) or ""

        summary = item.get("summary") or item.get("abstract") or item.get("description")
        if not summary and is_openalex_record:
            summary = extract_openalex_abstract(item)

        authors = item.get("authors") or item.get("author_names")
        if not authors and is_openalex_record:
            authors = extract_openalex_author_names(item)

        papers.append(
            normalize_paper_record(
                "ChemRxiv",
                {
                    "title": item.get("title") or item.get("display_name"),
                    "link": link,
                    "published": published,
                    "summary": summary,
                    "authors": authors,
                    "categories": category,
                },
                scope or category,
                language,
            )
        )

    return papers


def fetch_biorxiv_pubs(server: str, cutoff: datetime) -> dict:
    """Fetch bioRxiv/medRxiv preprints for a date window."""
    interval = f"{cutoff.date().isoformat()}/{datetime.now(timezone.utc).date().isoformat()}"
    request = urllib.request.Request(
        f"https://api.biorxiv.org/details/{server}/{interval}/0/json",
        headers=REQUEST_HEADERS,
    )
    last_error: Exception | None = None
    for _ in range(3):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as error:
            last_error = error

    if last_error is not None:
        raise last_error

    return {"collection": []}


def fetch_chemrxiv_results(source: dict, cutoff: datetime) -> object:
    """Fetch ChemRxiv results via repository-filtered OpenAlex search."""
    query = build_openalex_query(normalize_string_list(source.get("queries")))
    max_results = int(source.get("max_results", 200))
    return fetch_openalex_works(
        query,
        cutoff,
        max_results,
        extra_filters=[f"repository:{CHEMRXIV_OPENALEX_REPOSITORY_ID}"],
    )


def collect_biorxiv_like_source(
    source: dict[str, object],
    cutoff: datetime,
    language: str,
    source_key: str,
    server: str,
) -> dict[str, list[dict[str, str]]]:
    """Collect bioRxiv/medRxiv papers using the official API."""
    queries = [query for query in normalize_string_list(source.get("queries")) if query]
    if any(keyword_contains_non_english(query) for query in queries):
        return {
            "papers": [],
            "errors": [build_error(source_key, "config", f"{display_source_type(source_key)} keywords must be English")],
        }

    expressions = compile_keyword_expressions(queries)
    if not expressions:
        return {
            "papers": [],
            "errors": [],
        }

    try:
        payload = fetch_biorxiv_pubs(server, cutoff)
        candidates = parse_biorxiv_results(payload, cutoff, language, source_key, str(source.get("scope", "")))
        ranked = rank_papers(candidates, expressions)
        max_results = int(source.get("max_results", 200))
        return {
            "papers": deduplicate_papers(ranked)[:max_results],
            "errors": [],
        }
    except Exception as error:
        return {
            "papers": [],
            "errors": [build_error(source_key, "adapter", str(error))],
        }


def collect_arxiv_source(
    source: dict[str, object],
    cutoff: datetime,
    language: str,
) -> dict[str, list[dict[str, str]]]:
    """Collect arXiv papers using official feeds first and OpenAlex fallback second."""
    import time

    queries = [query for query in normalize_string_list(source.get("queries")) if query]
    categories = [category for category in normalize_string_list(source.get("scope")) if category]
    max_results = int(source.get("max_results", 200))
    fallback_enabled = bool(source.get("fallback_enabled", True))
    require_arxiv_link = bool(source.get("require_arxiv_link", True))

    if any(keyword_contains_non_english(keyword) for keyword in queries):
        return {
            "papers": [],
            "errors": [build_error("arxiv", "config", "arXiv keywords must be English")],
        }

    expressions = compile_keyword_expressions(queries)
    if not expressions:
        return {
            "papers": [],
            "errors": [],
        }

    errors: list[dict[str, str]] = []
    primary_candidates: list[dict[str, str]] = []
    per_category_results = max(50, min(100, max_results))

    if categories:
        for index, category in enumerate(dict.fromkeys(categories)):
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
        openalex_payload = fetch_openalex_works(build_openalex_query(queries), cutoff, max_results)
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


def collect_biorxiv_source(
    source: dict[str, object],
    cutoff: datetime,
    language: str,
) -> dict[str, list[dict[str, str]]]:
    """Collect bioRxiv papers."""
    return collect_biorxiv_like_source(source, cutoff, language, "biorxiv", "biorxiv")


def collect_medrxiv_source(
    source: dict[str, object],
    cutoff: datetime,
    language: str,
) -> dict[str, list[dict[str, str]]]:
    """Collect medRxiv papers."""
    return collect_biorxiv_like_source(source, cutoff, language, "medrxiv", "medrxiv")


def collect_chemrxiv_source(
    source: dict[str, object],
    cutoff: datetime,
    language: str,
) -> dict[str, list[dict[str, str]]]:
    """Collect ChemRxiv papers through the adapter boundary."""
    queries = [query for query in normalize_string_list(source.get("queries")) if query]
    if any(keyword_contains_non_english(query) for query in queries):
        return {
            "papers": [],
            "errors": [build_error("chemrxiv", "config", "ChemRxiv keywords must be English")],
        }

    expressions = compile_keyword_expressions(queries)
    if not expressions:
        return {
            "papers": [],
            "errors": [],
        }

    try:
        payload = fetch_chemrxiv_results(source, cutoff)
        candidates = parse_chemrxiv_results(payload, cutoff, language, str(source.get("scope", "")))
        ranked = rank_papers(candidates, expressions)
        max_results = int(source.get("max_results", 200))
        return {
            "papers": deduplicate_papers(ranked)[:max_results],
            "errors": [],
        }
    except Exception as error:
        return {
            "papers": [],
            "errors": [build_error("chemrxiv", "adapter", str(error))],
        }


def collect_papers(
    paper_sources: list[dict[str, object]],
    cutoff: datetime,
    language: str,
    max_results: int = 200,
) -> dict[str, list[dict[str, str]]]:
    """Collect papers across multiple explicit source adapters."""
    papers: list[dict[str, str]] = []
    errors: list[dict[str, str]] = []

    for source in paper_sources:
        if not isinstance(source, dict):
            continue
        if not source.get("enabled", True):
            continue

        source_key = normalize_source_type(str(source.get("source_type") or ""))
        try:
            if source_key == "arxiv":
                result = collect_arxiv_source(source, cutoff, language)
            elif source_key == "biorxiv":
                result = collect_biorxiv_source(source, cutoff, language)
            elif source_key == "medrxiv":
                result = collect_medrxiv_source(source, cutoff, language)
            elif source_key == "chemrxiv":
                result = collect_chemrxiv_source(source, cutoff, language)
            else:
                errors.append(
                    build_error(
                        source_key or "papers",
                        "config",
                        f"Unsupported paper source type: {source.get('source_type')}",
                    )
                )
                continue
        except Exception as error:
            errors.append(build_error(source_key or "papers", "adapter", str(error)))
            continue

        papers.extend(result["papers"])
        errors.extend(result["errors"])

    return {
        "papers": deduplicate_papers(papers)[:max_results],
        "errors": errors,
    }


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
    """Backward-compatible wrapper around the generic papers collector."""
    paper_sources = normalize_paper_sources(
        {
            "arxiv": {
                "enabled": True,
                "keywords": keywords,
                "categories": categories,
                "max_results": max_results,
                "fallback_enabled": fallback_enabled,
                "require_arxiv_link": require_arxiv_link,
            }
        }
    )
    return collect_papers(paper_sources, cutoff, language, max_results)


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

    paper_sources = normalize_paper_sources(config)
    if paper_sources:
        paper_result = collect_papers(paper_sources, cutoff, language, 200)
        arxiv_papers = paper_result["papers"]
        errors.extend(paper_result["errors"])

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
