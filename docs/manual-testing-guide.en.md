# LifeOS V2 英文预设手工测试指南

本文件用于测试 `--lang en` 创建的目录预设；协议语义与 [记忆协议 V2](./memory-contract-v2.md) 完全一致。当前唯一组合是 `contract_version=2` 与 `Schema V4`。

## 1. 初始化

```bash
lifeos init ./tmp/lifeos-manual-test-en --lang en
lifeos doctor ./tmp/lifeos-manual-test-en
```

确认记忆数据库路径为 `90_System/Memory/memory.db`，且 MCP 只暴露以下 7 个工具：

1. `memory_bootstrap`
2. `memory_query`
3. `memory_context`
4. `memory_log`
5. `memory_rules`
6. `memory_forget`
7. `memory_notify`

## 2. 新会话与契约

第一步必须调用：

```text
memory_bootstrap()
```

它是唯一不传 `contract_version`、也是唯一返回 `_layer0` 的工具。Layer 0 只含全局信息，不得出现任何局部 scope 正文。

其余工具均需 `contract_version=2`：

```text
memory_rules(contract_version=2, status="active", limit=10)
```

省略版本或传入其他版本必须在打开 Vault 和数据库前失败。

## 3. 七工具主路径

```text
memory_notify(contract_version=2, file_path="20_Projects/Algebra.md")

memory_query(contract_version=2, query="algebra", filters={"type":"project","status":"active"}, limit=10)

memory_log(contract_version=2, slot_key="format:proof", content="证明需要完整步骤", item_kind="rule", scope={"type":"project","key":"project-algebra"}, priority=80, enforcement="soft")

memory_context(contract_version=2, scopes=[{"type":"project","key":"project-algebra"}], include_global=false, include_related_files=true)

memory_rules(contract_version=2, item_kind="rule", scope={"type":"project","key":"project-algebra"}, status="active")

memory_forget(contract_version=2, item_id=42, reason="手工测试软归档")
```

检查：

- `memory_log` 始终显式提供 `item_kind` 与 `scope`，且不能写入 `event`。
- 项目 scope 的 key 是唯一稳定项目 ID，不是标题或路径。
- 同一 slot 在不同 scope 中可独立存在。
- 全局 `hard` 规则阻止局部覆盖。
- `memory_query` 只查 Vault；`memory_rules` 只审计记忆。
- `memory_forget` 保留归档记录和非空原因。

## 4. CLI 治理

```bash
lifeos rules list ./tmp/lifeos-manual-test-en --status active
lifeos rules audit ./tmp/lifeos-manual-test-en
lifeos rules export ./tmp/lifeos-manual-test-en --output ./tmp/memory-export-en.json
lifeos rules classify ./tmp/lifeos-manual-test-en --id 42 --scope-type project --scope-key project-algebra --kind decision
lifeos rules archive ./tmp/lifeos-manual-test-en --id 42 --reason "已替代"
lifeos rules restore ./tmp/lifeos-manual-test-en --id 42
```

## 5. 数据库与状态

```bash
sqlite3 ./tmp/lifeos-manual-test-en/90_System/Memory/memory.db "SELECT version FROM schema_version;"
sqlite3 ./tmp/lifeos-manual-test-en/90_System/Memory/memory.db "SELECT item_id,slot_key,item_kind,scope_type,scope_key,status FROM memory_items;"
```

数据库必须是 `Schema V4`，且不存在旧会话日志表。知识笔记状态链固定为：

```text
draft → review → revised → mastered
```

## 6. 离线升级

运行时不会迁移旧结构。`Schema V1`、`Schema V2`、`Schema V3` 必须离线升级：

```bash
lifeos upgrade ./tmp/legacy-vault-en
lifeos doctor ./tmp/legacy-vault-en
```

确认升级器自动生成并写回缺失项目 ID，只从旧记忆中的明确源码绝对路径发现安全 Git 根，并只持久化最终使用的 repository binding；scope map 带上下文指纹，全部项目的 V4 `entity_id` 与 Markdown 一致且唯一；歧义建议在 cutover 前停止，审阅后可用 `--accept-scope-map` 接受，`file:__REVIEW_REQUIRED__` 必须人工填写；人工 map 不被覆盖；升级生成外部备份、cutover journal 和最终 runtime receipt；失败时同时恢复项目 Markdown、配置和数据库，也可用 `--restore <journal>` 显式恢复。`--override` 不存在。
