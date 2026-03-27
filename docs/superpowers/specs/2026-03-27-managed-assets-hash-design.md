# Managed Assets Hash Tracking Design

**Date:** 2026-03-27

## Goal

Teach `lifeos init` and `lifeos upgrade` to track managed asset hashes in `lifeos.yaml` so upgrades can distinguish unchanged built-in files from user-customized files.

## Problem

Current upgrade behavior is conservative but blunt: if a managed file differs from the incoming asset, it is skipped. That protects user edits, but it also prevents automatic upgrades for unchanged built-in files from older versions because the CLI cannot tell whether the difference came from the user or from a new LifeOS release.

## Chosen Approach

Store per-file managed metadata in `lifeos.yaml`:

```yaml
managed_assets:
  "90_系统/模板/Daily_Template.md":
    version: "1.0.0"
    sha256: "..."
```

Only assets that are synchronized by the managed asset installers are tracked:

- templates
- schema files
- prompts
- `.agents/skills/**`

## Upgrade Rules

For each managed file during `upgrade`:

1. If the destination file is missing, copy the incoming asset and write the new hash.
2. If the destination file matches the incoming asset, keep it and refresh metadata to the current version/hash.
3. If stored metadata exists and the current file hash matches the stored hash, treat the file as unmodified and upgrade it to the new asset.
4. If stored metadata exists and the current file hash differs from the stored hash, treat the file as user-modified and skip it.
5. If no stored metadata exists and the current file differs from the incoming asset, skip it conservatively.

This keeps old non-tracked vaults safe while allowing tracked vaults to receive automatic asset upgrades.

## Init Rules

`init` writes `managed_assets` after the initial scaffold sync. The metadata reflects the files actually installed into the new vault.

## Data Model

Extend `LifeOSConfig` with:

- `managed_assets?: Record<string, { version: string; sha256: string }>`

The metadata key is the same relative display path already used in installer results.

## Scope

This change does not alter:

- `CLAUDE.md` / `AGENTS.md` handling
- `.gitignore` handling
- MCP merge behavior

Those remain create-if-missing or merge-missing only.

## Testing Strategy

- `init` should write `managed_assets` entries into `lifeos.yaml`
- `upgrade` should auto-upgrade files whose current hash still matches the stored managed hash
- `upgrade` should skip files whose current hash diverges from the stored managed hash
- `upgrade` should remain conservative when `managed_assets` metadata is absent
