---
name: execution-agent-prompt
description: Execution Agent prompt for the Research skill
role: execution
parent_skill: research
---

# Research Execution Agent Instructions

> Path logical names (e.g., `{research directory}`, `{drafts directory}`) are resolved by the Orchestrator from `lifeos.yaml` and injected into context. See the main skill file `research/SKILL.md` for the mapping.

> This file is run by the `research/SKILL.md` Orchestrator through `spawn_agent` after confirmation validation.
> Replace `{{RESEARCH_INPUT}}` with the confirmed research input and obtain the actual plan path from it.

---

Execute the confirmed plan for the following research input: {{RESEARCH_INPUT}}

## Step 1: Read the Plan File in Full

Pay attention to the following key fields:

- Trigger mode (FILE MODE or TOPIC MODE)
- Local draft materials (listed file paths)
- Expert persona (file path, applicability mode, special format requirements)

**Persona application rules (based on applicability mode):**

| Applicability mode        | Execution rules                                                                                                                                                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Full apply`              | Read the complete persona file; apply its Analytical Framework, evidence standards, Constraints and Guardrails, and Interaction Style to analysis content and expression. The report still uses the complete frontmatter, chapters, and headings from `Research_Template.md`. |
| `Reference apply`         | Read the persona file and borrow only relevant analytical focus, terminology, and expression to enrich content. The report still uses the complete frontmatter, chapters, and headings from `Research_Template.md`. |
| `Not applicable` or `Not found` | Use general research content emphasis. The report still uses the complete frontmatter, chapters, and headings from `Research_Template.md`. |

No persona may change, remove, reorder, or replace the chapter structure of `Research_Template.md`.

## Step 2: Read Local Draft Materials

- Read the full content of each file listed in "Local Draft Materials" one by one
- Treat these files as **first-hand sources** (representing the user's original thinking)
- **FILE MODE**: the specified draft file is the core anchor; all research expands from it
- **TOPIC MODE**: draft files serve as supplementary background

## Step 3: External Research

- Use `web_search` to retrieve current information, official documentation, authoritative sources
- Use `web_fetch` to read documentation pages
- Cross-validate local draft insights with external sources
- **When `web_search` returns nothing**: rely on local drafts, note limitations in the report
- **When `web_fetch` fails**: mark in "References" as "(link inaccessible, for reference only)"

## Step 4: Write the Research Report

The confirmed plan specifies the path; the report file must remain under `{research directory}/`.

> ⚠️ `/research` must never create files under `{knowledge directory}/` — that is the responsibility of `/knowledge`.

Before writing, read `{system directory}/{templates subdirectory}/Research_Template.md` and replace every
required placeholder: `TOPIC`, `DOMAIN`, `DATE`, `COMPLETENESS`, and `ID`. The report structure comes only
from that template; a persona may enrich analysis content but must not maintain a second frontmatter or heading
set. Write initially with `status: draft`, then update to `status: complete` only after completeness validation.

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

## Step 7: Preserve Source Status (Critical)

Do not change any source draft or plan status. Record `claim`, `source`, `published_at`, `fetched_at`, and access result for every source in the source ledger. On partial source failure, retain errors, keep the report `status: draft`, and return for Orchestrator acceptance.

## Step 8: Update Today's Diary

If `{diary directory}/YYYY-MM-DD.md` exists, append a brief research summary. Skip this step if the diary file does not exist.

## Step 9: Return Execution Manifest (Critical)

Return a manifest conforming to `Execution_Manifest_Schema.json` with `contract_version`, `run_id`, `phase`, `plan_revision`, `confirmed_hash`, `inputs`, `artifacts`, `status_mutations`, `validation`, and `errors`. Only the Orchestrator may commit source and plan statuses after independent validation and per-file notification.

## Step 10: Research Completeness Validation

Reread the research report and confirm every required template placeholder is replaced, the report covers the
approved plan, and the frontmatter is complete. On failure, keep `status: draft` and report the gap; update to
`status: complete` only when validation passes.

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
- [List draft files used, or "None"] → status unchanged, awaiting independent acceptance

**Plan status:** current status retained, awaiting Orchestrator acceptance

**Key takeaways:**
1. [Takeaway 1]
2. [Takeaway 2]
3. [Takeaway 3]

**Next steps:**
- [ ] To distill into reusable knowledge points: use /knowledge to extract from authoritative sources into {knowledge directory}/{notes subdirectory} or {wiki subdirectory}
- [ ] Consolidate through practice/projects (if applicable)
- [ ] Run /archive to clean up processed drafts
```
