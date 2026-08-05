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

> 版本：v1.0 · 基于 LifeOS v2.3.0 · 记忆协议 contract_version=2
> 关联：[[lifeos记忆系统改进计划]]

---

## 1 测试目标与范围

### 1.1 测什么

在用户真实 Vault（`/Users/luneth/code/obsidian/vault`）与真实 LifeOS MCP 工具环境下，端到端验证：

1. **7 个记忆工具**（bootstrap / context / query / log / rules / forget / notify）在真实数据上的行为正确性
2. **9 个技能**（today / ask / brainstorm / project / research / knowledge / revise / digest / archive）中记忆系统的集成效果——正确写入、正确路由、需要时被召回、噪声不干扰、上下文跨会话/跨技能恢复
3. **改进计划 5 Phase** 的真实环境验收——DB 维护指标、bm25 排序、别名候选、CJK 召回、scope_hints 仓库白名单

### 1.2 不测什么

- **单元级/源码级逻辑**：已由 `lifeos` 源码 `tests/` 覆盖（991/991 通过），本文档不重复
- **MCP 传输层**：stdio 连接、JSON-RPC 序列化等基础设施
- **Obsidian 渲染**：笔记在 Obsidian 中的显示效果
- **第三方依赖**：SQLite 引擎本身、better-sqlite3 驱动

---

## 2 测试环境与前置准备

### 2.1 环境要求

| 项 | 要求 |
|---|---|
| Vault 路径 | `/Users/luneth/code/obsidian/vault`（git 仓库） |
| LifeOS 版本 | v2.3.0（`lifeos.yaml` 中 `installed_versions.cli: 2.3.0`） |
| MCP 传输 | stdio，通过 AI 客户端（Antigravity / Claude Desktop）自动连接 |
| 数据库 | `90_系统/记忆/memory.db`（SQLite WAL） |
| 额外可读 | `/Users/luneth/code/node/lifeos`（源码仓库，仅参考） |

### 2.2 验证 MCP 可用

执行 `memory_bootstrap()` 无参调用，预期返回包含：
- `layer0` 含 `global_rules`、`taskboard_focus`、`userprofile_summary`、`review_reminders` 四个 section
- `scope_hints` 含 `available_projects`、`available_skills`、`available_tools`、`available_repositories`
- `layer0_meta` 含各 section 的 token 统计

若返回错误或超时，终止全部测试并排查 MCP 连接。

### 2.3 确认基线指标

在测试开始前，记录以下基线数据作为对比锚点：

```text
# 审计当前记忆条目
memory_rules(contract_version=2, status="active")
→ 记录：active 条目总数、各 item_kind 分布、各 scope_type 分布

# SQLite 基线（通过 doctor 或 sqlite3 只读查询）
PRAGMA page_count;
PRAGMA freelist_count;
PRAGMA auto_vacuum;
SELECT COUNT(*) FROM vault_index;
SELECT COUNT(*) FROM memory_items WHERE status='active';
SELECT COUNT(*) FROM memory_items WHERE status='archived';
```

预期基线参考值（会漂移）：`vault_index ≈ 205`、`memory_items(active) ≈ 47`、`auto_vacuum = 2`（v2.3.0 后）、`freelist_count / page_count < 0.05`（v2.3.0 doctor --compact-db 执行后）。

---

## 3 测试数据隔离策略

### 3.1 隔离原则

真实环境测试在用户生产 Vault 上执行，必须确保测试数据不污染真实记忆。

### 3.2 隔离机制

1. **slot_key 前缀**：所有测试写入的 `memory_log` 使用 `test:` 前缀的 `slot_key`（如 `test:lang-rule`、`test:bm25-fact`），与生产 slot_key 命名空间隔离
2. **专用 scope key**：若需要 project scope，使用不存在的项目 ID `test-phantom-project`，不与真实项目冲突
3. **即用即清**：每个用例的执行步骤末尾内嵌清理步骤，使用 `memory_forget` 软归档测试数据
4. **文件操作约束**：测试中不创建、修改或删除任何真实 Vault 文件；需要 notify 测试时使用已存在的文件路径（只读验证）

### 3.3 清理验证

每个用例清理后，执行验证查询确认无残留：

```text
memory_rules(
  contract_version=2,
  slot_key="test:*",   # 注：实际用精确 slot_key 查
  status="active"
)
→ 预期：0 条匹配
```

### 3.4 风险评估

| 风险 | 影响 | 缓解 |
|---|---|---|
| 测试 slot_key 未清理 | 后续 context 可能召回测试数据 | 每个用例强制清理步骤 + 整轮测试后批量审计 |
| forget 失败导致残留 | 同上 | 失败时记录 item_id，手动补清 |
| notify 意外触发重索引 | 索引数据短暂不一致 | 仅对已索引文件 notify，不操作文件内容 |

---

## 4 测试用例集

### 用例结构说明

每条用例包含：**用例 ID** · **优先级**（P0/P1/P2） · **关联维度** · **场景描述** · **前置条件** · **执行步骤** · **预期结果** · **通过标准** · **数据清理** · **风险**

---

### 维度 A：会话启动与作用域路由

#### A-01 bootstrap Layer 0 内容完整性

- **优先级**：P0
- **关联维度**：A
- **场景描述**：用户开启新会话，助手调用 bootstrap 获取全局 Layer 0，验证返回内容完整且结构正确
- **前置条件**：MCP 已连接；Vault 含 `TaskBoard.md` 与 `UserProfile.md`
- **执行步骤**：

```text
1. memory_bootstrap()
2. 检查返回结构
```

- **预期结果**：
  - 返回含 `layer0` 对象，包含 `global_rules`（全局规则文本）、`taskboard_focus`（TaskBoard 焦点项）、`userprofile_summary`（用户画像摘要）、`review_reminders`（复习提醒）
  - 返回含 `scope_hints` 对象，包含 `available_projects`（数组）、`available_skills`（数组）、`available_tools`（数组）、`available_repositories`（数组）
  - 返回含 `layer0_meta`，各 section 的 `tokens` 值为非负整数
  - `available_repositories` 包含 `["learningapp", "lifeos"]`（按字母序）
- **通过标准**：
  - `layer0` 四个 section 均存在且非空（review_reminders 可为空数组）→ PASS
  - `scope_hints` 四个字段均存在且为数组 → PASS
  - `available_repositories` 精确等于 `["learningapp", "lifeos"]` → PASS
- **数据清理**：无（只读操作）
- **风险**：无

---

#### A-02 context 按 skill scope 精确加载

- **优先级**：P0
- **关联维度**：A
- **场景描述**：用户触发 `/revise` 技能，助手加载 skill scope 的局部规则与决策
- **前置条件**：Vault 中存在 `skill:revise` 作用域的记忆条目（如有）
- **执行步骤**：

```text
1. memory_context(
     contract_version=2,
     scopes=[{type: "skill", key: "revise"}],
     include_global=false,
     include_related_files=true
   )
2. 检查返回结构
```

- **预期结果**：
  - 返回包含 `scoped_context` 对象，其中 `skill:revise` 的规则/决策/事实/画像（如有活跃条目则非空，无则为空列表）
  - 不包含 global 作用域的规则（因 `include_global=false`）
  - 若有 `related_files`，路径为 Vault 相对路径且文件存在
- **通过标准**：
  - 返回结构含 `scoped_context` → PASS
  - 未包含 global 规则 → PASS
- **数据清理**：无（只读操作）
- **风险**：无

---

#### A-03 context 按 project scope 精确加载

- **优先级**：P0
- **关联维度**：A
- **场景描述**：用户在学习项目中工作，助手加载项目作用域的记忆
- **前置条件**：Vault 中存在项目 `crypto-agile-policy-aware-nivc`
- **执行步骤**：

