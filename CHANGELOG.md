# 更新日志

## 1.5.2 (2026-04-10)

### `lifeos-rules` 进一步瘦身

本版本继续压缩 `lifeos-rules`（即 `CLAUDE.md` / `AGENTS.md` 源文件），目标是在不改变规则效果的前提下，减少常驻上下文占用，降低前段注意力干扰。

- `操作工具` 从工具表格压缩为单句规则，并明确表述为“优先使用官方 Obsidian CLI 工具，未安装时回退到平台原生文件工具”
- `状态流转` 仅保留 3 条最关键的全局硬约束：`pending` 草稿绝不归档、`frozen` 项目不进入活跃/复习链路、知识状态只升不降
- `学习类项目知识准确性` 从展开说明压缩为 2 条防错判定句：原书优先、不确定先回读
- `Context 恢复` 压缩为单句，并移动到文档末尾，改为条件触发式提醒，避免占用前段常驻注意力

**压缩效果：**
- 双语合计约减少 `464–516 tokens`（取决于 tokenizer）
- 中文规则文件约减少 `246–295 tokens`

## 1.5.1 (2026-04-09)

### 新增 `/translate` 技能

新增 `/translate` 技能，将英文 PDF 书籍章节翻译为中文 Markdown 阅读笔记，支持在 Obsidian 中实现「PDF++ 原书 + 中文对照笔记」的双窗口阅读体验。

- 调用 `/read-pdf` 提取原文，按小节组织翻译产出，术语首次出现标注英文原文
- 产出路径：`{资源目录}/翻译/{书名}/{章节名}.md`
- 翻译完成后自动回填学习项目掌握度总览的「翻译」列
- 包含习题翻译，保留题号结构便于对照做题
- `lifeos.yaml` 新增 `subdirectories.resources.translations` 配置项

## 1.5.0 (2026-04-07)

### 重大变更：记忆系统 V3 — 架构精简与用户画像重构

本版本完成记忆系统 V3 升级，删除 enhance 队列和 semantic_summary 字段，移除 UserProfile 中无意义的统计式学习进度，将用户画像生成改由 LLM 驱动。

**Schema V3 升级（4 表 → 3 表）：**
- 删除 `enhance_queue` 表及其索引，语义增强改为解析时内联执行
- 删除 `semantic_summary` 字段，FTS 触发器和查询同步清理
- 新增 V2→V3 原子迁移，支持 V1→V2→V3 顺序迁移链

**UserProfile 画像重构：**
- 移除 `learning-progress` section——纯 `COUNT GROUP BY status` 的数字统计无法反映用户掌握了什么
- 用户知识掌握画像改由 `/today` 技能在每日规划时生成：收集项目进度、笔记习题解答、复习记录和个人补充，由 LLM 综合分析后写入 `profile:summary`
- `buildRulesSection` 新增 `profile:` 前缀过滤，防止画像描述污染行为约束区块
- `memoryLog` 根据 `slotKey` 前缀智能刷新对应 UserProfile section（`profile:` → profile-summary，其余 → rules）

**搜索召回修复：**
- `searchHints` 补全所有 type/status 中文标签，修复因标签缺失导致的搜索召回回退

**配置健壮性：**
- `contextBudgets()` 增加非法值校验，防止 NaN 导致 Layer 0 裁剪失效
- 移除 ContextPolicy.md，预算配置统一收归 `lifeos.yaml` 的 `context_budgets`

### 协议文档同步

- `/today` 技能（中英）：新增画像数据收集步骤和用户画像生成步骤

### 内部

- 净删除约 500 行代码
- V2→V3 迁移在 SQLite 事务中执行，崩溃安全
- 新增回归测试：`profile:summary` 不出现在 rules 区块

## 1.4.2 (2026-04-07)

### CLAUDE.md 协议瘦身

精简 `lifeos-rules`（即 CLAUDE.md 源文件），将详细协议内容下沉到按需加载的共享文件，降低 Agent 注意力稀释问题。

**优化效果：** 170 行 / ~2968 tokens → 99 行 / ~1450 tokens（-54%），落入推荐的 1000–2000 tokens 区间。

**下沉内容：**
- 记忆系统分层激活规则、规则捕获规范、噪声防护 → `memory-protocol.md`
- 模板路由表 → `template-loading.md`
- 技能目录详细描述 → 各 SKILL.md 按需加载
- 目录结构详细说明 → 精简为映射表 + 指向 `lifeos.yaml`

