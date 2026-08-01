---
name: archive
description: "Archive completed Vault items when cleaning up: done projects, drafts, plans, and old diaries while preserving pending, active, and recent notes."
version: 2.2.1
dependencies:
  templates: []
  prompts: []
  schemas: []
  scripts:
    - path: scripts/archive_transaction.mjs
    - path: scripts/archive_metadata_transaction.mjs
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
   - Compute every destination path from the archive rules and freeze each candidate as an explicit `source_path → target_path`, `entity_type`, and project `project_id`
   - Before any move, preflight collisions for every candidate and freeze the complete per-file inventory of every directory; never discover later collisions while moving earlier candidates
   - **Do not** read the full document into context just to archive it; the published transaction adapter handles only moves, index confirmation, and Scope cleanup, and does not rewrite file contents

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
   - Call the shared `createVaultDirectoryGuard` to freeze every destination-parent level, then call `ensureVaultDirectory` to create missing directories safely. Every level must perform guard → immediate revalidation → single-level creation → `missing → existing` advance → revalidation; recursive creation must never bypass the guard
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

3. **Use the published transaction adapter for moves, indexing, and Scope cleanup:**
   - Call `runArchiveTransaction({ vault_root, run_id, candidates, manifest, adapters })` from `scripts/archive_transaction.mjs`. `adapters` must provide `persist_manifest`, `verify_manifest_receipt`, `move_with_link_update`, `memory_notify`, `confirm_index`, and `memory_forget`. Every callback accepts only a strict success shape and returns a trusted receipt for a side effect.
   1. `persist_manifest` must write the complete manifest and current Vault identity to a trusted store the caller cannot forge and return a persistence receipt. Vault identity comprises the root `realpath`, `dev`, and `ino` frozen when the run starts, and is explicit in the manifest, candidates, moves, intents, derived IDs/idempotency keys, and persistence/authentication payloads. Recapture and exactly compare the current root with that frozen identity before and after every external wait, before creating or refreshing any guard, and before returning complete. Resume also performs the comparison before calling `verify_manifest_receipt`. Moving, replacing, or recreating the Vault forbids later persistence, new guard creation, automatic resume, and subsequent side effects.
   2. Persist an intent before every side effect. After persisting a move intent, recompute the frozen inventory and create fresh source and target guards. Nothing asynchronous, no persistence, and no other callback may occur between the last guard revalidation and invoking `move_with_link_update`. Retain the new guards returned by `advanceVaultPathGuard`, then persist per-file `moves` and the move receipt.
   3. Immediately after every persistence call or external wait returns, revalidate every advanced target guard and current target inventory. This includes `memory_notify`, `confirm_index`, `memory_forget`, every successful receipt persistence, and final complete persistence. A step may be skipped only when its successful trusted receipt was persisted; otherwise replay safely with the same `idempotency_key` or fail closed. Perform one final synchronous revalidation immediately before returning complete, with no later wait or external call.
   4. Call `memory_forget` once only after every file from every candidate for the same project has a confirmation receipt. An empty project cannot pass vacuously. Never call `memory_forget` for drafts, plans, or diaries.
   5. Draft, plan, and diary candidates must be regular files. A project can be a regular file or a non-empty directory containing at least one confirmable regular file. Every raw directory entry must already be NFC and must reject controls, Windows-invalid characters, reserved names, symlinks, and non-regular files.
   6. Any failure stops the entire run; do not process another candidate. Resume only with the same `run_id`, original candidates, and the same authenticated envelope. Reject automatic resume when a source reappears or when the candidate graph, path, derived ID, inventory, or receipt differs. Schema, Vault identity, and receipt validation are untrusted stages: failure returns only a local `failed`, `unverified`, null-receipt result with manual-recovery guidance, calls neither persistence nor business side effects, and never overwrites the trusted store's last valid recovery point. If target drift is found after `confirm_index` or `memory_forget` has occurred, explicitly record the corresponding applied effect and never return complete.

