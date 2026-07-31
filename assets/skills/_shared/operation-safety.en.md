# Operation Safety Protocol

Use this protocol for skills that create, update, move, or resume Vault artifacts. Read `scripts/path_safety.mjs` first; every filename component and destination must pass it.

<!-- operation-safety-v1 -->
```yaml
contract_version: 1
run_id: stable(<skill>, <canonical-input>, <time-window-or-mode>)
target_path: resolved-vault-relative-path
decision: [create, merge, resume, skip, replace] # create|merge|resume|skip|replace
manifest: { run_id: string, moves: [], collisions: [], notified: [], errors: [] }
```

## Shared constraints

1. **Preflight**: before writing or moving, resolve paths, check collisions, and read an existing `run_id` and status. Record every collision in the manifest before any move.
2. **Stable run identity**: normalized equal input and time window/mode must produce the same `run_id` and target path. Allow `replace` only after an explicit user request; otherwise use `merge`, `resume`, or `skip`.
3. **Managed regions**: update only `BEGIN AUTO` / `END AUTO` managed region markers and preserve user-authored material and source lists.
4. **Paths and notification**: operate only on a successful `resolveVaultPath`. Call `memory_notify` after every real file change; record notification failures and never claim completion.
5. **Recovery**: persist errors and completed steps in the manifest, provide rollback/recovery actions that reverse it, and use the same `run_id` to `resume`.

## Degradation

Use `move_with_link_update` for a link-changing move. If unavailable, require explicit user acceptance of the degradation; never silently use bare `mv`.
