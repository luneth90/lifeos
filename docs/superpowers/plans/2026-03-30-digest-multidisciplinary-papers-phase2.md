# Digest Multidisciplinary Papers Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add low-budget `SocArXiv` and `SSRN` adapters to digest paper sources, with links normalized back to the source sites.

**Architecture:** Extend the existing Phase 1 OpenAlex-backed paper pipeline instead of adding new fetch stacks. New source-specific link normalization helpers and adapters should plug into `collect_papers()` and reuse the existing ranking, schema normalization, and structured-error model.

**Tech Stack:** Python, OpenAlex HTTP API, Vitest, existing digest bilingual markdown assets

---

### Task 1: Add failing tests for Phase 2 source normalization

**Files:**
- Modify: `tests/assets/digest-rss-arxiv-script.test.ts`
- Test: `tests/assets/digest-rss-arxiv-script.test.ts`

- [ ] **Step 1: Write failing tests for SocArXiv and SSRN link normalization**

Add tests that verify:

- `SocArXiv` keeps `osf.io` and `socarxiv.com`
- `SSRN` keeps `papers.ssrn.com`, `ssrn.com`, and SSRN DOI links
- non-source-site links are rejected

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/assets/digest-rss-arxiv-script.test.ts`

- [ ] **Step 3: Write minimal implementation**

Add source-specific link normalization helpers and any repository constants needed by the new
tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/assets/digest-rss-arxiv-script.test.ts`

- [ ] **Step 5: Commit**

```bash
git add tests/assets/digest-rss-arxiv-script.test.ts assets/skills/digest/references/rss-arxiv-script.py
git commit -m "feat: add phase2 paper source normalization"
```

### Task 2: Add Phase 2 adapters to the papers pipeline

**Files:**
- Modify: `assets/skills/digest/references/rss-arxiv-script.py`
- Modify: `tests/assets/digest-rss-arxiv-script.test.ts`
- Test: `tests/assets/digest-rss-arxiv-script.test.ts`

- [ ] **Step 1: Write failing aggregation tests**

Add tests that verify:

- `collect_socarxiv_source(...)` returns normalized source records
- `collect_ssrn_source(...)` returns normalized source records
- `collect_papers()` routes Phase 2 source rows to the new adapters

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/assets/digest-rss-arxiv-script.test.ts`

- [ ] **Step 3: Write minimal implementation**

Implement:

- source constants for `SocArXiv` and `SSRN`
- repository-filtered OpenAlex fetch wrappers if needed
- `collect_socarxiv_source(...)`
- `collect_ssrn_source(...)`
- `collect_papers()` routing updates
- source priority/display-name updates

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/assets/digest-rss-arxiv-script.test.ts`

- [ ] **Step 5: Commit**

```bash
git add tests/assets/digest-rss-arxiv-script.test.ts assets/skills/digest/references/rss-arxiv-script.py
git commit -m "feat: add SocArXiv and SSRN digest adapters"
```

### Task 3: Update digest bilingual docs

**Files:**
- Modify: `assets/skills/digest/SKILL.en.md`
- Modify: `assets/skills/digest/SKILL.zh.md`
- Modify: `assets/skills/digest/references/setup-guide.en.md`
- Modify: `assets/skills/digest/references/setup-guide.zh.md`
- Modify: `assets/skills/digest/references/config-parser.en.md`
- Modify: `assets/skills/digest/references/config-parser.zh.md`
- Modify: `assets/skills/digest/references/run-pipeline.en.md`
- Modify: `assets/skills/digest/references/run-pipeline.zh.md`
- Test: `tests/cli/utils/assets.test.ts`
- Test: `tests/cli/utils/install-assets.test.ts`
- Test: `tests/cli/utils/lang.test.ts`

- [ ] **Step 1: Write failing asset/documentation expectations**

Update digest asset tests if they need to assert the new Phase 2 source names or phrasing.

- [ ] **Step 2: Run targeted tests to verify they fail**

Run: `npm test -- tests/cli/utils/assets.test.ts tests/cli/utils/install-assets.test.ts tests/cli/utils/lang.test.ts`

- [ ] **Step 3: Write minimal documentation changes**

Document:

- `SocArXiv` and `SSRN` as supported source types
- `SocArXiv` accepting `OSF` landing pages
- low-budget single-request behavior and non-pagination tradeoff

- [ ] **Step 4: Run targeted tests to verify they pass**

Run: `npm test -- tests/cli/utils/assets.test.ts tests/cli/utils/install-assets.test.ts tests/cli/utils/lang.test.ts`

- [ ] **Step 5: Commit**

```bash
git add assets/skills/digest/SKILL.en.md assets/skills/digest/SKILL.zh.md assets/skills/digest/references/setup-guide.en.md assets/skills/digest/references/setup-guide.zh.md assets/skills/digest/references/config-parser.en.md assets/skills/digest/references/config-parser.zh.md assets/skills/digest/references/run-pipeline.en.md assets/skills/digest/references/run-pipeline.zh.md tests/cli/utils/assets.test.ts tests/cli/utils/install-assets.test.ts tests/cli/utils/lang.test.ts
git commit -m "docs: add phase2 digest paper source guidance"
```

### Task 4: Verify and smoke test

**Files:**
- Modify: `docs/superpowers/plans/2026-03-30-digest-multidisciplinary-papers-phase2.md`

- [ ] **Step 1: Run regression suite**

Run:

```bash
npm test -- tests/cli/utils/assets.test.ts tests/cli/utils/install-assets.test.ts tests/cli/utils/lang.test.ts tests/assets/digest-rss-arxiv-script.test.ts
```

- [ ] **Step 2: Run static verification**

Run:

```bash
npm run typecheck
npm run lint
```

- [ ] **Step 3: Run temporary live smoke tests**

Run one-off network probes for:

- `SocArXiv`
- `SSRN`

Keep requests bounded to one primary request per source and do not write permanent tests.

- [ ] **Step 4: Update plan status notes**

Mark completed tasks and record any residual recall/rate-limit tradeoffs.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-03-30-digest-multidisciplinary-papers-phase2.md
git commit -m "docs: update phase2 digest plan status"
```
