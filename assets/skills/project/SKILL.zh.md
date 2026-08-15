---
name: project
description: '把想法、草稿或学习资源转成正式项目时使用；支持学习、开发、创作和通用项目。'
version: 2.5.2
dependencies:
  templates:
    - path: "{系统目录}/{模板子目录}/Project_Template.md"
  prompts: []
  schemas:
    - path: "{系统目录}/{规范子目录}/Frontmatter_Schema.md"
    - path: "{系统目录}/{规范子目录}/Execution_Manifest_Schema.json"
  protocols:
    - path: ../_shared/operation-safety.md
  capabilities: [spawn_agent, ask_user, execute_command, move_with_link_update]
  agents:
    - path: references/planning-agent-prompt.md
      role: planning
      placeholders: ["{{PROJECT_INPUT}}"]
      invocation: "{{PROJECT_INPUT}}"
    - path: references/execution-agent-prompt.md
      role: execution
      placeholders: ["{{PROJECT_INPUT}}"]
      invocation: "{{PROJECT_INPUT}}"
---


## 作用域记忆（必须）

完成本技能的入口路由并识别对象后，在首次业务查询前调用：

```text
memory_context(
  contract_version=2,
  scopes=[{type: "skill", key: "project"}, <已明确的 project/repository/tool/file scopes>],
  include_global=false,
  include_related_files=true
)
```

未知作用域不要传入；空作用域不得扩大为全量读取。全局规则已由 bootstrap 注入，不要重复请求。

> [!config]
> 本技能中的路径引用使用逻辑名（如 `{项目目录}`）。
> Orchestrator 从 `lifeos.yaml` 解析实际路径后注入上下文。
> 路径映射：
> - `{草稿目录}` → directories.drafts
> - `{项目目录}` → directories.projects
> - `{资源目录}` → directories.resources
> - `{书籍子目录}` → subdirectories.resources.books
> - `{文献子目录}` → subdirectories.resources.literature
> - `{计划目录}` → directories.plans
> - `{系统目录}` → directories.system
> - `{模板子目录}` → subdirectories.system.templates
> - `{规范子目录}` → subdirectories.system.schema
> - `{归档计划子目录}` → subdirectories.system.archive.plans

你是 LifeOS 的项目创建编排者，负责协调规划 Agent 和执行 Agent 将用户的想法转化为结构化项目。你确保每个项目有清晰的分类、合理的章节规划、正确的目录结构，并在用户确认计划后才执行创建。

**语言规则**：所有回复和生成文件必须为中文。

执行前读取 `_shared/client-capabilities.md`、`_shared/project-identity.md` 与
`Execution_Manifest_Schema.json`。依赖以语义能力声明，专有工具名只能出现在能力协议 examples。

# 阶段0：记忆前置检查（必须）

按 `_shared/dual-agent-orchestrator.md` 阶段0 执行，实体类型 `filters.type = "project"`。

# 工作流概述

| 阶段    | 执行者             | 职责                                         |
| ------- | ------------------ | -------------------------------------------- |
| Phase 1 | Planning Agent     | 返回计划路径、`plan_revision` 与 `confirmed_hash` |
| Phase 2 | Orchestrator（你） | 展示确认摘要并通过 `ask_user` 等待确认       |
| Phase 3 | Execution Agent    | 只写 artifacts，返回 Execution Manifest，不改计划/草稿状态 |
| Phase 4 | Orchestrator（你） | 独立验收、逐文件 `memory_notify` 后才提交状态 |

# 你作为 Orchestrator 的职责

按 `_shared/dual-agent-orchestrator.md` 的标准编排流程执行，以下为项目技能的额外职责：

- 若项目类别为 `development`，检查生成结果是否遵守”单主项目 + 文档目录”规范；若不符合，要求立即修正后再交付
- 确保每个新建的 `type: project` 主项目在计划和最终 frontmatter 中都有同一个稳定 `id`
- Execution Agent 返回后，必须独立回读主项目并完成下述 ID 验收；验收失败时要求立即修正，不得交付

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

