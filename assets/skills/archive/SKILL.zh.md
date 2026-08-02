---
name: archive
description: '清理 Vault 时使用：归档 done 项目/草稿/计划和旧日记，保留 pending、active 与最近 7 天日记。'
version: 2.2.2
dependencies:
  templates: []
  prompts: []
  schemas: []
  scripts:
    - path: scripts/archive_transaction.mjs
    - path: scripts/archive_metadata_transaction.mjs
  protocols:
    - path: ../_shared/operation-safety.md
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

归档确定使用 Obsidian CLI 后，在首次探测或移动前增量调用：

```text
memory_context(
  contract_version=2,
  scopes=[{type: "tool", key: "obsidian"}],
  include_global=false,
  include_related_files=true
)
```

随后执行只读的 `obsidian version` 与 `obsidian vaults verbose` 探测。若沙盒内返回无法找到或连接 Obsidian、无法读取进程或本地通信端点等环境性错误，不得据此判定 Obsidian 未运行，也不得立即请求降级；必须在沙盒外重试同一组只读命令。复测成功后，本次 Archive run 的全部 Obsidian CLI 命令均在沙盒外执行。只有沙盒外复测仍失败时，才进入本技能既有的 CLI 不可用降级分支。

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

## 步骤〇：记忆前置查询（静默执行）

扫描前先通过记忆系统确认文件状态，减少逐文件读取：

```
memory_query(contract_version=2, query="", filters={"type":"project","status":"done"})
memory_query(contract_version=2, query="", filters={"type":"draft","status":"done"}, limit=50)
memory_query(contract_version=2, query="", filters={"type":"plan","status":"done"}, limit=50)
```

将查询结果作为扫描候选列表，步骤一中对候选文件逐个确认。

日记归档不依赖 `status`。步骤一直接根据 `{日记目录}/YYYY-MM-DD.md` 的文件名日期判断是否超出最近 7 天。

## 步骤一：识别待归档内容（静默扫描）

1. **扫描已完成项目：**
   - 查找 `{项目目录}/` 中所有 `status: done` 的文件

2. **扫描已处理草稿：**
   - 查找 `{草稿目录}/` 中 `status: done` 的文件（已被 `/research`、`/project` 或 `/knowledge` 处理）
   - **不归档** `status: pending` 的草稿（尚未处理）

3. **扫描已完成计划：**
   - 查找 `{计划目录}/` 中所有 `status: done` 的计划文件
   - **不归档** `status: active` 的计划（仍在执行或待复查）

4. **扫描待归档日记：**
   - 查找 `{日记目录}/` 中所有符合 `YYYY-MM-DD.md` 命名的日记文件
   - 保留最近 7 天（含今天）的日记在 `{日记目录}/`
   - 将更早的日记加入待归档列表，目标目录为 `{系统目录}/{归档日记子目录}/YYYY/MM/`
   - **不归档** 最近 7 天的日记
   - **跳过** 不符合 `YYYY-MM-DD.md` 的文件，并在汇总时说明

5. **生成执行清单（不阻塞执行）：**

```
## 待归档内容

**已完成项目 ([N]):**
- [[Project1]] - 完成于 [date]
- [[Project2]] - 完成于 [date]

**已处理草稿 ([N]):**
- [[草稿1]] - 已处理 (done)
- [[草稿2]] - 已处理 (done)

**已完成计划 ([N]):**
- [[Plan_2026-03-27_Project_LifeOS]] - status: done，待归档到 `{归档计划子目录}`
- [[Plan_2026-03-27_Research_Agents]] - status: done，待归档到 `{归档计划子目录}`

**待归档日记 ([N]):**
- [[2026-03-18]] - 超出最近 7 天，待归档到 `{归档日记子目录}/2026/03/`
- [[2026-03-19]] - 超出最近 7 天，待归档到 `{归档日记子目录}/2026/03/`

**保留在 `{日记目录}`（最近 7 天）:**
- [[2026-03-21]]
- [[2026-03-22]]
- [[2026-03-23]]
- [[2026-03-24]]
- [[2026-03-25]]
- [[2026-03-26]]
- [[2026-03-27]]

**跳过（仍待处理 / 不归档）:**
- [[草稿4]] (pending) - 可用 /research、/project 或 /knowledge 处理
- [[Plan_2026-03-28_Project_X]] (active) - 计划仍在执行或待复查
- [[Scratch.md]] - 文件名不符合日记命名规则

**执行方式：**
- 默认归档上述全部合规候选
- 不要求用户选择、确认或回复
```

