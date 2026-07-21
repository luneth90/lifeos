---
name: execution-agent-prompt
description: Execution Agent prompt for the Project skill
role: execution
parent_skill: project
---
# Project Execution Agent Instructions

> Path logical names (e.g., `{projects directory}`, `{drafts directory}`) are resolved by the Orchestrator from `lifeos.yaml` and injected into context. See the main skill file `project/SKILL.md` for the mapping.

> This file is read by the `project/SKILL.md` Orchestrator after the user confirms the plan, and used as the complete prompt for the Task tool.
> Replace `[plan file path]` with the actual plan file path when using.

---

Execute the project plan at the following path: [plan file path]

## Step 1: Read the Plan File

Carefully read the plan file and note:

- Project category (learning / development / creative / general)
- Knowledge domain (Domain)
- `project_id` (the stable project ID)
- Final Vault-relative main project path
- Source draft field (return it to the Orchestrator, which updates status after acceptance)

## Step 2: Obtain Template (Critical)

**Before generating any content**, read `{system directory}/{templates subdirectory}/Project_Template.md`.

Do not guess the structure. Remember:

- Exact Obsidian Callouts format (e.g., `> [!info]`, `> [!note]`)
- Frontmatter field structure

## Step 3: Create Project Note

Path rules:

- `development`: must create `{projects directory}/ProjectName/ProjectName.md`
- `learning / creative / general`: may create `{projects directory}/ProjectName.md`, or use `{projects directory}/ProjectName/ProjectName.md` when there are many files

### Persist the Stable ID (Mandatory)

1. First fix the final Vault-relative main project path. Scan every existing `type: project` main
   note under `{projects directory}` and collect its path and `id`. Stop and report an ID that is
   missing, not a YAML string without leading or trailing whitespace, a placeholder, invalid, or
   duplicated; do not allocate against a corrupted ID inventory.
2. When updating an existing project, preserve its current portable ID matching
   `^[a-z0-9][a-z0-9._-]*$`. Never regenerate it because of a rename, move, or version change.
3. For a new project, the planned `project_id` must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`, must not
   contain `{{...}}` or `placeholder`, and must not equal `Project_Template` or `project-template`.
4. If an ID conflict appeared during plan approval or the final path changed, recompute with this
   algorithm and update the plan's ID and final path before creating the file:
   - Try the project title and then the main filename without its extension. Apply NFKD
     normalization, remove combining marks, lowercase it, replace runs of non-ASCII alphanumerics
     with `-`, and trim leading or trailing `-`. Continue to the next source for an unusable candidate.
   - Use a unique base slug directly. Otherwise, NFC-normalize the complete Vault-relative path,
     including `.md`, convert separators to `/`, and compute SHA-256 over its UTF-8 bytes.
   - With no slug use `project-<first-10-hex>`; on a slug conflict use
     `<slug>-<first-10-hex>`. Extend the digest by two characters until unique, then append `-2`,
     `-3`, and so on only if a full digest still conflicts.
5. When rendering the template, replace `id: "{{ID}}"` with the quoted
   `id: "<final-project_id>"`. Never omit `id`, retain a template placeholder, or emit a non-string ID.

### Development Project Directory Convention (Mandatory)

If the project category is `development`, the following rules must be followed during execution:

1. There can only be one main project file: `{projects directory}/ProjectName/ProjectName.md`
2. If supporting documents are needed, place them in `{projects directory}/ProjectName/Docs/`
3. Supporting documents must use `type: project-doc`
4. Supporting documents must include `project: "[[{projects directory}/ProjectName/ProjectName]]"`
5. Do not create versioned main project files like `ProjectNameV0.2.md`, `ProjectNameV0.3.md`
6. If the plan includes a version roadmap, write version information in the main project's fields or body, not in filenames

**Frontmatter specification:**

```yaml
---
title: "ProjectName"
type: project
category: learning
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

**Reference:** [[{resources directory}/Books/<ResourceName>]] Chapter 1

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
- The frontmatter ID contains no `{{ID}}`, `Project_Template`, `placeholder`, or other template value
- No other main project uses the same ID

Repair and repeat the reread when any check fails. A successful write operation alone is never a
successful project creation.

## Step 5: Return for Orchestrator Acceptance

- Return the main project path, final ID, source draft path, plan path, and the self-check result
- Do not change the source draft status, mark the plan `done`, or write project-scoped memory
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
**Plan:** {plans directory}/Plan_YYYY-MM-DD_Project_ProjectName.md (remains `status: active`, awaiting Orchestrator acceptance)

If it is a development project, also include:

**Main project path:** `{projects directory}/ProjectName/ProjectName.md`
**Supporting documents directory:** `{projects directory}/ProjectName/Docs/`
```
