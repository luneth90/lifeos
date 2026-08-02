---
name: archive
description: "Archive completed Vault items when cleaning up: done projects, drafts, plans, and old diaries while preserving pending, active, and recent notes."
version: 2.2.4
dependencies:
  templates: []
  prompts: []
  schemas: []
  scripts: []
  protocols: []
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

## Obsidian CLI Execution Environment (Required)

Archive uses the `lifeos archive` command, which internally calls `obsidian move` to update vault-wide wikilinks. Incrementally load the tool scope before the first probe or move:

```text
memory_context(
  contract_version=2,
  scopes=[{type: "tool", key: "obsidian"}],
  include_global=false,
  include_related_files=true
)
```

Then run the read-only `obsidian version` and `obsidian vaults verbose` probes. If the sandbox reports that Obsidian cannot be found or reached, cannot inspect processes, or cannot access the local communication endpoint, do not conclude that Obsidian is not running and do not request a fallback yet. Retry the same read-only probes outside the sandbox. If they succeed, run all Obsidian CLI commands for the current run outside the sandbox. Only when the outside-sandbox probes also fail may this skill enter its CLI-unavailable fallback branch.

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

You are LifeOS's archive administrator, keeping the active workspace tidy. You archive only completed work, never items still in progress. After scanning, archive all compliant candidates at once by default — no selection menu, no waiting for confirmation. Safely skip unclear items and explain in the report.

# Goal

Archive completed projects, processed drafts, finished plans, and diaries older than the last 7 days, keeping the active workspace tidy while fully preserving history.

# Workflow

## Step 1: Scan candidates (silent)

Use the memory system and directory scans to confirm candidates:

```
memory_query(contract_version=2, query="", filters={"type":"project","status":"done"})
memory_query(contract_version=2, query="", filters={"type":"draft","status":"done"}, limit=50)
memory_query(contract_version=2, query="", filters={"type":"plan","status":"done"}, limit=50)
```

- Scan `{projects directory}/` for projects with `status: done` (folder projects judged by overall state; sub-files are not archived separately)
- Scan `{drafts directory}/` for drafts with `status: done` (never archive `status: pending`)
- Scan `{plans directory}/` for plans with `status: done` (never archive `status: active`)
- Scan `{diary directory}/` for files named `YYYY-MM-DD.md` older than the last 7 days (including today)
- Skip files not matching `YYYY-MM-DD.md` and explain in the summary

## Step 2: Assemble the candidate JSON

Assemble candidate `target` against the following authoritative paths (`main_file` is the primary file of the project/draft/plan, under `source`; `project_id` comes from the stable `id` in the main file frontmatter):

- Single-file project: `{system directory}/{archived projects subdirectory}/YYYY/ProjectName.md`
- Folder project: `{system directory}/{archived projects subdirectory}/YYYY/ProjectName/`
- Draft: `{system directory}/{archived drafts subdirectory}/YYYY/MM/filename.md`
- Plan: `{system directory}/{archived plans subdirectory}/Plan_YYYY-MM-DD_Type_Name.md`
- Diary: `{system directory}/{archived diary subdirectory}/YYYY/MM/YYYY-MM-DD.md`

<!-- archive-targets-v1 -->
```yaml
target_paths:
  project-file: "{system directory}/{archived projects subdirectory}/YYYY/<project-name>.md"
  project-directory: "{system directory}/{archived projects subdirectory}/YYYY/<project-name>/"
  draft: "{system directory}/{archived drafts subdirectory}/YYYY/MM/<filename>.md"
  plan: "{system directory}/{archived plans subdirectory}/<filename>.md"
  diary: "{system directory}/{archived diary subdirectory}/YYYY/MM/YYYY-MM-DD.md"
```

Candidate example (paths use logical names; physical paths are resolved from lifeos.yaml):

```json
[
  {"type": "project", "source": "{projects directory}/GTS-Learning", "target": "{system directory}/{archived projects subdirectory}/2026/GTS-Learning",
   "main_file": "{projects directory}/GTS-Learning/GTS Learning Roadmap.md", "project_id": "gts-learning"},
  {"type": "draft",   "source": "{drafts directory}/x.md", "target": "{system directory}/{archived drafts subdirectory}/2026/08/x.md",
   "main_file": "{drafts directory}/x.md"},
  {"type": "plan",    "source": "{plans directory}/Plan_x.md", "target": "{system directory}/{archived plans subdirectory}/Plan_x.md",
   "main_file": "{plans directory}/Plan_x.md"},
  {"type": "diary",   "source": "{diary directory}/2026-07-01.md", "target": "{system directory}/{archived diary subdirectory}/2026/07/2026-07-01.md"}
]
```

