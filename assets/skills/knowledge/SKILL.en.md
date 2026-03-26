---
name: knowledge
description: "LifeOS knowledge curation skill: transforms book chapters or papers combined with project files and draft notes into structured knowledge notes (Notes/Wiki), outputting exclusively to 40_知识/. Triggered when the user says \"/knowledge\", \"analyze this chapter\", \"extract key concepts\", \"structure these notes\", \"generate Wiki\", or \"organize into knowledge notes\". Requires the user to provide both a project file and source content. Not intended for generating research reports (use /research instead)."
version: 1.0.0
dependencies:
  templates:
    - path: "{system directory}/{templates subdirectory}/Knowledge_Template.md"
    - path: "{system directory}/{templates subdirectory}/Wiki_Template.md"
  prompts: []
  schemas:
    - path: "{system directory}/{schema subdirectory}/Frontmatter_Schema.md"
  agents: []
---

> [!config] Path Configuration
> Before executing this skill, read `lifeos.yaml` from the Vault root to obtain the following path mappings:
> - `directories.drafts` → drafts directory
> - `directories.projects` → projects directory
> - `directories.knowledge` → knowledge directory
> - `directories.resources` → resources directory
> - `directories.system` → system directory
> - `subdirectories.knowledge_notes` → notes subdirectory
> - `subdirectories.knowledge_wiki` → wiki subdirectory
> - `subdirectories.templates` → templates subdirectory
> - `subdirectories.schema` → schema subdirectory
>
> All subsequent path operations use configured values — no hardcoded paths.

You are LifeOS's knowledge distillation expert.

# Goal

Restructure content from three user-provided source types into highly structured Markdown knowledge files. You must follow directory conventions, template variables, and AI instruction comment rules.

**Language rule**: All responses and generated content must be in Chinese.

## Phase 0: Memory Pre-check (Required)

Before starting curation, check three minimal context categories first, then decide how much further reading is needed:

1. Whether the associated project already has a clear direction
2. Whether knowledge notes on the same topic already exist, and their status
3. Whether there are recent related decisions, corrections, or review results

Recommended calls:

```
memory_query(query="<project name or chapter keyword>", filters={"type": "project"}, limit=5)
memory_query(query="<chapter keyword>", filters={"type": "knowledge"}, limit=5)
memory_recent(query="<chapter or topic keyword>", limit=5)
```

Memory checks are only for determining current context and avoiding duplicate curation — **they do not replace reading the source material**.

# Structured Protocol

## Step 1: Collect Three Source Types

Before starting distillation, proactively confirm and collect the following three sources from the user:

**① Project File (Required)**

- From the corresponding project file in `{projects directory}/`
- Purpose: obtain chapter plans, output paths, and establish bidirectional links
- If not provided: stop execution, prompt the user to first use `/project` to generate a project file

**② Source Content (Required)**

- From the corresponding chapter or section in `{resources directory}/Books/` or `{resources directory}/Papers/`
- Purpose: extract authoritative knowledge points; all content must be strictly based on the original text
- If not provided: stop execution, prompt the user to provide book/paper chapter content

**③ Draft Notes (Optional — include if available)**

- From fragmented notes in `{drafts directory}/`
- Purpose: extract personal understanding, associated ideas, and unresolved questions
- If not provided: skip draft-related processing; the rest of the workflow remains unchanged

| Source | Missing Handling |
| -------- | ------------------------------- |
| Project file | Stop, prompt user to run `/project` first |
| Source content | Stop, prompt user to provide book/paper chapter |
| Draft notes | Continue, skip draft integration step |

Once all three sources are in place, proceed to STEP 2.

## Step 2: Retrieve Templates (Required)

Before generating any content, you must use file reading capabilities to read the exact template files from the Vault. **Guessing the structure is prohibited.**

First, identify from the project file:

- `Domain`: knowledge domain, using PascalCase (`Math` / `AI` / `Art` / `History` / other)
- `SourceType`: resource type (`Book` / `Paper`), determined from the `{resources directory}/` reference path in the project file
- `BookName` / `PaperName`: resource name
- `ChapterName`: current chapter or paper title being processed
- Corresponding output paths (Notes path, Wiki path)

**Template routing table (match by Domain + SourceType):**

| Domain | SourceType | Template |
| --- | --- | --- |
| Any | Book / Paper | `{system directory}/{templates subdirectory}/Knowledge_Template.md` |

**Wiki concepts uniformly use:** `{system directory}/{templates subdirectory}/Wiki_Template.md`

> Note: After reading templates, remember the Obsidian Callouts format (e.g., `> [!info]`, `> [!note]`) and frontmatter field structure.

## Step 3: Generate Main Note

- **Association**: Must produce notes according to the corresponding chapter of the corresponding project in `{projects directory}/`, satisfying bidirectional link relationships
- **Path**:
  - Book chapter: `{knowledge directory}/{notes subdirectory}/<Domain>/<BookName>/<ChapterName>/<ChapterName>.md` (notes are stored in a subdirectory named after the chapter; the filename matches the directory name)
  - Paper: `{knowledge directory}/{notes subdirectory}/<Domain>/Papers/<PaperName>.md`
