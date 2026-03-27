# Managed Assets Hash Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store managed asset hashes in `lifeos.yaml` and use them during `upgrade` so unchanged built-in files auto-upgrade while user-modified files are preserved.

**Architecture:** Add a small managed-asset metadata helper for hashing and metadata writes, then thread that metadata through the existing asset installers and `syncVault`. `init` will persist the first metadata baseline; `upgrade` will compare current file hashes against the stored baseline before deciding whether to overwrite or skip.

**Tech Stack:** TypeScript, Node.js crypto/fs, Vitest, YAML

---

### Task 1: Lock Expected Behavior With Failing Tests

**Files:**
- Modify: `tests/cli/init.test.ts`
- Modify: `tests/cli/upgrade.test.ts`

- [ ] **Step 1: Write the failing init test**
  Assert that `lifeos.yaml` contains `managed_assets` entries after initialization.

- [ ] **Step 2: Run test to verify it fails**
  Run: `npm test -- tests/cli/init.test.ts`
  Expected: FAIL on missing `managed_assets`

- [ ] **Step 3: Write the failing upgrade tests**
  Cover auto-upgrade for unchanged tracked files and conservative skip when metadata is absent.

- [ ] **Step 4: Run test to verify it fails**
  Run: `npm test -- tests/cli/upgrade.test.ts`
  Expected: FAIL on new managed-assets expectations

### Task 2: Implement Managed Asset Metadata

**Files:**
- Create: `src/cli/utils/managed-assets.ts`
- Modify: `src/config.ts`
- Modify: `src/cli/utils/install-assets.ts`
- Modify: `src/cli/utils/sync-vault.ts`
- Modify: `src/cli/commands/init.ts`
- Modify: `src/cli/commands/upgrade.ts`

- [ ] **Step 1: Add metadata types and hash helpers**
  Define the `managed_assets` config shape and helper functions for SHA-256 entries.

- [ ] **Step 2: Thread metadata through asset sync**
  Update installer logic so tracked files refresh metadata on install/unchanged paths and preserve old metadata on skipped user-modified paths.

- [ ] **Step 3: Persist metadata in init and upgrade**
  Write managed metadata back into `lifeos.yaml` after sync completes.

- [ ] **Step 4: Run focused tests**
  Run: `npm test -- tests/cli/init.test.ts tests/cli/upgrade.test.ts`
  Expected: PASS

### Task 3: Verify Regression Surface

**Files:**
- Modify: `tests/cli/utils/install-assets.test.ts` (if needed)

- [ ] **Step 1: Run full verification**
  Run: `npm run typecheck && npm run lint && npm test && npm run build`
  Expected: PASS

- [ ] **Step 2: Review diff for scope**
  Run: `git diff -- src/config.ts src/cli/commands/init.ts src/cli/commands/upgrade.ts src/cli/utils/install-assets.ts src/cli/utils/sync-vault.ts src/cli/utils/managed-assets.ts tests/cli/init.test.ts tests/cli/upgrade.test.ts tests/cli/utils/install-assets.test.ts docs/superpowers/specs docs/superpowers/plans`
  Expected: only managed-assets metadata and tests
