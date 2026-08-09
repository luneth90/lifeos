# LifeOS 记忆协议 V2

本文是 LifeOS 当前唯一有效的记忆协议说明。运行时契约版本为 `contract_version=2`，数据库结构为 `Schema V5`。旧会话日志接口和双结构兼容路径均已删除；变更历史由当前投影的追加式事件日志提供。

## 不变量

- MCP 固定暴露 8 个工具：`memory_bootstrap`、`memory_query`、`memory_context`、`memory_log`、`memory_rules`、`memory_history`、`memory_forget`、`memory_notify`。隐私清除命令不通过 MCP 暴露。
- `memory_bootstrap` 是唯一不接收 `contract_version` 的工具，也是唯一返回 `_layer0` 的工具。
- 其余 7 个工具必须显式传入 `contract_version=2`。版本不匹配时，运行时在打开 Vault、数据库或执行启动逻辑前拒绝请求。
- 运行时只接受 `Schema V5`，不会迁移旧数据库。`Schema V1` 至 `Schema V4` 只能通过离线 `lifeos upgrade` 升级到 `Schema V5`。
- Layer 0 只包含全局上下文，不包含 `skill`、`project`、`repository`、`tool` 或 `file` 作用域记忆。
- 局部上下文必须在任务路由完成后，通过 `memory_context` 和显式 `scopes` 获取。

## MCP 结果格式

八个工具都声明了严格的 `outputSchema`。成功调用优先从 `structuredContent` 读取机器可解析结果；`content[0].text` 继续提供 JSON 文本兼容层，供尚未读取结构化结果的客户端使用。服务端从同一份 JSON 序列化值生成两条路径，因此始终满足：

```text
structuredContent == JSON.parse(content[0].text)
```

工具自身捕获的启动错误仍保持既有 `{ "status": "error", "startup_error": "..." }` 结果语义，并同时出现在结构化与文本路径中。MCP SDK 在输入模式校验失败或 handler 抛出异常时仍返回 `isError=true` 的协议错误；该路径保留 SDK 的纯文本错误格式，不伪装成工具成功结果，也不受工具 `outputSchema` 校验。

## 八个 MCP 工具

| 工具 | 作用 | 必要约束 |
| --- | --- | --- |
| `memory_bootstrap` | 启动会话并返回全局 Layer 0、快照和可用 scope 提示 | 不传 `contract_version`；必须是会话第一步 |
| `memory_query` | 查询 Vault 索引中的笔记、项目和知识 | 必须传 `contract_version=2`；不查询记忆条目 |
| `memory_context` | 按显式 scope 读取局部规则、决策、事实、画像和关联文件 | 必须传 `contract_version=2` 与 `scopes` |
| `memory_log` | 新建或更新规则、决策、事实、画像 | 必须传 `contract_version=2`、`slot_key`、`content`、`item_kind`、`scope` |
| `memory_rules` | 按类型、scope、状态或 slot 审计记忆条目 | 必须传 `contract_version=2` |
| `memory_history` | 按条目 ID 读取完整变更历史 | 必须传 `contract_version=2`、正整数 `item_id`；`limit` 默认为 50，范围为 1–100 |
| `memory_forget` | 按 `item_id` 软归档条目 | 必须传 `contract_version=2` 与非空 `reason` |
| `memory_notify` | 通知单个 Vault 文件已创建、修改、移动或删除 | 必须传 `contract_version=2` 与 Vault 内相对路径 |

### 调用示例

```text
memory_bootstrap()

memory_query(contract_version=2, query="群论", filters={"type":"note","status":"review"}, limit=10)

memory_context(contract_version=2, scopes=[{"type":"project","key":"project-algebra"}], include_global=false, include_related_files=true)

memory_log(contract_version=2, slot_key="format:proof", content="证明先列出假设与目标", item_kind="rule", scope={"type":"project","key":"project-algebra"}, priority=80, enforcement="soft", source="preference")

memory_rules(contract_version=2, item_kind="rule", scope={"type":"global","key":""}, status="active", limit=100)

memory_history(contract_version=2, item_id=42, limit=50)

memory_forget(contract_version=2, item_id=42, reason="规则已被新约定替代")

memory_notify(contract_version=2, file_path="40_知识/笔记/群论.md")
```

### `memory_query` 排名与证据

`memory_query.results[]` 保留原有 `score`，并固定暴露以下可审计字段：

