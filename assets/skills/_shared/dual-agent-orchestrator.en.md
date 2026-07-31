# Dual-Agent Execution Orchestration Protocol

This protocol is the sole commit semantics for Project and Research. Read `client-capabilities.md` first and use the semantic `spawn_agent` capability for an independent context; when unavailable, the Orchestrator performs the same prompt, input, and acceptance criteria sequentially.

## Phase 0: Memory and Input Check

Call minimal `memory_query(contract_version=2, ...)` checks for same-topic output, source drafts with `status: pending`, and recent decisions. Read the plan, templates, schema, and source files; a newly created plan must use `status: pending`.

## Phase 1: Planning and Confirmation Snapshot

1. Run the Planning Agent through `spawn_agent`; it returns the plan path, `plan_revision` (starting at `1`), and a SHA-256 `confirmed_hash` of the plan content.
2. Reread the plan and produce a snapshot with its path, revision, hash, source draft, and expected artifacts, then ask the user to confirm.
3. On user cancellation, write `status: cancelled` to the plan, leave source drafts unconsumed, and stop.

## Phase 2: Confirmation Check and Execution

Use this exact order: `plan(status: pending) → snapshot → user-confirm → hash-check → plan(status: active) → execute → manifest → independent-validate → notify-each-file → mutate-sources → plan(status: done) → report`.

Immediately before execution, reread the plan and recalculate SHA-256. Any change to `plan_revision` or `confirmed_hash` invalidates the confirmation snapshot: retain or restore `status: pending`, show the new snapshot, and re-confirm; never execute it. Only after the check may the plan become `status: active` and the Execution Agent start.

The Execution Agent may write only expected artifacts and must not update the plan, source drafts, or persistent memory. It returns a manifest conforming to `assets/schema/Execution_Manifest_Schema.json`, including actual artifacts, validations, proposed status mutations, and `errors`. On failure, set manifest phase to `failed`, plan status to `failed`, and preserve source drafts.

## Phase 3: Independent Validation and Commit

The Orchestrator independently rereads every artifact in the manifest and checks plan scope, templates, schema, links, source ledger, and completeness; an Execution Agent self-report is not acceptance. If any artifact is missing, partial, or fails a required validation, preserve source drafts, set plan status to `failed`, report the gap, and do not commit source states.

After every validation passes, call `memory_notify(contract_version=2, file_path="<Vault-relative path>")` for each artifact, then update eligible source drafts and other source states. Finally set `status: done` on the plan and notify the user. The report must list artifacts, validation results, status mutations, and errors, including an empty errors list.
