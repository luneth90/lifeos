# LifeOS Shared Lifecycle State Machines

This document defines the state transition rules for all note types in the LifeOS skill system. This is the single source of truth.

## Draft Lifecycle

```
pending ──/research,/project,/knowledge──→ done ──/archive──→ archived
```

| Status | Meaning | Set by |
|--------|---------|--------|
| `pending` | Created by /brainstorm or /today, not yet processed | /brainstorm, /today |
| `done` | Consumed by /research, /project, or /knowledge | /research, /project, /knowledge |
| `archived` | Moved to archive directory by /archive | /archive |

**Rules:**

- /archive only archives drafts with status `done`.
- /archive never archives `pending` drafts.

## Knowledge Note Lifecycle

```
draft ──/knowledge validation──→ review ──completed /revise grading──→ revised ──explicit follow-up review passes──→ mastered
```

| Status | Meaning | Set by |
|--------|---------|--------|
| `draft` | Knowledge curation is incomplete; excluded from the default review queue | /knowledge |
| `review` | Content is complete and validated, waiting for its first review | /knowledge |
| `revised` | At least one complete grading pass has finished; weaknesses are tracked separately | /revise |
| `mastered` | The user explicitly re-reviews a revised note, scores at least 80% in a later independent pass, and clears all prior weaknesses | /revise |

**Rules:**

- Status only upgrades, never downgrades: `draft` → `review` → `revised` → `mastered`.
- /revise consumes `review` by default. A first complete grading pass always advances to `revised`, regardless of score, and never jumps directly to `mastered`.
- Only an explicit later review of a `revised` note can advance to `mastered` after meeting the mastery criteria.
- /revise updates the corresponding project file's mastery dots (⚪→🔴→🟠→🟡→🟢).

## Project Lifecycle

```
active ⇄ frozen ──→ done ──/archive──→ archived
```

| Status | Meaning | Set by |
|--------|---------|--------|
| `active` | Currently being worked on | /project |
| `frozen` | Short-term freeze — retains all data, hidden from TaskBoard focus/active-projects/revise panels | Manual |
| `done` | Completed, ready for archival | Manual |
| `archived` | Moved to archive directory by /archive | /archive |

**Frozen rules:**

- User manually sets frontmatter `status: frozen` to freeze, changes back to `status: active` to unfreeze
- Knowledge notes linked to a frozen project (via `project` field) are hidden from the review list
- A frozen project can transition directly to `done` or be unfrozen back to `active`

## Plan Lifecycle

```
active ──/project,/research──→ done ──/archive──→ archived
```

| Status | Meaning | Set by |
|--------|---------|--------|
| `active` | Created by /project or /research and kept in `{plans directory}/` while waiting for execution or review | /project, /research |
| `done` | The corresponding project or research work has finished and is waiting for /archive | /project, /research |
| `archived` | Moved into `{system directory}/{archived plans subdirectory}/` by /archive | /archive |

**Rules:**

- /project and /research must write `type: plan` and `status: active` when creating a plan file
- /project and /research only update the plan status to `done` after execution; they do not move the plan file directly
- /archive only archives plans with `status: done` and updates them to `archived` after moving

## Skill Participation Matrix

| Skill | Draft Transitions | Knowledge Note Transitions | Project Transitions | Plan Transitions |
|-------|-------------------|---------------------------|---------------------|------------------|
| /brainstorm | Creates `pending` | - | - | - |
| /today | Creates `pending` | - | - | - |
| /research | `pending` → `done` | - | - | Creates `active`, then updates to `done` after execution |
| /project | `pending` → `done` | - | Creates `active` | Creates `active`, then updates to `done` after execution |
| /knowledge | `pending` → `done` | Creates `draft`, then sets `review` after validation | - | - |
| /revise | - | Default `review` → `revised`; explicit later review may move `revised` → `mastered` | Updates mastery dots | - |
| /archive | `done` → `archived` | - | `done` → `archived` | `done` → `archived` |
