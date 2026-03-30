# Digest arXiv Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the digest arXiv module's fragile remote keyword search with a reliable primary arXiv feed plus OpenAlex arXiv-only fallback, while keeping the skill contract compatible.

**Architecture:** Keep the Python helper as the execution unit, but split arXiv behavior into pure parsing, local filtering, and fallback orchestration. Primary retrieval becomes category-based arXiv fetching, keyword matching moves local, and fallback results are accepted only when they normalize back to arXiv links. Digest docs are updated so the user-facing contract matches the new runtime behavior.

**Tech Stack:** Python 3 helper script, Vitest, Node child-process script tests, Markdown skill docs

---

### Task 1: Add failing regression tests for the new arXiv behavior

**Files:**
- Modify: `tests/assets/digest-rss-arxiv-script.test.ts`

- [x] **Step 1: Write failing tests for reliable arXiv behavior**

Add tests for:
- rejecting non-English arXiv keywords with structured errors
- preferring parsed arXiv API papers over OpenAlex duplicates
- falling back to OpenAlex when the arXiv request path fails
- keeping only fallback results that normalize to arXiv links
- returning real papers in `arxiv_papers` and structured failures in `errors`

- [x] **Step 2: Run the focused test file and verify RED**

Run:

```bash
npm test -- tests/assets/digest-rss-arxiv-script.test.ts
```

Expected: FAIL because the current script still uses the old query path and fake failure items.

- [x] **Step 3: Commit the failing-test checkpoint only if the repo workflow needs it**

Otherwise continue directly to implementation.

### Task 2: Refactor the Python helper around pure parsing and fallback helpers

**Files:**
- Modify: `assets/skills/digest/references/rss-arxiv-script.py`

- [x] **Step 1: Add pure helper functions**

Introduce focused helpers for:
- English keyword validation and compilation
- local paper scoring against title + summary
- arXiv Atom parsing from XML
- OpenAlex parsing and arXiv link normalization
- structured error collection
- result deduplication with source priority

- [x] **Step 2: Replace the primary arXiv fetch strategy**

Implement category-based recent-paper retrieval and local filtering instead of the current remote
keyword boolean query.

- [x] **Step 3: Add OpenAlex fallback orchestration**

Trigger fallback on transport failures, parse failures, missing categories, or zero filtered arXiv
results. Keep only records that map back to arXiv.

- [x] **Step 4: Keep the top-level JSON contract compatible**

Return:

```json
{
  "rss_articles": [...],
  "arxiv_papers": [...],
  "stats": {...},
  "errors": [...]
}
```

`arxiv_papers` must contain only real papers.

- [x] **Step 5: Re-run the focused script tests and verify GREEN**

Run:

```bash
npm test -- tests/assets/digest-rss-arxiv-script.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add assets/skills/digest/references/rss-arxiv-script.py tests/assets/digest-rss-arxiv-script.test.ts
git commit -m "feat: harden digest arxiv fetching"
```

### Task 3: Update digest docs for the new arXiv runtime contract

**Files:**
- Modify: `assets/skills/digest/SKILL.en.md`
- Modify: `assets/skills/digest/SKILL.zh.md`
- Modify: `assets/skills/digest/references/config-parser.en.md`
- Modify: `assets/skills/digest/references/config-parser.zh.md`
- Modify: `assets/skills/digest/references/run-pipeline.en.md`
- Modify: `assets/skills/digest/references/run-pipeline.zh.md`
- Modify: `assets/skills/digest/references/setup-guide.en.md`
- Modify: `assets/skills/digest/references/setup-guide.zh.md`

- [x] **Step 1: Update the config parser docs**

Document that arXiv keywords must be English and that missing categories force fallback behavior.

- [x] **Step 2: Update the setup guides**

Tell the user explicitly to provide English arXiv keywords and reasonably narrow categories.

- [x] **Step 3: Update the run pipeline and skill overview**

Document:
- primary arXiv category feed + local filtering
- OpenAlex arXiv-only fallback
- structured `errors` output from the Python helper

- [x] **Step 4: Commit**

```bash
git add assets/skills/digest/SKILL.en.md assets/skills/digest/SKILL.zh.md assets/skills/digest/references/config-parser.en.md assets/skills/digest/references/config-parser.zh.md assets/skills/digest/references/run-pipeline.en.md assets/skills/digest/references/run-pipeline.zh.md assets/skills/digest/references/setup-guide.en.md assets/skills/digest/references/setup-guide.zh.md
git commit -m "docs: update digest arxiv reliability guidance"
```

### Task 4: Run regression verification

**Files:**
- Modify: `docs/superpowers/plans/2026-03-30-digest-arxiv-reliability.md`

- [x] **Step 1: Run the focused script regression tests**

Run:

```bash
npm test -- tests/assets/digest-rss-arxiv-script.test.ts
```

Expected: PASS.

- [x] **Step 2: Run the broader digest-related test set**

Run:

```bash
npm test -- tests/cli/utils/assets.test.ts tests/cli/utils/install-assets.test.ts tests/cli/utils/lang.test.ts tests/assets/digest-rss-arxiv-script.test.ts
```

Expected: PASS.

- [x] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [x] **Step 5: Update this plan checkbox state if execution stays close enough to the plan**

- [x] **Step 6: Use `superpowers:verification-before-completion` before reporting completion**
