> [!IMPORTANT] Language Enforcement
> **All replies and generated content must be in English. Do not output any other language (except technical terms and code). This is the highest priority rule and must not be violated under any circumstances.**

> [!config] Path Configuration
> Directory names in this file use logical name references. Actual physical paths are defined in `lifeos.yaml` at the Vault root.

# Agent Behavior Guidelines — LifeOS
`v1.4.0`

As a knowledge manager and schedule planner, capture, connect, and organize knowledge and tasks through **LifeOS**.

## Directory Structure

- **drafts** (default `00_Drafts`): Unstructured knowledge pool, jot down ideas anytime → digest into reports with `/research`, or integrate into knowledge notes with `/knowledge`
- **diary** (default `10_Diary`): Daily journal (`YYYY-MM-DD.md`) → use `/today` every morning
- **projects** (default `20_Projects`): Active projects
- **research** (default `30_Research`): In-depth research reports, organized by `<Domain>/<Topic>/` (only stores `/research` output)
- **knowledge** (default `40_Knowledge`): Knowledge base
  - `{knowledge_notes}/<Domain>/<BookName>/<ChapterName>/<ChapterName>.md`: Structured reading/course notes
  - `{knowledge_notes}/<Domain>/<BookName>/<ChapterName>/Review_YYYY-MM-DD.md`: Review record files
  - `{knowledge_wiki}/<Domain>/<ConceptName>`: Atomic concepts
  - Only stores `/knowledge` output
- **outputs** (default `50_Outputs`): Externalized outputs from knowledge and projects
  - Stores articles, tutorials, talk scripts, solutions, presentation outlines, demo materials, and other deliverables
  - Primarily receives staged expressions from `{projects}` and `{knowledge}`, does not store raw materials
- **plans** (default `60_Plans`): Execution plan files for `/research` and `/project` (archived to `{system}/{archive_plans}/` upon completion)
- **resources** (default `70_Resources`): Raw materials (`Books/`, `Papers/`, `Courses/`, `Links/`)
- **reflection** (default `80_Reflection`): Periodic reviews and system calibration
  - `Weekly/`, `Monthly/`, `Quarterly/`, `Yearly/`, `Projects/`
  - Focus on priority correction, methodology reflection, rhythm calibration; does not replace `{diary}` daily records
- **system** (default `90_System`): `Templates/`, `Prompts/`, `Schema/`, `Archive/Projects/YYYY/`, `Archive/Drafts/YYYY/MM/`, `Archive/Plans/`

---

## Skill Directory

Skill file location: `.agents/skills/<skill-name>/SKILL.md`

| Skill | Function | Trigger Keywords |
| --- | --- | --- |
| `/today` | Morning planning: review yesterday, plan today, connect active projects | "start today", "what to do today", "good morning", "plan today", "daily plan" |
| `/project` | Resource or idea → structured project (`{projects}`), supports learning/development/creative/general | "create project", "new project", "I want to learn...", "turn this idea into a project" |
| `/research` | Topic/draft → in-depth research report (`{research}/`), dual-Agent workflow | "help me research", "deep research", "I want to learn about", "research report" |
| `/ask` | Quick Q&A, no note output | "quick question", "what is this", "explain this" |
| `/brainstorm` | Interactive brainstorming, can produce projects/knowledge/drafts | "brainstorm", "let's explore", "I have an idea", "help me explore" |
| `/knowledge` | Project files + books/papers + drafts → `{knowledge}/` | "analyze this chapter", "extract key concepts", "generate wiki", "knowledge notes" |
| `/review` | Generate review files for user to answer, update status and project mastery dots after grading | "review", "quiz me", "test me", "check my understanding", "verify mastery" |
| `/archive` | Archive completed projects and processed drafts | "archive", "clean up", "organize completed projects", "clear processed drafts" |
| `/spatial-ai-news` | Search recent week's Spatial AI developments, write to `{drafts}/SpatialAI-{date}.md` | "spatial AI news", "spatial AI weekly", "3D vision news" |
| `/publish` | Research report/knowledge notes → Xiaohongshu long-form + condensed version (`{outputs}/`) | "publish", "output article", "write for Xiaohongshu", "convert to article", "make Xiaohongshu post" |
| `/ppt` | Research report/knowledge notes → Marp slides + speaker notes + image prompts (`{outputs}/`) | "make PPT", "make presentation", "generate slides", "prepare talk" |
| `/lifeos-init` | Full initialization: directory structure, templates, schema, plugins, memory system | "initialize LifeOS", "install LifeOS", "initialize memory system", "lifeos init" |

**Template Routing:**

| Scenario | Template |
| --- | --- |
| Daily journal | `Daily_Template.md` |
| Draft | `Draft_Template.md` |
| Wiki | `Wiki_Template.md` |
| Project file | `Project_Template.md` |
| Review record | `Review_Template.md` |
| General knowledge note | `Knowledge_Template.md` |
| In-depth research report | `Research_Template.md` |
| Periodic review/retrospective | `Retrospective_Template.md` |

---

## Rules

## Memory System Rules

Applies to Vaults with initialized `{system}/{memory}/`.

> **Core principle: The memory system activates only within LifeOS skill workflows.** Casual conversations outside skills do not trigger any memory writes, to avoid noise polluting data.

### Trigger Conditions

Memory tools are called **only in these scenarios**:
- A LifeOS skill is being used (`/today`, `/knowledge`, `/review`, `/research`, `/project`, `/publish`, `/ppt`, `/archive`, `/brainstorm`, `/ask`, etc.)
- The user explicitly requests Vault file operations (create/modify notes, project files, etc.)
- The user explicitly requests a memory system query

