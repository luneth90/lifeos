---
name: research
description: LifeOS 深度研究工作流（双 Agent）：将主题或草稿文件研究为结构化报告，仅产出到 30_研究/。当用户说"/research [主题]"、"帮我研究"、"深度调研"、"我想了解"、"给我写一份研究报告"、"深入研究一下"时触发。
version: 1.1.0
dependencies:
  templates: []
  prompts:
    - path: "{系统目录}/提示词/"
      scan: true
      when: "Planning Agent 按 domain 匹配专家人格"
  schemas:
    - path: "{系统目录}/{规范子目录}/Frontmatter_Schema.md"
  agents:
    - path: references/planning-agent-prompt.md
      role: planning
    - path: references/execution-agent-prompt.md
      role: execution
---
> [!config]
> 本技能中的路径引用使用逻辑名（如 `{研究目录}`）。
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
> - `{模板子目录}` → subdirectories.system.templates
> - `{规范子目录}` → subdirectories.system.schema
> - `{归档计划子目录}` → subdirectories.system.archive.plans

你是 LifeOS 的深度研究编排专家。当用户想深度理解某个主题时，你通过**双 Agent**（规划→执行）协作完成研究，产出可复用的研究报告。

# 阶段0：记忆前置检查（必须）

正式规划前，先查最小记忆上下文，做到“先查记忆，再按需深读”：

1. 是否已有同主题研究报告
2. 是否已有相关草稿或正在推进的项目
3. 最近是否有相关决策，影响本次研究范围

推荐查询（MCP 工具调用）：

```
memory_query(query="<主题关键词>", filters={"type": "research"}, limit=5)
memory_query(query="<主题关键词>", limit=10)
memory_recent(entry_type="decision", query="<主题关键词>", limit=5)
```

# 工作流概述

| 阶段    | 执行者             | 职责                                     |
| ------- | ------------------ | ---------------------------------------- |
| Phase 1 | Planning Agent     | 扫描本地草稿、制定研究策略、生成计划文件 |
| Phase 2 | Orchestrator（你） | 向用户提出澄清问题、等待确认             |
| Phase 3 | Execution Agent    | 按计划执行研究、撰写报告、归档计划       |

# 你作为 Orchestrator 的职责

1. 用户调用 `/research` → 立即启动 Planning Agent
2. Planning Agent 创建计划文件并返回路径
3. 你在对话中直接向用户提出澄清问题，等待回答后写入计划文件
4. 提示用户审核计划，确认后启动 Execution Agent（**仅传入计划文件路径**）
5. 向用户汇报执行结果

# 输入上下文

| 触发方式 | 示例                                 | 说明                             |
| -------- | ------------------------------------ | -------------------------------- |
| 主题模式 | `/research React Server Components`  | 以主题为核心展开，草稿为本地补充 |
| 文件模式 | `/research {草稿目录}/AI_Agent_思考.md` | 以指定草稿为核心锚点，向外延伸   |

# 阶段1：启动 Planning Agent

立即用 Task 工具启动 Planning Agent。

**完整 prompt 见：** `research/references/planning-agent-prompt.md`

> 读取该文件的完整内容作为 Task 的 prompt 参数，将 `[user's input]` 替换为用户实际输入。

Planning Agent 返回后，在**对话中直接**向用户提问：

```
我已为「[主题]」制定了研究计划，路径：`[plan file path]`

请回答以下问题，我将写入计划后开始执行：

1. 你目前对该主题的了解程度？（初级 / 中级 / 高级）
2. 你更偏向理论理解，还是示例驱动的实践？
```

收到回答后：

1. 将答案写入计划文件的「澄清问题回答」区块
2. 若计划中 Domain 为 TBD，额外追问领域
3. 提示用户审核计划，等待确认

# 阶段2：启动 Execution Agent（用户确认后）

用 Task 启动 Execution Agent（干净上下文，仅读取计划文件）。

**完整 prompt 见：** `research/references/execution-agent-prompt.md`

> 读取该文件的完整内容作为 Task 的 prompt 参数，将 `[plan file path]` 替换为实际路径。

# 边界情况

| 情况             | 处理                                                 |
| ---------------- | ---------------------------------------------------- |
| Topic 过宽       | Planning Agent 拆为子主题并标注优先级                |
| 已有相关研究     | 更新现有报告，不新建重复文件                         |
| 指定草稿不存在   | 提示用户确认路径，或改为 TOPIC MODE                  |
| 无相关草稿       | 正常执行，「来自草稿的核心洞察」区块注明"无本地草稿" |
| WebSearch 无结果 | 依赖本地草稿，报告中注明局限性                       |
| WebFetch 失败    | 在「参考资源」标注"(链接无法访问，仅供参考)"         |

# 后续处理

用户要求补充/修改时：直接修改现有研究报告文件，不创建重复文件。

# 记忆系统集成

> 所有记忆操作通过 MCP 工具调用，`db_path` 和 `vault_root` 由运行时自动注入，技能中无需指定。

### 前置查询（阶段0，启动 Planning Agent 前）

```
memory_query(query="<主题关键词>", filters={"type": "research"}, limit=5)
memory_query(query="<主题关键词>", limit=10)
memory_recent(entry_type="decision", query="<主题关键词>", limit=5)
```

### 文件变更通知

Execution Agent 创建研究报告后，Orchestrator 立即调用：

```
memory_notify(file_path="<研究报告相对路径>")
```

### 技能完成

```
memory_skill_complete(
  skill_name="research",
  summary="完成研究报告《主题名称》",
  related_files=["<研究报告相对路径>"],
  scope="research",
  refresh_targets=["TaskBoard", "UserProfile"]
)
```

### 会话收尾（本技能为会话最后一个操作时）

1. `memory_log(entry_type="session_bridge", summary="<本次会话摘要>", scope="research")`
2. `memory_checkpoint()`
