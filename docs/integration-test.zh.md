# LifeOS V2 集成测试指南

本指南验证 CLI、MCP server、Vault、SQLite 和 Agent 资产是否共同遵守最终协议。权威字段定义见 [记忆协议 V2](./memory-contract-v2.md)。

## 1. 发布前自动检查

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm pack --dry-run
```

所有检查必须在干净工作树和 Node.js 最低支持版本上通过。

## 2. 新 Vault 集成

```bash
lifeos init ./tmp/lifeos-integration --lang zh
lifeos doctor ./tmp/lifeos-integration
```

检查：

- 目录、模板、规范、技能和客户端 MCP 配置完整。
- `lifeos.yaml` 中 `memory.contract_version: 2`。
- 新安装写入 `contract_version: 2`、`schema_version: 4`、`state: opened` 的 runtime receipt。
- 新数据库为 `Schema V4`，没有旧会话日志或旧事件表。
- 项目模板的 ID 是占位符，真实项目必须在创建时换成唯一稳定 ID。

## 3. 客户端配置

验证以下配置均把当前 Vault 根目录传给同一个 LifeOS MCP server：

| 客户端 | 配置文件 |
| --- | --- |
| Claude Code | `.mcp.json` |
| Codex | `.codex/config.toml` |
| OpenCode | `opencode.json` |
| Antigravity CLI | `.agents/mcp_config.json` |

分别启动客户端，确认不会连接旧的全局 LifeOS 服务实例。

## 4. 原始 MCP 握手

```bash
{
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"lifeos-test","version":"1"}}}'
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
} | node ./dist/server.js --vault-root ./tmp/lifeos-integration
```

`tools/list` 必须恰好列出：

```text
memory_bootstrap
memory_query
memory_context
memory_log
memory_rules
memory_forget
memory_notify
```

不得出现第 8 个 LifeOS 记忆工具。

## 5. bootstrap 边界

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"memory_bootstrap","arguments":{"vault_root":"./tmp/lifeos-integration"}}}' | node ./dist/server.js
```

检查：

- `memory_bootstrap` 不要求 `contract_version`。
- 响应包含 `_layer0`、`snapshot_id`、`layer0_meta` 与 `scope_hints`。
- `_layer0` 只含全局规则、全局画像摘要、TaskBoard 焦点和复习提醒。
- 后续任意其他工具响应都不附带 `_layer0`。
- 首次快速启动不执行全量扫描或 active docs 重写；后台维护负责这些工作。

## 6. 非 bootstrap 契约门禁

对 `memory_query`、`memory_context`、`memory_log`、`memory_rules`、`memory_forget`、`memory_notify` 分别执行：

1. 省略 `contract_version`。
2. 传入非 `2` 的值。
3. 传入 `contract_version=2`。

前两种必须在 Vault、数据库和 startup 之前失败；第三种才能进入业务逻辑。

## 7. 端到端记忆流

### 7.1 索引项目

创建 `20_项目/代数学习.md`：

```yaml
---
id: project-algebra
title: 代数学习
type: project
category: learning
status: active
---
```

```text
memory_notify(contract_version=2, file_path="20_项目/代数学习.md")
memory_query(contract_version=2, query="代数", filters={"entity_id":"project-algebra"}, limit=10)
```

确认查询结果包含 `entityId: "project-algebra"`，通知影响范围同时包含 `file` 与 `project` scope。

### 7.2 写入显式作用域条目

```text
memory_log(contract_version=2, slot_key="content:language", content="必须使用中文", item_kind="rule", scope={"type":"global","key":""}, priority=100, enforcement="hard", source="correction")

memory_log(contract_version=2, slot_key="format:proof", content="项目内给出完整证明", item_kind="rule", scope={"type":"project","key":"project-algebra"})

memory_log(contract_version=2, slot_key="decision:notation", content="采用右作用记号", item_kind="decision", scope={"type":"project","key":"project-algebra"})

memory_log(contract_version=2, slot_key="fact:textbook", content="主教材为群论讲义", item_kind="fact", scope={"type":"project","key":"project-algebra"})
```

每个调用都必须显式提供 `item_kind` 与 `scope`。尝试写入 `event` 必须失败。

### 7.3 路由局部上下文

```text
memory_context(contract_version=2, scopes=[{"type":"project","key":"project-algebra"}], include_global=false, include_related_files=true)
```

确认：