```text
1. memory_context(
     contract_version=2,
     scopes=[{type: "project", key: "crypto-agile-policy-aware-nivc"}],
     include_global=false,
     include_related_files=true
   )
2. 检查返回内容是否为该项目作用域的记忆
```

- **预期结果**：
  - 返回的 `scoped_context` 中的条目（如有）均属于 `project:crypto-agile-policy-aware-nivc`
  - `related_files`（如有）指向与该项目关联的文件
- **通过标准**：
  - 所有返回条目的 scope 匹配 `project:crypto-agile-policy-aware-nivc` → PASS
- **数据清理**：无（只读操作）
- **风险**：无

---

#### A-04 context 多 scope 组合加载

- **优先级**：P0
- **关联维度**：A
- **场景描述**：用户在复习 GTS 项目知识时，助手同时加载 skill 和 project 两个作用域
- **前置条件**：同 A-02、A-03
- **执行步骤**：

```text
1. memory_context(
     contract_version=2,
     scopes=[
       {type: "skill", key: "revise"},
       {type: "project", key: "crypto-agile-policy-aware-nivc"}
     ],
     include_global=false,
     include_related_files=true
   )
2. 检查返回包含两个 scope 的内容
```

- **预期结果**：
  - `scoped_context` 包含 `skill:revise` 和 `project:crypto-agile-policy-aware-nivc` 两个 scope 的条目
- **通过标准**：
  - 两个 scope 的条目分别可识别 → PASS
- **数据清理**：无
- **风险**：无

---

#### A-05 context 增量补载新 scope

- **优先级**：P0
- **关联维度**：A
- **场景描述**：用户在 `/ask` 会话中途提到 lifeos 仓库问题，助手增量补载 repository scope
- **前置条件**：已完成 bootstrap 和初始 `skill:ask` 的 context 加载
- **执行步骤**：

```text
1. memory_context(
     contract_version=2,
     scopes=[{type: "repository", key: "lifeos"}],
     include_global=false
   )
2. 检查返回只含新 scope 的内容，不重复首次 skill:ask 的内容
```

- **预期结果**：
  - 返回 `repository:lifeos` 作用域的规则/决策/事实（如有）
  - 不含 `skill:ask` 的条目（已由首次加载覆盖）
- **通过标准**：
  - 新 scope 正常返回 → PASS
  - 未携带已加载 scope 的重复内容 → PASS
- **数据清理**：无
- **风险**：无

---

#### A-06 context 空 scope 返回空

- **优先级**：P1
- **关联维度**：A
- **场景描述**：传入一个无任何记忆条目的 scope，验证返回空而非报错
- **前置条件**：无
- **执行步骤**：

```text
1. memory_context(
     contract_version=2,
     scopes=[{type: "project", key: "nonexistent-project-xyz"}],
     include_global=false
   )
2. 检查返回
```

- **预期结果**：
  - 返回正常（非错误），`scoped_context` 中该 scope 的条目列表为空
  - 可能包含 `unresolvedScopes` 诊断信息
- **通过标准**：
  - 无异常，返回结构完整 → PASS
- **数据清理**：无
- **风险**：无

---

#### A-07 工具别名解析（正常）

- **优先级**：P1
- **关联维度**：A
- **场景描述**：使用 `lifeos.yaml` 中已绑定的工具别名 `obsidian` 加载 tool scope
- **前置条件**：`lifeos.yaml` 中 `tool_bindings.obsidian` 已配置
- **执行步骤**：

```text
1. memory_context(
     contract_version=2,
     scopes=[{type: "tool", key: "obsidian"}],
     include_global=false
   )
2. 检查别名正确解析
```

- **预期结果**：
  - 正常返回 `tool:obsidian` 的上下文，无 `unresolvedScopes`
- **通过标准**：
  - 无 `unknown_tool` 或 `ambiguous_tool_alias` 诊断 → PASS
- **数据清理**：无
- **风险**：无

---

#### A-08 global scope 不重复加载

- **优先级**：P1
- **关联维度**：A
- **场景描述**：bootstrap 已注入 global 规则后，context 默认 `include_global=false` 不重复加载
- **前置条件**：已执行 bootstrap
- **执行步骤**：

```text
1. memory_context(
     contract_version=2,
     scopes=[{type: "skill", key: "ask"}],
     include_global=false
   )
2. 检查返回不含 global 规则文本
3. memory_context(
     contract_version=2,
     scopes=[{type: "skill", key: "ask"}],
     include_global=true
   )
4. 检查返回包含 global 规则文本
```

- **预期结果**：
  - 步骤 2：`scoped_context` 不含 `global:""` 的条目
  - 步骤 4：`scoped_context` 包含 `global:""` 的条目
- **通过标准**：
  - `include_global=false` 不返回 global → PASS
  - `include_global=true` 返回 global → PASS
- **数据清理**：无
- **风险**：无

---

### 维度 B：写入正确性

#### B-01 写入 rule 类型记忆

- **优先级**：P0
- **关联维度**：B
- **场景描述**：用户纠正助手「所有回复使用中文」，助手写入 global rule
- **前置条件**：无
- **执行步骤**：

```text
1. memory_log(
     contract_version=2,
     slot_key="test:lang-rule",
     content="测试用例：所有回复使用中文",
     scope={type: "global", key: ""},
     item_kind="rule",
     priority=100,
     enforcement="hard",
     source="correction"
   )
2. 验证写入成功（返回含 item_id）
3. memory_rules(
     contract_version=2,
     slot_key="test:lang-rule",
     status="active"
   )
4. 验证查询到该条目且字段正确
```

- **预期结果**：
  - 步骤 2：返回成功，含 `item_id`（正整数）
  - 步骤 4：查询到 1 条，`item_kind="rule"`、`scope_type="global"`、`scope_key=""`、`priority=100`、`enforcement="hard"`、`source="correction"`
- **通过标准**：
  - 写入成功且审计一致 → PASS
- **数据清理**：

```text
memory_forget(
  contract_version=2,
  item_id=<步骤2返回的item_id>,
  reason="测试用例 B-01 清理"
)
```

- **风险**：清理失败则残留一条 test: 前缀的 global rule

---

#### B-02 写入 decision 类型记忆

- **优先级**：P0
- **关联维度**：B
- **场景描述**：用户在项目中确认一个架构决策
- **前置条件**：无
- **执行步骤**：

```text
1. memory_log(
     contract_version=2,
     slot_key="test:arch-decision",
     content="测试用例：选择 NIVC 方案而非 IVC",
     scope={type: "project", key: "test-phantom-project"},
     item_kind="decision",
     related_files=["20_项目/Agent可信执行密码学栈.md"]
   )
2. 验证写入成功
3. memory_context(
     contract_version=2,
     scopes=[{type: "project", key: "test-phantom-project"}],
     include_global=false,
     include_related_files=true
   )
4. 验证 context 召回该 decision
```

- **预期结果**：
  - 步骤 2：返回成功，含 `item_id`
  - 步骤 4：`scoped_context` 中包含该 decision 条目，`related_files` 含指定路径
- **通过标准**：
  - 写入成功 → PASS
  - context 正确召回 → PASS
- **数据清理**：

```text
memory_forget(
  contract_version=2,
  item_id=<item_id>,
  reason="测试用例 B-02 清理"
)
```

- **风险**：低

---

#### B-03 写入 fact 与 profile 类型

- **优先级**：P1
- **关联维度**：B
- **场景描述**：写入一条仓库事实和一条用户画像
- **前置条件**：无
- **执行步骤**：