| 字段 | 语义 |
| --- | --- |
| `score` | 兼容展示分数，由命中来源与命中字段计算；不参与结果排序 |
| `rankScore` | FTS 路径实际使用的 `bm25(vault_fts, 0, 4, 3, 10, 2)` 原始值，低值优先；LIKE 与纯过滤路径没有 BM25，固定为 `null` |
| `rankPosition` | 所有过滤、候选合并、去重、稳定排序与截断完成后的 1 基输出位置 |
| `rankExplanation` | 结构化记录排名来源及本结果实际使用的排序键、方向和值，不生成推测性理由 |
| `evidence` | 仅从当前结果的真实索引字段提取的确定性短证据 |

FTS SQL 固定按 `rank_score ASC, modified_at DESC, file_path ASC` 排序。中文查询触发
FTS 与 LIKE 候选合并时，有真实 BM25 的 FTS 候选排在 `rankScore=null` 的 LIKE 候选之前；
同类候选继续按修改时间降序、文件路径升序排列。纯 LIKE 或纯过滤查询只使用修改时间与路径；
按显式路径列表查询时，解释来源为 `requested_order`，位置遵循输入路径顺序。

`rankExplanation.rankSource` 只可能是：

- `vault_fts_bm25`：`rankScore` 来自本次 FTS SQL 的真实 BM25；
- `deterministic_fallback`：当前路径不存在 BM25，使用确定性备用排序；
- `requested_order`：内部精确路径查询保持调用方输入顺序。

证据字段优先级固定为 `title`、`summary`、`search_hints`、`tags`。每条证据包含
`field`、`snippet`、`matchedTerms` 与 `sourcePath`；`snippet` 最长 160 个字符，必须包含
至少一个实际命中词，`sourcePath` 必须与结果的 `filePath` 一致。`aliases`、正文、反向链接等
未参与该证据契约的内容不会进入证据。若查询词只跨字段组合命中、任何单一字段都无法生成
可追溯片段，则返回空 `evidence`，不会补写理由。

```json
{
  "score": 490,
  "rankScore": -1.25,
  "rankPosition": 1,
  "rankExplanation": {
    "rankSource": "vault_fts_bm25",
    "sortKeys": [
      { "field": "rankScore", "direction": "asc", "value": -1.25 },
      { "field": "modifiedAt", "direction": "desc", "value": "2026-08-09T00:00:00.000Z" },
      { "field": "filePath", "direction": "asc", "value": "40_知识/笔记/群论.md" }
    ]
  },
  "evidence": [
    {
      "field": "title",
      "snippet": "群论",
      "matchedTerms": ["群论"],
      "sourcePath": "40_知识/笔记/群论.md"
    }
  ]
}
```

`memory_log` 不接受 `item_kind="event"`。历史事件只能在离线升级时归档，或由治理命令把已归档条目重分类为 `event`；它不能恢复为有效记忆。

## 变更历史与隐私

`memory_items` 是当前状态投影；`memory_item_events` 是该投影的追加式变更日志。正常路径中的 `create`、`update`、`archive`、`restore`、`reclassify` 和 `expire` 都在同一数据库事务内先后更新投影并追加事件：任一步失败，投影和事件一起回滚，不会留下半次变更。除下述显式隐私清除外，事件不可更新或删除。

事件按 `occurred_at ASC, event_id ASC` 返回，时间相同也有稳定顺序。每条事件包含 `event_id`、`item_id`、`event_type`、`before`、`after`、`reason`、`actor`、`occurred_at`、`contract_version` 和 `correlation_id`。`baseline_snapshot` 与 `create` 的 `before` 固定为 `null`，其余事件同时保留前后投影。`actor` 与 `correlation_id` 只记录稳定调用来源和关联标识；请求原文、提示词和未显式传入的理由不得写入事件。

`memory_history` 只接受存在的正整数 `item_id`，未知条目会失败，不会返回空结果来掩盖错误。它不接受任意过滤或跨条目扫描，也不提供删除能力。

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
| `tool` | 工具稳定名称，例如 `obsidian`；命令或技能别名由 `memory.tool_bindings` 映射 |
| `file` | 优先使用索引中的稳定 `entity_id`，没有时使用 Vault 相对路径 |

## Layer 0 与局部上下文

新会话第一步必须调用 `memory_bootstrap()`。它只返回全局 Layer 0，包括全局规则、全局画像摘要、TaskBoard 当前焦点和复习提醒；不会注入任何局部 scope 记忆。

