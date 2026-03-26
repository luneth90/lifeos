---
name: archive
description: LifeOS 归档工作流：扫描并归档已完成的项目（status:done）和已处理的草稿（status:researched/projected/knowledged），保持 Vault 整洁。当用户说"/archive"、"归档"、"清理"、"整理完成的项目"、"清空已处理草稿"、"整理一下库"时触发。不归档 status:pending 的草稿。
version: 1.0.0
dependencies:
  templates: []
  prompts: []
  schemas: []
  agents: []
---

> [!config] 路径配置
> 执行本技能前，先读取 Vault 根目录的 `lifeos.yaml`，获取以下路径映射：
> - `directories.drafts` → 草稿目录
> - `directories.diary` → 日记目录
> - `directories.projects` → 项目目录
> - `directories.resources` → 资源目录
> - `directories.system` → 系统目录
> - `subdirectories.system.archive.projects` → 归档项目子目录
> - `subdirectories.system.archive.drafts` → 归档草稿子目录
>
> 后续所有路径操作使用配置值，不使用硬编码路径。

你是 LifeOS 的归档管理员。

# 目标

帮助用户归档已完成的项目和已处理的草稿，保持活跃空间整洁，同时完整保留历史记录。

# 工作流

## 步骤〇：记忆前置查询（静默执行）

扫描前先通过记忆系统确认文件状态，减少逐文件读取：

```
memory_query(query="", filters={"type":"project","status":"done"})
memory_query(query="", filters={"status":"researched"}, limit=50)
memory_query(query="", filters={"status":"projected"}, limit=50)
memory_query(query="", filters={"status":"knowledged"}, limit=50)
```

将查询结果作为扫描候选列表，步骤一中对候选文件逐个确认。

## 步骤一：识别待归档内容（静默扫描）

1. **扫描已完成项目：**
   - 查找 `{项目目录}/` 中所有 `status: done` 的文件

2. **扫描已处理草稿：**
   - 查找 `{草稿目录}/` 中满足以下任一条件的文件：
     - `status: researched`（已被 `/research` 消化）
     - `status: projected`（已被 `/project` 转化为项目）
     - `status: knowledged`（已被 `/knowledge` 整理为知识笔记）
   - **不归档** `status: pending` 的草稿（尚未处理）

3. **汇总呈现（中文）：**

```
## 待归档内容

**已完成项目 ([N]):**
- [[Project1]] - 完成于 [date]
- [[Project2]] - 完成于 [date]

**已处理草稿 ([N]):**
- [[草稿1]] - 已消化为 [[研究报告]] (researched)
- [[草稿2]] - 已转化为 [[ProjectName]] (projected)
- [[草稿3]] - 已整理为 [[知识笔记]] (knowledged)

**跳过（仍待处理）:**
- [[草稿4]] (pending) - 可用 /research、/project 或 /knowledge 处理

请选择:
1. 全部归档
2. 仅归档项目
3. 仅归档草稿
4. 选择特定条目
5. 取消
```

## 步骤二：执行归档

用户确认后，对每个待归档条目：

1. **读取文件完整内容和元数据**

2. **移动到归档目录：**

   **项目归档：**
   - 单文件项目 → `{系统目录}/{归档项目子目录}/YYYY/ProjectName.md`
   - 文件夹项目 → `{系统目录}/{归档项目子目录}/YYYY/ProjectName/`
   - 按完成年份组织

   **草稿归档：**
   - 移动至 `{系统目录}/{归档草稿子目录}/YYYY/MM/filename.md`
   - 按归档年月组织（保留时序，捕获历史）

3. **更新 frontmatter：**
   - 新增 `archived: "YYYY-MM-DD"`
   - 保留所有其他字段不变

4. **更新今日日记：**
   - 在 `{日记目录}/YYYY-MM-DD.md` 的备注区追加归档记录（若文件存在）

5. **清理检查：**
   - 检查 `{资源目录}/` 中是否有关联的孤立资源
   - 若有，询问用户是否一并清理

## 步骤三：归档完成报告

