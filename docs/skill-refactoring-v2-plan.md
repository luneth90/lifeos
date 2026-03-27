# LifeOS 技能重构 V2 — 实施计划

> 本文档是 `docs/skill-refactoring-v2.md` 的逐步实施指南。
> 范围：仅中文技能文件（.zh.md），英文文件暂不处理。

---

## 总览

| 步骤 | 内容 | 涉及文件数 | 可并行 |
|------|------|-----------|--------|
| 1 | Description 重写 | 9 | 是 |
| 2 | 角色定义重写 | 9 | 与步骤 1 同文件，合并执行 |
| 3 | 术语统一（去"原子"） | 3 | 与步骤 1 同文件，合并执行 |
| 4 | Agent prompt 配置精简 | 4 | 独立，可并行 |
| 5 | read-pdf 记忆集成修复 | 1 | 独立 |
| 6 | brainstorm 长内容拆分 | 1 + 1 新建 | 独立 |
| 7 | review 长内容拆分 | 1 + 1 新建 | 独立 |

**执行分组**：步骤 1-3 可合并为一批（同文件的多处改动），步骤 4-7 各自独立可并行。

---

## 步骤 1-3：Description + 角色定义 + 术语统一（合并执行）

对 9 个 SKILL.zh.md 文件，每个文件执行三处改动。

### 1.1 ask/SKILL.zh.md

**文件路径**: `assets/skills/ask/SKILL.zh.md`

**改动 A — Description（第 3 行）**

```
# 当前
description: LifeOS 快速问答助手：直接回答问题，不创建计划文件或笔记，按需检索 Vault 已有内容。当用户说"/ask [问题]"、"快速问一下"、"这是什么"、"帮我解释"、"怎么用"时触发。不适用于需要多轮探索的发散问题（请用 /brainstorm），不适用于系统性研究（请用 /research）。

# 替换为
description: 快速回答用户问题，按需检索 Vault 已有笔记辅助作答。适用于概念解释、用法查询、Vault 内容检索、PDF 指定页面提问等单轮问答场景。当用户提出任何直接问题或说"/ask"时使用此技能。复杂问题会建议升级到 /brainstorm 或 /research。
```

**改动 B — 角色定义（第 20 行）**

```
# 当前
你是 LifeOS 的快速问答助手。当用户调用 `/ask` 时，高效直接地回答问题 — 不创建计划、不调用子 Agent、不创建多余文件。

# 替换为
你是 LifeOS 的快速问答助手，擅长用最少的步骤给出最直接的答案。不创建文件、不启动子 Agent、不过度格式化。能从 Vault 已有笔记中找到相关内容时自然引用，找不到时凭知识直接作答。
```

**改动 C — 术语统一（第 100 行）**

```
# 当前
| 答案涉及值得原子化的知识概念     | 回答后提示 `/knowledge` |

# 替换为
| 答案涉及值得整理的百科概念     | 回答后提示 `/knowledge` |
```

### 1.2 brainstorm/SKILL.zh.md

**文件路径**: `assets/skills/brainstorm/SKILL.zh.md`

**改动 A — Description（第 3 行）**

```
# 当前
description: LifeOS 交互式头脑风暴：通过多轮对话探索和深化想法，结束后可产出项目、知识笔记或草稿。当用户说"/brainstorm [话题]"、"头脑风暴"、"发散一下"、"我有个想法想聊聊"、"帮我探索这个方向"、"想法还不成熟，聊聊看"时触发。不适用于明确的快速问答（请用 /ask），不适用于已有明确目标的项目创建（请用 /project）。

# 替换为
description: 通过多轮交互式对话探索和深化用户的想法，使用 5 Whys、What if、Devil's Advocate 等思维技巧引导发散。结束后可选择创建项目（调用 /project）、整理为百科笔记、或保存为草稿。当用户想聊一个还不成熟的想法、需要发散思维、探索某个方向的可行性、或说"/brainstorm"时使用此技能。
```

**改动 B — 角色定义（第 31 行）**

```
# 当前
你是 LifeOS 的头脑风暴引导师。当用户调用 `/brainstorm` 时，通过交互式、探索性对话帮助发展和深化想法。

# 替换为
你是 LifeOS 的头脑风暴搭档，善于用提问激发思考、用挑战强化想法。你的风格是好奇、支持、有建设性的挑战。在对话中保持探索性，不急于下结论或创建文件，让想法充分发酵后再进入行动阶段。
```

**改动 C — 术语统一（3 处）**

