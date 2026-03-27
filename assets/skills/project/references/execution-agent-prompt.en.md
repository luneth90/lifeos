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
- Source draft field (for subsequent status update)

## Step 2: Obtain Template (Critical)

**Before generating any content**, read `{system directory}/{templates subdirectory}/Project_Template.md`.

Do not guess the structure. Remember:

- Exact Obsidian Callouts format (e.g., `> [!info]`, `> [!note]`)
- Frontmatter field structure

## Step 3: Create Project Note

Path rules:

- `development`: must create `{projects directory}/ProjectName/ProjectName.md`
- `learning / creative / general`: may create `{projects directory}/ProjectName.md`, or use `{projects directory}/ProjectName/ProjectName.md` when there are many files

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
type: project
status: active
domain: "[[DomainName]]"
created: "YYYY-MM-DD"
tags: [project]
aliases: []
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

<!-- Mastery dot mapping: ⚪ Not started 🔴 Not reviewed (draft) 🟡 Needs reinforcement (revise) 🟢 Mastered (mastered) -->
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

## Step 4: Update Draft Status (Critical)

Check the "Source Draft" field in the plan file:

- If a draft file path is listed (not "None"): update the `status` in that draft file's frontmatter to `projected`
- This marks the draft as processed, allowing `/archive` to identify and archive it

## Step 5: Update Plan Status (Critical)

- After the project is created, update the plan file frontmatter `status` to `done`
- Keep the plan file at `{plans directory}/Plan_YYYY-MM-DD_Project_ProjectName.md`
- `/archive` later moves plans with `status: done` into `{system directory}/{archived plans subdirectory}/`

---

## Completion Report

After completion, report in English:

```
## Project Creation Complete

**Project:** [[ProjectName]] has been created
**Knowledge domain:** [Domain]
**Linked Vault resources:** [List actually linked notes and resources]
**Source draft status:** [{drafts directory}/filename.md → status updated to projected, or "No source draft"]
**Plan status:** {plans directory}/Plan_YYYY-MM-DD_Project_ProjectName.md → `status: done` (waiting for `/archive` to move it into `{system directory}/{archived plans subdirectory}/`)

If it is a development project, also include:

**Main project path:** `{projects directory}/ProjectName/ProjectName.md`
**Supporting documents directory:** `{projects directory}/ProjectName/Docs/`
```
