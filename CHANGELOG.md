# Changelog

## 1.1.1 (2026-03-31)

### Bug Fixes

- Fixed silent data loss in `memory_auto_capture` where nested `related_files` fields in corrections, decisions, and preferences were dropped due to missing snake_case→camelCase conversion

### Refactoring

- Extracted `withResolvedDb` and `resolveScene` helpers in `core.ts`, eliminating repeated DB lifecycle boilerplate across all 11 tool handlers
- Extracted `handleTool` generic wrapper in `server.ts` with recursive deep key conversion, replacing 11 manual snake_case→camelCase mapping blocks
- Merged duplicate `refreshTaskboard`/`refreshUserprofile` into a config-driven `refreshActiveDoc`; same for citations
- Removed dead code branches and redundant `hasCjk` parameter in `retrieval.ts`
- Removed unnecessary re-exports from `utils/shared.ts`
- Removed unused `_vaultRoot` parameter from `scanRecentlyModifiedFiles`

### Internal

- Net reduction of ~150 lines across 7 files with no behavioral changes (except the bug fix above)

## 1.1.0 (2026-03-30)

### Features

- Added verified Windows support for OpenCode GUI, alongside the existing macOS support for Claude Code TUI, Codex TUI, and OpenCode TUI
- `lifeos init` and `lifeos upgrade` no longer force-create or manage Git metadata; Git remains user-managed
- Updated README support notes and release workflows to reflect the supported runtime and client matrix

### Internal

- Upgraded the runtime baseline to Node.js 24.14.1+ and refreshed the native dependency stack, including `better-sqlite3` 12.8.0 and `@types/node` 24.x
- Patched the transitive `path-to-regexp` audit issue and added a regression test for dependency/workflow version drift
- Aligned GitHub Actions CI and release workflows with the supported Node.js versions

## 1.0.3 (2026-03-30)

### Features

- Added the `/digest` skill for custom-topic weekly digests
- `/digest` now supports multilingual digest generation with configurable paper sources, RSS, and web search
- Expanded paper-source fetching across `arXiv`, `bioRxiv`, `medRxiv`, `ChemRxiv`, `SocArXiv`, and `SSRN`

## 1.0.0

- Initial release: MCP memory server with 11 tools
- Vault indexing with FTS5 full-text search
- Chinese tokenization via @node-rs/jieba
- Session memory and context assembly
- Active documents (TaskBoard, UserProfile)
