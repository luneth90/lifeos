# Digest Bilingualization Design

**Date:** 2026-03-30

## Goal

Make the `digest` skill fully bilingual and add a first-class system subdirectory for digest
configuration notes.

This change must let `zh` vaults use `90_系统/信息/` and `en` vaults use
`90_System/Digest/`, while keeping upgrade behavior safe for existing vaults that already store
digest configuration under the old Chinese path.

## Problem

`digest` is currently the odd skill out in two ways:

- it only ships as a single Chinese `SKILL.md` instead of the repository's standard
  `SKILL.zh.md` / `SKILL.en.md` asset layout
- it hardcodes `{系统目录}/信息/` instead of using a configured system subdirectory

That creates three planning problems:

1. English vaults cannot receive a real English `digest` skill package.
2. The digest configuration directory is not represented in `lifeos.yaml` presets, so init,
   doctor, and upgrade do not treat it as part of the expected vault structure.
3. Existing vaults that already use `90_系统/信息/` need a safe migration path once the directory
   becomes configurable.

## Chosen Approach

Treat digest configuration as a new `subdirectories.system.digest` entry and bilingualize the
entire `digest` skill package to match the rest of the asset system.

The implementation will use one Python script, one logical config model, and language-specific
markdown assets:

- `ZH_PRESET.subdirectories.system.digest = "信息"`
- `EN_PRESET.subdirectories.system.digest = "Digest"`
- `assets/skills/digest/SKILL.zh.md` and `assets/skills/digest/SKILL.en.md`
- language-paired digest reference docs under `assets/skills/digest/references/`
- one `rss-arxiv-script.py` file shared by both languages

## Config Model

Extend the config model in `src/config.ts` and `assets/lifeos.yaml` with:

```yaml
subdirectories:
  system:
    digest: 信息
```

The English preset uses `Digest` instead of `信息`.

Once this field exists:

- `VaultConfig.subDirPath('system', 'digest')` and `subDirPrefix('system', 'digest')` must work
- vault initialization must create the physical digest directory automatically through the existing
  generic subdirectory traversal
- callers must reference the digest directory through logical config instead of hardcoded path text

`doctor` should validate expected directories from the resolved vault config rather than from the
raw language preset alone. That keeps checks correct when a user has renamed directories in
`lifeos.yaml`.

## Skill Asset Structure

The digest skill package should follow the same bilingual asset convention already used by skills
such as `project`, `research`, `today`, and `archive`.

The asset tree becomes:

- `assets/skills/digest/SKILL.zh.md`
- `assets/skills/digest/SKILL.en.md`
- `assets/skills/digest/references/setup-guide.zh.md`
- `assets/skills/digest/references/setup-guide.en.md`
- `assets/skills/digest/references/config-parser.zh.md`
- `assets/skills/digest/references/config-parser.en.md`
- `assets/skills/digest/references/run-pipeline.zh.md`
- `assets/skills/digest/references/run-pipeline.en.md`
- `assets/skills/digest/references/rss-arxiv-script.py`

During install and upgrade, the existing language resolver should map the chosen language files to
the installed vault paths without `.zh` / `.en` suffixes:

- `.agents/skills/digest/SKILL.md`
- `.agents/skills/digest/references/setup-guide.md`
- `.agents/skills/digest/references/config-parser.md`
- `.agents/skills/digest/references/run-pipeline.md`

No new installer mechanism is needed. `digest` should simply conform to the current skill asset
layout.

## Runtime Localization Rules

User-visible digest behavior should follow the vault language consistently.

For `zh` vaults:

- config notes live under `{系统目录}/{信息子目录}/`
- generated config templates, section headings, table headers, weekly digest titles, and completion
  messages are Chinese
- weekly digest output is Chinese

For `en` vaults:

- config notes live under `{system directory}/{digest subdirectory}/`
- generated config templates, section headings, table headers, weekly digest titles, and completion
  messages are English
- weekly digest output is English

The Python script remains a single shared implementation. It receives a `language` field in its
JSON input and keeps a stable English-keyed JSON output contract for the calling skill. Only
user-visible fallback strings change by language, such as:

- fetch failure placeholders
- default untitled labels
- abbreviated author suffixes such as `et al.` versus `等`

All Python comments and docstrings should be English so the source stays single-maintenance.

## Upgrade Migration Rules

`lifeos upgrade` should add a targeted migration step for existing digest config directories before
writing the updated `lifeos.yaml`.

Migration behavior:

1. Resolve the merged config and compute the target digest directory from
   `directories.system + subdirectories.system.digest`.
2. Look for the legacy Chinese digest directory under the current system directory:
   `system/信息`.
3. If the legacy path exists, the target path is different, and the target path does not exist,
   rename the whole directory to the target path.
4. If both legacy and target paths already exist, do not merge or overwrite automatically. Keep the
   upgrade conservative and surface a warning.
5. After migration, persist the updated config so `subdirectories.system.digest` is stored in
   `lifeos.yaml`.

Digest configuration notes are user content, not managed assets. They should never be added to
`managed_assets`, and migration should not try to rewrite managed asset hashes for them.

## Testing Strategy

At minimum, add or update tests for:

- config presets and `VaultConfig` accessors for `system.digest`
- `lifeos init` creating the digest subdirectory for both `zh` and `en`
- `lifeos init` writing `subdirectories.system.digest` into `lifeos.yaml`
- language resolution for `digest` skill files and digest reference docs
- skill installation choosing the correct digest language variant
- `lifeos doctor` passing when the configured digest directory exists and warning when it is missing
- `lifeos upgrade` migrating a legacy `system/信息` directory into the configured digest directory
- conservative upgrade behavior when both legacy and target digest directories already exist

If practical, add a focused test for the Python script's language-dependent fallback strings without
making real network requests. If script test infrastructure is not worth introducing in this change,
keep the script interface narrow and deterministic so that later tests remain easy to add.

## Out of Scope

This change does not:

- add a new MCP tool or server-side TypeScript service for digest execution
- track digest configuration notes as managed assets
- merge conflicting digest directories automatically during upgrade
- redesign the digest workflow beyond the language and path changes described above