扫描完成后，直接将清单中的所有合规候选作为执行范围并进入步骤二。清单可作为进度更新展示，但不得暂停流程等待用户答复。

## 步骤二：执行归档

扫描完成后，默认对执行清单中的全部合规待归档条目：

1. **先确定源路径与目标路径**
   - 根据归档规则计算全部目标路径，把候选冻结为显式的 `source_path → target_path`、`entity_type` 与项目 `project_id`
   - 在任何移动前，对所有候选完成 collision 预检，并冻结每个文件夹内的完整逐文件 inventory；不得边移动边发现后续冲突
   - **不要**为了归档先把整篇文档内容读入上下文；发布事务适配器只处理移动、索引确认和 Scope 清理，不改写文件正文

2. **使用 Obsidian CLI 移动文件（自动更新 wikilink）：**
   - **优先使用 `obsidian move`** — 内部调用 `app.fileManager.renameFile()`，自动更新全库 wikilink 引用
   - 前提：按“Obsidian CLI 执行环境”完成只读探测并固定本次 run 的执行环境
   - 命令格式：
     ```
     # 单文件
     obsidian move path="源路径/文件.md" to="目标目录/"
     # 文件夹项目（整体移动）
     obsidian move path="源路径/项目文件夹" to="目标目录/2026/"
     ```
   - 调用共享 `createVaultDirectoryGuard` 冻结目标父目录逐级状态，再调用 `ensureVaultDirectory` 安全创建缺失目录。每一级都必须执行 guard → 紧邻复核 → 单级创建 → `missing → existing` 推进 → 再复核；禁止递归创建直接跨过 guard
   - 为源和目标分别建立路径 guard：移动前源必须为 `existing`、目标必须为 `missing`，并在实际移动紧邻之前复核两者。移动后立即以 `advanceVaultPathGuard` 将源从 `existing` 推进为 `missing`、目标从 `missing` 推进为 `existing`，后续只使用返回的新 guard；任一状态、身份、符号链接或 Vault 边界校验失败时中止，并写入 manifest 与恢复动作
   - **降级：** 若 `obsidian` CLI 不可用，先停止并呈现链接更新不可用的影响；只有用户明确接受降级后，才可使用受记录的移动方案。不得静默回退到裸 `mv`。
   - **严禁**通过"写入新文件，再删除原文件"的方式模拟移动
   - 文件夹项目必须整体移动目录，不要逐文件复制重建

   **项目归档：**
   - 单文件项目 → `{系统目录}/{归档项目子目录}/YYYY/ProjectName.md`
   - 文件夹项目 → `{系统目录}/{归档项目子目录}/YYYY/ProjectName/`
   - 按完成年份组织

   **草稿归档：**
   - 移动至 `{系统目录}/{归档草稿子目录}/YYYY/MM/filename.md`
   - 按归档年月组织（保留时序，捕获历史）

   **计划归档：**
   - 移动至 `{系统目录}/{归档计划子目录}/Plan_YYYY-MM-DD_Type_Name.md`
   - 保持原文件名不变，统一存入计划归档目录

   **日记归档：**
   - 移动至 `{系统目录}/{归档日记子目录}/YYYY/MM/YYYY-MM-DD.md`
   - 保持原文件名不变，按年/月组织
   - 只处理超出最近 7 天的日记

