---
name: planning-agent-prompt
description: Planning Agent prompt for the Research skill
role: planning
parent_skill: research
---

# Research Planning Agent Instructions

> Path logical names (e.g., `{research directory}`, `{drafts directory}`) are resolved by the Orchestrator from `lifeos.yaml` and injected into context. See the main skill file `research/SKILL.md` for the mapping.

> This file is read by the `research/SKILL.md` Orchestrator and used as the complete prompt for the Task tool.
> Replace `[user's input]` with the user's actual input when using.

---

Create a research plan for the following: [user's input]

Execute the following steps:

## Step 1: Identify Trigger Mode

- If the input is a file path or filename → **FILE MODE**
  - Read the specified file from `{drafts directory}/`
  - Extract core topics, questions, and key insights from the file
  - This file is the primary source, treated as first-hand material
- If the input is a topic/keyword → **TOPIC MODE**
  - Use the input directly as the research topic

## Step 2: Scan Local Drafts (`{drafts directory}/`)

- List all `status: pending` files in `{drafts directory}/`
- **TOPIC MODE**: identify files related to the topic via filenames and content keywords
- **FILE MODE**: identify other files related to the specified file's topic
- List the related draft files found (for the Execution Agent to use as local first-hand material)

## Step 3: Check Existing Research

- Search `{research directory}/` to avoid duplication
- If related research exists: flag for update rather than new creation

## Step 4: Determine Knowledge Domain

- Infer the relevant domain (e.g., SoftwareEngineering, Finance, Health, ProductDesign, AI, Math, Art, History)
- If undetermined: mark as `TBD`, the Orchestrator will ask the user

## Step 5: Match Expert Persona

- Scan `{system directory}/提示词/` to find the best matching expert persona file
- Match by topic domain

**Persona applicability rules:**

| Persona                  | Applicable when                                                         | Exclusions                                                                 |
| ------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `Art_ChinesePainting`    | Specific painters, painting styles, calligraphy traditions, poetry genres, art criticism | General cultural history; if image analysis is needed, note in plan "recommend using /ask with image upload" |
| `History_ChineseCulture` | Chinese historical events, institutions, intellectual history, cultural phenomena | Painting/calligraphy topics (use Art persona)                              |
| `AI_LLMResearch`         | LLM architecture, training methods, AI papers, scaling law, VLA, world models | —                                                                          |
| `Math_HigherMathematics` | Abstract algebra, linear algebra, calculus, topology, differential manifolds, representation theory | —                                                                          |
| No match found           | —                                                                       | Note "No match found, using general research mode"                         |

**Applicability mode determination:**

- `Full apply`: Replace default chapter structure entirely with the persona's Output Format
- `Reference apply`: Borrow the analysis framework only, retain default chapters
- `Not applicable`: Use default report structure

## Step 6: Create Plan File

Path: `{plans directory}/Plan_YYYY-MM-DD_Research_Topic.md`

```markdown
---

# Research Plan: [Topic]

## Trigger Mode

[FILE MODE: {drafts directory}/filename.md | TOPIC MODE: topic keywords]

## Research Objective

[What the user will understand after this research is complete]

## Local Draft Materials

[List related file paths in {drafts directory}/, or "No related drafts found"]

## Existing Research

[List related existing research reports in {research directory}/, or "Not found"]

## Related Domain

[Domain name, or TBD]

## Expert Persona

- File path: [{system directory}/提示词/XXX.md, or "Not found"]
- Applicability reason: [Why this persona fits the research topic, one sentence]
- Applicability mode: [Full apply | Reference apply | Not applicable]
- Special format requirements: [e.g., LaTeX formulas, historical source citation format, or "None"]

## Research Strategy

[ ] Read local drafts as first-hand material (if available)
[ ] Search official documentation/authoritative sources
[ ] Form conceptual framework (glossary, module relationships, key mechanisms)
[ ] Find practical examples and use cases (if applicable)
[ ] Summarize best practices and common pitfalls
[ ] Output actionable next-step recommendations

## Output Structure (output only to {research directory}/)

- Main note (research report): {research directory}/Domain/Topic/Topic.md
- Examples/resources (optional): {research directory}/Domain/Topic/examples/
- Visualization (optional): {research directory}/Domain/Topic/Topic_Map.canvas

## Clarification Question Answers

Knowledge level: [To be filled by user]
Method preference: [To be filled by user]
```

## Step 7: Return Result

Return the path to the plan file.
