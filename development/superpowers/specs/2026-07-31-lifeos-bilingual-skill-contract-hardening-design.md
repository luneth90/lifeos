# LifeOS 双语技能契约加固设计

## 背景

现有技能已经覆盖捕获、规划、研究、知识整理、复习、归档、信息摘要、PDF 读取与翻译等主要流程，但同一概念在 Frontmatter Schema、模板、共享协议和具体技能中存在多套定义。典型问题包括状态枚举冲突、固定模板 ID、双 Agent 提交边界不清、平台工具名写死、PDF 不完整提取仍被下游当作完整输入，以及重复运行时缺少幂等规则。

本轮修改以此前源码评审结论为输入，同时覆盖中文和英文资产。中文版与英文版必须表达同一运行契约；任何会影响行为的修改都在同一阶段、同一提交中成对完成。

## 目标

- 建立 Schema、模板、生命周期、共享协议和技能之间唯一且可验证的数据契约。
- 让中文与英文技能在状态流转、占位符、能力依赖、失败处理和产物结构上保持一致。
- 将所有多文件写入流程改造成可确认、可校验、可恢复的提交过程。
- 让 PDF 提取结果显式携带完整性、页码语义和错误信息，避免静默丢失内容。
- 为重复运行、路径冲突、取消、失败和恢复建立统一规则。
- 把可机械验证的约束放入自动化测试，减少仅靠提示词维持一致性的风险。

## 非目标

- 本轮不发布新版本，不修改版本号，不创建标签，不推送远端。
- 不改动 Vault 中由安装流程生成的 `.agents/skills` 副本；所有修改落在 LifeOS 源码资产中。
- 不重写技能的业务定位，也不增加新的顶层技能。
- 不把英文版视作自由改写；英文版只做与中文版等价的契约表达。
- 不把用户当前 `package.json` 的格式化改动混入任何阶段提交。

## 方案选择

### 采用：契约优先的分阶段迁移

先统一共享数据模型，再逐层修改编排、路由、PDF 链路和幂等规则。每个阶段都包含中英文资产、测试、验证和独立提交。后续阶段只依赖已经提交的前置契约。

优点是提交边界清晰、回退成本低、共享文件不会被每个技能反复改写；代价是中间阶段会暂时保留部分尚未迁移的旧流程，因此每阶段必须明确兼容边界。

### 未采用：按技能逐个完成

逐个完成 `/ask`、`/project`、`/research` 等技能便于单技能验收，但多个技能共同依赖 Schema、模板和共享编排协议，会造成重复修改和阶段间语义漂移。

### 未采用：一次性整体替换

一次完成所有资产可以避免中间状态，但提交过大，难以定位回归，也不符合本轮“每完成一个阶段即提交”的要求。

## 全局设计约束

### 双语一致性

- 所有 `SKILL.zh.md` 与 `SKILL.en.md`、共享协议、引用提示词和双语模板必须成对修改。
- 行为关键字保持完全一致，包括 `type`、`status`、Frontmatter 字段、占位符、能力标识、清单字段和状态迁移。
- 中文版是审阅时的语义基准，英文版必须经过结构化一致性测试，不能只检查文件存在。
- 单个语言版本缺少依赖文件、模板或引用时，阶段验证直接失败。

### 唯一权威

- `assets/schema/Frontmatter_Schema.md` 定义字段、类型和状态。
- `assets/templates/{zh,en}/` 定义生成文件的结构。
- `_shared/lifecycle.{zh,en}.md` 定义状态迁移与归档语义。
- `_shared/dual-agent-orchestrator.{zh,en}.md` 定义计划确认、执行、校验和提交顺序。
- 具体技能只能引用上述契约，不得重新定义不同版本。

### Frontmatter 与身份

- 所有由模板生成的实体都使用运行时生成的 `{{ID}}`，禁止把模板名写入实体 `id`。
- `id` 在 Vault 内按实体类型唯一，创建后不因重命名或移动而变化。
- `domain`、`project`、`source` 等链接字段遵守 Schema 规定的 wikilink 或字符串类型。
- `translation` 纳入正式 `type` 枚举；翻译不完整时保持 `status: draft`，完整校验后才进入 `complete`。
- `retro` 与 `revise-record` 保持为两个不同类型；复盘使用 `revise_type`，复习记录使用 `mode`、`score` 和 `result`。

### 状态与归档

- `draft`：`pending → done`。
- `project`：`active ↔ frozen → done`，完成状态不回退。
- `plan`：`pending → active → done`，并允许终止到 `failed` 或 `cancelled`。
- `research`：`draft → complete`。
- `translation`：`draft → complete`。
- `knowledge`：`draft → review → revised → mastered`，只升不降。
- `revise-record`：`pending → graded`，结果由 `result: pass | fail` 表示。
- 归档是位置和时间属性：移动后写入 `archived: "YYYY-MM-DD"`，不把任何实体改成 `status: archived`。

