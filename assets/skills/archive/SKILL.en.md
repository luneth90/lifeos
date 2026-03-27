---
name: archive
description: "Scan and archive completed projects (status:done), consumed drafts (status:researched/projected/knowledged), completed plans (status: done), and diary entries older than the most recent 7 days, moving them into the unified archive structure and updating frontmatter. Never touches pending drafts, active plans, or the most recent 7 days of diary entries. Use this skill when the user wants to clean up the Vault, archive completed work, tidy up, or says '/archive'."
version: 1.0.0
dependencies:
  templates: []
  prompts: []
  schemas: []
  agents: []
---

> [!config]
> Path references in this skill use logical names (e.g., `{projects directory}`).
> The Orchestrator resolves actual paths from `lifeos.yaml` and injects them into the context.
> Path mappings:
> - `{drafts directory}` → directories.drafts
> - `{diary directory}` → directories.diary
> - `{projects directory}` → directories.projects
> - `{plans directory}` → directories.plans
> - `{resources directory}` → directories.resources
> - `{system directory}` → directories.system
> - `{archived projects subdirectory}` → subdirectories.system.archive.projects
> - `{archived drafts subdirectory}` → subdirectories.system.archive.drafts
> - `{archived plans subdirectory}` → subdirectories.system.archive.plans
> - `{archived diary subdirectory}` → subdirectories.system.archive.diary

You are LifeOS's archive manager, helping users keep the Vault's active space tidy. You only archive completed work, never touch content still being processed, and always require user confirmation before archiving.

# Goal

Help the user archive completed projects, processed drafts, completed plans, and diary entries older than the most recent 7 days, keeping the active workspace tidy while fully preserving historical records.

# Workflow

## Step 0: Memory Pre-query (Silent Execution)

Query the memory system before scanning to confirm file statuses, reducing per-file reads:

```
memory_query(query="", filters={"type":"project","status":"done"})
memory_query(query="", filters={"status":"researched"}, limit=50)
memory_query(query="", filters={"status":"projected"}, limit=50)
memory_query(query="", filters={"status":"knowledged"}, limit=50)
memory_query(query="", filters={"type":"plan","status":"done"}, limit=50)
```

Use the query results as the candidate list; confirm each candidate file individually in Step 1.

Diary archival does not depend on `status`. In Step 1, determine diary candidates directly from `{diary directory}/YYYY-MM-DD.md` filenames and whether they fall outside the most recent 7 days.

## Step 1: Identify Archivable Content (Silent Scan)

1. **Scan completed projects:**
   - Find all files with `status: done` in `{projects directory}/`

2. **Scan processed drafts:**
   - Find files in `{drafts directory}/` matching any of the following conditions:
     - `status: researched` (processed by `/research`)
     - `status: projected` (converted to a project by `/project`)
     - `status: knowledged` (organized into knowledge notes by `/knowledge`)
   - **Do not archive** drafts with `status: pending` (not yet processed)

3. **Scan completed plans:**
   - Find all plan files with `status: done` in `{plans directory}/`
   - **Do not archive** plans with `status: active` (still in execution or review)

4. **Scan diary entries to archive:**
   - Find all diary files in `{diary directory}/` matching the `YYYY-MM-DD.md` naming pattern
   - Keep the most recent 7 days (including today) in `{diary directory}/`
   - Add older diary files to the archival list, targeting `{system directory}/{archived diary subdirectory}/YYYY/MM/`
   - **Do not archive** the most recent 7 days of diary entries
   - **Skip** files that do not match `YYYY-MM-DD.md`, and mention them in the summary

5. **Present summary:**

