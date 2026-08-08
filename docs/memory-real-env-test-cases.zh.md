---
title: "LifeOS 记忆系统真实环境测试用例集"
type: plan
status: pending
domain: "SoftwareEngineering"
created: "2026-08-05"
priority: P1
estimated-hours: 16
tags: [plan, lifeos, memory, testing]
aliases: []
---

# LifeOS 记忆系统真实环境测试用例集

> 版本：v2.4.0 · 记忆协议：`contract_version=2` · 用例数：52

## 1. 隔离契约

本套件只在 `os.tmpdir()` 的真实子目录内创建一次性 Vault。每个 Vault 都有独立的 `lifeos.yaml`、Schema V4 `memory.db`、技能资产，以及计划、草稿、项目、知识、研究样本。任何不位于系统临时目录内的根目录都由 `assertNotProductionVault()` 失败关闭。

所有 LifeOS 调用必须同时满足：

- `LIFEOS_VAULT_ROOT === root`；
- `vaultRoot === root`；
- `dbPath === root/90_系统/记忆/memory.db`；
- `contractVersion === 2`；
- 测试只断言临时库状态，结束后活跃 `test:` 条目为 0；
- `finally` 或测试钩子负责删除整个临时 Vault。

禁止把源码仓库、用户 Vault 或其他非临时目录传给 LifeOS 函数。生产计数零变化由系统临时目录硬护栏保证，不通过打开生产数据库验证。

## 2. 分类定义

| 分类 | 含义 | 执行方式 |
|---|---|---|
| 自动核心 | 使用隔离 Vault 调用真实 core 接口并断言行为 | `npm run test:memory-real-env` |
| 版本夹具 | 使用隔离的确定性样本验收特定版本行为 | 同上；已知缺陷用 `it.fails` 保留 |
| 宿主跨会话 | 必须由新宿主会话与宿主工具日志证明 | 不在单一 MCP 测试中伪造 |

分类统计：自动核心 36 项、版本夹具 15 项、宿主跨会话 1 项，共 52 项。

## 3. 52 项映射

以下“绑定测试名”与 `tests/e2e/memory-real-env-v2.test.ts` 完全对应。

### A. 会话启动与作用域路由

| 编号 | 分类 | 绑定测试名 | 预期 |
|---|---|---|---|
| A-01 | 自动核心 | `[自动核心] A-01 bootstrap 返回完整 Layer 0 与作用域提示` | 四个 Layer 0 section、待复习计数及四类 scope hints 完整 |
| A-02 | 自动核心 | `[自动核心] A-02 context 按 skill scope 精确加载` | 只加载 `skill:revise`，不夹带 global |
| A-03 | 自动核心 | `[自动核心] A-03 context 按稳定 project id 精确加载` | 通过 `fixture-project` 精确解析 |
| A-04 | 自动核心 | `[自动核心] A-04 context 组合加载多个 scope` | skill 与 project 同时命中 |
| A-05 | 自动核心 | `[自动核心] A-05 context 增量补载仅返回新增 repository scope` | 增量调用不重复旧 scope |
| A-06 | 自动核心 | `[自动核心] A-06 context 对不存在的 scope 返回诊断而不抛错` | 返回 `unknown_project` |
| A-07 | 自动核心 | `[自动核心] A-07 tool scope 通过绑定别名解析` | `obsidian-cli` 解析为 `obsidian` |
| A-08 | 自动核心 | `[自动核心] A-08 global 只在 includeGlobal=true 时注入` | global 不重复加载 |

### B. 写入正确性

| 编号 | 分类 | 绑定测试名 | 预期 |
|---|---|---|---|
| B-01 | 自动核心 | `[自动核心] B-01 rule 写入后可按字段审计` | rule 字段完整且可审计 |
| B-02 | 自动核心 | `[自动核心] B-02 decision 写入稳定 project id 后可召回关联文件` | decision 与关联文件可召回 |
| B-03 | 自动核心 | `[自动核心] B-03 fact 与 profile 均可写入和审计` | 两种 item kind 均可审计 |
| B-04 | 自动核心 | `[自动核心] B-04 correction 不被后续 preference 降级` | source 保持 correction |
| B-05 | 自动核心 | `[自动核心] B-05 相同复合键原地覆盖且不产生归档副本` | itemId 不变、无归档副本 |
| B-06 | 自动核心 | `[自动核心] B-06 plan 与 draft file scope 被硬拦截` | 两类临时文件都拒绝写入 |
| B-07 | 自动核心 | `[自动核心] B-07 event 不能通过 memoryLog 写入` | event 被业务层拒绝 |
| B-08 | 自动核心 | `[自动核心] B-08 global scope 的 key 必须为空` | 非空 global key 被拒绝 |
| B-09 | 自动核心 | `[自动核心] B-09 priority 边界可写而越界被拒` | 0、100 可写，101 拒绝 |

