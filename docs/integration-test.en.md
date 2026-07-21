# LifeOS V2 英文预设集成测试指南

本文件验证 `--lang en` 目录预设；记忆语义仍以 [记忆协议 V2](./memory-contract-v2.md) 为唯一权威。

## 1. 初始化与构建

```bash
npm run typecheck
npm test
npm run build
lifeos init ./tmp/lifeos-integration-en --lang en
lifeos doctor ./tmp/lifeos-integration-en
```

确认 `lifeos.yaml` 使用 `contract_version: 2`，数据库路径为 `90_System/Memory/memory.db`，结构为 `Schema V4`。

## 2. MCP 工具清单

`tools/list` 必须恰好返回：

```text
memory_bootstrap
memory_query
memory_context
memory_log
memory_rules
memory_forget
memory_notify
```

`memory_bootstrap()` 是会话第一步、唯一不传 `contract_version` 且唯一返回 `_layer0` 的工具。Layer 0 只包含全局上下文。

其余调用均需 `contract_version=2`：

```text
memory_notify(contract_version=2, file_path="20_Projects/Algebra.md")
memory_query(contract_version=2, query="algebra", filters={"type":"project","status":"active"}, limit=10)
memory_log(contract_version=2, slot_key="format:proof", content="给出完整证明", item_kind="rule", scope={"type":"project","key":"project-algebra"})
memory_context(contract_version=2, scopes=[{"type":"project","key":"project-algebra"}], include_global=false)
memory_rules(contract_version=2, item_kind="rule", scope={"type":"project","key":"project-algebra"}, status="active")
memory_forget(contract_version=2, item_id=42, reason="集成测试归档")
```

检查所有 `memory_log` 调用显式传入 `item_kind` 和 `scope`，且 `event` 写入被拒绝。

## 3. 作用域与路由

英文预设项目文件仍必须提供唯一稳定 ID：

```yaml
id: project-algebra
type: project
status: active
```

确认：

- `memory_query` 返回稳定 `entityId`，但不返回记忆规则。
- `memory_context` 只返回请求 scope 的规则、决策和事实。
- 优先级为 `file > project > repository > skill > tool > global`。
- 全局 `hard` 规则禁止局部同 slot 覆盖。
- 同一 slot 可在不同 scope 中分别存在。

## 4. CLI 治理

```bash
lifeos rules list ./tmp/lifeos-integration-en --status active
lifeos rules audit ./tmp/lifeos-integration-en
lifeos rules export ./tmp/lifeos-integration-en --output ./tmp/lifeos-memory-en.json
lifeos rules classify ./tmp/lifeos-integration-en --id 42 --scope-type project --scope-key project-algebra --kind fact
lifeos rules archive ./tmp/lifeos-integration-en --id 42 --reason "已替代"
lifeos rules restore ./tmp/lifeos-integration-en --id 42
```

## 5. 离线升级矩阵

`Schema V1`、`Schema V2`、`Schema V3` 只能通过离线命令升级：

```bash
lifeos upgrade ./tmp/legacy-vault-en
lifeos doctor ./tmp/legacy-vault-en
```

确认 runtime 在升级前拒绝旧结构；升级器自动补齐缺失项目 ID 并原样写回 Markdown，从旧记忆中的明确源码路径发现最终实际使用的 repository binding，再自动生成带上下文指纹的 scope map；全部正式项目的 V4 `entity_id` 与 Markdown 一致且唯一；歧义结果在 cutover 前停止，审阅后可用 `--accept-scope-map` 接受有效建议，但不能接受 `file:__REVIEW_REQUIRED__`；人工编辑和显式 map 不被覆盖；成功后只剩 `Schema V4`；外部备份、cutover journal 和 `opened` receipt 完整；故障注入会同时恢复项目 Markdown、配置和数据库，`--restore <journal>` 可显式恢复；`--override` 被拒绝。

## 6. active docs 与知识状态

- `TaskBoard.md` 只含 `focus`、`active-projects`、`revises`。
- `UserProfile.md` 只含 `profile-summary`、`global-rules`、`scoped-rules-index`。
- 知识状态固定为 `draft → review → revised → mastered`。
- `frozen` 项目及其关联笔记不进入焦点、活跃项目或复习链路。
