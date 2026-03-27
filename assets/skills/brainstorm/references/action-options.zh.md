## 选项1：创建项目

调用 `/project` 的规划阶段，将头脑风暴摘要作为项目种子：

1. 读取 `project/references/planning-agent-prompt.md` 的完整内容作为 Task prompt
2. 将 Phase 2 总结全文注入到 prompt 中 `[用户输入的想法或草稿]` 占位符处
3. 在计划文件的「来源草稿」字段填写"头脑风暴会话（YYYY-MM-DD）"
4. Planning Agent 只完成规划阶段，返回计划文件路径

Orchestrator 收到计划文件路径后，告知用户：

```
已基于头脑风暴创建项目规划：`[plan file path]`

**项目类别:** [learning/development/creative/general]
**知识领域:** [Domain]
**缺失资源:** [如有]

请查看计划，确认后我将正式创建项目（调用 /project 执行阶段）。
```

## 选项2：整理知识

1. **确定结构**：
   - 从 Phase 2 的"知识领域"字段取 Domain
   - 识别适合提取为百科的概念

2. **创建笔记**：
   - 百科概念笔记路径：`{知识目录}/{百科子目录}/<Domain>/<ConceptName>.md`
   - 使用模板：`{系统目录}/{模板子目录}/Wiki_Template.md`
   - 每篇百科只记一个概念

3. **Frontmatter**：

```yaml
---
type: wiki
created: "YYYY-MM-DD"
domain: "[[Domain]]"
tags: [brainstorm]
source: brainstorming-session
---
```

4. **链接一切**：
   - 概念间互加 wikilinks
   - 在今日日记中记录所学

5. **用中文汇报**创建的文件路径和摘要

## 选项3：保存草稿

1. 在 `{草稿目录}/` 创建草稿笔记：
   - 路径：`{草稿目录}/Brainstorm_YYYY-MM-DD_<Topic>.md`
   - 使用模板：`{系统目录}/{模板子目录}/Draft_Template.md`

2. 写入内容：
   - Phase 2 头脑风暴总结全文
   - 对话中出现的核心想法（条目式）
   - Frontmatter 中 `status: pending`（确保可被 `/archive` 识别流转）

3. 提示用户后续可用：
   - `/research` → 深化为研究报告（`{研究目录}/`）
   - `/knowledge` → 整理为知识笔记（`{知识目录}/`）
   - `/project` → 转化为项目（`{项目目录}/`）
