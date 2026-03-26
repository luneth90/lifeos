# 双 Agent 编排协议

本协议定义了 LifeOS 中使用"规划 Agent + 执行 Agent"双阶段工作流的标准编排模式。

## 阶段0：记忆前置检查（必须）

启动 Planning Agent 前，通过 MCP 工具查询最小记忆上下文：

1. 查是否已有同主题产出（避免重复）
2. 查是否命中相关草稿及其 status
3. 查最近相关决策（避免与既有方向冲突）

标准查询模式：
```
memory_query(query="<主题关键词>", filters={"type": "<实体类型>"}, limit=5)
memory_query(query="<主题关键词>", limit=10)
memory_recent(entry_type="decision", query="<主题关键词>", limit=5)
```

若命中 {草稿目录}/ 文件，继续读取其 frontmatter 确认是否仍为 status: pending。

## 阶段1：启动 Planning Agent

1. 读取 `references/planning-agent-prompt.md` 的完整内容
2. 将用户输入替换到 prompt 中的占位符
3. 用 Task 工具启动 Planning Agent
4. Planning Agent 创建计划文件并返回路径

## 阶段2：用户审核

1. 用中文通知用户计划文件路径
2. [技能特有：可在此插入澄清问题]
3. 等待用户确认

## 阶段3：启动 Execution Agent（用户确认后）

1. 读取 `references/execution-agent-prompt.md` 的完整内容
2. 将计划文件路径替换到 prompt 中的占位符
3. 用 Task 工具启动 Execution Agent（干净上下文，仅读取计划文件）
4. 汇报执行结果
