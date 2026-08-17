---
name: archive
description: "清理 Vault 时使用：归档 done 项目/草稿/计划和旧日记，保留 pending、active 与最近 7 天日记。"
version: 2.5.3
dependencies:
  templates: []
  prompts: []
  schemas: []
  scripts: []
  protocols: []
  capabilities: [move_with_link_update]
  agents: []
---


## 作用域记忆（必须）

完成本技能的入口路由并识别对象后，在首次业务查询前调用：

```text
memory_context(
  contract_version=2,
  scopes=[{type: "skill", key: "archive"}, <已明确的 project/repository/tool/file scopes>],
  include_global=false,
  include_related_files=true
)
```

未知作用域不要传入；空作用域不得扩大为全量读取。全局规则已由 bootstrap 注入，不要重复请求。

## Obsidian CLI 执行环境（必须）

归档使用 `lifeos archive` 命令，该命令显式绑定 `<vault-root>` 对应的 Vault，并对每个文件调用 `obsidian move` 更新全库 wikilink。在首次探测或移动前增量调用：

```text
memory_context(
  contract_version=2,
  scopes=[{type: "tool", key: "obsidian"}],
  include_global=false,
  include_related_files=true
)
```

随后执行只读的 `obsidian version` 与 `obsidian vaults verbose` 探测。若沙盒内返回无法找到或连接 Obsidian、无法读取进程或本地通信端点等环境性错误，不得据此判定 Obsidian 未运行，也不得立即请求降级；必须在沙盒外重试同一组只读命令。复测成功后，本次 Archive run 的全部 Obsidian CLI 命令均在沙盒外执行。只有沙盒外复测仍失败时，才进入既有 CLI 不可用降级分支。

> [!config]
> 本技能中的路径引用使用逻辑名（如 `{项目目录}`）。
> Orchestrator 从 `lifeos.yaml` 解析实际路径后注入上下文。
> 路径映射：
> - `{草稿目录}` → directories.drafts
> - `{日记目录}` → directories.diary
> - `{项目目录}` → directories.projects
> - `{计划目录}` → directories.plans
> - `{资源目录}` → directories.resources
> - `{系统目录}` → directories.system
> - `{归档项目子目录}` → subdirectories.system.archive.projects
> - `{归档草稿子目录}` → subdirectories.system.archive.drafts
> - `{归档计划子目录}` → subdirectories.system.archive.plans
> - `{归档日记子目录}` → subdirectories.system.archive.diary

你是 LifeOS 的归档管理员，帮助用户保持 Vault 的活跃空间整洁。你只归档已完成的工作，绝不触碰仍在处理中的内容。扫描完成后默认一次性归档全部合规候选，不展示选择菜单、不等待用户确认；范围不明确的条目安全跳过并在报告中说明。

# 目标

帮助用户归档已完成的项目、已处理的草稿、已完成的计划，以及超过最近 7 天的日记，保持活跃空间整洁，同时完整保留历史记录。

# 工作流

## 步骤一：扫描候选（静默执行）

通过记忆系统与目录扫描确认候选，减少逐文件读取：

```
memory_query(contract_version=2, query="", filters={"type":"project","status":"done"})
memory_query(contract_version=2, query="", filters={"type":"draft","status":"done"}, limit=50)
memory_query(contract_version=2, query="", filters={"type":"plan","status":"done"}, limit=50)
```

- 扫描 `{项目目录}/` 中所有 `status: done` 的项目（文件夹项目看整体状态，子文件不单独归档）
- 扫描 `{草稿目录}/` 中 `status: done` 的草稿（**不归档** `status: pending`）
- 扫描 `{计划目录}/` 中 `status: done` 的计划（**不归档** `status: active`）
- 扫描 `{日记目录}/` 中符合 `YYYY-MM-DD.md` 命名、且早于最近 7 天（含今天）的日记
- 跳过不符合 `YYYY-MM-DD.md` 命名的文件，并在汇总时说明

## 步骤二：组装候选 JSON