`memory_bootstrap()` 的 `scope_hints.available_tools` 列出存在活跃记忆的工具作用域，`scope_hints.tool_bindings` 提供命令名或技能名到稳定工具 ID 的映射。它们只用于路由，不包含工具规则正文。`memory_context` 会按该配置规范化工具别名；若同一别名匹配多个工具，则返回 `ambiguous_tool_alias`，不会猜测。

完成任务分类后，再调用 `memory_context`：

1. 显式传入当前任务需要的 `skill`、`project`、`repository`、`tool` 或 `file` scope。
2. 同一 slot 由更具体的 scope 生效，优先级为 `file > project > repository > skill > tool > global`。
3. 全局 `hard` 规则始终阻止局部同 slot 覆盖。
4. `memory_context` 只读取本次显式声明的非 global scope 画像，画像同时进入结构化 `profiles` 与正文“作用域画像”区块；相关文件、目录提示、缓存或其他 scope 不会扩大画像读取范围。
5. global 画像只由 `UserProfile` 聚合进入 Layer 0。即使设置 `include_global=true` 或显式请求 global scope，也不会把 global 画像放入 `profiles` 或局部正文。
6. 单条预算与总预算超限时，调用方必须检查诊断字段，不得假设全部条目已加载；画像与规则、决策、事实使用同一优先级、稳定排序和裁剪规则。
7. 若任务执行途中新增了 scope，必须在首次使用对应对象前增量调用 `memory_context`；首次调用形成的作用域集合不是固定快照。

工具别名配置示例：

```yaml
memory:
  tool_bindings:
    obsidian:
      commands: [obsidian]
      skills: [obsidian-cli]
```

## 数据库与离线升级

运行时只打开 `Schema V5`。发现未版本化非空数据库或 `Schema V1` 至 `Schema V4` 时，会要求先执行升级，不会在 MCP 请求期间修改结构。

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

升级过程先以纯读方式形成计划；只有真正的歧义草案允许作为独立 preflight 诊断文件创建。高置信路径会取得外部写闸、重新盘点上下文、创建 Vault 外部备份和 cutover journal，进入 `prepared` 后才依次写项目 ID、最终配置、默认 scope map 与托管资产，随后按 `V1–V3 → V4 → V5` 或 `V4 → V5` 迁移数据库、强制重索引全部正式项目、验证 `Schema V5`，最后写入运行时 receipt。任一步失败都会尝试恢复备份；自动恢复失败时写闸保持关闭，可执行 `lifeos upgrade ./my-vault --restore <journal>` 显式恢复。恢复会识别 staging/previous 残留并续接目录切换。源运行时 receipt 只接受 Schema 4 或 5，目标 journal 固定为 Schema 5；恢复历史 V4 备份时会原样恢复 Schema V4 数据库与 receipt。数据库已是 V5 时不会再次消费旧 scope map、重新自动发现 binding 或重复写 baseline。`--override` 已删除，不能作为兼容入口使用。

V4 升级到 V5 时，升级器在同一个排他事务内建立事件表，并为当时的每个投影写入恰好一个 `baseline_snapshot`。快照 JSON 的键顺序固定，时间使用升级 journal 的迁移时间，重复执行迁移不会生成重复 baseline。该 baseline 只陈述升级时可证明的当前状态，不伪造升级前的历史。事件写入、结构验证或版本更新任一步失败都会回滚到完整 V4。

## CLI 治理

```bash
lifeos rules list ./my-vault --scope global: --kind rule --status active
lifeos rules audit ./my-vault
lifeos rules export ./my-vault --output ./memory-export.json
lifeos rules classify ./my-vault --id 42 --scope-type project --scope-key project-algebra --kind decision
lifeos rules archive ./my-vault --id 42 --reason "已被新决策替代"
lifeos rules restore ./my-vault --id 42
lifeos rules purge ./my-vault --item-id 42 --confirm-item-id 42 --reason "用户要求清除该条隐私记忆"
```

- `list`、`audit`、`export` 是只读操作。
- `classify` 是显式治理入口，可修改 scope、`item_kind` 或 `slot_key`。
- `archive` 必须记录原因；`restore` 只恢复可恢复的非事件条目。
- `audit` 用于发现孤立的项目、文件和仓库 scope。
- `purge` 是唯一的显式隐私删除例外，不属于 MCP 工具。它只接受已归档条目，要求 `--item-id` 与 `--confirm-item-id` 完全一致且理由非空；旧 `--id` 参数会被拒绝。
- `purge` 先创建并校验可独立打开的 SQLite 备份，再开启删除事务，同时删除该条投影和全部关联事件。备份失败、备份校验失败、状态或事件数在备份后变化、删除失败都会安全失败，不产生部分删除。成功结果返回备份路径，恢复时以该备份为证据源；删除后的数据库不会再追加一条泄露被删除内容的 purge 事件。

