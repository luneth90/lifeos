# Memory System Integration Protocol

> All memory operations are invoked via MCP tools. `db_path` and `vault_root` are automatically injected at runtime; no need to specify them in the skill.
> Session initialization (startup) and wrap-up (checkpoint) are handled automatically by the MCP server — agents do not need to manage them.

### File Change Notification

After each Vault file creation or modification, immediately call:

```
memory_notify(file_path="<relative path of changed file>")
```

> fs.watch automatically indexes `.md` file changes as a backup, but call explicitly when you need immediate query results for a newly created file.

### Skill Completion

After all file writes are complete, call once:

```
memory_log(
  entry_type="skill_completion",
  skill_name="<current skill name>",
  summary="<one-line description of this operation>",
  related_files=["<path1>", "<path2>"],
  scope="<current skill name>",
  importance=4
)
```

### Preference Review (after skill completion, before session wrap-up)

Review the current conversation for any unrecorded user preferences or corrections. The following **must** be captured via `memory_auto_capture`:

- User corrected Agent behavior ("don't...", "stop...", "from now on...") → `corrections`
- User confirmed an approach or rule ("use this...", "yes, like that") → `decisions`
- User expressed a persistent preference ("I prefer...", "set interval to...") → `preferences`

**`slot_key` convention:** Each preference/correction/decision must include a `slot_key` in the format `<category>:<topic>`. Subsequent writes with the same `slot_key` automatically overwrite the old value.

| category | Meaning | Examples |
| --- | --- | --- |
| `format` | Output format | `format:latex`, `format:note-style` |
| `workflow` | Workflow | `workflow:review-frequency` |
| `tool` | Tool usage | `tool:editor` |
| `content` | Content style | `content:language`, `content:emoji` |
| `schedule` | Scheduling | `schedule:study-time` |

```
memory_auto_capture(
  preferences=[{
    "summary": "Math formulas must use LaTeX format",
    "slot_key": "format:latex",
    "scope": "knowledge"
  }],
  corrections=[{
    "summary": "Do not use obsidian append to write LaTeX content in review Q&A",
    "slot_key": "workflow:revise-latex",
    "scope": "revise"
  }]
)
```

> If none of the above occurred in this conversation, skip this step.

### Session Wrap-up (when this skill is the last operation in the session)

Write session bridge (checkpoint is handled automatically by MCP server):

```
memory_log(entry_type="session_bridge", summary="<session summary>", scope="<skill name>")
```
