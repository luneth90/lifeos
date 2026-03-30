# Run Mode Pipeline

When the user runs `/digest` or `/digest <topic>`, follow this pipeline to fetch updates and generate the digest.

## Preflight

1. Check that Python 3 is available: `python3 --version`
   - unavailable → ask the user to install Python 3 and stop
2. Scan `.md` files under `{system directory}/{digest subdirectory}/`
   - no config files → automatically enter Setup mode (see `setup-guide.md`)
   - topic specified → load only the matching file
   - no topic specified → load every config file and run them one by one

## Execution Pipeline (run per topic)

### Phase 1: Parse the Config

Parse the config note according to `config-parser.md` and produce structured data:

```text
config = {
  topic: "LLM Agent",
  period_days: 7,
  language: "English",
  modules: {
    rss: { enabled, feeds },
    arxiv: { enabled, keywords, categories },
    web: { enabled, queries, sites },
    huggingface: { enabled, keywords },
    github: { enabled, keywords }
  },
  categories: [{ name, scope }]
}
```

Compute the date range:

- `end_date` = today
- `start_date` = today - `period_days`
- `date_range_str` = `MMDD-MMDD` for the filename
- `date_range_display` = `YYYY-MM-DD ~ YYYY-MM-DD` for the title

### Phase 2: Fetch in Parallel

Run enabled modules in parallel. RSS + arXiv use the Python helper; the rest use agent tools.

#### Task A: RSS + arXiv (Python helper)

For arXiv, the helper should use this runtime contract:

1. fetch recent papers from the configured arXiv categories
2. locally filter and rank them with the configured English keywords
3. if the official arXiv path fails, or yields zero matches, fall back to OpenAlex
4. only keep fallback records that normalize back to arXiv links

Build the JSON input and send it through stdin:

```bash
echo '<json_config>' | python3 .agents/skills/digest/references/rss-arxiv-script.py
```

The payload should include at least:

```json
{
  "language": "en",
  "rss": {...},
  "arxiv": {
    "enabled": true,
    "keywords": ["\"llm agent\"", "\"tool use\""],
    "categories": ["cs.AI"],
    "max_results": 200,
    "fallback_enabled": true,
    "require_arxiv_link": true
  },
  "days": 7
}
```

The script returns JSON:

```json
{
  "rss_articles": [...],
  "arxiv_papers": [...],
  "stats": { "rss_count": 12, "arxiv_count": 45 },
  "errors": [...]
}
```

#### Task B: Web Search (WebSearch)

For each query template:

1. replace `{date range}` with the actual date span
2. run WebSearch
3. collect the results

For each supplemental site:

1. build a `site:{url} {topic}` query
2. run WebSearch

Use `defuddle` on high-value results when the article body matters.

#### Task C: HuggingFace Papers (WebFetch)

1. open `https://huggingface.co/papers`
2. filter results with the configured keywords
3. collect title, link, and short description
4. deduplicate against arXiv results with fuzzy title matching

#### Task D: GitHub Trending (WebFetch, optional)

1. open `https://github.com/trending`
2. filter repositories with the configured keywords
3. collect repository name, description, stars, and link

### Phase 3: Merge and Deduplicate

1. **Deduplication**
   - when two items refer to the same paper (title similarity > 80%), keep the richest source
   - priority: arXiv original > HuggingFace > RSS summary > Web search

2. **Categorization**
   - match titles and summaries against the configured category system
   - the "Key Papers / Key Articles" section should contain the 3-5 most important items overall
   - uncategorized items fall back to the last category, usually "Industry Updates"

3. **Summary writing**
   - write a 1-2 sentence English summary for each item
   - include the source link

### Phase 4: Write the Digest

Write `{drafts directory}/{topic_name}-{date_range_str}.md`.

**Frontmatter:**

```yaml
---
title: "{topic_display} Weekly Digest · {date_range_display}"
type: draft
created: "{YYYY-MM-DD}"
status: pending
tags: [digest, {topic_tag}, weekly-digest]
aliases: []
---
```

**Body structure:**

```markdown
# {topic_display} Weekly Digest · {date_range_display}

> Auto-compiled · RSS {N} items · arXiv {M} items · Web {K} additions · Generated at {HH:MM}

## {category_1}

- **[Title](link)** — one-sentence English summary

## {category_2}

...

---

## Sources

**RSS feeds:** {rss_names_list}
**arXiv search:** {arxiv_categories} (filtered by keywords)
**Web search:** {web_sites_list}
**HuggingFace:** huggingface.co/papers
**GitHub:** github.com/trending
```

Only list enabled modules. Omit empty categories.

### Phase 5: Wrap-up

1. call `memory_notify(file_path="{digest file path}")`
2. print the completion message:

```text
Weekly digest written to {drafts directory}/{topic_name}-{date_range_str}.md
RSS {N} items + arXiv {M} items + Web {K} items
```

## Multi-topic Runs

When `/digest` is called without arguments and multiple config files exist:

- run them in filename order
- produce one digest per topic
- print a summary after all topics finish

```text
All weekly digests generated:
- LLM-Agent: 00_Drafts/LLM-Agent-0324-0330.md (RSS 12 + arXiv 45 + Web 8)
- SpatialAI: 00_Drafts/SpatialAI-0324-0330.md (RSS 8 + arXiv 67 + Web 5)
```

## Error Handling

| Error | Handling |
|-------|----------|
| Python unavailable | tell the user to install Python and stop |
| RSS feed timeout | mark that source as failed and continue |
| arXiv API unavailable | record a structured arXiv error and try OpenAlex fallback |
| WebSearch returns nothing | skip that query and continue |
| config parsing fails | raise an error with the concrete problem |
| every source fails | do not generate a digest; report the failure reasons |
