# 已归档项目 Scope 升级兼容设计

## 背景

LifeOS `v2.2.0` 在升级事务提交前，会重建当前项目 catalog，并校验数据库中的
project scope 是否仍能解析到 catalog 中唯一的项目主文件。当前 catalog 只扫描
`lifeos.yaml` 中 `directories.projects` 指向的项目目录，不包含系统归档目录。

用户已经归档的项目会从当前项目目录移动到系统归档目录；与这些项目关联的记忆则由
`memory_forget` 保留为 `status: archived` 的历史记录。现有终态校验却读取所有
`scope_type = 'project'` 的记忆，没有区分 active、archived 与 expired，因而把历史记录
错误地当成当前项目依赖，导致升级失败并回滚。

本次真实失败包含五条已归档记忆：

- `content:vgt-punctuation-style → vgt`
- `content:vgt-writing-style → vgt`
- `preference:vgt_article_length → vgt`
- `decision:nivc-mainline-definition → crypto-agile-policy-aware-nivc`
- `decision:project-naming → project-e4814247bf`

这些记录在数据库中均为 `status = 'archived'`，对应项目文件也都已位于系统归档目录；
当前唯一有效项目 `gts-learning` 及其 active 记忆可以正常解析。

## 目标

- 只要求 active project scope 指向当前项目 catalog。
- archived 与 expired project scope 继续作为历史记录保留，不阻断升级。
- active project scope 指向不存在或索引不一致的项目时仍然失败并回滚。
- 修复覆盖 V4 Vault 从 `2.1.2` 重跑升级到 `2.2.0` 的真实场景。
- 在不推送、不公开发布的前提下，将修复纳入现有本地 `v2.2.0` 标签。

## 非目标

- 不把系统归档目录中的项目重新加入当前项目 catalog。
- 不为归档项目重建 `vault_index` 当前项目行。
- 不删除、不改写 archived 或 expired 记忆。
- 不放宽 active project scope 的一致性要求。
- 不改变 `memory_forget`、`memory_restore` 或项目归档事务的既有接口。

## 方案比较

### 方案一：只校验 active project scope（采用）

在终态断言查询中增加 `status = 'active'` 条件。该方案与检索、上下文解析及
`memory_forget` 的既有语义一致：只有 active 记忆会进入有效上下文，archived 与 expired
均是非活跃历史状态。

优点是变更最小、不丢数据、不污染当前项目 catalog，同时仍对真正影响运行时的 active
孤儿引用保持失败关闭。

### 方案二：把归档项目加入 catalog（不采用）

这会混淆“当前项目”和“历史项目”，还会迫使升级索引系统归档目录，破坏
`directories.projects` 与 `excluded_prefixes.system` 的现有边界。

### 方案三：升级时删除归档记忆（不采用）

这会丢失历史决策和规则，并与 `memory_forget` 采用软归档而非物理删除的设计冲突。

## 详细设计

### 校验语义

`assertProjectMemoryScopesResolveToCatalog` 只读取：

```sql
SELECT slot_key, scope_key
FROM memory_items
WHERE scope_type = 'project' AND status = 'active'
ORDER BY slot_key, scope_key
```

对每条结果继续执行原有两层断言：

1. `scope_key` 必须存在于本次升级生成的当前项目 catalog。
2. `vault_index` 中必须恰有一条 `type = 'project'`、`entity_id = scope_key` 的记录，且路径
   与 catalog 声明的项目主文件一致。

查询之外的错误信息与回滚行为保持不变。这样 active 孤儿引用仍会产生
“当前项目 catalog 不存在”，active 索引漂移仍会产生“当前项目主文件索引不一致”。

### 历史状态处理

- `archived`：已经被显式归档，不进入上下文；允许其原项目离开当前 catalog。
- `expired`：已经失效，不进入上下文；同样不应要求原项目继续存在。
- 两类记录均不修改 `scope_key`、`archived_at`、`archive_reason`、`expires_at` 或其他字段。
- 升级成功后，这些记录仍可用于审计；若未来恢复为 active，恢复流程应遵守当时的有效
  scope 规则，但不在本次修复中扩展恢复接口。

### 数据流

1. 升级扫描当前项目目录，生成 catalog。
2. 升级安装 `2.2.0` 资产并进入数据库事务。
3. 当前项目主文件被强制重建索引。
4. 终态断言只消费 active project scope。
5. active scope 全部解析成功后提交事务；历史 scope 原样保留。
6. 任一 active scope 无法解析时仍回滚整个升级。

## 测试设计

### 单元回归

在 `tests/cli/migrations/project-index-consistency.test.ts` 中覆盖：

- 缺失项目对应 active scope：继续抛出“当前项目 catalog 不存在”。
- 缺失项目对应 archived scope：断言通过，记录保持 archived。
- 缺失项目对应 expired scope：断言通过，记录保持 expired。
- 当前项目对应 active scope：继续正常解析。

### 升级集成回归

在 `tests/cli/upgrade.test.ts` 中构造已是 Schema V4 的 Vault：

1. 当前项目 catalog 只包含现存项目。
2. 数据库保留一个已移出当前项目目录的 project scope，并将其状态设为 archived。
3. 重跑 `lifeos upgrade`。
4. 断言升级成功、运行时版本更新为 `2.2.0`、archived 记录仍存在且字段不变。
5. 保留现有 active 孤儿 scope 用例，证明失败关闭没有被放宽。

### 发布验证

- `npm run release:check-version -- v2.2.0`
- `npm run release:verify`
- `npm run release:pack`
- 检查测试包版本与摘要。
- 检查工作区只保留用户原有的 `package.json` 格式化改动。

## 发布处理

`v2.2.0` 目前只存在于本地，尚未推送、未触发 npm 发布或 GitHub Release。因此修复后：

1. 在 `CHANGELOG.md` 的 `2.2.0` 修复章节补充本项。
2. 创建独立修复提交，不改版本号。
3. 完整验证通过后删除并重建本地注解标签 `v2.2.0`，使其指向新的最终提交。
4. 重新生成 `lifeos-2.2.0.tgz`。
5. 仍不执行任何 push、npm publish 或 GitHub Release。

## 验收标准

- 用户当前 Vault 中列出的五条 archived project scope 不再阻断升级。
- 所有 archived 与 expired project scope 在升级后内容和状态保持不变。
- active project scope 若不在当前 catalog 中，升级仍明确失败并完整回滚。
- 全量测试、类型检查、Lint、构建、版本一致性和打包全部通过。
- 本地 `v2.2.0` 标签只在全部验证通过后更新到最终修复提交。
- 远端分支与标签保持不变。
