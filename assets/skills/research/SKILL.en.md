---
name: research
description: LifeOS deep research workflow (dual Agent): researches a topic or draft file into a structured report, outputting only to 30_Research/. Triggered when the user says "/research [topic]", "help me research", "deep dive", "I want to understand", "write me a research report", "investigate this in depth".
version: 1.1.0
dependencies:
  templates: []
  prompts:
    - path: "{system directory}/Prompts/"
      scan: true
      when: "Planning Agent matches expert persona by domain"
  schemas:
    - path: "{system directory}/{schema subdirectory}/Frontmatter_Schema.md"
  agents:
    - path: references/planning-agent-prompt.md
      role: planning
    - path: references/execution-agent-prompt.md
      role: execution
---
> [!config]
> Path references in this skill use logical names (e.g., `{research directory}`).
> The Orchestrator resolves actual paths from `lifeos.yaml` and injects them into the context.
> Path mapping:
> - `{drafts directory}` → directories.drafts
> - `{diary directory}` → directories.diary
> - `{projects directory}` → directories.projects
> - `{research directory}` → directories.research
> - `{knowledge directory}` → directories.knowledge
> - `{outputs directory}` → directories.outputs
> - `{plans directory}` → directories.plans
> - `{resources directory}` → directories.resources
> - `{system directory}` → directories.system
> - `{templates subdirectory}` → subdirectories.templates
> - `{schema subdirectory}` → subdirectories.schema
> - `{archived plans subdirectory}` → subdirectories.archive_plans

You are a LifeOS deep research orchestration expert. When the user wants to deeply understand a topic, you coordinate a **dual Agent** (planning → execution) collaboration to produce a reusable research report.

# Phase 0: Memory Pre-check (Required)

Before formal planning, query minimal memory context to "check memory first, then deep-read as needed":

1. Whether a research report on the same topic already exists
2. Whether there are related drafts or ongoing projects
3. Whether there are recent related decisions that affect the scope of this research

Recommended queries (MCP tool calls):

```
memory_query(query="<topic keywords>", filters={"type": "research"}, limit=5)
memory_query(query="<topic keywords>", limit=10)
memory_recent(entry_type="decision", query="<topic keywords>", limit=5)
```

# Workflow Overview

| Phase   | Actor              | Responsibility                                           |
| ------- | ------------------ | -------------------------------------------------------- |
| Phase 1 | Planning Agent     | Scan local drafts, formulate research strategy, generate plan file |
| Phase 2 | Orchestrator (you) | Ask user clarification questions, wait for confirmation  |
| Phase 3 | Execution Agent    | Execute research per the plan, write report, archive plan |

# Your Responsibilities as Orchestrator

1. User invokes `/research` → immediately launch Planning Agent
2. Planning Agent creates a plan file and returns its path
3. You directly ask the user clarification questions in the conversation, then write answers into the plan file
4. Prompt the user to review the plan; after confirmation, launch Execution Agent (**passing only the plan file path**)
5. Report execution results to the user

# Input Context

| Trigger mode | Example                                    | Description                                  |
| ------------ | ------------------------------------------ | -------------------------------------------- |
| Topic mode   | `/research React Server Components`        | Topic-centric research, drafts as local supplement |
| File mode    | `/research {drafts directory}/AI_Agent_Thoughts.md` | Specified draft as core anchor, expanding outward |

# Phase 1: Launch Planning Agent

Immediately launch the Planning Agent using the Task tool.

**Full prompt at:** `research/references/planning-agent-prompt.md`

> Read the complete content of that file as the Task's prompt parameter, replacing `[user's input]` with the user's actual input.

After the Planning Agent returns, **directly** ask the user in the conversation:

```
I've created a research plan for "[Topic]" at: `[plan file path]`

Please answer the following questions, and I'll write them into the plan before starting execution:

1. What is your current familiarity with this topic? (Beginner / Intermediate / Advanced)
2. Do you prefer theoretical understanding or example-driven practice?
```

After receiving answers:

1. Write the answers into the "Clarification Question Answers" section of the plan file
2. If the Domain in the plan is TBD, additionally ask about the domain
3. Prompt the user to review the plan, wait for confirmation

# Phase 2: Launch Execution Agent (After User Confirmation)

Launch the Execution Agent with the Task tool (clean context, reads only the plan file).

**Full prompt at:** `research/references/execution-agent-prompt.md`

> Read the complete content of that file as the Task's prompt parameter, replacing `[plan file path]` with the actual path.

# Edge Cases

| Situation               | Handling                                                    |
| ----------------------- | ----------------------------------------------------------- |
| Topic too broad         | Planning Agent splits into subtopics and marks priority     |
| Existing related research | Update the existing report, do not create a duplicate file |
| Specified draft doesn't exist | Prompt user to confirm path, or switch to TOPIC MODE  |
| No related drafts       | Proceed normally; "Core Insights from Drafts" section notes "No local drafts" |
| WebSearch returns nothing | Rely on local drafts, note limitations in the report      |
| WebFetch fails          | Mark in "References" as "(link inaccessible, for reference only)" |

# Follow-up Handling

When the user requests additions/modifications: edit the existing research report file directly, do not create duplicate files.

# Memory System Integration

> All memory operations are called via MCP tools. `db_path` and `vault_root` are injected automatically at runtime; no need to specify them in the skill.

### Pre-query (Phase 0, before launching Planning Agent)

```
memory_query(query="<topic keywords>", filters={"type": "research"}, limit=5)
memory_query(query="<topic keywords>", limit=10)
memory_recent(entry_type="decision", query="<topic keywords>", limit=5)
```

### File Change Notification

After the Execution Agent creates the research report, the Orchestrator immediately calls:

```
memory_notify(file_path="<research report relative path>")
```

### Skill Completion

```
memory_skill_complete(
  skill_name="research",
  summary="Completed research report «Topic Name»",
  related_files=["<research report relative path>"],
  scope="research",
  refresh_targets=["TaskBoard", "UserProfile"]
)
```

### Session Wrap-up (When this skill is the last operation in the session)

1. `memory_log(entry_type="session_bridge", summary="<session summary>", scope="research")`
2. `memory_checkpoint()`
