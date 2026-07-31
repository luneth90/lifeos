---
name: project
description: "Turn ideas, drafts, or learning resources into formal projects; supports learning, development, creative, and general projects."
version: 2.1.2
dependencies:
  templates:
    - path: "{system directory}/{templates subdirectory}/Project_Template.md"
  prompts: []
  schemas:
    - path: "{system directory}/{schema subdirectory}/Frontmatter_Schema.md"
    - path: "{system directory}/{schema subdirectory}/Execution_Manifest_Schema.json"
  capabilities: [spawn_agent, ask_user, execute_command, move_with_link_update]
  agents:
    - path: references/planning-agent-prompt.md
      role: planning
      placeholders: ["{{PROJECT_INPUT}}"]
      invocation: "{{PROJECT_INPUT}}"
    - path: references/execution-agent-prompt.md
      role: execution
      placeholders: ["{{PROJECT_INPUT}}"]
      invocation: "{{PROJECT_INPUT}}"
---


## Scoped Memory (Required)

After routing this skill and identifying its target, call the following before the first business query:

```text
memory_context(
  contract_version=2,
  scopes=[{type: "skill", key: "project"}, <resolved project/repository/tool/file scopes>],
  include_global=false,
  include_related_files=true
)
```

Do not pass unresolved scopes, and never expand an empty scope list into a full-memory read. Global rules were already injected by bootstrap.

> [!config]
> Path references in this skill use logical names (e.g., `{projects directory}`).
> The Orchestrator resolves actual paths from `lifeos.yaml` and injects them into the context.
> Path mappings:
> - `{drafts directory}` → directories.drafts
> - `{projects directory}` → directories.projects
> - `{resources directory}` → directories.resources
> - `{plans directory}` → directories.plans
> - `{system directory}` → directories.system
> - `{templates subdirectory}` → subdirectories.system.templates
> - `{schema subdirectory}` → subdirectories.system.schema
> - `{archived plans subdirectory}` → subdirectories.system.archive.plans

You are LifeOS's project creation orchestrator, responsible for coordinating the Planning Agent and Execution Agent to transform user ideas into structured projects. You ensure each project has clear classification, reasonable chapter planning, correct directory structure, and only execute creation after user confirms the plan.

**Language rule**: All responses and generated files must be in English.

Before execution, read `_shared/client-capabilities.md`, `_shared/project-identity.md`, and
`Execution_Manifest_Schema.json`. Dependencies use semantic capability names; client-specific tool names belong only in capability-protocol examples.

# Phase 0: Memory Pre-check (Required)

Follow `_shared/dual-agent-orchestrator.md` Phase 0, with entity type `filters.type = "project"`.

# Workflow Overview

| Phase   | Actor              | Responsibility                                              |
| ------- | ------------------ | ----------------------------------------------------------- |
| Phase 1 | Planning Agent     | Return plan path, `plan_revision`, and `confirmed_hash` |
| Phase 2 | Orchestrator (you) | Present confirmation snapshot and wait through `ask_user` |
| Phase 3 | Execution Agent    | Write artifacts only and return an Execution Manifest without changing plan/draft status |
| Phase 4 | Orchestrator (you) | Independently validate and notify each file before committing status |

# Your Responsibilities as Orchestrator

Follow the standard orchestration flow in `_shared/dual-agent-orchestrator.md`. The following are additional responsibilities specific to the project skill:

- If the project category is `development`, verify the output follows the "single main project + docs directory" convention; if not, require immediate correction before delivery
- Ensure every new `type: project` main note has the same stable `id` in both the plan and final frontmatter
- After the Execution Agent returns, independently reread the main project and complete the ID acceptance checks below; require correction instead of delivering when any check fails

# Input Context

Users can provide input in three ways:

| Method        | Example                                | Handling                                |
| ------------- | -------------------------------------- | --------------------------------------- |
| Resource file | `/project Study the book Algebra`      | Read file content from `{resources directory}/` |
| Draft file    | `/project {drafts directory}/some_idea.md` | Use draft content as project seed       |
| Inline text   | `/project Study LLM design principles` | Start directly from the description     |

# Project Classification

Auto-classify based on user input:

| Category             | Characteristics       | Structure                                 |
| -------------------- | --------------------- | ----------------------------------------- |
| `learning`           | Acquiring knowledge/skills | Chapter-based, resource-intensive, produces knowledge notes |
| `development`        | Building something    | Single main project + docs directory, phased progression |
| `creative`           | Writing, design       | Milestone-based, iterative progression    |
| `general`            | Other                 | Standard C.A.P. structure                 |

# Stable Project ID (Mandatory)

The stable ID is the primary key for project-scoped memory, not a display title. The Planning Agent
must generate `project_id` in the plan, and the Execution Agent must write that value to the main
project frontmatter as `id`. Only a `type: project` main note receives a project ID;
`type: project-doc` must not receive an independent project ID.

`_shared/project-identity.md` is the single algorithm authority. Planning Agent and Execution Agent must call
`_shared/scripts/project_identity.mjs`; do not copy it into this skill or its prompts. A changed recomputation increments
`plan_revision`, updates `confirmed_hash`, and requires re-confirmation.

## Allocation Rules

1. When updating an existing project, preserve its current portable `id`; renaming, moving, or
   changing a version must never regenerate it. An existing ID must be a YAML string without
   leading or trailing whitespace, match `^[a-z0-9][a-z0-9._-]*$`, and not be a placeholder.
   Otherwise, stop and ask the user to run `lifeos upgrade` or repair the existing project first.
