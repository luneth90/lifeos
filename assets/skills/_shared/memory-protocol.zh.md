# 记忆系统集成协议

> 所有记忆操作通过 LifeOS MCP 完成。`db_path` 与 `vault_root` 由运行时注入，技能无需传入。
> `memory_bootstrap` 是唯一不要求 `contract_version` 的工具；其他工具必须显式传 `contract_version=2`。

## 统一调用顺序

```text
memory_bootstrap
  → 判断技能、项目、仓库、工具或文件作用域
  → memory_context(contract_version=2, scopes)
  → 必要时 memory_query 深读原文
  → 执行任务
  → memory_notify 通知文件变更
  → memory_log 显式写入作用域记忆
```

1. 进入 LifeOS Vault 会话时先调用 `memory_bootstrap`，只读取全局 Layer 0。
2. 完成任务路由后调用 `memory_context`。空作用域只会返回空局部上下文，不会加载全部记忆。
3. 需要笔记原文时再调用 `memory_query`；它检索 Vault 文件，不替代规则路由。
4. 除 bootstrap 外，所有请求都必须携带 `contract_version=2`。

## 最终工具表

| 工具 | 用途 |
| --- | --- |
| `memory_bootstrap` | 会话启动，只注入全局 Layer 0 |
| `memory_context` | 路由后按显式 scope 获取局部上下文 |
| `memory_query` | 深读 Vault 中已索引的文件 |
| `memory_log` | 写入显式 kind 与 scope 的持久记忆 |
| `memory_rules` | 按 kind、scope、status 或 slot 审计条目 |
| `memory_forget` | 按 item ID 软归档并记录原因 |
| `memory_notify` | 文件变化后更新索引与精准失效 |

治理或核查记忆时使用：

```text
memory_rules(
  contract_version=2,
  item_kind="rule",
  scope={type: "project", key: "gts-learning"},
  status="active",
  limit=100
)
```

## 作用域选择

| 用户语义 | scope | 典型内容 |
| --- | --- | --- |
| “所有回复都……” | `{type: "global", key: ""}` | 全局规则、全局画像 |
| “使用 revise 时……” | `{type: "skill", key: "revise"}` | 技能规则 |
| “在 GTS 项目里……” | `{type: "project", key: "<项目稳定 id>"}` | 项目规则、决策、画像 |
| “在 LifeOS 源码仓库……” | `{type: "repository", key: "lifeos"}` | 仓库规则、稳定事实 |
| “使用 Obsidian 时……” | `{type: "tool", key: "obsidian"}` | 工具规则 |
| “只对这份笔记……” | `{type: "file", key: "<笔记 id 或 Vault 相对路径>"}` | 单文件例外 |

- `project` 必须使用项目 frontmatter 的稳定 `id`，不能使用显示标题。
- `repository` 必须使用 `lifeos.yaml` 中已绑定的可移植仓库 ID，不能写绝对路径。
- 无法确定作用域时先确认，不得默认为 global。
- 项目架构和完整决策写回项目文档；memory 只保存短摘要及 `related_files`。

## 获取局部上下文

完成路由后调用：

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

`memory_context` 返回当前作用域的规则、决策、事实、关联文件和诊断信息。全局硬规则已由 bootstrap 注入，默认不要重复加载 global。

## 文件检索与变更通知

```text
memory_query(
  contract_version=2,
  query="<关键词>",
  filters={"type": "project"},
  limit=5
)

memory_notify(
  contract_version=2,
  file_path="<Vault 相对路径>"
)

# 移动或重命名文件时必须同时提供旧路径
memory_notify(
  contract_version=2,
  file_path="<新 Vault 相对路径>",
  previous_file_path="<旧 Vault 相对路径>"
)
```

创建、修改、移动或删除 Vault 文件后立即通知。移动或重命名时，`previous_file_path` 用于同步路径型 file scope 与 `related_files`。`fs.watch` 只是兜底；需要 read-after-write 时必须显式调用。

## 写入记忆

`memory_log` 只写持久的 `rule`、`decision`、`fact` 或 `profile`，并强制显式声明 scope 与 kind：

```text
memory_log(
  contract_version=2,
  slot_key="content:language",
  content="所有回复使用中文",
  scope={type: "global", key: ""},
  item_kind="rule",
  priority=100,
  enforcement="hard",
  source="correction"
)

memory_log(
  contract_version=2,
  slot_key="workflow:revise-latex",
  content="复习问答中不要用不安全的追加方式写入 LaTeX",
  scope={type: "skill", key: "revise"},
  item_kind="rule",
  related_files=["40_知识/笔记/相关章节.md"]
)
```

### 字段规则

- `slot_key` 使用 `<category>:<topic>`，只含 ASCII slug；同一 `(scope.type, scope.key, slot_key)` 才会覆盖。
- `item_kind`：`rule` 为持续行为约束；`decision` 为已确认决策摘要；`fact` 为稳定事实；`profile` 为用户画像。
- `priority` 为 0–100，默认 50；`enforcement` 为 `hard | soft`，默认 `soft`。
- 用户纠正行为时使用 `source="correction"`；后续 preference 写入不能降低 correction。
- `related_files` 保存证据或权威原文路径；`expires_at` 只用于确有期限的记忆。
- 一次性完成记录属于 event，不允许通过普通 `memory_log` 写入。
- 归档使用 `memory_forget(contract_version=2, item_id=..., reason="...")`，禁止硬删除。

### 规则捕获判断

下次对话仍需遵守的内容才写入：

- 用户纠正全局行为 → global rule。
- 用户限定某技能、项目、仓库、工具或文件 → 对应 scoped rule。
- 已确认的项目取舍 → project decision，并关联权威项目文档。
- 路径、工具配置等稳定信息 → repository/tool fact。
- 一次性讨论、可从代码或 Git 直接推导的信息、已写入配置的参数 → 不写。

## 画像槽位

常用结构化画像槽位：

- `profile:work_style`
- `profile:weak.<domain_slug>`
- `profile:strong.<domain_slug>`
- `profile:motivation.<project_slug>`
- `profile:context_switch_pattern`
- `profile:thinking_preference`

画像内容应包含事实、证据和决策影响。跨场景稳定画像可使用 global；只在单个项目成立的动机、强弱项使用 project scope。禁止写入已删除的综合画像槽位。

## 噪声防护

闲聊、一次性技术问答和与 Vault 无关的讨论不触发文件检索或局部上下文；但用户明确提出持久规则时，仍应按上述作用域协议写入。
