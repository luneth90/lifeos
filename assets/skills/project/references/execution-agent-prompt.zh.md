---
name: execution-agent-prompt
description: Project 技能的执行 Agent 提示词
role: execution
parent_skill: project
---
# 项目执行 Agent 指令

> 路径逻辑名（如 `{项目目录}`、`{草稿目录}`）由 Orchestrator 从 `lifeos.yaml` 解析后注入上下文。映射关系见主技能文件 `project/SKILL.md` 的配置块。

> 此文件由 `project/SKILL.md` 的 Orchestrator 在用户确认计划后读取，作为 Task 工具的完整 prompt 使用。
> 使用时将 `[计划文件路径]` 替换为实际计划文件路径。

---

执行以下路径的项目计划：[计划文件路径]

## 步骤一：读取计划文件

仔细读取计划文件，记录：

- 项目类别（learning / development / creative / general）
- 知识领域（Domain）
- 来源草稿字段（用于后续状态更新）

## 步骤二：获取模板（关键）

**在生成任何内容之前**，读取 `{系统目录}/{模板子目录}/Project_Template.md`。

禁止猜测结构。记住：

- 精确的 Obsidian Callouts 格式（如 `> [!info]`, `> [!note]`）
- frontmatter 字段结构

## 步骤三：创建项目笔记

路径规则：

- `development`：必须创建 `{项目目录}/ProjectName/ProjectName.md`
- `learning / creative / general`：可创建 `{项目目录}/ProjectName.md`，或在文件较多时使用 `{项目目录}/ProjectName/ProjectName.md`

### 开发类项目目录规范（强制）

若项目类别为 `development`，执行时必须遵守以下规则：

1. 主项目文件只能有一个：`{项目目录}/ProjectName/ProjectName.md`
2. 若需要配套文档，统一放在 `{项目目录}/ProjectName/文档/`
3. 配套文档必须使用 `type: project-doc`
4. 配套文档必须写 `project: "[[{项目目录}/ProjectName/ProjectName]]"`
5. 禁止创建 `ProjectNameV0.2.md`、`ProjectNameV0.3.md` 之类的版本化主项目文件
6. 若计划中包含版本路线，版本信息写在主项目字段或正文中，不写入文件名

**Frontmatter 规范：**

```yaml
---
type: project
status: active
domain: "[[DomainName]]"
created: "YYYY-MM-DD"
tags: [project]
aliases: []
---
```

若项目类别为 `development` 且计划中有明确版本路线，可增加：

```yaml
current_version: V0.1
target_version: V0.2
```

**C.A.P. 结构（学习类项目使用掌握度表格）：**

```markdown
## 背景

[项目目标与背景]

## 内容规划

### 掌握度总览

| 章节 | 掌握度 | 笔记 | 百科 |
|------|--------|------|------|
| 第1章 [章节名] | ⚪ 未学 | — | — |
| 第2章 [章节名] | ⚪ 未学 | — | — |

<!-- 掌握度小圆点映射：⚪未学 🔴未复习(draft) 🟡待巩固(revise) 🟢已掌握(mastered) -->
<!-- /revise 批改完成后会自动回写此表格 -->

### 📖 第1章: [章节名称]

> **目标:** [学完这个章节后能做什么]

**参考:** [[{资源目录}/Books/<资源名>]] 第1章

**核心内容:** [3-5句话概括]

**产出路径:**
- 📝 体系笔记: [[{知识目录}/{笔记子目录}/<Domain>/<BookName>/<ChapterName>/<ChapterName>]]
- 📝 百科: [[{知识目录}/{百科子目录}/<Domain>/概念名称]]

## 进展

[进展记录区，留空供用户填写]
```

**格式规范：**

- 使用 wikilinks `[[NoteName]]` 连接所有相关笔记和资源
- 按计划文件中的大纲草案填充所有章节/阶段，不截断
- 内容必须为中文
- 开发类项目必须在主项目正文中写明“项目文档”区块，说明配套文档统一存放在 `文档/` 目录

## 步骤四：更新草稿状态（关键）

检查计划文件中的「来源草稿」字段：

- 若列出了草稿文件路径（非"无"）：将该草稿文件的 frontmatter 中 `status` 更新为 `done`
- 这标记该草稿已被处理，使 `/archive` 可识别并归档

## 步骤五：更新计划状态（关键）

- 项目创建完成后，将计划文件的 frontmatter 中 `status` 更新为 `done`
- 保持计划文件仍位于 `{计划目录}/Plan_YYYY-MM-DD_Project_ProjectName.md`
- 后续由 `/archive` 统一将 `status: done` 的计划移动到 `{系统目录}/{归档计划子目录}/`

---

## 完成报告

完成后用中文汇报：

```
## 项目创建完成

**项目:** [[ProjectName]] 已创建
**知识领域:** [Domain]
**已链接的 Vault 资源:** [列出实际链接到的笔记和资源]
**来源草稿状态:** [{草稿目录}/文件名.md → status 已更新为 done，或"无来源草稿"]
**计划状态:** {计划目录}/Plan_YYYY-MM-DD_Project_ProjectName.md → `status: done`（待 `/archive` 归档到 `{系统目录}/{归档计划子目录}/`）

若为开发类项目，再补充：

**主项目路径:** `{项目目录}/ProjectName/ProjectName.md`
**配套文档目录:** `{项目目录}/ProjectName/文档/`
```