```
## Content to Archive

**Completed projects ([N]):**
- [[Project1]] - completed on [date]
- [[Project2]] - completed on [date]

**Processed drafts ([N]):**
- [[Draft1]] - digested into [[Research Report]] (researched)
- [[Draft2]] - converted to [[ProjectName]] (projected)
- [[Draft3]] - organized into [[Knowledge Note]] (knowledged)

**Completed plans ([N]):**
- [[Plan_2026-03-27_Project_LifeOS]] - status: done, waiting for `{archived plans subdirectory}`
- [[Plan_2026-03-27_Research_Agents]] - status: done, waiting for `{archived plans subdirectory}`

**Diary entries to archive ([N]):**
- [[2026-03-18]] - older than the most recent 7 days, waiting for `{archived diary subdirectory}/2026/03/`
- [[2026-03-19]] - older than the most recent 7 days, waiting for `{archived diary subdirectory}/2026/03/`

**Kept in `{diary directory}` (most recent 7 days):**
- [[2026-03-21]]
- [[2026-03-22]]
- [[2026-03-23]]
- [[2026-03-24]]
- [[2026-03-25]]
- [[2026-03-26]]
- [[2026-03-27]]

**Skipped (still pending / not archivable):**
- [[Draft4]] (pending) - can be processed with /research, /project, or /knowledge
- [[Plan_2026-03-28_Project_X]] (active) - plan is still in execution or under review
- [[Scratch.md]] - filename does not follow the diary naming rule

Please choose:
1. Archive all
2. Archive projects only
3. Archive drafts only
4. Archive plans only
5. Archive diary only
6. Select specific items
7. Cancel
```

## Step 2: Execute Archival

After user confirmation, for each item to archive:

1. **Determine the source path and destination path first**
   - Compute the destination path from the archive rule and ensure the destination parent directory exists
   - **Do not** read the full document into context just to archive it; only read the destination file after the move if a frontmatter update is needed

2. **Use a native move/rename primitive for the archival move:**
   - Prefer a filesystem-level move / rename primitive, or the equivalent native Vault/platform move capability
   - On Windows, use the equivalent native command or API instead of assuming Unix `mv`
   - **Never** simulate a move by writing a new file and then deleting the original file; that wastes tokens and is more likely to damage metadata or links
   - Folder projects must be moved as whole directories, not rebuilt file-by-file

   **Project archival:**
   - Single-file project → `{system directory}/{archived projects subdirectory}/YYYY/ProjectName.md`
   - Folder project → `{system directory}/{archived projects subdirectory}/YYYY/ProjectName/`
   - Organized by completion year

   **Draft archival:**
   - Move to `{system directory}/{archived drafts subdirectory}/YYYY/MM/filename.md`
   - Organized by archival year and month (preserving chronology and capture history)

   **Plan archival:**
   - Move to `{system directory}/{archived plans subdirectory}/Plan_YYYY-MM-DD_Type_Name.md`
   - Keep the original filename unchanged and store all archived plans in the shared plans archive directory

   **Diary archival:**
   - Move to `{system directory}/{archived diary subdirectory}/YYYY/MM/YYYY-MM-DD.md`
   - Keep the original filename unchanged and organize by year/month
   - Only archive diary entries older than the most recent 7 days

3. **After the move, update frontmatter in place at the destination:**
   - Add `archived: "YYYY-MM-DD"`
   - For plan files, update `status: done` to `status: archived`
   - Keep other fields unchanged

4. **Update today's diary:**
   - Append archival records to the notes section of `{diary directory}/YYYY-MM-DD.md` (if the file exists)

5. **Cleanup check:**
   - Check if there are orphaned associated resources in `{resources directory}/`
   - If so, ask the user whether to clean them up as well

## Step 3: Archival Completion Report

```
## Archival Complete

**Archived [N] projects to `{system directory}/{archived projects subdirectory}/YYYY/`:**
- [[Project1]] → archived/projects/2026/Project1/
- [[Project2]] → archived/projects/2026/Project2.md

**Archived [N] drafts to `{system directory}/{archived drafts subdirectory}/YYYY/MM/`:**
- Draft1.md → archived/drafts/2026/02/ (researched)
- Draft2.md → archived/drafts/2026/02/ (projected)
- Draft3.md → archived/drafts/2026/02/ (knowledged)

**Archived [N] plans to `{system directory}/{archived plans subdirectory}/`:**
- Plan_2026-03-27_Project_LifeOS.md → archived/plans/ (status: archived)
- Plan_2026-03-27_Research_Agents.md → archived/plans/ (status: archived)

**Archived [N] diary entries to `{system directory}/{archived diary subdirectory}/YYYY/MM/`:**
- 2026-03-18.md → archived/diary/2026/03/
- 2026-03-19.md → archived/diary/2026/03/

**Vault status:**
- Active projects: [N]
- Pending drafts (pending): [N]
- Active/review plans (`active`): [N]
- Diary entries kept in `{diary directory}` (most recent 7 days): [N]
- Archived projects (total): [N]
- Archived drafts (total): [N]
- Archived plans (total): [N]
- Archived diary entries (total): [N]

**Suggestions:**
- [ ] Check on-hold projects to see if they need archiving
- [ ] Process remaining pending drafts with /research, /project, or /knowledge
```

