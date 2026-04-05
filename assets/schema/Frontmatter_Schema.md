---
title: Frontmatter Schema
type: system
created: 2026-03-25
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
- `status`: 状态（见下方枚举），不是所有 type 都需要
- `tags`: 数组语法 `tags: [tag1, tag2]`
- `aliases`: 数组 `aliases: []`
- `id`: 字符串，笔记唯一标识符

> 规则：Frontmatter 顶部 `---` 开始，底部 `---` 结束；不得重复 key。

## type 枚举

- `project`：项目
- `project-doc`：项目配套文档（需求、设计、实施、测试、重构等）
- `knowledge`：体系化知识笔记
- `wiki`：百科概念
- `draft`：草稿 / 想法捕获
- `note`：日记 / 笔记
- `research`：研究报告
- `plan`：执行计划文件
- `retro`：复盘
- `system`：系统
- `revise-record`：复习记录文件

## status 枚举（按 type 推荐）

### project

- `active` / `frozen` / `done`

### project-doc

- `active` / `archived`

### knowledge

- `draft` / `revise` / `mastered`（只升不降）

### wiki

- 无状态流转

### research

- `complete`

### plan

- `active` / `done` / `archived`

### revise

- 无状态流转

### revise-record

- 无状态流转（由 `result: pass | fail` 标记批改结果）

### draft

- `pending`（待处理）/ `done`（已处理）/ `archived`（已归档）

### note

- 无状态流转

## 归档字段

任何笔记被 `/archive` 归档后，frontmatter 中会追加：

- `archived`: `"YYYY-MM-DD"`（归档日期）

此字段与 `status` 独立，不改变原有 status 值。

## 字段说明（按 type 补充）

### knowledge 推荐字段

- `project`: wikilink，关联的项目文件（可为空）
- `source`: wikilink，原文资源路径
- `author`: 字符串

### project 推荐字段

- `category`: `learning | development | creative | general`
- `due`: 可空
- `priority`: `P0 | P1 | P2 | P3 | P4`
- `difficulty`: 可空（入门 / 进阶 / 高级）
- `estimated-hours`: 可空（数值或字符串）
- `current_version`: 可选，开发类项目当前实现版本
- `target_version`: 可选，开发类项目下一目标版本

### project-doc 推荐字段

- `project`: wikilink，关联的主项目文件

### plan 推荐字段

- `source`: 字符串，来源技能（如 `project`、`research`）
- `project`: wikilink 或字符串，关联项目（项目计划时可填）
- `topic`: 字符串，研究主题（研究计划时可填）

### draft 推荐字段

- `source`: 字符串，来源技能（如 `ask`、`brainstorm`）


### revise-record 推荐字段

- `note`: wikilink，关联的知识笔记
- `mode`: `quiz | feynman | blindspot`
- `score`: 字符串，如 `"4/5"`
- `result`: `pass | fail`（≥80% 为 pass）

### retro 推荐字段

- `revise_type`: `weekly | monthly | quarterly | yearly | project | calibration`
- `period`: 字符串，覆盖范围（如 `2026-W10`、`2026-03`）
- `project`: wikilink（项目复盘时填写）
- `source`: 可选，关联的计划、日记或成果
