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


def arxiv_query(
    search_query: str, max_results: int, cutoff: datetime, language: str
) -> list[dict[str, str]]:
    """Run a single arXiv API query and return matching papers."""
    params = urllib.parse.urlencode(
        {
            "search_query": search_query,
            "start": 0,
            "max_results": max_results,
            "sortBy": "submittedDate",
            "sortOrder": "descending",
        }
    )

    request = urllib.request.Request(
        f"http://export.arxiv.org/api/query?{params}",
        headers={"User-Agent": "Mozilla/5.0"},
    )
    response = urllib.request.urlopen(request, timeout=60)
    xml_data = response.read()

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
                "title": title_elem.text.strip().replace("\n", " ").replace("  ", " "),
                "link": identifier.text,
                "published": published_at.strftime("%Y-%m-%d"),
                "summary": summary_elem.text.strip()[:300].replace("\n", " "),
                "categories": ", ".join(entry_categories[:5]),
                "authors": format_authors(authors, language),
            }
        )

    return papers


def fetch_arxiv(
    keywords: list[str], categories: list[str], max_results: int, cutoff: datetime, language: str
) -> list[dict[str, str]]:
    """Fetch arXiv results in small batches to avoid rate limits."""
    import time

    if not keywords:
        return []

    messages = get_messages(language)
    batch_size = 5
    per_batch_results = max(max_results // ((len(keywords) + batch_size - 1) // batch_size), 30)
    interval_seconds = 3

    category_filter = ""
    if categories:
        category_filter = " OR ".join([f"cat:{category}" for category in categories])

    batches = [keywords[index:index + batch_size] for index in range(0, len(keywords), batch_size)]

    all_papers: list[dict[str, str]] = []
    seen_links: set[str] = set()

    for batch_index, batch in enumerate(batches):
        if batch_index > 0:
            time.sleep(interval_seconds)

        search_parts = [f"abs:{keyword}" for keyword in batch]
        search_query = " OR ".join(search_parts)
        if category_filter:
            search_query = f"({search_query}) AND ({category_filter})"

        try:
            papers = arxiv_query(search_query, per_batch_results, cutoff, language)
            for paper in papers:
                if paper["link"] not in seen_links:
                    seen_links.add(paper["link"])
                    all_papers.append(paper)
        except Exception as error:
            all_papers.append(
                {
                    "title": build_failure_title(
                        messages["arxiv_batch_failed"].format(index=batch_index + 1), error
                    ),
                    "link": "",
                    "published": "",
                    "summary": "",
                    "categories": "",
                    "authors": "",
                }
            )

    return all_papers


def main() -> None:
    """Read config from stdin, run enabled fetchers, and print JSON."""
    config = json.loads(sys.stdin.read())
    language = normalize_language(config.get("language"))
    days = config.get("days", 7)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    rss_articles: list[dict[str, str]] = []
    arxiv_papers: list[dict[str, str]] = []

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
        arxiv_papers = fetch_arxiv(keywords, categories, max_results, cutoff, language)

    result = {
        "rss_articles": rss_articles,
        "arxiv_papers": arxiv_papers,
        "stats": {
            "rss_count": len([article for article in rss_articles if not article["title"].startswith("[")]),
            "arxiv_count": len([paper for paper in arxiv_papers if not paper["title"].startswith("[")]),
        },
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