```text
1. memory_log(
     contract_version=2,
     slot_key="test:repo-path",
     content="测试用例：lifeos 仓库路径为 /Users/luneth/code/node/lifeos",
     scope={type: "repository", key: "lifeos"},
     item_kind="fact"
   )
→ 记录 fact_item_id

2. memory_log(
     contract_version=2,
     slot_key="test:work-style",
     content="测试用例：用户偏好深度优先学习",
     scope={type: "global", key: ""},
     item_kind="profile"
   )
→ 记录 profile_item_id

3. memory_rules(contract_version=2, item_kind="fact", slot_key="test:repo-path")
→ 验证 fact 存在

4. memory_rules(contract_version=2, item_kind="profile", slot_key="test:work-style")
→ 验证 profile 存在
```

- **预期结果**：两次写入均成功，审计均可查到
- **通过标准**：两条均写入成功且审计匹配 → PASS
- **数据清理**：

```text
memory_forget(contract_version=2, item_id=<fact_item_id>, reason="B-03 清理")
memory_forget(contract_version=2, item_id=<profile_item_id>, reason="B-03 清理")
```

- **风险**：低

---

#### B-04 correction 不可被 preference 降级

- **优先级**：P0
- **关联维度**：B
- **场景描述**：用户先纠正（correction）一条规则，后续偏好（preference）写入同一 slot_key 不能降低 source 等级
- **前置条件**：无
- **执行步骤**：

```text
1. memory_log(
     contract_version=2,
     slot_key="test:no-downgrade",
     content="测试：纠正版本内容",
     scope={type: "global", key: ""},
     item_kind="rule",
     source="correction"
   )
→ 记录 item_id_1

2. memory_log(
     contract_version=2,
     slot_key="test:no-downgrade",
     content="测试：偏好版本内容（试图降级）",
     scope={type: "global", key: ""},
     item_kind="rule",
     source="preference"
   )
→ 记录返回

3. memory_rules(
     contract_version=2,
     slot_key="test:no-downgrade",
     status="active"
   )
→ 检查 source 字段
```

- **预期结果**：
  - 步骤 2：写入成功（内容可被覆盖），但 `source` 保持 `correction`（不降级为 `preference`）
  - 步骤 3：活跃条目的 `source` 仍为 `correction`
- **通过标准**：
  - 活跃条目 `source="correction"` → PASS
  - 若 `source` 变为 `preference` → FAIL
- **数据清理**：

```text
memory_forget(contract_version=2, item_id=<活跃条目id>, reason="B-04 清理")
```

- **风险**：低

---

#### B-05 slot_key 覆盖语义

- **优先级**：P0
- **关联维度**：B
- **场景描述**：同一 `(scope_type, scope_key, slot_key)` 再次写入应覆盖旧条目——实现为原地更新（`upsertMemoryItem` 对既有行执行 UPDATE，`item_id` 不变，不产生归档历史行）
- **前置条件**：无
- **执行步骤**：

```text
1. memory_log(
     contract_version=2,
     slot_key="test:overwrite-test",
     content="测试：第一版内容",
     scope={type: "skill", key: "ask"},
     item_kind="rule"
   )
→ 记录返回的 item_id 与 action（预期 action=created）

2. memory_log(
     contract_version=2,
     slot_key="test:overwrite-test",
     content="测试：第二版内容（覆盖）",
     scope={type: "skill", key: "ask"},
     item_kind="rule"
   )
→ 记录返回的 item_id 与 action（预期 action=updated，item_id 与步骤 1 相同）

3. memory_rules(
     contract_version=2,
     slot_key="test:overwrite-test",
     status="active"
   )
→ 检查只有一条活跃且为 v2 内容

4. memory_rules(
     contract_version=2,
     slot_key="test:overwrite-test",
     status="archived"
   )
→ 检查无归档残留（覆盖是原地更新，不产生 v1 归档行）
```

- **预期结果**：
  - 步骤 2：返回 `action="updated"`，`item_id` 与步骤 1 相同（原地 UPDATE，非新行）
  - 步骤 3：仅 1 条活跃，`content` 含「第二版内容」
  - 步骤 4：0 条 archived（覆盖不产生归档历史）
- **通过标准**：
  - 同一 item_id 原地更新且内容为 v2 → PASS
  - 活跃唯一、无归档残留 → PASS
- **数据清理**：

```text
memory_forget(contract_version=2, item_id=<返回的item_id>, reason="B-05 清理")
```

- **风险**：低

---

#### B-06 plan/draft file scope 拦截

- **优先级**：P0
- **关联维度**：B
- **场景描述**：尝试为 `type: plan` 的文件写入 file scope 记忆，预期被源码层拦截拒绝
- **前置条件**：Vault 中存在一个 `type: plan` 的文件（如本文档 `60_计划/lifeos记忆系统改进计划.md`）
- **执行步骤**：

```text
1. memory_log(
     contract_version=2,
     slot_key="test:plan-file-block",
     content="测试：不应被接受的 plan file scope 记忆",
     scope={type: "file", key: "60_计划/lifeos记忆系统改进计划.md"},
     item_kind="fact"
   )
2. 检查返回是否为拒绝/错误
```

- **预期结果**：
  - 返回错误，明确拒绝为 plan/draft 类型文件写入 file scope 记忆
- **通过标准**：
  - 写入被拒绝 → PASS
  - 写入成功 → FAIL（清理后报告）
- **数据清理**：若意外写入成功，用返回的 item_id 执行 `memory_forget`
- **风险**：低（拦截是源码层硬约束）

---

#### B-07 event 类型拒绝写入

- **优先级**：P0
- **关联维度**：B
- **场景描述**：尝试写入 `item_kind="event"`，预期被拒绝
- **前置条件**：无
- **执行步骤**：

```text
1. memory_log(
     contract_version=2,
     slot_key="test:event-block",
     content="测试：一次性事件",
     scope={type: "global", key: ""},
     item_kind="event"
   )
2. 检查返回
```

- **预期结果**：
  - 业务层校验拒绝（`upsertMemoryItem` 显式抛 `MemoryItemValidationError: event 不能通过 memory_log 新建或更新`），返回错误
- **通过标准**：
  - 写入被拒绝 → PASS
- **数据清理**：无（写入未成功）
- **风险**：无

---

#### B-08 global key 必须为空

- **优先级**：P1
- **关联维度**：B
- **场景描述**：global scope 的 key 必须为空字符串
- **前置条件**：无
- **执行步骤**：

```text
1. memory_log(
     contract_version=2,
     slot_key="test:global-key-check",
     content="测试：global key 非空",
     scope={type: "global", key: "some-key"},
     item_kind="rule"
   )
2. 检查是否被拒绝或产生异常行为
```

- **预期结果**：
  - 写入被拒绝或 key 被规范化为空字符串
- **通过标准**：
  - 不允许 global 使用非空 key → PASS
- **数据清理**：若写入成功则 forget
- **风险**：低

---

#### B-09 priority 与 enforcement 边界值

- **优先级**：P2
- **关联维度**：B
- **场景描述**：验证 priority 边界（0, 100）和 enforcement 枚举（hard, soft）
- **前置条件**：无
- **执行步骤**：

```text
1. memory_log(
     contract_version=2,
     slot_key="test:priority-min",
     content="测试：最低优先级",
     scope={type: "global", key: ""},
     item_kind="fact",
     priority=0,
     enforcement="soft"
   )
→ 预期成功

2. memory_log(
     contract_version=2,
     slot_key="test:priority-max",
     content="测试：最高优先级",
     scope={type: "global", key: ""},
     item_kind="rule",
     priority=100,
     enforcement="hard"
   )
→ 预期成功

3. memory_log(
     contract_version=2,
     slot_key="test:priority-overflow",
     content="测试：超出范围",
     scope={type: "global", key: ""},
     item_kind="fact",
     priority=101
   )
→ 预期 schema 拒绝（maximum: 100）
```

- **预期结果**：步骤 1、2 成功；步骤 3 被 schema 拒绝
- **通过标准**：边界值可写、超界被拒 → PASS
- **数据清理**：forget 步骤 1、2 写入的条目
- **风险**：低

---

### 维度 C：召回与检索