```
# 第 214 行
# 当前
   - 识别适合原子化的概念
# 替换为
   - 识别适合提取为百科的概念

# 第 219 行
# 当前
   - 保持笔记原子化：每篇只记一个概念
# 替换为
   - 每篇百科只记一个概念

# 第 278 行
# 当前
- 百科笔记保持原子化（一篇只记一个概念）
# 替换为
- 百科笔记每篇只记一个概念
```

### 1.3 today/SKILL.zh.md

**文件路径**: `assets/skills/today/SKILL.zh.md`

**改动 A — Description（第 3 行）**

```
# 当前
description: LifeOS 晨间规划工作流：回顾昨日完成情况、创建今日日记、连接活跃项目并捕获新想法。当用户说"开始今天"、"今天的计划"、"今天做什么"、"规划今天"、"早安"、"start my day"、"morning planning"、"today"时触发。不适用于快速问答（请用 /ask）。

# 替换为
description: 每日规划入口：回顾昨日进展和未完成任务、扫描活跃项目与待复习笔记、收集用户今日目标和新想法、生成今日日记文件。当用户开始新的一天、问"今天做什么"、说"早安"、想规划当日任务、或说"/today"时使用此技能。会自动提示后续可用的技能（/review、/research、/project 等）。
```

**改动 B — 角色定义（第 26 行）**

```
# 当前
你是 LifeOS 的晨间规划助手。

# 替换为
你是 LifeOS 的每日规划助手，帮助用户快速进入工作状态。你会自动扫描昨日遗留、活跃项目、待复习笔记和草稿池，综合这些信息为用户生成一份可执行的今日计划，减少用户的决策负担。
```

**改动 C — 无术语问题**

### 1.4 project/SKILL.zh.md

**文件路径**: `assets/skills/project/SKILL.zh.md`

**改动 A — Description（第 3 行）**

```
# 当前
description: LifeOS 项目创建工作流（双 Agent）：将想法、草稿或资源转化为结构化的项目文件，产出到 20_项目/，支持学习/开发/创作/通用四种类型。当用户说"/project [想法]"、"创建项目"、"开始一个新项目"、"把这个想法变成项目"、"我想学习..."、"帮我规划这本书的学习"时触发。不适用于快速问答（请用 /ask）或研究任务（请用 /research）。

# 替换为
description: 将想法、草稿或学习资源转化为结构化的项目文件（产出到 {项目目录}/）。使用双 Agent 工作流：规划 Agent 生成计划文件供用户审核，确认后执行 Agent 创建正式项目。支持四种项目类型：学习（章节式规划）、开发（单主项目+文档目录）、创作（里程碑式）、通用。当用户想创建项目、规划一本书的学习、把草稿想法正式化、或说"/project"时使用此技能。
```

**改动 B — 角色定义（第 30 行）**

```
# 当前
你是 LifeOS 的项目管理编排专家。当用户想创建项目时，你协调两个专业 Agent：一个负责规划，一个负责执行。

# 替换为
你是 LifeOS 的项目创建编排者，负责协调规划 Agent 和执行 Agent 将用户的想法转化为结构化项目。你确保每个项目有清晰的分类、合理的章节规划、正确的目录结构，并在用户确认计划后才执行创建。
```

**改动 C — 无术语问题**

### 1.5 research/SKILL.zh.md

**文件路径**: `assets/skills/research/SKILL.zh.md`

**改动 A — Description（第 3 行）**

```
# 当前
description: LifeOS 深度研究工作流（双 Agent）：将主题或草稿文件研究为结构化报告，仅产出到 30_研究/。当用户说"/research [主题]"、"帮我研究"、"深度调研"、"我想了解"、"给我写一份研究报告"、"深入研究一下"时触发。

# 替换为
description: 对指定主题或草稿进行深度研究，产出结构化研究报告到 {研究目录}/。使用双 Agent 工作流：规划 Agent 扫描本地草稿、匹配专家人格、生成研究计划；执行 Agent 结合本地草稿与 WebSearch 外部资料撰写报告。支持主题模式（直接给主题）和文件模式（以草稿为锚点展开）。当用户想深入了解某个主题、需要系统性调研、想把草稿扩展为完整报告、或说"/research"时使用此技能。
```

**改动 B — 角色定义（第 32 行）**

