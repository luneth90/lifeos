# Archive 沙盒探测与排除索引兼容设计

## 背景

LifeOS `/archive` 优先使用官方 Obsidian CLI 执行移动，以便由
`app.fileManager.renameFile()` 自动更新 Vault 内的 wikilink。当前技能把 CLI 首次失败直接
解释为“Obsidian 未运行”，但 Codex 等客户端的默认沙盒可能无法访问 Obsidian CLI 的本地
通信通道。此时 `obsidian version`、`obsidian vaults verbose`、`obsidian files` 与
`obsidian move` 都会统一误报无法找到 Obsidian；同一命令在沙盒外可以正常连接。

归档还有一处独立的索引语义冲突。`lifeos.yaml` 默认将逻辑目录 `system` 排除出
`vault_index`，物理路径对应 `90_系统/` 或 `90_System/`。归档目标位于该目录下，本应退出
活跃索引。当前 `notifyFileMoved` 却假设所有移动目标都必须进入索引，因此把“活跃目录 →
系统归档目录”的合法移动错误地返回为“移动后的文件未进入索引”。

## 已确认决策

- 继续排除系统归档目录，不让历史项目、计划、草稿和日记进入默认 `memory_query`、
  TaskBoard、活跃项目或复习链路。
- 不新增 LifeOS MCP Obsidian CLI 网关，不扩展通用命令执行架构。
- 沙盒问题采用源资产中的分层规则防护：Vault 全局规则负责通用判定，`/archive` 负责具体
  执行顺序，自动化测试防止后续规则漂移。
- 索引问题在 `memory_notify` 移动逻辑中修复；保留现有 `confirm_index` 适配器名称，只澄清
  归档目标的正确确认语义。
- 中英文资产必须同步修改。

## 目标

- 沙盒内首次连接失败时，不再误报 Obsidian 未安装或未运行。
- 沙盒外只读复测成功后，本次归档中的全部 Obsidian CLI 命令固定在沙盒外执行。
- 只有沙盒外复测也失败时，`/archive` 才按 CLI 不可用暂停并请求用户选择降级方案。
- 移动到系统归档目录时，旧路径退出活跃索引，目标路径保持排除，通知返回正常结果。
- 移动后仍迁移路径型 file scope 与 `memory_items.related_files` 中的旧路径。
- 活跃索引目录之间的普通移动语义保持不变。

## 非目标

- 不修改外部渠道管理的 `obsidian-cli` 技能或插件。
- 不让系统归档目录进入默认索引。
- 不新增归档全文搜索能力；未来如需检索历史归档，应设计显式的包含归档查询入口。
- 不新增 MCP 工具，不允许任意 Obsidian CLI 子命令通过 LifeOS 服务执行。
- 不改变归档候选、路径 guard、manifest、元数据事务或 `memory_forget` 的既有安全边界。

## 方案比较

### 方案一：只修改 `/archive`（不足）

在技能中加入沙盒外复测可以修复当前入口，但 Vault 的全局工具规则仍可能引导其他任务在
首次误报后直接回退。单点规则也更容易在后续技能修订中丢失。

### 方案二：全局规则与 `/archive` 双层防护（采用）

在 LifeOS 源资产 `assets/lifeos-rules.*.md` 的“Vault 规则 → 操作工具”中规定通用判定，
在 `/archive` 中定义只读探测、沙盒外复测和本次运行路由固定。该方案不扩大运行时接口，
同时让新安装和升级后的 Vault 自动获得同一规则。

### 方案三：新增 LifeOS 原生 Obsidian CLI 网关（暂不采用）

由 MCP 服务执行 Obsidian CLI 可以进一步减少客户端差异，但会扩大公共工具面、权限边界、
幂等协议与兼容测试范围。当前 LifeOS 自带技能只有 `/archive` 明确直接调用 Obsidian CLI，
现阶段投入与风险不匹配。

## 详细设计

### Vault 全局规则

修改：

- `assets/lifeos-rules.zh.md`
- `assets/lifeos-rules.en.md`

在“Vault 规则 → 操作工具（若已安装）”中加入：

1. 客户端处于沙盒环境时，首次执行 Obsidian CLI 报告无法找到或连接 Obsidian，不得据此
   判定 CLI 未安装或应用未运行。