#### C-01 context 召回精确度——写入后立即召回

- **优先级**：P0
- **关联维度**：C
- **场景描述**：写入一条 skill scope 的 rule 后，通过 context 验证立即可召回
- **前置条件**：无
- **执行步骤**：

```text
1. memory_log(
     contract_version=2,
     slot_key="test:recall-rule",
     content="测试：复习时使用费曼方法解释概念",
     scope={type: "skill", key: "revise"},
     item_kind="rule"
   )
→ 记录 item_id

2. memory_context(
     contract_version=2,
     scopes=[{type: "skill", key: "revise"}],
     include_global=false
   )

3. 在返回的 scoped_context 中搜索「费曼方法」
```

- **预期结果**：
  - 步骤 3：找到含「费曼方法」的 rule 条目
- **通过标准**：
  - 写入后 context 立即可召回 → PASS
- **数据清理**：`memory_forget(contract_version=2, item_id=<item_id>, reason="C-01 清理")`
- **风险**：低

---

#### C-02 query 中文关键词召回（bm25 排序验证）

- **优先级**：P0
- **关联维度**：C、H
- **场景描述**：验证 v2.3.0 的 bm25 排序改进——中文查询「群论」应优先命中 `search_hints` 含该词的笔记，而非按时间序排列
- **前置条件**：Vault 中存在群论相关知识笔记（如 `40_知识/百科/Math/群（Group）.md` 等）
- **执行步骤**：

```text
1. memory_query(
     contract_version=2,
     query="群论",
     limit=10
   )
2. 检查返回结果排序
```

- **预期结果**：
  - 返回结果中，`search_hints` 直接含「群论」token 的笔记排在前列
  - 排序不再是纯 `modified_at DESC`，而是由 bm25 相关性主导
  - 改进计划 P1-3 权重：`file_path=0, title=4, summary=3, search_hints=10, tags=2`
- **通过标准**：
  - `search_hints` 含查询词的结果排名 ≤ 3 → PASS（验证 bm25 排序生效）
  - 若结果纯按时间排序 → FAIL
- **数据清理**：无（只读操作）
- **风险**：无

---

#### C-03 query 英文关键词召回

- **优先级**：P1
- **关联维度**：C
- **场景描述**：英文查询「Group Action」验证跨语言检索
- **前置条件**：Vault 中存在 `40_知识/百科/Math/群作用（Group Action）.md`
- **执行步骤**：

```text
1. memory_query(
     contract_version=2,
     query="Group Action",
     limit=10
   )
2. 检查结果是否包含群作用相关笔记
```

- **预期结果**：
  - 返回结果包含「群作用（Group Action）」相关笔记
- **通过标准**：
  - 群作用笔记出现在结果中 → PASS
- **数据清理**：无
- **风险**：无

---

#### C-04 query 中文单字召回（CJK 前缀通配验证）

- **优先级**：P0
- **关联维度**：C、H
- **场景描述**：验证 v2.3.0 P3-3 CJK 前缀通配改进——单字中文查询「群」能命中以「群」开头 token 的笔记
- **前置条件**：Vault 中存在群论相关笔记
- **执行步骤**：

```text
1. memory_query(
     contract_version=2,
     query="群",
     limit=10
   )
2. 检查结果是否有命中
```

- **预期结果**：
  - 返回 ≥1 条结果（v2.3.0 前缀通配使单字中文可命中）
  - 命中的笔记中 `search_hints` 含以「群」开头的 token
- **通过标准**：
  - 单字中文查询有结果返回 → PASS
  - 零结果 → FAIL（CJK 前缀通配未生效）
- **数据清理**：无
- **风险**：前缀通配可能引入假阳性（如「群」命中所有以群开头的 token），在 205 条规模下由 bm25 吸收

---

#### C-05 query 按 type 过滤

- **优先级**：P1
- **关联维度**：C
- **场景描述**：使用 `filters` 限定只查 `type: project`
- **前置条件**：Vault 中存在 `type: project` 的文件
- **执行步骤**：

```text
1. memory_query(
     contract_version=2,
     query="",
     filters={"type": "project"},
     limit=10
   )
2. 验证所有结果的 type 均为 project
```

- **预期结果**：
  - 返回结果中每条的 `type` 字段均为 `project`
- **通过标准**：
  - 所有结果 `type=="project"` → PASS
- **数据清理**：无
- **风险**：无

---

#### C-06 噪声防护——闲聊不查 Vault

- **优先级**：P0
- **关联维度**：C
- **场景描述**：用户闲聊（如「今天天气怎么样」），按协议助手不应调用 `memory_query`，也不应添加无关 scope
- **前置条件**：已完成 bootstrap + `skill:ask` context 加载
- **执行步骤**：

```text
1. 向助手发送「今天天气怎么样」
2. 观察助手是否调用 memory_query
3. 观察助手是否在 context 中添加无关 project/file scope
```

- **预期结果**：
  - 助手直接回答，不调用 `memory_query`
  - 不添加 project/file 等无关 scope 到 context
- **通过标准**：
  - 无 `memory_query` 调用且无无关 scope → PASS
  - 行为判定：通过 MCP 调用日志或会话转录验证
- **数据清理**：无
- **风险**：本用例依赖观察助手行为，存在主观判定空间；建议记录 MCP 调用日志作为证据

---

### 维度 D：学习工作流全链路

#### D-01 /today——日记生成与 TaskBoard 记忆

- **优先级**：P0
- **关联维度**：D
- **场景描述**：用户说「/today」，助手生成今日日记，验证记忆系统正确参与
- **前置条件**：已配置 TaskBoard.md；有活跃项目
- **执行步骤**：

```text
1. memory_bootstrap()
→ 验证 layer0 含 taskboard_focus

2. memory_context(
     contract_version=2,
     scopes=[{type: "skill", key: "today"}],
     include_global=false
   )
→ 验证 skill:today 规则加载

3. memory_query(
     contract_version=2,
     filters={"type": "project", "status": "active"},
     limit=10
   )
→ 验证返回活跃项目列表

4. 观察助手生成日记后是否调用 memory_notify
```

- **预期结果**：
  - bootstrap 含 TaskBoard 焦点
  - query 返回活跃项目
  - 日记创建后调用 `memory_notify(contract_version=2, file_path="10_日记/YYYY-MM-DD.md")`
- **通过标准**：
  - 完整链路（bootstrap → context → query → 生成 → notify）均正确 → PASS
- **数据清理**：无（日记文件为真实产出，非测试数据）
- **风险**：会创建真实日记文件（属于正常操作）

---

#### D-02 /ask——问答路由与噪声防护

- **优先级**：P0
- **关联维度**：D
- **场景描述**：用户提问一个通用知识问题（如「什么是群同态」），验证 /ask 正确路由且不过度查询
- **前置条件**：已完成 bootstrap
- **执行步骤**：

```text
1. memory_context(
     contract_version=2,
     scopes=[{type: "skill", key: "ask"}],
     include_global=false
   )

2. 向助手提问「什么是群同态」
3. 观察助手是否适当引用 Vault 中已有的群同态百科（memory_query 按需）
4. 观察助手是否将此次一次性问答写入 memory_log（不应写入）
```

- **预期结果**：
  - 助手可能查询 Vault 中群同态相关笔记作为参考（合理行为）
  - 不将此次问答结果写入 memory_log（一次性问答属于 event）
- **通过标准**：
  - 回答质量合理 → PASS
  - 未写入 memory_log → PASS
- **数据清理**：无
- **风险**：低

---

#### D-03 /brainstorm——头脑风暴静默检索

- **优先级**：P1
- **关联维度**：D
- **场景描述**：用户启动头脑风暴讨论「密码学在 AI Agent 中的应用」，验证 Phase 0 静默检索
- **前置条件**：已完成 bootstrap；Vault 中有密码学相关项目
- **执行步骤**：