```
# 当前
你是 LifeOS 的深度研究编排专家。当用户想深度理解某个主题时，你通过**双 Agent**（规划→执行）协作完成研究，产出可复用的研究报告。

# 替换为
你是 LifeOS 的深度研究编排者，负责协调规划 Agent 和执行 Agent 完成系统性研究。你确保研究有明确的范围、合适的专家人格、充分利用本地草稿作为第一手资料，并结合外部搜索产出高质量报告。
```

**改动 C — 无术语问题**

### 1.6 knowledge/SKILL.zh.md

**文件路径**: `assets/skills/knowledge/SKILL.zh.md`

**改动 A — Description（第 3 行）**

```
# 当前
description: LifeOS 知识整理技能：将书籍章节或论文结合项目文件与草稿笔记，解析为结构化的知识笔记（笔记/百科），仅产出到 40_知识/。当用户说"/knowledge"、"分析这章知识"、"提取知识点"、"把这章笔记结构化"、"生成百科"、"整理成知识笔记"时触发。需要用户同时提供项目文件和原文内容。不适用于生成研究报告（请用 /research）。

# 替换为
description: 从书籍章节或论文中蒸馏结构化知识笔记和百科概念（产出到 {知识目录}/）。需要三类输入：项目文件（必须）、原文内容（必须）、草稿笔记（可选融合）。产出主笔记（按模板结构化）和百科概念（Wiki 条目），并建立双向 Wikilinks。当用户想整理某章知识点、提取百科概念、把原文结构化为笔记、或说"/knowledge"时使用此技能。若无项目文件会提示先用 /project 创建。
```

**改动 B — 角色定义（第 29 行）**

```
# 当前
你是 LifeOS 的知识蒸馏专家。

# 替换为
你是 LifeOS 的知识整理专家，将原文内容重构为高度结构化的知识笔记和百科概念。你严格遵守模板结构和目录约定，确保每篇百科只记一个概念，所有概念通过 Wikilinks 互相关联。
```

**改动 C — 无术语问题**（knowledge 文件中无"原子"）

### 1.7 review/SKILL.zh.md

**文件路径**: `assets/skills/review/SKILL.zh.md`

**改动 A — Description（第 3 行）**

```
# 当前
description: LifeOS 知识复习工作流：从 40_知识/ 加载已有笔记，生成复习文件供用户在 .md 中作答，完成后触发批改，更新 status 并记录到日记。当用户说"/review"、"复习"、"回顾"、"测一下"、"温故知新"、"检验掌握程度"时触发。当用户说"批改"、"改卷"、"检查复习"时触发批改流程。不适用于新知识整理（请用 /knowledge）。

# 替换为
description: 对已有知识笔记进行主动回忆复习。生成复习文件（.md），用户在文件中作答后触发批改，自动更新笔记 status（draft→review→mastered）和项目掌握度。支持三种模式：提问模式（应用题）、费曼模式（用自己的话解释概念）、盲点扫描（自评掌握程度）。当用户想复习、测验掌握程度、说"/review"时使用此技能。用户说"批改"或"改卷"时触发批改流程。
```

**改动 B — 角色定义（第 26 行）**

```
# 当前
你是 LifeOS 的复习教练。

# 替换为
你是 LifeOS 的复习教练，通过主动回忆测试帮助用户巩固已学知识。你出题侧重理解和应用而非死记硬背，批改时既肯定正确部分也指出薄弱环节，并自动维护笔记的掌握度状态。
```

**改动 C — 无术语问题**

### 1.8 archive/SKILL.zh.md

**文件路径**: `assets/skills/archive/SKILL.zh.md`

**改动 A — Description（第 3 行）**

```
# 当前
description: LifeOS 归档工作流：扫描并归档已完成的项目（status:done）和已处理的草稿（status:researched/projected/knowledged），保持 Vault 整洁。当用户说"/archive"、"归档"、"清理"、"整理完成的项目"、"清空已处理草稿"、"整理一下库"时触发。不归档 status:pending 的草稿。

# 替换为
description: 扫描并归档已完成的项目（status:done）和已消化的草稿（status:researched/projected/knowledged），按年月移入归档目录并更新 frontmatter。不会触碰 pending 状态的草稿。当用户想清理 Vault、归档已完成的工作、整理库、或说"/archive"时使用此技能。
```

**改动 B — 角色定义（第 24 行）**

```
# 当前
你是 LifeOS 的归档管理员。

# 替换为
你是 LifeOS 的归档管理员，帮助用户保持 Vault 的活跃空间整洁。你只归档已完成的工作，绝不触碰仍在处理中的内容，归档前必须让用户确认清单。
```

**改动 C — 无术语问题**

### 1.9 read-pdf/SKILL.zh.md