4. **Run the required archive metadata transaction:**
   - After the move transaction returns an authenticated `complete` envelope, immediately call `runArchiveMetadataTransaction({ vault_root, run_id, archive_date, move_envelope, manifest, adapters })` from `scripts/archive_metadata_transaction.mjs`. The metadata transaction uses a new `run_id` distinct from the move transaction. Its `adapters` must provide `persist_manifest`, `verify_manifest_receipt`, `write_archived_frontmatter`, `memory_notify`, and `confirm_index`
   - The metadata transaction first verifies the parent move-envelope receipt and derives targets only from the parent manifest's per-file `moves`. Every `project`, `draft`, and `plan` candidate must have exactly one main file whose `type` matches and whose `status` is `done`; diary entries do not receive an `archived` field. Zero or multiple matches fail closed before any metadata write
   - Persist a write intent for each target, then have `write_archived_frontmatter` compare-and-swap against `before_sha256`, add `archived: "YYYY-MM-DD"`, and preserve `status: done`. After persisting the write receipt, run and persist per-file `memory_notify` and `confirm_index` receipts
   - A metadata failure leaves the completed move transaction unchanged. Resume with the same metadata `run_id` and authenticated envelope; only persisted write, notification, or confirmation receipts may skip work. Never rerun or pretend to roll back the completed move transaction
   - This Archive run must not rewrite archived-target frontmatter or today's diary outside these two transactions. A diary log is outside the Archive write set and is not an archival completion condition
   - Only when both the move transaction and metadata transaction return `complete` may this Archive workflow report completion. A missing `archived` write, notification, or index confirmation for any `project`, `draft`, or `plan` must be reported as partial completion with recovery instructions

5. **Cleanup check:**
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
- Plan_2026-03-27_Project_LifeOS.md → archived/plans/ (keeps done)
- Plan_2026-03-27_Research_Agents.md → archived/plans/ (keeps done)

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
- **Metadata transaction is a completion gate** — after moving, the archive metadata transaction is required; never patch `archived` outside the transaction or report completion until both transactions complete

# Edge Cases

- **Nothing to archive:** Inform the user the vault is tidy; suggest using `/research`, `/project`, or `/knowledge` to process pending drafts
- **Plan still active:** Skip it and tell the user the plan is not complete yet, so it cannot be archived
- **Fewer than 7 days of diary entries:** Do not archive any diary entries; explain that the diary directory is still within the retention window
- **Diary filename does not match `YYYY-MM-DD.md`:** Skip the file and mention it in the summary to avoid archiving non-standard files by mistake
- **Folder project with mixed statuses:** Skip the entire folder, do not archive individual child files, and explain the skip in the completion report
- **Large project with resources:** Leave associated resources in `{resources directory}/`, list them in the completion report, and do not move or clean them automatically
- **Recently completed project:** Archive it normally, then suggest an optional retrospective in the completion report
- **File move or transaction-step failure:** Stop the entire run immediately, preserve the same manifest/envelope, and report the failed step and manual recovery action. Resume only with the same `run_id` and authenticated envelope after correcting the cause
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

Read `_shared/operation-safety.md`, then use the published assets `scripts/archive_transaction.mjs` and `scripts/archive_metadata_transaction.mjs` in order. The move adapter preflights the whole candidate graph and every collision, safely creates destination parents, and freezes and repeatedly verifies per-file inventories. The metadata adapter verifies the completed move envelope, derives the unique main files, and closes the `archived` date write. Both transactions persist an intent before every side effect and a receipt after every successful side effect, and resume trusts only an exact envelope verified by `verify_manifest_receipt`. Neither adapter promises exactly-once behavior or cross-system atomicity, and neither can eliminate the race between final revalidation and the system call. Adapters and authentication receipts remain external trust boundaries.