```
## 归档完成

**已归档 [N] 个项目至 `{系统目录}/{归档项目子目录}/YYYY/`:**
- [[Project1]] → 归档/项目/2026/Project1/
- [[Project2]] → 归档/项目/2026/Project2.md

**已归档 [N] 个草稿至 `{系统目录}/{归档草稿子目录}/YYYY/MM/`:**
- 草稿1.md → 归档/草稿/2026/02/ (researched)
- 草稿2.md → 归档/草稿/2026/02/ (projected)
- 草稿3.md → 归档/草稿/2026/02/ (knowledged)

**库状态:**
- 进行中项目: [N]
- 待处理草稿 (pending): [N]
- 已归档项目（总计）: [N]
- 已归档草稿（总计）: [N]

**建议:**
- [ ] 检查暂停中的项目是否需要归档
- [ ] 用 /research、/project 或 /knowledge 处理剩余 pending 草稿
```

# 重要规则

- **只归档已处理的草稿** — `status: pending` 的草稿绝不归档
- **永不删除** — 只移动，不销毁内容
- **按年月组织** — 项目按完成年，草稿按归档年月
- **归档前确认** — 让用户审核列表后再执行
- **更新 frontmatter** — 写入 `archived` 日期
- **记录到日记** — 在今日日记追加归档动作

# 边界情况

- **无任何待归档内容：** 告知用户库已整洁，提示可用 `/research`、`/project` 或 `/knowledge` 处理 pending 草稿
- **文件夹项目含混合状态：** 询问用户是归档整个文件夹还是仅特定文件
- **大型项目含资源：** 确认是否一并归档 `{资源目录}/` 中的关联资源
- **刚完成的项目：** 提醒用户可先做项目复盘，再归档
- **文件移动失败：** 停止当前条目归档，告知用户具体失败文件，继续处理其余条目，最后汇报失败列表

# 归档结构

```
{系统目录}/
├── {归档项目子目录}/
│   ├── 2026/
│   │   ├── ProjectName/
│   │   │   ├── ProjectName.md
│   │   │   └── assets/
│   │   └── SimpleProject.md
│   └── 2025/
│       └── OldProject.md
└── {归档草稿子目录}/
    ├── 2026/
    │   ├── 01/
    │   │   └── processed-idea.md
    │   └── 02/
    │       └── another-note.md
    └── 2025/
        └── 12/
            └── old-capture.md
```

**核心区分：**

- **项目归档：** 按完成年份组织（有产出成果的结构化工作）
- **草稿归档：** 按归档年月组织（已被消化的碎片想法）

# 附加功能

**批量操作：**

- 支持一次归档多个条目
- 自动按年月分组

**项目复盘（可选）：**

- 归档前可选择创建复盘记录：
  - 哪些进展顺利？
  - 哪些可以改进？
  - 核心收获
  - 追加到项目的进展区块

**统计追踪：**

- 统计已完成项目数量
- 可生成年度总结

# 记忆系统集成

> 所有记忆操作通过 MCP 工具调用，`db_path` 和 `vault_root` 由运行时自动注入，技能中无需指定。

### 前置查询（步骤零）

```
memory_query(query="", filters={"type":"project","status":"done"})
memory_query(query="", filters={"status":"researched"}, limit=50)
memory_query(query="", filters={"status":"projected"}, limit=50)
memory_query(query="", filters={"status":"knowledged"}, limit=50)
```

### 文件变更通知

每次移动文件到归档目录后，立即调用：

```
memory_notify(file_path="<归档后文件的相对路径>")
```

若原路径文件已删除，也通知原路径以更新索引：

```
memory_notify(file_path="<原文件相对路径>")
```

### 技能完成

```
memory_skill_complete(
  skill_name="archive",
  summary="归档 N 个项目、M 个草稿",
  related_files=["<归档文件相对路径列表>"],
  scope="archive",
  refresh_targets=["TaskBoard"]
)
```

### 会话收尾（本技能为会话最后一个操作时）

1. `memory_log(entry_type="session_bridge", summary="<本次会话摘要>", scope="archive")`
2. `memory_checkpoint()`

# 后续建议

归档完成后建议：

1. 定期（每周/每月）执行 `/archive` 保持库整洁
2. 检查暂停中的项目，考虑重新激活或归档
3. 用 `/research`、`/project` 或 `/knowledge` 处理仍在 pending 的草稿
