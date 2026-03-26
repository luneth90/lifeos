# Memory System Integration Protocol

> All memory operations are invoked via MCP tools. `db_path` and `vault_root` are automatically injected at runtime; no need to specify them in the skill.

### File Change Notification

After each Vault file creation or modification, immediately call:

```
memory_notify(file_path="<relative path of changed file>")
```

### Skill Completion

After all file writes are complete, call once:

```
memory_skill_complete(
  skill_name="<current skill name>",
  summary="<one-line description of this operation>",
  related_files=["<path1>", "<path2>"],
  scope="<current skill name>",
  refresh_targets=["TaskBoard", "UserProfile"]
)
```

### Session Wrap-up (when this skill is the last operation in the session)

1. Write session bridge:
   ```
   memory_log(entry_type="session_bridge", summary="<session summary>", scope="<skill name>")
   ```
2. Execute checkpoint:
   ```
   memory_checkpoint()
   ```
