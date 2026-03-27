## Option 1: Create a Project

Invoke the `/project` planning phase, using the brainstorm summary as the project seed:

1. Read the full content of `project/references/planning-agent-prompt.md` as the Task prompt
2. Inject the full Phase 2 summary into the prompt at the `[user's idea or draft]` placeholder
3. Fill "brainstorming session (YYYY-MM-DD)" in the plan file's "source draft" field
4. The Planning Agent only completes the planning phase and returns the plan file path

After receiving the plan file path from the Orchestrator, inform the user:

```
Project plan created from brainstorm: `[plan file path]`

**Project Category:** [learning/development/creative/general]
**Knowledge Domain:** [Domain]
**Missing Resources:** [if any]

Please review the plan. Once confirmed, I'll formally create the project (invoking /project execution phase).
```

## Option 2: Organize Knowledge

1. **Determine structure**:
   - Take the Domain from Phase 2's "Knowledge Domain" field
   - Identify concepts suitable for extraction as wiki notes

2. **Create notes**:
   - Wiki concept note path: `{knowledge directory}/{wiki subdirectory}/<Domain>/<ConceptName>.md`
   - Use template: `{system directory}/{templates subdirectory}/Wiki_Template.md`
   - Each wiki note covers one concept

3. **Frontmatter**:

```yaml
---
type: wiki
created: "YYYY-MM-DD"
domain: "[[Domain]]"
tags: [brainstorm]
source: brainstorming-session
---
```

4. **Link everything**:
   - Add wikilinks between concepts
   - Record what was learned in today's diary

5. **Report** the created file paths and summaries

## Option 3: Save as Draft

1. Create a draft note in `{drafts directory}/`:
   - Path: `{drafts directory}/Brainstorm_YYYY-MM-DD_<Topic>.md`
   - Use template: `{system directory}/{templates subdirectory}/Draft_Template.md`

2. Write content:
   - Full Phase 2 brainstorm summary
   - Core ideas from the conversation (bulleted)
   - Frontmatter with `status: pending` (ensures it can be recognized and processed by `/archive`)

3. Suggest to the user what they can do next:
   - `/research` → deepen into a research report (`{research directory}/`)
   - `/knowledge` → organize into knowledge notes (`{knowledge directory}/`)
   - `/project` → turn into a project (`{projects directory}/`)
