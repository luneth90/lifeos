# 记忆系统集成协议

> 所有记忆操作通过 MCP 工具调用，`db_path` 和 `vault_root` 由运行时自动注入，技能中无需指定。

### 文件变更通知

每次创建或修改 Vault 文件后，立即调用：

```
memory_notify(file_path="<变更文件相对路径>")
```

### 技能完成

全部文件写入完成后，调用一次：

```
memory_skill_complete(
  skill_name="<当前技能名>",
  summary="<一句话描述本次操作>",
  related_files=["<路径1>", "<路径2>"],
  scope="<当前技能名>",
  refresh_targets=["TaskBoard", "UserProfile"]
)
```

### 会话收尾（本技能为会话最后一个操作时）

1. 写入会话桥接：
   ```
   memory_log(entry_type="session_bridge", summary="<本次会话摘要>", scope="<技能名>")
   ```
2. 执行检查点：
   ```
   memory_checkpoint()
   ```
