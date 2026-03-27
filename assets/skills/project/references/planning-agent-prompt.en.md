---
name: planning-agent-prompt
description: Planning Agent prompt for the Project skill
role: planning
parent_skill: project
---

# Project Planning Agent Instructions

> Path logical names (e.g., `{projects directory}`, `{drafts directory}`) are resolved by the Orchestrator from `lifeos.yaml` and injected into context. See the main skill file `project/SKILL.md` for the mapping.

> This file is read by the `project/SKILL.md` Orchestrator and used as the complete prompt for the Task tool.
> Replace `[user's idea/draft note]` with the user's actual input when using.

---

Create a project launch plan for the following: [user's idea/draft note]

Execute the following steps:

## Step 1: Gather Context (Broad Search)

- If the input is a draft file path in `{drafts directory}/`: read its full content as the project seed idea
- Search `{projects directory}/` for any related existing projects
- Search `{resources directory}/` (Books, Papers, Courses, Links)
- Record the source draft file path (if any) — the Execution Agent will need it to update the draft status later

Summarize all related content already in the Vault.

## Step 2: Project Classification

- **Project category**: learning / development / creative / general
- **Knowledge domain** (required for learning): Math / AI / CS / Art / History / Other

If the project category is `development`, the plan must include directory structure design following these rules:

- Main project path is fixed at `{projects directory}/<ProjectName>/<ProjectName>.md`
- Supporting documents directory is fixed at `{projects directory}/<ProjectName>/Docs/`
- Main project filename must not contain version numbers
- If version information exists, write it in the main project's fields or body; do not generate separate `V0.2`, `V0.3` project files

## Step 3: Create Plan File

Path: `{plans directory}/Plan_YYYY-MM-DD_Project_ProjectName.md`

```markdown
---

# Launch Plan: [Project Name]

## Classification

- Project category: [learning / development / creative / general]
- Knowledge domain (Domain): [e.g., Math, AI — determines knowledge base subdirectory]
- Difficulty: [Beginner / Intermediate / Advanced] (required for learning)
- Estimated effort: [X hours/week × Y weeks] or [approx. X hours total]

## Objective

[One-sentence summary of the project goal]

## Target Directory Structure (Required for Development Projects)

- Main project file: `{projects directory}/<ProjectName>/<ProjectName>.md`
- Supporting documents directory: `{projects directory}/<ProjectName>/Docs/`
- Single main project rule: there is only one main project; requirements, design, implementation, testing, etc. are all managed as supporting documents
- Version rule: version information goes in the main project, not in filenames

## Source Draft

[{drafts directory}/filename.md, or "None (direct input)"]

## Existing Resources in the Vault

### Existing Projects

- [List related existing project wikilinks, or "None"]

### Existing Learning Resources

- Books: [List related wikilinks in {resources directory}/Books/]
- Papers: [List related wikilinks in {resources directory}/Papers/]
- Courses: [List related wikilinks in {resources directory}/Courses/]

## Project Outline Draft

### Background

[What problem does it solve / why is it important]

### Prerequisites (Required for Learning)

- [ ] [Concepts/skills that need to be mastered first, wikilink to existing notes]

### Content Plan
```

**Key rule: Chapter coverage requirement (Learning projects)**

When generating chapter structure:

- Must include **every chapter** from the source resource, never truncate
- Count the chapters before writing, verify the count matches after writing
- Never use "..." or "remaining chapters follow the same pattern"
- Must use the exact, complete filename of the resource (including extension .pdf/.epub etc.)

```markdown
**Learning project — chapter structure:**

#### Chapter 1: [Chapter Name]

- Objective: [What you can do after completing this chapter]
- Reference resource: [[{resources directory}/Books/ExactResourceName.pdf]] Chapter 1
- Expected knowledge note: [[{knowledge directory}/{notes subdirectory}/Domain/BookName/Chapter1NoteName/Chapter1NoteName]] (chapter directory structure)
- Expected Wiki: [[{knowledge directory}/{wiki subdirectory}/Domain/ConceptName]]

#### Chapter 2: [Chapter Name]

...(exhaustively list all chapters)

**Development project — phase structure:**

#### Phase 1: [Phase Name]

- Deliverables: [...]
- Reference resources: [if applicable]

> For development projects, if requirements, design, implementation, testing, or refactoring documents are expected, the plan must explicitly state these documents will be stored in `{projects directory}/<ProjectName>/Docs/`.

**Creative/General project — phase structure:**

#### Phase 1: [Phase Name]

- Deliverables: [...]
- Reference resources: [if applicable]

---

## Missing Resources Alert

- [List needed but missing resources, or "None"]

## Clarification Questions

- What is the timeline/deadline for this project?
- What is the priority? (P0=Urgent, P1=High, P2=Medium, P3=Low, P4=Later)
- How many hours per week do you plan to invest?
- Do you have a preferred learning resource or method? (video/books/hands-on/mixed)
```

## Step 4: Return Result

Return the path to the plan file.
