# User-Managed Git Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Git from the LifeOS scaffold contract so `init` and `upgrade` stop creating or restoring Git state and users manage version control themselves.

**Architecture:** Keep the change narrow by removing Git bootstrap behavior from CLI setup helpers instead of introducing new flags or abstractions. Update tests and docs to match the new contract: LifeOS manages vault assets and MCP config, not Git metadata.

**Tech Stack:** TypeScript, Vitest, YAML docs, npm

---

## Chunk 1: CLI Behavior

### Task 1: Remove Git from init prerequisites

**Files:**
- Modify: `src/cli/commands/init.ts`
- Test: `tests/cli/init.test.ts`

- [ ] **Step 1: Review current prerequisite behavior**

Read: `src/cli/commands/init.ts`
Expected: Git is listed as a required prerequisite alongside Node.js and Python 3.

- [ ] **Step 2: Update init prerequisite checks**

Change `checkPrerequisites()` so it no longer checks for Git or reports Git in the prerequisite output.

- [ ] **Step 3: Keep Node.js and Python behavior unchanged**

Preserve the current Node.js and Python 3 prerequisite reporting and failure behavior.

### Task 2: Remove Git bootstrap side effects from vault sync

**Files:**
- Modify: `src/cli/utils/sync-vault.ts`
- Test: `tests/cli/init.test.ts`
- Test: `tests/cli/upgrade.test.ts`

- [ ] **Step 1: Write failing tests for the new contract**

Update tests so they expect:
- `init` does not create `.gitignore`
- `init` does not create `.git`
- `upgrade` does not restore `.gitignore`
- `upgrade` does not restore `.git`

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `npm test -- tests/cli/init.test.ts tests/cli/upgrade.test.ts`
Expected: FAIL because the current implementation still creates/restores Git files.

- [ ] **Step 3: Remove Git helper logic**

Delete the `.gitignore` constant and remove the `ensureGitRepository()` / `ensureGitignore()` calls and helper functions from `src/cli/utils/sync-vault.ts`.

- [ ] **Step 4: Run the targeted tests to verify they pass**

Run: `npm test -- tests/cli/init.test.ts tests/cli/upgrade.test.ts`
Expected: PASS

## Chunk 2: Documentation

### Task 3: Update product docs to reflect user-managed Git

**Files:**
- Modify: `README.md`
- Modify: `docs/manual-testing-guide.en.md`
- Modify: `docs/manual-testing-guide.zh.md`
- Modify: `docs/integration-test.en.md`
- Modify: `docs/integration-test.zh.md`

- [ ] **Step 1: Remove Git-as-required language**

Update README prerequisites and scaffold descriptions so Git is no longer listed as required or automatically initialized.

- [ ] **Step 2: Update testing guides**

Remove checklist items and expected output lines that claim `.git` or `.gitignore` are created by LifeOS.

- [ ] **Step 3: Add user-managed wording where helpful**

If a short clarification helps, state that users can initialize Git themselves when they want version control.

## Chunk 3: Final Verification

### Task 4: Verify behavior and dependency/test health

**Files:**
- Verify: `src/cli/commands/init.ts`
- Verify: `src/cli/utils/sync-vault.ts`
- Verify: `tests/cli/init.test.ts`
- Verify: `tests/cli/upgrade.test.ts`
- Verify: `README.md`
- Verify: `docs/manual-testing-guide.en.md`
- Verify: `docs/manual-testing-guide.zh.md`
- Verify: `docs/integration-test.en.md`
- Verify: `docs/integration-test.zh.md`

- [ ] **Step 1: Run focused verification**

Run: `npm test -- tests/cli/init.test.ts tests/cli/upgrade.test.ts`
Expected: PASS

- [ ] **Step 2: Run full project verification**

Run: `npm run release:verify`
Expected: PASS

- [ ] **Step 3: Review the diff**

Run: `git diff -- src/cli/commands/init.ts src/cli/utils/sync-vault.ts tests/cli/init.test.ts tests/cli/upgrade.test.ts README.md docs/manual-testing-guide.en.md docs/manual-testing-guide.zh.md docs/integration-test.en.md docs/integration-test.zh.md`
Expected: Only Git-bootstrap and related doc/test changes appear.