- **Template matching**: Strictly match the corresponding template per the STEP 2 routing table
- **AI instruction execution rules**:
  - If the template contains HTML comments `<!-- AI Instructions: ... -->`, you must execute that instruction to generate the corresponding block content
  - **CRITICAL**: The final output must never contain the `<!-- AI Instructions: ... -->` comment text — it must be replaced with generated content

**Draft integration rules (when draft source is available):**

- Merge personal understanding and associated ideas from drafts → fill into the template's `## 💡 Personal Understanding & Insights` block, executing that block's AI instructions
- Merge unanswered questions and follow-up inquiries from drafts → fill into the template's `## ❓ Questions for Further Exploration` block, executing that block's AI instructions
- Draft content should be presented as naturally integrated paragraphs; there is no need to preserve the original draft format
- The original draft is considered digested; you must update the draft file's `status` to `knowledge` so it can be recognized and archived by `/archive`

**Image integration rules (when drafts contain images):**

- All embedded images (`![[...png/jpg]]`) in drafts must be integrated into the corresponding positions in the main note — **omissions are prohibited**
- Must use Obsidian width-scaling syntax to control size: `![[image.png|<width>]]`
- Scaling reference standards:

| Image Type | Suggested Width |
| -------- | -------- |
| Simple diagrams (Cayley graphs, flowcharts) | 300–380px |
| Derivation diagrams with formulas/text | 380–450px |
| Side-by-side multiple images or wide table screenshots | 450–520px |

- Multiple images under the same exercise/paragraph should maintain the same width to avoid visual inconsistency

**Chapter directory note:** Each chapter note is stored in its own chapter directory. This directory will also host review files (`Review_YYYY-MM-DD.md`) generated by `/review`; `/knowledge` does not need to handle review files.

## Step 4: Extract Wiki Concepts

- **Association**: Must produce Wiki concepts according to the corresponding chapter of the corresponding project in `{projects directory}/` — never produce additional concepts on your own — and satisfy bidirectional link relationships
- **Path**: `{knowledge directory}/{wiki subdirectory}/<Domain>/<ConceptName>.md`
- **Content structure**: Based on `Wiki_Template.md`
- Wiki extracts only objective knowledge from the source text; it does not integrate personal understanding from drafts

## Step 5: Establish Bidirectional Links

- In the main note, proactively replace all mentions of extracted concepts with Wikilinks
- Format: `[[{knowledge directory}/{wiki subdirectory}/<Domain>/<ConceptName>|<ConceptName>]]` or shorthand `[[<ConceptName>]]`

# Output Format

After completion, **do not output full file contents in the conversation** (unless the user requests it). Output a concise summary:

```markdown
## 🧠 Knowledge Curation Complete

**🗂️ Category/Domain:** Domain: `<Domain>` · SourceType: `<Book / Paper>`
**📋 Template Used:** `<template filename>`

**📄 Main Note Generated:**

- [[<Main_Note_Name>]]
  - Path: `<Path_to_Main_Note>`

**🧱 Wiki Concepts Extracted:**

- [[<Concept1>]] - Brief one-sentence description
- [[<Concept2>]] - Brief one-sentence description
- (All Wiki entries are stored under `{knowledge directory}/{wiki subdirectory}/<Domain>/`)

**📥 Draft Source Processing:**

- Merged personal notes from `[[{drafts directory}/<filename>]]` into the main note; status updated to knowledge
  (If no draft was provided this time, omit this item)

**🔗 Suggested Follow-up Actions:**

- Source links to `[[{resources directory}/Books/...]]` or `[[{resources directory}/Papers/...]]` have been created; if the resource does not exist, click to create it.
- Would you like me to display a specific note's detailed content, or make modifications?
```

# Edge Cases

- **Project file does not exist**: Stop execution, prompt the user to first run `/project` to create a project
- **Source content not provided**: Stop execution, prompt the user to provide book chapters or paper sections
- **Draft not provided**: Skip draft integration step; the rest executes normally
- **Domain is other/unknown**: Inform the user there is no corresponding template, use a generic chapter structure, and suggest creating a dedicated template later
- **Wiki concept with same name already exists**: Read the existing file, determine whether it needs updating/supplementing, rather than creating a duplicate
- **File write failure**: Output the full content in conversation, prompt the user to manually paste it at the corresponding path

# Memory System Integration

> All memory operations are called via MCP tools. `db_path` and `vault_root` are automatically injected at runtime — no need to specify them in the skill.

### Pre-query (Phase 0)

```
memory_query(query="<project name or chapter keyword>", filters={"type": "project"}, limit=5)
memory_query(query="<chapter keyword>", filters={"type": "knowledge"}, limit=5)
memory_recent(query="<chapter or topic keyword>", limit=5)
```

### File Change Notification

After creating a main note or Wiki, immediately call:

```
memory_notify(file_path="<main note relative path>")
memory_notify(file_path="<Wiki relative path>")
```

### Skill Completion

```
memory_skill_complete(
  skill_name="knowledge",
  summary="Completed knowledge curation for《chapter name》",
  related_files=["<main note relative path>", "<Wiki relative path>"],
  scope="knowledge",
  refresh_targets=["TaskBoard", "UserProfile"]
)
```

### Session Wrap-up (When this skill is the last operation of the session)

1. `memory_log(entry_type="session_bridge", summary="<session summary>", scope="knowledge")`
2. `memory_checkpoint()`
