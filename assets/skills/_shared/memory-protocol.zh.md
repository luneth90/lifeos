# 记忆系统集成协议

> 所有记忆操作通过 MCP 工具调用，`db_path` 和 `vault_root` 由运行时自动注入，技能中无需指定。
> 会话初始化（startup）由 MCP server 自动执行，Agent 无需关心。

### 文件变更通知

每次创建或修改 Vault 文件后，立即调用：

```
memory_notify(file_path="<变更文件相对路径>")
```

> fs.watch 会自动兜底索引 .md 文件变更，但需要立即查询新文件时应显式调用。

### 行为约束写入

当用户表达需要持久遵守的偏好或纠错时，调用：

```
memory_log(
  slot_key="<category>:<topic>",
  content="<规则内容>",
  source="preference"
)
```

**`slot_key` 规范：** 每条偏好/纠错必须附带 `slot_key`，格式为 `<category>:<topic>`。同一 `slot_key` 的后续写入会自动覆盖旧值。

| category | 含义 | 示例 |
| --- | --- | --- |
| `format` | 输出格式 | `format:latex`、`format:note-style` |
| `workflow` | 工作流 | `workflow:review-frequency` |
| `tool` | 工具使用 | `tool:editor` |
| `content` | 内容风格 | `content:language`、`content:emoji` |
| `schedule` | 时间安排 | `schedule:study-time` |

**示例：**

```
memory_log(
  slot_key="format:latex",
  content="数学公式必须用 LaTeX 格式",
  source="preference"
)

memory_log(
  slot_key="workflow:revise-latex",
  content="复习问答中禁止用 obsidian append 写入含 LaTeX 的内容",
  source="correction"
)
```

> `source` 取值：`preference`（用户偏好）或 `correction`（用户纠错）。
> 可选参数：`related_files`（关联文件路径数组）、`expires_at`（过期时间）。
