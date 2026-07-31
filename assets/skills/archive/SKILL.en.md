---
name: archive
description: "Archive completed Vault items when cleaning up: done projects, drafts, plans, and old diaries while preserving pending, active, and recent notes."
version: 2.1.2
dependencies:
  templates: []
  prompts: []
  schemas: []
  protocols:
    - path: ../_shared/operation-safety.md
  capabilities: [move_with_link_update]
  agents: []
---


## Scoped Memory (Required)

After routing this skill and identifying its target, call the following before the first business query:

```text
memory_context(
  contract_version=2,
  scopes=[{type: "skill", key: "archive"}, <resolved project/repository/tool/file scopes>],
  include_global=false,
  include_related_files=true
)
```

Do not pass unresolved scopes, and never expand an empty scope list into a full-memory read. Global rules were already injected by bootstrap.
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

You are LifeOS's archive manager, helping users keep the Vault's active space tidy. You only archive completed work and never touch content still being processed. After scanning, archive every eligible candidate by default without showing a selection menu or waiting for user confirmation; safely skip ambiguous items and explain them in the completion report.

# Goal

Help the user archive completed projects, processed drafts, completed plans, and diary entries older than the most recent 7 days, keeping the active workspace tidy while fully preserving historical records.

# Workflow

## Step 0: Memory Pre-query (Silent Execution)

Query the memory system before scanning to confirm file statuses, reducing per-file reads:

```
memory_query(contract_version=2, query="", filters={"type":"project","status":"done"})
memory_query(contract_version=2, query="", filters={"type":"draft","status":"done"}, limit=50)
memory_query(contract_version=2, query="", filters={"type":"plan","status":"done"}, limit=50)
```

Use the query results as the candidate list; confirm each candidate file individually in Step 1.

Diary archival does not depend on `status`. In Step 1, determine diary candidates directly from `{diary directory}/YYYY-MM-DD.md` filenames and whether they fall outside the most recent 7 days.

## Step 1: Identify Archivable Content (Silent Scan)

1. **Scan completed projects:**
   - Find all files with `status: done` in `{projects directory}/`

2. **Scan processed drafts:**
   - Find files in `{drafts directory}/` with `status: done` (processed by `/research`, `/project`, or `/knowledge`)
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

5. **Build the execution list without blocking:**

```
## Content to Archive

**Completed projects ([N]):**
- [[Project1]] - completed on [date]
- [[Project2]] - completed on [date]

**Processed drafts ([N]):**
- [[Draft1]] - processed (done)
- [[Draft2]] - processed (done)

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

**Execution mode:**
- Archive every eligible candidate above by default
- Do not require the user to select, confirm, or reply
```

After scanning, use every eligible candidate in the list as the execution scope and proceed directly to Step 2. The list may be shown as a progress update, but the workflow must not pause for a user response.

## Step 2: Execute Archival

After scanning, process every eligible item in the execution list by default:

1. **Determine the source path and destination path first**
   - Compute the destination path from the archive rule and ensure the destination parent directory exists
   - **Do not** read the full document into context just to archive it; only read the destination file after the move if a frontmatter update is needed

2. **Use Obsidian CLI to move files (auto-updates wikilinks):**
   - **Prefer `obsidian move`** — internally calls `app.fileManager.renameFile()`, auto-updating all wikilink references vault-wide
   - Requires Obsidian to be running
   - Command format:
     ```
     # Single file
     obsidian move path="source-path/file.md" to="target-directory/"
     # Folder project (move whole directory)
     obsidian move path="source-path/project-folder" to="target-directory/2026/"
     ```
   - Ensure the destination parent directory exists before each operation (`mkdir -p`)
   - Create separate source and destination guards: before the move, the source must be `existing` and the destination must be `missing`, and both guards must be revalidated immediately before the actual move. Immediately afterward, use `advanceVaultPathGuard` to advance the source from `existing` to `missing` and the destination from `missing` to `existing`, then retain only the returned guards. Abort and record manifest and recovery actions if any state, identity, symlink, or Vault-boundary check fails
   - **Degradation:** If `obsidian` CLI is unavailable, stop and present the impact of missing link updates. Use a recorded move only after explicit user acceptance of degradation; never silently fall back to bare `mv`.
   - **Never** simulate a move by writing a new file and then deleting the original file
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

3. **Immediately after each move, execute the single authoritative index and Scope cleanup transaction:**
   1. After a successful move, record the file in manifest `moves`.
   2. Immediately call `memory_notify(contract_version=2, file_path="<new Vault-relative path>", previous_file_path="<old Vault-relative path>")`, then record success in manifest `notified`; on notification failure, record `errors` and stop the current transaction.
   3. Explicitly query and confirm that the new path is indexed. If unconfirmed, record `errors`, stop, and never call `memory_forget`.
   4. Only for a project whose new index entry is confirmed, call `memory_forget(contract_version=2, scope={type: "project", key: "<id>"}, reason="Project archival cleanup")`.
   5. Drafts and plans cannot have persistent `file` scope memory, so never call or clean `memory_forget` for them; retain interim information in their Markdown body.

4. **After the transaction succeeds, update frontmatter in place at the destination:**
   - Add `archived: "YYYY-MM-DD"`
   - Preserve the business terminal state (`status: done` for drafts, projects, and plans)
   - Keep other fields unchanged
   - Revalidate the path guard before and after the write, then call `memory_notify(contract_version=2, file_path="<new Vault-relative path>")` again

