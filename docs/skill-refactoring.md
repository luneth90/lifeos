# LifeOS 学习系统技能重构分析与建议

## Context

LifeOS 在 `assets/skills/` 中有 9 个中文技能文件（SKILL.zh.md），构成一个完整的学习生命周期系统。随着技能数量增长到 9 个，出现了大量样板重复、格式不一致、技能间耦合方式 ad-hoc 等问题。本分析旨在识别核心问题并提出可落地的重构建议。

---

## 一、系统全景：技能关系与学习生命周期

```
today (入口)
  ├→ project (将想法结构化为项目)
  ├→ research (深度研究主题)
  ├→ knowledge (蒸馏知识笔记)
  ├→ review (间隔复习+批改)
  └→ archive (归档清理)

辅助流:
  brainstorm → project | knowledge | draft
  ask → read-pdf | knowledge | brainstorm | research
  read-pdf → JSON 中间输出 (供 knowledge/ask/review 消费)
```

### 草稿状态机 (分散在 6 个技能中，无单一定义)

```
pending ──/research──→ researched ──┐
pending ──/project───→ projected  ──┼──/archive──→ archived
pending ──/knowledge─→ knowledged ──┘
```

### 知识笔记状态机 (分散在 review + knowledge 中)

```
draft ──/review(≥50%)──→ review ──/review(≥80%)──→ mastered
       (只升不降)
```

---

## 二、已识别的核心问题

### 问题 1：大量样板重复 (~450 行)

**严重程度：高**

每个技能都重复以下几乎相同的块：

| 重复块 | 每个技能约行数 | 9 个技能总计 |
|--------|---------------|-------------|
| `> [!config]` 路径配置 | 10-15 行 | ~110 行 |
| 记忆系统集成（4 个子节） | 20-30 行 | ~220 行 |
| "语言规则：所有回复必须为中文" | 1 行 | 9 行 |
| 阶段0 记忆前置检查 | 8-15 行 | ~100 行 |

其中**记忆系统集成**的 3 个子节（文件变更通知、技能完成、会话收尾）在所有技能中结构完全相同，仅 `skill_name`、`scope`、`refresh_targets` 参数不同。

### 问题 2：配置块格式不统一

**严重程度：高**

两种格式共存：

**格式 A**（project、research 使用）— 中文逻辑名 → 英文键：

```
> - `{草稿目录}` → directories.drafts
```

**格式 B**（其余 7 个技能使用）— 英文键 → 中文名：

```
> - `directories.drafts` → 草稿目录
```

且 project/research 列出全部 12 个路径映射（实际只用 3-4 个），其他技能只列实际使用的。

### 问题 3：双 Agent 编排逻辑重复

**严重程度：高**

project 和 research 的 SKILL.zh.md 编排结构约 80% 相同：

| 阶段 | project | research | 差异 |
|------|---------|----------|------|
| 阶段0 记忆检查 | 3 条查询 | 3 条查询 | 仅 filters.type 不同 |
| 阶段1 启动规划 Agent | Task 工具 | Task 工具 | 相同模式 |
| 阶段2 用户审核 | 展示计划 | 展示计划+澄清问题 | research 多 2 个问题 |
| 阶段3 启动执行 Agent | Task 工具 | Task 工具 | 相同模式 |

### 问题 4：brainstorm 内联了 project 规划逻辑

**严重程度：中**

`brainstorm/SKILL.zh.md` 第 192-215 行，"选项1：创建项目" 内联了一个完整的 sub-agent prompt，重新实现了 project 规划工作流。如果 project 工作流变更（如 v1.2.0 新增开发类目录规范），brainstorm 的内联版本不会同步更新。

### 问题 5：草稿生命周期无单一定义

**严重程度：中**

`pending → researched/projected/knowledged → archived` 这条状态链分散在 6 个技能中定义，没有一个权威文档。同理，知识笔记的 `draft → review → mastered` 也分散在 review 和 knowledge 中。

### 问题 6：技能链调用方式 ad-hoc

**严重程度：中**

| 调用方式 | 示例 | 问题 |
|---------|------|------|
| 内联 sub-agent prompt | brainstorm → project | 逻辑重复，版本漂移 |
| 文本建议 | today → "/review", ask → "/knowledge" | 仅提示，无保证 |
| 前置依赖 | knowledge 要求 project 文件 | 仅停止+提示 |
| 状态回写 | review 更新 project 掌握度表 | 跨技能直接修改 |

无统一的技能间调用协议。

### 问题 7：完成报告格式不一致

**严重程度：低**

每个技能的完成报告结构相似（已创建文件、状态更新、下一步建议），但格式不统一：有的用 emoji 标题，有的不用；有的有"库状态"统计，有的没有。

### 问题 8：模板加载指令重复

**严重程度：低**