2. 必须先在沙盒外执行只读命令，如 `obsidian version` 与
   `obsidian vaults verbose`，确认真实可用性。
3. 沙盒外复测成功后，本次任务中的全部 Obsidian CLI 命令都在沙盒外执行，禁止混用两种
   运行环境。
4. 只有沙盒外复测仍失败时，才按 CLI 不可用执行对应技能的降级协议。

该规则由 `lifeos upgrade` 同步到 Vault 的 `AGENTS.md`、`CLAUDE.md` 等托管规则文件，禁止
直接修改外部管理的 `obsidian-cli` 技能来实现同一行为。

### Archive 具体流程

修改：

- `assets/skills/archive/SKILL.zh.md`
- `assets/skills/archive/SKILL.en.md`

在任何 `obsidian move` 之前固定执行：

1. 根据 `memory_bootstrap.scope_hints.tool_bindings` 识别稳定工具 ID，并在首次使用前增量调用
   `memory_context(contract_version=2, scopes=[{type: "tool", key: "obsidian"}],
   include_global=false, include_related_files=true)`。
2. 先运行只读探测 `obsidian version` 与 `obsidian vaults verbose`。
3. 若沙盒内探测返回无法找到或连接 Obsidian、无法读取进程或本地通信端点等环境性错误，
   立即在沙盒外重试同一只读探测；不得在此之前展示“请打开 Obsidian”或请求降级。
4. 沙盒外探测成功后，将本次 Archive run 的 Obsidian CLI 执行环境固定为沙盒外，所有移动
   使用同一路由。
5. 沙盒外探测仍失败时，才进入既有“CLI 不可用”分支；未获用户明确同意时仍禁止裸移动。

### 移动到排除目录的通知语义

修改 `src/services/capture.ts`、`src/utils/vault-indexer.ts` 与
`src/services/scope-resolver.ts`。`notifyFileMoved` 在同一数据库事务中解析实际 Vault 配置，
并分别判断旧路径与新路径是否应进入索引。

对于目标路径：

- 若 `shouldIndex(newPath, config)` 为 `true`，继续要求目标存在于 `vault_index`；缺失仍返回
  error，保持失败关闭。
- 若 `shouldIndex(newPath, config)` 为 `false`，允许目标不出现在 `vault_index`。`indexFiles`
  处理旧路径删除和目标路径 `skipped: excluded by scan rules`；若目标存在陈旧
  `vault_index` / `scan_state` 行，也必须同时删除，然后继续迁移记忆路径。

在调用 `indexFiles` 前保存来源文件的规范身份。来源 `entity_id` 在索引中唯一时，路径型
scope 与该唯一 ID scope 都属于待迁移身份；`entity_id` 重复时仍只迁移来源路径，禁止猜测。

目标被排除时使用新路径本身作为 `newScopeKey`；目标进入索引且拥有唯一 `entity_id` 时，
继续沿用实体 ID 作为 `newScopeKey`。两种情况都调用 `migrateMovedFileReferences`，同步：

- `scope_type = 'file'` 且 key 为旧路径的记忆；
- `scope_type = 'file'` 且 key 为来源唯一 `entity_id` 的记忆；
- 所有 `memory_items.related_files` 数组中的旧路径；
- 影响作用域集合。

多个来源身份合并到目标身份前，必须检查 `(scope_type, scope_key, slot_key)` 冲突；存在同
slot 冲突时整个通知事务失败并回滚索引变化，不得覆盖任一记忆。归档路径退出索引后，只有
目标文件真实存在且该路径已有 active 记忆时，scope resolver 才允许显式解析该路径；这使
迁移后的历史记忆仍可读取，同时不允许为任意排除文件凭空新建 file scope。

为保持公共返回类型兼容，不新增 `action` 枚举。移动到排除目录时返回目标对应的
`action: 'skipped'` 和 `reason: 'excluded by scan rules'`，同时携带 `previousFilePath` 与实际
影响范围；该结果表示通知成功且排除符合配置，不是错误。

### Archive 索引确认

保留 `archive_transaction.mjs` 的 `confirm_index` 适配器名称与 manifest 字段，避免扩大事务
Schema。修改中英文 Archive 契约，明确其确认条件按目标配置分流：

