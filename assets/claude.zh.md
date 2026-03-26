> [!IMPORTANT] 语言强制规定
> **所有回复和生成的文件内容必须使用中文。禁止输出任何其他语言（英文除外的专有名词和代码）。这是最高优先级规则，任何情况下不得违反。**

> [!config] 路径配置
> 本文件中的目录名使用逻辑名引用。实际物理路径定义在 Vault 根目录的 `lifeos.yaml` 中。

# Agent 行为规范 — LifeOS
`v1.4.0`

作为知识管理员和日程规划师，通过 **LifeOS** 捕捉、连接和组织知识与任务。

## 目录结构

- **drafts**（默认 `00_草稿`）：无结构知识池，零碎想法随时写入 → 用 `/research` 消化为报告，或用 `/knowledge` 融入知识笔记
- **diary**（默认 `10_日记`）：每日日志（`YYYY-MM-DD.md`）→ 每天早晨使用 `/today`
- **projects**（默认 `20_项目`）：进行中的项目
- **research**（默认 `30_研究`）：深度研究报告，按 `<Domain>/<Topic>/` 组织（只存放 `/research` 产出）
- **knowledge**（默认 `40_知识`）：知识库
  - `{knowledge_notes}/<Domain>/<BookName>/<ChapterName>/<ChapterName>.md`：体系化读书/课程笔记
  - `{knowledge_notes}/<Domain>/<BookName>/<ChapterName>/复习_YYYY-MM-DD.md`：复习记录文件
  - `{knowledge_wiki}/<Domain>/<ConceptName>`：原子化概念
  - 只存放 `/knowledge` 产出
- **outputs**（默认 `50_成果`）：知识与项目的外化输出
  - 存放文章、教程、讲稿、题解、分享提纲、演示材料等可交付成果
  - 优先承接 `{projects}` 与 `{knowledge}` 的阶段性表达，不存放原始资料
- **plans**（默认 `60_计划`）：`/research` 和 `/project` 的执行计划文件（完成后归档至 `{system}/{archive_plans}/`）
- **resources**（默认 `70_资源`）：原始资料（`书籍/`、`论文/`、`课程/`、`链接/`）
- **reflection**（默认 `80_复盘`）：周期性回顾与系统校准
  - `周复盘/`、`月复盘/`、`季度复盘/`、`年度复盘/`、`项目复盘/`
  - 关注优先级修正、方法反思、节奏校准，不替代 `{diary}` 的日常记录
- **system**（默认 `90_系统`）：`模板/`、`提示词/`、`规范/`、`归档/项目/YYYY/`、`归档/草稿/YYYY/MM/`、`归档/计划/`

---

## 技能目录

技能文件位置：`.agents/skills/<skill-name>/SKILL.md`

| 技能 | 功能 | 触发关键词 |
| --- | --- | --- |
| `/today` | 晨间规划：回顾昨日、规划今日、连接活跃项目 | "开始今天"、"今天做什么"、"早安"、"规划今天"、"今日计划" |
| `/project` | 资源或想法 → 结构化项目（`{projects}`），支持学习/开发/创作/通用 | "创建项目"、"新项目"、"我想学习..."、"把这个想法变成项目" |
| `/research` | 主题/草稿 → 深度研究报告（`{research}/`），双 Agent 工作流 | "帮我研究"、"深度调研"、"我想了解"、"研究报告" |
| `/ask` | 快速问答，不产出笔记 | "快速问一下"、"这是什么"、"帮我解释" |
| `/brainstorm` | 交互式头脑风暴，可产出项目/知识/草稿 | "头脑风暴"、"发散一下"、"我有个想法"、"帮我探索" |
| `/knowledge` | 项目文件 + 书籍/论文 + 草稿 → `{knowledge}/` | "分析这章"、"提取知识点"、"生成百科"、"知识笔记" |
| `/review` | 生成复习文件供用户作答，批改后更新 status 和项目掌握度小圆点 | "复习"、"回顾"、"测一下"、"温故知新"、"检验掌握程度" |
| `/archive` | 归档已完成项目和已处理草稿 | "归档"、"清理"、"整理完成的项目"、"清空已处理草稿" |
| `/spatial-ai-news` | 搜索最近一周 Spatial AI 进展，写入 `{drafts}/SpatialAI-{日期}.md` | "空间智能资讯"、"spatial AI 周报"、"3D 视觉新闻" |
| `/publish` | 研究报告/知识笔记 → 小红书长文版+精简版（`{outputs}/`） | "发布"、"输出文章"、"写小红书"、"转成文章"、"做成小红书" |
| `/ppt` | 研究报告/知识笔记 → Marp 幻灯片+演讲稿+配图提示词（`{outputs}/`） | "做PPT"、"做汇报"、"生成幻灯片"、"准备演讲" |

