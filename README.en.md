# LifeOS
[中文](./README.md) | [English](./README.en.md)

LifeOS helps you grow scattered ideas into structured knowledge and truly master it, from quick captures, to brainstorming and deep research, to systematic project planning and knowledge notes, to spaced review and mastery tracking. The goal is not just building a knowledge base, but helping you understand, internalize, and command complex knowledge.

## Why Build LifeOS?

LifeOS started from a simple goal: package learning workflows, skills, templates, prompts, and a memory system into one complete setup you can use immediately. Instead of assembling your own toolchain from scratch or jumping between disconnected tools, you can initialize once, start working right away, and keep accumulating knowledge, process, and preferences as you go.

## Core Features

### Directory Structure

A clear directory structure is the foundation of knowledge learning and research. LifeOS organizes 10 top-level directories around the learning process of "inspiration → research → learn → review → archive":

```
Vault/
├── 00_Drafts/        # Unstructured idea pool for quick captures
├── 10_Diary/         # Daily journal entries (YYYY-MM-DD.md)
├── 20_Projects/      # Active projects
├── 30_Research/      # Deep research reports, organized by Domain/Topic/
├── 40_Knowledge/     # Knowledge base: structured notes + wiki concepts
├── 50_Outputs/       # Deliverables: articles, tutorials, talks, etc.
├── 60_Plans/         # Execution plans from /research and /project
├── 70_Resources/     # Source materials: books, papers
├── 80_Reflection/    # Periodic reviews and system calibration
└── 90_System/        # Templates, schema, prompts, archives
```

1. `lifeos init` generates this default directory structure automatically.
2. All directory names are customizable via `lifeos rename`.

### Learning Workflows

LifeOS provides a set of Agent skills designed around the learning process, connecting "input -> understanding -> output -> reinforcement" into a continuous workflow:

- `/today`, `/brainstorm`, `/ask`: organize the day's focus, clarify questions, and quickly expand ideas
- `/project`, `/research`, `/knowledge`: turn a topic into a project, a research report, and structured knowledge notes
- `/digest`: subscribe to topic updates and generate structured weekly digests from paper sources, RSS, and web search
- `/read-pdf`, `/revise`, `/archive`: move from source extraction, to review and reinforcement, to archiving

### Memory System

> The memory system is LifeOS's core capability. It works in a directory-scoped, skill-bound way, continuously preserving the context, preferences, and decisions that emerge during learning so long-term learning becomes more continuous, more traceable, and easier to build on.

#### 1. Cross-session continuity

Session bridges and active-document context persist, so agents do not depend only on the current conversation.

#### 2. Project-scoped and skill-bound

The memory system runs around the current LifeOS project in the vault, activates only inside workflows such as `today`, `project`, `research`, `knowledge`, `revise`, `digest`, and `archive`, and keeps accumulating preferences, decisions, and context.

#### 3. More controllable than global memory

Compared with a memory model that mixes cross-directory content and global conversations together, a project-scoped, skill-bound memory system reduces irrelevant noise and keeps retrieval and follow-up decisions closer to the current LifeOS workflow.

## Quick Start

Verified setups: Claude Code CLI, Codex (CLI / Desktop), and OpenCode (CLI / Desktop) on macOS; Codex Desktop and OpenCode Desktop on Windows. Other platforms or client combinations have not been validated yet.

### Prerequisites

| Dependency | Required | Purpose |
|---|---|---|
| **Node.js 24.14.1+ (LTS)** | Required | Runtime for MCP server and CLI |
| **Python 3** | Required | PDF extraction (`/read-pdf`) and digest fetch helpers (`/digest`) |

`lifeos init` checks all prerequisites before creating the workspace.

### Installation and Initialization

```bash
# Step 1: install the CLI globally
npm install -g lifeos

# Step 2: create a new LifeOS workspace (auto-detects language from system locale)
lifeos init ./my-vault

# Or specify language explicitly
lifeos init ./my-vault --lang zh   # Chinese
lifeos init ./my-vault --lang en   # English
```

After init, MCP server configs are automatically registered for:

| Tool | Config file |
|---|---|
| **Claude Code** | `.mcp.json` |
| **Codex** | `.codex/config.toml` |
| **OpenCode** | `opencode.json` |

