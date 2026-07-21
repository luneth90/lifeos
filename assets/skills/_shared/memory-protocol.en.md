# Memory System Integration Protocol

> All memory operations use LifeOS MCP. `db_path` and `vault_root` are injected by the runtime and should not be supplied by skills.
> `memory_bootstrap` is the only tool that does not require `contract_version`; every other tool must explicitly pass `contract_version=2`.

## Required Call Order

```text
memory_bootstrap
  → identify skill, project, repository, tool, or file scopes
  → memory_context(contract_version=2, scopes)
  → use memory_query only when source documents are needed
  → perform the task
  → call memory_notify after file changes
  → use memory_log with an explicit scope
```

1. Call `memory_bootstrap` when entering a LifeOS Vault session. It returns global Layer 0 only.
2. After routing the task, call `memory_context`. An empty scope list returns empty local context; it never loads all memory.
3. Call `memory_query` only when note content is needed. It searches Vault files and does not replace scoped rule routing.
4. Every request except bootstrap must include `contract_version=2`.

## Final Tool Set

| Tool | Purpose |
| --- | --- |
| `memory_bootstrap` | Start a session with global Layer 0 only |
| `memory_context` | Load local context for explicit scopes after routing |
| `memory_query` | Read indexed Vault files when source content is needed |
| `memory_log` | Write durable memory with an explicit kind and scope |
| `memory_rules` | Audit items by kind, scope, status, or slot |
| `memory_forget` | Soft-archive an item by ID with a reason |
| `memory_notify` | Reindex file changes and invalidate affected scopes |

Use the governance interface when auditing memory:

```text
memory_rules(
  contract_version=2,
  item_kind="rule",
  scope={type: "project", key: "gts-learning"},
  status="active",
  limit=100
)
```

## Choosing a Scope

| User meaning | scope | Typical content |
| --- | --- | --- |
| “Always do this…” | `{type: "global", key: ""}` | Global rules and profile signals |
| “When using revise…” | `{type: "skill", key: "revise"}` | Skill rules |
| “In the GTS project…” | `{type: "project", key: "<stable project id>"}` | Project rules, decisions, and profile signals |
| “In the LifeOS repository…” | `{type: "repository", key: "lifeos"}` | Repository rules and stable facts |
| “When using Obsidian…” | `{type: "tool", key: "obsidian"}` | Tool rules |
| “Only for this note…” | `{type: "file", key: "<note id or Vault-relative path>"}` | File-specific exceptions |

- A project scope must use the stable `id` from project frontmatter, not its display title.
- A repository scope must use a portable ID bound in `lifeos.yaml`, never an absolute path.
- Ask when the scope is unclear; never default an unclassified item to global.
- Keep complete architecture decisions in project documents. Memory stores only a short summary plus `related_files`.

## Loading Local Context

After routing, call:

```text
memory_context(
  contract_version=2,
  scopes=[
    {type: "skill", key: "revise"},
    {type: "project", key: "gts-learning"}
  ],
  include_global=false,
  include_related_files=true
)
```

`memory_context` returns rules, decisions, facts, related files, and diagnostics for the requested scopes. Global hard rules have already been injected by bootstrap, so global context should not normally be repeated.

## Search and File Notifications

```text
memory_query(
  contract_version=2,
  query="<keywords>",
  filters={"type": "project"},
  limit=5
)

memory_notify(
  contract_version=2,
  file_path="<Vault-relative path>"
)

# A move or rename must include the previous path
memory_notify(
  contract_version=2,
  file_path="<new Vault-relative path>",
  previous_file_path="<previous Vault-relative path>"
)
```

Notify LifeOS after creating, editing, moving, or deleting a Vault file. For a move or rename, `previous_file_path` synchronizes path-based file scopes and `related_files`. `fs.watch` is only a fallback; explicit notification is required for read-after-write behavior.

## Writing Memory

`memory_log` accepts only durable `rule`, `decision`, `fact`, or `profile` items and requires both scope and kind:

```text
memory_log(
  contract_version=2,
  slot_key="content:language",
  content="Use Chinese for every response",
  scope={type: "global", key: ""},
  item_kind="rule",
  priority=100,
  enforcement="hard",
  source="correction"
)

memory_log(
  contract_version=2,
  slot_key="workflow:revise-latex",
  content="Do not use unsafe append operations for LaTeX in review Q&A",
  scope={type: "skill", key: "revise"},
  item_kind="rule",
  related_files=["40_Knowledge/Notes/related-chapter.md"]
)
```

### Field Rules

- `slot_key` uses `<category>:<topic>` with an ASCII slug. Only the same `(scope.type, scope.key, slot_key)` identity is updated.
- `item_kind`: `rule` is a durable behavior constraint; `decision` is a confirmed decision summary; `fact` is stable information; `profile` is a user profile signal.
- `priority` is 0–100 and defaults to 50. `enforcement` is `hard | soft` and defaults to `soft`.
- Use `source="correction"` for user corrections. A later preference cannot downgrade a correction.
- `related_files` identifies evidence or authoritative source documents. Use `expires_at` only for genuinely temporary memory.
- One-off completion records are events and cannot be written through normal `memory_log`.
- Archive with `memory_forget(contract_version=2, item_id=..., reason="...")`; hard deletion is not available.

### Capture Decision

Write only information that still matters in a later conversation:

- A correction that applies everywhere → global rule.
- A rule limited to a skill, project, repository, tool, or file → matching scoped rule.
- A confirmed project tradeoff → project decision linked to the authoritative project document.
- Stable path or tool configuration → repository/tool fact.
- One-off discussion, information derivable from code or Git, or parameters already stored in configuration → do not write.

## Profile Slots

Common structured profile slots:

- `profile:work_style`
- `profile:weak.<domain_slug>`
- `profile:strong.<domain_slug>`
- `profile:motivation.<project_slug>`
- `profile:context_switch_pattern`
- `profile:thinking_preference`

Profile content should include the fact, evidence, and decision impact. Use global scope for stable cross-context signals and project scope for motivation or strengths and weaknesses that only apply to one project. Do not write removed aggregate profile slots.

## Noise Protection

Casual chat, one-off technical Q&A, and conversations unrelated to the Vault do not trigger file search or local context. Explicit persistent rules still follow the scoped write protocol above.
