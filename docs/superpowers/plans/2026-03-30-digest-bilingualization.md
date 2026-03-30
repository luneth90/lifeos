# Digest Bilingualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `system.digest` as a first-class configured subdirectory, bilingualize the `digest` skill package, and safely migrate legacy digest config directories during upgrade.

**Architecture:** Extend the vault config model first so init, doctor, and upgrade understand the digest directory. Then convert the digest skill assets to the repository's bilingual asset convention and keep one shared Python fetch script with language-aware fallback strings. Finish by tightening regression coverage around config access, asset language mapping, installation, and upgrade migration.

**Tech Stack:** TypeScript, Vitest, YAML config presets, Markdown asset files, Python 3 helper script

---

### Task 1: Add `system.digest` to config and scaffold behavior

**Files:**
- Modify: `src/config.ts`
- Modify: `assets/lifeos.yaml`
- Modify: `tests/config.test.ts`
- Modify: `tests/cli/init.test.ts`
- Modify: `tests/cli/doctor.test.ts`

- [ ] **Step 1: Write failing config and scaffold tests**

Add failing assertions for:
- `ZH_PRESET.subdirectories.system.digest`
- `EN_PRESET.subdirectories.system.digest`
- `subDirPath('system', 'digest')`
- `lifeos init` creating the digest subdirectory in both languages
- `lifeos doctor` warning when the digest subdirectory is missing

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm test -- tests/config.test.ts tests/cli/init.test.ts tests/cli/doctor.test.ts
```

Expected: FAIL because `system.digest` is not defined yet.

- [ ] **Step 3: Implement the minimal config and scaffold changes**

Add `digest` to the system subdirectory type and both presets, update the bundled
`assets/lifeos.yaml`, and let existing directory creation/checking logic pick it up through the
resolved config.

- [ ] **Step 4: Re-run the focused tests and verify GREEN**

Run:

```bash
npm test -- tests/config.test.ts tests/cli/init.test.ts tests/cli/doctor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts assets/lifeos.yaml tests/config.test.ts tests/cli/init.test.ts tests/cli/doctor.test.ts
git commit -m "feat: add configured digest subdirectory"
```

### Task 2: Add upgrade migration for legacy digest directories

**Files:**
- Modify: `src/cli/commands/upgrade.ts`
- Modify: `tests/cli/upgrade.test.ts`

- [ ] **Step 1: Write failing upgrade migration tests**

Add tests that cover:
- migrating legacy `system/信息` to the configured digest directory when the target does not exist
- leaving both directories untouched when both legacy and target already exist
- persisting `subdirectories.system.digest` after upgrade

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm test -- tests/cli/upgrade.test.ts
```

Expected: FAIL because upgrade does not migrate digest directories yet.

- [ ] **Step 3: Implement the minimal migration logic**

Before writing the upgraded config, detect the legacy digest path under the configured system
directory, rename it only when safe, and keep conflicts conservative.

- [ ] **Step 4: Re-run the focused tests and verify GREEN**

Run:

```bash
npm test -- tests/cli/upgrade.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/upgrade.ts tests/cli/upgrade.test.ts
git commit -m "feat: migrate legacy digest directories on upgrade"
```

### Task 3: Convert digest assets to bilingual layout

**Files:**
- Create: `assets/skills/digest/SKILL.zh.md`
- Create: `assets/skills/digest/SKILL.en.md`
- Create: `assets/skills/digest/references/setup-guide.zh.md`
- Create: `assets/skills/digest/references/setup-guide.en.md`
- Create: `assets/skills/digest/references/config-parser.zh.md`
- Create: `assets/skills/digest/references/config-parser.en.md`
- Create: `assets/skills/digest/references/run-pipeline.zh.md`
- Create: `assets/skills/digest/references/run-pipeline.en.md`
- Modify: `tests/cli/utils/lang.test.ts`
- Modify: `tests/cli/utils/install-assets.test.ts`
- Modify: `tests/cli/utils/assets.test.ts`

- [ ] **Step 1: Write failing language-resolution and install tests**

Add tests that prove:
- `resolveSkillFiles()` maps digest language variants to suffix-free installed paths
- `installSkills(..., 'zh')` and `installSkills(..., 'en')` install different digest content
- the asset bundle contains both digest language variants

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm test -- tests/cli/utils/lang.test.ts tests/cli/utils/install-assets.test.ts tests/cli/utils/assets.test.ts
```

Expected: FAIL because digest still uses the single-file layout.

- [ ] **Step 3: Implement the bilingual asset split**

Replace the single digest markdown files with `.zh.md` / `.en.md` pairs and update path mappings in
the skill content to use the configured digest subdirectory instead of a hardcoded physical path.

- [ ] **Step 4: Re-run the focused tests and verify GREEN**

Run:

```bash
npm test -- tests/cli/utils/lang.test.ts tests/cli/utils/install-assets.test.ts tests/cli/utils/assets.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add assets/skills/digest tests/cli/utils/lang.test.ts tests/cli/utils/install-assets.test.ts tests/cli/utils/assets.test.ts
git commit -m "feat: bilingualize digest skill assets"
```

### Task 4: Localize the shared Python helper script

**Files:**
- Modify: `assets/skills/digest/references/rss-arxiv-script.py`

- [ ] **Step 1: Inspect the script and identify user-visible fallback strings**

List the current Chinese-only comments, docstrings, and runtime placeholders that need to become
English comments plus language-driven runtime strings.

- [ ] **Step 2: Add a minimal verification path**

If a script-focused automated test is cheap to add, create it first and run it to fail. If not,
document the manual verification input/output pairs in the commit message and keep the script
changes narrow.

- [ ] **Step 3: Implement the minimal script localization**

Accept a `language` field in the input config, translate runtime placeholders through a tiny lookup,
and rewrite comments/docstrings in English while keeping the JSON output schema stable.

- [ ] **Step 4: Run the cheapest reliable verification**

Preferred:

```bash
npm test -- <script-test-file>
```

Fallback:

```bash
printf '%s' '{"language":"en","rss":{"enabled":false},"arxiv":{"enabled":false},"days":7}' | python3 assets/skills/digest/references/rss-arxiv-script.py
```

Expected: JSON output with unchanged top-level keys and no script errors.

- [ ] **Step 5: Commit**

```bash
git add assets/skills/digest/references/rss-arxiv-script.py
git commit -m "feat: localize digest helper script output"
```

### Task 5: Run full regression verification

**Files:**
- Modify: `docs/superpowers/plans/2026-03-30-digest-bilingualization.md`

- [ ] **Step 1: Run the complete targeted test set**

Run:

```bash
npm test -- tests/config.test.ts tests/cli/init.test.ts tests/cli/doctor.test.ts tests/cli/upgrade.test.ts tests/cli/utils/lang.test.ts tests/cli/utils/install-assets.test.ts tests/cli/utils/assets.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck if the touched TypeScript code changed**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Update this plan checkbox state to reflect completed work**

Mark completed steps if execution followed this plan closely enough to keep it accurate.

- [ ] **Step 4: Prepare branch completion**

Use `superpowers:verification-before-completion`, then `superpowers:finishing-a-development-branch`
before presenting merge or cleanup options.