**设计原则：** CLAUDE.md 从"带着完整地图"变为"知道去哪里找地图"——只保留铁律级约束，参考信息按需加载。

## 1.4.1 (2026-04-05)

### 草稿状态统一

将草稿的三个已消费状态 `researched`/`projected`/`knowledged` 统一为 `done`，与项目和计划的状态词汇对齐。

**状态机变更：**
```
# 之前
pending ──/research──→ researched ──┐
pending ──/project───→ projected  ──┼──/archive──→ archived
pending ──/knowledge─→ knowledged ──┘

# 之后
pending ──/research,/project,/knowledge──→ done ──/archive──→ archived
```

**变更范围：**
- `lifecycle`（中英）：状态图、状态表、技能参与矩阵
- `Frontmatter_Schema`：draft 枚举更新为 `pending / done / archived`
- `archive` 技能（中英）：三次 query 合并为一次 `status:done`；归档时草稿也统一更新为 `status: archived`
- `research`/`project`/`knowledge` 技能（中英）：草稿消费后写入 `done`

### 工具链

- 新增 `release:bump` 脚本：自动更新 package.json、package-lock.json 和全部 SKILL 文件的版本号

## 1.4.0 (2026-04-04)

### 重大变更：记忆系统 V2 精简重构

本版本对记忆系统进行了大幅精简，从 7 张数据表/6 个 MCP 工具缩减到 4 张表/3 个工具，净删除约 4000 行代码。核心目标：移除所有无活跃消费方的数据结构和工具，保留真正被使用的偏好/纠错持久化能力。

**Schema 精简（7 表 → 4 表）：**
- 删除 `session_log`、`session_state`、`session_fts` 三张表及全部会话级日志机制
- `memory_items` 重构为以 `slot_key` 为主键的扁平结构，移除 `target`/`section`/`id` 三元组
- 新增 V1→V2 原子迁移：仅保留 preferences/corrections 规则数据，自动回滚保护

**MCP 工具精简（6 → 3）：**

| 删除的工具 | 原因 |
|------------|------|
| `memory_recent` | 依赖 session_log，已无数据源 |
| `memory_auto_capture` | 语义抓取无消费方，偏好捕获由 `memory_log` 承担 |
| `memory_citations` | 引用追溯功能无实际使用场景 |

保留：`memory_query` · `memory_log` · `memory_notify`

**偏好/纠错统一为规则（Rules）：**
- UserProfile 的 preferences 和 corrections 两个 AUTO section 合并为单一 `rules` section
- `upsertRule()` 替代 `logEvent()`，correction 永远不会被 preference 降级覆盖
- 源头去重：同一 `slot_key` 全局唯一，消除跨 section 重复

**frozen 项目状态：**
- 新增 `frozen` 状态：`active ⇄ frozen → done → archived`
- 冻结的项目不出现在 TaskBoard 焦点/活跃项目/待复习面板
- 关联知识笔记自动从复习列表中隐藏
- 知识笔记新增 `project` frontmatter 字段标记所属项目

**活文档精简：**
- TaskBoard：5 sections → 3（移除 decisions、update-log）
- UserProfile：4 sections → 3（preferences + corrections 合并为 rules）

**Layer 0 优化：**
- 移除 session_bridge 机制（生产数据 92% 失败率）
- 预算调整：layer0_total 1800、taskboard_focus 500、revises_summary 100
- 新增待复习概况摘要

**运行时改进：**
- startup 自动清理过期规则（`cleanupMemoryItems`），防止过期规则泄漏到 UserProfile
- ContextPolicy 接口补齐 `revises_summary` 字段

### 删除的代码模块

- `src/services/maintenance.ts` — 维护任务调度（无消费方）
- `src/active-docs/citations.ts` — 引用追溯
- `src/active-docs/long-term-profile.ts` — 长期画像
- `src/db/consolidation.ts` — 数据合并

### 协议文档同步

- `lifeos-rules`（中英）：记忆工具从 6 个更新为 3 个，新增 frozen 状态说明
- `memory-protocol`（中英）：完全重写，精简为 `memory_log` + `slot_key` 规范
- `lifecycle`（中英）：新增 frozen 状态流转规则
- `Frontmatter_Schema`（中英）：新增 frozen 状态和 project 字段
- 全部 10 个技能文件（中英共 20 个）：同步更新记忆调用方式

### 内部

- 净删除约 4000 行代码（+765/-4736 across 60 files）
- V1→V2 迁移包在 SQLite 事务中，崩溃安全
- 迁移测试覆盖数据映射、slot_key 冲突优先级、非规则行丢弃、旧表清理
- 408 个测试全部通过

