---
title: "LifeOS 记忆系统测试执行报告"
type: plan
category: testing
status: done
domain: "SoftwareEngineering"
created: "2026-08-05"
priority: P1
estimated-hours: 3
tags: [plan, lifeos, memory, testing, report]
aliases: []
---

# LifeOS 记忆系统测试执行报告

> 执行日期：2026-08-09 · 用例版本：v2.4.0 · 记忆协议：`contract_version=2`

## 执行概要

| 项 | 实际结果 |
|---|---|
| 夹具护栏测试 | 3 项通过 |
| 52 项业务映射 | 50 项普通通过、1 项预期失败、1 项宿主跳过 |
| Vitest 总计 | 53 项通过、1 项 expected fail、1 项 skipped，共 55 项 |
| 自动核心 | 36/36 达到当前自动标准 |
| 版本夹具 | 14 项普通通过、1 项保留预期失败 |
| 宿主跨会话 | C-06 未执行，不计为通过 |
| 活跃测试记忆残留 | 0；每项结束钩子断言并清理失败现场 |
| 生产数据访问 | 0；根目录硬护栏只允许系统临时目录真实子目录 |

## 命令、预期与实际证据

| 命令 | 预期 | 实际 |
|---|---|---|
| `npx vitest run tests/e2e/memory-real-env-v2.test.ts`（RED） | 因夹具函数不存在失败 | 失败于无法导入 `../helpers/memory-real-env-vault.js`，0 项测试 |
| `npx vitest run tests/e2e/memory-real-env-v2.test.ts`（夹具 GREEN） | 夹具三项通过 | 1 个文件、3 项通过 |
| `npm run test:memory-real-env -- -t D-06` | D-06 单独普通通过且保持完整断言 | 1 项通过、54 项跳过；退出码 0 |
| `npm run test:memory-real-env`（第一次） | 统计固定且退出码为 0 | 1 个文件通过；53 项通过、1 项预期失败、1 项跳过 |
| `npm run test:memory-real-env`（第二次） | 与第一次完全一致 | 1 个文件通过；53 项通过、1 项预期失败、1 项跳过 |
| `npx vitest run tests/e2e/memory-real-env-v2.test.ts -t H-02` | H-02 不依赖前序用例并普通通过 | 1 项通过、54 项跳过；退出码 0 |
| `npx vitest run tests/db/maintenance.test.ts tests/services/startup.test.ts tests/server.test.ts tests/cli/doctor.test.ts tests/e2e/memory-real-env-v2.test.ts`（任务 6 RED） | 新维护状态、single-flight、双阈值、SQL 强度和 H-02 先失败 | 5 个文件均按预期失败；13 项失败、96 项通过、1 项预期失败、1 项跳过；退出码 1 |
| 同上（任务 6 GREEN） | 新维护契约全部通过 | 5 个文件通过；109 项通过、1 项预期失败、1 项跳过；退出码 0 |
| `npm test` | 不低于任务 0 的 998 项基线，新增套件不回归 | 61 个文件通过；1069 项通过、1 项预期失败、1 项跳过，共 1071 项 |
| `npm run lint` | 生产源码检查无错误 | 52 个源码文件通过 |
| `npm run typecheck` | 0 个类型错误 | 退出码 0，无类型错误 |
| `npx biome check src/types.ts src/services/context-router.ts src/active-docs/userprofile.ts tests/services/context-router-v4.test.ts tests/active-docs/active-docs.test.ts tests/skill-contracts/data-contract.test.ts tests/e2e/memory-real-env-v2.test.ts` | 本任务相关 TypeScript 文件无格式或静态检查错误 | 7 个文件通过，无修复项 |

## 分类结果

| 维度 | 自动核心 | 版本夹具 | 宿主跨会话 | 结果摘要 |
|---|---:|---:|---:|---|
| A 会话启动与路由 | 8 | 0 | 0 | 8 项通过 |
| B 写入正确性 | 9 | 0 | 0 | 9 项通过 |
| C 召回与检索 | 2 | 3 | 1 | 5 项自动执行；C-06 等待宿主证据 |
| D 学习工作流 | 7 | 3 | 0 | 10 项普通通过；D-06 已转为普通通过 |
| E 上下文恢复 | 2 | 0 | 0 | 2 项通过 |
| F 治理与遗忘 | 4 | 0 | 0 | 4 项通过 |
| G 变更同步 | 4 | 0 | 0 | 4 项通过；G-01 只通过稳定 id 定位 |
| H 版本验收 | 0 | 9 | 0 | 8 项普通通过；H-06 预期失败 |

