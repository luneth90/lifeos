---
name: archive
description: LifeOS archival workflow: scan and archive completed projects (status:done) and processed drafts (status:researched/projected/knowledged), keeping the Vault tidy. Triggered when the user says "/archive", "archive", "clean up", "organize completed projects", "clear processed drafts", "tidy up the vault". Does not archive drafts with status:pending.
version: 1.0.0
dependencies:
  templates: []
  prompts: []
  schemas: []
  agents: []
---

> [!config] Path Configuration
> Before executing this skill, read `lifeos.yaml` from the Vault root to obtain the following path mappings:
> - `directories.drafts` → drafts directory
> - `directories.diary` → diary directory
> - `directories.projects` → projects directory
> - `directories.resources` → resources directory
> - `directories.system` → system directory
> - `subdirectories.system.archive.projects` → archived projects subdirectory
> - `subdirectories.system.archive.drafts` → archived drafts subdirectory
>
> Use configured values for all subsequent path operations; do not use hardcoded paths.

You are the LifeOS archive manager.

# Goal

Help the user archive completed projects and processed drafts, keeping the active workspace tidy while fully preserving historical records.

# Workflow

## Step 0: Memory Pre-query (Silent Execution)

Query the memory system before scanning to confirm file statuses, reducing per-file reads:

```
memory_query(query="", filters={"type":"project","status":"done"})
memory_query(query="", filters={"status":"researched"}, limit=50)
memory_query(query="", filters={"status":"projected"}, limit=50)
memory_query(query="", filters={"status":"knowledged"}, limit=50)
```

Use the query results as the candidate list; confirm each candidate file individually in Step 1.

## Step 1: Identify Archivable Content (Silent Scan)

1. **Scan completed projects:**
   - Find all files with `status: done` in `{projects directory}/`

2. **Scan processed drafts:**
   - Find files in `{drafts directory}/` matching any of the following conditions:
     - `status: researched` (processed by `/research`)
     - `status: projected` (converted to a project by `/project`)
     - `status: knowledged` (organized into knowledge notes by `/knowledge`)
   - **Do not archive** drafts with `status: pending` (not yet processed)

3. **Present summary:**

```
## Content to Archive

**Completed projects ([N]):**
- [[Project1]] - completed on [date]
- [[Project2]] - completed on [date]

**Processed drafts ([N]):**
- [[Draft1]] - digested into [[Research Report]] (researched)
- [[Draft2]] - converted to [[ProjectName]] (projected)
- [[Draft3]] - organized into [[Knowledge Note]] (knowledged)

**Skipped (still pending):**
- [[Draft4]] (pending) - can be processed with /research, /project, or /knowledge

Please choose:
1. Archive all
2. Archive projects only
3. Archive drafts only
4. Select specific items
5. Cancel
```

## Step 2: Execute Archival

After user confirmation, for each item to archive:

1. **Read the file's full content and metadata**

2. **Move to the archive directory:**

   **Project archival:**
   - Single-file project → `{system directory}/{archived projects subdirectory}/YYYY/ProjectName.md`
   - Folder project → `{system directory}/{archived projects subdirectory}/YYYY/ProjectName/`
   - Organized by completion year

   **Draft archival:**
   - Move to `{system directory}/{archived drafts subdirectory}/YYYY/MM/filename.md`
   - Organized by archival year and month (preserving chronology and capture history)

3. **Update frontmatter:**
   - Add `archived: "YYYY-MM-DD"`
   - Keep all other fields unchanged

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

**Vault status:**
- Active projects: [N]
- Pending drafts (pending): [N]
- Archived projects (total): [N]
- Archived drafts (total): [N]

**Suggestions:**
- [ ] Check on-hold projects to see if they need archiving
- [ ] Process remaining pending drafts with /research, /project, or /knowledge
```

# Important Rules

- **Only archive processed drafts** — drafts with `status: pending` are never archived
- **Never delete** — only move, never destroy content
- **Organize by year/month** — projects by completion year, drafts by archival year and month
- **Confirm before archiving** — let the user review the list before execution
- **Update frontmatter** — write the `archived` date
- **Log in diary** — append archival actions to today's diary

# Edge Cases

- **Nothing to archive:** Inform the user the vault is tidy; suggest using `/research`, `/project`, or `/knowledge` to process pending drafts
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
└── {archived drafts subdirectory}/
    ├── 2026/
    │   ├── 01/
    │   │   └── processed-idea.md
    │   └── 02/
    │       └── another-note.md
    └── 2025/
        └── 12/
            └── old-capture.md
```

**Key distinction:**

- **Project archival:** Organized by completion year (structured work with deliverables)
- **Draft archival:** Organized by archival year and month (digested fragmentary ideas)

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

> All memory operations are invoked via MCP tools. `db_path` and `vault_root` are automatically injected at runtime; no need to specify them in the skill.

### Pre-query (Step 0)

```
memory_query(query="", filters={"type":"project","status":"done"})
memory_query(query="", filters={"status":"researched"}, limit=50)
memory_query(query="", filters={"status":"projected"}, limit=50)
memory_query(query="", filters={"status":"knowledged"}, limit=50)
```

### File Change Notification

After each file move to the archive directory, immediately call:

```
memory_notify(file_path="<relative path of the archived file>")
```

If the original path file has been removed, also notify the original path to update the index:

```
memory_notify(file_path="<original file relative path>")
```

### Skill Completion

```
memory_skill_complete(
  skill_name="archive",
  summary="Archived N projects and M drafts",
  related_files=["<list of archived file relative paths>"],
  scope="archive",
  refresh_targets=["TaskBoard"]
)
```

### Session Wrap-up (when this skill is the last operation in the session)

1. `memory_log(entry_type="session_bridge", summary="<session summary>", scope="archive")`
2. `memory_checkpoint()`

# Follow-up Suggestions

After archival is complete, suggestions:

1. Run `/archive` periodically (weekly/monthly) to keep the vault tidy
2. Check on-hold projects and consider reactivating or archiving them
3. Process remaining pending drafts with `/research`, `/project`, or `/knowledge`