### C. 召回与检索

| 编号 | 分类 | 绑定测试名或协议 | 预期 |
|---|---|---|---|
| C-01 | 自动核心 | `[自动核心] C-01 写入后 context 立即召回` | read-after-write 生效 |
| C-02 | 版本夹具 | `[版本夹具] C-02 中文关键词由相关性优先召回` | 群论夹具位于前三 |
| C-03 | 版本夹具 | `[版本夹具] C-03 英文关键词可召回中文知识夹具` | `Group Action` 命中群论夹具 |
| C-04 | 版本夹具 | `[版本夹具] C-04 中文单字通过前缀匹配召回` | 单字“群”至少命中一项 |
| C-05 | 自动核心 | `[自动核心] C-05 query 的 type 过滤精确生效` | 结果全部为 project |
| C-06 | 宿主跨会话 | 见第 4 节协议；自动套件仅保留 skip 占位 | 宿主日志中 `memory_*` 调用数为 0 |

### D. 学习工作流

| 编号 | 分类 | 绑定测试名 | 预期 |
|---|---|---|---|
| D-01 | 自动核心 | `[自动核心] D-01 today 链路可取得活跃项目并通知新日记` | bootstrap、context、query、notify 链路成立 |
| D-02 | 自动核心 | `[自动核心] D-02 ask scope 可加载且一次性问答 event 被拒绝` | ask scope 可用，一次性问答不写 event |
| D-03 | 版本夹具 | `[版本夹具] D-03 brainstorm 可静默检索相关项目` | 密码学 Agent 查询命中项目夹具 |
| D-04 | 自动核心 | `[自动核心] D-04 project 通过稳定 id 解析并出现在索引` | 项目解析不依赖历史文件名 |
| D-05 | 自动核心 | `[自动核心] D-05 knowledge 通知后可立即检索` | notify 后立即 query 命中 |
| D-06 | 版本夹具 | `[版本夹具] D-06 revise 同时加载技能与项目画像并筛选待复习项` | review 过滤通过；显式项目画像进入 `profiles` 与“作用域画像”文本，作为普通测试通过 |
| D-07 | 版本夹具 | `[版本夹具] D-07 research 启动前可检索已有报告避重` | 空间智能报告可检索 |
| D-08 | 自动核心 | `[自动核心] D-08 digest skill scope 可加载` | digest 规则可加载 |
| D-09 | 自动核心 | `[自动核心] D-09 非生产 skill scope 可批量软归档` | 两条测试记忆被批量归档 |
| D-10 | 自动核心 | `[自动核心] D-10 global scope 禁止批量归档` | global 批量归档被拒绝 |

### E. 上下文恢复

| 编号 | 分类 | 绑定测试名 | 预期 |
|---|---|---|---|
| E-01 | 自动核心 | `[自动核心] E-01 重置进程内配置后仍可恢复项目上下文` | bootstrap 只从 global profile 恢复画像；context 恢复项目决策，且关联文件真实存在 |
| E-02 | 自动核心 | `[自动核心] E-02 写入后重置调用边界仍可召回` | 重新打开调用边界后仍可召回 |

### F. 治理与遗忘

| 编号 | 分类 | 绑定测试名 | 预期 |
|---|---|---|---|
| F-01 | 自动核心 | `[自动核心] F-01 rules 按 kind、scope 与 status 精确过滤` | 三类过滤准确 |
| F-02 | 自动核心 | `[自动核心] F-02 forget 软归档且 reason 必须非空` | 条目可审计，空 reason 拒绝 |
| F-03 | 自动核心 | `[自动核心] F-03 归档条目不再进入 context` | 归档前可见、归档后不可见 |
| F-04 | 自动核心 | `[自动核心] F-04 forget 的 itemId 与 scope 必须且只能传一个` | 互斥校验生效 |

### G. 变更同步

