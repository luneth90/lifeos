# LifeOS 记忆协议 V2

本文是 LifeOS 当前唯一有效的记忆协议说明。运行时契约版本为 `contract_version=2`，数据库结构为 `Schema V4`。旧事件接口、会话日志接口和双结构兼容路径均已删除。

## 不变量

- MCP 固定暴露 7 个工具：`memory_bootstrap`、`memory_query`、`memory_context`、`memory_log`、`memory_rules`、`memory_forget`、`memory_notify`。
- `memory_bootstrap` 是唯一不接收 `contract_version` 的工具，也是唯一返回 `_layer0` 的工具。
- 其余 6 个工具必须显式传入 `contract_version=2`。版本不匹配时，运行时在打开 Vault、数据库或执行启动逻辑前拒绝请求。
- 运行时只接受 `Schema V4`，不会迁移旧数据库。`Schema V1`、`Schema V2`、`Schema V3` 只能通过离线 `lifeos upgrade` 升级到 `Schema V4`。
- Layer 0 只包含全局上下文，不包含 `skill`、`project`、`repository`、`tool` 或 `file` 作用域记忆。
- 局部上下文必须在任务路由完成后，通过 `memory_context` 和显式 `scopes` 获取。

## 七个 MCP 工具

| 工具 | 作用 | 必要约束 |
| --- | --- | --- |
| `memory_bootstrap` | 启动会话并返回全局 Layer 0、快照和可用 scope 提示 | 不传 `contract_version`；必须是会话第一步 |
| `memory_query` | 查询 Vault 索引中的笔记、项目和知识 | 必须传 `contract_version=2`；不查询记忆条目 |
| `memory_context` | 按显式 scope 读取局部规则、决策、事实和关联文件 | 必须传 `contract_version=2` 与 `scopes` |
| `memory_log` | 新建或更新规则、决策、事实、画像 | 必须传 `contract_version=2`、`slot_key`、`content`、`item_kind`、`scope` |
| `memory_rules` | 按类型、scope、状态或 slot 审计记忆条目 | 必须传 `contract_version=2` |
| `memory_forget` | 按 `item_id` 软归档条目 | 必须传 `contract_version=2` 与非空 `reason` |
| `memory_notify` | 通知单个 Vault 文件已创建、修改、移动或删除 | 必须传 `contract_version=2` 与 Vault 内相对路径 |

### 调用示例

```text
memory_bootstrap()

memory_query(contract_version=2, query="群论", filters={"type":"note","status":"review"}, limit=10)

memory_context(contract_version=2, scopes=[{"type":"project","key":"project-algebra"}], include_global=false, include_related_files=true)

memory_log(contract_version=2, slot_key="format:proof", content="证明先列出假设与目标", item_kind="rule", scope={"type":"project","key":"project-algebra"}, priority=80, enforcement="soft", source="preference")

memory_rules(contract_version=2, item_kind="rule", scope={"type":"global","key":""}, status="active", limit=100)

memory_forget(contract_version=2, item_id=42, reason="规则已被新约定替代")

memory_notify(contract_version=2, file_path="40_知识/笔记/群论.md")
```

`memory_log` 不接受 `item_kind="event"`。历史事件只能在离线升级时归档，或由治理命令把已归档条目重分类为 `event`；它不能恢复为有效记忆。

## 记忆条目模型

每个条目都必须显式声明：

- `slot_key`：格式为 `<类别>:<主题>`，仅使用小写 ASCII、数字、点、下划线和连字符。
- `item_kind`：`rule`、`decision`、`fact`、`profile`；`event` 仅用于已归档历史。
- `scope`：对象形式 `{"type":"...","key":"..."}`。
- `priority`：`0` 至 `100` 的整数，默认 `50`。
- `enforcement`：`hard` 或 `soft`，默认 `soft`。
- `source`：`preference` 或 `correction`，默认 `preference`；已有 `correction` 不会被普通偏好降级。
- `status`：`active`、`expired`、`archived`。

条目的稳定身份是 `(scope.type, scope.key, slot_key)`，`item_id` 用于治理操作。同一 `slot_key` 可以在不同 scope 中分别存在。

### Scope 类型

| 类型 | `key` 规则 |
| --- | --- |
| `global` | 必须是空字符串 |
| `skill` | 技能稳定名称，例如 `translate` |
| `project` | 项目 frontmatter 中非占位且唯一的稳定 `id` |
| `repository` | `lifeos.yaml` 的 `memory.repository_bindings` 中已声明的稳定名称 |
| `tool` | 工具稳定名称，例如 `obsidian-cli` |
| `file` | 优先使用索引中的稳定 `entity_id`，没有时使用 Vault 相对路径 |

## Layer 0 与局部上下文

新会话第一步必须调用 `memory_bootstrap()`。它只返回全局 Layer 0，包括全局规则、全局画像摘要、TaskBoard 当前焦点和复习提醒；不会注入任何局部 scope 记忆。

完成任务分类后，再调用 `memory_context`：

