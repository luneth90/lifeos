## Project Overview

LifeOS Memory System 是一个基于 MCP stdio 的持久记忆服务。当前协议为
`contract_version=2`、数据库为 `Schema V5`，服务端固定公开 8 tools：
`memory_bootstrap`、`memory_query`、`memory_context`、`memory_log`、
`memory_rules`、`memory_history`、`memory_forget`、`memory_notify`。

## Commands

```bash
npm run build
npm run dev
npm start
npm test
npm run test:memory-real-env
npm run test:memory-eval
npm run lint
npm run typecheck
```

## Architecture

```text
MCP Client
  → server.ts               8 个工具、Zod 输入与 strict outputSchema
  → core.ts                 契约校验、每次调用的配置快照、数据库生命周期
  → services/startup.ts     Layer 0、ScopeCatalog 提示、后台例行维护
  → services/scope-*.ts     技能/项目/仓库/工具/文件目录与稳定作用域解析
  → services/context-router.ts  显式局部规则、决策、事实与画像组装
  → services/retrieval.ts   Vault FTS5/LIKE 检索、排名与证据
  → services/memory-*.ts    当前投影、append-only 历史与治理
  → utils/vault-indexer.ts  Markdown 索引与变更同步
  → db/schema.ts            Schema V5、FTS5 与结构验证
```

`memory_bootstrap` 只返回 global Layer 0。`memory_context` 只加载显式 scope，
`memory_query` 只检索 Vault 索引。写入和治理通过 `memory_log`、`memory_forget` 与 CLI
规则命令完成，文件变化由 `memory_notify` 同步。每个非 bootstrap 调用在打开 Vault 和数据库前
校验 `contract_version=2`；运行时只接受 Schema V5，旧库只能由离线 `lifeos upgrade` 升级。

## Database

SQLite 使用 WAL。主要结构包括：

- `vault_index` 与 `vault_fts`：Vault Markdown 的当前索引与全文检索；
- `scan_state`：增量扫描状态；
- `memory_items`：规则、决策、事实与画像的当前投影；
- `memory_item_events`：投影变化的 append-only 历史；
- `schema_version`：当前结构版本，运行时固定为 V5。

Schema V4 升级到 V5 时只为每个现存投影建立一个 `baseline_snapshot`，不伪造升级前历史。
MCP 不提供物理删除；唯一例外是带双 item id、非空原因和已验证备份的 CLI 单条 purge。

## Runtime Contracts

- ScopeCatalog 来自安装技能、`lifeos.yaml` 的工具/仓库配置及 `vault_index` 的项目/文件；
  零记忆对象仍可解析，未知写入必须拒绝。
- global 画像只进入 Layer 0；显式非 global 画像只进入 `memory_context.profiles` 与
  “作用域画像”文本区块。
- 8 tools 都返回等值的 `structuredContent` 与 `content[0].text` JSON。
- 检索保留兼容 `score`，并公开真实 `rankScore`、`rankPosition` 与 `evidence`。
- 例行维护状态为 `pending → running → succeeded|failed`，每个 Vault single-flight；
  `doctor --compact-db` 是更强的显式压缩路径。
- 当前量化结论是 Schema V6 No-Go，不创建分段表或分段检索逻辑。

## Code Style and Testing

- Biome：tab 缩进、100 字符行宽、single quote。
- TypeScript strict、ES2022、Node16 module resolution、ESM。
- 功能或缺陷修复严格执行 RED → GREEN → REFACTOR。
- 真实环境测试只能写系统临时目录中的隔离 Vault；生产数据库仅在明确授权时做 immutable
  聚合只读查询，不得读取正文、迁移、维护或写入。
