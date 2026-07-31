# LifeOS Learning Lifecycle

This document describes the overall workflow of the LifeOS skill system and the relationships between skills.

<!-- learning-lifecycle-contract-v1 -->
```yaml
contract_version: 1
nodes:
  - today
  - digest
  - draft
  - research
  - project
  - read-pdf
  - extraction
  - translate
  - knowledge
  - revise
edges:
  - {from: digest, to: draft}
  - {from: draft, to: research}
  - {from: draft, to: project}
  - {from: draft, to: knowledge}
  - {from: read-pdf, to: extraction}
  - {from: extraction, to: translate}
  - {from: translate, to: knowledge}
  - {from: knowledge, to: revise}
```

## Core Flow

```
today (daily entry point)
  ├→ project (structure ideas into projects)
  ├→ research (deep research on topics, produce research reports)
  ├→ knowledge (distill knowledge notes from source material)
  ├→ revise (spaced review + grading)
  └→ archive (archive completed projects and processed drafts)
```

## Auxiliary Flows

```
brainstorm → project | knowledge | draft (exploratory conversation, output optional)
ask → today | read-pdf | translate | digest | knowledge | brainstorm | research (quick Q&A, route as needed)
digest → draft → research | project | knowledge (a digest is a publicly consumable draft handoff)
read-pdf → extraction → translate → knowledge → revise (the public PDF-to-learning handoff)
```

## Typical Learning Path

1. `/today` — Morning planning, identify active projects and notes due for review
2. `/project` — Create a learning project, plan chapter structure
3. `/knowledge` — Distill knowledge notes and encyclopedia concepts chapter by chapter
4. `/revise` — Generate review questions, grade upon completion
5. `/archive` — Archive completed projects and processed drafts

Knowledge status advances only through `draft → review → revised → mastered`: `/knowledge` moves a validated note to `review`; `/revise` consumes `review` by default, the first complete grading pass moves it to `revised`, and only a later explicit review that meets the mastery criteria moves it to `mastered`.

## Skill Invocation Matrix

| Source Skill | Callable/Suggested Targets | Invocation Method |
|-------------|---------------------------|-------------------|
| /today | /revise, /research, /project, /brainstorm, /archive | Text suggestion |
| /brainstorm | /project | Pass a handoff through the `/project` public entry; never read internal prompts |
| /brainstorm | /knowledge | Directly create encyclopedia notes |
| /brainstorm | draft | Directly create draft files |
| /ask | /read-pdf | Direct invocation |
| /ask | /knowledge, /brainstorm, /research | End-of-conversation hook suggestion |
| /knowledge | standalone Wiki | Without a project, use the generic Wiki template and write directly under `{knowledge directory}/{wiki subdirectory}` |
| /knowledge | project-bound knowledge note | With a project and source, create a chapter/paper note and update the project mastery table |
| /revise | /brainstorm, /ask | Suggestion (for weak concepts) |
| /research | draft (input) | Read drafts as research source |
| /project | draft (input) | Read drafts as project seed |

## Shared Protocol References

- State machine definitions: `_shared/lifecycle.md`
- Memory integration protocol: `_shared/memory-protocol.md`
- Dual agent orchestration: `_shared/dual-agent-orchestrator.md`
- Template loading rules: `_shared/template-loading.md`
- Completion report format: `_shared/completion-report.md`