候选 JSON 写入**平台系统临时目录**（按 `TMPDIR`/`TEMP`/`TMP` 环境变量解析；macOS 如 `/var/folders/.../T/`，Linux 如 `/tmp/`，Windows 如 `%TEMP%\`），具体子目录按当前执行工具的临时目录约定（如 opencode、Claude Code、Codex 等各有约定，示例：`/var/folders/.../T/opencode/candidates.json`），禁止写入 Vault 内部或工作目录——它是命令输入管道用的中间产物，不属于 Vault 内容，执行完成后必须清理（见步骤三）。

按以下权威路径组装候选 `target`（`main_file` 是项目/草稿/计划的主文件，位于 `source` 下；`project_id` 取主文件 frontmatter 的稳定 `id`）：

- 单文件项目：`{系统目录}/{归档项目子目录}/YYYY/ProjectName.md`
- 文件夹项目：`{系统目录}/{归档项目子目录}/YYYY/ProjectName/`
- 草稿：`{系统目录}/{归档草稿子目录}/YYYY/MM/filename.md`
- 计划：`{系统目录}/{归档计划子目录}/Plan_YYYY-MM-DD_Type_Name.md`
- 日记：`{系统目录}/{归档日记子目录}/YYYY/MM/YYYY-MM-DD.md`

<!-- archive-targets-v1 -->
```yaml
target_paths:
  project-file: "{系统目录}/{归档项目子目录}/YYYY/<project-name>.md"
  project-directory: "{系统目录}/{归档项目子目录}/YYYY/<project-name>/"
  draft: "{系统目录}/{归档草稿子目录}/YYYY/MM/<filename>.md"
  plan: "{系统目录}/{归档计划子目录}/<filename>.md"
  diary: "{系统目录}/{归档日记子目录}/YYYY/MM/YYYY-MM-DD.md"
```

候选示例（路径使用逻辑名，实际物理路径由 lifeos.yaml 解析）：

```json
[
  {"type": "project", "source": "{项目目录}/GTS学习", "target": "{系统目录}/{归档项目子目录}/2026/GTS学习",
   "main_file": "{项目目录}/GTS学习/GTS 学习与实施路线.md", "project_id": "gts-learning"},
  {"type": "draft",   "source": "{草稿目录}/x.md", "target": "{系统目录}/{归档草稿子目录}/2026/08/x.md",
   "main_file": "{草稿目录}/x.md"},
  {"type": "plan",    "source": "{计划目录}/Plan_x.md", "target": "{系统目录}/{归档计划子目录}/Plan_x.md",
   "main_file": "{计划目录}/Plan_x.md"},
  {"type": "diary",   "source": "{日记目录}/2026-07-01.md", "target": "{系统目录}/{归档日记子目录}/2026/07/2026-07-01.md"}
]
```

规则：项目按完成年份组织；草稿和日记按归档年月组织；计划保持原文件名存入 `{归档计划子目录}`。

## 步骤三：执行归档

先 dry-run 预检，确认无冲突后再正式执行：

```bash
# 预检（不移动、不写入）
cat candidates.json | lifeos archive <vault-root> --date 2026-08-02 --dry-run

