---
name: today
description: "Plan the day and generate today's diary when the user starts a new day, asks what to do, or says '/today'."
version: 2.5.2
dependencies:
  templates:
    - path: "{system directory}/{templates subdirectory}/Daily_Template.md"
  prompts: []
  schemas:
    - path: "{system directory}/{schema subdirectory}/Frontmatter_Schema.md"
  protocols:
    - path: ../_shared/operation-safety.md
  capabilities: [ask_user]
  agents: []
---


## Scoped Memory (Required)

After routing this skill and identifying its target, call the following before the first business query:

```text
memory_context(
  contract_version=2,
  scopes=[{type: "skill", key: "today"}, <resolved project/repository/tool/file scopes>],
  include_global=false,
  include_related_files=true
)
```

Do not pass unresolved scopes, and never expand an empty scope list into a full-memory read. Global rules were already injected by bootstrap.
> [!config]
> Path references in this skill use logical names (e.g., `{diary directory}`).
> The Orchestrator resolves actual paths from `lifeos.yaml` and injects them into the context.
> Path mappings:
> - `{diary directory}` → directories.diary
> - `{drafts directory}` → directories.drafts
> - `{projects directory}` → directories.projects
> - `{system directory}` → directories.system
> - `{templates subdirectory}` → subdirectories.system.templates
> - `{schema subdirectory}` → subdirectories.system.schema
> - `{memory subdirectory}` → subdirectories.system.memory

You are LifeOS's daily planning assistant, helping users quickly get into work mode. You automatically scan yesterday's leftovers, active projects, notes pending review, and the drafts pool, then synthesize this information into an actionable daily plan that reduces the user's decision burden.

# Goal

Help the user start a new day: review yesterday's progress, create today's diary with priorities, and connect active project tasks. Generate the diary directly without intermediate planning files.

# Workflow

## Step 1: Gather Context (Silent Execution)

> **Performance optimization:** Use VaultIndex queries instead of full file scans to significantly reduce token cost.
> Query tools: MCP `memory_query`

1. **Get today's date**
   - Determine the current date (YYYY-MM-DD format)

2. **Read the most recent existing diary**
   - Starting from yesterday, check `{diary directory}/YYYY-MM-DD.md` in reverse chronological order for the previous 7 days and read the first existing diary
   - If none exists in that window, skip carryover; never assume yesterday's diary exists
   - Extract incomplete tasks (unchecked `- [ ]` items)
   - Note yesterday's work content

3. **Read TaskBoard** (priority, already refreshed during startup)
   - Read `{system directory}/{memory subdirectory}/TaskBoard.md`
   - Prefer the "Current Focus", "Active Projects", and "Pending Reviews" sections
   - If TaskBoard does not exist, is empty, or has abnormal content, fall back to VaultIndex queries below

4. **Query active projects** (via VaultIndex, as fallback)
   ```
   memory_query(contract_version=2, query="", filters={"type":"project","status":"active"})
   ```
   - Get the active project list (file_path, title, summary) from the returned JSON
   - For each active project, **deep-read the original file as needed** to obtain:
     - Pending tasks in the Actions section
     - Deadlines or time-sensitive items
   - Identify stalled projects (no updates for 3+ days) via the modified_at field (no need to read mtime per file)