## 1.3.0 (2026-04-02)

### 重大变更：记忆系统架构重构

本版本对记忆系统的三文件架构（ContextPolicy / TaskBoard / UserProfile）进行了全面重构，MCP 工具从 11 个精简到 6 个，3 个关键生命周期操作实现内部自动化。

**Layer 0 偏好可达性保障：**
- 偏好和纠错现在直接包含在 Layer 0 摘要中，使用独立的 1000 token 预算，确保 Agent 在任何场景下都能获取用户行为约束
- Layer 0 总预算从 1200 提升至 2000 token，新增"行为约束"section
- 偏好/纠错/决策写入后即时刷新对应活文档 section，compaction 后不再丢失新偏好

**MCP 生命周期自动化：**
- `memory_startup` → 首次工具调用时自动触发，首次返回结果附带 `_layer0` 摘要字段
- `memory_checkpoint` → 会话结束（stdin 关闭）时自动执行
- `memory_notify` → `fs.watch` 自动监听 Vault `.md` 文件变更，500ms 防抖自动索引（手动调用保留为同步入口）
- `memory_skill_complete` → 合并至 `memory_log(entry_type="skill_completion")`

**ContextPolicy 精简：**
- 移除场景策略、技能画像策略、强制引用场景（均为未被消费的死代码）
- ContextPolicy.md 从 5 个 section 精简为 2 个：Layer 0 预算 + 活文档体积约束

**TaskBoard / UserProfile 职责清晰化：**
- TaskBoard = "做什么"：项目信息唯一来源
- UserProfile = "怎么做"：偏好、纠错、统计、知识掌握度
- UserProfile 移除活跃项目列表和近期决策 section，消除与 TaskBoard 的信息重复

### 删除的 MCP 工具

| 工具 | 替代方式 |
|------|----------|
| `memory_startup` | MCP server 自动触发 |
| `memory_checkpoint` | MCP server 自动触发 |
| `memory_skill_complete` | `memory_log(entry_type="skill_completion")` |
| `memory_refresh` | 即时刷新 + fs.watch |
| `memory_skill_context` | 死代码，直接删除 |

### 保留的 MCP 工具（6 个）

`memory_query` · `memory_recent` · `memory_log` · `memory_auto_capture` · `memory_notify` · `memory_citations`

### 删除的代码模块

- `src/skill-context/` 整个目录（7 个文件）：`buildSkillContext`、seed profiles、reranking 逻辑
- `context-policy.ts` 中的 `resolveScenePolicy`、`resolveSkillProfilePolicy`、`DEFAULT_SKILL_PROFILE_POLICIES` 及相关类型

### 协议文档同步

- `lifeos-rules`（中英）：分层协议从三层精简为两层，新增 `_layer0` 上下文说明
- `memory-protocol`（中英）：`memory_skill_complete` → `memory_log`，checkpoint 自动化
- `/revise`、`/digest`、`/read-pdf` SKILL（中英）：同步更新技能完成调用方式
- 测试指南（中英）：startup/checkpoint 改为验证自动触发行为

### 内部

- 净删除约 1150 行代码（+431/-1562 across 35 files）
- `fs.watch` 防抖串行化（`notifyQueue` + `notifyInFlight` 防并发 SQLite 锁）
- 进程退出前 `flushPendingNotifies` 确保不丢失待处理文件通知
- `checkpointDone` 防重入，避免 `stdin.on('end')` 和 `beforeExit` 重复触发

## 1.2.0 (2026-04-01)

### 新功能

- **偏好捕获与跨 Agent 持久化**：`memory_log` 和 `memory_auto_capture` 新增可选 `slot_key` 参数，当偏好/纠错/决策事件附带 `slot_key` 时，自动同步写入 `memory_items` 表，实现跨 Agent 的用户偏好持久化存储
- **用户画像统计聚合**：UserProfile 的「用户摘要」区块从空白占位改为自动统计画像，展示学习重心、常用技能 Top 5、近 30 天活跃度等数据
- **记忆系统三层激活模型**：重写记忆系统规则，从"技能内/外"二元开关改为三层激活——始终激活（偏好捕获）、技能工作流（Vault 操作）、会话生命周期（checkpoint），解决技能外偏好无法写入的矛盾
- **技能目录补全**：`/digest` 技能加入 lifeos-rules 技能目录表格（中英双语）
- **偏好回顾步骤**：memory-protocol 在技能完成后、会话收尾前新增「偏好回顾」环节，含 `slot_key` 调用规范和示例