3. **通过发布事务适配器执行移动、索引与 Scope 清理：**
   - 调用 `scripts/archive_transaction.mjs` 的 `runArchiveTransaction({ vault_root, run_id, candidates, manifest, adapters })`。`adapters` 必须提供 `persist_manifest`、`verify_manifest_receipt`、`move_with_link_update`、`memory_notify`、`confirm_index` 与 `memory_forget`；每个回调只接受严格成功结构，并为副作用返回受信回执。
   1. `persist_manifest` 必须把完整 manifest 与当前 Vault 身份写入调用者不可伪造的受信存储并返回 persistence receipt。Vault 身份由 run 开始时冻结的 root `realpath`、`dev` 与 `ino` 组成，并显式进入 manifest、candidate、move、intent、派生 ID/idempotency key 及持久化/认证 payload。每个外部等待前后、创建或刷新任何 guard 前以及返回 complete 前，都重新捕获当前 root 并与冻结身份精确匹配。恢复时还必须在调用 `verify_manifest_receipt` 前完成匹配；Vault 被移动、替换或重建时禁止继续持久化、创建新 guard、自动恢复或执行后续副作用。
   2. 每个副作用都先把 intent 持久化。move intent 持久化后重新计算冻结 inventory，再创建全新的 source/target guards；最后一次 guard 复核与 `move_with_link_update` 调用之间不得插入持久化、等待或其他回调。移动后保留 `advanceVaultPathGuard` 返回的新 guards，并持久化逐文件 `moves` 与 move receipt。
   3. 每次持久化或外部等待返回后，立即重新验证所有已推进目标的 guard 和当前 target inventory；`memory_notify`、`confirm_index`、`memory_forget`、每次成功回执持久化及最终 complete 持久化都适用。回调成功回执持久化后才能跳过；否则只能使用同一 `idempotency_key` 安全重放或失败关闭。返回 complete 前再执行一次同步复核，此后不得继续等待或调用外部能力。对于位于系统归档目录的目标，`memory_notify` 返回 `skipped / excluded by scan rules` 表示按配置成功退出活跃索引；此时 `confirm_index` 必须确认旧路径不在索引、目标文件存在且目标路径不在 `vault_index`，不得要求归档目标进入索引。
   4. 只有同一项目全部候选的全部文件都持有确认回执后，才调用一次 `memory_forget`。空项目不能借由空集合自动通过；草稿、计划和日记不得调用 `memory_forget`。
   5. 草稿、计划与日记候选只能是普通文件；项目可以是普通文件，或包含至少一个可确认普通文件的非空目录。目录子项必须保持原始 NFC，并拒绝控制字符、Windows 非法字符、保留名、符号链接与非普通文件。
   6. 任一步骤失败都停止整个 run，不再处理其他候选。恢复必须使用相同 `run_id`、原候选和同一份已认证 envelope；source 被恢复、候选图交叉、路径、派生 ID、inventory 或 receipt 不一致时拒绝自动恢复。Schema、Vault 身份与 receipt 校验属于未受信阶段：失败时只返回本地 `failed`、`unverified`、空 receipt 和人工恢复指引，禁止调用持久化或任何业务副作用，且不得覆盖受信存储的最后一个合法恢复点。若 `confirm_index` 或 `memory_forget` 已发生后发现目标漂移，必须明确记录对应副作用并禁止返回 complete。

4. **运行必需的归档元数据事务：**
   - 移动事务返回经认证的 `complete` envelope 后，立即调用 `scripts/archive_metadata_transaction.mjs` 的 `runArchiveMetadataTransaction({ vault_root, run_id, archive_date, move_envelope, manifest, adapters })`。元数据事务必须使用区别于移动事务的新 `run_id`；`adapters` 必须提供 `persist_manifest`、`verify_manifest_receipt`、`write_archived_frontmatter`、`memory_notify` 与 `confirm_index`
   - 元数据事务先验证父移动 envelope 的回执，只从父 manifest 的逐文件 `moves` 派生目标。每个 `project`、`draft`、`plan` 候选必须且只能找到一个 `type` 匹配、`status: done` 的主文件；日记不写 `archived` 字段。零个或多个匹配都失败关闭，不执行任何元数据写入
   - 每个目标先持久化写入 intent，再由 `write_archived_frontmatter` 以 `before_sha256` 比较交换写入 `archived: "YYYY-MM-DD"`，保留 `status: done`；写入回执持久化后，逐文件执行 `memory_notify` 和 `confirm_index` 并分别持久化回执。系统归档目标继续使用 `skipped / excluded by scan rules` 作为预期通知结果，并确认目标文件存在且未进入 `vault_index`
   - 元数据步骤失败时，移动事务的结果保持不变；使用同一元数据 `run_id` 和已认证 envelope 恢复，已持久化的写入、通知或确认回执才可跳过。禁止重新运行或伪装回滚已经完成的移动事务
   - 本次 Archive run 禁止在两个事务之外直接改写归档目标 frontmatter 或今日日记。日记记录不属于 Archive 写集，也不作为归档完成条件
   - 只有移动事务与元数据事务都返回 `complete`，本次 Archive 工作流才可报告完成；任一 `project`、`draft`、`plan` 的 `archived` 写入、通知或索引确认缺失时必须报告部分完成及恢复动作

