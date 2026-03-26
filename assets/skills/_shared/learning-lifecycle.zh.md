# LifeOS 学习生命周期

本文档描述 LifeOS 技能系统的整体工作流和技能间关系。

## 核心流程

```
today (每日入口)
  ├→ project (将想法结构化为项目)
  ├→ research (深度研究主题，产出研究报告)
  ├→ knowledge (从原文蒸馏知识笔记)
  ├→ review (间隔复习 + 批改评分)
  └→ archive (归档已完成项目和已处理草稿)
```

## 辅助流

```
brainstorm → project | knowledge | draft（探索性对话，产出可选）
ask → read-pdf | knowledge | brainstorm | research（快速问答，按需升级）
read-pdf → JSON 中间输出（供 knowledge/ask/review 消费的 PDF 提取器）
```

## 典型学习路径

1. `/today` — 晨间规划，识别活跃项目和待复习笔记
2. `/project` — 创建学习项目，规划章节结构
3. `/knowledge` — 逐章蒸馏知识笔记和百科概念
4. `/review` — 生成复习题目，完成后批改评分
5. `/archive` — 归档已完成项目和已处理草稿

## 技能调用矩阵

| 源技能 | 可调用/建议的目标 | 调用方式 |
|--------|------------------|----------|
| /today | /review, /research, /project, /brainstorm, /archive | 文本建议 |
| /brainstorm | /project | 读取 project planning-agent-prompt 启动 sub-agent |
| /brainstorm | /knowledge | 直接创建百科笔记 |
| /brainstorm | 草稿 | 直接创建草稿文件 |
| /ask | /read-pdf | 直接调用 |
| /ask | /knowledge, /brainstorm, /research | 结尾钩子建议 |
| /knowledge | /project (前置依赖) | 若无项目文件则停止并提示 |
| /review | /brainstorm, /ask | 建议（针对薄弱概念） |
| /research | 草稿 (输入) | 读取草稿作为研究来源 |
| /project | 草稿 (输入) | 读取草稿作为项目种子 |

## 共享协议引用

- 状态机定义：`_shared/lifecycle.md`
- 记忆集成协议：`_shared/memory-protocol.md`
- 双 Agent 编排：`_shared/dual-agent-orchestrator.md`
- 模板加载规则：`_shared/template-loading.md`
- 完成报告格式：`_shared/completion-report.md`
