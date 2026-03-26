# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LifeOS Memory System — an MCP server providing persistent knowledge management and session memory for AI assistants. It indexes an Obsidian-compatible vault of markdown files, maintains a session event log, and assembles contextual summaries for skill execution. Exposes 11 tools over MCP stdio transport.

## Commands

```bash
npm run build        # TypeScript compilation (tsc)
npm run dev          # Dev mode with file watching (tsx watch)
npm start            # Production server (node dist/server.js)
npm test             # Run all tests (vitest run)
npm run test:watch   # Tests in watch mode
npx vitest run tests/services/capture.test.ts  # Run a single test file
npm run lint         # Check with Biome
npm run lint:fix     # Auto-fix lint issues
npm run typecheck    # Type check without emitting
```

## Architecture

```
MCP Client (stdio)
  → server.ts          11 tool definitions with Zod input schemas
  → core.ts            Thin dispatch: resolve DB/vault, call service, close DB
  → services/          Business logic (startup, capture, retrieval, enhance, layer0, maintenance)
  → active-docs/       TaskBoard.md and UserProfile.md builders (AUTO section refresh)
  → skill-context/     Context assembly with seed profiles and reranking
  → db/                SQLite schema (FTS5, triggers), connection helpers
  → utils/             Vault indexer, Chinese tokenizer (jieba), scan state, context policy
```

**Data flow:** Vault markdown → `vault-indexer` parses frontmatter/metadata → `vault_index` table (FTS5). User actions → `capture.ts` → `session_log` table (FTS5). Queries go through `retrieval.ts` which uses FTS5 with LIKE fallback and field-weighted scoring.

**Key patterns:**
- DB instances are created per-call in `core.ts` (open → try/service → finally/close)
- `VaultConfig` is a module-level singleton (`config.ts`) resolving logical directory names to paths via `lifeos.yaml`
- Vault supports Chinese (zh) and English (en) directory presets
- Active docs use `<!-- BEGIN AUTO:marker -->` / `<!-- END AUTO:marker -->` blocks to preserve manual content while refreshing generated sections

## Database

SQLite via `better-sqlite3` with WAL mode. Key tables: `vault_index` (indexed markdown files), `session_log` (events), `memory_items` (active doc slots), `enhance_queue`, `scan_state`, `session_state`. FTS5 virtual tables (`vault_fts`, `session_fts`) are auto-synced via triggers.

## Code Style

- **Formatter:** Biome — tabs, 100-char line width, single quotes
- **TypeScript:** strict mode, ES2022 target, Node16 module resolution
- **Validation:** Zod schemas for all MCP tool inputs
- **Module type:** ESM (`"type": "module"` in package.json)

## Testing

Tests use Vitest with `tests/setup.ts` providing fixtures: `createTempVault()` creates isolated vault directories with `lifeos.yaml`, `createTestDb()` initializes an in-memory or temp SQLite DB, `writeTestNote()` creates markdown files with YAML frontmatter.
