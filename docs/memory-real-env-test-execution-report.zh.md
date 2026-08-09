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

> 执行日期：2026-08-09 · 包版本：v2.4.0 · 记忆协议：`contract_version=2`

## 执行概要

| 项 | 实际结果 |
| --- | --- |
| 隔离护栏 | 3/3 普通通过 |
| 52 项业务映射 | 51 项自动/版本夹具普通通过；C-06 唯一跳过 |
| Vitest 统计 | 54 项通过、1 项 skipped，共 55 项 |
| 重复性 | 真实环境完整套件连续两次均为 54 项通过、1 项跳过 |
| H-02 | 单独运行普通通过；维护终态 `succeeded` |
| H-06 | 单独运行普通通过；未知 tool 始终返回稳定 `candidates` 数组 |
| 隔离运行时 | Schema V5 |
| 生产只读快照 | Schema V4，active=30，archived=52；生产只读快照未升级 |
| 生产计数差 | active `30 → 30`，archived `52 → 52`，两者增量均为 0 |
| C-06 | 没有新的宿主工具日志，保持 skipped/待证据 |

## 命令与证据

| 命令 | 实际结果 |
| --- | --- |
| `npx vitest run tests/services/scope-resolver-v4.test.ts` | 11 项普通通过 |
| `npx vitest run tests/e2e/memory-real-env-v2.test.ts -t H-06` | 1 项通过、54 项跳过 |
| `npm run test:memory-real-env`（第一次） | 54 项通过、1 项跳过 |
| `npm run test:memory-real-env`（第二次） | 54 项通过、1 项跳过 |
| `npx vitest run tests/e2e/memory-real-env-v2.test.ts -t H-02` | 1 项通过、54 项跳过；维护终态 `succeeded` |
| SQLite immutable 前快照 | `schema_version=4`、`active=30`、`archived=52` |
| SQLite immutable 后快照 | `schema_version=4`、`active=30`、`archived=52` |

生产快照只执行 `schema_version` 与 `memory_items.status` 聚合查询，没有读取 `content`、事件
JSON 或 Vault 正文，也没有运行升级、启动维护、doctor、purge 或任何写操作。生产库仍为 Schema V4；
本次任务不改变其版本。

## 52 项逐项结果

下表中的“完整套件”均指 `npm run test:memory-real-env`。自动核心与版本夹具全部使用普通断言。