```text
1. memory_context(
     contract_version=2,
     scopes=[{type: "skill", key: "brainstorm"}],
     include_global=false
   )

2. memory_query(
     contract_version=2,
     query="密码学 Agent",
     limit=5
   )
→ 验证静默检索返回相关笔记

3. 观察助手在开场白中是否自然引用检索结果（不对用户报告搜索过程）
```

- **预期结果**：
  - query 返回密码学或 Agent 相关笔记
  - 助手开场白中自然融入而非机械列举搜索结果
- **通过标准**：
  - 静默检索有结果 → PASS
  - 开场白自然引用 → PASS（主观判定）
- **数据清理**：无
- **风险**：低

---

#### D-04 /project——项目创建与记忆验证

- **优先级**：P1
- **关联维度**：D
- **场景描述**：（观察性验证）项目创建后 memory_context 应能解析项目 scope
- **前置条件**：Vault 中存在已创建项目 `crypto-agile-policy-aware-nivc`
- **执行步骤**：

```text
1. memory_context(
     contract_version=2,
     scopes=[{type: "project", key: "crypto-agile-policy-aware-nivc"}],
     include_global=false,
     include_related_files=false
   )
→ 验证项目 scope 可正常解析

2. memory_query(
     contract_version=2,
     query="",
     filters={"type": "project"},
     limit=10
   )
→ 验证项目出现在索引中
```

- **预期结果**：
  - context 正常返回（无 unresolvedScopes）
  - query 返回含该项目
- **通过标准**：
  - 项目 scope 可解析且出现在索引中 → PASS
- **数据清理**：无
- **风险**：无

---

#### D-05 /knowledge——知识整理后 notify 与 context 更新

- **优先级**：P0
- **关联维度**：D
- **场景描述**：知识笔记生成后调用 notify，验证索引更新；若有项目绑定，context 可召回项目规则
- **前置条件**：Vault 中存在知识笔记（如 `40_知识/百科/Math/群（Group）.md`）
- **执行步骤**：

```text
1. memory_context(
     contract_version=2,
     scopes=[
       {type: "skill", key: "knowledge"},
       {type: "project", key: "crypto-agile-policy-aware-nivc"}
     ],
     include_global=false
   )
→ 验证双 scope 加载

2. memory_notify(
     contract_version=2,
     file_path="40_知识/百科/Math/群（Group）.md"
   )
→ 验证 notify 对已存在文件返回成功

3. memory_query(
     contract_version=2,
     query="群",
     filters={"type": "wiki"},
     limit=5
   )
→ 验证该笔记在索引中可检索到
```

- **预期结果**：
  - context 返回两个 scope 的内容
  - notify 成功
  - query 返回包含群相关百科
- **通过标准**：
  - 全链路正常 → PASS
- **数据清理**：无
- **风险**：notify 会触发该文件重新索引，但不改变文件内容

---

#### D-06 /revise——复习时加载项目规则与画像

- **优先级**：P0
- **关联维度**：D
- **场景描述**：用户触发复习，助手应加载 skill:revise 和关联项目的规则（如薄弱点画像），用于出题偏重
- **前置条件**：存在 `skill:revise` 和项目作用域的记忆条目
- **执行步骤**：

```text
1. memory_context(
     contract_version=2,
     scopes=[
       {type: "skill", key: "revise"},
       {type: "project", key: "crypto-agile-policy-aware-nivc"}
     ],
     include_global=false,
     include_related_files=true
   )
→ 检查是否含该项目的 profile:weak.* 或 profile:strong.* 画像

2. memory_query(
     contract_version=2,
     query="",
     filters={"type": "knowledge", "status": "review"},
     limit=10
   )
→ 验证能查到待复习笔记
```

- **预期结果**：
  - context 含项目画像（如有）；至少含 skill:revise 的规则
  - query 返回 status=review 的知识笔记（如有）
- **通过标准**：
  - context 正常加载两个 scope → PASS
  - query 过滤正确 → PASS
- **数据清理**：无
- **风险**：无

---

#### D-07 /research——研究计划避重检查

- **优先级**：P1
- **关联维度**：D
- **场景描述**：启动研究前，Phase 0 检索 Vault 避免重复研究
- **前置条件**：Vault 中存在研究报告 `30_研究/AI/空间智能设计哲学_两条路线的分析.md`
- **执行步骤**：

```text
1. memory_context(
     contract_version=2,
     scopes=[{type: "skill", key: "research"}],
     include_global=false
   )

2. memory_query(
     contract_version=2,
     query="空间智能",
     filters={"type": "research"},
     limit=5
   )
→ 验证返回已有研究报告
```

- **预期结果**：
  - query 返回空间智能相关的已有研究报告
- **通过标准**：
  - 已有报告出现在结果中 → PASS
- **数据清理**：无
- **风险**：无

---

#### D-08 /digest——周报技能 scope 加载

- **优先级**：P2
- **关联维度**：D
- **场景描述**：验证 digest 技能的 skill scope 加载
- **前置条件**：无
- **执行步骤**：

```text
1. memory_context(
     contract_version=2,
     scopes=[{type: "skill", key: "digest"}],
     include_global=false
   )
→ 验证 skill:digest 上下文加载成功
```

- **预期结果**：
  - 返回 skill:digest 的规则/决策（如有）
- **通过标准**：
  - 加载成功（无错误） → PASS
- **数据清理**：无
- **风险**：无

---

#### D-09 /archive——归档后项目记忆清理

- **优先级**：P0
- **关联维度**：D、F
- **场景描述**：项目归档后应调用 `memory_forget` 批量归档该项目 scope 下的记忆，且归档后 context 不再召回
- **前置条件**：无（使用测试幻影项目）
- **执行步骤**：

```text
1. memory_log(
     contract_version=2,
     slot_key="test:archive-rule",
     content="测试：归档前的项目规则",
     scope={type: "project", key: "test-phantom-project"},
     item_kind="rule"
   )
→ 记录 item_id

2. memory_context(
     contract_version=2,
     scopes=[{type: "project", key: "test-phantom-project"}],
     include_global=false
   )
→ 验证可召回该 rule

3. memory_forget(
     contract_version=2,
     scope={type: "project", key: "test-phantom-project"},
     reason="测试用例 D-09：模拟项目归档"
   )
→ 批量归档

4. memory_context(
     contract_version=2,
     scopes=[{type: "project", key: "test-phantom-project"}],
     include_global=false
   )
→ 验证不再召回
```

- **预期结果**：
  - 步骤 2：召回含「归档前的项目规则」
  - 步骤 3：批量归档成功
  - 步骤 4：该 scope 无活跃条目
- **通过标准**：
  - 归档前可召回，归档后不可召回 → PASS
- **数据清理**：步骤 3 已完成清理（归档即清理）
- **风险**：低

---

#### D-10 /archive——global 禁止批量归档

- **优先级**：P0
- **关联维度**：D、F
- **场景描述**：验证 `memory_forget` 对 global scope 禁止批量归档
- **前置条件**：无
- **执行步骤**：

```text
1. memory_forget(
     contract_version=2,
     scope={type: "global", key: ""},
     reason="测试：尝试批量归档 global"
   )
→ 预期被拒绝
```

- **预期结果**：
  - 返回错误，明确拒绝对 global 批量归档
- **通过标准**：
  - 操作被拒绝 → PASS
- **数据清理**：无
- **风险**：若意外成功，所有 global 记忆将被归档——**高风险**，但源码层应拦截

---

### 维度 E：上下文恢复

#### E-01 Compaction 后新会话恢复项目上下文

- **优先级**：P0
- **关联维度**：E
- **场景描述**：模拟 compaction 后新会话启动，仅凭记忆系统恢复项目上下文（规则、决策、画像被正确召回）
- **前置条件**：Vault 中存在真实项目记忆条目
- **执行步骤**：

