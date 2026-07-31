# Operation Safety Protocol

Use this protocol for skills that create, update, move, or resume Vault artifacts. Read `scripts/path_safety.mjs` first; every filename component and destination must pass it.

<!-- operation-safety-v1 -->
```yaml
contract_version: 1
run_id: stable(<skill>, <canonical-input>, <time-window-or-mode>)
target_path: resolved-vault-relative-path
decision: [create, merge, resume, skip, replace] # create|merge|resume|skip|replace
path_guard:
  resolve_scope: preflight_only
  create: createVaultPathGuard
  revalidate: revalidateVaultPathGuard
  required_at: [before_operation, after_operation]
  on_change: abort_and_record
  atomic_race_guarantee: false
  untrusted_concurrency: require_atomic_client_capability
manifest: { run_id: string, moves: [], collisions: [], notified: [], errors: [] }
```

## Shared constraints

1. **Preflight**: before writing or moving, resolve paths, check collisions, and read an existing `run_id` and status. Record every collision in the manifest before any move.
2. **Stable run identity**: normalized equal input and time window/mode must produce the same `run_id` and target path. Allow `replace` only after an explicit user request; otherwise use `merge`, `resume`, or `skip`.
3. **Managed regions**: update only `BEGIN AUTO` / `END AUTO` managed region markers and preserve user-authored material and source lists.
4. **Path guard and notification**: `resolveVaultPath` is preflight-only; its returned string is not a durable safety capability. Create a `createVaultPathGuard` for the final target and call `revalidateVaultPathGuard` immediately before and after each actual write/move. Abort and record recovery whenever ancestor realpath, dev, or ino changes, or a parent is replaced or becomes a symlink. Never retain and reuse a bare path after guard validation. Call `memory_notify` after every real file change; record notification failures and never claim completion.
5. **Recovery**: persist errors and completed steps in the manifest, provide rollback/recovery actions that reverse it, and use the same `run_id` to `resume`.

## Atomic race boundary

The guard detects parent replacement between validations, but cross-platform Node cannot eliminate an atomic race caused by an untrusted process between the final validation and the system call. This protocol does not claim that guarantee. If the threat model includes such concurrent tampering, require a client-provided controlled atomic file capability that does not follow symlinks; fail closed when it is unavailable.

## Degradation

Use `move_with_link_update` for a link-changing move. If unavailable, require explicit user acceptance of the degradation; never silently use bare `mv`.
