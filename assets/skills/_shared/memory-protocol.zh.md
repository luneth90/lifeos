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

### 偏好回顾（技能完成后、会话收尾前）

回顾本次对话，检查是否存在未记录的用户偏好或纠错。以下情况**必须**通过 `memory_auto_capture` 补写：

- 用户纠正了 Agent 的行为（"不要…"、"别…"、"以后…"）→ `corrections`
- 用户确认了某种方案或规则（"就用…"、"对，这样"）→ `decisions`
- 用户表达了持久性偏好（"我喜欢…"、"间隔设为…"）→ `preferences`

**`slot_key` 规范：** 每条偏好/纠错/决策必须附带 `slot_key`，格式为 `<category>:<topic>`。同一 `slot_key` 的后续写入会自动覆盖旧值。

| category | 含义 | 示例 |
| --- | --- | --- |
| `format` | 输出格式 | `format:latex`、`format:note-style` |
| `workflow` | 工作流 | `workflow:review-frequency` |
| `tool` | 工具使用 | `tool:editor` |
| `content` | 内容风格 | `content:language`、`content:emoji` |
| `schedule` | 时间安排 | `schedule:study-time` |

```
memory_auto_capture(
  preferences=[{
    "summary": "数学公式必须用 LaTeX 格式",
    "slot_key": "format:latex",
    "scope": "knowledge"
  }],
  corrections=[{
    "summary": "复习问答中禁止用 obsidian append 写入含 LaTeX 的内容",
    "slot_key": "workflow:revise-latex",
    "scope": "revise"
  }]
)
```

> 若本次对话中没有以上任何情况，跳过此步骤。

### 会话收尾（本技能为会话最后一个操作时）

1. 写入会话桥接：
   ```
   memory_log(entry_type="session_bridge", summary="<本次会话摘要>", scope="<技能名>")
   ```
2. 执行检查点：
   ```
   memory_checkpoint()
   ```
