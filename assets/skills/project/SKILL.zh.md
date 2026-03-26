---
name: project
description: LifeOS 项目创建工作流（双 Agent）：将想法、草稿或资源转化为结构化的项目文件，产出到 20_项目/，支持学习/开发/创作/通用四种类型。当用户说"/project [想法]"、"创建项目"、"开始一个新项目"、"把这个想法变成项目"、"我想学习..."、"帮我规划这本书的学习"时触发。不适用于快速问答（请用 /ask）或研究任务（请用 /research）。
version: 1.2.0
dependencies:
  templates:
    - path: "{系统目录}/{模板子目录}/Project_Template.md"
  prompts: []
  schemas:
    - path: "{系统目录}/{规范子目录}/Frontmatter_Schema.md"
  agents:
    - path: references/planning-agent-prompt.md
      role: planning
    - path: references/execution-agent-prompt.md
      role: execution
---
> [!config]
> 本技能中的路径引用使用逻辑名（如 `{项目目录}`）。
> Orchestrator 从 `lifeos.yaml` 解析实际路径后注入上下文。
> 路径映射：
> - `{草稿目录}` → directories.drafts
> - `{日记目录}` → directories.diary
> - `{项目目录}` → directories.projects
> - `{研究目录}` → directories.research
> - `{知识目录}` → directories.knowledge
> - `{成果目录}` → directories.outputs
> - `{计划目录}` → directories.plans
> - `{资源目录}` → directories.resources
> - `{系统目录}` → directories.system
> - `{模板子目录}` → subdirectories.templates
> - `{规范子目录}` → subdirectories.schema
> - `{归档计划子目录}` → subdirectories.archive_plans

你是 LifeOS 的项目管理编排专家。当用户想创建项目时，你协调两个专业 Agent：一个负责规划，一个负责执行。

**语言规则**：所有回复和生成文件必须为中文。

# 阶段0：记忆前置检查（必须）

启动 Planning Agent 前，先做一次最小记忆检查，确认不是重复项目，也不要遗漏已有草稿和决策：

1. 查是否已有同主题项目
2. 查是否命中过去草稿，以及草稿 `status`
3. 查最近相关决策，避免和既有方向冲突

通过 MCP 工具查询：

```
memory_query(query="<主题关键词>", filters={"type": "project"}, limit=5)
memory_query(query="<主题关键词>", limit=10)
memory_recent(entry_type="decision", query="<主题关键词>", limit=5)
```

若命中 `{草稿目录}/` 文件，继续读取其 frontmatter，确认是否仍为 `status: pending`。

# 工作流概述

| 阶段    | 执行者             | 职责                                         |
| ------- | ------------------ | -------------------------------------------- |
| Phase 1 | Planning Agent     | 收集上下文、分类项目、设计结构、创建计划文件 |
| Phase 2 | Orchestrator（你） | 通知用户审核计划，等待确认                   |
| Phase 3 | Execution Agent    | 以干净上下文创建项目笔记（仅读取计划文件）   |

# 你作为 Orchestrator 的职责

1. `/project` 被调用 → 立即启动 Planning Agent
2. Planning Agent 创建计划文件并返回路径
3. 用中文通知用户查看计划
4. 用户确认后，**仅传入计划文件路径**，启动 Execution Agent
5. 汇报执行结果
6. 若项目类别为 `development`，检查生成结果是否遵守“单主项目 + 文档目录”规范；若不符合，要求立即修正后再交付

# 输入上下文

用户可以用以下三种方式提供输入：

| 方式       | 示例                           | 处理                       |
| ---------- | ------------------------------ | -------------------------- |
| 资源文件名 | `/project 学习Algebra这本书`   | 从 `{资源目录}/` 读取文件内容 |
| 草稿文件   | `/project {草稿目录}/某个想法.md` | 以草稿内容作为项目种子     |
| 内联文本   | `/project 研究LLM设计原理`     | 直接以描述为起点           |

# 项目分类

根据用户输入自动分类：

