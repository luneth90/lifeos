## Option 1: Create a Project

Invoke the `/project` public planning entry with structured input as the project seed:

1. Pass the public `handoff`: `{ target: "project", source: "brainstorm", source_path: "<checkpoint draft path>", intent: "<confirmed intent>", constraints: [] }`
2. Let `/project` resolve the `spawn_agent` capability and perform planning only
3. Receive plan path, `plan_revision`, and `confirmed_hash`; do not read Project internal prompts

After receiving the plan file path from the Orchestrator, inform the user:

```
Project plan created from brainstorm: `[plan file path]`

**Project Category:** [learning/development/creative/general]
**Knowledge Domain:** [Domain]
**Missing Resources:** [if any]

Please review the plan. The confirmation snapshot binds this revision and hash; once confirmed, I will invoke the `/project` public execution entry.
```

## Option 2: Organize Knowledge

1. **Determine structure**:
   - Take the Domain from Phase 2's "Knowledge Domain" field
   - Identify concepts suitable for extraction as wiki notes

2. **Create notes**:
   - Wiki concept note path: `{knowledge directory}/{wiki subdirectory}/<Domain>/<ConceptName>.md`
   - Use template: `{system directory}/{templates subdirectory}/Wiki_Template.md`
   - Each wiki note covers one concept

3. **Template instantiation**: Read `{system directory}/{templates subdirectory}/Wiki_Template.md`, replace every
   required placeholder including `TITLE`, `DATE`, `DOMAIN`, and `ID`, then append
   `source: brainstorming-session`; do not hand-write inline frontmatter.

4. **Link everything**:
   - Add wikilinks between concepts
   - Record what was learned in today's diary

5. **Report** the created file paths and summaries
6. **Index notification**: immediately call the matching `memory_notify(contract_version=2, file_path="<relative path>")` after writing each Wiki and today's diary

## Option 3: Save as Draft

1. Create a draft note in `{drafts directory}/`:
   - Path: `{drafts directory}/Brainstorm_YYYY-MM-DD_<Topic>.md`
   - Use template: `{system directory}/{templates subdirectory}/Draft_Template.md`
   - Replace every required placeholder including `TITLE`, `DATE`, `DOMAIN`, and `ID`

2. Write content:
   - Full Phase 2 brainstorm summary
   - Core ideas from the conversation (bulleted)
   - Frontmatter with `status: pending` (ensures it can be recognized and processed by `/archive`)
   - Immediately call `memory_notify(contract_version=2, file_path="{drafts directory}/Brainstorm_YYYY-MM-DD_<Topic>.md")` after the write

3. Suggest to the user what they can do next:
   - `/research` → deepen into a research report (`{research directory}/`)
   - `/knowledge` → organize into knowledge notes (`{knowledge directory}/`)
   - `/project` → turn into a project (`{projects directory}/`)
