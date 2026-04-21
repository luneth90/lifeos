# 记忆系统集成协议

> 所有记忆操作通过 MCP 工具调用，`db_path` 和 `vault_root` 由运行时自动注入，技能中无需指定。
> 会话初始化（startup）由 MCP server 自动执行，但 Agent 在进入 Vault 会话时必须显式调用 `memory_bootstrap` 触发并读取 `_layer0`。

## 分层激活规则

记忆操作按用途分为两层。

### 第一层：始终激活

无论是否在技能工作流中，以下操作在**任何对话**中都必须执行：

| 操作 | 时机 | 说明 |
| --- | --- | --- |
| `memory_log` | 用户表达持久规则时 | 写入行为规则，**必须附带 `slot_key`** 和 `content` |

**判断标准：** 用户说的内容**下次对话还需要遵守**吗？如果是，无论当前在做什么，都必须立即写入 LifeOS。

### 第二层：技能工作流

仅在执行 LifeOS 技能（`/today`、`/knowledge`、`/revise`、`/research`、`/project`、`/archive`、`/brainstorm`、`/ask`、`/digest`）或用户明确要求操作 Vault 文件时激活：

| 操作 | 时机 | 说明 |
| --- | --- | --- |
| `memory_bootstrap` | 进入 Vault 会话时 | 显式触发 startup，并读取当前 `_layer0` |
| `memory_notify` | 创建或修改 Vault 文件后 | 更新文件索引（fs.watch 自动兜底，但需要立即查询时应显式调用） |
| `memory_query` | 需要上下文时 | 查询用户偏好、学习进度等 |

### 噪声防护

以下场景**不触发第二层操作**（但第一层始终生效）：
- 闲聊、代码讨论、与 Vault 无关的对话
- 一次性技术问答

---

## 文件变更通知

每次创建或修改 Vault 文件后，立即调用：

```
memory_notify(file_path="<变更文件相对路径>")
```

> fs.watch 会自动兜底索引 .md 文件变更，但需要立即查询新文件时应显式调用。

## 行为规则写入

当用户表达需要持久遵守的规则时，调用：

```
memory_log(
  slot_key="<category>:<topic>",
  content="<规则内容>"
)
```

### `slot_key` 规范

每条规则必须附带 `slot_key`，格式为 `<category>:<topic>`。同一 `slot_key` 的后续写入会自动覆盖旧值。

画像槽位允许在 `topic` 中继续使用 `.` 表示作用域，例如：

- `profile:work_style`
- `profile:weak.math_group_theory`
- `profile:strong.swift_concurrency`
- `profile:motivation.learningapp`
- `profile:thinking_preference`

规则：

- `slot_key` 只允许 ASCII slug，避免把中文标题直接写入 key
- `profile:summary` 视为旧兼容槽位，不再作为推荐写入目标
- 画像写入优先采用结构化 `profile:*` 槽位
- 只有当结构化 `profile:*` 槽位不存在时，系统才回退读取旧的 `profile:summary`
- 未识别的结构化画像槽位可能进入 `其他画像` 兜底分组，此分组仅用于平滑升级，不是推荐写入目标

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
  content="数学公式必须用 LaTeX 格式"
)

memory_log(
  slot_key="workflow:revise-latex",
  content="复习问答中禁止用 obsidian append 写入含 LaTeX 的内容"
)
```

> 可选参数：`related_files`（关联文件路径数组）、`expires_at`（过期时间）。

### 画像内容写法

当写入结构化 `profile:*` 槽位时，`content` 推荐包含三部分：

1. 事实：这次观察到的稳定信号是什么
2. 证据：来自哪条用户表述、哪份日记、项目文件或复习记录
3. 决策影响：下次交互时应如何使用这条画像

## 规则捕获

每条规则**必须附带 `slot_key`**（格式 `<category>:<topic>`）。系统会根据 `slot_key` 自动持久化到 UserProfile，同一 `slot_key` 的后续写入会覆盖旧值。

**必须捕获的场景：**
- 用户纠正 Agent 行为（"不要用英文"、"别加 emoji"、"以后…"）→ `memory_log(slot_key="content:language", content="规则内容")`
- 用户表达持久偏好（"我喜欢简洁的提交信息"、"复习间隔设为两周"）→ `memory_log(slot_key="format:commit-msg", content="规则内容")`

**禁止捕获的场景：**
- 一次性的技术讨论（"这个 bug 的原因是什么"）
- 代码层面已固化的约定（已写入配置文件的参数）
- 从代码或 git 历史可直接推导的信息
