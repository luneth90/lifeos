# Digest Multidisciplinary Papers Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class `Paper Sources` digest model with backward-compatible legacy `arXiv Search` guidance and implement phase 1 paper adapters for `arXiv`, `bioRxiv`, `medRxiv`, and `ChemRxiv`.

**Architecture:** Keep the existing digest helper path, but refactor its internals from an arXiv-centric collector into a generic papers pipeline. The skill docs become the source of truth for the new config model, while the Python script provides deterministic source adapters, normalization, deduplication, and structured errors for multiple paper sources.

**Tech Stack:** Python 3 helper script, Vitest, Node child-process tests, Markdown skill assets

---

### File Map

**Core runtime**
- Modify: `assets/skills/digest/references/rss-arxiv-script.py`

**Digest docs**
- Modify: `assets/skills/digest/SKILL.en.md`
- Modify: `assets/skills/digest/SKILL.zh.md`
- Modify: `assets/skills/digest/references/config-parser.en.md`
- Modify: `assets/skills/digest/references/config-parser.zh.md`
- Modify: `assets/skills/digest/references/setup-guide.en.md`
- Modify: `assets/skills/digest/references/setup-guide.zh.md`
- Modify: `assets/skills/digest/references/run-pipeline.en.md`
- Modify: `assets/skills/digest/references/run-pipeline.zh.md`

**Tests**
- Modify: `tests/assets/digest-rss-arxiv-script.test.ts`
- Modify: `tests/cli/utils/assets.test.ts`
- Modify: `tests/cli/utils/install-assets.test.ts`
- Modify: `tests/cli/utils/lang.test.ts`

### Task 1: Add failing script tests for the generic papers pipeline

**Files:**
- Modify: `tests/assets/digest-rss-arxiv-script.test.ts`

- [x] **Step 1: Write failing tests for new source adapters**

Add tests that prove:
- the helper can normalize `source_type`-specific records for `arXiv`, `bioRxiv`, `medRxiv`, and
  `ChemRxiv`
- the helper aggregates papers from multiple sources in one run
- one paper source failure returns a structured error without discarding successful sources
- the helper preserves the top-level JSON contract while adding generic paper-source behavior

- [x] **Step 2: Run the focused test file and verify RED**

Run:

```bash
npm test -- tests/assets/digest-rss-arxiv-script.test.ts
```

Expected: FAIL because the helper is still structured primarily around the current `arxiv` config.

- [x] **Step 3: Continue directly to implementation**

Do not add production code before the RED test output is observed.

### Task 2: Refactor the Python helper into a phase 1 multi-source papers collector

**Files:**
- Modify: `assets/skills/digest/references/rss-arxiv-script.py`

- [x] **Step 1: Add source-type parsing and normalized paper helpers**

Implement helper functions that:
- normalize `Paper Sources` rows into runtime entries
- normalize source records into one paper schema
- deduplicate papers across sources
- accumulate structured source-specific errors

- [x] **Step 2: Add phase 1 adapters**

Implement deterministic adapter functions for:
- `arXiv`
- `bioRxiv`
- `medRxiv`
- `ChemRxiv`

Each adapter must return `papers` and `errors` without throwing to the caller on routine failures.

- [x] **Step 3: Keep legacy arXiv behavior compatible**

Allow the helper to continue accepting the current `arxiv` config shape so existing digest runs do
not break while the docs transition to `Paper Sources`.

- [x] **Step 4: Re-run the focused script tests and verify GREEN**

Run:

```bash
npm test -- tests/assets/digest-rss-arxiv-script.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add assets/skills/digest/references/rss-arxiv-script.py tests/assets/digest-rss-arxiv-script.test.ts
git commit -m "feat: add phase1 digest paper source adapters"
```

### Task 3: Update digest docs to the `Paper Sources` model