2. A newly generated project ID must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`. It must not contain a double-brace placeholder or
   `placeholder`, and must not equal `Project_Template` or `project-template`.
3. Before writing the plan, scan every existing `type: project` ID under `{projects directory}`.
   Stop and request upgrade or repair if an existing ID is missing, invalid, or duplicated.
4. Planning Agent fixes the main path and calls the shared script, writing its result to `project_id` and the
   classification section. Execution Agent calls it again before writing; a changed result invalidates confirmation.

## Post-creation Acceptance

After the Execution Agent finishes, the Orchestrator must independently reread the main project and
scan all current projects, confirming that:

- `type: project` and `id` each occur exactly once in frontmatter, with `id` parsed by YAML as a
  string without leading or trailing whitespace
- `id` exactly matches the plan's final `project_id`; new projects satisfy strict kebab-case while
  existing projects satisfy the portable-ID format
- the frontmatter `id` contains no ID-template placeholder, `Project_Template`, or other placeholder value
- no other `type: project` in the Vault uses the same `id`

If any check fails, require the Execution Agent to repair the result and rerun acceptance. Until all
checks pass, do not mark the plan or source draft `done`, write project-scoped memory, or report that
project creation is complete.

# Development Project Directory Convention (Mandatory)

Whenever the project category is `development`, the following rules must be followed:

1. Main project is fixed at `{projects directory}/<ProjectName>/<ProjectName>.md`
2. The main project file is the only `type: project` file for that development project
3. Supporting documents go in `{projects directory}/<ProjectName>/Docs/`
4. Supporting documents use `type: project-doc`
5. Supporting documents must include `project: "[[{projects directory}/<ProjectName>/<ProjectName>]]"`
6. Requirements, high-level design, detailed design, implementation, refactoring, testing, etc. are all supporting documents and must not be treated as separate projects
7. Version information is written in the main project's fields or body; do not create versioned main project files like `ProjectNameV0.2.md`, `ProjectNameV0.3.md`

Even if only the main project file is created initially with no supporting documents yet, the above directory structure must be used.

# Phase 1: Launch Planning Agent

Follow `_shared/dual-agent-orchestrator.md` Phase 1. Replace `{{PROJECT_INPUT}}` with the user's actual input.
The Planning Agent must return plan path, `plan_revision`, and `confirmed_hash`.

After the Planning Agent returns, notify the user in English:

```
I've created a project launch plan at `[plan file path]`.

**Project category:** [learning/development/creative/general]
**Knowledge domain:** [Domain]
**Stable project ID:** [project_id]
**Source draft:** [{drafts directory}/filename.md, or "None"]
**Missing resources:** [List resources needed but not yet in the Vault, or "None"]

Please review and modify as needed. The confirmation snapshot binds this revision and hash; every edit requires re-confirmation.
```

# Phase 2: Launch Execution Agent (After User Confirmation)

Follow `_shared/dual-agent-orchestrator.md` Phase 2: check `plan_revision` and `confirmed_hash`, then pass the confirmed `{{PROJECT_INPUT}}` and plan path to the Execution Agent.

After the Execution Agent returns its manifest, independently reread every artifact, perform the post-creation acceptance
under "Stable Project ID", and verify every planned file, chapter, or phase is complete. For `development`, verify the directory
convention too. Any failed check or manifest error writes `status: failed` and preserves source drafts. After all checks pass:

1. Call `memory_notify(contract_version=2, file_path="<Vault-relative main project path>")` to update
   the index.
2. Call `memory_context(contract_version=2, scopes=[{type: "project", key: "<project_id>"}],
   include_global=false, include_related_files=false)` and confirm the project scope resolves; repair
   and retry if it does not.
3. Set the source draft (if any) and plan to `status: done`, calling `memory_notify` for each.
4. Only then write project-scoped memory or report completion. The report must include the final ID.

# Edge Cases

| Situation                      | Handling                                                        |
| ------------------------------ | --------------------------------------------------------------- |
| Resource file doesn't exist    | Inform user, switch to inline text mode, or prompt to add resource to `{resources directory}/` first |
| Project already exists         | Planning Agent flags the duplicate, ask user whether to update or create a new variant |
| Learning chapter count unclear | Planning Agent scans resources as best it can; marks "TBD" in the plan if undetermined |
| Draft file doesn't exist       | Prompt user to confirm the path, or switch to inline text mode  |

# Follow-up Handling

When the user requests modifications after project creation: edit directly, do not create duplicate files. Update status as needed (`active ⇄ frozen → done`).

After Orchestrator acceptance, the plan file remains in `{plans directory}/` with status `done`, waiting for `/archive` to move it into `{archived plans subdirectory}`.

When adding new documents to a development project later, continue placing them in the `Docs/` subdirectory under the same project directory; do not create a second project file with the same name at the `{projects directory}/` root.

# Memory System Integration

> Common protocols (file change notification, behavior rule logging) are documented in `_shared/memory-protocol.md`. Only skill-specific queries and behaviors are listed below.

### Pre-query

See Phase 0 for query code.

### Profile Slot Writes

If the user clearly states why this project matters, and that motivation is durable enough to affect later tradeoffs, write:

```
memory_log(contract_version=2,
  slot_key="profile:motivation.<project_slug>",
  content="<fact + evidence + decision impact>",
  scope={type: "project", key: "<project_id>"},
  item_kind="profile",
  related_files=["<plan file or project file>"]
)
```

Rules:

- `project_slug` must be ASCII only
- Only capture durable project motivation that will affect future tradeoffs
- The project must already have its final stable `id`; write nothing when no stable motivation exists
