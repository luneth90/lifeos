# Upgrade Init Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `lifeos upgrade` reuse the same vault sync responsibilities as `lifeos init` while preserving user-modified files.

**Architecture:** Extract shared vault sync helpers that can run in either initialization or upgrade mode. `init` will create the initial config and then call the shared sync path; `upgrade` will normalize config, call the same sync path with conservative policies, and then persist the merged config and versions.

**Tech Stack:** TypeScript, Vitest, Node.js fs/path APIs, YAML

---

### Task 1: Lock Upgrade Behavior With Failing Tests

**Files:**
- Modify: `tests/cli/upgrade.test.ts`

- [ ] **Step 1: Write the failing tests**
  Add tests covering missing init-created artifacts (`90_系统/记忆`, `CLAUDE.md`, `AGENTS.md`, `.gitignore`, `.claude/skills`, `.git`) and missing MCP `lifeos` entries during `upgrade`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `npm test -- tests/cli/upgrade.test.ts`
  Expected: FAIL on new `upgrade` expectations.

### Task 2: Extract Shared Vault Sync Helpers

**Files:**
- Create: `src/cli/utils/sync-vault.ts`
- Modify: `src/cli/commands/init.ts`
- Modify: `src/cli/commands/upgrade.ts`
- Modify: `src/cli/utils/mcp-register.ts`

- [ ] **Step 1: Write minimal shared sync implementation**
  Move directory creation, reflection subdirectory creation, non-destructive user file setup, git init, `.claude/skills` creation, and MCP backfill logic into shared helpers that accept mode/policy options.

- [ ] **Step 2: Route init and upgrade through the shared helpers**
  `init` should keep first-run behavior; `upgrade` should call the same helpers in conservative mode before updating `lifeos.yaml`.

- [ ] **Step 3: Run focused tests**
  Run: `npm test -- tests/cli/upgrade.test.ts`
  Expected: PASS

### Task 3: Verify CLI Regression Surface

**Files:**
- Modify: `tests/cli/init.test.ts` (only if needed for new shared behavior)
- Modify: `tests/cli/upgrade.test.ts` (final cleanup if needed)

- [ ] **Step 1: Run full CLI test suite**
  Run: `npm test -- tests/cli`
  Expected: PASS

- [ ] **Step 2: Review diffs for scope**
  Run: `git diff -- src/cli/commands/init.ts src/cli/commands/upgrade.ts src/cli/utils/mcp-register.ts src/cli/utils/sync-vault.ts tests/cli/upgrade.test.ts tests/cli/init.test.ts`
  Expected: only shared-sync refactor and coverage changes