- 活跃索引目标：旧路径不在索引，新路径在索引。
- 系统归档目标：旧路径不在索引，目标文件存在，目标通知结果为
  `skipped / excluded by scan rules`，且目标不在 `vault_index`。

归档目标未进入索引不再构成 `index_unconfirmed`。目标文件缺失、旧索引仍存在、目标意外
进入索引或通知返回其他错误时，事务仍失败关闭。

## 数据流

1. `/archive` 扫描并冻结全部候选、目标和 inventory。
2. 加载 `archive` 与 `obsidian` 作用域规则。
3. 执行 Obsidian CLI 只读探测；必要时沙盒外复测并固定本次运行路由。
4. `archive_transaction.mjs` 调用链接更新移动适配器。
5. `memory_notify` 删除旧路径索引，确认目标按配置被排除，并迁移记忆路径。
6. `confirm_index` 按“归档目标应排除”的语义确认发布状态。
7. 移动事务完成后，元数据事务写入 `archived`，再次通知并确认目标仍符合排除规则。
8. 两个事务均完成后才报告归档完成。

## 错误处理

- 沙盒内首次探测失败：只视为环境不确定，不向用户报告 Obsidian 已关闭。
- 沙盒外探测失败：进入既有 CLI 不可用分支，不执行任何移动。
- 目标属于可索引目录但未进入索引：保持 `memory_notify` error。
- 目标属于可索引目录但本次索引结果为读取失败、跳过或移除：即使存在陈旧索引行也保持
  `memory_notify` error。
- 目标属于排除目录：返回正常 `skipped`，继续路径迁移与排除状态确认。
- 记忆身份合并存在同 slot 冲突：通知事务失败并回滚数据库变更。
- 目标路径存在冲突、源路径缺失或移动后状态不一致：继续由归档事务失败关闭。
- 任一通知、确认或元数据步骤失败：保留原 manifest 与恢复动作，不继续其他候选。

## 测试设计

### 文件通知单元测试

在 `tests/services/capture.test.ts` 增加：

- 已索引计划移动到 `90_系统/归档/计划/` 后，返回 `skipped` 与
  `excluded by scan rules`，不返回 error。
- 旧路径从 `vault_index` 删除，归档路径不进入 `vault_index`。
- 路径型及来源唯一 `entity_id` file scope 与其他记忆的 `related_files` 被迁移到归档路径。
- 迁移后的归档路径 scope 可显式解析；没有既有 active 记忆的排除文件不能借此新建 scope。
- 排除目标已有陈旧索引与扫描状态时会被清除。
- 活跃目录之间移动仍索引新路径并优先使用唯一 `entity_id`。
- 可索引目标因无效 frontmatter 未进入索引时仍返回 error。
- 可索引目标本次读取失败时不会接受陈旧索引行。
- 重复 `entity_id` 继续使用路径身份，记忆不会错误合并。

### 技能与全局规则契约测试

更新规则及技能契约测试，要求中英文资产同时包含：

- 首次沙盒失败不得直接判定 Obsidian 未运行；
- 沙盒外只读复测；
- 复测成功后本次全部 CLI 命令固定在沙盒外；
- 只有沙盒外失败才进入降级；
- `/archive` 首次使用前加载 `tool: obsidian` 作用域；
- 归档目标的 `confirm_index` 接受明确的 excluded 状态。

测试继续禁止静默裸 `mv`、递归 `mkdir -p`、未认证恢复和失败后继续其他候选。

### 验证命令

- `npx vitest run tests/services/capture.test.ts`
- `npx vitest run tests/skill-contracts/idempotency-archive-contract.test.ts`
- `npx vitest run tests/documentation-consistency.test.ts`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

## 验收标准

- 沙盒内的 Obsidian CLI 误报不再导致 `/archive` 错误暂停或要求用户重复打开应用。
- 沙盒外可用时，Archive run 的全部 Obsidian CLI 操作都使用沙盒外执行。
- 归档内容继续排除在默认索引、TaskBoard 与复习链路之外。
- 活跃目录移动到系统归档目录时，通知成功、旧索引删除、目标不索引、记忆路径迁移。
- 普通可索引目录之间的移动与失败关闭行为不回归。
- 中英文源资产保持一致，升级后 Vault 的 AGENTS/CLAUDE 规则包含沙盒外复测说明。
- 全量测试、类型检查、Lint 与构建通过。