Launch any of these tools in the vault directory to use all skills.

If you want version control for the vault, initialize and manage Git yourself. LifeOS does not create or manage Git metadata for you.

## Upgrading

When a new version of LifeOS is released, upgrade your existing vault in two steps:

```bash
# Step 1: update the CLI to the latest version
npm update -g lifeos

# Step 2: upgrade vault assets and scaffold
lifeos upgrade ./my-vault
```

`npm update -g lifeos` pulls the latest CLI and built-in resources; `lifeos upgrade` syncs the new templates, skills, and specs into your vault. Both steps are required — updating the CLI alone won't touch vault files, and running upgrade alone won't fetch new built-in resources.

If you have modified built-in templates, skills, or schema files, `upgrade` will skip them by default to preserve your changes. Add `--override` to force-replace all resource files with the latest version (your notes, resources, `memory.db`, and `lifeos.yaml` config are never affected):

```bash
lifeos upgrade ./my-vault --override
```

## CLI Commands

```bash
lifeos init [path] [--lang zh|en] [--no-mcp]           # Create a new vault
lifeos upgrade [path] [--lang zh|en] [--override]      # Upgrade and restore assets/scaffold
lifeos doctor [path]                                   # Health check
lifeos rename [path]                                   # Interactive directory rename
lifeos --help                                          # Show help
lifeos --version                                       # Show version
```

## Skills

| Skill | Description |
|---|---|
| `/today` | Morning planning: review yesterday, plan today |
| `/project` | Idea -> structured project |
| `/research` | Topic -> deep research report |
| `/digest` | Topic subscription -> structured weekly digest |
| `/knowledge` | Book/paper -> knowledge note |
| `/revise` | Generate quizzes, grade, and track mastery |
| `/read-pdf` | PDF -> structured notes |
| `/translate` | English PDF chapters -> Chinese companion notes for dual-pane reading with PDF++ |
| `/ask` | Quick Q&A |
| `/brainstorm` | Interactive brainstorming |
| `/archive` | Archive completed projects, processed drafts, completed plans, and diary entries older than the most recent 7 days |

## Custom Research Digests

The `/digest` skill lets you subscribe to papers, RSS feeds, and web updates by topic, and automatically generates structured weekly digests.

### Setup

On first use, run `/digest setup` to enter the interactive configuration:

1. **Define your topic**: provide a topic name and 2–3 sub-areas of interest
2. **Set preferences**: specify whether you lean academic or industry, and list any must-read sources
3. **Generate config**: the Agent recommends RSS feeds, paper sources (arXiv / bioRxiv / SSRN, etc.), web search templates, HuggingFace Papers, and GitHub Trending, then writes the config file
4. **Review and adjust**: the config is saved as Markdown — edit it directly in Obsidian to toggle sources, add or remove RSS feeds, and tweak search keywords

### Run

Once configured, run `/digest <topic>` to generate a digest:

1. **Parse config**: read the topic config and calculate the time window (weekly 7 days / biweekly 14 days / monthly 30 days)
2. **Parallel fetch**: collect data simultaneously from RSS + paper sources, web search, HuggingFace, and GitHub Trending
3. **Deduplicate and categorize**: merge results, remove duplicates, and sort items into configured categories
4. **Output digest**: generate a structured digest with summaries to the drafts directory, highlighting key papers and articles

Multiple topics are supported — each has its own config and produces its own digest independently.

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

- **Runtime:** TypeScript + Node.js 24.14.1+ (LTS)
- **Database:** SQLite + FTS5 (full-text search)
- **Segmentation:** @node-rs/jieba (Chinese tokenization)
- **Protocol:** MCP (Model Context Protocol)
- **Vault:** Obsidian (plain Markdown + Frontmatter)

## Milestones

- ✅ LifeOS 1.0 is now basically usable
- ✅ The CLI supports directory customization
- ✅ The CLI `upgrade` command supports smart updates
- ✅ Verified on macOS (Claude Code CLI, Codex CLI/Desktop, OpenCode CLI/Desktop) and Windows (Codex Desktop, OpenCode Desktop)
- ✅ The `/digest` skill supports multilingual weekly digests with multi-source paper fetching
- ☐ Improve memory-system precision
- ☐ Support custom skills
- ☐ Support custom workflows

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