5. **清理检查：**
   - 检查 `{资源目录}/` 中是否有关联的孤立资源
   - 若有，保留原位并在完成报告中列出；不要扩大归档范围，也不要中断流程询问用户

## 步骤三：归档完成报告

```
## 归档完成

**已归档 [N] 个项目至 `{系统目录}/{归档项目子目录}/YYYY/`:**
- [[Project1]] → 归档/项目/2026/Project1/
- [[Project2]] → 归档/项目/2026/Project2.md

**已归档 [N] 个草稿至 `{系统目录}/{归档草稿子目录}/YYYY/MM/`:**
- 草稿1.md → 归档/草稿/2026/02/ (done)
- 草稿2.md → 归档/草稿/2026/02/ (done)

**已归档 [N] 个计划至 `{系统目录}/{归档计划子目录}/`:**
- Plan_2026-03-27_Project_LifeOS.md → 归档/计划/（保留 done）
- Plan_2026-03-27_Research_Agents.md → 归档/计划/（保留 done）

**已归档 [N] 篇日记至 `{系统目录}/{归档日记子目录}/YYYY/MM/`:**
- 2026-03-18.md → 归档/日记/2026/03/
- 2026-03-19.md → 归档/日记/2026/03/

**库状态:**
- 进行中项目: [N]
- 待处理草稿 (pending): [N]
- 待执行/待复查计划 (active): [N]
- 保留在 `{日记目录}` 的最近 7 天日记: [N]
- 已归档项目（总计）: [N]
- 已归档草稿（总计）: [N]
- 已归档计划（总计）: [N]
- 已归档日记（总计）: [N]

**建议:**
- [ ] 检查暂停中的项目是否需要归档
- [ ] 用 /research、/project 或 /knowledge 处理剩余 pending 草稿
```

# 重要规则

- **只归档已处理的草稿** — `status: pending` 的草稿绝不归档
- **只归档已完成的计划** — `status: done` 的计划才可归档，`status: active` 绝不归档
- **只归档超出最近 7 天的日记** — `{日记目录}/` 始终保留最近 7 天（含今天）的日记
- **永不删除** — 只移动，不销毁内容
- **优先使用 Obsidian CLI 移动** — `obsidian move` 自动更新 wikilink；不可用时必须由用户明确接受降级，不能静默 `mv`
- **禁止模拟移动** — 禁止通过“写新文件 + 删除原文件”模拟移动
- **按规则组织** — 项目按完成年，草稿和日记按归档年月，计划统一放入 `{归档计划子目录}`
- **默认全部归档** — 扫描后自动执行全部合规候选，不要求用户审核、选择、确认或回复
- **元数据事务是完成门禁** — 移动完成后必须运行归档元数据事务；不得在事务外补写 `archived`，两个事务未同时完成时不得报告归档完成

# 边界情况

- **无任何待归档内容：** 告知用户库已整洁，提示可用 `/research`、`/project` 或 `/knowledge` 处理 pending 草稿
- **计划仍是 active：** 跳过并提示用户该计划尚未完成，不能归档
- **日记总量不足 7 天：** 不归档任何日记，告知用户当前日记目录仍在保留窗口内
- **日记文件名不符合 `YYYY-MM-DD.md`：** 跳过该文件并在汇总中说明，避免误归档非标准文件
- **文件夹项目含混合状态：** 跳过整个文件夹，不单独归档其中的子文件，并在完成报告中说明
- **大型项目含资源：** 关联资源保留在 `{资源目录}/`，在完成报告中列出，不自动移动或清理
- **刚完成的项目：** 照常归档，并在完成报告中提示可另行补做项目复盘
- **文件移动或任一事务步骤失败：** 立即停止整个 run，保存同一份 manifest/envelope，告知用户失败步骤与人工恢复动作；修复原因后仅以相同 `run_id` 和已认证 envelope 恢复
- **Obsidian CLI 不可用：** 停止等待用户明确同意降级；未同意时不移动任何文件

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
│   └── 2025/
│       └── 12/
│           └── old-capture.md
├── {归档日记子目录}/
│   ├── 2026/
│   │   └── 03/
│   │       ├── 2026-03-18.md
│   │       └── 2026-03-19.md
│   └── 2025/
│       └── 12/
│           └── 2025-12-31.md
└── {归档计划子目录}/
    ├── Plan_2026-03-27_Project_LifeOS.md
    └── Plan_2026-03-27_Research_Agents.md
