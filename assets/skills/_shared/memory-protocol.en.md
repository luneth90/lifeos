# Memory System Integration Protocol

> All memory operations are invoked via MCP tools. `db_path` and `vault_root` are automatically injected at runtime; no need to specify them in the skill.
> Session initialization (startup) is handled automatically by the MCP server — agents do not need to manage it.

## Layered Activation Rules

Memory operations are organized into two layers.

### Layer 1: Always Active

The following operations must be performed in **any conversation**, regardless of whether a skill workflow is active:

| Operation | When | Description |
| --- | --- | --- |
| `memory_log` | When user expresses persistent rules | Write behavior rules — **must include `slot_key`** and `content` |

**Judgment criteria:** Will the user's statement **still need to be followed in the next conversation**? If yes, regardless of what you're currently doing, it must be written to LifeOS immediately.

### Layer 2: Skill Workflows

Activated only when executing a LifeOS skill (`/today`, `/knowledge`, `/revise`, `/research`, `/project`, `/archive`, `/brainstorm`, `/ask`, `/digest`) or when the user explicitly requests Vault file operations:

| Operation | When | Description |
| --- | --- | --- |
| `memory_notify` | After creating or modifying a Vault file | Update file index (fs.watch provides automatic backup, but call explicitly when immediate query is needed) |
| `memory_query` | When context is needed | Query user preferences, learning progress, etc. |

### Noise Protection

The following scenarios **do not trigger Layer 2 operations** (but Layer 1 remains active):
- Casual chat, code discussions, conversations unrelated to the Vault
- One-off technical Q&A

---

## File Change Notification

After each Vault file creation or modification, immediately call:

```
memory_notify(file_path="<relative path of changed file>")
```

> fs.watch automatically indexes `.md` file changes as a backup, but call explicitly when you need immediate query results for a newly created file.

## Behavior Rule Logging

When the user expresses a persistent rule, call:

```
memory_log(
  slot_key="<category>:<topic>",
  content="<rule content>"
)
```

### `slot_key` Convention

Each rule must include a `slot_key` in the format `<category>:<topic>`. Subsequent writes with the same `slot_key` automatically overwrite the old value.

| category | Meaning | Examples |
| --- | --- | --- |
| `format` | Output format | `format:latex`, `format:note-style` |
| `workflow` | Workflow | `workflow:review-frequency` |
| `tool` | Tool usage | `tool:editor` |
| `content` | Content style | `content:language`, `content:emoji` |
| `schedule` | Scheduling | `schedule:study-time` |

**Examples:**

```
memory_log(
  slot_key="format:latex",
  content="Math formulas must use LaTeX format"
)

memory_log(
  slot_key="workflow:revise-latex",
  content="Do not use obsidian append to write LaTeX content in review Q&A"
)
```

> Optional parameters: `related_files` (array of related file paths), `expires_at` (expiration time).

## Rule Capture

Each rule **must include a `slot_key`** (format: `<category>:<topic>`). The system automatically persists it to UserProfile; subsequent writes with the same `slot_key` overwrite the old value.

**Must capture scenarios:**
- User corrects Agent behavior ("don't use English", "no emoji", "from now on...") → `memory_log(slot_key="content:language", content="rule content")`
- User expresses a persistent preference ("I prefer concise commit messages", "set review interval to two weeks") → `memory_log(slot_key="format:commit-msg", content="rule content")`

**Forbidden capture scenarios:**
- One-off technical discussions ("what caused this bug")
- Conventions already codified in code (parameters in config files)
- Information directly derivable from code or git history