### 问题修复

- 修复 UserProfile 与 TaskBoard「近期决策」区块数据重复问题，决策统一保留在 TaskBoard
- 修复 TaskBoard 活跃项目摘要中 Markdown 标题符号（`#`、`**`）未剥离导致的渲染错误
- 修复 `upsertMemoryItem` UPDATE 分支覆盖 `source_event_ids` 导致溯源链断裂的问题，改为追加（保留最近 10 条）
- 修复 `buildCorrectionsSection` 未读取 `memory_items` 的一致性问题，对齐 `buildPreferencesSection` 的两阶段读取逻辑
- 移除 `buildProfileSummarySection` 中与 `buildLearningProgressSection` 重复的掌握度统计
- `slot_key` 增加 `^[a-z]+:[a-z0-9_-]+$` 格式校验
- `memory_items` 表增加 `(target, section, slot_key)` 唯一索引，防止并发写入重复记录
- 记忆系统触发条件补全 `/digest`，移除中间技能 `/read-pdf`

### 测试

- 新增 14 个测试用例覆盖 slot_key 同步、溯源链追加、UserProfile 画像统计和唯一索引约束

## 1.1.2 (2026-03-31)

### 问题修复

- 修复 `fullScan` 不清理已删除文件索引的问题：删除的文件在 `vault_index` 中残留，导致 `memory_query` 仍能检索到已不存在的文件
  - 在全量扫描后新增清理步骤，移除磁盘上已确认删除（ENOENT）的陈旧索引记录
  - 多层安全防护：校验 Vault 根目录可读且扫描前缀目录存在，区分文件删除（ENOENT）与访问错误（EACCES/EIO），避免在挂载点异常时误删有效索引

### 文档

- 将 README 默认语言改为中文，英文版移至 README.en.md
- CHANGELOG 全部改为中文描述

## 1.1.1 (2026-03-31)

### 问题修复

- 修复 `memory_auto_capture` 中的静默数据丢失：corrections、decisions、preferences 中嵌套的 `related_files` 字段因缺少 snake_case→camelCase 转换而被丢弃

### 重构

- 在 `core.ts` 中提取 `withResolvedDb` 和 `resolveScene` 辅助函数，消除 11 个工具处理器中重复的 DB 生命周期模板代码
- 在 `server.ts` 中提取泛型 `handleTool` 包装器并实现递归深层键名转换，替代 11 处手动 snake_case→camelCase 映射
- 将重复的 `refreshTaskboard`/`refreshUserprofile` 合并为配置驱动的 `refreshActiveDoc`；引用处理同理
- 移除 `retrieval.ts` 中的死代码分支和多余的 `hasCjk` 参数
- 移除 `utils/shared.ts` 中不必要的重导出
- 移除 `scanRecentlyModifiedFiles` 中未使用的 `_vaultRoot` 参数

### 内部

- 跨 7 个文件净减约 150 行代码，除上述 bug 修复外无行为变化

## 1.1.0 (2026-03-30)

### 新功能

- 新增 Windows 上 OpenCode GUI 的验证支持，与现有 macOS 上 Claude Code TUI、Codex TUI、OpenCode TUI 并列
- `lifeos init` 和 `lifeos upgrade` 不再强制创建或管理 Git 元数据；Git 由用户自行管理
- 更新 README 支持说明和发布流程，反映支持的运行时与客户端矩阵

### 内部

- 运行时基线升级至 Node.js 24.14.1+，刷新原生依赖栈，包括 `better-sqlite3` 12.8.0 和 `@types/node` 24.x
- 修补传递依赖 `path-to-regexp` 的审计问题，并新增依赖/工作流版本漂移回归测试
- 对齐 GitHub Actions CI 和发布工作流与支持的 Node.js 版本

## 1.0.3 (2026-03-30)

### 新功能

- 新增 `/digest` 技能，支持自定义主题信息周报
- `/digest` 现支持多语言周报生成，可配置论文来源、RSS 和 Web 搜索
- 扩展论文来源抓取，覆盖 `arXiv`、`bioRxiv`、`medRxiv`、`ChemRxiv`、`SocArXiv` 和 `SSRN`

## 1.0.0

- 首次发布：MCP 记忆服务器，包含 11 个工具
- Vault 索引与 FTS5 全文搜索
- 通过 @node-rs/jieba 实现中文分词
- 会话记忆与上下文组装
- 活跃文档（TaskBoard、UserProfile）