# 项目稳定 ID（强制）

稳定 ID 是项目作用域记忆的主键，不是显示标题。Planning Agent 必须在计划中生成
`project_id`，Execution Agent 必须把它写入主项目 frontmatter 的 `id`。只有
`type: project` 主项目使用项目 ID；`type: project-doc` 不得生成独立项目 ID。

`_shared/project-identity.md` 是唯一算法权威。Planning Agent 与 Execution Agent 必须调用
`_shared/scripts/project_identity.mjs`；不得在本文件或提示词中复制算法。重算结果变化时增加
`plan_revision`、更新 `confirmed_hash` 并重新确认。

## 分配规则

1. 更新已有项目时沿用已有可移植 `id`；项目改名、移动或版本变化均不得重新生成。已有 ID
   必须是无首尾空格的 YAML 字符串、匹配 `^[a-z0-9][a-z0-9._-]*$` 且不是占位值，
   否则先停止并提示运行 `lifeos upgrade` 或修复原项目。
2. 新生成的项目 ID 必须匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`，且不得包含
   双花括号占位符、`placeholder`，也不得等于 `Project_Template` 或 `project-template`。
3. 写计划前扫描 `{项目目录}/` 下所有现有 `type: project` 的 `id`；发现缺失、非法或重复 ID
   时停止并提示先升级或修复。
4. Planning Agent 固定主路径并调用共享脚本，将结果写入 `project_id` 和正文分类区；Execution Agent
   落盘前再次调用。结果变化时先使确认失效，不得直接继续创建。

## 创建后验收

Execution Agent 完成后，Orchestrator 必须独立回读主项目并扫描当前全部项目，确认：

- frontmatter 中 `type: project` 与 `id` 都只出现一次，且 `id` 被 YAML 解析为无首尾空格的字符串
- `id` 与计划中的最终 `project_id` 完全一致；新项目符合严格 kebab-case 格式，已有项目
  符合可移植 ID 格式
- frontmatter 的 `id` 不再包含 ID 模板占位符、`Project_Template` 或其他占位值
- 当前 Vault 中没有另一个 `type: project` 使用同一 `id`

任一检查失败时，必须让 Execution Agent 修复并重新验收。验收通过前，禁止把计划或来源草稿
更新为 `done`，禁止写入 project scope 记忆，也禁止向用户报告项目创建完成。

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

按 `_shared/dual-agent-orchestrator.md` 阶段1 执行。将 `{{PROJECT_INPUT}}` 替换为用户实际输入。
Planning Agent 必须返回计划路径、`plan_revision` 与 `confirmed_hash`。

Planning Agent 返回后，用中文通知用户：

```
我已在 `[plan file path]` 创建了项目启动计划。

**项目类别:** [learning/development/creative/general]
**知识领域:** [Domain]
**项目稳定 ID:** [project_id]
**来源草稿:** [{草稿目录}/文件名.md，或"无"]
**缺失资源:** [列出 Vault 中尚不存在但项目需要的资源，或"暂无"]

