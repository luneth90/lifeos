# Managed Assets Rename Rekey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep `managed_assets` metadata aligned when `lifeos rename` changes directory or subdirectory names, so later `lifeos upgrade` smart-merge decisions still work.

**Architecture:** Extend `rename` to rewrite `managed_assets` keys that live under the renamed physical prefix while leaving unrelated metadata untouched. Lock the behavior with CLI tests that prove both metadata rekeying and post-rename smart-merge upgrades still work.

**Tech Stack:** TypeScript, Node.js fs/path, Vitest, YAML

---

### Task 1: Lock The Bug With Failing Tests

**Files:**
- Modify: `tests/cli/rename.test.ts`
- Modify: `tests/cli/upgrade.test.ts`

- [ ] **Step 1: Write the failing rename metadata test**
  Assert that renaming `system` from `90_系统` to `99_系统` rewrites `managed_assets` keys from `90_系统/...` to `99_系统/...`.

- [ ] **Step 2: Write the failing post-rename smart-merge test**
  Rename the system directory, simulate an older managed template version under the new path, then verify `lifeos upgrade` auto-upgrades it instead of conservatively skipping it.

- [ ] **Step 3: Run tests to verify they fail**
  Run: `npm test -- tests/cli/rename.test.ts tests/cli/upgrade.test.ts`
  Expected: FAIL on stale `managed_assets` keys and skipped smart-merge after rename

### Task 2: Implement Metadata Rekeying

**Files:**
- Modify: `src/cli/commands/rename.ts`

- [ ] **Step 1: Add a focused helper to rewrite metadata keys**
  Rekey only `managed_assets` entries whose key matches the renamed physical prefix. Preserve values exactly.

- [ ] **Step 2: Wire the helper into top-level and subdirectory renames**
  Apply the key rewrite before writing `lifeos.yaml` so file moves and metadata stay consistent in the same operation.

- [ ] **Step 3: Run targeted tests**
  Run: `npm test -- tests/cli/rename.test.ts tests/cli/upgrade.test.ts`
  Expected: PASS

### Task 3: Final Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-03-28-managed-assets-rename-rekey.md`

- [ ] **Step 1: Run project verification**
  Run: `npm run typecheck && npm run lint && npm test && npm run build`
  Expected: PASS

- [ ] **Step 2: Review diff scope**
  Run: `git diff -- src/cli/commands/rename.ts tests/cli/rename.test.ts tests/cli/upgrade.test.ts docs/superpowers/plans/2026-03-28-managed-assets-rename-rekey.md`
  Expected: only rename managed-assets rekey changes
