# Operation Safety Protocol

Use this protocol for skills that create, update, move, or resume Vault artifacts. Read `scripts/path_safety.mjs` first; every filename component and destination must pass it.

<!-- operation-safety-v1 -->
```yaml
contract_version: 1
preflight: required
validation: required
notification: memory_notify
collision: preflight_required
recovery: resume_same_run_id
run_id: stable(<skill>, <canonical-input>, <time-window-or-mode>)
target_path: resolved-vault-relative-path
decision: [create, merge, resume, skip, replace] # create|merge|resume|skip|replace
path_guard:
  resolve_scope: preflight_only
  create: createVaultPathGuard
  revalidate: revalidateVaultPathGuard
  advance: advanceVaultPathGuard
  captures: [ancestors, leaf_state, leaf_type, leaf_dev, leaf_ino, leaf_realpath]
  default_leaf_expectation: unchanged
  transitions:
    create_or_update_target: { before: missing, after: existing }
    move_source: { before: existing, after: missing }
    move_target: { before: missing, after: existing }
  required_at: [before_operation, after_operation]
  on_change: abort_and_record
  atomic_race_guarantee: false
  untrusted_concurrency: require_atomic_client_capability
directory_creation:
  create_guard: createVaultDirectoryGuard
  ensure: ensureVaultDirectory
  strategy: guard_revalidate_single_level_mkdir_advance_revalidate
  recursive_mkdir: false
manifest: { run_id: string, moves: [], collisions: [], notified: [], errors: [] }
```

## Shared constraints

1. **Preflight**: before writing or moving, resolve paths, check collisions, and read an existing `run_id` and status. Record every collision in the manifest before any move.
2. **Stable run identity**: normalized equal input and time window/mode must produce the same `run_id` and target path. Allow `replace` only after an explicit user request; otherwise use `merge`, `resume`, or `skip`.
3. **Managed regions**: update only `BEGIN AUTO` / `END AUTO` managed region markers and preserve user-authored material and source lists.
4. **Path guard and notification**: `resolveVaultPath` is preflight-only; its returned string is not a durable safety capability. Create a `createVaultPathGuard` for the final target. It captures both ancestor identities and the leaf with `lstat`; an existing leaf must not be a symlink and records type, dev, ino, and realpath, while an absent leaf records `missing`. Call `revalidateVaultPathGuard` immediately before each actual write/move; its default expectation is that both ancestor and leaf state and identity remain unchanged. Call it again after an in-place update. When an operation legitimately changes leaf state, call `advanceVaultPathGuard(guard, { before, after })` immediately afterward and replace the old guard with the returned guard. The only allowed transitions are create/update target `missing → existing`, move source `existing → missing`, and move target `missing → existing`. Advancing to `existing` still rejects symlinks and confirms that realpath remains inside the Vault. Abort and record recovery on any unexpected state, type, dev, ino, realpath, or parent identity change. Never retain and reuse a bare path after guard validation. Call `memory_notify` after every real file change; record notification failures and never claim completion.
5. **Directory creation**: never bypass guards with recursive creation. Call `createVaultDirectoryGuard` to freeze every level from the existing Vault root to the destination directory, then call `ensureVaultDirectory`. Every missing directory performs create guard → immediate revalidation → single-level `mkdir` → `missing → existing` advance → revalidation. Every existing directory must also validate non-symlink status, directory type, identity, and ancestor identities. Fail closed on any change.
6. **Recovery**: persist errors, completed steps, and manual recovery actions in the manifest, then use the same `run_id` to `resume`. Never claim that an operation was automatically reversed when no such implementation exists.

## Atomic race boundary

The guard detects parent or leaf replacement between validations. An explicit state advance verifies the actual post-operation state, but cannot prove that the current operation created that object. Cross-platform Node also cannot eliminate an atomic race caused by an untrusted process between the final validation and the system call. This protocol does not claim that guarantee. If the threat model includes such concurrent tampering, require a client-provided controlled atomic file capability that does not follow symlinks; fail closed when it is unavailable.

## Degradation

Use `move_with_link_update` for a link-changing move. If unavailable, require explicit user acceptance of the degradation; never silently use bare `mv`.
