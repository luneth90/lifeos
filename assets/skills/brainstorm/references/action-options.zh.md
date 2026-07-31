## 选项1：创建项目

调用 `/project` 公共规划入口，将结构化输入作为项目种子：

1. 传入 `{ seed: <Phase 2 总结全文>, source: "头脑风暴会话（YYYY-MM-DD）", origin: "brainstorm" }`
2. `/project` 自行解析 `spawn_agent` 能力并只完成规划阶段
3. 接收计划文件路径、`plan_revision` 与 `confirmed_hash`；不读取 Project 内部提示词

Orchestrator 收到计划文件路径后，告知用户：

```
已基于头脑风暴创建项目规划：`[plan file path]`

**项目类别:** [learning/development/creative/general]
**知识领域:** [Domain]
**缺失资源:** [如有]

请查看计划；确认摘要绑定当前 revision 和 hash，确认后我将调用 /project 公共执行入口。
```

## 选项2：整理知识

1. **确定结构**：
   - 从 Phase 2 的"知识领域"字段取 Domain
   - 识别适合提取为百科的概念

2. **创建笔记**：
   - 百科概念笔记路径：`{知识目录}/{百科子目录}/<Domain>/<ConceptName>.md`
   - 使用模板：`{系统目录}/{模板子目录}/Wiki_Template.md`
   - 每篇百科只记一个概念

3. **模板实例化**：先读取 `{系统目录}/{模板子目录}/Wiki_Template.md`，替换 `TITLE`、`DATE`、
   `DOMAIN`、`ID` 等全部必填占位符，再追加 `source: brainstorming-session`；不得手写 inline Frontmatter。

4. **链接一切**：
   - 概念间互加 wikilinks
   - 在今日日记中记录所学

5. **用中文汇报**创建的文件路径和摘要

## 选项3：保存草稿

1. 在 `{草稿目录}/` 创建草稿笔记：
   - 路径：`{草稿目录}/Brainstorm_YYYY-MM-DD_<Topic>.md`
   - 使用模板：`{系统目录}/{模板子目录}/Draft_Template.md`
   - 替换 `TITLE`、`DATE`、`DOMAIN`、`ID` 等全部必填占位符

2. 写入内容：
   - Phase 2 头脑风暴总结全文
   - 对话中出现的核心想法（条目式）
   - Frontmatter 中 `status: pending`（确保可被 `/archive` 识别流转）

3. 提示用户后续可用：
   - `/research` → 深化为研究报告（`{研究目录}/`）
   - `/knowledge` → 整理为知识笔记（`{知识目录}/`）
   - `/project` → 转化为项目（`{项目目录}/`）