5. **Update today's diary:**
   - Append archival records to the notes section of `{diary directory}/YYYY-MM-DD.md` if present; revalidate the path guard before and after the write and notify the index afterward

6. **Cleanup check:**
   - Check if there are orphaned associated resources in `{resources directory}/`
   - If found, leave them in place and list them in the completion report; do not expand the archival scope or interrupt the workflow to ask the user

## Step 3: Archival Completion Report

```
## Archival Complete

**Archived [N] projects to `{system directory}/{archived projects subdirectory}/YYYY/`:**
- [[Project1]] → archived/projects/2026/Project1/
- [[Project2]] → archived/projects/2026/Project2.md

**Archived [N] drafts to `{system directory}/{archived drafts subdirectory}/YYYY/MM/`:**
- Draft1.md → archived/drafts/2026/02/ (done)
- Draft2.md → archived/drafts/2026/02/ (done)

**Archived [N] plans to `{system directory}/{archived plans subdirectory}/`:**
- Plan_2026-03-27_Project_LifeOS.md → archived/plans/ (keeps done; archival date written)
- Plan_2026-03-27_Research_Agents.md → archived/plans/ (keeps done; archival date written)

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
- [ ] Check frozen projects to see if they need archiving
- [ ] Process remaining pending drafts with /research, /project, or /knowledge
```

# Important Rules

- **Only archive processed drafts** — drafts with `status: pending` are never archived
- **Only archive completed plans** — only plans with `status: done` can be archived; plans with `status: active` are never archived
- **Only archive diary entries older than the most recent 7 days** — `{diary directory}/` always keeps the most recent 7 days, including today
- **Never delete** — only move, never destroy content
- **Prefer Obsidian CLI for moves** — `obsidian move` auto-updates wikilinks; when unavailable, require explicit degradation acceptance and never silently use `mv`
- **No simulated moves** — do not simulate a move with “write new file + delete old file”
- **Organize by archive rule** — projects by completion year, drafts and diary entries by archival year and month, plans in `{archived plans subdirectory}`
- **Archive all by default** — after scanning, automatically process every eligible candidate without requiring review, selection, confirmation, or a reply
- **Update frontmatter** — write the `archived` date and preserve the business terminal state
- **Log in diary** — append archival actions to today's diary

# Edge Cases

- **Nothing to archive:** Inform the user the vault is tidy; suggest using `/research`, `/project`, or `/knowledge` to process pending drafts
- **Plan still active:** Skip it and tell the user the plan is not complete yet, so it cannot be archived
- **Fewer than 7 days of diary entries:** Do not archive any diary entries; explain that the diary directory is still within the retention window
- **Diary filename does not match `YYYY-MM-DD.md`:** Skip the file and mention it in the summary to avoid archiving non-standard files by mistake
- **Folder project with mixed statuses:** Skip the entire folder, do not archive individual child files, and explain the skip in the completion report
- **Large project with resources:** Leave associated resources in `{resources directory}/`, list them in the completion report, and do not move or clean them automatically
- **Recently completed project:** Archive it normally, then suggest an optional retrospective in the completion report
- **File move failure:** Stop archiving the current item, inform the user of the specific failed file, continue processing remaining items, and report the failure list at the end
- **Obsidian CLI unavailable:** Stop and wait for explicit user acceptance of a degradation; move no files without it

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

- Do not ask about or create a retrospective before automatic archival. If useful, suggest creating one separately in the completion report with content such as:
  - What went well?
  - What could be improved?
  - Key takeaways
  - Append to the project's Progress section

**Statistics tracking:**

- Count completed projects
- Can generate annual summaries

# Memory System Integration

> Shared protocol (file change notifications, behavior rule logging) in `_shared/memory-protocol.md`. Below are only queries and behaviors specific to this skill.

### Pre-query

See Step 0 for query code.

# Follow-up Suggestions

After archival is complete, suggestions:

1. Run `/archive` periodically (weekly/monthly) to keep the vault tidy
2. Check frozen projects and consider reactivating or archiving them
3. Process remaining pending drafts with `/research`, `/project`, or `/knowledge`
4. Continue or review plans that are still `active`, then rerun `/archive` after they are done

## Archive Transaction Contract

Read `_shared/operation-safety.md` and complete preflight: enumerate every candidate in a directory, resolve safe source/destination paths, and check collision before any move. Create a per-file move manifest: `{ run_id, moves, collisions, notified, errors }`. Prefer `move_with_link_update`; when unavailable, use an explicit degradation only after explicit user acceptance, never a silent bare move. The only sequence is move → complete `memory_notify` → confirm_index → `memory_forget`; every failure stops subsequent steps and preserves a recovery action for the same `run_id` to resume.

<!-- operation-safety-v1 -->
```yaml
contract_version: 1
safety_protocol: operation-safety-v1
operation: archive
run_id: stable(archive, candidate-paths, archive-date)
target_path: "{system directory}/{archive subdirectory}/..."
decision: [create, merge, resume, skip, replace]
transaction_steps: [move, memory_notify, confirm_index, memory_forget]
move_guards:
  source: { before: existing, after: missing }
  target: { before: missing, after: existing }
  advance: advanceVaultPathGuard
notify:
  contract_version: 2
  file_path: <new-vault-relative-path>
  previous_file_path: <old-vault-relative-path>
forget:
  scope_type: project
  allowed_after: confirm_index
  forbidden_when: [move_failed, notify_failed, index_unconfirmed]
manifest_updates:
  move: moves
  collision: collisions
  memory_notify: notified
  failure: errors
bare_mv: forbidden
```