```

**核心区分：**

- **项目归档：** 按完成年份组织（有产出成果的结构化工作）
- **草稿归档：** 按归档年月组织（已被消化的碎片想法）
- **日记归档：** 按归档年月组织（超过最近 7 天的日常记录）
- **计划归档：** 统一放入 `{归档计划子目录}`（已执行完成的过程文件）

# 附加功能

**批量操作：**

- 支持一次归档多个条目
- 自动按年月分组

**项目复盘（可选）：**

- 自动归档流程不在执行前询问或创建复盘；如有需要，在完成报告中建议另行创建，内容可包括：
  - 哪些进展顺利？
  - 哪些可以改进？
  - 核心收获
  - 追加到项目的进展区块

**统计追踪：**

- 统计已完成项目数量
- 可生成年度总结

# 记忆系统集成

> 通用协议（文件变更通知、行为约束写入）见 `_shared/memory-protocol.md`。以下仅列出本技能特有的查询和行为。

### 前置查询

见步骤零中的查询代码。

# 后续建议

归档完成后建议：

1. 定期（每周/每月）执行 `/archive` 保持库整洁
2. 检查暂停中的项目，考虑重新激活或归档
3. 用 `/research`、`/project` 或 `/knowledge` 处理仍在 pending 的草稿
4. 对于仍为 `active` 的计划，继续执行或复查；完成后再运行 `/archive`

## 归档事务契约

先读取 `_shared/operation-safety.md`，再依次使用发布资产 `scripts/archive_transaction.mjs` 与 `scripts/archive_metadata_transaction.mjs`。移动适配器预检整个候选图和全部 collision，逐级安全创建目标父目录，冻结并重复验证逐文件 inventory；元数据适配器验证已完成移动 envelope，派生唯一主文件并闭环写入 `archived` 日期。两个事务都在每个副作用前持久化 intent、在每个成功副作用后持久化回执，恢复只信任经 `verify_manifest_receipt` 验证的精确 envelope。两个适配器都不承诺 exactly-once 或跨系统原子性，也不能消除最后一次复核到系统调用之间的竞态；adapter 与认证回执仍是外部信任边界。

<!-- operation-safety-v1 -->
```yaml
contract_version: 1
safety_protocol: operation-safety-v1
operation: archive
run_id: stable(archive, candidate-paths, archive-date)
target_paths:
  project-file: "{系统目录}/{归档项目子目录}/YYYY/<project-name>.md"
  project-directory: "{系统目录}/{归档项目子目录}/YYYY/<project-name>/"
  draft: "{系统目录}/{归档草稿子目录}/YYYY/MM/<filename>.md"
  plan: "{系统目录}/{归档计划子目录}/<filename>.md"
  diary: "{系统目录}/{归档日记子目录}/YYYY/MM/YYYY-MM-DD.md"
decision: [create, merge, resume, skip, replace]
adapter: scripts/archive_transaction.mjs
external_callbacks: [persist_manifest, verify_manifest_receipt, move_with_link_update, memory_notify, confirm_index, memory_forget]
transaction_steps: [preflight_all, create_target_parents, freeze_inventory, persist_manifest, persist_move_intent, revalidate_inventory, create_fresh_move_guards, move_once, advance_move_guards, record_file_moves, persist_move_receipt, memory_notify_each, confirm_index_each, memory_forget_project]
directory_creation:
  create_guard: createVaultDirectoryGuard
  ensure: ensureVaultDirectory
  recursive_mkdir: forbidden