4 个技能（knowledge、review、project/execution-agent、brainstorm）都包含近乎相同的"读取模板（必须）、禁止猜测结构"指令。

---

## 三、重构建议

### 建议 1：提取记忆集成通用协议

**优先级：高** | **影响：全部 9 个技能** | **净减 ~110 行**

创建 `assets/skills/_shared/memory-protocol.zh.md`：

```markdown
# 记忆系统集成通用协议

> 所有记忆操作通过 MCP 工具调用，db_path 和 vault_root 由运行时自动注入。

## 文件变更通知
每次创建或修改 Vault 文件后，立即调用：
memory_notify(file_path="<变更文件相对路径>")

## 技能完成
memory_skill_complete(
  skill_name="<当前技能名>",
  summary="<一句话描述>",
  related_files=[...],
  scope="<当前技能名>",
  refresh_targets=["TaskBoard", "UserProfile"]
)

## 会话收尾（本技能为会话最后一个操作时）
1. memory_log(entry_type="session_bridge", summary="<摘要>", scope="<技能名>")
2. memory_checkpoint()
```

每个技能的"记忆系统集成"节缩减为：

```markdown
# 记忆系统集成
> 通用协议见 `_shared/memory-protocol.md`，以下仅列出本技能特有查询。

### 前置查询
[保留技能特有的查询代码]
```

**安装管道兼容性**：已验证 `installSkills()`（`src/cli/utils/install-assets.ts`）遍历 `assets/skills/` 下所有子目录，`_shared` 会被当作一个"技能目录"安装到 `.agents/skills/_shared/`。`resolveSkillFiles()`（`src/cli/utils/lang.ts`）会正确将 `.zh.md` 解析为 `.md`。无需代码改动。

### 建议 2：统一配置块格式

**优先级：高** | **影响：9 个技能** | **无行数变化，一致性收益大**

统一采用**格式 A**（中文逻辑名），原因：

- 技能正文全部使用 `{草稿目录}/`、`{知识目录}/` 等中文逻辑名，配置块应与正文方向一致
- 仅列出该技能实际使用的路径，不列全量

改动范围：7 个技能需重写配置块（ask、brainstorm、today、knowledge、review、archive、read-pdf），project 和 research 需裁剪未使用的映射。

### 建议 3：提取双 Agent 编排模式

**优先级：高** | **影响：project、research** | **净减 ~20 行，维护收益大**

创建 `assets/skills/_shared/dual-agent-orchestrator.zh.md`：

```markdown
# 双 Agent 编排协议

## 阶段0：记忆前置检查
memory_query(query="<关键词>", filters={"type": "<实体类型>"}, limit=5)
memory_query(query="<关键词>", limit=10)
memory_recent(entry_type="decision", query="<关键词>", limit=5)

## 阶段1：启动 Planning Agent
读取 references/planning-agent-prompt.md 完整内容作为 Task prompt。

## 阶段2：用户审核
展示计划文件路径，等待确认。[技能可插入额外澄清问题]

## 阶段3：启动 Execution Agent（用户确认后）
读取 references/execution-agent-prompt.md 完整内容作为 Task prompt，
仅传入计划文件路径。
```

project 和 research 的 SKILL.zh.md 简化为引用共享协议 + 声明特有行为。

### 建议 4：文档化生命周期状态机

**优先级：中** | **影响：6 个技能（引用）** | **纯新增文档 ~60 行**

创建 `assets/skills/_shared/lifecycle.zh.md`，定义三个状态机：

1. **草稿生命周期**：pending → researched/projected/knowledged → archived
2. **知识笔记生命周期**：draft → review → mastered（只升不降）
3. **项目生命周期**：active → on-hold → done → archived

每个参与状态转换的技能添加一行引用："本技能执行 `pending → researched` 转换，完整状态机见 `_shared/lifecycle.md`"

### 建议 5：修复 brainstorm 对 project 的内联重复

**优先级：中** | **影响：brainstorm** | **净减 ~15 行**

将 brainstorm "选项1：创建项目" 中内联的 sub-agent prompt 替换为引用 project 的实际规划 Agent：

```markdown
## 选项1：创建项目

1. 将 Phase 2 总结格式化为项目种子
2. 读取 `project/references/planning-agent-prompt.md` 作为 Task prompt
3. 将头脑风暴摘要注入 [用户输入] 占位符
4. 在「来源草稿」填写"头脑风暴会话（YYYY-MM-DD）"
```

消除逻辑重复，确保 project 工作流变更自动传播。

### 建议 6：标准化完成报告格式

**优先级：中** | **影响：7 个技能** | **无净减，一致性收益**

在 `_shared/` 中添加完成报告风格指南，统一结构：

```markdown
## [动作] 完成

**已创建/修改:**
- [文件列表 with wikilinks and paths]

**状态更新:**
- [状态变更记录]

**建议下一步:**
- [关联技能建议]
```