| 编号 | 分类 | 测试名或宿主协议 | 实际状态 | 证据入口 |
| --- | --- | --- | --- | --- |
| A-01 | 自动核心 | bootstrap 返回完整 Layer 0 与作用域提示 | 通过 | 完整套件 |
| A-02 | 自动核心 | context 按 skill scope 精确加载 | 通过 | 完整套件 |
| A-03 | 自动核心 | context 按稳定 project id 精确加载 | 通过 | 完整套件 |
| A-04 | 自动核心 | context 组合加载多个 scope | 通过 | 完整套件 |
| A-05 | 自动核心 | context 增量补载仅返回新增 repository scope | 通过 | 完整套件 |
| A-06 | 自动核心 | context 对不存在的 scope 返回诊断而不抛错 | 通过 | 完整套件 |
| A-07 | 自动核心 | tool scope 通过绑定别名解析 | 通过 | 完整套件 |
| A-08 | 自动核心 | global 只在 includeGlobal=true 时注入 | 通过 | 完整套件 |
| B-01 | 自动核心 | rule 写入后可按字段审计 | 通过 | 完整套件 |
| B-02 | 自动核心 | decision 写入稳定 project id 后可召回关联文件 | 通过 | 完整套件 |
| B-03 | 自动核心 | fact 与 profile 均可写入和审计 | 通过 | 完整套件 |
| B-04 | 自动核心 | correction 不被后续 preference 降级 | 通过 | 完整套件 |
| B-05 | 自动核心 | 相同复合键原地覆盖且不产生归档副本 | 通过 | 完整套件 |
| B-06 | 自动核心 | plan 与 draft file scope 被硬拦截 | 通过 | 完整套件 |
| B-07 | 自动核心 | event 不能通过 memoryLog 写入 | 通过 | 完整套件 |
| B-08 | 自动核心 | global scope 的 key 必须为空 | 通过 | 完整套件 |
| B-09 | 自动核心 | priority 边界可写而越界被拒 | 通过 | 完整套件 |
| C-01 | 自动核心 | 写入后 context 立即召回 | 通过 | 完整套件 |
| C-02 | 版本夹具 | 中文关键词由相关性优先召回 | 通过 | 完整套件 |
| C-03 | 版本夹具 | 英文关键词可召回中文知识夹具 | 通过 | 完整套件 |
| C-04 | 版本夹具 | 中文单字通过前缀匹配召回 | 通过 | 完整套件 |
| C-05 | 自动核心 | query 的 type 过滤精确生效 | 通过 | 完整套件 |
| C-06 | 宿主跨会话 | 全新闲聊会话 `memory_*` 调用数应为 0 | skipped/待证据 | 新宿主会话工具日志 |
| D-01 | 自动核心 | today 链路可取得活跃项目并通知新日记 | 通过 | 完整套件 |
| D-02 | 自动核心 | ask scope 可加载且一次性问答 event 被拒绝 | 通过 | 完整套件 |
| D-03 | 版本夹具 | brainstorm 可静默检索相关项目 | 通过 | 完整套件 |
| D-04 | 自动核心 | project 通过稳定 id 解析并出现在索引 | 通过 | 完整套件 |
| D-05 | 自动核心 | knowledge 通知后可立即检索 | 通过 | 完整套件 |
| D-06 | 版本夹具 | revise 加载技能与项目画像并筛选待复习项 | 通过 | 完整套件 |
| D-07 | 版本夹具 | research 启动前可检索已有报告避重 | 通过 | 完整套件 |
| D-08 | 自动核心 | digest skill scope 可加载 | 通过 | 完整套件 |
| D-09 | 自动核心 | 非生产 skill scope 可批量软归档 | 通过 | 完整套件 |
| D-10 | 自动核心 | global scope 禁止批量归档 | 通过 | 完整套件 |
| E-01 | 自动核心 | 重置进程内配置后仍可恢复项目上下文 | 通过 | 完整套件 |
| E-02 | 自动核心 | 写入后重置调用边界仍可召回 | 通过 | 完整套件 |
| F-01 | 自动核心 | rules 按 kind、scope 与 status 精确过滤 | 通过 | 完整套件 |
| F-02 | 自动核心 | forget 软归档且 reason 必须非空 | 通过 | 完整套件 |
| F-03 | 自动核心 | 归档条目不再进入 context | 通过 | 完整套件 |
| F-04 | 自动核心 | forget 的 itemId 与 scope 互斥 | 通过 | 完整套件 |
| G-01 | 自动核心 | notify 由稳定 id 定位项目夹具 | 通过 | 完整套件 |
| G-02 | 自动核心 | notify 不存在路径会清理索引且不崩溃 | 通过 | 完整套件 |
| G-03 | 自动核心 | notify previousFilePath 完成移动索引切换 | 通过 | 完整套件 |
| G-04 | 自动核心 | notify 后 query 具备 read-after-write 一致性 | 通过 | 完整套件 |
| H-01 | 版本夹具 | 数据库使用 INCREMENTAL auto_vacuum | 通过 | 完整套件 |
| H-02 | 版本夹具 | 等待例行维护终态并由显式压缩满足验收 | 通过 | 单项与完整套件 |
| H-03 | 版本夹具 | 启动维护后 WAL 小于 1MB | 通过 | 完整套件 |
| H-04 | 版本夹具 | doctor 的数据库健康指标无告警 | 通过 | 完整套件 |
| H-05 | 版本夹具 | 中文与英文 bm25 场景将目标排入前三 | 通过 | 完整套件 |
| H-06 | 版本夹具 | 未知工具诊断保留 candidates 数组 | 通过 | 单项与完整套件 |
| H-07 | 版本夹具 | bootstrap 仓库白名单来自隔离配置 | 通过 | 完整套件 |
| H-08 | 版本夹具 | 例行有限 FTS merge 后中英文查询均可执行 | 通过 | 完整套件 |
| H-09 | 版本夹具 | 正文深处 4000 字窗口内关键词可召回 | 通过 | 完整套件 |

## 维护、Schema 与候选约束

H-02 使用专属 Schema V5 临时 Vault 制造碎片。bootstrap 先返回 `pending`，用例等待同一 Vault
的 single-flight Promise，例行维护到达 `succeeded`。例行路径只使用增量 vacuum、有限 FTS merge
与 PASSIVE checkpoint；随后只在隔离 Vault 上调用 `doctor --compact-db`，验收高强度压缩与 WAL
truncate。状态机仍为 `pending → running → succeeded|failed`。

H-06 的未知 tool 诊断始终有 `candidates`：有工具配置时为全部可用稳定 tool id 的确定性排序，
无配置时为 `[]`。歧义 alias 只列实际匹配的稳定 id；已知/唯一 alias 正常解析；非 tool 未知
scope 不新增 `candidates`。

## 剩余限制

C-06 需要全新宿主会话的完整工具日志，证明从闲聊消息到最终回答之间 `memory_*` 调用数为 0。
本任务没有取得新日志，因此保持唯一 skip，不能从进程内测试推断通过。生产 Vault 仍是 Schema V4；
本报告的 Schema V5 结论仅适用于隔离测试 runtime。