```text
1. 在新会话中执行 memory_bootstrap()
→ 获取 Layer 0（含 TaskBoard 焦点和 available_projects）

2. 从 scope_hints.available_projects 中取出活跃项目 ID

3. memory_context(
     contract_version=2,
     scopes=[
       {type: "skill", key: "knowledge"},
       {type: "project", key: "<活跃项目ID>"}
     ],
     include_global=false,
     include_related_files=true
   )
→ 验证项目规则、决策、画像被召回

4. 检查 related_files 是否指向真实存在的文件
```

- **预期结果**：
  - bootstrap 提供足够信息定位项目
  - context 返回该项目的所有活跃规则、决策、画像
  - related_files 路径均指向存在的文件
- **通过标准**：
  - 最近更新的规则/决策/画像条目均被召回（对照 memory_rules 审计结果抽查）；条目总数不作为硬断言（context 可能受 token 预算省略超长条目） → PASS
- **数据清理**：无
- **风险**：无

---

#### E-02 写入后跨会话召回

- **优先级**：P0
- **关联维度**：E
- **场景描述**：在会话 A 写入一条 skill rule，在模拟的「新会话」中验证可召回
- **前置条件**：无
- **执行步骤**：

```text
1. memory_log(
     contract_version=2,
     slot_key="test:cross-session",
     content="测试：跨会话持久化规则",
     scope={type: "skill", key: "revise"},
     item_kind="rule"
   )
→ 记录 item_id

2. （模拟新会话）memory_bootstrap()

3. memory_context(
     contract_version=2,
     scopes=[{type: "skill", key: "revise"}],
     include_global=false
   )
→ 验证「跨会话持久化规则」被召回
```

- **预期结果**：
  - 步骤 3 的 scoped_context 包含「跨会话持久化规则」
- **通过标准**：
  - 跨会话正确召回 → PASS
- **数据清理**：`memory_forget(contract_version=2, item_id=<item_id>, reason="E-02 清理")`
- **风险**：低

---

### 维度 F：治理与遗忘

#### F-01 memory_rules 审计过滤

- **优先级**：P0
- **关联维度**：F
- **场景描述**：使用 memory_rules 按 kind、scope、status 过滤审计记忆条目
- **前置条件**：Vault 中有活跃记忆条目
- **执行步骤**：

```text
1. memory_rules(
     contract_version=2,
     item_kind="rule",
     status="active",
     limit=100
   )
→ 验证只返回 active rule

2. memory_rules(
     contract_version=2,
     scope={type: "global", key: ""},
     status="active"
   )
→ 验证只返回 global 活跃条目

3. memory_rules(
     contract_version=2,
     status="archived",
     limit=50
   )
→ 验证返回已归档条目
```

- **预期结果**：
  - 步骤 1：所有返回条目 `item_kind="rule"` 且 `status="active"`
  - 步骤 2：所有返回条目 `scope_type="global"`
  - 步骤 3：所有返回条目 `status="archived"`
- **通过标准**：
  - 过滤条件精确匹配 → PASS
- **数据清理**：无
- **风险**：无

---

#### F-02 forget 软归档 + reason 必填

- **优先级**：P0
- **关联维度**：F
- **场景描述**：验证 forget 是软归档（status=archived 而非删除），且 reason 必填
- **前置条件**：无
- **执行步骤**：

```text
1. memory_log(
     contract_version=2,
     slot_key="test:forget-soft",
     content="测试：将被软归档的条目",
     scope={type: "global", key: ""},
     item_kind="fact"
   )
→ 记录 item_id

2. memory_forget(
     contract_version=2,
     item_id=<item_id>,
     reason="F-02 测试：验证软归档"
   )

3. memory_rules(
     contract_version=2,
     slot_key="test:forget-soft",
     status="archived"
   )
→ 验证条目变为 archived 而非被删除

4. memory_forget(
     contract_version=2,
     item_id=999999
   )
→ 预期失败（缺少 reason 字段）
```

- **预期结果**：
  - 步骤 3：找到 1 条 `status="archived"` 的条目
  - 步骤 4：schema 验证拒绝（reason 是 required）
- **通过标准**：
  - 归档后可审计到 → PASS
  - 无 reason 被拒 → PASS
- **数据清理**：已由步骤 2 归档
- **风险**：低

---

#### F-03 归档后 context 不再召回

- **优先级**：P0
- **关联维度**：F
- **场景描述**：归档的条目不应被 context 召回
- **前置条件**：无
- **执行步骤**：

```text
1. memory_log(
     contract_version=2,
     slot_key="test:archived-invisible",
     content="测试：归档后应不可见",
     scope={type: "skill", key: "ask"},
     item_kind="rule"
   )
→ 记录 item_id

2. memory_context(
     contract_version=2,
     scopes=[{type: "skill", key: "ask"}],
     include_global=false
   )
→ 验证可召回

3. memory_forget(
     contract_version=2,
     item_id=<item_id>,
     reason="F-03 测试"
   )

4. memory_context(
     contract_version=2,
     scopes=[{type: "skill", key: "ask"}],
     include_global=false
   )
→ 验证不再召回
```

- **预期结果**：
  - 步骤 2：包含「归档后应不可见」
  - 步骤 4：不包含该条目
- **通过标准**：
  - 归档前可见，归档后不可见 → PASS
- **数据清理**：已由步骤 3 归档
- **风险**：低

---

#### F-04 forget item_id 与 scope 互斥

- **优先级**：P1
- **关联维度**：F
- **场景描述**：同时传入 item_id 和 scope 应报错
- **前置条件**：无
- **执行步骤**：

```text
1. memory_forget(
     contract_version=2,
     item_id=1,
     scope={type: "skill", key: "ask"},
     reason="测试互斥"
   )
→ 预期报错
```

- **预期结果**：
  - 返回错误，提示 item_id 与 scope 互斥
- **通过标准**：
  - 互斥校验生效 → PASS
- **数据清理**：无
- **风险**：无

---

### 维度 G：变更同步

#### G-01 notify 修改已有文件

- **优先级**：P0
- **关联维度**：G
- **场景描述**：对已索引文件调用 notify，验证索引更新
- **前置条件**：Vault 中存在 `20_项目/Agent可信执行密码学栈.md` 且已索引
- **执行步骤**：

```text
1. memory_query(
     contract_version=2,
     query="",
     filters={"type": "project"},
     limit=5
   )
→ 记录该项目在索引中的 modified_at

2. memory_notify(
     contract_version=2,
     file_path="20_项目/Agent可信执行密码学栈.md"
   )
→ 验证返回成功

3. memory_query(
     contract_version=2,
     query="",
     filters={"type": "project"},
     limit=5
   )
→ 检查该项目是否被重新索引（modified_at 可能更新）
```

- **预期结果**：
  - notify 返回成功
  - 后续 query 可检索到该文件
- **通过标准**：
  - notify 无错误，文件仍可检索 → PASS
- **数据清理**：无（不修改文件内容）
- **风险**：低（notify 会触发重索引但不改内容）

---

#### G-02 notify 删除文件（不存在路径）

- **优先级**：P1
- **关联维度**：G
- **场景描述**：对不存在的文件路径调用 notify，模拟文件删除后的索引清理
- **前置条件**：无
- **执行步骤**：

```text
1. memory_notify(
     contract_version=2,
     file_path="40_知识/笔记/不存在的文件.md"
   )
→ 检查返回（应正常处理，将该路径从索引中移除）
```

- **预期结果**：
  - 返回成功或提示文件不存在（不应报错崩溃）
- **通过标准**：
  - 无异常 → PASS
- **数据清理**：无
- **风险**：低

---

#### G-03 notify 文件移动（previous_file_path）