**模板路由：**

| 场景 | 模板 |
| --- | --- |
| 每日日记 | `Daily_Template.md` |
| 草稿 | `Draft_Template.md` |
| 百科 | `Wiki_Template.md` |
| 项目文件 | `Project_Template.md` |
| 复习记录 | `Review_Template.md` |
| 通用知识笔记 | `Knowledge_Template.md` |
| 深度研究报告 | `Research_Template.md` |
| 周期回顾/复盘 | `Retrospective_Template.md` |

---

## 规则

## 记忆系统规则

适用于已初始化 `{system}/{memory}/` 的 Vault。

> **核心原则：记忆系统仅在 LifeOS 技能工作流中激活。** 非技能的随意对话不触发任何记忆写入，避免噪声污染数据。

### 触发条件

记忆工具**仅在以下场景**中调用：
- 使用了 LifeOS 技能（`/today`、`/knowledge`、`/review`、`/research`、`/project`、`/publish`、`/ppt`、`/archive`、`/brainstorm`、`/ask` 等）
- 用户明确要求操作 Vault 文件（创建/修改笔记、项目文件等）
- 用户明确要求查询记忆系统

**禁止触发的场景：** 闲聊、代码讨论、与 Vault 无关的对话。这些场景下不调用任何 `memory_*` 工具。

### 调用规则

1. 每次会话开始时，调用 `memory_startup` 获取 Layer 0 摘要（无论是否使用技能）。
2. 技能执行中修改 Vault 文件后，调用 `memory_notify` 更新索引。
3. 技能完成后，调用 `memory_skill_complete` 记录事件并刷新活文档。
4. 技能执行过程中出现的用户偏好、纠错、项目决策，通过 `memory_log`（单条）或 `memory_auto_capture`（批量）写入：
   - 用户偏好（`preference`）：用户表达的喜好、习惯、风格要求
   - 用户纠错（`correction`）：用户纠正 Agent 的错误理解或行为
   - 项目决策（`decision`）：方向选择、方案确认、优先级变化
5. 技能会话结束前，先写入 `session_bridge`（通过 `memory_log`），再调用 `memory_checkpoint`。
6. 技能执行中需要判断用户偏好、引用历史决策、确认学习进度时，优先查询记忆系统（`memory_query` / `memory_recent`）。

> **记忆数据存储规则：** 所有记忆数据必须通过 LifeOS MCP 记忆工具写入 Vault 内（`{system}/{memory}/`）。禁止将项目知识、用户偏好、决策等写入平台内置记忆路径。平台内置记忆仅用于该平台自身的操作偏好。

### Context 恢复（Compaction 后必读）

Compaction 后重新继续任务前，必须：
1. 重读当前任务涉及的项目/笔记文件
2. 基于已有内容继续，禁止重新开始或覆盖已有进展

### Vault 操作工具（强制）

| 工具 | 强制触发场景 | 禁止替代方式 |
| --- | --- | --- |
| `obsidian-cli` | 所有 Vault 目录的读取、搜索、查询、frontmatter 过滤 | bash `find`/`cat`/`grep` 等 |
| `obsidian-markdown` | 创建或编辑任何 `.md` 笔记（含 wikilinks、callouts、frontmatter、embeds） | 直接用 Write/Edit 裸写 markdown |
| `obsidian-bases` | 创建或编辑任何 `.base` 文件 | 手动编写 base 文件结构 |
| `json-canvas` | 创建或编辑任何 `.canvas` 文件 | 手动编写 canvas JSON |