### 写入与提交

多文件技能统一采用以下顺序：

1. 解析全部输入与目标路径，生成不可变计划快照。
2. 用户确认计划快照；确认后记录快照摘要。
3. Execution Agent 只返回结构化执行清单，不直接宣告完成。
4. Orchestrator 独立检查产物、Frontmatter、引用、完整性和预期状态变化。
5. 校验通过后逐文件调用 `memory_notify`，再提交来源文件和计划状态。
6. 任一步失败时保留可恢复信息，不消费来源草稿，不写完成状态。

执行清单至少包含：`contract_version`、`run_id`、`phase`、`plan_revision`、`confirmed_hash`、`inputs`、`artifacts`、`status_mutations`、`validation`、`errors`。

### 客户端能力

技能依赖使用语义能力名，不直接把某一客户端的工具名当作通用协议。首批能力包括：

- `spawn_agent`
- `ask_user`
- `web_search`
- `web_fetch`
- `inspect_image`
- `execute_command`
- `move_with_link_update`

共享协议为每项能力定义客户端映射和无能力时的降级行为。具体技能仍可给出平台示例，但不能把示例当作唯一执行路径。

## 阶段设计

### 阶段零：设计基线

产物是本文档。它记录范围、权威顺序、状态模型、阶段边界和验收方式，后续实施计划不得改变这些关键决策；若实施时发现必须改变，应先更新本文档并单独提交。

建议提交信息：`docs: 设计双语技能契约加固`

### 阶段一：统一 Schema、模板与生命周期

修改范围：

- `assets/schema/Frontmatter_Schema.md`
- `assets/templates/{zh,en}/*.md`
- `assets/skills/_shared/lifecycle.{zh,en}.md`
- `assets/skills/_shared/template-loading.{zh,en}.md`
- 直接生成或归档上述类型的技能说明
- 资产与文档一致性测试

核心结果：

- 修正 `retro/review`、`revise_type/review_type`、`translation` 和状态枚举冲突。
- 所有实体模板改用动态 `{{ID}}`。
- Project 模板的 `category` 改为动态字段，不再固定为 `learning`。
- Research 模板加入状态与完整性槽位，并成为 `/research` 唯一报告结构来源。
- 归档只写 `archived`，保留业务终态。
- 修正 `/project` 与 `/research` 主文件和提示词中不一致的占位符。

建议提交信息：`refactor: 统一双语技能数据契约`

### 阶段二：统一执行编排、能力契约与提交语义

修改范围：

- `assets/skills/_shared/dual-agent-orchestrator.{zh,en}.md`
- 新增双语客户端能力协议和执行清单 Schema
- `/project`、`/research`、`/brainstorm` 及其引用提示词
- 相关一致性测试和行为场景测试

核心结果：

- 将 `/project` 已有的 Orchestrator 独立校验模式提升为共享协议。
- 计划文件具备 `pending/active/done/failed/cancelled` 生命周期。
- 用户修改计划后必须产生新修订和新摘要，旧确认不能继续授权执行。
- Agent 交接使用结构化执行清单，不依赖自由文本判断成功。
- 技能只声明语义能力；客户端专有工具名移到映射示例。
- 项目稳定 ID 只保留一个共享生成与校验实现，移除多份提示词算法。

建议提交信息：`feat: 统一双语技能执行编排`

### 阶段三：修正路由、记忆协议与学习链路

修改范围：

- `assets/skills/ask/SKILL.{zh,en}.md`
- `assets/skills/brainstorm/SKILL.{zh,en}.md`
- `assets/skills/today/SKILL.{zh,en}.md`
- `assets/skills/knowledge/SKILL.{zh,en}.md`
- `assets/skills/digest/SKILL.{zh,en}.md`
- `_shared/memory-protocol.{zh,en}.md`
- `_shared/learning-lifecycle.{zh,en}.md`
- 对应模板、引用和测试

核心结果：

- 默认路由图覆盖 `/today`、`/digest`、`/translate` 等全部入口。
- 规则、偏好和历史决策使用 `memory_context`；Vault 原文检索才使用 `memory_query`。
- 新对象出现时允许增量补载作用域，不再用“一次查询后禁止继续查询”阻断准确性检查。
- `/brainstorm` 通过 `/project` 公共交接契约转项目，不直接读取内部提示词。
- 学习链路加入 digest 与 translate，区分独立 Wiki 和项目绑定知识笔记。
- `/today` 只写用户选中的候选，统一优先级，并寻找最近一篇存在的历史日记。
- `/knowledge` 使用 `lifeos.yaml` 的逻辑路径，统一模板标题，并回填项目掌握度。

建议提交信息：`fix: 修正双语技能路由与学习链路`

### 阶段四：重构 PDF 提取与翻译契约

