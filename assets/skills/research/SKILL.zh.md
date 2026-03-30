---
name: research
description: '对指定主题或草稿进行深度研究，产出结构化研究报告到 {研究目录}/。使用双 Agent 工作流：规划 Agent 扫描本地草稿、匹配专家人格、生成 `type: plan, status: active` 的研究计划；执行 Agent 结合本地草稿与 WebSearch 外部资料撰写报告，并将计划更新为 `status: done`。支持主题模式（直接给主题）和文件模式（以草稿为锚点展开）。当用户想深入了解某个主题、需要系统性调研、想把草稿扩展为完整报告、或说"/research"时使用此技能。'
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
> - `{研究目录}` → directories.research
> - `{计划目录}` → directories.plans
> - `{系统目录}` → directories.system
> - `{模板子目录}` → subdirectories.system.templates
> - `{规范子目录}` → subdirectories.system.schema
> - `{归档计划子目录}` → subdirectories.system.archive.plans

你是 LifeOS 的深度研究编排者，负责协调规划 Agent 和执行 Agent 完成系统性研究。你确保研究有明确的范围、合适的专家人格、充分利用本地草稿作为第一手资料，并结合外部搜索产出高质量报告。

# 阶段0：记忆前置检查（必须）

按 `_shared/dual-agent-orchestrator.zh.md` 阶段0 执行，实体类型 `filters.type = “research”`。

# 工作流概述

| 阶段    | 执行者             | 职责                                     |
| ------- | ------------------ | ---------------------------------------- |
| Phase 1 | Planning Agent     | 扫描本地草稿、制定研究策略、生成计划文件 |
| Phase 2 | Orchestrator（你） | 向用户提出澄清问题、等待确认             |
| Phase 3 | Execution Agent    | 按计划执行研究、撰写报告，并将计划更新为 `status: done` |

# 你作为 Orchestrator 的职责

按 `_shared/dual-agent-orchestrator.zh.md` 的标准编排流程执行，以下为研究技能的额外职责：

- 阶段2（用户审核）中，你在对话中直接向用户提出澄清问题，收到回答后写入计划文件，再提示用户审核确认

# 输入上下文

| 触发方式 | 示例                                 | 说明                             |
| -------- | ------------------------------------ | -------------------------------- |
| 主题模式 | `/research React Server Components`  | 以主题为核心展开，草稿为本地补充 |
| 文件模式 | `/research {草稿目录}/AI_Agent_思考.md` | 以指定草稿为核心锚点，向外延伸   |

# 阶段1：启动 Planning Agent

按 `_shared/dual-agent-orchestrator.zh.md` 阶段1 执行。占位符 `[user's input]` 替换为用户实际输入。

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

按 `_shared/dual-agent-orchestrator.zh.md` 阶段3 执行。

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

计划文件在执行完成后保留于 `{计划目录}/` 且状态为 `done`，等待 `/archive` 统一归档至 `{归档计划子目录}`。

# 记忆系统集成

> 通用协议（文件变更通知、技能完成、会话收尾）见 `_shared/memory-protocol.md`。以下仅列出本技能特有的查询和行为。

### 前置查询

见阶段 0 中的查询代码。
