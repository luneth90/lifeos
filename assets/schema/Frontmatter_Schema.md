---
title: Frontmatter Schema
type: system
created: 2026-02-21
tags:
  - system
  - schema
aliases:
  - Schema
id: Frontmatter_Schema
---

# LifeOS Frontmatter Schema（统一规范）

目标：让模板、Dataview、Agent 生成内容保持一致，减少字段漂移。

## 通用字段（建议所有笔记都尽量包含）

- `title`: 字符串。建议与文件名一致或可读标题
- `type`: 笔记类型（见下方枚举）
- `created`: 创建日期，格式 `"YYYY-MM-DD"`（统一使用 created，废弃 date）
- `domain`: 领域 wikilink，格式 `"[[DomainName]]"`（如 `"[[Math]]"`）
- `status`: 状态（见下方枚举）
- `tags`: 数组语法 `tags: [tag1, tag2]`（或使用多行列表，但保持一致）
- `aliases`: 数组 `aliases: []`

> 规则：Frontmatter 顶部 `---` 开始，底部 `---` 结束；不得重复 key。

## type 枚举（建议）

- `project`：项目（20\_项目）
- `project-doc`：项目配套文档（需求、设计、实施、测试、重构等）
- `knowledge`：体系化知识笔记（40\_知识/笔记）
- `wiki`：百科概念（40\_知识/百科）
- `draft`：草稿/想法捕获（00\_草稿）
- `note`：日记/笔记（10\_日记）
- `research`：研究报告（30\_研究）
- `review`：回顾/复盘（80\_复盘）
- `content`：平台发布内容（50\_成果）
- `system`：系统/规范/说明（90\_系统）
- `review-record`：复习记录文件（40\_知识/笔记 章节目录下）

## status 枚举（按 type 推荐）

### project

- `active` / `on-hold` / `done`

### project-doc

- `active` / `archived`

### knowledge（笔记）

- `draft` / `review` / `mastered`

### wiki

- 无状态流转

### research

- 无状态流转

### content

- `draft` / `published`

### review

- 无状态流转

### review-record

- 无状态流转（由 `result: pass/fail` 标记批改结果）

### draft

- `pending`（待处理）/ `researched`（已研究）/ `projected`（已项目）/ `knowledged`（已整理知识）

### note

- 无状态流转（日记不需要状态管理）

## 字段说明（补充）

### knowledge / 笔记推荐字段

- `project`: `"[[20_项目/项目名]]"`（可为空占位）
- `source`: `"[[70_资源/Books/资源名]]"` 或其他资源路径
- `author`: 字符串
- `category`: 可选（如 `Math`），但建议逐步用 `domain` 统一承载“领域”含义

### project 推荐字段

- `category`: `learning|development|creative|general`
- `due`: 可空
- `priority`: `P0|P1|P2|P3|P4`
- `difficulty`: 可空（入门/进阶/高级）
- `estimated-hours`: 可空（数值或字符串）
- `current_version`: 可选，开发类项目当前实现版本
- `target_version`: 可选，开发类项目下一目标版本

### project-doc 推荐字段

- `project`: `"[[20_项目/项目名/项目名]]"`（关联的主项目文件）

### content 推荐字段

- `platform`: `公众号` | `小红书`
- `source`: `"[[30_研究/...]]"` 或 `"[[40_知识/...]]"`（源文件链接）

### review-record 推荐字段

- `note`: `"[[40_知识/笔记/Domain/BookName/ChapterDir/ChapterName]]"`（关联的知识笔记）
- `mode`: `quiz | feynman | blindspot`（复习模式）
- `score`: 字符串，如 `"4/5"`
- `result`: `pass | fail`（是否通过，≥80% 为 pass）

### review 推荐字段

- `review_type`: `weekly|monthly|quarterly|yearly|project|calibration`
- `period`: 字符串，用于记录回顾覆盖范围（如 `2026-W10`、`2026-03`）
- `project`: `"[[20_项目/项目名]]"`（项目复盘或路径校准时填写）
- `source`: 可选，可链接相关的 `60_计划`、`10_日记` 或 `50_成果`

## 迁移建议（最小改动优先）

1. 所有模板和技能中的 `date` 字段统一改为 `created`
2. `status` 使用纯文本枚举值（例如 `review`），emoji 放到正文或用样式渲染