修改范围：

- `assets/skills/read-pdf/SKILL.{zh,en}.md`
- `assets/skills/read-pdf/scripts/read_pdf.py`
- `assets/skills/translate/SKILL.{zh,en}.md`
- 新增提取结果 Schema、翻译模板及对应测试

核心结果：

- 提取结果带 `schema_version`、源文件摘要、提取器版本、页级状态、错误、置信度和覆盖率。
- 每页同时记录 `pdf_page_index` 与 `printed_page_label`，避免物理页序和书本页码混淆。
- 内容按页保存有序块，区分文本、公式、表格、图像和 OCR 结果。
- 仅对缺文本页或复杂区域使用视觉能力；扫描页必须有明确 OCR 结果，不能只提取图表说明。
- 临时图像可清理，输出命名避免秒级碰撞。
- 翻译只在输入完整且产物校验通过后标记 `complete`；不完整输入保留 `draft` 并列出缺口。
- 数学内容先忠实翻译，补充说明放入独立译注区块。

建议提交信息：`feat: 加固双语 PDF 提取与翻译契约`

### 阶段五：补齐幂等、路径安全与归档事务

修改范围：

- `/ask`、`/today`、`/digest`、`/research`、`/translate`、`/revise`、`/archive` 双语技能
- Digest 配置解析和归档辅助脚本
- 路径、重复运行和目录移动测试

核心结果：

- 所有运行产生稳定 `run_id`，明确创建、合并、覆盖、恢复和跳过规则。
- 文件名执行 Unicode NFC 归一化，拒绝路径分隔符、控制字符、`..`、保留名和 Vault 越界路径。
- `/today` 使用托管区块或稳定任务 ID，重复运行不会复制任务。
- `/digest` 对未知模块和无效配置失败关闭，保存来源健康、抓取时间和错误。
- `/research` 和 `/translate` 支持失败后续跑，不会提前消费草稿或覆盖已确认产物。
- `/revise` 优先恢复同一条 pending 记录，避免无意义的 `_2` 文件。
- `/archive` 先预演冲突，再移动目录，逐文件通知索引；失败时保留操作日志和恢复信息。

建议提交信息：`fix: 补齐双语技能幂等与归档安全`

### 阶段六：建立技能契约检查器与场景测试

修改范围：

- 新增技能契约检查模块或测试工具
- `tests/cli/utils/assets.test.ts`
- `tests/documentation-consistency.test.ts`
- 新增跨资产契约与行为场景测试

核心结果：

- 检查中英文依赖、引用和模板成对存在。
- 检查占位符在调用方与被调用提示词中精确匹配。
- 检查每个生成类型都有 Schema、模板和合法状态迁移。
- 检查模板 ID 为动态值，逻辑路径未被默认物理目录写死。
- 检查变更流程包含预检、校验、通知、冲突处理和恢复语义。
- 检查技能只依赖已声明的语义能力。
- 场景覆盖重复运行、部分失败、取消与恢复、上下文压缩、多客户端、提示注入、Schema 演进、并发运行和目录移动。

建议提交信息：`test: 建立双语技能契约验证`

## 测试策略

每个阶段都执行独立的 RED-GREEN-REFACTOR：

1. 先添加能暴露该阶段契约缺口的失败测试或行为场景。
2. 运行测试并确认失败原因是目标行为尚未实现。
3. 只修改该阶段列出的资产与实现。
4. 运行阶段测试、资产测试和文档一致性测试。
5. 检查双语差异、占位符、Schema 和生命周期。
6. 检查 `git diff` 与暂存区，只提交本阶段文件。

技能提示词的关键行为除静态检查外，还要用无该改动和有该改动的场景对比验证。机械约束由自动化测试负责，判断型约束由压力场景负责。

最终全量验证至少包含：

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

## 提交与工作区规则

- 阶段零至阶段六各自形成一个提交；阶段失败时不创建提交。
- 每次提交前都运行该阶段验证，并读取完整退出状态。
- 暂存时使用明确文件列表，禁止 `git add .`。
- 用户已有的 `package.json` 格式化改动始终保留在工作区且不暂存。
- 若某阶段确实需要修改 `package.json`，只暂存该阶段新增的精确补丁，仍不带入既有格式化差异。
- 本轮不执行发布脚本；未来发布时再按仓库规则创建独立 release 提交。

## 完成标准

- 六个实施阶段均有独立提交，且提交中同时包含中文和英文修改。
- Schema、模板、共享协议和具体技能不存在已知的字段、状态、占位符或生命周期冲突。
- 所有自动化测试、类型检查、Lint 和构建通过。
- 工作区仅保留任务开始前已有的用户改动。
- 最终汇报列出每个阶段的提交哈希、验证命令和仍未覆盖的风险；如有任何阶段未完成，必须明确说明，不能以部分验证代替整体完成。