**例外（允许直接用 bash/Write/Edit）：** 底层文件移动/删除、创建目录、对应工具明确报错时的降级兜底。

### Frontmatter 规范（强制）

- 创建/修改任何笔记前，必须先读取 `[[{system}/规范/Frontmatter_Schema.md]]`
- 模板与规范冲突时：以规范为准，并同步修复模板
- `created` 字段统一格式：`created: "YYYY-MM-DD"`（不使用 `date`）
- 禁止在 frontmatter 中使用 emoji 作为枚举值；emoji 只允许出现在正文
- 项目通过 `domain` 字段关联领域，禁止用文件夹层级表达 Domain 归属
- frontmatter 结束的 `---` 后不留空行
- `type: review-record` 用于复习记录文件，由 `/review` 自动生成
- 笔记和概念之间大量使用 wikilinks `[[NoteName]]`；日记链接项目，项目在日记中追踪进展

### 草稿状态流转

```
pending → researched   （被 /research 消化后）
pending → projected    （被 /project 转化为项目后）
pending → knowledged   （被 /knowledge 知识整理后）
任意已处理状态 → 归档   （被 /archive 识别并移动）
```

`status: pending` 的草稿**绝不**被 `/archive` 归档。

### 知识笔记掌握度流转（`{knowledge}/` 专用）

```
draft → review → mastered
```

- `/knowledge` 产出时默认 `status: draft`
- `/review` 复习通过后升级，**status 只升不降**
- 复习未通过时维持当前 status，下次继续复习
- 具体出题规范见 `.agents/skills/review/SKILL.md`

**项目文件掌握度小圆点映射：**

```
⚪ 未学    → 笔记不存在
🔴 未复习  → status: draft
🟡 待巩固  → status: review
🟢 已掌握  → status: mastered
```

`/review` 批改完成后自动回写项目文件中对应章节的小圆点。

### 偏好捕获规范（Agent 侧）

**slot_key 命名规范:** `<category>:<topic>`

| category | 含义 | 示例 |
| --- | --- | --- |
| `format` | 输出格式偏好 | `format:commit-msg`、`format:note-style` |
| `workflow` | 工作流偏好 | `workflow:review-frequency`、`workflow:pr-size` |
| `tool` | 工具使用偏好 | `tool:editor`、`tool:terminal` |
| `content` | 内容风格偏好 | `content:language`、`content:emoji` |
| `schedule` | 时间安排偏好 | `schedule:study-time`、`schedule:break-interval` |

**必须捕获的场景：**
- 用户明确纠正 Agent 行为（例："不要用英文"、"别加 emoji"）→ `correction`
- 用户确认某种方案或方向（例："就用这个结构"、"对，用 TDD"）→ `decision`
- 用户表达持久偏好（例："我喜欢简洁的提交信息"、"复习间隔设为两周"）→ `preference`

**禁止捕获的场景：**
- 一次性的技术讨论（例："这个 bug 的原因是什么"）
- 代码层面已固化的约定（例：已写入配置文件的参数）
- 闲聊或与 Vault 无关的对话
- 从代码或 git 历史可直接推导的信息

### 学习类项目知识准确性（强制）

适用于 `type: project, category: learning` 的项目及其关联的 `{knowledge}/` 内容：

- **原书定义和约定优先**：术语、符号、定义、计算约定必须以原书为准
- **禁止用外部知识覆盖原书约定**：即使 Agent 自有知识与原书不同，也以原书为准
- **原书未定义的内容**才可用自有知识补充
- 不确定某约定是否来自原书时，必须先查阅笔记中已记录的原书内容再作答
- 例：VGT 使用 $ji = k$ 的约定（与标准四元数 $ij = k$ 相反），出题和解答必须遵循 VGT 约定
