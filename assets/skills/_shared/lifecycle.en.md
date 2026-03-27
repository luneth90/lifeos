# LifeOS Shared Lifecycle State Machines

This document defines the state transition rules for all note types in the LifeOS skill system. This is the single source of truth.

## Draft Lifecycle

```
pending ──/research──→ researched ──┐
pending ──/project───→ projected  ──┼──/archive──→ archived
pending ──/knowledge─→ knowledged ──┘
```

| Status | Meaning | Set by |
|--------|---------|--------|
| `pending` | Created by /brainstorm or /today, not yet processed | /brainstorm, /today |
| `researched` | Consumed by /research into a research report | /research |
| `projected` | Consumed by /project into a project file | /project |
| `knowledged` | Consumed by /knowledge into knowledge notes | /knowledge |
| `archived` | Moved to archive directory by /archive | /archive |

**Rules:**

- /archive only archives drafts with status `researched`, `projected`, or `knowledged`.
- /archive never archives `pending` drafts.

## Knowledge Note Lifecycle

```
draft ──/revise(≥50%)──→ revise ──/revise(≥80%)──→ mastered
```

| Status | Meaning | Set by |
|--------|---------|--------|
| `draft` | Created by /knowledge, never reviewed | /knowledge |
| `revise` | Promoted by /revise when score 50%-80% | /revise |
| `mastered` | Promoted by /revise when score ≥80% | /revise |

**Rules:**

- Status only upgrades, never downgrades: `draft` -> `revise` -> `mastered`.
- /revise updates the corresponding project file's mastery dots (⚪→🔴→🟡→🟢).

## Project Lifecycle

```
active ──→ on-hold ──→ done ──/archive──→ archived
```

| Status | Meaning | Set by |
|--------|---------|--------|
| `active` | Currently being worked on | /project |
| `on-hold` | Paused | Manual |
| `done` | Completed, ready for archival | Manual |
| `archived` | Moved to archive directory by /archive | /archive |

## Skill Participation Matrix

| Skill | Draft Transitions | Knowledge Note Transitions | Project Transitions |
|-------|-------------------|---------------------------|---------------------|
| /brainstorm | Creates `pending` | - | - |
| /today | Creates `pending` | - | - |
| /research | `pending` → `researched` | - | - |
| /project | `pending` → `projected` | - | Creates `active` |
| /knowledge | `pending` → `knowledged` | Creates `draft` | - |
| /revise | - | `draft` → `revise` → `mastered` | Updates mastery dots |
| /archive | `researched/projected/knowledged` → `archived` | - | `done` → `archived` |
| /rename | - | - | - |
| /enhance | - | - | - |
