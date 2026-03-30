# User-Managed Git Design

**Date:** 2026-03-30

## Goal

Remove Git from the LifeOS scaffold contract so version control is fully user-managed rather than automatically initialized by `lifeos init` or restored by `lifeos upgrade`.

## Problem

LifeOS currently treats Git as part of the generated workspace:

- `init` tries to create a Git repository
- `sync-vault` writes a default `.gitignore`
- `upgrade` restores missing `.git`
- docs present Git as a required dependency

This is stronger than necessary for the product. The memory server, vault indexing, active docs, and MCP registration do not require Git to function. Automatically creating a repository imposes a workflow decision that should belong to the user.

## Chosen Approach

Make Git completely optional and remove all Git bootstrap behavior from the CLI.

After this change:

- `lifeos init` creates the vault scaffold, configs, prompts, skills, and MCP registration only
- `lifeos init` does not run `git init`
- `lifeos init` does not create `.gitignore`
- `lifeos upgrade` does not restore `.git`
- `lifeos upgrade` does not restore `.gitignore`
- Git is removed from required prerequisite documentation and checks

If users want version control, they can initialize and manage Git themselves.

## Alternatives Considered

### 1. Keep current behavior

Pros:

- convenient for users who want Git immediately
- no implementation work

Cons:

- forces a workflow choice
- makes Git look like a product requirement when it is not

### 2. Make Git optional via a CLI flag

Pros:

- preserves convenience for users who want automatic setup

Cons:

- adds product surface area for a non-core concern
- still keeps Git coupled to scaffold semantics

### 3. Remove Git from the scaffold contract

Pros:

- matches actual product requirements
- keeps LifeOS focused on vault and MCP setup
- avoids surprising repository creation

Cons:

- users who want Git must run `git init` themselves

This is the chosen approach.

## Implementation Surface

### CLI behavior

- remove Git prerequisite reporting from `init`
- remove automatic Git repository creation from vault sync/setup
- remove automatic `.gitignore` creation from vault sync/setup

### Upgrade behavior

- stop treating `.git` and `.gitignore` as managed scaffold artifacts
- preserve existing user-created `.git` and `.gitignore` files by simply not touching them

### Documentation

- remove Git from required dependencies
- remove claims that `init` creates a Git repository
- remove upgrade documentation that says missing Git metadata is restored
- add a short note that users may initialize Git themselves if desired

## Compatibility and Migration

- existing LifeOS vaults that already contain `.git` remain valid
- existing user-authored `.gitignore` files remain untouched
- no migration step is needed because the change only removes automatic creation/restoration
- no memory-system behavior changes

## Out of Scope

This change does not:

- add a `--git` flag
- migrate existing repositories
- modify user-owned `.gitignore` contents
- remove Git-related docs outside the LifeOS product surface unless they directly describe scaffold behavior
- change memory DB, indexing, or MCP transport behavior

## Testing Strategy

- `init` succeeds when Git bootstrap side effects are absent
- `init` no longer creates `.git`
- `init` no longer creates `.gitignore`
- `upgrade` no longer restores `.git`
- `upgrade` no longer restores `.gitignore`
- doctor and prerequisite output no longer rely on Git
- full `release:verify` remains green