1. 显式传入当前任务需要的 `skill`、`project`、`repository`、`tool` 或 `file` scope。
2. 同一 slot 由更具体的 scope 生效，优先级为 `file > project > repository > skill > tool > global`。
3. 全局 `hard` 规则始终阻止局部同 slot 覆盖。
4. `memory_context` 只返回 `rule`、`decision`、`fact`；画像仍属于全局摘要链路。
5. 单条预算与总预算超限时，调用方必须检查诊断字段，不得假设全部条目已加载。

## 数据库与离线升级

运行时只打开 `Schema V4`。发现未版本化非空数据库或 `Schema V1`、`Schema V2`、`Schema V3` 时，会要求先执行升级，不会在 MCP 请求期间修改结构。

```bash
npm update -g lifeos
lifeos upgrade ./my-vault
lifeos doctor ./my-vault
```

存在旧记忆条目时，升级器先只读盘点数据库，并在内存中自动生成 `{system}/{memory}/migrations/v4-scope-map.json` 的完整计划。调用者不需要创建该文件，也不需要传 `--scope-map`。每条记录包含 `legacyIdentity`、内容 SHA-256、内容预览、建议 `scope`、候选作用域、`itemKind`、推断理由、`confirmed`、上下文指纹和生成条目哈希。高置信结果会在同一次命令中继续；歧义或未知条目只会生成审阅草案，并在安装资产和迁移数据库前停止。`migrations/` 仅是一次性迁移工作区：未完成时保留供审阅，成功提交最终数据库后删除整个目录；后续验证失败则由完整 cutover 恢复升级前内容，Vault 外部显式 scope map 不会被删除。

同一计划还会自动补齐项目和仓库身份：

- 正式项目缺少 `id` 时，按标题/文件名生成 ASCII slug，无法生成时使用稳定路径哈希；备份进入 `prepared` 后才原样写回项目 Markdown。
- 旧记忆明确包含源码或仓库绝对路径时，只沿该路径祖先验证安全 Git 根目录；不会扫描磁盘或按仓库名称猜目录。
- 只有最终 scope map 实际引用的高置信 repository 才写入 `memory.repository_bindings`；已有显式 binding 永不覆盖。
- 项目 ID、配置、scope map 和全部项目的 `vault_index.entity_id` 在数据库提交前交叉校验；失败时由 cutover 一起恢复。

无法唯一识别路径、仓库或作用域时才需要人工处理。手工配置示例：

```yaml
memory:
  repository_bindings:
    lifeos:
      - /Users/your-name/code/lifeos
```

`repository_bindings` 的每个值都必须是路径数组；同一稳定仓库名可绑定多个根目录。没有 repository 作用域的旧记忆时使用空对象：

```yaml
memory:
  repository_bindings: {}
```

```json
{
  "entries": [
    {
      "legacyIdentity": "slot:content:language",
      "contentHash": "<64 位 SHA-256>",
      "scope": { "type": "global", "key": "" },
      "itemKind": "rule",
      "priority": 100,
      "enforcement": "hard",
      "confirmed": true,
      "suggestionReason": "槽位属于已核验的全局规则集合"
    }
  ]
}
```

对有效但有歧义的建议，审阅后可执行 `lifeos upgrade ./my-vault --accept-scope-map`；该开关不会接受 `file:__REVIEW_REQUIRED__` 占位符，未知条目仍必须人工填写真实 scope。`--scope-map <file>` 仅用于覆盖默认审阅文件位置。

升级过程先以纯读方式形成计划；只有真正的歧义草案允许作为独立 preflight 诊断文件创建。高置信路径会取得外部写闸、重新盘点上下文、创建 Vault 外部备份和 cutover journal，进入 `prepared` 后才依次写项目 ID、最终配置、默认 scope map 与托管资产，随后迁移数据库、强制重索引全部正式项目、验证 `Schema V4`，最后写入运行时 receipt。任一步失败都会尝试恢复备份；自动恢复失败时写闸保持关闭，可执行 `lifeos upgrade ./my-vault --restore <journal>` 显式恢复。恢复会识别 staging/previous 残留并续接目录切换。数据库已是 V4 时不会再次消费旧 scope map 或重新自动发现 binding。`--override` 已删除，不能作为兼容入口使用。

## CLI 治理

```bash
lifeos rules list ./my-vault --scope global: --kind rule --status active
lifeos rules audit ./my-vault
lifeos rules export ./my-vault --output ./memory-export.json
lifeos rules classify ./my-vault --id 42 --scope-type project --scope-key project-algebra --kind decision
lifeos rules archive ./my-vault --id 42 --reason "已被新决策替代"
lifeos rules restore ./my-vault --id 42
```

- `list`、`audit`、`export` 是只读操作。
- `classify` 是显式治理入口，可修改 scope、`item_kind` 或 `slot_key`。
- `archive` 必须记录原因；`restore` 只恢复可恢复的非事件条目。
- `audit` 用于发现孤立的项目、文件和仓库 scope。

## 知识掌握状态

知识笔记的唯一状态链是：

```text
draft → review → revised → mastered
```

状态只升不降。`frozen` 项目及其关联知识笔记不进入 TaskBoard 焦点、活跃项目或复习链路。