- **优先级**：P0
- **关联维度**：G
- **场景描述**：文件移动/重命名后，同时传入新旧路径，验证路径迁移
- **前置条件**：存在已索引文件；本用例不实际移动文件，仅验证参数处理
- **执行步骤**：

```text
1. memory_notify(
     contract_version=2,
     file_path="40_知识/百科/Math/群（Group）.md",
     previous_file_path="40_知识/百科/Math/旧名称.md"
   )
→ 检查返回

# 注：此调用中 previous_file_path 指向一个不存在的旧路径，
# 模拟的是「文件已从旧路径移动到新路径」的场景。
# 新路径文件存在且可被重索引。
```

- **预期结果**：
  - 返回成功
  - 旧路径 `旧名称.md` 如在索引中应被移除
  - 新路径文件被重索引
- **通过标准**：
  - 无异常，新路径可检索 → PASS
- **数据清理**：无
- **风险**：低

---

#### G-04 notify read-after-write 一致性

- **优先级**：P1
- **关联维度**：G
- **场景描述**：显式 notify 后立即 query，验证 read-after-write 一致性
- **前置条件**：存在已索引文件
- **执行步骤**：

```text
1. memory_notify(
     contract_version=2,
     file_path="40_知识/百科/Math/群公理.md"
   )

2. memory_query(
     contract_version=2,
     query="群公理",
     limit=5
   )
→ 验证「群公理」出现在结果中
```

- **预期结果**：
  - notify 后 query 立即可检索到更新后的内容
- **通过标准**：
  - read-after-write 无延迟 → PASS
- **数据清理**：无
- **风险**：低

---

### 维度 H：改进计划验收

#### H-01 P1-1 auto_vacuum 设置验证

- **优先级**：P0
- **关联维度**：H
- **场景描述**：验证 v2.3.0 后数据库 `auto_vacuum = 2`（INCREMENTAL）
- **前置条件**：LifeOS v2.3.0 已安装；数据库已被 v2.3.0 打开过
- **执行步骤**：

```text
1. 通过 sqlite3 只读查询：
   sqlite3 90_系统/记忆/memory.db "PRAGMA auto_vacuum;"
→ 预期返回 2
```

- **预期结果**：`auto_vacuum = 2`
- **通过标准**：
  - 返回值 = 2 → PASS
  - 返回值 ≠ 2 → FAIL
- **数据清理**：无（只读）
- **风险**：无

---

#### H-02 P1-1/P3-2 freelist 与 page_count 指标

- **优先级**：P0
- **关联维度**：H
- **场景描述**：验证 `doctor --compact-db` 执行后 freelist 比例符合验收标准
- **前置条件**：v2.3.0 `doctor --compact-db` 已执行过（据改进计划进展记录，v2.3.0 已发布）
- **执行步骤**：

```text
1. sqlite3 90_系统/记忆/memory.db "SELECT * FROM (SELECT page_count FROM pragma_page_count), (SELECT freelist_count FROM pragma_freelist_count);"
→ 计算 freelist_count / page_count

2. 验证 < 0.05
```

- **预期结果**：`freelist_count / page_count < 0.05`
- **通过标准**：
  - 比值 < 0.05 → PASS
  - 比值 ≥ 0.05 → FAIL（doctor --compact-db 未执行或未生效）
- **数据清理**：无
- **风险**：无

---

#### H-03 P3-2 WAL 截断验证

- **优先级**：P1
- **关联维度**：H
- **场景描述**：验证 `runDbMaintenance` 中的 `wal_checkpoint(TRUNCATE)` 效果
- **前置条件**：MCP 已启动过（startup 会执行 runDbMaintenance）
- **执行步骤**：

```text
1. ls -la 90_系统/记忆/memory.db-wal
→ 检查 -wal 文件大小

# 注：TRUNCATE checkpoint 后 -wal 应被截断为 0 字节或很小
# 但后续操作可能再写入，所以只要 -wal 不持续膨胀即可
```

- **预期结果**：`-wal` 文件存在且大小合理（非持续膨胀到 MB 级）
- **通过标准**：
  - `-wal` 文件 < 1MB → PASS
  - `-wal` 文件 > 10MB → FAIL
- **数据清理**：无
- **风险**：无

---

#### H-04 P3-2 doctor 告警验证

- **优先级**：P1
- **关联维度**：H
- **场景描述**：验证 doctor 对 freelist/auto_vacuum/memory_items 的告警逻辑
- **前置条件**：v2.3.0 已安装
- **执行步骤**：

```text
1. lifeos doctor（全局 CLI；v2.3.0 起支持 --compact-db / --reindex flag）
→ 检查输出中：
   - 若 freelist > 50%：应有 warn
   - 若 auto_vacuum ≠ 2：应有 warn
   - 若 memory_items > 1000：应有 warn
   - 当前环境（freelist < 5%, auto_vacuum=2, items≈47）：应全部 OK
```

- **预期结果**：当前环境下 doctor 无告警（所有指标正常）
- **通过标准**：
  - 无 warn → PASS（指标正常情况下）
- **数据清理**：无
- **风险**：无

---

#### H-05 P1-3 bm25 中文排序场景

- **优先级**：P0
- **关联维度**：H
- **场景描述**：验证 bm25 排序在中文查询场景下的实际效果——`search_hints` 权重最高（10）
- **前置条件**：Vault 含多条 Math 相关 Wiki 笔记
- **执行步骤**：

```text
1. memory_query(
     contract_version=2,
     query="同构",
     limit=10
   )
→ 检查「同构（Isomorphism）」相关笔记是否排在前列

2. memory_query(
     contract_version=2,
     query="Lagrange",
     limit=10
   )
→ 检查 Lagrange 定理笔记排名
```

- **预期结果**：
  - 查询「同构」时，`search_hints` 直接含「同构」token 的笔记排名靠前
  - 查询「Lagrange」时，对应笔记排名靠前
  - 排序由 bm25 相关性驱动，不是纯时间序
- **通过标准**：
  - 目标笔记出现在结果前 3 名 → PASS
- **数据清理**：无
- **风险**：无

---

#### H-06 P2-1 别名候选诊断

- **优先级**：P1
- **关联维度**：H
- **场景描述**：验证 v2.3.0 P2-1 改进——tool scope 别名歧义时返回 candidates 列表
- **前置条件**：需要一个能触发歧义的别名；若当前 tool_bindings 只有 obsidian 一个（无歧义），则验证「无歧义正常解析」场景
- **执行步骤**：

```text
1. memory_context(
     contract_version=2,
     scopes=[{type: "tool", key: "obsidian"}],
     include_global=false
   )
→ 验证正常解析（无歧义场景）

2. memory_context(
     contract_version=2,
     scopes=[{type: "tool", key: "unknown-tool-xyz"}],
     include_global=false
   )
→ 检查 unresolvedScopes 是否包含诊断信息
```

- **预期结果**：
  - 步骤 1：正常返回，无 unresolvedScopes
  - 步骤 2：返回 `unresolvedScopes` 数组含 `{scope: {type: "tool", key: "unknown-tool-xyz"}, reason: "unknown_tool", candidates: [...]}`（candidates 可能为空或含建议）
- **通过标准**：
  - 已知工具正常解析 → PASS
  - 未知工具有诊断信息 → PASS
- **数据清理**：无
- **风险**：无

---

#### H-07 P4-1 scope_hints 仓库白名单

- **优先级**：P0
- **关联维度**：H
- **场景描述**：验证 v2.3.0 P4-1——bootstrap 返回 `available_repositories` 字段
- **前置条件**：`lifeos.yaml` 中配置了 `repository_bindings`（learningapp, lifeos）
- **执行步骤**：

```text
1. memory_bootstrap()
→ 检查 scope_hints.available_repositories
```

- **预期结果**：
  - `scope_hints.available_repositories` 精确等于 `["learningapp", "lifeos"]`（按字母序排列）
  - 内容 = `lifeos.yaml` 中 `repository_bindings` 的全部 key 排序列表
