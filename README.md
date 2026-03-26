# LifeOS

AI-native Knowledge OS — an Obsidian + AI Agent powered workspace for lifelong learning.

## What is it

LifeOS is a knowledge management system built on Obsidian Vault. AI Agent skills automate the capture, organization, review, and output of knowledge. It's not an app — it's a workspace you live in.

**Core components:**

- **MCP Server** — Memory system providing vault indexing, session memory, and context assembly for AI agents
- **CLI scaffold** — `npx lifeos init` to bootstrap a complete workspace
- **Skill system** — 9 Agent skills covering diary, projects, research, knowledge curation, review, and more
- **Templates + Schema** — 8 structured templates + Frontmatter schema for consistent notes

## Quick Start

```bash
# Create a new LifeOS workspace (auto-detects language from system locale)
npx lifeos init ./my-vault

# Or specify language explicitly
npx lifeos init ./my-vault --lang zh   # Chinese
npx lifeos init ./my-vault --lang en   # English

# Skip MCP registration (config files only)
npx lifeos init ./my-vault --no-mcp

# Open with Obsidian, then start working with your AI coding assistant
```

After init, MCP server configs are automatically registered for:

| Tool | Config file |
|---|---|
| **Claude Code** | `.mcp.json` |
| **Codex** | `.codex/config.toml` |
| **OpenCode** | `opencode.json` |

Launch any of these tools in the vault directory to use all skills.

## CLI Commands

```bash
lifeos init [path] [--lang zh|en] [--no-mcp]  # Create new vault
lifeos upgrade [path]                           # Upgrade assets (templates, skills, schema)
lifeos doctor [path]                            # Health check
lifeos rename [path] --logical <name> --name <new>  # Rename a directory
lifeos --help                                   # Show help
lifeos --version                                # Show version
```

### init

Creates a complete LifeOS workspace:

- 10 top-level directories + nested subdirectories
- 8 Markdown templates
- Frontmatter schema
- 9 AI skills (language-aware)
- `CLAUDE.md` agent behavior spec
- `lifeos.yaml` config
- Git init + `.gitignore`
- MCP server registration (Claude Code / Codex / OpenCode)

### upgrade

Three-tier upgrade strategy:

| Strategy | Files | Behavior |
|---|---|---|
| **Overwrite** | Templates, schema | Always update to latest |
| **Smart merge** | Skill files | Unmodified → update; modified → skip with warning |
| **Hands off** | `CLAUDE.md`, `lifeos.yaml` | Preserve user customizations |

### doctor

Checks vault integrity: directory structure, templates, schema, skills, config, Node.js version, asset version.

### rename

Renames a logical directory (e.g. `drafts`) to a new physical name, updates `lifeos.yaml`, and batch-replaces all wikilinks across the vault.

## Skills

| Skill | Description |
|---|---|
| `/today` | Morning planning: review yesterday, plan today |
| `/project` | Idea → structured project |
| `/research` | Topic → deep research report |
| `/knowledge` | Book/paper → knowledge note |
| `/review` | Generate quizzes, grade, track mastery |
| `/read-pdf` | PDF → structured notes |
| `/ask` | Quick Q&A |
| `/brainstorm` | Interactive brainstorming |
| `/archive` | Archive completed projects and drafts |

## Tech Stack

- **Runtime:** TypeScript + Node.js 18+
- **Database:** SQLite + FTS5 (full-text search)
- **Segmentation:** @node-rs/jieba (Chinese tokenization)
- **Protocol:** MCP (Model Context Protocol)
- **Vault:** Obsidian (plain Markdown + Frontmatter)

## Development

```bash
git clone git@github.com:luneth90/lifeos.git
cd lifeos
npm install
npm run build    # Compile TypeScript
npm test         # Run tests (431 tests)
npm run dev      # Dev mode (hot reload)
```

## License

[MIT](LICENSE)
