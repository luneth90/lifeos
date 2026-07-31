# LifeOS 共享生命周期状态机

本文档定义了 LifeOS 技能系统中所有笔记类型的状态转换规则。这是唯一的权威来源。

## 草稿生命周期 (Draft Lifecycle)

```
pending ──/research,/project,/knowledge──→ done ──/archive──→ 保留 done
```

| 状态 | 含义 | 设置者 |
|------|------|--------|
| `pending` | 由 /brainstorm 或 /today 创建，尚未处理 | /brainstorm, /today |
| `done` | 已被 /research、/project 或 /knowledge 消费 | /research, /project, /knowledge |

**规则:**

- /archive 仅归档状态为 `done` 的草稿。
- /archive 绝不归档 `pending` 状态的草稿。
- /archive 移动文件后仅追加 `archived: "YYYY-MM-DD"`，保留 `status: done`。

## 知识笔记生命周期 (Knowledge Note Lifecycle)

```
draft ──/knowledge完成校验──→ review ──/revise完整批改──→ revised ──后续明确复核达标──→ mastered
```

| 状态 | 含义 | 设置者 |
|------|------|--------|
| `draft` | 知识整理尚未完成，不进入默认复习队列 | /knowledge |
| `review` | 内容已完成并校验，等待首次复习 | /knowledge |
| `revised` | 已完成至少一轮完整批改，薄弱点另行记录 | /revise |
| `mastered` | 用户明确复核 `revised` 笔记，后续独立一轮 ≥80% 且此前弱点全部通过 | /revise |

**规则:**

- 状态只能升级，不能降级：`draft` → `review` → `revised` → `mastered`。
- /revise 默认只消费 `review`；首次完整批改无论分数都推进为 `revised`，不得直接跳到 `mastered`。
- 只有用户显式要求复核 `revised` 笔记并满足掌握条件时，才推进为 `mastered`。
- /revise 同时更新对应项目文件中的掌握度圆点（⚪→🔴→🟠→🟡→🟢）。

## 项目生命周期 (Project Lifecycle)

```
active ⇄ frozen ──→ done ──/archive──→ 保留 done
```

| 状态 | 含义 | 设置者 |
|------|------|--------|
| `active` | 正在进行中 | /project |
| `frozen` | 短期冻结，保留所有数据，不出现在 TaskBoard 焦点/活跃项目/待复习面板 | 手动 |
| `done` | 已完成，可归档 | 手动 |

**frozen 规则：**

- 用户手动修改 frontmatter `status: frozen` 完成冻结，改回 `status: active` 解冻
- frozen 项目的关联知识笔记（通过 `project` 字段关联）从复习列表中隐藏
- frozen 项目可直接转为 `done`，也可解冻回 `active`
- /archive 归档 `done` 项目时只追加 `archived: "YYYY-MM-DD"`。

## 计划生命周期

```
pending ──确认后──→ active ──执行完成──→ done ──/archive──→ 保留 done
                     └──执行失败──→ failed
                     └──取消──→ cancelled
```

| 状态 | 含义 | 设置者 |
|------|------|--------|
| `pending` | 已生成，等待用户确认 | /project, /research |
| `active` | 用户确认后正在执行或等待复查 | /project, /research |
| `done` | 对应项目或研究已执行完成，等待 /archive 归档 | /project, /research |
| `failed` | 执行失败，保留失败信息供恢复 | /project, /research |
| `cancelled` | 用户取消，不执行 | 用户 |

**规则:**

- /project 和 /research 创建计划文件时，必须写入 `type: plan` 与 `status: pending`
- /project 和 /research 执行完成后，只将计划状态更新为 `done`，不直接移动计划文件
- /archive 仅归档 `status: done` 的计划，并在移动后追加 `archived: "YYYY-MM-DD"`

## 研究生命周期 (Research Lifecycle)

```
draft ──完整性校验通过──→ complete
```

| 状态 | 含义 | 设置者 |
|------|------|--------|
| `draft` | 报告仍在生成或等待完整性校验 | /research |
| `complete` | 已通过报告完整性校验 | /research |

## 翻译生命周期 (Translation Lifecycle)

```
draft ──完整性校验通过──→ complete
```

| 状态 | 含义 | 设置者 |
|------|------|--------|
| `draft` | 请求页范围尚未全部翻译或校验 | /translate |
| `complete` | 全部请求范围、Frontmatter 和文件通知均已校验 | /translate |

**规则：** /translate 只有在完整性校验通过后才能从 `draft` 更新为 `complete`。

## 技能参与矩阵

| 技能 | 草稿状态转换 | 知识笔记状态转换 | 项目状态转换 | 计划状态转换 |
|------|-------------|-----------------|-------------|-------------|
| /brainstorm | 创建 `pending` | - | - | - |
| /today | 创建 `pending` | - | - | - |
| /research | `pending` → `done` | - | - | 创建 `pending`，确认后 `active`，执行后更新为 `done` |
| /project | `pending` → `done` | - | 创建 `active` | 创建 `pending`，确认后 `active`，执行后更新为 `done` |
| /knowledge | `pending` → `done` | 创建时 `draft`，完成校验后 `review` | - | - |
| /revise | - | 默认 `review` → `revised`；明确后续复核达标时 `revised` → `mastered` | 更新掌握度圆点 | - |
| /translate | - | - | - | - |
| /archive | 归档后保留 `done` 并写入日期 | - | 归档后保留 `done` 并写入日期 | 归档后保留 `done` 并写入日期 |