<!-- operation-safety-v1 -->
```yaml
contract_version: 1
safety_protocol: operation-safety-v1
operation: archive
run_id: stable(archive, candidate-paths, archive-date)
target_paths:
  project-file: "{system directory}/{archived projects subdirectory}/YYYY/<project-name>.md"
  project-directory: "{system directory}/{archived projects subdirectory}/YYYY/<project-name>/"
  draft: "{system directory}/{archived drafts subdirectory}/YYYY/MM/<filename>.md"
  plan: "{system directory}/{archived plans subdirectory}/<filename>.md"
  diary: "{system directory}/{archived diary subdirectory}/YYYY/MM/YYYY-MM-DD.md"
decision: [create, merge, resume, skip, replace]
adapter: scripts/archive_transaction.mjs
external_callbacks: [persist_manifest, verify_manifest_receipt, move_with_link_update, memory_notify, confirm_index, memory_forget]
transaction_steps: [preflight_all, create_target_parents, freeze_inventory, persist_manifest, persist_move_intent, revalidate_inventory, create_fresh_move_guards, move_once, advance_move_guards, record_file_moves, persist_move_receipt, memory_notify_each, confirm_index_each, memory_forget_project]
directory_creation:
  create_guard: createVaultDirectoryGuard
  ensure: ensureVaultDirectory
  recursive_mkdir: forbidden
inventory:
  freeze_before_move: all_candidate_files
  revalidate_after_each_persist: true
  subitem_names: nfc_exact_no_control_windows_safe
  entity_shapes: project_file_or_nonempty_directory_others_file_only
  directory_move: once
  manifest_moves: per_file_source_target
move_guards:
  intent_persisted_before_revalidation: true
  fresh_after_intent_persist: true
  last_revalidate_adjacent_to_call: true
  source: { before: existing, after: missing }
  target: { before: missing, after: existing }
  advance: advanceVaultPathGuard
persistence:
  manifest_contract_version: 2
  persist_callback: persist_manifest
  verify_callback: verify_manifest_receipt
  envelope_keys: [manifest, persistence_receipt, persistence_state]
  receipt_required_for_resume: true
  unauthenticated_resume: fail_closed_manual_recovery
  schema: recursive_exact_keys_and_derived_ids
vault_binding:
  identity_fields: [realpath, root_dev, root_ino]
  frozen_for_run: true
  manifest: required
  candidate_move_intent: explicit
  derived_keys: [candidate_key, move_id, idempotency_key]
  persistence_payloads: explicit
  resume: exact_match_before_receipt_verification
  revalidate_at:
    - before_external_await
    - after_external_await
    - before_guard_create_or_refresh
    - before_complete_return
  all_external_callbacks: true
  changed_root: fail_closed_manual_recovery
untrusted_resume:
  trust_checks: [schema, vault_identity, receipt]
  persist_manifest: forbidden
  side_effect_callbacks: forbidden
  result: local_failed_unverified_null_receipt
terminal_revalidation:
  after_callbacks: [move_with_link_update, memory_notify, confirm_index, memory_forget]
  after_receipt_persist: advanced_target_guards_and_inventory
  after_complete_persist: advanced_target_guards_and_inventory
  before_complete_return: synchronous
  await_after_final_revalidation: forbidden
effects:
  intent_before_side_effect: persisted
  receipt_after_side_effect: persisted
  resume: trusted_receipt_or_same_idempotency_key_replay
  malformed_result: stop_and_record
notify:
  contract_version: 2
  file_path: <new-vault-relative-path>
  previous_file_path: <old-vault-relative-path>
forget:
  scope_type: project
  allowed_after: all_project_files_confirmed
  forbidden_entity_types: [draft, plan, diary]
  forbidden_when: [move_failed, notify_failed, index_unconfirmed]
manifest_updates:
  candidate: candidates
  inventory: inventories
  move_state: candidate_states
  move: moves
  collision: collisions
  intent: intents
  move_receipt: move_receipts
  memory_notify: notified
  confirm_index: confirmed
  memory_forget: forgotten
  failure: errors
resume:
  required_match: [run_id, candidates, inventories, derived_ids, receipt]
  moved_state: source_missing_target_existing
  source_restored: reject
  skip_confirmed_files: trusted_receipt_only
  external_idempotency_key: required
stop_semantics:
  any_failure: stop_entire_run
  resume: same_run_id_same_authenticated_envelope
  continue_other_candidates: false
guarantees:
  exactly_once: false
  atomic_cross_system: false
  last_revalidate_to_syscall_atomic: false
post_transaction_writes:
  current_run: forbidden
  archived_frontmatter: required_metadata_transaction
  diary_log: not_part_of_archive
metadata_transaction:
  adapter: scripts/archive_metadata_transaction.mjs
  required_after: move_transaction_complete
  run_id: stable(archive-metadata, parent-run-id, archive-date, derived-target-paths)
  parent_trust: verify_completed_move_envelope_receipt
  target_derivation: exactly_one_matching_frontmatter_per_non_diary_candidate
  eligible_entity_types: [project, draft, plan]
  preserved_status: done
  mutation: { field: archived, value: YYYY-MM-DD }
  external_callbacks: [persist_manifest, verify_manifest_receipt, write_archived_frontmatter, memory_notify, confirm_index]
  transaction_steps: [verify_parent_receipt, derive_metadata_targets, persist_manifest, persist_write_intent, write_archived_frontmatter, persist_write_receipt, memory_notify_each, confirm_index_each]
  completion_gate: move_and_metadata_transactions_complete
  recovery: same_run_id_same_authenticated_envelope
  guarantees:
    exactly_once: false
    atomic_with_move_transaction: false
bare_mv: forbidden
```
