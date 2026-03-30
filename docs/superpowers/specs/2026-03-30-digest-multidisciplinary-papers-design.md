# Digest Multidisciplinary Papers Design

**Date:** 2026-03-30

## Goal

Expand the `digest` skill from an AI-centric `arXiv` paper collector into a configurable
multi-disciplinary papers pipeline that can support:

- medicine and life sciences
- humanities and social sciences
- chemistry
- existing AI / CS workflows

The user should be able to declare paper sources explicitly in the digest config note instead of
relying on the system to infer which scholarly platform fits a topic.

## Problem

The current digest paper flow is still structurally centered on `arXiv`, even after the reliability
work that added local filtering and OpenAlex fallback.

That design breaks down for non-AI domains:

- medicine and experimental biology often publish preprints on `bioRxiv` and `medRxiv`
- humanities and social sciences rarely appear on `arXiv`, and instead use domain-specific
  platforms such as `SocArXiv` and `SSRN`
- chemistry preprints are commonly published on `ChemRxiv`

As a result, the current `arxiv` module cannot serve as a general paper source abstraction.

## Chosen Approach

Introduce a first-class `Paper Sources` module in digest config notes.

Each row declares a `source_type`, query terms, and a scope field. The runtime then chooses a
source-specific adapter based on that explicit declaration. The system no longer guesses whether a
topic is best served by `arXiv`, `bioRxiv`, `medRxiv`, or another platform.

This changes the digest architecture from:

- one arXiv-shaped paper module with limited fallback

to:

- one generic papers module
- multiple source adapters
- a normalized paper record contract

## Config Model

New digest config notes should replace `### arXiv Search` with `### Paper Sources`.

Proposed table:

```markdown
### Paper Sources

- [x] Enabled

| Source Type | Query | Scope | Notes |
|-------------|-------|-------|-------|
| arXiv | "llm agent", "tool use" | cs.AI, cs.CL | English only |
| bioRxiv | single-cell atlas, spatial transcriptomics | neuroscience, genomics | English only |
| medRxiv | sepsis biomarker, ICU monitoring | critical care, clinical trials | English only |
| ChemRxiv | catalyst discovery, polymer electrolyte | catalysis, energy chemistry | English only |
| SocArXiv | social identity, platform governance | sociology, media studies | English only |
| SSRN | behavioral economics, corporate governance | finance, law | English only |
```

Field semantics:

- `Source Type`
  - adapter selector
  - examples: `arXiv`, `bioRxiv`, `medRxiv`, `ChemRxiv`, `SocArXiv`, `SSRN`
- `Query`
  - comma-separated search terms or quoted phrases
  - first implementation assumes English query terms for all paper sources
- `Scope`
  - source-specific filter text
  - `arXiv`: categories such as `cs.AI`
  - preprint sources: collection, discipline, or topical narrowing when supported
- `Notes`
  - user-facing guidance field
  - not required for runtime behavior in the first implementation

## Backward Compatibility

Existing digest notes that use `### arXiv Search` must keep working.

Compatibility rule:

- the skill continues to accept the old `arXiv Search` table
- the runtime normalizes that legacy section into internal `paper_sources` records with
  `source_type = "arXiv"`
- new setup output writes only the new `Paper Sources` section

The system should not automatically rewrite user notes. Digest config files are user content, not
managed assets, and automatic table rewrites are likely to damage manual edits or comments.

## Runtime Data Model

After parsing, the papers module should normalize to:

```text
paper_sources = [
  {
    enabled: true,
    source_type: "bioRxiv",
    queries: ["single-cell atlas", "spatial transcriptomics"],
    scope: "neuroscience, genomics",
    notes: "English only"
  }
]
```

The Python helper then consumes normalized paper source entries and produces a unified output
contract. Each collected paper should include:

- `title`
- `link`
- `published`
- `summary`
- `authors`
- `source`
- `source_type`
- `scope`

This lets the digest summarization pipeline stay source-agnostic.

## Source Adapter Architecture

The paper fetch pipeline should move from one `collect_arxiv_papers(...)` flow to one generic
papers collector:

- `collect_papers(...)`
- per-source adapters such as:
  - `collect_arxiv_source(...)`
  - `collect_biorxiv_source(...)`
  - `collect_medrxiv_source(...)`
  - `collect_chemrxiv_source(...)`
  - `collect_socarxiv_source(...)`
  - `collect_ssrn_source(...)`

Every adapter returns:

- `papers`
- `errors`

One failing source must never stop other paper sources from contributing to the final digest.

## Reliability Strategy

Source selection should follow one consistent rule:

1. prefer official APIs or official feeds
2. otherwise use stable aggregator interfaces
3. avoid site-specific HTML scraping in the first implementation

This mirrors the arXiv reliability work: stable interfaces first, parsing and ranking under local
control, no CI dependence on brittle website markup.

## Supported Sources

### Phase 1 Sources

The first implementation should support:

- `arXiv`
- `bioRxiv`
- `medRxiv`
- `ChemRxiv`

Rationale:

- these cover current AI / CS use cases plus the user's explicit expansion targets in medicine,
  life sciences, and chemistry
- these sources are more naturally preprint-centric than the humanities / social sciences sources
- they are a good fit for a deterministic Python fetch layer

### Phase 2 Sources

The second implementation phase should add:

- `SocArXiv`
- `SSRN`

Rationale:

- these are important for humanities and social sciences
- their source behavior is less uniform than the phase 1 preprint sources
- the safest first implementation is likely to use a stable aggregator layer or carefully chosen
  feed strategy rather than rushing into direct website-specific adapters

## Setup and UX Rules

Digest setup should explicitly guide source choice instead of assuming arXiv everywhere.

Examples:

- biomedical topics
  - recommend `bioRxiv` / `medRxiv`
- chemistry topics
  - recommend `ChemRxiv`
- humanities and social sciences
  - recommend `SocArXiv`, `SSRN`, plus strong RSS and Web search coverage
- technical / AI topics
  - recommend `arXiv`

The setup guides should keep source choice explicit in the generated config, so users can tune
coverage by editing rows instead of rewriting prompts.

## Script Naming

The current helper path is `assets/skills/digest/references/rss-arxiv-script.py`.

That name becomes inaccurate once the script handles multiple paper platforms. However, the first
implementation should keep the existing filename to minimize installer churn and documentation
breakage. The file can be refactored internally into a generic papers collector while preserving
the current asset path.

If the generic papers architecture proves stable, a later cleanup can rename it to a more accurate
name with a compatibility migration.

## Testing Strategy

Because the digest parser is currently a documented skill contract rather than a dedicated TypeScript
parser module, automated coverage should focus on:

- Python adapter and normalization logic
- paper aggregation and error handling
- top-level JSON contract stability
- bilingual skill/reference docs containing the correct new `Paper Sources` model
- asset installation and language mapping remaining valid

Tests should not depend on live network calls. Instead:

- use fixed XML / JSON samples for each source adapter
- verify source-specific normalization into one paper schema
- verify that one source failure does not prevent other sources from succeeding
- verify that legacy `arXiv Search` guidance remains documented for compatibility if needed

## Out of Scope

This change does not:

- introduce automatic note rewriting from old config format to new format
- support every academic paper source on day one
- rely on generic HTML scraping as a core strategy
- redesign digest summary writing or non-paper modules
