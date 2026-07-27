# Today 与 Research 交互精简设计

## 目标

减少每日规划与研究规划阶段的非必要交互，让用户更快进入执行，同时保留已有的上下文收集、计划生成和计划审核能力。

## Today 技能

- 交互阶段只询问一个问题：“今天做什么？”
- 问题选项由已收集的活跃项目、昨日遗留和其他可执行候选组成，并保留“其他”入口。
- 删除“有什么新想法或任务吗？”和“有什么阻碍或顾虑吗？”两个问题。
- 删除依赖第二个问题的草稿捕获步骤，以及目标、摘要和无响应兜底中与“新想法”有关的描述。
- 保留昨日遗留、活跃项目、待复习内容、事件驱动画像检查和今日日记生成逻辑。

## Research 技能

- Planning Agent 仍生成研究计划文件。
- 计划生成后不再询问用户的知识水平和方法偏好，也不再把这两项答案写回计划。
- 计划文件不再包含“澄清问题回答”区块。
- Execution Agent 不再读取知识水平或方法偏好，也不再根据这两项调整报告。
- Orchestrator 仍向用户展示计划路径并等待计划审核确认；用户确认后才启动 Execution Agent。
- 现有领域无法推断时的领域澄清规则保持不变。

## 修改范围

- `assets/skills/today/SKILL.zh.md`
- `assets/skills/today/SKILL.en.md`
- `assets/skills/research/SKILL.zh.md`
- `assets/skills/research/SKILL.en.md`
- `assets/skills/research/references/planning-agent-prompt.zh.md`
- `assets/skills/research/references/planning-agent-prompt.en.md`
- `assets/skills/research/references/execution-agent-prompt.zh.md`
- `assets/skills/research/references/execution-agent-prompt.en.md`

## 验证

- 不新增交互约束测试。
- 运行现有资产测试、文档一致性测试和构建，确认中英文技能资产仍可解析且项目可以正常编译。

## 非目标

- 不改变 Research 的计划确认门槛。
- 不修改模板、记忆协议或双 Agent 通用编排协议。
- 不修改 Today 的任务排序规则、日记模板或画像写入条件。
