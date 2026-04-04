# LifeOS 共享生命周期状态机

本文档定义了 LifeOS 技能系统中所有笔记类型的状态转换规则。这是唯一的权威来源。

## 草稿生命周期 (Draft Lifecycle)

```
pending ──/research──→ researched ──┐
pending ──/project───→ projected  ──┼──/archive──→ archived
pending ──/knowledge─→ knowledged ──┘
```

| 状态 | 含义 | 设置者 |
|------|------|--------|
| `pending` | 由 /brainstorm 或 /today 创建，尚未处理 | /brainstorm, /today |
| `researched` | 已被 /research 消费，生成研究报告 | /research |
| `projected` | 已被 /project 消费，生成项目文件 | /project |
| `knowledged` | 已被 /knowledge 消费，生成知识笔记 | /knowledge |
| `archived` | 已被 /archive 移入归档目录 | /archive |

**规则:**

- /archive 仅归档状态为 `researched`、`projected` 或 `knowledged` 的草稿。
- /archive 绝不归档 `pending` 状态的草稿。

## 知识笔记生命周期 (Knowledge Note Lifecycle)

```
draft ──/revise(≥50%)──→ revise ──/revise(≥80%)──→ mastered
```

| 状态 | 含义 | 设置者 |
|------|------|--------|
| `draft` | 由 /knowledge 创建，从未复习 | /knowledge |
| `revise` | 由 /revise 在评分 50%-80% 时提升 | /revise |
| `mastered` | 由 /revise 在评分 ≥80% 时提升 | /revise |

**规则:**

- 状态只能升级，不能降级：`draft` -> `revise` -> `mastered`。
- /revise 同时更新对应项目文件中的掌握度圆点（⚪→🔴→🟡→🟢）。

## 项目生命周期 (Project Lifecycle)

```
active ⇄ frozen ──→ done ──/archive──→ archived
```

| 状态 | 含义 | 设置者 |
|------|------|--------|
| `active` | 正在进行中 | /project |
| `frozen` | 短期冻结，保留所有数据，不出现在 TaskBoard 焦点/活跃项目/待复习面板 | 手动 |
| `done` | 已完成，可归档 | 手动 |
| `archived` | 已被 /archive 移入归档目录 | /archive |

**frozen 规则：**

- 用户手动修改 frontmatter `status: frozen` 完成冻结，改回 `status: active` 解冻
- frozen 项目的关联知识笔记（通过 `project` 字段关联）从复习列表中隐藏
- frozen 项目可直接转为 `done`，也可解冻回 `active`

## 计划生命周期

```
active ──/project,/research──→ done ──/archive──→ archived
```

| 状态 | 含义 | 设置者 |
|------|------|--------|
| `active` | 由 /project 或 /research 生成，计划仍位于 `{计划目录}/`，等待执行或复查 | /project, /research |
| `done` | 对应项目或研究已执行完成，等待 /archive 归档 | /project, /research |
| `archived` | 已被 /archive 移入 `{系统目录}/{归档计划子目录}/` | /archive |

**规则:**

- /project 和 /research 创建计划文件时，必须写入 `type: plan` 与 `status: active`
- /project 和 /research 执行完成后，只将计划状态更新为 `done`，不直接移动计划文件
- /archive 仅归档 `status: done` 的计划，并在移动后将其更新为 `archived`

## 技能参与矩阵

| 技能 | 草稿状态转换 | 知识笔记状态转换 | 项目状态转换 | 计划状态转换 |
|------|-------------|-----------------|-------------|-------------|
| /brainstorm | 创建 `pending` | - | - | - |
| /today | 创建 `pending` | - | - | - |
| /research | `pending` → `researched` | - | - | 创建 `active`，执行后更新为 `done` |
| /project | `pending` → `projected` | - | 创建 `active` | 创建 `active`，执行后更新为 `done` |
| /knowledge | `pending` → `knowledged` | 创建 `draft` | - | - |
| /revise | - | `draft` → `revise` → `mastered` | 更新掌握度圆点 | - |
| /archive | `researched/projected/knowledged` → `archived` | - | `done` → `archived` | `done` → `archived` |