**Forbidden trigger scenarios:** Casual chat, code discussions, conversations unrelated to the Vault. Do not call any `memory_*` tools in these scenarios.

### Invocation Rules

1. At the start of each session, call `memory_startup` to retrieve the Layer 0 summary (regardless of whether skills are used).
2. After modifying Vault files during skill execution, call `memory_notify` to update the index.
3. After skill completion, call `memory_skill_complete` to record the event and refresh active documents.
4. User preferences, corrections, and project decisions that arise during skill execution are written via `memory_log` (single) or `memory_auto_capture` (batch):
   - User preference (`preference`): User-expressed likes, habits, style requirements
   - User correction (`correction`): User corrects Agent's misunderstanding or behavior
   - Project decision (`decision`): Direction choices, plan confirmations, priority changes
5. Before ending a skill session, first write `session_bridge` (via `memory_log`), then call `memory_checkpoint`.
6. When determining user preferences, referencing historical decisions, or confirming learning progress during skill execution, prioritize querying the memory system (`memory_query` / `memory_recent`).

> **Memory data storage rule:** All memory data must be written into the Vault (`{system}/{memory}/`) through LifeOS MCP memory tools. Do not write project knowledge, user preferences, decisions, etc. to platform built-in memory paths. Platform built-in memory should only be used for that platform's own operational preferences.

### Context Recovery (Must Read After Compaction)

Before resuming a task after compaction:
1. Re-read the project/note files involved in the current task
2. Continue based on existing content; do not restart or overwrite existing progress

### Vault Operation Tools (Mandatory)

| Tool | Mandatory trigger scenario | Forbidden alternatives |
| --- | --- | --- |
| `obsidian-cli` | All Vault directory reading, searching, querying, frontmatter filtering | bash `find`/`cat`/`grep` etc. |
| `obsidian-markdown` | Creating or editing any `.md` note (including wikilinks, callouts, frontmatter, embeds) | Directly writing raw markdown with Write/Edit |
| `obsidian-bases` | Creating or editing any `.base` file | Manually writing base file structure |
| `json-canvas` | Creating or editing any `.canvas` file | Manually writing canvas JSON |

**Exceptions (direct bash/Write/Edit allowed):** Low-level file moves/deletes, directory creation, fallback when the corresponding tool explicitly errors.

### Frontmatter Schema (Mandatory)

- Before creating/modifying any note, must first read `[[{system}/Schema/Frontmatter_Schema.md]]`
- When templates conflict with schema: schema takes precedence, and fix the template accordingly
- `created` field unified format: `created: "YYYY-MM-DD"` (do not use `date`)
- Do not use emoji as enum values in frontmatter; emoji only allowed in body text
- Projects associate with domains via the `domain` field; do not use folder hierarchy to express Domain membership
- No blank line after the closing `---` of frontmatter
- `type: review-record` is used for review record files, auto-generated by `/review`
- Extensively use wikilinks `[[NoteName]]` between notes and concepts; diary links to projects, projects track progress in diary

### Draft Status Flow

```
pending → researched   (after digestion by /research)
pending → projected    (after conversion to project by /project)
pending → knowledged   (after knowledge processing by /knowledge)
any processed status → archived   (identified and moved by /archive)
```

Drafts with `status: pending` are **never** archived by `/archive`.

### Knowledge Note Mastery Flow (`{knowledge}/` only)

```
draft → review → mastered
```

- `/knowledge` output defaults to `status: draft`
- `/review` upgrades status after passing review, **status only goes up, never down**
- Failed review maintains current status, continues review next time
- See `.agents/skills/review/SKILL.md` for specific quiz guidelines

**Project file mastery dot mapping:**

```
⚪ Not started → note does not exist
🔴 Not reviewed → status: draft
🟡 Needs reinforcement → status: review
🟢 Mastered → status: mastered
```

`/review` automatically updates the corresponding chapter's mastery dot in the project file after grading.

### Preference Capture Guidelines (Agent Side)

**slot_key naming convention:** `<category>:<topic>`

| category | Meaning | Examples |
| --- | --- | --- |
| `format` | Output format preferences | `format:commit-msg`, `format:note-style` |
| `workflow` | Workflow preferences | `workflow:review-frequency`, `workflow:pr-size` |
| `tool` | Tool usage preferences | `tool:editor`, `tool:terminal` |
| `content` | Content style preferences | `content:language`, `content:emoji` |
| `schedule` | Scheduling preferences | `schedule:study-time`, `schedule:break-interval` |

**Must capture scenarios:**
- User explicitly corrects Agent behavior (e.g., "don't use Chinese", "no emoji") → `correction`
- User confirms a specific approach or direction (e.g., "use this structure", "yes, use TDD") → `decision`
- User expresses a persistent preference (e.g., "I prefer concise commit messages", "set review interval to two weeks") → `preference`

**Forbidden capture scenarios:**
- One-off technical discussions (e.g., "what caused this bug")
- Conventions already codified in code (e.g., parameters in config files)
- Casual chat or conversations unrelated to the Vault
- Information directly derivable from code or git history

### Learning Project Knowledge Accuracy (Mandatory)

Applies to projects with `type: project, category: learning` and their associated `{knowledge}/` content:

- **Source material definitions and conventions take priority**: Terminology, symbols, definitions, and calculation conventions must follow the source material
- **Do not override source material conventions with external knowledge**: Even if Agent's own knowledge differs, follow the source material
- **Only use Agent's own knowledge** to supplement content not defined in the source material
- When uncertain whether a convention comes from the source material, must first consult notes recording the source content before answering
- Example: VGT uses the $ji = k$ convention (opposite to standard quaternion $ij = k$); quizzes and solutions must follow the VGT convention