## 知识掌握状态

知识笔记的唯一状态链是：

```text
draft → review → revised → mastered
```

状态只升不降。`frozen` 项目及其关联知识笔记不进入 TaskBoard 焦点、活跃项目或复习链路。

## 长期记忆检索评测基准

固定评测夹具位于 `tests/fixtures/memory-retrieval-eval.zh.json`，当前版本为
`2026-08-09.v1`。夹具包含 61 篇临时文档和 42 个不重复的中文查询，用例类别与数量固定为：

| 类别 | 数量 | 评测重点 |
| --- | ---: | --- |
| `direct_extraction` | 8 | 单文档直接信息提取 |
| `multi_document` | 6 | 同一问题的多文档召回 |
| `temporal_update` | 6 | 新版本覆盖陈旧版本 |
| `conflict_override` | 6 | 更具体作用域规则覆盖全局规则 |
| `scope_isolation` | 6 | 显式过滤下的项目作用域隔离 |
| `abstention` | 5 | 无证据时返回空结果 |
| `long_tail` | 5 | 唯一出现在正文第 4000 字符之后的尾部证据 |

每个 `RetrievalEvalCase` 必须包含稳定 `id`、`query`、`filters`、`expectedFiles`、
`forbiddenFiles`、`expectedScopes`、`timeCondition` 与 `shouldAbstain`。运行时使用 Zod
校验字段类型、未知字段、时间格式、唯一 id、唯一查询、文件引用、期望/禁止文件互斥及类别语义。
`temporal_update` 必须同时声明时间条件和合法生产过滤器；`abstention` 必须声明拒答；
`long_tail` 只能有一个期望文件；`conflict_override` 与 `scope_isolation` 必须使用
`file_path`、`project` 或 `entity_id` 等生产作用域过滤字段。夹具中的 `tailEvidence.offset`
用于生成固定长文，查询文本在正文中仅出现一次且偏移必须大于 4000。

评测器分为两层：`evaluateRetrieval` 只根据手工排名观察值计算指标；
`runMemoryRetrievalEvaluation` 把固定语料写入临时 Vault，调用生产 `fullScan` 和
`queryVaultIndex`，不复制或改写生产排序逻辑。拒答只按生产检索返回空结果判定，不引入回答模型。
临时数据库和 Markdown 在每次运行结束后删除，报告只在进程内返回，不读写生产 Vault。
作用域评分从临时生产 `vault_index` 的 `project`、`entity_id` 与 `file_path` 推导，
不信任夹具文档的 `scope` 自报值。时间、冲突和隔离约束通过 `queryVaultIndex` 的合法
`filters` 传入生产检索，自报 scope 与事后评分不能替代生产输入约束。

### 指标、分母与空集合语义

设 $C_r$ 为 `expectedFiles` 非空的用例集合，$R_c@k$ 为用例 $c$ 的前 $k$ 个返回文件，
$E_c$ 为其期望文件集合：

- `Recall@5`：$\frac{1}{|C_r|}\sum_{c\in C_r}\frac{|R_c@5\cap E_c|}{|E_c|}$。
  无相关用例时取 $1$；期望文件非空但无结果时，该用例取 $0$。
- `MRR@10`：对 $C_r$ 做宏平均；首个期望文件在前十名中的名次为 $r$ 时取 $1/r$，
  未命中取 $0$。无相关用例时取 $1$。
- `abstentionAccuracy`：`results.length === 0` 与 `shouldAbstain` 相等的用例数除以全部用例数；
  无用例时取 $1$。
- `scopeLeakageRate`：声明了 `expectedScopes` 的用例中，不属于任一期望作用域的返回结果数，
  除以这些用例的全部返回结果数；分母为零时取 $0$。
- `staleHitRate`：声明了 `timeCondition.notBefore` 的用例中，`modifiedAt` 缺失或早于该时刻的
  返回结果数，除以这些用例的全部返回结果数；分母为零时取 $0$。
- `forbiddenHitRate`：命中本用例 `forbiddenFiles` 的结果数，除以仅限
  `forbiddenFiles.length > 0` 用例的全部返回结果数；该分母为零时取 $0$。