- 只返回 `rule`、`decision`、`fact`。
- 全局 `hard` 同 slot 规则阻止局部覆盖。
- 超预算条目进入诊断，不静默假装全部加载。
- 重复调用且数据未变化时 `snapshotId` 稳定。

### 7.4 审计与软归档

```text
memory_rules(contract_version=2, scope={"type":"project","key":"project-algebra"}, status="active", limit=100)
memory_forget(contract_version=2, item_id=42, reason="端到端归档测试")
memory_rules(contract_version=2, scope={"type":"project","key":"project-algebra"}, status="archived", limit=100)
```

确认归档记录仍存在、原因非空、普通写入不能绕过治理接口恢复。

## 8. 文件监听与批量通知

在客户端会话中连续修改多个 Markdown 文件，等待防抖批次完成。检查：

- 相同路径在一批内去重。
- 未变化文件返回 `unchanged`，不触发 scope 或 Layer 0 失效。
- 项目、复习候选和学习项目变化分别更新正确的 TaskBoard、UserProfile 影响标记。
- 文件删除移除索引，并保留删除前可推导的 affected scope。
- Vault 外路径被拒绝。

## 9. CLI rules 集成

```bash
lifeos rules list ./tmp/lifeos-integration --scope project:project-algebra
lifeos rules audit ./tmp/lifeos-integration
lifeos rules export ./tmp/lifeos-integration --output ./tmp/lifeos-memory.json
lifeos rules classify ./tmp/lifeos-integration --id 42 --scope-type project --scope-key project-algebra --kind fact
lifeos rules archive ./tmp/lifeos-integration --id 42 --reason "治理测试"
lifeos rules restore ./tmp/lifeos-integration --id 42
```

检查只读子命令以只读方式打开数据库，写命令使用稳定 `item_id`，复合键冲突时整笔回滚。

## 10. 离线升级矩阵

分别准备 `Schema V1`、`Schema V2`、`Schema V3` Vault 副本：

```bash
lifeos upgrade ./tmp/legacy-vault
lifeos doctor ./tmp/legacy-vault
```

对每个旧版本确认：

- 未升级前 MCP runtime 明确拒绝，不做隐式迁移。
- 自动生成 scope map；条数、旧身份和内容 SHA-256 必须完全匹配。
- 缺失项目 ID 自动生成并写回主 Markdown；内容、注释、换行、权限和已有合法 ID 保持不变。
- 从旧记忆中的明确绝对路径自动发现安全 Git 根，只持久化最终 repository scope 实际使用的 binding；普通绝对路径和 tool/project scope 不得污染配置。
- 高置信结果直接继续；歧义结果在 cutover 前停止，`--accept-scope-map` 只能接受已有有效建议。
- `file:__REVIEW_REQUIRED__` 必须人工替换，确认开关不能绕过。
- 项目 scope 引用真实稳定项目 ID；仓库 scope 引用已配置 binding；全部正式项目的 V4 `entity_id` 与 Markdown 一致且唯一。
- 未人工修改的 stale 默认 map 按上下文指纹自动刷新；人工修改或显式 `--scope-map` 永不被自动覆盖。
- 升级创建 Vault 外部备份与 cutover journal。
- 成功后数据库只有 `Schema V4`，runtime receipt 为 `opened`。
- 在文件安装、数据库提交和最终验证阶段分别注入失败时，均恢复旧 Vault。
- 验证 `--restore <journal>` 可恢复未完成或已打开的 cutover，成功后才释放外部写闸。
- `--override` 被拒绝，不存在双结构兼容模式。

## 11. active docs 与状态机

维护完成后确认：

- `TaskBoard.md` 仅含 `focus`、`active-projects`、`revises` 三个 AUTO 区块。
- `UserProfile.md` 仅含 `profile-summary`、`global-rules`、`scoped-rules-index` 三个 AUTO 区块。
- 旧 AUTO 结构只能由离线升级重写；运行时遇到未知结构必须拒绝。
- 知识状态唯一链路为 `draft → review → revised → mastered`，只升不降。
- `frozen` 项目及关联笔记不进入焦点、活跃项目和复习候选。

## 12. 发布验收

```bash
lifeos doctor ./tmp/lifeos-integration
npm run release:verify
```

只有七工具列表、契约门禁、V4 数据库、托管资产哈希、项目 ID、scope 审计、预算和全部测试同时通过时，才能发布。
