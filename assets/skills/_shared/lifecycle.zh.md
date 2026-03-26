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
draft ──/review(≥50%)──→ review ──/review(≥80%)──→ mastered
```

| 状态 | 含义 | 设置者 |
|------|------|--------|
| `draft` | 由 /knowledge 创建，从未复习 | /knowledge |
| `review` | 由 /review 在评分 50%-80% 时提升 | /review |
| `mastered` | 由 /review 在评分 ≥80% 时提升 | /review |

**规则:**

- 状态只能升级，不能降级：`draft` -> `review` -> `mastered`。
- /review 同时更新对应项目文件中的掌握度圆点（⚪→🔴→🟡→🟢）。

## 项目生命周期 (Project Lifecycle)

```
active ──→ on-hold ──→ done ──/archive──→ archived
```

| 状态 | 含义 | 设置者 |
|------|------|--------|
| `active` | 正在进行中 | /project |
| `on-hold` | 已暂停 | 手动 |
| `done` | 已完成，可归档 | 手动 |
| `archived` | 已被 /archive 移入归档目录 | /archive |

## 技能参与矩阵

| 技能 | 草稿状态转换 | 知识笔记状态转换 | 项目状态转换 |
|------|-------------|-----------------|-------------|
| /brainstorm | 创建 `pending` | - | - |
| /today | 创建 `pending` | - | - |
| /research | `pending` → `researched` | - | - |
| /project | `pending` → `projected` | - | 创建 `active` |
| /knowledge | `pending` → `knowledged` | 创建 `draft` | - |
| /review | - | `draft` → `review` → `mastered` | 更新掌握度圆点 |
| /archive | `researched/projected/knowledged` → `archived` | - | `done` → `archived` |
| /rename | - | - | - |
| /enhance | - | - | - |