- `averageContextTokens`：每个结果按生产 `estimateTokens(title + "\\n" + displaySummary)` 估算，
  全部结果的 token 和除以全部用例数；无用例时取 $0$。
- 本机耗时记录 `averageMs`、`p50Ms`、`p95Ms`。分位数采用排序后的 nearest-rank 规则；
  无用例时三者均为 $0$。耗时只用于本机基线观察，不设跨机器失败门槛。

固定门槛为：`Recall@5 >= 0.90`、`MRR@10 >= 0.85`、
`abstentionAccuracy >= 0.90`、`scopeLeakageRate = 0`、`staleHitRate = 0`。
夹具同时要求 `forbiddenHitRate = 0`，用于确保明确禁止文件不会被其他平均指标掩盖。

### 报告与确定性

报告包含 `fixture`、`metrics`、`timings`、`denominators`、`thresholds`、`passed`、
`categoryReports` 与每个用例的 `rankings`。`categoryReports.long_tail` 是长文尾部证据的独立子集指标。
稳定 JSON 序列化会递归按键名排序；确定性比较把所有 `timings` 归一化为零，其余字段必须逐字节一致。
固定入口为：

```bash
npm run test:memory-eval
```

真实执行器测试另有普通防退化断言：固定 42 条排名，并约束全局 Recall、MRR、拒答准确率、
长文 Recall 的下界，以及作用域泄漏、陈旧命中和禁止命中的上界。普通断言确保全空结果、
长文全部丢失或风险指标恶化会立即失败，不能由 expected fail 吞掉。当前固定夹具已达到全部门槛，
因此不使用 expected fail；后续任务只能在保持这些普通边界通过的前提下改善生产检索。

### Schema V6 分段检索 Go/No-Go 快照

- 评测与复核日期：2026-08-09。
- Git 基线：`4ff7fe8c4088ce0818fd7d1ffd056f4c61474a67`（Schema V5）。
- 固定夹具：`tests/fixtures/memory-retrieval-eval.zh.json`，版本 `2026-08-09.v1`，
  61 篇文档、42 个用例。
- 新鲜评测命令：在上述基线连续执行两次 `npm run test:memory-eval`；两次均为
  1 个测试文件、13 个测试通过，除本机耗时外的报告一致。

决策子集只包含唯一证据首次出现在正文第 4000 字符之后的 5 个 `long_tail` 用例。
偏移由测试直接对正文执行 `body.indexOf(query)` 计算，并以 `lastIndexOf(query)` 验证只出现一次，
不依赖 `tailEvidence.offset` 自报值：

| case id | 唯一期望文件 | 唯一证据首次偏移 |
| --- | --- | ---: |
| `long-tail-01` | `40_知识/长文/天文观测.md` | 4101 |
| `long-tail-02` | `40_知识/长文/陶瓷烧制.md` | 4201 |
| `long-tail-03` | `40_知识/长文/湿地调查.md` | 4301 |
| `long-tail-04` | `40_知识/长文/古琴修复.md` | 4401 |
| `long-tail-05` | `40_知识/长文/冰芯运输.md` | 4501 |

Schema V5 的新鲜全局指标为：`Recall@5=1.0`、`MRR@10=1.0`、
`abstentionAccuracy=1.0`、`scopeLeakageRate=0`、`staleHitRate=0`、
`forbiddenHitRate=0`、`averageContextTokens=55.45238095238095`。长文子集指标为：
`Recall@5=1.0`、`MRR@10=1.0`、`abstentionAccuracy=1.0`、`scopeLeakageRate=0`、
`staleHitRate=0`、`forbiddenHitRate=0`、`averageContextTokens=158.6`；相关用例分母为 5。

分段检索的 Go 门槛是长文子集 `Recall@5 < 0.90`。本次实测为 `1.0`，因此结论为
**No-Go：当前不实施 Schema V6 分段检索**。该结论只说明 Schema V5 已满足当前量化门槛，
不构成永久否决；不创建 `vault_sections`、分段 FTS、V6 migration、分段索引或生产检索逻辑。
评测回归固定上述夹具版本、5 个 case id、唯一期望文件、正文实算偏移与 `0.90` 门槛；
未来长文 `Recall@5` 跌破门槛时测试会失败，并强制重新评审 Go/No-Go。

夹具版本、生产索引或检索排序逻辑、指标定义或 `0.90` 门槛发生变化时，在相关变更合入前
重新执行本节完整取证流程，并以新基线日期、HEAD、偏移和指标替换本快照。
