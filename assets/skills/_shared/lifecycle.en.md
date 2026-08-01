# LifeOS Shared Lifecycle State Machines

This document defines the state transition rules for all note types in the LifeOS skill system. This is the single source of truth.

## Draft Lifecycle

```
pending ──/research,/project,/knowledge──→ done ──/archive──→ keep done
```

| Status | Meaning | Set by |
|--------|---------|--------|
| `pending` | Created by /brainstorm or /today, not yet processed | /brainstorm, /today |
| `done` | Consumed by /research, /project, or /knowledge | /research, /project, /knowledge |

**Rules:**

- /archive only archives drafts with status `done`.
- /archive never archives `pending` drafts.
- After the move transaction completes, the archive metadata transaction is required. It only appends `archived: "YYYY-MM-DD"`, preserves `status: done`, and completes file notification and index confirmation. Archival is complete only after both transactions complete.

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
active ⇄ frozen ──→ done ──/archive──→ keep done
```

| Status | Meaning | Set by |
|--------|---------|--------|
| `active` | Currently being worked on | /project |
| `frozen` | Short-term freeze — retains all data, hidden from TaskBoard focus/active-projects/revise panels | Manual |
| `done` | Completed, ready for archival | Manual |

**Frozen rules:**

- User manually sets frontmatter `status: frozen` to freeze, changes back to `status: active` to unfreeze
- Knowledge notes linked to a frozen project (via `project` field) are hidden from the review list
- A frozen project can transition directly to `done` or be unfrozen back to `active`
- When archiving a `done` project, the archive metadata transaction is required after the move transaction; it only appends `archived: "YYYY-MM-DD"` and preserves `status: done`.

## Plan Lifecycle

```
pending ──confirmation──→ active ──execution completes──→ done ──/archive──→ keep done
                             └──execution fails──→ failed
                             └──cancelled──→ cancelled
```

| Status | Meaning | Set by |
|--------|---------|--------|
| `pending` | Generated and waiting for user confirmation | /project, /research |
| `active` | Confirmed and executing or waiting for review | /project, /research |
| `done` | The corresponding project or research work has finished and is waiting for /archive | /project, /research |
| `failed` | Execution failed; failure details are retained for recovery | /project, /research |
| `cancelled` | Cancelled by the user and not executed | User |

**Rules:**

- /project and /research must write `type: plan` and `status: pending` when creating a plan file
- /project and /research only update the plan status to `done` after execution; they do not move the plan file directly
- /archive only archives plans with `status: done`; after the move transaction, the required archive metadata transaction appends `archived: "YYYY-MM-DD"` and preserves `status: done`

## Research Lifecycle

```
draft ──completeness validation passes──→ complete
```

| Status | Meaning | Set by |
|--------|---------|--------|
| `draft` | The report is being generated or awaits completeness validation | /research |
| `complete` | The report passed its completeness validation | /research |

## Translation Lifecycle

```
draft ──completeness validation passes──→ complete
```

| Status | Meaning | Set by |
|--------|---------|--------|
| `draft` | The requested page range is not fully translated or validated | /translate |
| `complete` | The requested range, frontmatter, and file notification have all been validated | /translate |

**Rule:** /translate may update `draft` to `complete` only after completeness validation passes.

## Revise Record Lifecycle

This section is authoritative for `type: revise-record`.

```
pending ──completed /revise grading──→ graded
```

| Status | Meaning | Set by |
|--------|---------|--------|
| `pending` | Questions exist and await answers or complete grading | /revise |
| `graded` | This grading pass is complete; `result: pass | fail` records the outcome | /revise |

**Rule:** /revise writes `pending` when creating a revise record and advances it to `graded` only after
complete grading records the score, result, and weaknesses. This lifecycle is separate from the knowledge
note lifecycle `review → revised → mastered`.

## Skill Participation Matrix

| Skill | Draft Transitions | Knowledge Note Transitions | Revise Record Transitions | Project Transitions | Plan Transitions |
|-------|-------------------|---------------------------|---------------------------|---------------------|------------------|
| /brainstorm | Creates `pending` | - | - | - | - |
| /today | Creates `pending` | - | - | - | - |
| /research | `pending` → `done` | - | - | - | Creates `pending`, confirms to `active`, then updates to `done` after execution |
| /project | `pending` → `done` | - | - | Creates `active` | Creates `pending`, confirms to `active`, then updates to `done` after execution |
| /knowledge | `pending` → `done` | Creates `draft`, then sets `review` after validation | - | - | - |
| /revise | - | Default `review` → `revised`; explicit later review may move `revised` → `mastered` | Creates `pending`, then updates to `graded` after complete grading | Updates mastery dots | - |
| /translate | - | - | - | - | - |
| /archive | Keeps `done` and writes the archival date | - | - | Keeps `done` and writes the archival date | Keeps `done` and writes the archival date |
