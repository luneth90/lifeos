# Upgrade Override Design

**Date:** 2026-03-28

## Goal

Add `lifeos upgrade --override` so users can force-refresh LifeOS-managed assets and managed config files without deleting user-generated content or memory-system data.

## Problem

`lifeos upgrade` is intentionally conservative. It protects user edits, but that also blocks a recovery path when a vault needs to be reset back to the latest built-in assets and CLI integration files.

The reset scope must stay narrow. User notes, resources, `memory.db`, active memory docs, session logs, and custom vault directory layout cannot be deleted or cleared by `--override`.

## Chosen Approach

Treat `--override` as a force-refresh for managed files only:

- templates
- schema files
- prompt files
- `.agents/skills/**`
- `CLAUDE.md`
- `AGENTS.md`
- `.mcp.json`
- `.codex/config.toml`
- `opencode.json`

The command will continue using the existing `lifeos.yaml` directory and subdirectory mapping. It will not rewrite `directories`, `subdirectories`, `memory`, or unknown custom fields in `lifeos.yaml`.

## Override Rules

When `lifeos upgrade --override` runs:

1. Managed asset installers switch from `smart-merge` to `overwrite`.
2. Rules files switch from create-if-missing to overwrite.
3. MCP registration switches from merge-missing to replace.
4. `installed_versions` and `managed_assets` are refreshed to the current CLI version.
5. Missing managed directories are still recreated.
6. User-generated content outside the managed file set is left untouched.

## Out of Scope

This change does not:

- migrate or rename user directories
- rewrite `lifeos.yaml` directory mappings
- delete extra files or directories
- delete `memory.db` or any memory-system records
- reset `.git` state

## Testing Strategy

- `upgrade --override` should overwrite modified templates
- `upgrade --override` should overwrite modified skills
- `upgrade --override` should overwrite `CLAUDE.md` and `AGENTS.md`
- `upgrade --override` should replace existing MCP config entries
- `upgrade --override` should preserve custom `lifeos.yaml` directory mappings
- `upgrade --override` should not remove user-created notes or `memory.db`