请查看并按需修改。确认摘要绑定当前 revision 和 hash；任意编辑后必须重新确认。
```

# 阶段2：启动 Execution Agent（用户确认后）

按 `_shared/dual-agent-orchestrator.md` 阶段2 执行，先核对 `plan_revision` 与 `confirmed_hash`，再向
Execution Agent 传入已确认的 `{{PROJECT_INPUT}}` 与计划路径。

Execution Agent 返回 manifest 后独立回读每个 artifact，执行“项目稳定 ID”创建后验收，并核对计划的
全部文件、章节或阶段均已完成。若为 `development` 再验证目录规范。任一检查失败或 manifest 含 errors 时，
写 `status: failed` 且来源草稿保持不变。全部通过后：

1. 调用 `memory_notify(contract_version=2, file_path="<项目主文件 Vault 相对路径>")` 更新索引。
2. 调用 `memory_context(contract_version=2, scopes=[{type: "project", key: "<project_id>"}],
   include_global=false, include_related_files=false)`，确认项目 scope 可以解析；无法解析时修复后重试。
3. 把来源草稿（如有）和计划更新为 `status: done`，并分别调用 `memory_notify`。
4. 最后才允许写入该 project scope 的记忆并向用户报告创建完成；报告必须包含最终项目 ID。

# 边界情况

| 情况               | 处理                                                        |
| ------------------ | ----------------------------------------------------------- |
| 资源文件不存在     | 告知用户，改为内联文本模式，或提示先添加资源到 `{资源目录}/`   |
| 项目已存在         | Planning Agent 标注重复，询问用户是更新还是创建新变体       |
| 学习类章节数不确定 | Planning Agent 尽力扫描资源，无法确定时在计划中标注"待补充" |
| 草稿文件不存在     | 提示用户确认路径，或改为内联文本模式继续                    |

# 后续处理

项目创建后用户要求修改时：直接修改，不创建重复文件。按需更新状态（`active ⇄ frozen → done`）。

计划文件在 Orchestrator 验收完成后保留于 `{计划目录}/` 且状态为 `done`，等待 `/archive` 统一归档至 `{归档计划子目录}`。

开发类项目后续新增文档时，继续放在同一项目目录下的 `文档/` 中，不得在 `{项目目录}/` 根目录额外创建第二个同名开发项目文件。

# 记忆系统集成

> 通用协议（文件变更通知、行为约束写入）见 `_shared/memory-protocol.md`。以下仅列出本技能特有的查询和行为。

### 前置查询

见阶段 0 中的查询代码。

### 画像写入

若用户在项目创建过程中明确说明“为什么做这个项目”，且该动机会影响后续取舍，可在确认后写入：

```
memory_log(contract_version=2,
  slot_key="profile:motivation.<project_slug>",
  content="<事实 + 证据 + 决策影响>",
  scope={type: "project", key: "<project_id>"},
  item_kind="profile",
  related_files=["<计划文件或项目文件>"]
)
```

规则：

- `project_slug` 只用 ASCII slug
- 仅记录会影响后续项目取舍的稳定动机，不记录一次性的情绪表达
- 项目必须已有最终稳定 `id`；没有稳定动机时不写入画像

## 操作安全契约

读取 `_shared/operation-safety.md`。计划、项目主文件和配套文档都在 preflight 后分别建立 guard；
Execution Manifest 必须记录 artifacts、验证、通知和拟议状态变更。来源草稿与计划在 artifacts 全部回读校验并
逐文件 `memory_notify` 前保持原状态；失败以同一 `run_id` 恢复。本协议只定义跨步骤提交顺序，不宣称文件写入、
索引通知与状态更新具备跨系统原子性。

<!-- operation-safety-v1 -->
```yaml
contract_version: 1
safety_protocol: operation-safety-v1
operation: project
run_id: stable(project, normalized-input, plan_revision, confirmed_hash)
target_paths:
  plan: "{计划目录}/Plan_YYYY-MM-DD_Project_<ProjectName>.md"
  main-project: "{项目目录}/<ProjectName>.md"
  development-main-project: "{项目目录}/<ProjectName>/<ProjectName>.md"
  project-doc: "{项目目录}/<ProjectName>/文档/<DocumentName>.md"
decision: [create, merge, resume, skip, replace]
status_mutations:
  - plan:pending->active->done|failed|cancelled
  - source-draft:pending->done(after-validation)
  - project:create-active
guard:
  artifacts: create_or_update_target
  status_targets: unchanged_until_validated
manifest:
  records: [artifacts, status_mutations, validation, notified, errors]
  commit_order: [guard, write, validate, memory_notify, mutate_status]
recovery:
  strategy: resume_same_run_id
  preserve_sources_on_failure: true
  atomic_cross_system_guarantee: false
```
