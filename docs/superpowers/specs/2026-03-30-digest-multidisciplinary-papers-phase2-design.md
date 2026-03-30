# Digest Multidisciplinary Papers Phase 2 Design

## Goal

Add `SocArXiv` and `SSRN` paper-source adapters to digest while preserving the Phase 1
constraints:

- low request budget
- no source-site HTML scraping
- results must normalize back to the source site
- existing `Paper Sources` config schema remains unchanged

## Approved Constraints

- Transport: use aggregator APIs instead of direct source-site scraping
- Link-back requirement:
  - `SocArXiv` may normalize to `osf.io/...` or `socarxiv.com/...`
  - `SSRN` must normalize to `papers.ssrn.com/...`, `ssrn.com/...`, or
    `doi.org/10.2139/ssrn...`
- Request budget:
  - one primary request per source
  - bounded retry only for transient transport failures
  - no multi-page backfill in Phase 2

## Architecture

Phase 2 extends the existing Phase 1 `Paper Sources` pipeline with two new adapters:

- `collect_socarxiv_source(...)`
- `collect_ssrn_source(...)`

Both adapters reuse the existing OpenAlex transport and ranking path. They do not introduce
new fetch stacks or new top-level output formats.

## Source Selection

### SocArXiv

- Primary source selection: OpenAlex repository-filtered work search for SocArXiv
- Record acceptance:
  - keep only results whose location URLs normalize to `osf.io` or `socarxiv.com`
- Canonical link priority:
  1. `socarxiv.com`
  2. `osf.io`
  3. drop record

### SSRN

- Primary source selection: OpenAlex repository-filtered work search for SSRN
- Record acceptance:
  - keep only results whose location URLs normalize to `papers.ssrn.com`, `ssrn.com`, or an
    SSRN DOI
- Canonical link priority:
  1. `papers.ssrn.com`
  2. `ssrn.com`
  3. `doi.org/10.2139/ssrn...`
  4. drop record

## Data Model

Phase 2 continues to emit the existing normalized paper schema:

- `title`
- `link`
- `published`
- `summary`
- `categories`
- `authors`
- `source`
- `source_type`
- `scope`

No top-level JSON contract changes are required.

## Error Handling

- Keep English-only query enforcement for both new sources
- Return structured errors through the existing `errors` array
- Retry only transient transport failures
- Do not synthesize fake paper items on failure

## Testing

Add focused tests for:

- repository/source link normalization for `SocArXiv`
- repository/source link normalization for `SSRN`
- rejection of non-source-site records
- new adapter aggregation in `collect_papers()`
- low-budget transport behavior remaining bounded to one primary request per source

## Documentation

Update digest bilingual docs to mention:

- Phase 2 source support for `SocArXiv` and `SSRN`
- `SocArXiv` accepting `OSF` landing pages as valid source links
- continued low-budget fetch behavior and non-pagination tradeoff

## Tradeoff

Phase 2 favors reliability and rate-limit safety over maximum recall. Because adapters remain
single-request and non-paginated, older or colder matches may be missed. This is intentional.
