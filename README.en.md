# LifeOS

[中文](./README.md) | English

LifeOS helps you grow scattered ideas into structured knowledge and truly master it, from quick captures, to brainstorming and deep research, to systematic project planning and knowledge notes, to spaced review and mastery tracking. The goal is not just building a knowledge base, but helping you understand, internalize, and command complex knowledge.

## Memory System

> **Why the memory system matters**
>
> The memory system is LifeOS's core capability. It works in a directory-scoped, skill-bound way, continuously preserving the context, preferences, and decisions that emerge during learning so long-term learning becomes more continuous, more traceable, and easier to build on.
>
> 1. **Cross-session continuity**: session bridges and active-document context persist, so agents do not depend only on the current conversation.
> 2. **Project-scoped and skill-bound**: the memory system runs around the current LifeOS project in the vault, activates only inside workflows such as `today`, `project`, `research`, `knowledge`, `revise`, and `archive`, and keeps accumulating preferences, decisions, and context.
> 3. **More controllable than global memory**: compared with a memory model that mixes cross-directory content and global conversations together, a project-scoped, skill-bound memory system reduces irrelevant noise and keeps retrieval and follow-up decisions closer to the current LifeOS workflow.

**Core components:**

- **Memory system** — Project-scoped and skill-bound, providing vault indexing, session memory, and context assembly for AI agents
- **CLI scaffold** — `npx lifeos init` to bootstrap a complete workspace
- **Skill system** — 9 Agent skills covering diary, projects, research, knowledge curation, review, and more
- **Templates + Schema** — 8 structured templates + Frontmatter schema for consistent notes

## Prerequisites

| Dependency | Required | Purpose |
|---|---|---|
| **Node.js 18+** | Required | Runtime for MCP server and CLI |
| **Git** | Required | Version control for vault data, including the memory DB |
| **Python 3** | Required | PDF extraction (`/read-pdf` skill) |

`lifeos init` checks all prerequisites before creating the workspace.

## Quick Start

Before starting, make sure Obsidian and at least one of Claude Code / Codex / OpenCode CLI are installed locally.

```bash
# Create a new LifeOS workspace (auto-detects language from system locale)
npx lifeos init ./my-vault

# Or specify language explicitly
npx lifeos init ./my-vault --lang zh   # Chinese
npx lifeos init ./my-vault --lang en   # English
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
npx lifeos init [path] [--lang zh|en] [--no-mcp]       # Create a new vault
npx lifeos upgrade [path] [--lang zh|en]               # Upgrade and restore assets/scaffold
npx lifeos doctor [path]                               # Health check
npx lifeos rename [path]                               # Interactive directory rename
npx lifeos --help                                      # Show help
npx lifeos --version                                   # Show version
```

### init

Creates a complete LifeOS workspace:

- 10 top-level directories plus nested subdirectories
- 8 Markdown templates
- Frontmatter schema
- 9 AI skills with language-aware assets
- `CLAUDE.md` agent behavior spec
- `lifeos.yaml` config
- Git init plus `.gitignore`
- MCP server registration (Claude Code / Codex / OpenCode)

### upgrade

Upgrades and re-syncs an initialized vault:

- **Smart merge**: update unmodified templates, schema files, built-in prompts, and skill files; skip modified ones with a warning
- **Restore missing scaffold**: bring back missing directories and managed files such as the memory directory, `.claude/skills`, `CLAUDE.md`, `AGENTS.md`, `.gitignore`, `.git`, and MCP config entries
- **Preserve user changes**: built-in files already customized by the user are not force-overwritten

### doctor

Checks vault integrity: directory structure, templates, schema, skills, config, Node.js version, and asset version.

### rename: Directory Customization

No extra flags are required. Run `npx lifeos rename [path]` and the CLI will show the directories available in the current vault, then guide you step by step to choose one and enter a new name. It updates `lifeos.yaml`, renames the actual directory, and batch-replaces related wikilinks across the vault.

This means LifeOS does not lock you into fixed directory names. You can freely adapt directory names to your own workflow, language preference, and project structure while keeping configuration and links consistent.

## Skills

| Skill | Description |
|---|---|
| `/today` | Morning planning: review yesterday, plan today |
| `/project` | Idea -> structured project |
| `/research` | Topic -> deep research report |
| `/knowledge` | Book/paper -> knowledge note |
| `/revise` | Generate quizzes, grade, and track mastery |
| `/read-pdf` | PDF -> structured notes |
| `/ask` | Quick Q&A |
| `/brainstorm` | Interactive brainstorming |
| `/archive` | Archive completed projects, processed drafts, completed plans, and diary entries older than the most recent 7 days |

## Custom Expert Prompts

The `/research` skill automatically scans the Prompts directory in your vault for expert prompt files. LifeOS ships with built-in expert prompts for AI/LLM, Math, Art, and History, and you can add your own to extend research capabilities to any domain.

### How It Works

When you invoke `/research`, the Planning Agent:

1. Lists all `.md` files in `{system directory}/Prompts/`
2. Reads each file's frontmatter and **Domain Coverage** section
3. Matches the research topic to the best-fit expert prompt
4. Applies the matched prompt's analytical framework and output format to the research report

### Adding Custom Expert Prompts

Create a `.md` file in your vault's Prompts directory (`{system directory}/Prompts/`). The Planning Agent will pick it up automatically on the next `/research` invocation, with no restart or re-init required. Use the built-in prompts in the same directory as a reference for structure.

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

## Acknowledgements

This project was inspired by [MarsWang42/OrbitOS](https://github.com/MarsWang42/OrbitOS). 
