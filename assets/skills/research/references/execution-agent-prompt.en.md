---
name: execution-agent-prompt
description: Execution Agent prompt for the Research skill
role: execution
parent_skill: research
---

# Research Execution Agent Instructions

> Path logical names (e.g., `{research directory}`, `{drafts directory}`) are resolved by the Orchestrator from `lifeos.yaml` and injected into context. See the main skill file `research/SKILL.md` for the mapping.

> This file is read by the `research/SKILL.md` Orchestrator after the user confirms the plan, and used as the complete prompt for the Task tool.
> Replace `[plan file path]` with the actual plan file path when using.

---

Execute the research plan at the following path: [plan file path]

## Step 1: Read the Plan File in Full

Pay attention to the following key fields:

- Trigger mode (FILE MODE or TOPIC MODE)
- Local draft materials (listed file paths)
- Clarification question answers (user's knowledge level and method preference)
- Expert persona (file path, applicability mode, special format requirements)

**Persona application rules (based on applicability mode):**

| Applicability mode        | Execution rules                                                                                                                                                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Full apply`              | Read the complete persona file; use the persona's Analytical Framework as the structural skeleton; replace default chapters with the persona's Output Format (always retain: frontmatter, core insights from drafts, related reading, references); enforce the persona's Constraints and Guardrails; match the persona's Interaction Style tone |
| `Reference apply`         | Read the persona file, borrow its analysis framework to enrich the analysis, but retain the default chapter structure below                                                                                                                                                       |
| `Not applicable` or `Not found` | Use the default chapter structure below                                                                                                                                                                                                                                    |

## Step 2: Read Local Draft Materials

- Read the full content of each file listed in "Local Draft Materials" one by one
- Treat these files as **first-hand sources** (representing the user's original thinking)
- **FILE MODE**: the specified draft file is the core anchor; all research expands from it
- **TOPIC MODE**: draft files serve as supplementary background

## Step 3: External Research

- Use WebSearch to retrieve current information, official documentation, authoritative sources
- Use WebFetch to read documentation pages
- Cross-validate local draft insights with external sources
- **When WebSearch returns nothing**: rely on local drafts, note limitations in the report
- **When WebFetch fails**: mark in "References" as "(link inaccessible, for reference only)"

## Step 4: Write the Research Report

Path: `{research directory}/Domain/Topic/Topic.md`

> ⚠️ `/research` must never create files under `{knowledge directory}/` — that is the responsibility of `/knowledge`.

Adjust depth and style based on user's knowledge level and method preference.

**Default chapter structure** (used when persona applicability mode is not `Full apply`):

```markdown
---
title: "Topic"
type: research
created: "YYYY-MM-DD"
domain: "[[DomainName]]"
status: complete
tags: [research]
aliases: []
---

## Overview

(Conclusion first: what it is, what problem it solves, scope of applicability)

## Core Insights from Drafts

(Only when local drafts exist: integrate the user's original ideas, cite source files. Omit this section if no drafts)

## Core Concept Framework

(Glossary/modules/components/key mechanisms; may use [[wikilink]] to point to existing knowledge/concepts, but do not create new {knowledge directory} files)

## How It Works

(Necessary technical details)

## Examples

(Code/scenarios/step-by-step procedures, if applicable)

## Best Practices

## Common Pitfalls

## Related Reading

(Wikilinks only: related research/projects/knowledge notes within the Vault)

## References

(External links: docs/articles/videos)
```

**Math formula format specification** (when Math persona is active, or when the report contains formulas):

- Inline formulas: `$formula$` (single dollar signs)
- Display formulas: `$$formula$$` (double dollar signs, each on its own line)
- Multi-line formulas: `$$\begin{aligned}...\end{aligned}$$`
- Do not use `\(...\)` or `\[...\]` (Obsidian does not render these by default)
- Do not skip key derivation steps with "obviously" or "easily verified"

## Step 5: Create Visualization Map (For Complex Topics)

Path: `{research directory}/Domain/Topic/Topic_Map.canvas`

## Step 6: Create Examples (If Applicable)

Path: `{research directory}/Domain/Topic/examples/`

## Step 7: Update Draft Status (Critical)

For each draft file used from "Local Draft Materials":

- Update the `status` in its frontmatter to `done`
- This marks the draft as processed, allowing `/archive` to identify and archive it

## Step 8: Update Today's Diary

If `{diary directory}/YYYY-MM-DD.md` exists, append a brief research summary. Skip this step if the diary file does not exist.

## Step 9: Update Plan Status (Critical)

- After the research report is complete, update the plan file frontmatter `status` to `done`
- Keep the plan file in `{plans directory}/`
- `/archive` later moves plans with `status: done` into `{system directory}/{archived plans subdirectory}/`

---

## Completion Report

After completion, report in English:

```
## Research Complete: [Topic]

**Created:**
- Research report: [[Topic]] ({research directory}/Domain/Topic/)
- Examples: [N] files (if any)
- Visualization: [Yes/No] (if any)

**Integrated draft sources:**
- [List draft files used, or "None"] → status updated to done

**Plan status:** {plans directory}/Plan_YYYY-MM-DD_Research_Topic.md → `status: done` (waiting for `/archive` to move it into `{system directory}/{archived plans subdirectory}/`)

**Key takeaways:**
1. [Takeaway 1]
2. [Takeaway 2]
3. [Takeaway 3]

**Next steps:**
- [ ] To distill into reusable knowledge points: use /knowledge to extract from authoritative sources into {knowledge directory}/{notes subdirectory} or {wiki subdirectory}
- [ ] Consolidate through practice/projects (if applicable)
- [ ] Run /archive to clean up processed drafts
```
