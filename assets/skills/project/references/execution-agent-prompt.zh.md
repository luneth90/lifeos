---
name: execution-agent-prompt
description: Project 技能的执行 Agent 提示词
role: execution
parent_skill: project
---
# 项目执行 Agent 指令

> 路径逻辑名（如 `{项目目录}`、`{草稿目录}`）由 Orchestrator 从 `lifeos.yaml` 解析后注入上下文。映射关系见主技能文件 `project/SKILL.md` 的配置块。

> 此文件由 `project/SKILL.md` 的 Orchestrator 通过 `spawn_agent` 语义能力在确认校验后执行。
> 使用时将 `{{PROJECT_INPUT}}` 替换为已确认的项目输入，并从中读取实际计划文件路径。

---

执行以下项目输入对应的已确认计划：{{PROJECT_INPUT}}

## 步骤一：读取计划文件

仔细读取计划文件，记录：

- 项目类别（learning / development / creative / general）
- 知识领域（Domain）
- `project_id`（项目稳定 ID）
- 最终主项目路径（包含一个 `.md` 后缀的 Vault 相对路径）
- 来源草稿字段（返回给 Orchestrator，验收后由其更新状态）

## 步骤二：获取模板（关键）

**在生成任何内容之前**，读取 `{系统目录}/{模板子目录}/Project_Template.md`。

禁止猜测结构。记住：

- 精确的 Obsidian Callouts 格式（如 `> [!info]`, `> [!note]`）
- frontmatter 字段结构

## 步骤三：创建项目笔记

路径规则：直接使用计划中已确认的最终主项目 Vault 相对路径；不得重复拼接 `{项目目录}/` 或 `.md` 后缀。

### 稳定 ID 落盘（强制）

1. 先固定最终主项目 Vault 相对路径。扫描 `{项目目录}/` 下所有现有 `type: project` 主项目，
   收集其路径和 `id`；发现 ID 缺失、不是无首尾空格的 YAML 字符串、使用占位值、非法或
   重复时停止并报告，不得在损坏的 ID 清单上继续分配。
2. 更新已有项目时，沿用该主项目已有且匹配 `^[a-z0-9][a-z0-9._-]*$` 的可移植 ID，
   不得因改名、移动或版本变化重新生成。
3. 新项目的计划 `project_id` 必须匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`，不得包含
   双花括号占位符、`placeholder`，也不得等于 `Project_Template` 或 `project-template`。
4. 若确认期间出现 ID 冲突或路径变化，调用 `_shared/scripts/project_identity.mjs` 并校验结果。结果变化时
   不得回写后继续执行：返回变更，由 Orchestrator 增加 `plan_revision`、更新 `confirmed_hash` 并重新确认。
5. 从模板生成文件时，必须替换所有必填占位符；其中 ID 必须写为带引号的最终 `project_id`，
   分类必须写为计划中的项目类别。禁止省略 ID、保留模板占位符或把 ID 写成非字符串。

### 开发类项目目录规范（强制）

若项目类别为 `development`，执行时必须遵守以下规则：

1. 主项目文件只能有一个，并且必须等于计划中的最终主项目路径
2. 若需要配套文档，统一放在该主项目所在目录的 `文档/`
3. 配套文档必须使用 `type: project-doc`
4. 配套文档必须写入指向最终主项目路径的 `project` wikilink
5. 禁止创建 `ProjectNameV0.2.md`、`ProjectNameV0.3.md` 之类的版本化主项目文件
6. 若计划中包含版本路线，版本信息写在主项目字段或正文中，不写入文件名

**Frontmatter 规范：**

```yaml
---
title: "ProjectName"
type: project
category: "[计划中的项目类别]"
status: active
domain: "[[DomainName]]"
created: "YYYY-MM-DD"
tags: [project]
aliases: []
id: "[计划中的最终 project_id]"
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

<!-- 掌握度小圆点映射：⚪未学（笔记不存在） 🔴整理中(draft) 🟠待复习(review) 🟡已复习待巩固(revised) 🟢已掌握(mastered) -->
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

## 步骤四：创建后自检（返回前强制）

写入后立即回读主项目并重新扫描全部 `type: project`，确认：

- 顶层 frontmatter 中 `type` 与 `id` 各且仅有一个，且 `id` 被 YAML 解析为无首尾空格的字符串
- `type: project`，`id` 与计划中最终 `project_id` 完全一致
- 新项目 ID 符合严格 kebab-case；更新项目 ID 符合可移植格式
- frontmatter 的 `id` 不包含 ID 模板占位符、`Project_Template`、`placeholder` 或其他占位值
- 没有另一个主项目使用相同 ID

检查失败时立即修复并重复回读，禁止仅凭写入操作成功就报告完成。

## 步骤五：返回 Orchestrator 验收

- 返回主项目路径、最终 ID、来源草稿路径、计划路径和上述自检结果
- 不得修改来源草稿状态、计划状态或 project scope 记忆
- 返回符合 `Execution_Manifest_Schema.json` 的 manifest：包含 `contract_version`、`run_id`、`phase`、
  `plan_revision`、`confirmed_hash`、`inputs`、`artifacts`、`status_mutations`、`validation`、`errors`
- Orchestrator 独立验收并确认项目 scope 可解析后，才负责更新状态和最终交付

---

## 完成报告

完成后用中文汇报：

```
## 项目文件已创建——等待验收

**项目:** [[ProjectName]] 已创建
**项目稳定 ID:** `[project_id]`
**知识领域:** [Domain]
**已链接的 Vault 资源:** [列出实际链接到的笔记和资源]
**ID 自检:** 已回读，格式合法且全局唯一
**来源草稿:** [{草稿目录}/文件名.md，或"无来源草稿"]（状态保持不变，等待 Orchestrator 验收）
**计划:** [实际计划文件路径]（保持 `status: pending`，等待 Orchestrator 验收）

若为开发类项目，再补充：

**主项目路径:** [最终主项目路径]
**配套文档目录:** [主项目所在目录]/文档/
```