**Files:**
- Modify: `assets/skills/digest/SKILL.en.md`
- Modify: `assets/skills/digest/SKILL.zh.md`
- Modify: `assets/skills/digest/references/config-parser.en.md`
- Modify: `assets/skills/digest/references/config-parser.zh.md`
- Modify: `assets/skills/digest/references/setup-guide.en.md`
- Modify: `assets/skills/digest/references/setup-guide.zh.md`
- Modify: `assets/skills/digest/references/run-pipeline.en.md`
- Modify: `assets/skills/digest/references/run-pipeline.zh.md`

- [x] **Step 1: Update config docs**

Document:
- the new `### Paper Sources` section
- row fields: `Source Type`, `Query`, `Scope`, `Notes`
- backward compatibility with legacy `### arXiv Search`
- phase 1 supported source types

- [x] **Step 2: Update setup guides**

Make setup explicitly recommend:
- `bioRxiv` / `medRxiv` for biomedical topics
- `ChemRxiv` for chemistry
- `arXiv` for technical / AI topics
- explicit source rows instead of inferred arXiv-only defaults

- [x] **Step 3: Update run pipeline docs**

Describe:
- generic papers collection
- source adapters and structured errors
- backward compatibility for legacy arXiv configs

- [x] **Step 4: Commit**

```bash
git add assets/skills/digest/SKILL.en.md assets/skills/digest/SKILL.zh.md assets/skills/digest/references/config-parser.en.md assets/skills/digest/references/config-parser.zh.md assets/skills/digest/references/setup-guide.en.md assets/skills/digest/references/setup-guide.zh.md assets/skills/digest/references/run-pipeline.en.md assets/skills/digest/references/run-pipeline.zh.md
git commit -m "docs: add digest paper sources model"
```

### Task 4: Verify digest asset regressions

**Files:**
- Modify: `tests/cli/utils/assets.test.ts`
- Modify: `tests/cli/utils/install-assets.test.ts`
- Modify: `tests/cli/utils/lang.test.ts`

- [x] **Step 1: Add any needed asset-content assertions**

If current tests do not already protect the changed docs sufficiently, add focused assertions for:
- `Paper Sources` appearing in installed digest content
- bilingual digest docs still mapping correctly
- the helper asset path still shipping in the bundle

- [x] **Step 2: Run the digest-related regression suite**

Run:

```bash
npm test -- tests/cli/utils/assets.test.ts tests/cli/utils/install-assets.test.ts tests/cli/utils/lang.test.ts tests/assets/digest-rss-arxiv-script.test.ts
```

Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add tests/cli/utils/assets.test.ts tests/cli/utils/install-assets.test.ts tests/cli/utils/lang.test.ts tests/assets/digest-rss-arxiv-script.test.ts
git commit -m "test: cover digest paper sources assets"
```

### Task 5: Run verification and prepare phase 2 handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-03-30-digest-multidisciplinary-papers-phase1.md`

- [x] **Step 1: Run the full phase 1 verification commands**

Run:

```bash
npm test -- tests/cli/utils/assets.test.ts tests/cli/utils/install-assets.test.ts tests/cli/utils/lang.test.ts tests/assets/digest-rss-arxiv-script.test.ts
```

Expected: PASS.

- [x] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [x] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [x] **Step 4: Update this plan checkbox state if execution stays close enough to the plan**

- [x] **Step 5: Document phase 2 follow-up**

Record that `SocArXiv` and `SSRN` remain phase 2 work because they likely need a different source
strategy than the phase 1 preprint adapters.

- [x] **Step 6: Use `superpowers:verification-before-completion` before reporting completion**

Phase 2 follow-up:

- `SocArXiv` and `SSRN` remain intentionally out of phase 1.
- They likely need a different source strategy than the preprint adapters used for `arXiv`,
  `bioRxiv`, `medRxiv`, and `ChemRxiv`.
- The most likely next step is a stable aggregator or feed-oriented design, not direct brittle HTML
  scraping.