**文件路径**: `assets/skills/read-pdf/SKILL.zh.md`

**改动 A — Description（第 3 行）**

```
# 当前
description: LifeOS PDF 读取器：从 PDF 书籍或论文中提取文字、图表、公式和表格，产出 JSON 中间成果供下游技能消费。可由用户直接调用或被 /ask、/knowledge、/review 内部调用。当用户说"读取PDF"、"提取PDF"、"read-pdf"、"解析这本书的第X章"、"把PDF第N页转成笔记素材"时触发。

# 替换为
description: 从 PDF 文件中提取文字、图表（Vision 分析）、数学公式（转 LaTeX）和表格（转 Markdown），产出 JSON 中间数据供 /knowledge、/ask、/review 等技能消费。支持页码范围和章节名定位。当用户需要读取 PDF 内容、提取特定页面、解析书籍章节、或说"/read-pdf"时使用此技能。也会被其他技能内部自动调用。
```

**改动 B — 角色定义（第 18 行）**

```
# 当前
你是 LifeOS 的 PDF 中间读取器。将 PDF 指定页码范围提取为结构化 JSON 中间成果，供 `/knowledge`、`/review`、`/ask` 等下游技能消费。

# 替换为
你是 LifeOS 的 PDF 解析工具，将 PDF 页面转化为结构化的 JSON 中间数据。你通过文字提取和 Vision 图像分析相结合，确保图表、公式和表格都被准确捕获，供下游技能消费。
```

**改动 C — 无术语问题**

---

## 步骤 4：Agent Prompt 配置精简

对 4 个 Agent reference prompt 文件，将各自的路径配置说明简化为一行引用。

### 4.1 project/references/planning-agent-prompt.zh.md

**文件路径**: `assets/skills/project/references/planning-agent-prompt.zh.md`

**操作**: 找到文件开头的路径配置说明块（通常是 `> [!config]` 或注释段落），替换为：

```
> 路径逻辑名（如 `{项目目录}`、`{草稿目录}`）由 Orchestrator 从 `lifeos.yaml` 解析后注入上下文。映射关系见主技能文件 `project/SKILL.md` 的配置块。
```

### 4.2 project/references/execution-agent-prompt.zh.md

**文件路径**: `assets/skills/project/references/execution-agent-prompt.zh.md`

**操作**: 同 4.1，替换配置说明块。

### 4.3 research/references/planning-agent-prompt.zh.md

**文件路径**: `assets/skills/research/references/planning-agent-prompt.zh.md`

**操作**: 同 4.1，替换配置说明块，引用改为 `research/SKILL.md`。

### 4.4 research/references/execution-agent-prompt.zh.md

**文件路径**: `assets/skills/research/references/execution-agent-prompt.zh.md`

**操作**: 同 4.3。

---

## 步骤 5：read-pdf 记忆集成修复

**文件路径**: `assets/skills/read-pdf/SKILL.zh.md`

**操作**: 找到第一轮新增的"记忆系统集成"节，简化为仅保留 `memory_skill_complete`（供用户直接调用场景），移除 `session_bridge` 和 `memory_checkpoint`（read-pdf 作为工具技能，通常不是会话终点）。

替换为：

```markdown
# 记忆系统集成

> read-pdf 作为工具技能，通常被其他技能内部调用，不需要完整的记忆集成。
> 仅在用户直接调用时记录技能完成事件。

### 技能完成（仅限用户直接调用）

```
memory_skill_complete(
  skill_name="read-pdf",
  summary="提取 PDF <文件名> 第 X-Y 页",
  scope="read-pdf",
  refresh_targets=[]
)
```
```

---

## 步骤 6：brainstorm 长内容拆分

**目标**: 将 brainstorm/SKILL.zh.md 从 ~321 行缩减到 ~220 行。

### 6.1 新建 references 文件

**新建文件**: `assets/skills/brainstorm/references/action-options.zh.md`

**内容来源**: 从 SKILL.zh.md 中提取阶段 3 的三个完整选项流程（"选项1：创建项目"、"选项2：整理知识"、"选项3：保存草稿"），包括各选项的步骤、模板引用、frontmatter 示例等。

### 6.2 修改主文件

**文件路径**: `assets/skills/brainstorm/SKILL.zh.md`

**操作**: 将阶段 3 的选项详情替换为简要列表 + 引用指针：