- **通过标准**：
  - `available_repositories` 存在且精确匹配 → PASS
  - 字段不存在或内容不匹配 → FAIL
- **数据清理**：无
- **风险**：无

---

#### H-08 P1-2 FTS5 optimize 效果

- **优先级**：P2
- **关联维度**：H
- **场景描述**：验证 FTS5 optimize 已在启动维护中执行（间接验证：查询性能正常）
- **前置条件**：MCP 已启动（startup 执行过 runDbMaintenance）
- **执行步骤**：

```text
1. memory_query(
     contract_version=2,
     query="群",
     limit=20
   )
→ 验证查询正常返回，无报错

2. memory_query(
     contract_version=2,
     query="密码学",
     limit=20
   )
→ 验证查询正常返回
```

- **预期结果**：
  - 两次查询均正常返回，无 FTS5 错误
- **通过标准**：
  - 查询正常 → PASS
- **数据清理**：无
- **风险**：无

---

#### H-09 P2-2 正文 4000 字覆盖验证

- **优先级**：P1
- **关联维度**：H
- **场景描述**：验证 `search_hints` 覆盖范围扩展到正文 4000 字——正文 600-4000 字区间的关键词应可被检索到
- **前置条件**：Vault 中存在正文较长（>600 字）的笔记，其 600-4000 字区间含特征性关键词
- **执行步骤**：

```text
1. 选取一篇正文较长的笔记，确认其 600-4000 字区间含特征关键词

2. memory_query(
     contract_version=2,
     query="<该特征关键词>",
     limit=10
   )
→ 验证该笔记出现在结果中

# 注：需要在执行时根据实际笔记内容确定特征关键词
# 如某篇研究报告的第二段落（>500字位置）包含独特术语
```

- **预期结果**：
  - 正文深处的关键词可被 `search_hints` 覆盖，通过 query 检索到
- **通过标准**：
  - 目标笔记出现在结果中 → PASS
  - 若需 `doctor --reindex` 后才生效，记录为前置条件
- **数据清理**：无
- **风险**：无

---

## 5 测试执行与结果记录

### 5.1 测试矩阵

| 维度 | 用例数 | P0 | P1 | P2 | 依赖 |
|---|---|---|---|---|---|
| A 会话启动与作用域路由 | 8 | 5 | 3 | 0 | 无 |
| B 写入正确性 | 9 | 6 | 2 | 1 | 无 |
| C 召回与检索 | 6 | 4 | 2 | 0 | 无 |
| D 学习工作流全链路 | 10 | 6 | 3 | 1 | A（bootstrap 前置） |
| E 上下文恢复 | 2 | 2 | 0 | 0 | A + B（需写入数据） |
| F 治理与遗忘 | 4 | 3 | 1 | 0 | B（需已写入条目） |
| G 变更同步 | 4 | 2 | 2 | 0 | 无 |
| H 改进计划验收 | 9 | 4 | 4 | 1 | 无 |
| **合计** | **52** | **32** | **17** | **3** | — |

### 5.2 执行批次建议

```text
批次 1（无依赖，可并行）：
  - A-01 ~ A-08（会话启动）
  - H-01 ~ H-04（DB 指标，独立于 MCP）
  - H-07（bootstrap 仓库白名单）

批次 2（依赖 bootstrap）：
  - C-01 ~ C-06（召回检索）
  - H-05 ~ H-06, H-08 ~ H-09（bm25/别名/FTS/正文覆盖）

批次 3（依赖写入能力）：
  - B-01 ~ B-09（写入正确性）
  - E-01 ~ E-02（上下文恢复）

批次 4（依赖写入 + 归档）：
  - F-01 ~ F-04（治理与遗忘）
  - D-09 ~ D-10（归档链路）

批次 5（完整工作流）：
  - D-01 ~ D-08（学习工作流全链路）
  - G-01 ~ G-04（变更同步）
```

先后依赖关系：

```
批次 1 ──→ 批次 2 ──→ 批次 3 ──→ 批次 4
                            ╰──→ 批次 5
```

### 5.3 结果记录模板

每个用例执行后填写：

| 字段 | 说明 |
|---|---|
| 用例 ID | 如 A-01 |
| 执行时间 | YYYY-MM-DD HH:MM |
| 执行者 | 会话 ID 或操作者 |
| 结果 | ✅ PASS / ❌ FAIL / ⏸️ BLOCKED |
| 证据 | MCP 返回的关键字段摘要（如 item_id、条目数、排名位置） |
| 失败原因 | 仅 FAIL 时填写 |
| 阻塞原因 | 仅 BLOCKED 时填写 |
| 数据清理确认 | ✅ 已清理 / ⚠️ 残留（附 item_id） |

---

## 6 效果度量指标

### 6.1 指标定义

| 指标 | 定义 | 采集方式 | 计算口径 |
|---|---|---|---|
| **路由正确率** | context 按 scope 返回的条目全部属于请求的 scope | 维度 A 用例中逐条检查 scope 归属 | 正确用例数 / A 维度总用例数 × 100% |
| **召回命中率** | 写入的记忆在 context/query 中可被检索到 | 维度 C + E 用例中检查写入→召回配对 | 成功召回数 / 应召回总数 × 100% |
| **bm25 排序准确率** | 中文查询时 search_hints 含查询词的结果排名 ≤ 3 | 维度 C-02, H-05 用例中检查排名 | 排名 ≤ 3 的查询数 / 总排序验证查询数 × 100% |
| **CJK 召回率** | 中文单字/双字查询有非零结果返回 | 维度 C-04 用例 | 有结果的 CJK 查询数 / 总 CJK 查询数 × 100% |
| **噪声干扰率** | 闲聊/无关问答中不应有的 memory_query 调用或无关 scope 添加 | 维度 C-06 用例中观察 MCP 调用日志 | 违规调用数 / C-06 总执行数 × 100%（目标 0%） |
| **上下文恢复完整度** | compaction 后 context 返回的条目数 = memory_rules 审计的该 scope 活跃条目数 | 维度 E 用例中交叉验证 | context 条目数 / rules 审计条目数 × 100% |
| **写入拦截率** | 被协议禁止的写入（event/plan-file/draft-file）被正确拒绝 | 维度 B-06, B-07 用例 | 成功拒绝数 / 应拒绝写入数 × 100% |
| **清理残留率** | 测试结束后残留的 test: 前缀活跃记忆条目 | 全部用例执行完毕后批量审计 `memory_rules(contract_version=2, slot_key="test:*")` | 残留条数 / 总写入测试条数 × 100%（目标 0%） |
| **DB 健康度** | freelist 比例、auto_vacuum 设置、WAL 文件大小 | 维度 H-01 ~ H-03 用例 | freelist/page_count < 0.05 且 auto_vacuum=2 且 WAL < 1MB → 健康 |

### 6.2 整体验收标准

| 等级 | 条件 |
|---|---|
| 🟢 全部通过 | P0 通过率 100% 且 P1 通过率 ≥ 90% 且清理残留率 0% |
| 🟡 条件通过 | P0 通过率 100% 且 P1 通过率 ≥ 80% |
| 🔴 未通过 | P0 存在失败用例 |

---

## 7 测试后批量审计

全部用例执行完毕后，执行最终审计确认无测试数据残留：

```text
# 审计 test: 前缀活跃条目
memory_rules(
  contract_version=2,
  status="active",
  limit=500
)
→ 过滤 slot_key 以 "test:" 开头的条目
→ 预期：0 条

# 审计 test-phantom-project scope 活跃条目
memory_rules(
  contract_version=2,
  scope={type: "project", key: "test-phantom-project"},
  status="active"
)
→ 预期：0 条

# 若发现残留，逐条 memory_forget 并记录
```
