# Release Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an automated release flow that publishes `lifeos` to npm and creates a GitHub Release when a `vX.Y.Z` tag is pushed.

**Architecture:** Keep release-critical rules in small local Node scripts that are exercised by tests, then call those scripts from a GitHub Actions release workflow. Use the workflow only as orchestration for validation, packaging, npm publish, and GitHub Release creation.

**Tech Stack:** Node.js ESM scripts, GitHub Actions, Vitest, npm CLI

---

### Task 1: Lock Release Helper Behavior With Failing Tests

**Files:**
- Create: `tests/scripts/release/check-version.test.ts`
- Create: `tests/scripts/release/pack.test.ts`

- [ ] **Step 1: Write the failing version-check tests**
  Cover matching tag, missing tag, invalid tag format, and mismatched tag behavior.

- [ ] **Step 2: Run test to verify it fails**
  Run: `npm test -- tests/scripts/release/check-version.test.ts`
  Expected: FAIL because the release helper does not exist yet.

- [ ] **Step 3: Write the failing pack-helper tests**
  Cover parsing the tarball name from `npm pack` output and rejecting empty output.

- [ ] **Step 4: Run test to verify it fails**
  Run: `npm test -- tests/scripts/release/pack.test.ts`
  Expected: FAIL because the pack helper does not exist yet.

### Task 2: Implement Local Release Helpers

**Files:**
- Create: `scripts/release/check-version.mjs`
- Create: `scripts/release/pack.mjs`

- [ ] **Step 1: Implement minimal version validation helper**
  Read `package.json`, normalize the tag, validate `vX.Y.Z`, and fail on mismatch.

- [ ] **Step 2: Run version-check tests**
  Run: `npm test -- tests/scripts/release/check-version.test.ts`
  Expected: PASS

- [ ] **Step 3: Implement minimal pack helper**
  Run `npm pack`, parse the generated tarball filename, and print it for workflow use.

- [ ] **Step 4: Run pack-helper tests**
  Run: `npm test -- tests/scripts/release/pack.test.ts`
  Expected: PASS

### Task 3: Wire Scripts Into Package Scripts And Workflow

**Files:**
- Modify: `package.json`
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Add release-oriented npm scripts**
  Add scripts for version checking, verification, and packing so local release rehearsal matches CI.

- [ ] **Step 2: Add the release workflow**
  Trigger on `v*` tags and `workflow_dispatch`, run the verification scripts, publish to npm, create the GitHub Release, and upload the tarball.

- [ ] **Step 3: Run targeted tests**
  Run: `npm test -- tests/scripts/release/check-version.test.ts tests/scripts/release/pack.test.ts`
  Expected: PASS

### Task 4: Verify Repository-Level Release Readiness

**Files:**
- Modify: `README.md` (if needed)

- [ ] **Step 1: Run project verification**
  Run: `npm run typecheck && npm run lint && npm test && npm run build`
  Expected: PASS

- [ ] **Step 2: Rehearse packaging locally**
  Run: `npm run release:verify && npm run release:pack`
  Expected: PASS and print a `.tgz` package filename

- [ ] **Step 3: Review diff for scope**
  Run: `git diff -- package.json .github/workflows/release.yml scripts/release tests/scripts/release README.md docs/superpowers/specs docs/superpowers/plans`
  Expected: only release automation docs, helpers, tests, and workflow changes
