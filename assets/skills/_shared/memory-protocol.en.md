# Memory System Integration Protocol

> All memory operations are invoked via MCP tools. `db_path` and `vault_root` are automatically injected at runtime; no need to specify them in the skill.
> Session initialization (startup) is handled automatically by the MCP server — agents do not need to manage it.

### File Change Notification

After each Vault file creation or modification, immediately call:

```
memory_notify(file_path="<relative path of changed file>")
```

> fs.watch automatically indexes `.md` file changes as a backup, but call explicitly when you need immediate query results for a newly created file.

### Behavior Rule Logging

When the user expresses a persistent preference or correction, call:

```
memory_log(
  slot_key="<category>:<topic>",
  content="<rule content>",
  source="preference"
)
```

**`slot_key` convention:** Each preference/correction must include a `slot_key` in the format `<category>:<topic>`. Subsequent writes with the same `slot_key` automatically overwrite the old value.

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
  content="Math formulas must use LaTeX format",
  source="preference"
)

memory_log(
  slot_key="workflow:revise-latex",
  content="Do not use obsidian append to write LaTeX content in review Q&A",
  source="correction"
)
```

> `source` values: `preference` (user preference) or `correction` (user correction).
> Optional parameters: `related_files` (array of related file paths), `expires_at` (expiration time).