## 验收结果与边界

### D-06 项目画像读取

显式请求的非 global 项目画像现已进入 `ContextResponse.profiles`，并渲染到“作用域画像”文本区块。D-06 保留原有 skill/project scope、review 过滤、`profile:weak.fixture` 结构化返回和文本渲染断言，从 `it.fails` 转为普通测试；单独运行与完整套件双跑均通过。

### H-02 自包含维护验证

H-02 为自己创建专属临时 Vault，在该库内创建 500 行、每行 8192 字节的临时负载，删除并丢弃临时表后确认维护前 freelist 比例超过 50%。首次 bootstrap 同步返回 `pending`，用例直接等待同一 Vault runtime 暴露的维护 Promise；没有定时休眠。例行维护终态必须为 `succeeded`，并保留完整时间与前后指标。

随后用例在同一临时库重新制造碎片，只通过显式 `doctor --compact-db` 执行完整压缩，终态后再读取数据库，验收 freelist 比例低于 5% 且 WAL 为 0 或不存在。样本指标如下：

- 初始：`pending`，时间与前后指标均为 `null`；
- 例行维护前：`page_count=1085`、`freelist_count=1064`、`freelist_bytes=4358144`、`wal_pages=10`、`wal_bytes=41232`；
- 例行维护后：`page_count=20`、`freelist_count=0`、`freelist_bytes=0`；PASSIVE checkpoint 后 WAL 保持非截断，可见 `wal_pages=15`、`wal_bytes=61832`；
- 显式压缩后：`page_count=20`、`freelist_count=0`、`freelist_bytes=0`、`wal_pages=0`、`wal_bytes=0`。

例行 SQL 验证明确要求有限 FTS merge 与 `wal_checkpoint(PASSIVE)`，并明确排除 FTS optimize 与 `wal_checkpoint(TRUNCATE)`；显式压缩则要求完整 VACUUM、FTS optimize 和 WAL truncate。

### 任务 6 状态机与健康口径

- 每个 canonical Vault runtime 只创建一个维护 Promise；同一 Vault 的连续 bootstrap 共享任务，不同 Vault 各执行一次。
- 状态只允许 `pending → running → succeeded|failed`。失败终态保留开始、结束、耗时和错误详情，不以成功或零值伪装。
- `maintenancePending` 只保留为旧调用方的派生兼容字段；`maintenanceState` 与 bootstrap 的 `db_maintenance.state` 是权威状态。
- doctor 稳态告警同时要求 `freelistRatio >= 25%` 和 `freelistBytes >= 64 MiB`；等于边界时告警，小库即使比例为 26% 也不告警。
- bootstrap 成功与 `startup_error` 两条 strict structured output 分支都要求显式 `db_maintenance` 字段；错误分支固定为 `null`，没有把 schema 放宽为可选。

### H-06 未知工具 candidates

未知工具诊断当前返回 `unknown_tool`，没有 `candidates` 数组。测试使用 `it.fails` 保留完整契约。任务 1 未修改作用域解析生产逻辑。

### C-06 宿主跨会话协议

自动套件仅用 `it.skip` 保留编号。必须另开宿主会话，只发送自然语言闲聊，并由宿主工具日志证明该轮 `memory_*` 调用数为 0。没有这份日志时不得记录为通过。

## 数据隔离证据

- `createIsolatedMemoryVault()` 使用 `mkdtempSync()` 在 `os.tmpdir()` 的规范化真实路径下创建 Vault。
- `assertNotProductionVault()` 对系统临时目录外路径失败关闭，不包含任何用户绝对路径硬编码。
- 每个 LifeOS 调用前校验环境变量、显式 Vault 根目录和数据库路径属于同一个隔离夹具。
- `snapshotCounts()` 只打开夹具自己的数据库。
- 夹具包含独立配置、Schema V4 数据库、技能资产、计划、草稿、稳定项目 id、知识与研究样本。
- 用例结束检查所有活跃 `test:` 条目为 0，套件结束删除整个临时 Vault。

## 结论

零污染隔离护栏、52 项映射和可重复执行入口已经建立。D-06 已有普通通过证据；H-06 仍明确保留为预期失败，C-06 仍是宿主未执行项；H-02 保持自包含普通通过。