各技能按此结构调整，去除风格差异（如部分使用 emoji 标题、部分不用）。

### 建议 7：提取模板加载子例程

**优先级：低** | **影响：4 个技能** | **净减 ~5 行**

创建 `_shared/template-loading.zh.md`，标准化模板加载指令：

- 必须读取完整模板内容
- 禁止猜测结构
- 记住 Obsidian Callouts 格式
- 执行 AI 指令注释后删除注释原文

### 建议 8：创建系统级学习生命周期文档

**优先级：低** | **影响：全局（引用）** | **纯新增 ~50 行**

创建 `_shared/learning-lifecycle.zh.md`：

- 核心流程图（today → project → research/knowledge → review → archive）
- 技能调用矩阵（源技能 x 目标技能 x 调用方式）
- 状态机引用（引用建议 4 的 lifecycle.md）

---

## 四、实施顺序

### 第一阶段（高优先级，互不依赖可并行）

1. **建议 2**：统一配置块格式 — 纯内容改动，零风险
2. **建议 4**：创建生命周期文档 — 纯新增，零风险
3. **建议 1**：提取记忆集成协议 — 创建 `_shared/` 目录，建立基础

### 第二阶段（中优先级，依赖第一阶段的 `_shared/` 目录）

4. **建议 3**：提取双 Agent 编排模式
5. **建议 5**：修复 brainstorm 内联重复
6. **建议 6**：标准化完成报告

### 第三阶段（低优先级，锦上添花）

7. **建议 7**：模板加载子例程
8. **建议 8**：系统级生命周期文档

---

## 五、影响汇总

| 建议 | 优先级 | 影响技能数 | 行数变化 | 风险 | 类型 |
|------|--------|-----------|---------|------|------|
| 1. 记忆协议 | 高 | 9 | -110 | 中 | 结构+内容 |
| 2. 配置格式 | 高 | 9 | +0 | 低 | 内容 |
| 3. 双 Agent 编排 | 高 | 2 | -20 | 中 | 结构+内容 |
| 4. 生命周期文档 | 中 | 6(引用) | +60 | 无 | 新文档 |
| 5. brainstorm 修复 | 中 | 1 | -15 | 低 | 内容 |
| 6. 完成报告 | 中 | 7 | +0 | 低 | 内容 |
| 7. 模板加载 | 低 | 4 | -5 | 低 | 内容 |
| 8. 生命周期总览 | 低 | 全局 | +50 | 无 | 新文档 |
| **总计** | | | **约 -40** | | |

核心价值不在行数减少，而在于：

- **去重**：记忆协议、编排模式、配置格式有单一来源
- **一致性**：格式统一降低认知负担
- **可维护性**：工作流变更只需改一处
- **可发现性**：新增生命周期文档让系统设计显式化

---

## 六、明确不建议做的事

1. **不合并 project 和 research**：虽然编排结构相似，但用户意图和 Agent prompt 完全不同，合并会降低清晰度
2. **不引入构建时模板引擎**：增加复杂度，破坏"技能就是 Markdown 文件"的简单性
3. **不移除英文镜像要求**：双语系统是安装管道的核心设计，每个 `.zh.md` 都需要对应的 `.en.md`

---

## 七、关键文件路径

实施时需要修改的文件：

```
assets/skills/_shared/                          # 新建目录
  ├── memory-protocol.zh.md / .en.md            # 建议 1
  ├── dual-agent-orchestrator.zh.md / .en.md    # 建议 3
  ├── lifecycle.zh.md / .en.md                  # 建议 4
  ├── completion-report.zh.md / .en.md          # 建议 6
  ├── template-loading.zh.md / .en.md           # 建议 7
  └── learning-lifecycle.zh.md / .en.md         # 建议 8

assets/skills/*/SKILL.zh.md                     # 所有 9 个技能需要更新
assets/skills/*/SKILL.en.md                     # 对应英文版同步更新
assets/skills/brainstorm/SKILL.zh.md            # 建议 5 重点
assets/skills/project/SKILL.zh.md               # 建议 3 重点
assets/skills/research/SKILL.zh.md              # 建议 3 重点
```

安装管道无需代码改动：

- `src/cli/utils/install-assets.ts` — `installSkills()` 自动处理 `_shared/` 目录
- `src/cli/utils/lang.ts` — `resolveSkillFiles()` 自动解析语言后缀

---

## 八、验证方式

1. `npm run typecheck` — 确认安装管道代码无类型错误
2. `npm test` — 运行全部测试确认无回归
3. 手动验证：在测试 Vault 中运行 `lifeos init` 和 `lifeos upgrade`，确认 `_shared/` 目录正确安装到 `.agents/skills/_shared/`
4. 抽检 2-3 个技能（如 /research、/review），确认 AI Agent 能正确跟随跨文件引用