```markdown
# 阶段3：行动阶段

总结确认后，提供三个选项：

1. **创建项目** — 调用 /project 规划阶段，将头脑风暴摘要作为项目种子
2. **整理知识** — 在 {知识目录}/{百科子目录}/ 创建百科笔记
3. **保存草稿** — 在 {草稿目录}/ 创建草稿笔记，供后续 /research 或 /knowledge 深化

> 各选项的详细执行步骤见 `references/action-options.md`。

如果本轮对话没有生成正式产出但已形成方向性决策，收尾前补记一条 decision：
memory_log(entry_type="decision", summary="<方向性结论>", scope="brainstorm")
```

---

## 步骤 7：review 长内容拆分

**目标**: 将 review/SKILL.zh.md 从 ~347 行缩减到 ~220 行。

### 7.1 新建 references 文件

**新建文件**: `assets/skills/review/references/grading-protocol.zh.md`

**内容来源**: 从 SKILL.zh.md 中提取：
- 阶段 2.5 批改流程（逐题评估规则、批改结果格式、frontmatter 更新）
- 阶段 3 更新与总结（笔记 status 更新规则、项目掌握度小圆点更新、日记写入规则、输出摘要格式）

### 7.2 修改主文件

**文件路径**: `assets/skills/review/SKILL.zh.md`

**操作**: 将阶段 2.5 和阶段 3 的详细内容替换为概述 + 引用指针：

```markdown
## 阶段2.5：批改流程

用户完成作答后触发（说"批改"、"改卷"等）。

> 完整批改协议见 `references/grading-protocol.md`，包括逐题评估规则（✅/⚠️/❌）、
> 批改结果格式、status 更新规则、项目掌握度回写、日记记录。

**核心规则速查：**
- status 只升不降：draft → review → mastered
- ≥80% → mastered，50%-80% → review，<50% → 维持当前
- 批改后更新项目掌握度小圆点（⚪→🔴→🟡→🟢）
- 在今日日记追加复习记录
```

---

## 执行顺序与并行策略

```
第一批（合并执行，涉及同一组文件）:
  ├── 步骤 1-3: 9 个 SKILL.zh.md 的 description + 角色定义 + 术语
  │   可拆为 3 个并行 Agent:
  │   ├── Agent A: ask, brainstorm, today (3 文件)
  │   ├── Agent B: project, research, knowledge (3 文件)
  │   └── Agent C: review, archive, read-pdf (3 文件)
  │
第二批（独立任务，全部可并行）:
  ├── 步骤 4: Agent prompt 配置精简 (4 文件)
  ├── 步骤 5: read-pdf 记忆集成修复 (1 文件)
  ├── 步骤 6: brainstorm 拆分 (1 改 + 1 新建)
  └── 步骤 7: review 拆分 (1 改 + 1 新建)
```

---

## 变更清单汇总

### 修改的文件（13 个）

| 文件 | 步骤 | 改动类型 |
|------|------|---------|
| `assets/skills/ask/SKILL.zh.md` | 1-3 | description + 角色定义 + 术语 |
| `assets/skills/brainstorm/SKILL.zh.md` | 1-3, 6 | description + 角色定义 + 术语 + 拆分 |
| `assets/skills/today/SKILL.zh.md` | 1-3 | description + 角色定义 |
| `assets/skills/project/SKILL.zh.md` | 1-3 | description + 角色定义 |
| `assets/skills/research/SKILL.zh.md` | 1-3 | description + 角色定义 |
| `assets/skills/knowledge/SKILL.zh.md` | 1-3 | description + 角色定义 |
| `assets/skills/review/SKILL.zh.md` | 1-3, 7 | description + 角色定义 + 拆分 |
| `assets/skills/archive/SKILL.zh.md` | 1-3 | description + 角色定义 |
| `assets/skills/read-pdf/SKILL.zh.md` | 1-3, 5 | description + 角色定义 + 记忆修复 |
| `assets/skills/project/references/planning-agent-prompt.zh.md` | 4 | 配置精简 |
| `assets/skills/project/references/execution-agent-prompt.zh.md` | 4 | 配置精简 |
| `assets/skills/research/references/planning-agent-prompt.zh.md` | 4 | 配置精简 |
| `assets/skills/research/references/execution-agent-prompt.zh.md` | 4 | 配置精简 |

### 新建的文件（2 个）

| 文件 | 步骤 | 说明 |
|------|------|------|
| `assets/skills/brainstorm/references/action-options.zh.md` | 6 | Phase 3 三个行动选项详细流程 |
| `assets/skills/review/references/grading-protocol.zh.md` | 7 | 批改协议 + 状态更新规则 |