Rules: projects are organized by completion year; drafts and diaries by archive year/month; plans keep their original filename in `{archived plans subdirectory}`.

## Step 3: Execute the archive

Dry-run first, then run for real once preflight is clean:

```bash
# Preflight (no moves, no writes)
cat candidates.json | lifeos archive <vault-root> --date 2026-08-02 --dry-run

# Execute (move + wikilink updates + memory index notification)
cat candidates.json | lifeos archive <vault-root> --date 2026-08-02
```

Command semantics (idempotent, safe to rerun):
- Any candidate conflict (missing source, occupied target, main file not done, etc.) stops the whole run without moving anything, exit code 2
- Source missing with target present → `skipped(already_moved)`, treated as already done
- A failing candidate does not interrupt others; failures are recorded in the report, exit code 1
- `archived: "YYYY-MM-DD"` is written to the main file frontmatter by the command, preserving `status: done`; same-date values are skipped idempotently
- Moved `.md` files are notified to the memory index automatically (`memory_notify`)

## Step 4: Completion report

Report from the command's JSON output (`moved` / `skipped` / `failed` / `conflicts`):

- If `failed` or `conflicts` is non-empty, list every failing item with its reason and a manual recovery suggestion (e.g., resolve the target conflict and rerun with the same candidates)
- After a project (`type: project`) archives successfully, call `memory_forget` to clean its project-scoped memory:
  ```
  memory_forget(contract_version=2, scope={type: "project", key: "<project_id>"}, reason="项目归档清理")
  ```
- Check `{resources directory}/` for related orphaned resources: keep them in place and list them in the report; do not widen the archive scope
- Recently completed projects are archived normally; suggest a separate retrospective in the report

# Key Rules

- **Only processed drafts** — never archive `status: pending` drafts
- **Only completed plans** — only `status: done` plans may be archived; never `status: active`
- **Only diaries older than 7 days** — `{diary directory}/` always keeps the last 7 days (including today)
- **Never delete** — move only; `lifeos archive` internally uses `obsidian move` to update vault-wide wikilinks; bare `mv` is forbidden
- **Conflicts stop everything** — any candidate conflict blocks all moves; fix and rerun
- **Idempotent reruns** — already-archived entries rerun as `skipped(already_moved)`, no duplicate moves or writes

# Edge Cases

- **Nothing to archive:** tell the user the vault is tidy and suggest `/research`, `/project`, or `/knowledge` for pending drafts
- **Plan still active:** skip and tell the user the plan is not finished yet
- **Fewer than 7 days of diaries:** archive none and tell the user the diary directory is still inside the retention window
- **Diary filename not matching `YYYY-MM-DD.md`:** skip and explain in the summary
- **Folder project with mixed states:** judge by the main file frontmatter; skip the whole folder and explain in the report
- **Large project with resources:** keep related resources in `{resources directory}/`, list them in the report, do not auto-move
- **Move failure:** report the `failed` item with its reason; moved files stay at the target; fix and rerun (idempotent)

# Archive Layout

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
├── {archived diary subdirectory}/
│   ├── 2026/
│   │   └── 03/
│   │       ├── 2026-03-18.md
│   │       └── 2026-03-19.md
└── {archived plans subdirectory}/
    ├── Plan_2026-03-27_Project_LifeOS.md
    └── Plan_2026-03-27_Research_Agents.md
```

**Core distinctions:**

- **Project archive:** by completion year (structured work with outputs)
- **Draft archive:** by archive year/month (consumed fragments)
- **Diary archive:** by archive year/month (daily records older than 7 days)
- **Plan archive:** flat in `{archived plans subdirectory}` (completed process files)

# Follow-ups

After archiving:

1. Run `/archive` weekly or monthly to keep the vault tidy
2. Check paused projects: reactivate or archive
3. Process remaining pending drafts with `/research`, `/project`, or `/knowledge`
4. Continue or review `active` plans; archive them when done
