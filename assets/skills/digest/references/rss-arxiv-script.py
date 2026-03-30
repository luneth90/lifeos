#!/usr/bin/env python3
"""
/digest 技能 — RSS + arXiv 参数化抓取脚本

输入：通过 stdin 接收 JSON 配置
输出：stdout 输出 JSON 结果

用法：
  echo '{"rss": {...}, "arxiv": {...}, "days": 7}' | python3 rss-arxiv-script.py
"""

import subprocess, sys, json, re, os
import urllib.request, urllib.parse
from datetime import datetime, timezone, timedelta
import xml.etree.ElementTree as ET


def ensure_dependencies():
    """确保 feedparser 和 requests 已安装"""
    try:
        import feedparser, requests
    except ImportError:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "feedparser", "requests",
             "--break-system-packages", "-q"],
            check=True
        )


def fetch_rss(feeds, cutoff):
    """抓取 RSS 订阅文章"""
    import feedparser, requests
    from email.utils import parsedate_to_datetime

    articles = []
    for feed in feeds:
        url = feed["url"]
        if not url.startswith("http"):
            url = "https://" + url

        try:
            resp = requests.get(url, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
            parsed = feedparser.parse(resp.content)
            for entry in parsed.entries:
                pub = None
                for attr in ["published", "updated"]:
                    if hasattr(entry, attr):
                        try:
                            pub = parsedate_to_datetime(getattr(entry, attr))
                            break
                        except Exception:
                            pass
                if pub is None:
                    pub = datetime.now(timezone.utc)
                if pub.tzinfo is None:
                    pub = pub.replace(tzinfo=timezone.utc)
                if pub >= cutoff:
                    summary = re.sub(r"<[^>]+>", "", getattr(entry, "summary", "") or "")[:300]
                    articles.append({
                        "source": feed.get("name", ""),
                        "title": entry.get("title", "无标题"),
                        "link": entry.get("link", ""),
                        "published": pub.strftime("%Y-%m-%d"),
                        "summary": summary.strip()
                    })
        except Exception as e:
            articles.append({
                "source": feed.get("name", ""),
                "title": f"[抓取失败: {e}]",
                "link": "", "published": "", "summary": ""
            })

    return articles


def _arxiv_query(search_query, max_results, cutoff):
    """单次 arXiv API 查询，返回论文列表"""
    import time

    params = urllib.parse.urlencode({
        'search_query': search_query,
        'start': 0,
        'max_results': max_results,
        'sortBy': 'submittedDate',
        'sortOrder': 'descending'
    })

    req = urllib.request.Request(
        f"http://export.arxiv.org/api/query?{params}",
        headers={"User-Agent": "Mozilla/5.0"}
    )
    resp = urllib.request.urlopen(req, timeout=60)
    xml_data = resp.read()

    papers = []
    ns = {'atom': 'http://www.w3.org/2005/Atom'}
    root = ET.fromstring(xml_data)

    for entry in root.findall('atom:entry', ns):
        id_elem = entry.find('atom:id', ns)
        published_elem = entry.find('atom:published', ns)
        if id_elem is None or published_elem is None:
            continue
        pub_date = datetime.fromisoformat(
            published_elem.text.replace('Z', '+00:00')
        )
        if pub_date >= cutoff:
            title = entry.find('atom:title', ns).text.strip().replace('\n', ' ').replace('  ', ' ')
            summary = entry.find('atom:summary', ns).text.strip()[:300].replace('\n', ' ')
            link = id_elem.text
            entry_categories = [c.get('term') for c in entry.findall('atom:category', ns)]
            authors = [a.find('atom:name', ns).text for a in entry.findall('atom:author', ns)]
            papers.append({
                "title": title,
                "link": link,
                "published": pub_date.strftime("%Y-%m-%d"),
                "summary": summary,
                "categories": ', '.join(entry_categories[:5]),
                "authors": ', '.join(authors[:3]) + (' 等' if len(authors) > 3 else '')
            })

    return papers


def fetch_arxiv(keywords, categories, max_results, cutoff):
    """分批查询 arXiv API，每批最多 5 个关键词，间隔 3 秒，确保不触发限流"""
    import time

    BATCH_SIZE = 5
    PER_BATCH_RESULTS = max(max_results // ((len(keywords) + BATCH_SIZE - 1) // BATCH_SIZE), 30)
    INTERVAL = 3  # arXiv 官方推荐最小间隔

    # 构建类别过滤（所有批次共用）
    cat_filter = ""
    if categories:
        cat_filter = ' OR '.join([f'cat:{cat}' for cat in categories])

    # 按 BATCH_SIZE 分批
    batches = [keywords[i:i + BATCH_SIZE] for i in range(0, len(keywords), BATCH_SIZE)]

    all_papers = []
    seen_links = set()

    for idx, batch in enumerate(batches):
        if idx > 0:
            time.sleep(INTERVAL)

        search_parts = [f'abs:{kw}' for kw in batch]
        search_query = ' OR '.join(search_parts)
        if cat_filter:
            search_query = f'({search_query}) AND ({cat_filter})'

        try:
            papers = _arxiv_query(search_query, PER_BATCH_RESULTS, cutoff)
            for p in papers:
                if p["link"] not in seen_links:
                    seen_links.add(p["link"])
                    all_papers.append(p)
        except Exception as e:
            all_papers.append({
                "title": f"[arXiv 批次 {idx+1} 抓取失败: {e}]",
                "link": "", "published": "", "summary": "",
                "categories": "", "authors": ""
            })

    return all_papers


def main():
    # 读取 stdin JSON 配置
    config = json.loads(sys.stdin.read())
    days = config.get("days", 7)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    rss_articles = []
    arxiv_papers = []

    # RSS 抓取
    rss_config = config.get("rss", {})
    if rss_config.get("enabled", False):
        ensure_dependencies()
        feeds = rss_config.get("feeds", [])
        rss_articles = fetch_rss(feeds, cutoff)

    # arXiv 抓取
    arxiv_config = config.get("arxiv", {})
    if arxiv_config.get("enabled", False):
        keywords = arxiv_config.get("keywords", [])
        categories = arxiv_config.get("categories", [])
        max_results = arxiv_config.get("max_results", 100)
        arxiv_papers = fetch_arxiv(keywords, categories, max_results, cutoff)

    # 输出结果
    result = {
        "rss_articles": rss_articles,
        "arxiv_papers": arxiv_papers,
        "stats": {
            "rss_count": len([a for a in rss_articles if not a["title"].startswith("[")]),
            "arxiv_count": len([p for p in arxiv_papers if not p["title"].startswith("[")])
        }
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
