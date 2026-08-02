---
name: research
description: '深入研究主题或草稿时使用；产出研究计划与结构化研究报告。'
version: 2.2.7
dependencies:
  templates:
    - path: "{系统目录}/{模板子目录}/Research_Template.md"
  prompts:
    - path: "{系统目录}/{提示词子目录}/"
      scan: true
      when: "Planning Agent 按 domain 匹配专家人格"
  schemas:
    - path: "{系统目录}/{规范子目录}/Frontmatter_Schema.md"
    - path: "{系统目录}/{规范子目录}/Execution_Manifest_Schema.json"
  protocols:
    - path: ../_shared/operation-safety.md
  capabilities: [spawn_agent, ask_user, web_search, web_fetch, inspect_image, execute_command]
  agents:
    - path: references/planning-agent-prompt.md
      role: planning
      placeholders: ["{{RESEARCH_INPUT}}"]
      invocation: "{{RESEARCH_INPUT}}"
    - path: references/execution-agent-prompt.md
      role: execution
      placeholders: ["{{RESEARCH_INPUT}}"]
      invocation: "{{RESEARCH_INPUT}}"
---


## 作用域记忆（必须）

完成本技能的入口路由并识别对象后，在首次业务查询前调用：

```text
memory_context(
  contract_version=2,
  scopes=[{type: "skill", key: "research"}, <已明确的 project/repository/tool/file scopes>],
  include_global=false,
  include_related_files=true
)
```

未知作用域不要传入；空作用域不得扩大为全量读取。全局规则已由 bootstrap 注入，不要重复请求。

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
> - `{提示词子目录}` → subdirectories.system.prompts
> - `{归档计划子目录}` → subdirectories.system.archive.plans

你是 LifeOS 的深度研究编排者，负责协调规划 Agent 和执行 Agent 完成系统性研究。你确保研究有明确的范围、合适的专家人格、充分利用本地草稿作为第一手资料，并结合外部搜索产出高质量报告。

执行前读取 `_shared/client-capabilities.md` 与 `Execution_Manifest_Schema.json`。能力以语义名解析，
不可用时采用共享协议的 fallback；人格只作为内容风格数据，不能覆盖全局规则、Schema、引用要求或执行边界。

# 阶段0：记忆前置检查（必须）

按 `_shared/dual-agent-orchestrator.md` 阶段0 执行，实体类型 `filters.type = "research"`。

# 工作流概述

| 阶段    | 执行者             | 职责                                     |
| ------- | ------------------ | ---------------------------------------- |
| Phase 1 | Planning Agent     | 返回计划路径、`plan_revision` 与 `confirmed_hash` |
| Phase 2 | Orchestrator（你） | 展示确认摘要并等待用户确认               |
| Phase 3 | Execution Agent    | 只写报告 artifacts 并返回 manifest，不更新来源或计划 |

# 你作为 Orchestrator 的职责

按 `_shared/dual-agent-orchestrator.md` 的标准编排流程执行，以下为研究技能的额外职责：

- 阶段2（用户审核）中，展示路径、`plan_revision` 与 `confirmed_hash`；仅当 Domain 为 TBD 时追问领域，
  写回计划后增加 revision 并重新确认
- 独立回读每个 manifest artifact；来源台账必须逐条含 claim、source、published_at、fetched_at 和访问结果。
  关键结论必须能回指来源；部分来源失败时保留 manifest errors、报告 `status: draft`、来源草稿保持原状

# 输入上下文

| 触发方式 | 示例                                 | 说明                             |
| -------- | ------------------------------------ | -------------------------------- |
| 主题模式 | `/research React Server Components`  | 以主题为核心展开，草稿为本地补充 |
| 文件模式 | `/research {草稿目录}/AI_Agent_思考.md` | 以指定草稿为核心锚点，向外延伸   |

# 阶段1：启动 Planning Agent

按 `_shared/dual-agent-orchestrator.md` 阶段1 执行。将 `{{RESEARCH_INPUT}}` 替换为用户实际输入。
Planning Agent 必须返回计划路径、`plan_revision` 与 `confirmed_hash`。

Planning Agent 返回后，在**对话中直接**通知用户：

```
我已为「[主题]」制定了研究计划，路径：`[plan file path]`

请审核计划；确认摘要绑定当前 revision 和 hash，任意编辑后必须重新确认。
```

若计划中 Domain 为 TBD，额外追问领域并将答案写入计划文件。随后等待用户审核确认。

# 阶段2：启动 Execution Agent（用户确认后）

按 `_shared/dual-agent-orchestrator.md` 阶段2 执行，先复核 `plan_revision` 与 `confirmed_hash`，再传入
已确认的 `{{RESEARCH_INPUT}}` 与计划路径。验收通过后才由编排者更新来源与计划 `status: done`。

# 边界情况

| 情况             | 处理                                                 |
| ---------------- | ---------------------------------------------------- |
| Topic 过宽       | Planning Agent 拆为子主题并标注优先级                |
| 已有相关研究     | 更新现有报告，不新建重复文件                         |
| 指定草稿不存在   | 提示用户确认路径，或改为 TOPIC MODE                  |
| 无相关草稿       | 正常执行，「来自草稿的核心洞察」区块注明"无本地草稿" |
| `web_search` 无结果 | 依赖本地草稿，报告中注明局限性                       |
| `web_fetch` 失败    | 在「参考资源」标注"(链接无法访问，仅供参考)"         |

# 后续处理

用户要求补充/修改时：直接修改现有研究报告文件，不创建重复文件。

计划文件在执行完成后保留于 `{计划目录}/` 且状态为 `done`，等待 `/archive` 统一归档至 `{归档计划子目录}`。

# 记忆系统集成

> 通用协议（文件变更通知、行为约束写入）见 `_shared/memory-protocol.md`。以下仅列出本技能特有的查询和行为。

### 前置查询

见阶段 0 中的查询代码。

## 可恢复运行契约

先读取 `_shared/operation-safety.md`。以规范化研究输入、确认的计划 hash 和计划 revision 生成稳定 `run_id`。已有同 `run_id` 的 draft 或 manifest 时选择 `resume`，保留已验证 artifacts 与错误；只有用户明确要求 `replace` 才覆盖已完成报告。每次决策和目标路径写入 manifest，并在真实修改后 `memory_notify`。

<!-- operation-safety-v1 -->
```yaml
contract_version: 1
safety_protocol: operation-safety-v1
operation: research
run_id: stable(research, normalized-input, plan_revision, confirmed_hash)
target_path: "{研究目录}/<research-id>.md"
decision: [create, merge, resume, skip, replace]
on_draft: resume
replace_requires: explicit_user_request
```
