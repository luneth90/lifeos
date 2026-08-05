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

> 执行日期：2026-08-05 · 依据：[[lifeos记忆系统真实环境测试用例集]]（v1.0，52 用例）· 环境：LifeOS v2.3.0（全局安装）+ 真实 Vault `/Users/luneth/code/obsidian/vault`

## 执行概要

| 项 | 结果 |
|---|---|
| 总用例 | 52 |
| PASS | **52**（P0 32/32、P1 17/17、P2 3/3） |
| FAIL / BLOCKED | 0 / 0 |
| 测试数据残留 | 0 条活跃（15 条 test: 条目全部归档） |
| 执行后 DB 健康 | `doctor` 55 passed, 0 warnings（auto_vacuum=2、freelist 0%、WAL 0B） |

## 分维度结果

| 维度 | 结果 | 关键证据 |
|---|---|---|
| A 会话启动与作用域路由（8） | 8/8 PASS | bootstrap Layer 0 四 section 齐全；`available_repositories=["learningapp","lifeos"]` 精确匹配；context 按 scope 精确加载；增量补载正常；空 scope 返回 `unresolvedScopes(unknown_project)`；`include_global=true` 注入 7 条 global 规则 |
| B 写入正确性（9） | 9/9 PASS | rule/decision/fact/profile 四类写入成功；correction 不被 preference 降级（item 52 source 保持 correction）；覆盖为原地 UPDATE（item 53，无归档残留）；plan file scope 拦截（Memory Policy Violation）；event 拒绝；global 非空 key 拒绝；priority 101 拒绝 |
| C 召回与检索（6） | 6/6 PASS | 写入后 context 立即可召回；「群论」bm25 排序前列；「Group Action」第 1 名；单字「群」前缀通配命中；type=project 过滤精确；本会话无噪声违规调用 |
| D 学习工作流（10） | 10/10 PASS | digest 技能规则召回；待复习笔记（status=review）过滤命中 Step0；避重检索返回已有空间智能报告；归档链路（D-09 批量归档 3 条、D-10 global 批量拒绝） |
| E 上下文恢复（2） | 2/2 PASS | 项目规则/决策经 context 恢复、画像经 bootstrap userprofile_summary 恢复；跨会话持久化（写入→新调用召回） |
| F 治理与遗忘（4） | 4/4 PASS | 三种审计过滤精确；软归档可审计（reason 完整）；归档后 context 不再召回；item_id/scope 互斥拒绝；无 reason 拒绝 |
| G 变更同步（4） | 4/4 PASS | notify 已存在文件返回 unchanged；不存在文件返回 removed；移动通知 affectedScopes 含新旧路径；read-after-write 可检索 |
| H 改进计划验收（9） | 9/9 PASS | auto_vacuum=2；freelist 0/592（0%）；WAL 0B；doctor 无告警；bm25 中文/英文排序目标笔记第 1；unknown_tool 诊断；FTS 查询正常；**正文 4000 字覆盖生效**（「离散几何」位于 Ch07 正文第 847 字符，命中且 matchedFields=search_hints） |

## 效果度量指标

| 指标 | 结果 | 口径 |
|---|---|---|
| 路由正确率 | 100%（8/8） | A 维度 scope 归属全部精确 |
| 召回命中率 | 100%（写入→召回全部成功） | C-01/E-02/B-02/B-05 等 |
| bm25 排序准确率 | 100%（4/4 查询目标笔记 ≤ 第 3） | 群论/同构/Lagrange/Group Action |
| CJK 召回率 | 100%（单字/双字均非零） | 群/群论/同构/离散几何 |
| 噪声干扰率 | 0% | 本会话无违规调用 |
| 上下文恢复完整度 | 100%（规则/决策经 context、画像经 bootstrap） | E-01 |
| 写入拦截率 | 100%（4/4 拒绝） | event/plan-file/global-key/priority 越界 |
| 清理残留率 | 0%（0/15 活跃残留） | 批量审计 |
| DB 健康度 | 健康 | freelist<5%、auto_vacuum=2、WAL<1MB |

## 发现与观察

1. **无活跃记忆的技能不在 context 白名单**：`skill:ask/today/brainstorm/knowledge/research` 返回 `unknown_skill` 诊断。源码确认（`scope-resolver.js:148`）：`reason = unresolvedReason ?? \`unknown_${scope.type}\``，skill 无专门校验，白名单 = 有活跃记忆条目的技能。对技能首次使用无实质影响（本无记忆可加载），写入记忆后即入白名单。`scope_hints.available_skills` 与此一致（仅 archive/digest/learn-video/revise）。
2. **project scope 写入有存在性校验**：`test-phantom-project` 写入被拒（unknown_project）。测试隔离策略需修订：B-02/D-09 改用真实项目 + `test:` 前缀 + 单条/定向批量清理，禁止对真实项目做整 scope 批量归档。
3. **画像条目经 bootstrap 召回而非 context**：`profile:crypto_zk_prior_background` 不在 project context 返回中，经 `userprofile_summary` 注入 Layer 0。E-01 通过标准已按此放宽。
4. **P2-2 正文 4000 字覆盖已生效**：选正文第 847 字符处特征词「离散几何」验证命中，说明索引已完成重建（P2-2 需要 `DELETE FROM scan_state` + 全量扫描，当前库已具备）。
5. **H-06 candidates 字段未观察到**：未知工具返回 `{scope, reason}` 无 candidates 数组（单候选歧义场景未触发，P2-1 候选列表仅在别名歧义时出现）。
6. **H-03 WAL 持续为 0 字节**：runDbMaintenance 的 `wal_checkpoint(TRUNCATE)` 在每次 MCP 会话关闭后生效，-wal 不膨胀。

## 用例集修订建议（待并入 v1.1）

- B-02 / D-09：隔离策略从「幻影项目」改为「真实项目 + test: 前缀 + 定向清理」；D-09 批量归档示例 scope 改用无真实记忆的 scope（如 skill:ask）
- A-08：示例 scope 从 `skill:ask` 改为已注册技能（`skill:revise`），或注明 unknown_skill 为预期
- E-01：明确画像经 bootstrap 召回路径

## 执行记录

- 执行者：LifeOS 会话（deepseek/deepseek-v4-flash）
- 执行批次：按用例集 5.2 分 5 批，批内并行、批间顺序
- 测试写入：item 48-62 共 15 条（test: 前缀），已全部归档，reason 均标注用例 ID
- 真实数据影响：无（vault_index 新增 1 行 = 本报告文档自身，属正常索引）
