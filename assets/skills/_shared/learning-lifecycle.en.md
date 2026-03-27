# LifeOS Learning Lifecycle

This document describes the overall workflow of the LifeOS skill system and the relationships between skills.

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
ask → read-pdf | knowledge | brainstorm | research (quick Q&A, escalate as needed)
read-pdf → JSON intermediate output (PDF extractor consumed by knowledge/ask/revise)
```

## Typical Learning Path

1. `/today` — Morning planning, identify active projects and notes due for review
2. `/project` — Create a learning project, plan chapter structure
3. `/knowledge` — Distill knowledge notes and encyclopedia concepts chapter by chapter
4. `/revise` — Generate review questions, grade upon completion
5. `/archive` — Archive completed projects and processed drafts

## Skill Invocation Matrix

| Source Skill | Callable/Suggested Targets | Invocation Method |
|-------------|---------------------------|-------------------|
| /today | /review, /research, /project, /brainstorm, /archive | Text suggestion |
| /brainstorm | /project | Read project planning-agent-prompt to launch sub-agent |
| /brainstorm | /knowledge | Directly create encyclopedia notes |
| /brainstorm | draft | Directly create draft files |
| /ask | /read-pdf | Direct invocation |
| /ask | /knowledge, /brainstorm, /research | End-of-conversation hook suggestion |
| /knowledge | /project (prerequisite) | Stop and prompt if no project file exists |
| /revise | /brainstorm, /ask | Suggestion (for weak concepts) |
| /research | draft (input) | Read drafts as research source |
| /project | draft (input) | Read drafts as project seed |

## Shared Protocol References

- State machine definitions: `_shared/lifecycle.md`
- Memory integration protocol: `_shared/memory-protocol.md`
- Dual agent orchestration: `_shared/dual-agent-orchestrator.md`
- Template loading rules: `_shared/template-loading.md`
- Completion report format: `_shared/completion-report.md`
