# Digest arXiv Reliability Design

**Date:** 2026-03-30

## Goal

Make the `digest` skill's `arxiv` module reliable enough for regular use by replacing the current
fragile remote keyword search flow with a layered fetch strategy:

- English-only query terms
- arXiv official API as the primary source
- local keyword filtering and ranking
- OpenAlex fallback that only returns papers with arXiv mappings

The resulting digest should continue to behave like an arXiv paper collector rather than turning
into a general academic search module.

## Problem

The current Python helper sends broad remote arXiv keyword queries such as:

- `abs:kw1 OR abs:kw2 OR abs:kw3`

combined with category filters. In practice this is brittle:

- large OR queries are more likely to hit timeouts or access throttling
- transient arXiv API failures turn into empty or unusable digest results
- the script currently encodes failures as fake papers inside `arxiv_papers`
- reliability depends on live network behavior instead of predictable local filtering

The user's report is that the current digest implementation can no longer fetch arXiv results
reliably enough to be useful.

## Chosen Approach

Keep arXiv as the primary source, but stop relying on remote keyword search as the core retrieval
mechanism.

The new flow is:

1. Fetch recent papers from arXiv by category and date order only.
2. Filter and rank those papers locally with English keyword matching against title and abstract.
3. If the arXiv fetch fails, or produces no matching results, fall back to OpenAlex.
4. Only keep fallback results that can be mapped back to arXiv.

This trades remote query sophistication for source stability and predictable local logic.

## Primary Fetch Path

The primary source remains the arXiv API at `export.arxiv.org`.

Instead of building one remote boolean query from all configured keywords, the script should:

- request recent papers by category
- sort by submitted date descending
- fetch a bounded result window per category
- apply the digest date cutoff locally
- deduplicate papers across categories by arXiv id or normalized title

Keyword matching then happens locally against the returned metadata.

This keeps the remote query narrow and uses arXiv in the way most likely to survive rate limits and
query quirks.

## Keyword Rules

Digest arXiv keywords are now defined as English search terms only.

Accepted forms:

- single English terms such as `agentic`
- English phrases such as `"llm agent"`
- mixed term sets such as `"tool use" orchestration`

The config note format stays the same, but the runtime contract changes:

- non-English keywords are treated as configuration errors for the arXiv module
- other modules can continue running even if arXiv keywords are invalid
- setup guidance should explicitly instruct the user to use English keywords for arXiv

## OpenAlex Fallback

OpenAlex is the fallback search source, not the primary source.

Fallback triggers when any of the following happens:

- arXiv request returns 403, 429, timeout, connection failure, or server error
- arXiv XML parsing fails
- arXiv fetch succeeds but local filtering yields zero papers
- the config has no arXiv categories, making the official category feed unavailable

Fallback queries are built from the same English keywords and date window. Returned records must be
filtered so the final arXiv digest only contains items that can be mapped back to arXiv, for
example via:

- an arXiv identifier in ids or locations
- an arXiv abstract URL that can be normalized to `https://arxiv.org/abs/...`

Records without an arXiv mapping are discarded.

## Data Model and Error Reporting

The top-level JSON contract should remain compatible for current callers:

- `rss_articles`
- `arxiv_papers`
- `stats`

However, failure signaling should improve. Instead of inserting synthetic error items into
`arxiv_papers`, the script should add a structured `errors` array:

```json
{
  "module": "arxiv",
  "source": "arxiv-api",
  "message": "HTTP 403"
}
```

`arxiv_papers` should contain only real papers.

Each normalized paper record should expose:

- `title`
- `link`
- `published`
- `summary`
- `categories`
- `authors`
- `source`

`source` is internal metadata for deduplication and debugging. It does not require a user-facing
layout change in the generated digest.

## Config Compatibility

No config note migration is needed.

Existing digest config files remain valid because the `### arXiv Search` table structure does not
change. Runtime compatibility rules:

- English keywords + categories: use the full new flow
- categories missing: skip the official arXiv primary path and go directly to OpenAlex fallback
- non-English keywords: record a configuration error for the arXiv module and continue other
  modules

Optional script input flags may be added for clarity, such as:

- `fallback_enabled`
- `require_arxiv_link`

These should default to the reliable behavior so older callers remain compatible.

## Parsing and Ranking Rules

Local keyword filtering should be deterministic and simple:

- compile English terms and quoted phrases into match patterns
- check both title and abstract
- weight title matches higher than abstract matches
- weight multi-keyword matches higher than single-keyword matches
- use recency as a secondary tie-breaker

No embedding search, LLM ranking, or fuzzy semantic matching is needed in the Python script.

## Testing Strategy

Reliability must be proven with deterministic tests rather than live-network success.

Add coverage for:

- English keyword validation
- arXiv Atom parsing from fixed XML samples
- OpenAlex result parsing from fixed JSON samples
- extraction and normalization of arXiv links from fallback records
- deduplication priority: official arXiv over OpenAlex fallback
- structured fallback behavior when arXiv fails
- top-level JSON contract including the new `errors` field

Integration tests should stub external responses rather than making real HTTP requests.

Manual live-network checks are still useful during development, but they are smoke tests only and
must not be required for CI.

## Documentation Changes

Update the digest English and Chinese docs to reflect the new behavior:

- arXiv keywords must be English
- arXiv uses an official recent-paper feed plus local keyword filtering
- OpenAlex is a fallback source for arXiv-mappable papers only
- failures surface through structured errors instead of fake paper rows

Affected docs include:

- `assets/skills/digest/SKILL.en.md`
- `assets/skills/digest/SKILL.zh.md`
- `assets/skills/digest/references/config-parser.en.md`
- `assets/skills/digest/references/config-parser.zh.md`
- `assets/skills/digest/references/run-pipeline.en.md`
- `assets/skills/digest/references/run-pipeline.zh.md`
- `assets/skills/digest/references/setup-guide.en.md`
- `assets/skills/digest/references/setup-guide.zh.md`

## Out of Scope

This change does not:

- replace arXiv with OpenAlex as the primary source
- expand the `arxiv` module into a general scholarly search module
- add real-network integration tests to CI
- redesign RSS, Web Search, HuggingFace, or GitHub fetch logic
