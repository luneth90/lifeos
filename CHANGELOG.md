# Changelog

## 1.1.0 (unreleased)

### Features

- **CLI scaffolding**: `lifeos init [path] --lang zh|en` creates a complete LifeOS vault
- **Upgrade command**: `lifeos upgrade` with three-tier strategy (auto-overwrite templates, smart-merge skills, don't-touch user files)
- **Doctor command**: `lifeos doctor` checks vault health (directories, templates, schema, skills, config)
- **MCP auto-registration**: init automatically registers the MCP server for Claude Desktop and Cursor
- **Bilingual support**: all 13 skills, templates, and CLAUDE.md available in both Chinese and English
- **CLI/MCP dispatch**: `bin/lifeos.js` routes between CLI commands and MCP server mode

### Breaking Changes

- Removed `/lifeos-init` skill (replaced by `lifeos init` CLI command)

### Internal

- Added `files` field to `package.json` for clean npm publishing
- Added GitHub Actions CI for Node 18/20/22
- Added bilingual test matrix (zh/en parametrized tests)

## 1.0.0

- Initial release: MCP memory server with 11 tools
- Vault indexing with FTS5 full-text search
- Chinese tokenization via @node-rs/jieba
- Session memory and context assembly
- Active documents (TaskBoard, UserProfile)