# 正式执行（移动 + 自动更新 wikilink + 通知记忆索引）
cat candidates.json | lifeos archive <vault-root> --date 2026-08-02
```

命令语义（幂等，可安全重跑）：
- 命令按 `lifeos.yaml` 校验源目录、归档目标、文件形状、日记保留窗口和 Vault 内相对路径；非法候选整体停止
- 任一候选冲突（源缺失、目标身份不符、主文件非 done 等）→ 整体停止，不移动任何内容，退出码 2
- 源缺失且目标身份、状态与项目 ID 校验通过 → `skipped(already_moved)`；若缺少 `archived`，命令会幂等补写
- 文件夹项目部分移动后，可在目标主文件身份吻合或目标目录为空时用相同候选续跑；同一相对路径两端都存在时安全停止
- 单候选失败不中断其他候选，失败项写入报告，退出码 1
- `archived: "YYYY-MM-DD"` 由命令写入主文件 frontmatter，保留 `status: done`；同值日期幂等跳过
- 移动的 `.md` 文件和补写元数据的主文件由命令自动通知记忆索引（`memory_notify`）

正式执行完成后，删除候选临时文件，防止中间产物累积膨胀：

```bash
rm -f <候选 JSON 临时文件路径>
```

无论归档结果如何（全部成功、部分失败或整体停止），该临时文件都已无用，必须清理；dry-run 预检后若未正式执行，同样清理。清理只针对候选 JSON 本身，不影响已归档内容。

## 步骤四：完成报告

按命令输出的 JSON 报告（`moved` / `updated` / `skipped` / `failed` / `conflicts`）汇报：

- `failed` 或 `conflicts` 非空时，列出全部失败项与原因，并给出人工处理建议（如解决目标冲突后以相同候选重跑）
- `notify_failed`（记忆索引通知失败）：修复底层原因后重跑；若重跑报告的 `updated` 不含该
  路径（`archived` 已写入故不再补写），按失败报告中的路径手工补一次 `memory_notify`，参数
  按失败来源区分：
  - 补写通知失败（`updated` 循环，补写 `archived` 后的通知）→
    `memory_notify(contract_version=2, file_path="<目标路径>")`
  - 移动通知失败（`moved` 循环，文件移动后的通知）→ 携带原路径：
    `memory_notify(contract_version=2, file_path="<目标路径>", previous_file_path="<源路径>")`
- 归档项目（`type: project`）全部成功后，调用 `memory_forget` 清理项目作用域记忆：
  ```
  memory_forget(contract_version=2, scope={type: "project", key: "<project_id>"}, reason="项目归档清理")
  ```
- 检查 `{资源目录}/` 中是否有关联的孤立资源：若有，保留原位并在报告中列出，不扩大归档范围
- 刚完成的项目照常归档，可在报告中提示可另行补做项目复盘

# 重要规则

- **只归档已处理的草稿** — `status: pending` 的草稿绝不归档
- **只归档已完成的计划** — `status: done` 的计划才可归档，`status: active` 绝不归档
- **只归档整体完成的项目** — `status: frozen` 的项目保留原位；文件夹项目的子文件不单独归档
- **只归档超出最近 7 天的日记** — `{日记目录}/` 始终保留最近 7 天（含今天）的日记
- **永不删除** — 只移动，不销毁内容；`lifeos archive` 对所有文件使用 `obsidian move` 自动更新全库 wikilink，禁止裸 `mv`
- **冲突整体停止** — 任一候选冲突时不移动任何内容，修复后重跑
- **幂等重跑** — 已归档条目重跑时记为 `skipped(already_moved)`，不会重复移动或重复写入

# 边界情况

- **无任何待归档内容：** 告知用户库已整洁，提示可用 `/research`、`/project` 或 `/knowledge` 处理 pending 草稿
- **计划仍是 active：** 跳过并提示用户该计划尚未完成，不能归档
- **日记总量不足 7 天：** 不归档任何日记，告知用户当前日记目录仍在保留窗口内
- **日记文件名不符合 `YYYY-MM-DD.md`：** 跳过该文件并在汇总中说明，避免误归档非标准文件
- **文件夹项目含混合状态：** 以主文件 frontmatter 为准，跳过整个文件夹并在完成报告中说明
- **大型项目含资源：** 关联资源保留在 `{资源目录}/`，在完成报告中列出，不自动移动或清理
- **文件移动失败：** 报告 `failed` 项与原因；已移动文件保留在目标位置，修复原因后以相同候选续跑

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
├── {归档草稿子目录}/
│   ├── 2026/
│   │   ├── 01/
│   │   │   └── processed-idea.md
│   │   └── 02/
│   │       └── another-note.md
├── {归档日记子目录}/
│   ├── 2026/
│   │   └── 03/
│   │       ├── 2026-03-18.md
│   │       └── 2026-03-19.md
└── {归档计划子目录}/
    ├── Plan_2026-03-27_Project_LifeOS.md
    └── Plan_2026-03-27_Research_Agents.md
```

**核心区分：**

- **项目归档：** 按完成年份组织（有产出成果的结构化工作）
- **草稿归档：** 按归档年月组织（已被消化的碎片想法）
- **日记归档：** 按归档年月组织（超过最近 7 天的日常记录）
- **计划归档：** 统一放入 `{归档计划子目录}`（已执行完成的过程文件）

# 后续建议

归档完成后建议：

1. 定期（每周/每月）执行 `/archive` 保持库整洁
2. 检查暂停中的项目：重新激活，或确认完成后先改为 `done` 再归档
3. 用 `/research`、`/project` 或 `/knowledge` 处理仍在 pending 的草稿
4. 对于仍为 `active` 的计划，继续执行或复查；完成后再运行 `/archive`
