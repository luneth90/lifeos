---
name: execution-agent-prompt
description: Execution Agent prompt for the Project skill
role: execution
parent_skill: project
---
# Project Execution Agent Instructions

> Path logical names (e.g., `{projects directory}`, `{drafts directory}`) are resolved by the Orchestrator from `lifeos.yaml` and injected into context. See the main skill file `project/SKILL.md` for the mapping.

> This file is run by the `project/SKILL.md` Orchestrator through `spawn_agent` after confirmation validation.
> Replace `{{PROJECT_INPUT}}` with the confirmed project input and obtain the actual plan path from it.

---

Execute the confirmed plan for the following project input: {{PROJECT_INPUT}}

## Step 1: Read the Plan File

Carefully read the plan file and note:

- Project category (learning / development / creative / general)
- Knowledge domain (Domain)
- `project_id` (the stable project ID)
- Final main project path (a Vault-relative path with one `.md` suffix)
- Source draft field (return it to the Orchestrator, which updates status after acceptance)

## Step 2: Obtain Template (Critical)

**Before generating any content**, read `{system directory}/{templates subdirectory}/Project_Template.md`.

Do not guess the structure. Remember:

- Exact Obsidian Callouts format (e.g., `> [!info]`, `> [!note]`)
- Frontmatter field structure

## Step 3: Create Project Note

Path rule: use the confirmed final Vault-relative main project path from the plan directly; do not concatenate `{projects directory}/` or an additional `.md` suffix.

### Persist the Stable ID (Mandatory)

1. First fix the final Vault-relative main project path. Scan every existing `type: project` main
   note under `{projects directory}` and collect its path and `id`. Stop and report an ID that is
   missing, not a YAML string without leading or trailing whitespace, a placeholder, invalid, or
   duplicated; do not allocate against a corrupted ID inventory.
2. When updating an existing project, preserve its current portable ID matching
   `^[a-z0-9][a-z0-9._-]*$`. Never regenerate it because of a rename, move, or version change.
3. For a new project, the planned `project_id` must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`, must not
   contain a double-brace placeholder or `placeholder`, and must not equal `Project_Template` or `project-template`.
4. If an ID conflict appears during plan approval or the final path changes, call
   `_shared/scripts/project_identity.mjs` and validate the result. Do not update and continue: return
   the change so the Orchestrator increments `plan_revision`, updates `confirmed_hash`, and re-confirms.
5. When rendering the template, replace every required placeholder. Write the final `project_id` as a
   quoted ID and write the project category from the plan. Never omit the ID, retain a template
   placeholder, or emit a non-string ID.

### Development Project Directory Convention (Mandatory)

If the project category is `development`, the following rules must be followed during execution:

1. There can only be one main project file, and it must equal the final main project path from the plan
2. If supporting documents are needed, place them in the main project's `Docs/` directory
3. Supporting documents must use `type: project-doc`
4. Supporting documents must include a `project` wikilink to the final main project path
5. Do not create versioned main project files like `ProjectNameV0.2.md`, `ProjectNameV0.3.md`
6. If the plan includes a version roadmap, write version information in the main project's fields or body, not in filenames

Supporting documents use at least these structured Frontmatter machine fields. They have no independent
project ID and no status field:

```markdown
---
title: "<DocumentName>"
type: project-doc
project: "[[<final main project path>]]"
created: "YYYY-MM-DD"
tags: [project-doc]
aliases: []
---
```

**Frontmatter specification:**

```yaml
---
title: "ProjectName"
type: project
category: "[project category from the plan]"
status: active
domain: "[[DomainName]]"
created: "YYYY-MM-DD"
tags: [project]
aliases: []
id: "[final project_id from the plan]"
---
```

If the project category is `development` and the plan has an explicit version roadmap, you may add:

```yaml
current_version: V0.1
target_version: V0.2
```

**C.A.P. Structure (learning projects use mastery table):**

```markdown
## Background

[Project objective and background]

## Content Plan

### Mastery Overview

| Chapter | Mastery | Notes | Wiki |
|---------|---------|-------|------|
| Chapter 1 [Name] | ⚪ Not started | — | — |
| Chapter 2 [Name] | ⚪ Not started | — | — |

<!-- Mastery dot mapping: ⚪ Not started (no note) 🔴 Curation in progress (draft) 🟠 Awaiting review (review) 🟡 Revised, needs reinforcement (revised) 🟢 Mastered (mastered) -->
<!-- /revise will automatically update this table after grading -->

### 📖 Chapter 1: [Chapter Name]

> **Objective:** [What you can do after completing this chapter]

**Reference:** [[{resources directory}/{books subdirectory}/<ResourceName>]] Chapter 1

**Core content:** [3-5 sentence summary]

**Output paths:**
- 📝 Knowledge note: [[{knowledge directory}/{notes subdirectory}/<Domain>/<BookName>/<ChapterName>/<ChapterName>]]
- 📝 Wiki: [[{knowledge directory}/{wiki subdirectory}/<Domain>/ConceptName]]

## Progress

[Progress log area, left empty for user to fill]
```

**Formatting rules:**

- Use wikilinks `[[NoteName]]` to connect all related notes and resources
- Fill in all chapters/phases according to the outline draft in the plan file, do not truncate
- Content must be in English
- Development projects must include a "Project Documents" section in the main project body, stating that supporting documents are stored in the `Docs/` directory

## Step 4: Post-write Self-check (Required Before Returning)

Immediately reread the main project and rescan every `type: project`, confirming that:

- Top-level frontmatter contains exactly one `type` and one `id`, with `id` parsed by YAML as a
  string without leading or trailing whitespace
- `type: project`, and `id` exactly matches the plan's final `project_id`
- A new project ID satisfies strict kebab-case; an updated project ID satisfies the portable format
- The frontmatter ID contains no ID-template placeholder, `Project_Template`, `placeholder`, or other template value
- No other main project uses the same ID

Repair and repeat the reread when any check fails. A successful write operation alone is never a
successful project creation.

## Step 5: Return for Orchestrator Acceptance

- Return the main project path, final ID, source draft path, plan path, and the self-check result
- Do not change source draft status, plan status, or project-scoped memory
- Return a manifest conforming to `Execution_Manifest_Schema.json` with `contract_version`, `run_id`, `phase`,
  `plan_revision`, `confirmed_hash`, `inputs`, `artifacts`, `status_mutations`, `validation`, and `errors`
- The Orchestrator independently accepts the result and confirms scope resolution before updating
  statuses and delivering the project

---

## Completion Report

After completion, report in English:

```
## Project Note Created — Awaiting Acceptance

**Project:** [[ProjectName]] has been created
**Stable project ID:** `[project_id]`
**Knowledge domain:** [Domain]
**Linked Vault resources:** [List actually linked notes and resources]
**ID self-check:** Reread, valid format, and globally unique
**Source draft:** [{drafts directory}/filename.md, or "No source draft"] (status unchanged, awaiting Orchestrator acceptance)
**Plan:** [actual plan path] (remains `status: pending`, awaiting Orchestrator acceptance)

If it is a development project, also include:

**Main project path:** [final main project path]
**Supporting documents directory:** [main project directory]/Docs/
```
