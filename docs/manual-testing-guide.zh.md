# LifeOS V2 手工测试指南

本指南验证当前唯一支持的最终协议：`contract_version=2`、`Schema V4`、7 个 MCP 工具。不要使用旧事件接口或依赖运行时迁移。

协议字段与治理规则以 [记忆协议 V2](./memory-contract-v2.md) 为准。

## 1. 准备隔离 Vault

```bash
npm run build
lifeos init ./tmp/lifeos-manual-test --lang zh
lifeos doctor ./tmp/lifeos-manual-test
```

预期：

- `lifeos.yaml` 中 `memory.contract_version` 为 `2`。
- 新数据库首次打开后为 `Schema V4`。
- `doctor` 不报告 runtime receipt、项目 ID、scope 或托管资产错误。

## 2. 确认工具集合

客户端的 MCP 工具列表必须恰好包含：

1. `memory_bootstrap`
2. `memory_query`
3. `memory_context`
4. `memory_log`
5. `memory_rules`
6. `memory_forget`
7. `memory_notify`

如果出现其他 LifeOS 记忆工具，说明客户端仍连接旧服务，应先重启客户端并检查 MCP 配置。

## 3. 验证 bootstrap 与 Layer 0

新会话的第一步调用：

```text
memory_bootstrap()
```

检查：

- 返回 `contract_version: 2`、`schema_version: 4`、`status: "ok"`。
- 返回 `_layer0`、`snapshot_id`、`layer0_meta`、`scope_hints`。
- Layer 0 只含全局规则、全局画像摘要、TaskBoard 焦点与复习提醒。
- Layer 0 不包含任何项目、技能、仓库、工具或文件 scope 的正文。
- 第二次调用保持幂等；没有全局变化时不重复执行完整启动维护。

## 4. 验证契约前置拒绝

任选一个非 bootstrap 工具，省略 `contract_version` 或传入其他版本。

预期：请求在打开 Vault、数据库或执行启动逻辑前失败。随后使用正确版本：

```text
memory_rules(contract_version=2, status="active", limit=10)
```

预期：正常返回条目列表。

## 5. 验证显式记忆模型

### 5.1 写入全局硬规则

```text
memory_log(contract_version=2, slot_key="content:language", content="必须使用中文", item_kind="rule", scope={"type":"global","key":""}, priority=100, enforcement="hard", source="correction")
```

检查返回条目具有稳定 `itemId`，且 `action` 为 `created` 或 `updated`。

### 5.2 写入项目局部规则

先确保项目 frontmatter 有唯一、非占位的稳定 ID，例如：

```yaml
id: project-algebra
type: project
status: active
```

通知索引器后写入：

```text
memory_notify(contract_version=2, file_path="20_项目/代数学习.md")
memory_log(contract_version=2, slot_key="format:proof", content="给出完整证明步骤", item_kind="rule", scope={"type":"project","key":"project-algebra"}, priority=80, enforcement="soft")
```

### 5.3 写入决策、事实与画像

```text
memory_log(contract_version=2, slot_key="decision:notation", content="本项目采用右作用记号", item_kind="decision", scope={"type":"project","key":"project-algebra"})
memory_log(contract_version=2, slot_key="fact:source", content="主教材是群论讲义", item_kind="fact", scope={"type":"project","key":"project-algebra"}, related_files=["70_资源/书籍/群论讲义.pdf"])
memory_log(contract_version=2, slot_key="profile:thinking_preference", content="偏好先看结构再看细节", item_kind="profile", scope={"type":"global","key":""})
```

负向检查：用 `memory_log` 写入 `item_kind="event"` 必须失败。

## 6. 验证 scoped context

```text
memory_context(contract_version=2, scopes=[{"type":"project","key":"project-algebra"}], include_global=false, include_related_files=true)
```

检查：