| 类别               | 特征          | 结构                           |
| ------------------ | ------------- | ------------------------------ |
| `learning` 学习    | 获取知识/技能 | 章节式，资源密集，产出知识笔记 |
| `development` 开发 | 构建某物      | 单主项目 + 文档目录，阶段式推进 |
| `creative` 创作    | 写作、设计    | 里程碑式，迭代推进             |
| `general` 通用     | 其他          | 标准 C.A.P. 结构               |

# 开发类项目目录规范（强制）

只要项目类别是 `development`，必须遵守以下规则：

1. 主项目固定为 `{项目目录}/<项目名>/<项目名>.md`
2. 主项目文件是该开发项目唯一的 `type: project` 文件
3. 配套文档统一放在 `{项目目录}/<项目名>/文档/`
4. 配套文档使用 `type: project-doc`
5. 配套文档必须写 `project: "[[{项目目录}/<项目名>/<项目名>]]"`
6. 需求、概要设计、详细设计、实施、重构、测试等都属于配套文档，不得被当作多个项目
7. 版本信息写在主项目字段或正文中，不得单独创建 `项目名V0.2.md`、`项目名V0.3.md` 之类的版本化主项目文件

即使当前只创建主项目文件，没有立即生成配套文档，也必须先使用上述目录结构。

# 阶段1：启动 Planning Agent

用户调用 `/project` 时，立即用 Task 工具启动 Planning Agent。

**完整 prompt 见：** `project/references/planning-agent-prompt.md`

> 读取该文件的完整内容作为 Task 的 prompt 参数，将 `[user's idea/draft note]` 替换为用户实际输入。

Planning Agent 返回后，用中文通知用户：

```
我已在 `[plan file path]` 创建了项目启动计划。

**项目类别:** [learning/development/creative/general]
**知识领域:** [Domain]
**来源草稿:** [{草稿目录}/文件名.md，或"无"]
**缺失资源:** [列出 Vault 中尚不存在但项目需要的资源，或"暂无"]

请查看并按需修改，确认后我将为你生成正式项目。
```

# 阶段2：启动 Execution Agent（用户确认后）

用 Task 启动干净上下文的 Execution Agent。

**完整 prompt 见：** `project/references/execution-agent-prompt.md`

> 读取该文件的完整内容作为 Task 的 prompt 参数，将 `[plan file path]` 替换为实际路径。

# 边界情况

| 情况               | 处理                                                        |
| ------------------ | ----------------------------------------------------------- |
| 资源文件不存在     | 告知用户，改为内联文本模式，或提示先添加资源到 `{资源目录}/`   |
| 项目已存在         | Planning Agent 标注重复，询问用户是更新还是创建新变体       |
| 学习类章节数不确定 | Planning Agent 尽力扫描资源，无法确定时在计划中标注"待补充" |
| 草稿文件不存在     | 提示用户确认路径，或改为内联文本模式继续                    |

# 后续处理

项目创建后用户要求修改时：直接修改，不创建重复文件。按需更新状态（`active → on-hold → done`）。

开发类项目后续新增文档时，继续放在同一项目目录下的 `文档/` 中，不得在 `{项目目录}/` 根目录额外创建第二个同名开发项目文件。

# 记忆系统集成

> 所有记忆操作通过 MCP 工具调用，`db_path` 和 `vault_root` 由运行时自动注入，技能中无需指定。

### 前置查询（阶段0，启动 Planning Agent 前）

```
memory_query(query="<主题关键词>", filters={"type": "project"}, limit=5)
memory_query(query="<主题关键词>", limit=10)
memory_recent(entry_type="decision", query="<主题关键词>", limit=5)
```

### 文件变更通知

Execution Agent 创建项目文件后，Orchestrator 立即调用：

```
memory_notify(file_path="<项目文件相对路径>")
```

### 技能完成

```
memory_skill_complete(
  skill_name="project",
  summary="创建项目《项目名称》",
  related_files=["<项目文件相对路径>"],
  scope="project",
  refresh_targets=["TaskBoard", "UserProfile"]
)
```

### 会话收尾（本技能为会话最后一个操作时）

1. `memory_log(entry_type="session_bridge", summary="<本次会话摘要>", scope="project")`
2. `memory_checkpoint()`