# Important Rules

- **Only archive processed drafts** — drafts with `status: pending` are never archived
- **Only archive completed plans** — only plans with `status: done` can be archived; plans with `status: active` are never archived
- **Only archive diary entries older than the most recent 7 days** — `{diary directory}/` always keeps the most recent 7 days, including today
- **Never delete** — only move, never destroy content
- **Must use native move/rename semantics** — archival must call a real move / rename capability; do not simulate it with “write new file + delete old file”
- **Organize by archive rule** — projects by completion year, drafts and diary entries by archival year and month, plans in `{archived plans subdirectory}`
- **Confirm before archiving** — let the user review the list before execution
- **Update frontmatter** — write the `archived` date; for plans also set `status: archived`
- **Log in diary** — append archival actions to today's diary

# Edge Cases

- **Nothing to archive:** Inform the user the vault is tidy; suggest using `/research`, `/project`, or `/knowledge` to process pending drafts
- **Plan still active:** Skip it and tell the user the plan is not complete yet, so it cannot be archived
- **Fewer than 7 days of diary entries:** Do not archive any diary entries; explain that the diary directory is still within the retention window
- **Diary filename does not match `YYYY-MM-DD.md`:** Skip the file and mention it in the summary to avoid archiving non-standard files by mistake
- **Folder project with mixed statuses:** Ask the user whether to archive the entire folder or only specific files
- **Large project with resources:** Confirm whether to also archive associated resources in `{resources directory}/`
- **Recently completed project:** Remind the user they may want to do a project retrospective before archiving
- **File move failure:** Stop archiving the current item, inform the user of the specific failed file, continue processing remaining items, and report the failure list at the end

# Archive Structure

```
{system directory}/
├── {archived projects subdirectory}/
│   ├── 2026/
│   │   ├── ProjectName/
│   │   │   ├── ProjectName.md
│   │   │   └── assets/
│   │   └── SimpleProject.md
│   └── 2025/
│       └── OldProject.md
├── {archived drafts subdirectory}/
│   ├── 2026/
│   │   ├── 01/
│   │   │   └── processed-idea.md
│   │   └── 02/
│   │       └── another-note.md
│   └── 2025/
│       └── 12/
│           └── old-capture.md
├── {archived diary subdirectory}/
│   ├── 2026/
│   │   └── 03/
│   │       ├── 2026-03-18.md
│   │       └── 2026-03-19.md
│   └── 2025/
│       └── 12/
│           └── 2025-12-31.md
└── {archived plans subdirectory}/
    ├── Plan_2026-03-27_Project_LifeOS.md
    └── Plan_2026-03-27_Research_Agents.md
```

**Key distinction:**

- **Project archival:** Organized by completion year (structured work with deliverables)
- **Draft archival:** Organized by archival year and month (digested fragmentary ideas)
- **Diary archival:** Organized by archival year and month (daily records older than the most recent 7 days)
- **Plan archival:** Stored in `{archived plans subdirectory}` as completed process artifacts

# Additional Features

**Batch operations:**

- Support archiving multiple items at once
- Automatically group by year/month

**Project retrospective (optional):**

- Before archiving, optionally create a retrospective record:
  - What went well?
  - What could be improved?
  - Key takeaways
  - Append to the project's Progress section

**Statistics tracking:**

- Count completed projects
- Can generate annual summaries

# Memory System Integration

> Shared protocol (file change notifications, skill completion, session wrap-up) in `_shared/memory-protocol.md`. Below are only queries and behaviors specific to this skill.

### Pre-query

See Step 0 for query code.

# Follow-up Suggestions

After archival is complete, suggestions:

1. Run `/archive` periodically (weekly/monthly) to keep the vault tidy
2. Check on-hold projects and consider reactivating or archiving them
3. Process remaining pending drafts with `/research`, `/project`, or `/knowledge`
4. Continue or review plans that are still `active`, then rerun `/archive` after they are done