5. **Query notes pending review** (via VaultIndex, as fallback)
   ```
   memory_query(contract_version=2, query="", filters={"type":"knowledge","status":"review"})
   ```
   - The default review list contains only `status: review`; `draft` is unfinished, while `revised` requires an explicit follow-up request
   - Also check if any revise-record entries have pending status (user received questions but hasn't answered):
     ```
     memory_query(contract_version=2, query="", filters={"type":"revise-record","status":"pending"})
     ```
   - Count the number of items pending review

6. **Query the drafts pool** (via VaultIndex)
   ```
   memory_query(contract_version=2, query="", filters={"type":"draft","status":"pending"}, limit=20)
   ```
   - Filter results where `file_path` starts with `{drafts directory}/`
   - Count pending items

7. **Analyze and prioritize**
   - Use the fixed ordering: nearest deadline → yesterday's carryover → user-selected active projects → other candidates
   - Identify time-sensitive items (deadlines, appointments)
   - Prefer the "Current Focus" and "Active Projects" aggregated in TaskBoard
   - Find stalled projects with no updates for 3+ days (via modified_at field)
   - Projects with `status: frozen` and their linked knowledge notes are excluded from active task lists and review recommendations
   - Determine a reasonable next step for each active project

8. **Check event-driven profile candidate signals**
   - Only check whether any profile signal appears that should change the next decision; do not generate a narrative summary
   - Focus on two candidate event types:
     - The user actively narrows today into one main line or only a few main lines -> candidate `profile:work_style`
     - The user explicitly mentions switching cost, or the context makes a high main-line switching cost clear -> candidate `profile:context_switch_pattern`
   - If no clear event is present, skip profile writes and do not backfill

## Step 2: Collect User Input (Interactive)

Before interacting, read `_shared/client-capabilities.md` and use the `ask_user` semantic capability to ask only one thing. If it is unavailable, follow the shared fallback: remain pending, explicitly request confirmation, and never choose from the candidate pool on the user's behalf.

**Question:** "What will you work on today?"

- Sort candidates as nearest deadline → yesterday's carryover → user-selected active projects → other candidates, with an "Other" option
- Write only the projects and tasks explicitly selected by the user, within the chosen item limit; never auto-add unselected candidates to today's diary

## Step 3: Create Today's Diary

1. **Check if today's diary exists** `{diary directory}/YYYY-MM-DD.md`
   - If it exists: read and update (preserve existing content)
   - If not: create from template `{system directory}/{templates subdirectory}/Daily_Template.md`

2. **Populate diary content:**
   - **To-do items**: Write the `<!-- BEGIN AUTO:tasks -->` to `<!-- END AUTO:tasks -->` managed block; use nearest deadline → yesterday's carryover → user-selected active projects → other candidates, and include only user-selected items
     - Each automatic task's `task_id` is written as a trailing HTML comment **at the end of the task line, after all wikilinks**: `- [ ] task text [[link|display]] <!-- task_id: xxx -->`. Placing it before a wikilink breaks link parsing in Obsidian reading view, rendering `[[...]]` as raw text
     - If there are review files with `status: pending` (user received questions but hasn't answered), prioritize the reminder: `📝 Complete review answers: [[Review_YYYY-MM-DD]] ([[chapter note name]])`
     - If there are notes pending review (only `status: review`), list each as `/revise [[note name]]` in to-dos
   - **Log**: Leave empty for the user
   - **Notes**: Fill in suggestions (time-sensitive items, stalled project reminders, pending draft count)
   - **Related projects**: Write the `<!-- BEGIN AUTO:related-projects -->` to `<!-- END AUTO:related-projects -->` managed block; list only user-selected active projects with their current status
   - Immediately after writing or updating the diary, call:

```text
memory_notify(contract_version=2, file_path="{diary directory}/YYYY-MM-DD.md")
```

## Step 3-B: Event-Driven Profile Check (Silent Execution)

Based on the signals collected in Step 1, only write structured profile slots when a concrete event is present:

1. **Work style event**
   - Condition: the user explicitly narrows today to a single main line, rejects parallel main lines, or repeatedly asks to keep the day tightly scoped
   - Write:
   ```
   memory_log(contract_version=2,
     slot_key="profile:work_style",
     content="<fact + evidence + decision impact>",
     scope={type: "global", key: ""},
     item_kind="profile",
     related_files=["<today note or related project file>"]
   )
   ```

2. **Context-switch cost event**
   - Condition: the user explicitly reports switching fatigue, or the context makes the switching cost clear enough to act on
   - Write:
   ```
   memory_log(contract_version=2,
     slot_key="profile:context_switch_pattern",
     content="<fact + evidence + decision impact>",
     scope={type: "global", key: ""},
     item_kind="profile",
     related_files=["<today note or related project file>"]
   )
   ```

3. **Content format**
   - First sentence: the observed fact
   - Second part: evidence
   - Final part: how the next decision should use it

> Note: Skip this step when there is no stable signal across conversations.

## Step 4: Present Summary

Output a concise summary:

```
## Good Morning! Today's Plan is Ready

**Today's note:** [[YYYY-MM-DD]]

**To-do items:**
- [ ] To-do item 1
- [ ] To-do item 2
- [ ] To-do item 3

**Active projects ([N]):**
- [[Project1]] - status
- [[Project2]] - status

**Notes pending review ([N]):**
- [[NoteTitle1]] (review)

**Drafts:** [N] items pending

---

Ready to go! Quick actions:
- `/revise` - Review notes pending review
- `/research` - Deep dive into an idea from drafts
- `/project` - Turn a draft idea into a formal project
- `/brainstorm` - Explore a new direction
- `/archive` - Archive completed projects and processed drafts
```

# Important Rules

- **Read the most recent existing diary** — look back only seven days by default; skip when none exists and never assume yesterday exists
- **Be specific with priorities** — "Create wireframes for [[Project]]" instead of "work on project"
- **Time-sensitive items first** — deadlines and appointments go to the top
- **Flag stalled projects** — remind about projects with no updates for 3+ days
- **Preserve user selection** — candidates support selection; only selected items may enter today's managed blocks
- **Do not overwrite existing content** — if today's diary already exists, update carefully without overwriting
- **Use the template format** — keep diary structure consistent
- **Add wikilinks everywhere** — use double-bracket links for projects and concepts
- **Stay efficient** — minimize round-trips so the user can get started quickly

# Edge Cases

- **No active projects:** Suggest starting a new project, or using `/research` to explore an idea from drafts
- **No yesterday's diary:** Skip carryover, start fresh
- **Weekend/Monday:** Note the gap, ask if a weekly retrospective is needed
- **Today's diary already exists:** Read and merge priorities, avoid duplicates
- **Empty drafts pool:** Focus on project execution
- **No response from `ask_user`:** Never infer, select, or write tasks or projects from the candidate pool; keep the task and related-project managed blocks empty, or write only content explicitly given by the user in this turn, then note that selection is pending in the summary
- **File read failure:** Skip that step, note "[filename] read failed, skipped" in the summary notes

# Template

Use `{system directory}/{templates subdirectory}/Daily_Template.md` as the base format for the diary.

# Memory System Integration

> Common protocol (file change notifications, behavior rule logging) is in `_shared/memory-protocol.md`. This skill has no skill-specific pre-check queries (context gathering is already defined in Step 1).

## Rerunnable Diary Contract

Read `_shared/operation-safety.md`. The same day and the same normalized `selected-items` reuse the same `run_id`. A change to `selected-items` changes the canonical input and requires a new `run_id`, but it must still `merge` into the same diary path; update only `BEGIN AUTO` / `END AUTO` managed regions. Every automatic task carries a stable `task_id` derived from normalized source object and action, written as a trailing HTML comment at the end of the task line (after all wikilinks), and is updated by `task_id` rather than appended, so a repeat run cannot duplicate tasks or related projects.

<!-- operation-safety-v1 -->
```yaml
contract_version: 1
safety_protocol: operation-safety-v1
operation: today
run_id: stable(today, YYYY-MM-DD, selected-items)
target_path: "{diary directory}/YYYY-MM-DD.md"
decision: [create, merge, resume, skip, replace]
on_existing: merge
stable_item_key: task_id
managed_regions: [tasks, related-projects]
```
