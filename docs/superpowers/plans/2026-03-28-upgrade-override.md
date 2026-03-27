# Upgrade Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `lifeos upgrade --override` so managed assets and managed CLI config files can be force-refreshed without deleting user-generated vault content or memory-system data.

**Architecture:** Extend the upgrade command with a boolean override flag, then thread explicit overwrite modes through `syncVault`, rules-file syncing, and MCP registration. Keep `lifeos.yaml` merge behavior narrow so only managed metadata is refreshed while custom directory and memory config stays intact.

**Tech Stack:** TypeScript, Node.js fs/path, Vitest, YAML

---

### Task 1: Lock Override Behavior With Failing Tests

**Files:**
- Modify: `tests/cli/upgrade.test.ts`

- [ ] **Step 1: Write the failing override tests**
  Cover forced overwrite for managed assets and config files, preservation of custom `lifeos.yaml` directory mappings, and preservation of user-created files like notes and `memory.db`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `npm test -- tests/cli/upgrade.test.ts`
  Expected: FAIL on missing `--override` behavior

### Task 2: Implement Override Modes

**Files:**
- Modify: `src/cli/commands/upgrade.ts`
- Modify: `src/cli/utils/sync-vault.ts`
- Modify: `src/cli/utils/mcp-register.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Parse and route `--override`**
  Add the flag to CLI parsing and choose overwrite modes when it is enabled.

- [ ] **Step 2: Overwrite managed rules and MCP config**
  Teach vault sync to overwrite `CLAUDE.md`, `AGENTS.md`, and MCP integration config when override mode is active.

- [ ] **Step 3: Preserve custom YAML structure**
  Keep `directories`, `subdirectories`, `memory`, and unknown `lifeos.yaml` fields intact while still refreshing version and managed-asset metadata.

- [ ] **Step 4: Run focused tests**
  Run: `npm test -- tests/cli/upgrade.test.ts`
  Expected: PASS

### Task 3: Update User-Facing Docs

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`

- [ ] **Step 1: Document the new flag**
  Add `--override` to the CLI usage text and explain that it overwrites managed assets/config only.

- [ ] **Step 2: Run targeted verification**
  Run: `npm run typecheck && npm test -- tests/cli/upgrade.test.ts && npm run build`
  Expected: PASS

### Task 4: Final Verification

**Files:**
- Modify: `docs/superpowers/specs/2026-03-28-upgrade-override-design.md`
- Modify: `docs/superpowers/plans/2026-03-28-upgrade-override.md`

- [ ] **Step 1: Run project verification**
  Run: `npm run lint && npm test && npm run build`
  Expected: PASS

- [ ] **Step 2: Review final diff**
  Run: `git diff -- src/cli/commands/upgrade.ts src/cli/utils/sync-vault.ts src/cli/utils/mcp-register.ts src/cli/index.ts tests/cli/upgrade.test.ts README.md README.en.md docs/superpowers/specs/2026-03-28-upgrade-override-design.md docs/superpowers/plans/2026-03-28-upgrade-override.md`
  Expected: only override-related changes
