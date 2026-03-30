# Config Note Parsing Rules

This document defines how the `/digest` skill parses config notes stored at `{system directory}/{digest subdirectory}/<TopicName>.md`.

## File Structure

The config note contains the following fixed sections, identified by second-level and third-level headings:

```text
# <TopicName> Digest          ← title only, not parsed
## Basic Info                ← key-value table
## Sources                   ← container heading, not parsed
  ### RSS Feeds              ← module: checkbox + table
  ### Paper Sources          ← module: checkbox + table
  ### arXiv Search           ← legacy module: checkbox + table (still accepted)
  ### Web Search             ← module: checkbox + table + supplemental sites table
  ### HuggingFace Papers     ← module: checkbox + keyword line
  ### GitHub Trending        ← module: checkbox + keyword line
## Categories                ← category table
## Source List               ← not parsed, generated into the digest output
```

## Parsing Rules

### 1. Basic Info

Locate `## Basic Info` and parse the two-column table (`Field | Value`):

| Field | Purpose | Required |
|-------|---------|----------|
| Topic | topic name used in digest title and filename | yes |
| Cadence | `Weekly` / `Biweekly` / `Monthly`, used to determine lookback window | yes |
| Language | digest output language | yes |

**Cadence mapping:**

- `Weekly` → 7 days
- `Biweekly` → 14 days
- `Monthly` → 30 days

### 2. Module Enabled State

The first checkbox after each `###` heading controls whether that module is enabled:

```markdown
### RSS Feeds

- [x] Enabled
```

```markdown
### GitHub Trending

- [ ] Enabled
```

**Parsing logic:**

1. find the `###` heading
2. scan downward to the first line matching `- \[[ x]\]`
3. `[x]` means enabled, `[ ]` means disabled

### 3. Module Data

#### RSS Feeds

Table schema: `Name | URL | Focus`

```json
{
  "enabled": true,
  "feeds": [
    {"name": "Import AI", "url": "https://importai.substack.com", "description": "Frontier AI research commentary"}
  ]
}
```

**URL handling:**

- prepend `https://` when the URL does not start with `http`
- if the URL has no `/feed` or `/rss`, optionally try appending `/feed`

#### Paper Sources

Table schema: `Source Type | Query | Scope | Notes`

```json
{
  "enabled": true,
  "sources": [
    {
      "source_type": "arXiv",
      "query": "\"LLM agent\"",
      "scope": "cs.AI, cs.CL",
      "notes": "Core technical papers"
    },
    {
      "source_type": "bioRxiv",
      "query": "single-cell",
      "scope": "Neuroscience",
      "notes": "Biomedical preprints"
    }
  ]
}
```

**Supported source types:** `arXiv`, `bioRxiv`, `medRxiv`, `ChemRxiv`, `SocArXiv`, `SSRN`.
**Source semantics:** `Query` is the search term or keyword phrase; `Scope` is the category,
collection, or journal filter used by that source; `Notes` is free-form guidance for the helper.
**Normalization:** the helper converts each row into a source adapter input and deduplicates papers
across sources.
**Source-link rules:** `SocArXiv` may normalize to `osf.io` or `socarxiv.com`; `SSRN` must
normalize to `papers.ssrn.com`, `ssrn.com`, or an SSRN DOI.
**Budget rule:** keep one primary request per source and do not paginate.
**Compatibility:** this is the preferred model for new notes.

#### arXiv Search

Table schema: `Keyword | Categories`

```json
{
  "enabled": true,
  "keywords": ["\"LLM agent\"", "\"tool use\" language model"],
  "categories": ["cs.AI", "cs.CL", "cs.IR"],
  "max_results": 200
}
```

**Legacy compatibility:** the parser still accepts `### arXiv Search` and normalizes it into an
`arXiv` paper source so older notes continue to work.
**Keyword language:** keywords must be English terms or English quoted phrases. Treat non-English
keywords as a config error for the arXiv source.
**Category deduplication:** combine all categories from every row and deduplicate them.  
**Primary fetch behavior:** categories drive the official arXiv feed; keyword filtering happens
locally against title and abstract.  
**Fallback behavior:** when categories are missing or the official arXiv path fails, the helper may
fall back to OpenAlex, but only keep papers that map back to arXiv.
**max_results:** fixed at 200 and not exposed in the note.

#### Web Search

Two tables:

1. **Query Template** (`Query Template | Coverage`)
2. **Supplemental Sites** (`Name | URL | Focus`)

Replace `{date range}` at runtime with the actual date span. Supplemental sites are used to build additional `site:` queries.

#### HuggingFace Papers

Locate the `**Filter keywords:**` line and split keywords by commas.

#### GitHub Trending

Same parsing rule as HuggingFace.

### 4. Categories

Locate `## Categories` and parse the table `Category | Coverage`:

```json
{
  "categories": [
    {"name": "Key Papers / Key Articles", "scope": "The 3-5 most important papers or articles this week"},
    {"name": "Frameworks and Tooling", "scope": "Agent frameworks, tooling, SDK updates"}
  ]
}
```

## Tolerance Rules

| Problem | Handling |
|---------|----------|
| unrecognized module heading | ignore that section |
| missing checkbox | treat as enabled |
| mismatched table columns | parse the available cells and fill missing values with empty strings |
| missing required Basic Info field | raise an error and ask the user to complete the note |
| empty or malformed config note | raise an error and suggest running `/digest setup` |