- 返回项目 scope 中的 `rule`、`decision`、`fact`。
- 不返回 `profile` 或历史 `event`。
- `matchedScopes` 使用稳定项目 ID，而不是项目标题。
- `relatedFiles` 去重并排序。
- 全局同 slot 的 `hard` 规则会阻止局部覆盖，并在诊断中说明。
- `omittedSlotKeys`、`oversizedItems` 和 `warnings` 可用于判断预算裁剪。

再创建文件 scope 的同 slot 规则并同时请求项目和文件 scope，确认优先级遵循：

```text
file > project > repository > skill > tool > global
```

## 7. 验证查询职责分离

创建一篇带 frontmatter 的测试笔记并通知：

```text
memory_notify(contract_version=2, file_path="40_知识/笔记/群论.md")
memory_query(contract_version=2, query="群论", filters={"type":"note","status":"review"}, limit=10)
```

检查：

- `memory_query` 只返回 Vault 索引结果和稳定 `entityId`。
- `memory_query` 不返回记忆规则；记忆审计必须使用 `memory_rules`。
- 不支持的过滤字段会被拒绝。

## 8. 验证审计与遗忘

```text
memory_rules(contract_version=2, item_kind="rule", scope={"type":"project","key":"project-algebra"}, status="active", limit=100)
memory_forget(contract_version=2, item_id=<上一步返回的 itemId>, reason="测试软归档")
memory_rules(contract_version=2, scope={"type":"project","key":"project-algebra"}, status="archived", limit=100)
```

检查：

- `memory_forget` 不物理删除记录。
- 归档记录具有时间和非空原因。
- 普通 `memory_log` 不能直接覆盖已归档条目。

## 9. 验证 CLI 治理

```bash
lifeos rules list ./tmp/lifeos-manual-test --status active
lifeos rules audit ./tmp/lifeos-manual-test
lifeos rules export ./tmp/lifeos-manual-test --output ./tmp/memory-export.json
lifeos rules archive ./tmp/lifeos-manual-test --id 42 --reason "手工测试"
lifeos rules restore ./tmp/lifeos-manual-test --id 42
```

需要显式重分类时：

```bash
lifeos rules classify ./tmp/lifeos-manual-test --id 42 --scope-type project --scope-key project-algebra --kind decision
```

## 10. 验证数据库最终态

```bash
sqlite3 ./tmp/lifeos-manual-test/90_系统/记忆/memory.db "SELECT version FROM schema_version;"
sqlite3 ./tmp/lifeos-manual-test/90_系统/记忆/memory.db "PRAGMA table_info(memory_items);"
sqlite3 ./tmp/lifeos-manual-test/90_系统/记忆/memory.db "SELECT item_id,slot_key,item_kind,scope_type,scope_key,status FROM memory_items ORDER BY item_id;"
```

预期：

- 版本只有 `4`。
- `memory_items` 包含 `item_id`、`item_kind`、`scope_type`、`scope_key`、优先级、强制级别和归档元数据。
- 不存在旧会话日志表和旧事件检索表。

## 11. 验证知识状态链

知识笔记只允许按以下方向推进：

```text
draft → review → revised → mastered
```

检查 TaskBoard：`frozen` 项目及其关联笔记不出现在焦点、活跃项目或复习候选中。

## 12. 验证旧数据库离线升级

对副本中的 `Schema V1`、`Schema V2` 或 `Schema V3` 数据库执行：

```bash
lifeos upgrade ./tmp/legacy-vault --scope-map ./tmp/v4-scope-map.json
lifeos doctor ./tmp/legacy-vault
```

检查：

- MCP runtime 在升级前拒绝打开旧数据库。
- scope map 覆盖每条旧记忆，内容哈希匹配，项目和仓库 scope 可解析。
- 升级完成后只有 `Schema V4`，runtime receipt 状态为 `opened`。
- cutover journal 与 Vault 外部备份存在。
- 人为制造迁移失败时，Vault 自动恢复；不存在运行时兼容分支。