inventory:
  freeze_before_move: all_candidate_files
  revalidate_after_each_persist: true
  subitem_names: nfc_exact_no_control_windows_safe
  entity_shapes: project_file_or_nonempty_directory_others_file_only
  directory_move: once
  manifest_moves: per_file_source_target
move_guards:
  intent_persisted_before_revalidation: true
  fresh_after_intent_persist: true
  last_revalidate_adjacent_to_call: true
  source: { before: existing, after: missing }
  target: { before: missing, after: existing }
  advance: advanceVaultPathGuard
persistence:
  manifest_contract_version: 2
  persist_callback: persist_manifest
  verify_callback: verify_manifest_receipt
  envelope_keys: [manifest, persistence_receipt, persistence_state]
  receipt_required_for_resume: true
  unauthenticated_resume: fail_closed_manual_recovery
  schema: recursive_exact_keys_and_derived_ids
vault_binding:
  identity_fields: [realpath, root_dev, root_ino]
  frozen_for_run: true
  manifest: required
  candidate_move_intent: explicit
  derived_keys: [candidate_key, move_id, idempotency_key]
  persistence_payloads: explicit
  resume: exact_match_before_receipt_verification
  revalidate_at:
    - before_external_await
    - after_external_await
    - before_guard_create_or_refresh
    - before_complete_return
  all_external_callbacks: true
  changed_root: fail_closed_manual_recovery
untrusted_resume:
  trust_checks: [schema, vault_identity, receipt]
  persist_manifest: forbidden
  side_effect_callbacks: forbidden
  result: local_failed_unverified_null_receipt
terminal_revalidation:
  after_callbacks: [move_with_link_update, memory_notify, confirm_index, memory_forget]
  after_receipt_persist: advanced_target_guards_and_inventory
  after_complete_persist: advanced_target_guards_and_inventory
  before_complete_return: synchronous
  await_after_final_revalidation: forbidden
effects:
  intent_before_side_effect: persisted
  receipt_after_side_effect: persisted
  resume: trusted_receipt_or_same_idempotency_key_replay
  malformed_result: stop_and_record
notify:
  contract_version: 2
  file_path: <new-vault-relative-path>
  previous_file_path: <old-vault-relative-path>
forget:
  scope_type: project
  allowed_after: all_project_files_confirmed
  forbidden_entity_types: [draft, plan, diary]
  forbidden_when: [move_failed, notify_failed, index_unconfirmed]
manifest_updates:
  candidate: candidates
  inventory: inventories
  move_state: candidate_states
  move: moves
  collision: collisions
  intent: intents
  move_receipt: move_receipts
  memory_notify: notified
  confirm_index: confirmed
  memory_forget: forgotten
  failure: errors
resume:
  required_match: [run_id, candidates, inventories, derived_ids, receipt]
  moved_state: source_missing_target_existing
  source_restored: reject
  skip_confirmed_files: trusted_receipt_only
  external_idempotency_key: required
stop_semantics:
  any_failure: stop_entire_run
  resume: same_run_id_same_authenticated_envelope
  continue_other_candidates: false
guarantees:
  exactly_once: false
  atomic_cross_system: false
  last_revalidate_to_syscall_atomic: false
post_transaction_writes:
  current_run: forbidden
  archived_frontmatter: required_metadata_transaction
  diary_log: not_part_of_archive
metadata_transaction:
  adapter: scripts/archive_metadata_transaction.mjs
  required_after: move_transaction_complete
  run_id: stable(archive-metadata, parent-run-id, archive-date, derived-target-paths)
  parent_trust: verify_completed_move_envelope_receipt
  target_derivation: exactly_one_matching_frontmatter_per_non_diary_candidate
  eligible_entity_types: [project, draft, plan]
  preserved_status: done
  mutation: { field: archived, value: YYYY-MM-DD }
  external_callbacks: [persist_manifest, verify_manifest_receipt, write_archived_frontmatter, memory_notify, confirm_index]
  transaction_steps: [verify_parent_receipt, derive_metadata_targets, persist_manifest, persist_write_intent, write_archived_frontmatter, persist_write_receipt, memory_notify_each, confirm_index_each]
  completion_gate: move_and_metadata_transactions_complete
  recovery: same_run_id_same_authenticated_envelope
  guarantees:
    exactly_once: false
    atomic_with_move_transaction: false
bare_mv: forbidden
```