| 编号 | 分类 | 绑定测试名 | 预期 |
|---|---|---|---|
| G-01 | 自动核心 | `[自动核心] G-01 notify 由稳定 id 定位项目夹具` | 先按 `fixture-project` 查路径，再通知 |
| G-02 | 自动核心 | `[自动核心] G-02 notify 不存在路径会清理索引且不崩溃` | 返回 removed |
| G-03 | 自动核心 | `[自动核心] G-03 notify previousFilePath 完成移动索引切换` | 新路径命中、旧路径消失 |
| G-04 | 自动核心 | `[自动核心] G-04 notify 后 query 具备 read-after-write 一致性` | 唯一术语立即可检索 |

### H. 版本验收

| 编号 | 分类 | 绑定测试名 | 预期与当前状态 |
|---|---|---|---|
| H-01 | 版本夹具 | `[版本夹具] H-01 数据库使用 INCREMENTAL auto_vacuum` | `auto_vacuum=2` |
| H-02 | 版本夹具 | `[版本夹具] H-02 等待例行维护终态，并由显式压缩满足 freelist/WAL 验收` | 使用专属临时 Vault 制造碎片；bootstrap 先返回 `pending`，通过维护 Promise 等待 `succeeded` 终态；随后重新制造碎片，只调用 `doctor --compact-db`，验收 freelist 比例低于 5% 且 WAL 为 0 或不存在 |
| H-03 | 版本夹具 | `[版本夹具] H-03 启动维护后 WAL 小于 1MB` | 例行非截断 checkpoint 后 WAL 小于 1MB |
| H-04 | 版本夹具 | `[版本夹具] H-04 doctor 的数据库健康指标无告警` | freelist 同时达到 25% 与 64 MiB 才告警；夹具三项数据库指标为 pass |
| H-05 | 版本夹具 | `[版本夹具] H-05 中文与英文 bm25 场景将目标排入前三` | 同构与 Lagrange 目标位于前三 |
| H-06 | 版本夹具 | `[版本夹具] H-06 未知工具诊断保留 candidates 数组` | 当前缺少 candidates，以 `it.fails` 保留 |
| H-07 | 版本夹具 | `[版本夹具] H-07 bootstrap 仓库白名单来自隔离配置` | 精确等于 `learningapp, lifeos` |
| H-08 | 版本夹具 | `[版本夹具] H-08 例行有限 FTS merge 后中英文查询均可执行` | 例行路径不执行完整 optimize；有限 merge 后两次查询无 FTS5 错误 |
| H-09 | 版本夹具 | `[版本夹具] H-09 正文深处 4000 字窗口内关键词可召回` | 600 至 4000 字范围的唯一术语可召回 |

## 4. C-06 宿主跨会话证据协议

C-06 禁止在同一个 MCP 测试进程里模拟“未调用工具”并宣称通过。人工证据步骤如下：

1. 启动一个全新的宿主会话，不预先调用 LifeOS 工具。
2. 仅发送自然语言闲聊：“今天天气怎么样？”
3. 保存完整会话转录与宿主工具调用日志。
4. 统计该轮从用户消息到最终回答之间所有名称以 `memory_` 开头的调用。
5. 调用数必须为 0，且不得出现 project、file 等无关作用域。
6. 证据记录宿主版本、会话标识、开始与结束时间、日志位置和复核人。

自动测试中的 C-06 使用 `it.skip`，只维持编号与映射，不构成通过证据。

## 5. 执行命令

```bash
npx vitest run tests/e2e/memory-real-env-v2.test.ts -t H-02
npm run test:memory-real-env
npm run test:memory-real-env
npm test
npm run typecheck
npx biome check tests/helpers/memory-real-env-vault.ts tests/e2e/memory-real-env-v2.test.ts
```

真实环境完整命令连续两次必须得到相同统计。D-06 的生产缺陷已修复并改为普通测试；H-06 仍以 `it.fails` 保留，C-06 只有取得宿主日志后才能记录为通过。H-02 还必须使用 `-t H-02` 单独运行，证明结果不依赖前序用例制造碎片；等待必须使用 runtime 暴露的维护 Promise 与有限状态，禁止定时休眠。例行路径只允许 `incremental_vacuum`、有限 FTS merge 与非截断 checkpoint；只有显式 `doctor --compact-db` 执行完整压缩、FTS optimize 与 WAL truncate。若第二连接的读事务令 `wal_checkpoint(TRUNCATE)` 返回 busy 或残留 WAL，数据库报告和 doctor 都必须失败。`wal_pages` 是根据 WAL 文件物理大小估算的已分配帧数，不表示待回写页数。
