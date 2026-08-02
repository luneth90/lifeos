# 更新日志

## 2.2.7 (2026-08-02)

### 修复

- today 技能自动任务的 `task_id` 注释改放任务行末尾（所有 wikilink 之后），避免注释置于链接之前时阻断 Obsidian 阅读视图的 wikilink 解析（`[[...]]` 以原文渲染）

## 2.2.6 (2026-08-02)

### 修复

- Archive 技能中间产物收敛：候选 JSON 明确写入平台系统临时目录（`TMPDIR`/`TEMP`/`TMP`，macOS/Linux `/tmp/`、Windows `%TEMP%\`），禁止写入 Vault 与工作目录；正式执行（含 dry-run 后未执行）完成即清理，防止临时产物累积膨胀
- read-pdf 脚本默认输出改为 `tempfile.gettempdir()` 解析的平台临时目录，修复 Windows 上默认路径落到盘符根 `\tmp\` 的问题
- read-pdf 技能明确临时提取包（JSON 与自动渲染目录 `*-images-*`）为工作流中间产物：下游读取完成后必须删除；显式 `--output` 到 Vault 内路径则按输出包引用保留
- translate 技能补充消费侧清理约定：临时提取包在全部视觉识别与翻译产出后删除；`initial_image_blocks` 仅存于对话工作区，自身不新增落盘中间产物

## 2.2.5 (2026-08-02)

### 修复

- 加固 `lifeos archive` 的轻量安全边界：按 `lifeos.yaml` 校验 Vault 内路径、实体源目录、权威归档目标、日记保留窗口与项目稳定 ID
- Obsidian 移动显式绑定目标 Vault，项目内所有文件统一通过 `obsidian move` 更新 wikilink，不再直接移动非 Markdown 资源
- 文件夹项目支持在目标主文件身份可验证时续跑部分移动；元数据写入失败会进入 JSON 报告，修复后重跑可补写 `archived` 并重新通知索引
- 归档空源目录可在目标主文件身份可验证时续跑闭环，目录清理失败在源树仅剩空目录时不阻断 `archived` 元数据写入；文件夹项目内符号链接与特殊条目在预检阶段拒绝
- 归档预检读取失败转为冲突报告，不再中断命令输出
- 归档 dry-run 报告的 moved 列表与真实执行一致（仅文件条目）
- 拒绝符号链接越界：目标主文件节点为符号链接时停止归档，不再向 Vault 外部文件写入 `archived`
- 空源目录续跑的清理与 `archived` 补写延迟到全部预检通过后执行，dry-run 不再删除目录、后续候选冲突时不产生副作用
- 源目录树扫描读取失败转为冲突报告（`source_scan_failed`），不再吞错后抛异常
- `archived` 元数据改为同目录临时文件加原子替换，失败时清理临时文件，避免覆盖写中断截断笔记
- 记忆索引通知按「已尝试目标」去重：移动通知失败后不再降级重发补写通知，保留源路径语义
- dry-run 报告预计写入 `archived` 的主文件，预览与正式执行一致
- 逐级拒绝 source / target / main_file 的符号链接祖先（`ancestor_is_symlink`），防止经软链接越界 Vault 移动与写入
- `archived` 临时文件改用随机名加排他创建（`wx`），不可被预置软链接劫持；创建时继承原文件权限，替换后不改变可读范围
- 目标目录树读取失败转为冲突报告（`target_scan_failed`），目标目录创建失败转为 `failed`（`target_dir_create_failed`），执行期二次源扫描同样结构化报告，CLI 不再裸抛中断 JSON 输出
- dry-run 依据预检判定的 `needsArchived` 报告预计更新：源已含同值 `archived` 不误报，空源续跑现场按 `needsRepair` 报告预计补写
- 同步更新 Archive 与共享生命周期中英文文档，移除已删除事务脚本的残留语义

## 2.2.4 (2026-08-02)

### 修复

- 修复 `lifeos archive --dry-run` 提前创建目标目录的副作用：预检不再产生任何文件系统变更，消除 dry-run 后正式执行触发 `target_collision` 的问题
- 新增 dry-run 零副作用回归测试（含文件夹项目场景）
## 2.2.3 (2026-08-02)

### 重构：Archive 技能从发布事务收敛为单一命令

- 新增 `lifeos archive` 命令（`src/services/archive.ts` + `src/cli/commands/archive.ts`）：预检全部候选 → `obsidian move` 移动并自动更新 wikilink → 幂等写入 `archived` 日期 → 自动 `memory_notify`；冲突整体停止（退出码 2），单候选失败不中断（退出码 1），幂等重跑
- 删除发布事务脚本 `archive_transaction.mjs` / `archive_metadata_transaction.mjs`（约 2700 行）及对应测试；归档不再依赖 operation-safety 协议、受信 manifest、路径 guard 与 resume 恢复机制
- 重写 `assets/skills/archive/SKILL.zh.md` / `SKILL.en.md`（约 480 行压缩至约 160 行）：保留扫描规则、权威归档路径（target_paths）与边界情况，执行方式改为调用 `lifeos archive`
- `scripts/validate-skill-contracts.mjs`：Archive 改用 `archive-targets-v1` 简化契约校验（目标映射 + 正文权威路径 + 逻辑占位符声明），移除事务契约诊断
- 同步更新 skill-contracts 与 assets 测试，全套 923 个测试通过

## 2.2.2 (2026-08-02)

### 修复

- 在 Vault 全局规则与 `/archive` 双语技能中加入 Obsidian CLI 沙盒外只读复测：沙盒内首次连接失败不再误判 CLI 未安装或应用未运行，复测成功后当前任务的全部 Obsidian CLI 命令固定在沙盒外执行
- 修复 `memory_notify` 将文件从活跃目录移动到 `90_系统` / `90_System` 排除目录时的语义：旧路径退出活跃索引，归档目标保持排除并返回 `skipped / excluded by scan rules`
- 完整迁移移动文件的路径型和唯一 `entity_id` 文件记忆及 `related_files`，清理目标的陈旧索引与孤立扫描状态，并对作用域冲突、重复 ID、目标读取失败保持事务回滚或失败关闭

### 测试

- 新增双语沙盒执行顺序、归档排除确认、真实文件作用域迁移、陈旧索引与扫描状态、重复实体 ID、记忆冲突和可索引目标失败关闭回归测试

## 2.2.1 (2026-08-01)

### 修复

- 将 `better-sqlite3` 升级至 13.0.2，并随 LifeOS 制品打包 N-API 预编译二进制，移除已弃用的 `prebuild-install` 传递依赖，避免全局安装触发源码编译脚本警告
- 更新 MCP SDK、Vitest 与 tsx 的安全补丁版本并刷新传递依赖，使完整 npm 审计归零

### 测试

- 新增原生数据库生产依赖与锁文件安全基线测试，并验证真实 SQLite 查询、完整数据库回归、npm 发布制品和全局安装路径

## 2.2.0 (2026-08-01)

### 新增

- 建立覆盖 11 项 LifeOS 技能的双语执行契约，统一数据结构、入口路由、计划与执行边界、状态流转、幂等恢复、操作标识和客户端能力门禁，并新增可在源码与 npm 制品中运行的技能契约校验器
- PDF 提取包升级至 Schema V2：输出页面尺寸、文字/位图/矢量区域边界、有序区块和语义完整性状态；新增独立提取包校验工具，为后续裁剪和自动化消费提供稳定几何契约
- `/translate` 支持在翻译 PDF 时自动识别、裁剪并嵌入原书图表：使用稳定资源命名和语义锚点定位，裁剪不足时自动扩大边距重试；边界或插入位置仍不可靠时，仅插入“见原书图 X.X”提示，不要求人工介入
- `/archive` 新增可恢复的归档事务和元数据事务，覆盖预检、原子移动、`archived` 日期写入、幂等重跑、故障恢复与终态复核

### 改进

- 强化 `/read-pdf` 的位图、公式、表格与矢量图形识别，统一二维容差、局部几何证据和全局搜索预算，降低装饰线、页框和稠密刻线的误判风险，并避免复杂页面触发无界搜索
- 收紧 Vault 路径安全、项目稳定身份、模板加载、知识产出路径和跨技能交接规则；补齐中英文技能、模板、共享协议及执行提示词的语义一致性
- 翻译笔记模板新增图表嵌入、图注、视觉处理统计和回退记录；断点续跑时复用既有资源并只清理当前运行产生且未被引用的候选图片

### 修复

- 闭环归档事务内外的 `archived` 日期语义，修正项目执行阶段状态、研究执行写入边界、周报与今日规划运行标识、知识技能双路径来源及头脑风暴交接日期等契约不一致
- 加固跨平台 npm 打包、运行时资产验证、路径叶节点身份、归档恢复根身份和客户端能力降级行为，避免发布制品与源码契约产生偏差
- 修正升级终态校验误把 `archived`、`expired` project scope 当作当前项目依赖的问题；已归档项目的历史记忆保持不变，只有 `active` scope 必须解析到当前项目 catalog

### 测试

- 新增技能契约、归档事务、路径安全、PDF 提取校验、区域裁剪和跨平台打包回归测试；当前测试集覆盖 59 个测试文件、1062 项测试

## 2.1.2 (2026-07-27)

### 改进

- `/today` 每日规划交互收敛为“今天做什么？”一个候选问题，候选综合昨日遗留、活跃项目下一步和待复习事项；移除新想法、阻碍问题及其草稿捕获后续流程
- `/research` 生成计划后不再询问知识水平和方法偏好，也不再在计划与执行提示词中传递这两项信息；保留计划审核确认及 Domain 无法推断时的领域澄清
- 同步更新中英文 Today、Research 技能资产及 Research 的规划、执行 Agent 提示词

## 2.1.1 (2026-07-26)

### 修复

- `memory_bootstrap` 新增 `scope_hints.available_tools` 与 `scope_hints.tool_bindings` 路由元数据，使调用方能够识别存在活跃记忆的工具作用域，但不把工具规则正文注入 Layer 0
- 新增 `memory.tool_bindings` 配置与工具别名规范化：`obsidian-cli` 等技能名或命令名可解析到稳定工具 ID；别名匹配多个工具时返回 `ambiguous_tool_alias`，禁止猜测
- 记忆协议明确要求任务中途首次引入技能、项目、仓库、工具或文件时，先增量调用 `memory_context` 补载对应作用域
- 同步更新中英文启动规则和记忆协议资产，并增加双语语义一致性、作用域解析、启动提示与服务端输出测试

## 2.1.0 (2026-07-23)

### 新增

- 新增 `file` 作用域防写校验：`assertNotTemporaryFileScope` 按 `vault_index.type` 拦截对 `plan`/`draft` 类型临时文件的记忆写入，`upsertMemoryItem` 与 `reclassifyMemoryItem` 双入口生效，杜绝阶段性决策误污染 Scope Memory
- 新增 `forgetScopeMemoryItems` 批量归档 API：按 scope 一键清理全部活跃记忆，禁止批量归档 `global` 作用域，仅处理 `active` 条目
- `memory_forget` MCP 工具扩展为双模式：`item_id` 单条归档与 `scope` 批量归档互斥，批量分支补充 scope 缓存失效
- `archive` 技能新增子步骤「清理关联 Scope 记忆」，在项目/草稿/计划归档时自动调用 `memory_forget` 批量清理
- `memory-protocol` 协议补充临时文件禁写规范与批量归档用法

## 2.0.3 (2026-07-23)

### 新增

- 新增对 Antigravity CLI 项目级 MCP 配置的支持：`lifeos init` 与 `lifeos upgrade` 自动生成或合并 `.agents/mcp_config.json`，保留已有顶层字段与其他 MCP Server
- 将 Antigravity 配置纳入升级路径安全检查、精确写集备份、失败回滚与显式恢复，并补充初始化、合并和恢复测试

## 2.0.2 (2026-07-22)

### 修复

- `lifeos upgrade` 提前获取外部写闸并使用 `BEGIN IMMEDIATE`，对短暂 SQLite 写锁进行有限重试，减少首次失败而重跑成功的偶发现象
- cutover 改为精确写集备份；`.git`、`.obsidian` 等无关文件波动不再阻断升级，切换前的写集并发变更会在零写入阶段明确拒绝
- SQLite 采用在线一致性快照，完整包含未 checkpoint 的 WAL 提交，并校验快照完整性、哈希、文件权限与持久化落盘
- 回滚支持写集幂等恢复并兼容旧版完整 Vault journal，补齐 scope map 发布后故障、退役托管资产和目录恢复等边界

## 2.0.1 (2026-07-21)

### 修复

- MCP 热路径不再逐文件校验托管资产哈希（`verifyManagedAssets: false`），允许用户自定义内置 Skill、模板和规范文件后正常使用 MCP 工具
- 制品完整性校验（`runtime-receipt.package_sha256`）和离线诊断命令（`lifeos doctor`、`lifeos upgrade`）中的托管资产校验保持不变

## 2.0.0 (2026-07-21)

### 不兼容变更

- 记忆协议一次性切换为 `contract_version=2` 与 `Schema V4`；运行时不再兼容旧契约，也不会隐式迁移旧数据库
- V1–V3 Vault 必须通过 `lifeos upgrade` 离线升级到 V4；不提供双结构过渡模式，原有 `--override` 参数已移除
- `lifeos.yaml` 改用分区上下文预算与 `repository_bindings`，移除 `userprofile_rules`、`revises_summary`、`userprofile_doc_limit` 与 `taskboard_doc_limit`

### 作用域记忆与上下文控制

- 将记忆身份统一为 `(scope.type, scope.key, slot_key)`，支持 global、skill、project、repository、tool 与 file 作用域
- Layer 0 仅装载有效的全局规则、全局画像与当前焦点；全局 hard 规则始终保留，soft 规则按预算筛选，项目等局部规则改为通过 `memory_context` 按需获取
- 新增 `global_rules`、`scoped_context` 与 `single_item_max` 等独立预算，避免项目增多导致常驻规则持续膨胀
- MCP 接口收敛为 `memory_bootstrap`、`memory_query`、`memory_context`、`memory_log`、`memory_rules`、`memory_forget` 与 `memory_notify` 七个工具
- 新增 `lifeos rules` 记忆治理命令，支持 list、audit、export、classify、archive 与 restore

### 自动升级、回滚与运行时安全

- `lifeos upgrade [path]` 会自动为旧项目补充稳定 ID 并写回 Markdown、发现高置信 Git 仓库绑定、生成 scope map，并校验项目索引一致性；只有真正存在歧义时才中断并要求审阅
- 升级采用原子 cutover：先在 Vault 外创建并校验备份，再通过外部写闸执行资产安装、配置迁移、数据库迁移和最终契约验证；失败时自动恢复原 Vault
- 每个 Vault 始终只保留最近一次完整回滚备份，包括重复执行同版本升级；可使用 `.lifeos-cutovers` 中对应的 `journal.json` 显式恢复整个 Vault
- 最终数据库提交后自动清理 `{system}/{memory}/migrations/` 一次性工作区；审阅未完成或升级回滚时仍保留所需迁移材料
- 自动生成的 scope map 带有上下文指纹与条目哈希：未修改的过期草案可安全刷新，人工编辑或显式指定的文件不会被自动覆盖
- 运行时拒绝旧 Schema、缺失数据库、活动中的切换锁、越界路径和不一致的托管资产，升级及恢复过程同时防护符号链接和路径穿越
- 技能资产解析会忽略 Python 运行时生成的 `__pycache__`、`.pyc` 与 `.pyo`，避免临时字节码进入托管资产清单
- 文件移动通知支持旧路径，迁移 file scope 与关联文件引用，避免重命名后产生孤立记忆
- 构建与发布打包前强制清理 `dist`，防止已删除源码的旧编译产物进入发布包

### 项目、学习状态与文档

- `/project` 创建规则和项目模板现在强制生成稳定、唯一且可移植的项目 ID；项目改名或移动不会改变该 ID，项目作用域记忆可持续解析
- 知识状态机统一为 `draft → review → revised → mastered`，`/revise` 默认只消费 `review`，完成首次批改后进入 `revised`
- 更新全部中英文技能、规则资产、记忆协议、集成测试与手工测试文档到 2.0.0 最终语义

## 1.8.3 (2026-05-13)

### Node 26 运行时支持

- 将 `better-sqlite3` 显式依赖从 `^12.8.0` 提升到 `^12.10.0`
- `better-sqlite3@12.10.0` 已声明支持 Node `26.x`，用于修复 Node 26 下原生模块 ABI 不兼容风险
- 同步更新锁文件和内置资产版本，发布后新安装的 `lifeos` 将直接解析到支持 Node 26 的 SQLite 原生依赖

## 1.8.2 (2026-05-03)

### `/ask` Layer 0 加载规则修正

- 将 `/ask` 技能中的 `_layer0` 获取规则从“每轮对话兜底”改为“当前 session 兜底”，避免同一 session 普通问答反复调用 `memory_bootstrap`
- 明确当前 session 已有 `_layer0` 时，普通问答不得重复加载 Layer 0，减少上下文重复和旧快照噪声
- 保留必要刷新路径：Vault 文件变更、`memory_log`、TaskBoard 更新、compaction 后恢复等重要状态变化后，仍可重新调用 `memory_bootstrap` 刷新 Layer 0
- 同步更新中英文 `/ask` 技能资产

## 1.8.1 (2026-04-29)

### 技能资产路径修复

- 修复 `/research`、`/project` 和 `/brainstorm` 技能正文中残留的 `*.zh.md` / `*.en.md` 本地引用
- 这些引用在源码资产中存在，但安装到 Vault 后会被语言解析器映射为无后缀 `.md` 文件，导致运行时读取 `_shared/dual-agent-orchestrator.zh.md` 等路径时报 `File not found`
- 统一改为安装后的运行时路径：`_shared/dual-agent-orchestrator.md`、`references/action-options.md`

### 测试

- 新增技能安装映射回归测试，扫描安装后的技能 Markdown，防止 `_shared/` 和 `references/` 下再次出现运行时不存在的语言后缀本地引用

## 1.8.0 (2026-04-27)

### Vault 索引引擎升级 — 增量扫描、双连接消除

- **增量扫描**：`fullScan` 改为基于 `mtime` 的增量检测，跳过未变更文件，显著减少首次启动后的扫描耗时
- **双连接消除**：新增 `deduplicateEdges` 步骤，消除 vault 索引中因 wikilink 双向解析产生的冗余图谱连接
- **backlinks 计算**：新增 `computeBacklinks` 批量计算所有文件的反向链接，写入 `vault_index.backlinks` 供检索使用
- **wikilink 规范化**：新增 `normalizeWikilink` 工具函数，消除 `[[Title]]` vs `[[Title|Alias]]` vs `Title` 三种引用格式的歧义，TaskBoard 的项目匹配现在支持三种格式

### Schema 校验与查询优化

- **Schema 校验**：`lifeos.yaml` 加载时新增 Zod schema 校验，启动时非法配置直接报错退出，不再静默吞异常
- **LIKE 分阶段回退**：SQLite LIKE 查询优化，当 `vault_fts` 全文搜索无结果时自动回退到 `vault_index` 的 LIKE 模糊匹配，兜底召回
- **通知批量化**：Watcher 变更通知改为批量处理，合并密集文件事件的 DB 写入，减少 SQLite 锁竞争
- **Layer 0 时效修正**：`memory_bootstrap` 返回的 `_layer0.project_focus` 现在使用最新的 project 数据，不再返回过时快照

### Server 健壮性

- **startup 错误细化**：启动失败时返回结构化 `startup_error` 对象，包含错误码和上下文（ConfigError / DbError / Unknown），Agent 可据此采取不同重试策略
- **memory_log 去抖**：500ms 防抖窗口内重复的 `slot_key` 写入被合并，防止技能频繁调用时写放大
- **DB 健康检查**：`lifeos doctor` 新增数据库健康检查子命令，校验 SQLite integrity、vault_index/vault_fts 行数一致性

### 内部

- 版本号统一来源：消除 `src/index.ts`、`src/server.ts` 中的硬编码版本号字符串，统一从 `package.json` 读取
- 更新 13 个文件，净增约 572 行（后续补提交于 4 文件 +40/-14）

### lifeos-rules 增强

- **启动规则醒目提升**：将会话启动 `memory_bootstrap` 规则从记忆系统协议区块提升到 `lifeos-rules` 文件顶部（语言规则之后），用 `[!CAUTION]` 标记，并明确"简单查询（文件路径、源码位置）也不得跳过"
- 同步删除原记忆系统规则区块中的重复描述，消除歧义

### 归档技能增强

- **优先使用 Obsidian CLI 移动文件**：archive 技能改为优先调用 `obsidian move`（内部使用 `app.fileManager.renameFile()`），归档时自动更新 vault 内所有 wikilink 引用
- 不可用时（命令不存在或 Obsidian 未运行）回退到系统 `mv`，在完成报告中标注「⚠️ mv 回退，wikilink 可能未更新，建议运行 `obsidian unresolved` 检查」
- 新增文件夹项目的整体目录移动支持，禁止逐文件复制重建

## 1.7.2 (2026-04-24)

### Codex MCP 配置修复

- 修复 `lifeos upgrade` 更新 `.codex/config.toml` 时可能把 `args = [...]` 与后续 `[mcp_servers.*]` table header 拼到同一行的问题
- 该问题会导致 Codex 启动时报 TOML parse error，典型错误形态是 `args = [...][mcp_servers.lifeos.tools.memory_bootstrap]`
- 新增回归测试，覆盖已有 Codex tool section 时补齐 `lifeos` MCP 字段的换行保留行为

## 1.7.1 (2026-04-24)

### 技能描述瘦身

- 压缩全部内置技能的 `description` frontmatter，只保留触发条件和功能定位，减少 Agent 启动时技能目录占用的上下文
- 同步处理中英文技能资产，避免英文描述显著长于中文描述导致额外上下文浪费
- 保留完整技能流程在 `SKILL.md` 正文中，不改变技能行为、路径约定和工作流协议

### 测试稳定性

- 调整 digest 技能安装测试，不再依赖 frontmatter `description` 的具体营销式文案，改为检查正文中的稳定中英文内容
- 继续保留全量技能 frontmatter YAML 合法性校验，防止 `description` 中的特殊字符破坏资产安装

## 1.7.0 (2026-04-21)

### 事件驱动用户画像系统落地

- `memory_log` 的 `slot_key` 现在支持结构化画像槽位，如 `profile:weak.math_group_theory`
- `UserProfile` 的 `profile-summary` AUTO section 改为优先聚合结构化 `profile:*`，`profile:summary` 退化为兼容性回退
- `Layer 0` 现在会带出结构化画像摘要，不再只依赖旧的综合 `profile:summary`

### 技能协议同步

- `/today` 改为只在明确事件出现时写入 `profile:work_style` / `profile:context_switch_pattern`
- `/revise` 新增 `profile:weak.*` / `profile:strong.*` 写入约定
- `/project`、`/brainstorm`、`/ask` 新增结构化画像写入规范
- `memory-protocol`（中英）补充结构化 `profile:*` 槽位命名与 content 写法

## 1.6.0 (2026-04-20)

### 显式 Layer 0 Bootstrap

本版本将 Layer 0 从“首次任意工具调用时的隐式副作用”升级为“显式、幂等、可复用的会话入口”，解决 Agent 在拿到 `_layer0` 之前就开始工作的问题。

- 新增 `memory_bootstrap` MCP 工具，专门用于显式触发 startup 并返回 `_layer0`
- server 会话状态新增 `layer0Dirty` 标记，`memory_log`、`memory_notify` 和 watcher 自动通知后会触发 Layer 0 轻量刷新
- 保留现有兼容行为：如果 Agent 没有先调用 `memory_bootstrap`，其他工具首次调用时仍会附带 `_layer0`

### 协议切换到显式主路径

- `lifeos-rules`（中英）改为明确要求：进入任何 LifeOS Vault 会话时，第一步必须调用 `memory_bootstrap`
- `memory-protocol`（中英）新增 `memory_bootstrap` 为技能工作流中的显式入口
- `/ask` 技能（中英）补充兜底规则：本轮尚未取得 `_layer0` 时先调用 `memory_bootstrap`

### 测试与文档同步

- 新增 server 回归测试，覆盖首次 bootstrap、重复 bootstrap 幂等性，以及 `memory_log` / `memory_notify` 之后的 Layer 0 刷新
- 手动测试指南与集成测试文档改为优先验证 `memory_bootstrap`
- 补充本次机制调整的设计文档与实施计划

## 1.5.3 (2026-04-13)

### `/ask` 技能提升为默认交互入口

- **隐式触发**：将 `/ask` 从"快速问答助手"提升为 LifeOS 默认交互入口，所有交互式提问自动触发，无需显式输入 `/ask`
- **步骤零：问题分类与路由**：新增内部分类机制，收到问题后先判断类型（简单问答、Vault 相关、PDF 阅读、发散探讨、系统调研、复习测试、知识整理），再决定直接回答或路由到 `/brainstorm`、`/research` 等专项技能
- **lifeos-rules 声明**：在 CLAUDE.md/AGENTS.md 模板的技能区块中增加默认入口声明，确保每次对话加载时强化隐式触发优先级
- 仅在用户显式调用其他技能或发出纯执行指令时跳过

## 1.5.2 (2026-04-10)

### `lifeos-rules` 进一步瘦身

本版本继续压缩 `lifeos-rules`（即 `CLAUDE.md` / `AGENTS.md` 源文件），目标是在不改变规则效果的前提下，减少常驻上下文占用，降低前段注意力干扰。

- `操作工具` 从工具表格压缩为单句规则，并明确表述为“优先使用官方 Obsidian CLI 工具，未安装时回退到平台原生文件工具”
- `状态流转` 仅保留 3 条最关键的全局硬约束：`pending` 草稿绝不归档、`frozen` 项目不进入活跃/复习链路、知识状态只升不降
- `学习类项目知识准确性` 从展开说明压缩为 2 条防错判定句：原书优先、不确定先回读
- `Context 恢复` 压缩为单句，并移动到文档末尾，改为条件触发式提醒，避免占用前段常驻注意力

**压缩效果：**
- 双语合计约减少 `464–516 tokens`（取决于 tokenizer）
- 中文规则文件约减少 `246–295 tokens`

## 1.5.1 (2026-04-09)

### 新增 `/translate` 技能

新增 `/translate` 技能，将英文 PDF 书籍章节翻译为中文 Markdown 阅读笔记，支持在 Obsidian 中实现「PDF++ 原书 + 中文对照笔记」的双窗口阅读体验。

- 调用 `/read-pdf` 提取原文，按小节组织翻译产出，术语首次出现标注英文原文
- 产出路径：`{资源目录}/翻译/{书名}/{章节名}.md`
- 翻译完成后自动回填学习项目掌握度总览的「翻译」列
- 包含习题翻译，保留题号结构便于对照做题
- `lifeos.yaml` 新增 `subdirectories.resources.translations` 配置项

## 1.5.0 (2026-04-07)

### 重大变更：记忆系统 V3 — 架构精简与用户画像重构

本版本完成记忆系统 V3 升级，删除 enhance 队列和 semantic_summary 字段，移除 UserProfile 中无意义的统计式学习进度，将用户画像生成改由 LLM 驱动。

**Schema V3 升级（4 表 → 3 表）：**
- 删除 `enhance_queue` 表及其索引，语义增强改为解析时内联执行
- 删除 `semantic_summary` 字段，FTS 触发器和查询同步清理
- 新增 V2→V3 原子迁移，支持 V1→V2→V3 顺序迁移链

**UserProfile 画像重构：**
- 移除 `learning-progress` section——纯 `COUNT GROUP BY status` 的数字统计无法反映用户掌握了什么
- 用户知识掌握画像改由 `/today` 技能在每日规划时生成：收集项目进度、笔记习题解答、复习记录和个人补充，由 LLM 综合分析后写入 `profile:summary`
- `buildRulesSection` 新增 `profile:` 前缀过滤，防止画像描述污染行为约束区块
- `memoryLog` 根据 `slotKey` 前缀智能刷新对应 UserProfile section（`profile:` → profile-summary，其余 → rules）

**搜索召回修复：**
- `searchHints` 补全所有 type/status 中文标签，修复因标签缺失导致的搜索召回回退

**配置健壮性：**
- `contextBudgets()` 增加非法值校验，防止 NaN 导致 Layer 0 裁剪失效
- 移除 ContextPolicy.md，预算配置统一收归 `lifeos.yaml` 的 `context_budgets`

### 协议文档同步

- `/today` 技能（中英）：新增画像数据收集步骤和用户画像生成步骤

### 内部

- 净删除约 500 行代码
- V2→V3 迁移在 SQLite 事务中执行，崩溃安全
- 新增回归测试：`profile:summary` 不出现在 rules 区块

## 1.4.2 (2026-04-07)

### CLAUDE.md 协议瘦身

精简 `lifeos-rules`（即 CLAUDE.md 源文件），将详细协议内容下沉到按需加载的共享文件，降低 Agent 注意力稀释问题。

**优化效果：** 170 行 / ~2968 tokens → 99 行 / ~1450 tokens（-54%），落入推荐的 1000–2000 tokens 区间。

**下沉内容：**
- 记忆系统分层激活规则、规则捕获规范、噪声防护 → `memory-protocol.md`
- 模板路由表 → `template-loading.md`
- 技能目录详细描述 → 各 SKILL.md 按需加载
- 目录结构详细说明 → 精简为映射表 + 指向 `lifeos.yaml`

**设计原则：** CLAUDE.md 从"带着完整地图"变为"知道去哪里找地图"——只保留铁律级约束，参考信息按需加载。

## 1.4.1 (2026-04-05)

### 草稿状态统一

将草稿的三个已消费状态 `researched`/`projected`/`knowledged` 统一为 `done`，与项目和计划的状态词汇对齐。

**状态机变更：**
```
# 之前
pending ──/research──→ researched ──┐
pending ──/project───→ projected  ──┼──/archive──→ archived
pending ──/knowledge─→ knowledged ──┘

# 之后
pending ──/research,/project,/knowledge──→ done ──/archive──→ archived
```

**变更范围：**
- `lifecycle`（中英）：状态图、状态表、技能参与矩阵
- `Frontmatter_Schema`：draft 枚举更新为 `pending / done / archived`
- `archive` 技能（中英）：三次 query 合并为一次 `status:done`；归档时草稿也统一更新为 `status: archived`
- `research`/`project`/`knowledge` 技能（中英）：草稿消费后写入 `done`

### 工具链

- 新增 `release:bump` 脚本：自动更新 package.json、package-lock.json 和全部 SKILL 文件的版本号

## 1.4.0 (2026-04-04)

### 重大变更：记忆系统 V2 精简重构

本版本对记忆系统进行了大幅精简，从 7 张数据表/6 个 MCP 工具缩减到 4 张表/3 个工具，净删除约 4000 行代码。核心目标：移除所有无活跃消费方的数据结构和工具，保留真正被使用的偏好/纠错持久化能力。

**Schema 精简（7 表 → 4 表）：**
- 删除 `session_log`、`session_state`、`session_fts` 三张表及全部会话级日志机制
- `memory_items` 重构为以 `slot_key` 为主键的扁平结构，移除 `target`/`section`/`id` 三元组
- 新增 V1→V2 原子迁移：仅保留 preferences/corrections 规则数据，自动回滚保护

**MCP 工具精简（6 → 3）：**

| 删除的工具 | 原因 |
|------------|------|
| `memory_recent` | 依赖 session_log，已无数据源 |
| `memory_auto_capture` | 语义抓取无消费方，偏好捕获由 `memory_log` 承担 |
| `memory_citations` | 引用追溯功能无实际使用场景 |

保留：`memory_query` · `memory_log` · `memory_notify`

**偏好/纠错统一为规则（Rules）：**
- UserProfile 的 preferences 和 corrections 两个 AUTO section 合并为单一 `rules` section
- `upsertRule()` 替代 `logEvent()`，correction 永远不会被 preference 降级覆盖
- 源头去重：同一 `slot_key` 全局唯一，消除跨 section 重复

**frozen 项目状态：**
- 新增 `frozen` 状态：`active ⇄ frozen → done → archived`
- 冻结的项目不出现在 TaskBoard 焦点/活跃项目/待复习面板
- 关联知识笔记自动从复习列表中隐藏
- 知识笔记新增 `project` frontmatter 字段标记所属项目

**活文档精简：**
- TaskBoard：5 sections → 3（移除 decisions、update-log）
- UserProfile：4 sections → 3（preferences + corrections 合并为 rules）

**Layer 0 优化：**
- 移除 session_bridge 机制（生产数据 92% 失败率）
- 预算调整：layer0_total 1800、taskboard_focus 500、revises_summary 100
- 新增待复习概况摘要

**运行时改进：**
- startup 自动清理过期规则（`cleanupMemoryItems`），防止过期规则泄漏到 UserProfile
- ContextPolicy 接口补齐 `revises_summary` 字段

### 删除的代码模块

- `src/services/maintenance.ts` — 维护任务调度（无消费方）
- `src/active-docs/citations.ts` — 引用追溯
- `src/active-docs/long-term-profile.ts` — 长期画像
- `src/db/consolidation.ts` — 数据合并

### 协议文档同步

- `lifeos-rules`（中英）：记忆工具从 6 个更新为 3 个，新增 frozen 状态说明
- `memory-protocol`（中英）：完全重写，精简为 `memory_log` + `slot_key` 规范
- `lifecycle`（中英）：新增 frozen 状态流转规则
- `Frontmatter_Schema`（中英）：新增 frozen 状态和 project 字段
- 全部 10 个技能文件（中英共 20 个）：同步更新记忆调用方式

### 内部

- 净删除约 4000 行代码（+765/-4736 across 60 files）
- V1→V2 迁移包在 SQLite 事务中，崩溃安全
- 迁移测试覆盖数据映射、slot_key 冲突优先级、非规则行丢弃、旧表清理
- 408 个测试全部通过

## 1.3.0 (2026-04-02)

### 重大变更：记忆系统架构重构

本版本对记忆系统的三文件架构（ContextPolicy / TaskBoard / UserProfile）进行了全面重构，MCP 工具从 11 个精简到 6 个，3 个关键生命周期操作实现内部自动化。

**Layer 0 偏好可达性保障：**
- 偏好和纠错现在直接包含在 Layer 0 摘要中，使用独立的 1000 token 预算，确保 Agent 在任何场景下都能获取用户行为约束
- Layer 0 总预算从 1200 提升至 2000 token，新增"行为约束"section
- 偏好/纠错/决策写入后即时刷新对应活文档 section，compaction 后不再丢失新偏好

**MCP 生命周期自动化：**
- `memory_startup` → 首次 `memory_bootstrap` 或其他工具调用时自动触发；`memory_bootstrap` 显式返回 `_layer0`，其他工具首次返回保留兼容 `_layer0`
- `memory_checkpoint` → 会话结束（stdin 关闭）时自动执行
- `memory_notify` → `fs.watch` 自动监听 Vault `.md` 文件变更，500ms 防抖自动索引（手动调用保留为同步入口）
- `memory_skill_complete` → 合并至 `memory_log(entry_type="skill_completion")`

**ContextPolicy 精简：**
- 移除场景策略、技能画像策略、强制引用场景（均为未被消费的死代码）
- ContextPolicy.md 从 5 个 section 精简为 2 个：Layer 0 预算 + 活文档体积约束

**TaskBoard / UserProfile 职责清晰化：**
- TaskBoard = "做什么"：项目信息唯一来源
- UserProfile = "怎么做"：偏好、纠错、统计、知识掌握度
- UserProfile 移除活跃项目列表和近期决策 section，消除与 TaskBoard 的信息重复

### 删除的 MCP 工具

| 工具 | 替代方式 |
|------|----------|
| `memory_startup` | MCP server 自动触发 |
| `memory_checkpoint` | MCP server 自动触发 |
| `memory_skill_complete` | `memory_log(entry_type="skill_completion")` |
| `memory_refresh` | 即时刷新 + fs.watch |
| `memory_skill_context` | 死代码，直接删除 |

### 保留的 MCP 工具（6 个）

`memory_query` · `memory_recent` · `memory_log` · `memory_auto_capture` · `memory_notify` · `memory_citations`

### 删除的代码模块

- `src/skill-context/` 整个目录（7 个文件）：`buildSkillContext`、seed profiles、reranking 逻辑
- `context-policy.ts` 中的 `resolveScenePolicy`、`resolveSkillProfilePolicy`、`DEFAULT_SKILL_PROFILE_POLICIES` 及相关类型

### 协议文档同步

- `lifeos-rules`（中英）：分层协议从三层精简为两层，新增 `_layer0` 上下文说明
- `memory-protocol`（中英）：`memory_skill_complete` → `memory_log`，checkpoint 自动化
- `/revise`、`/digest`、`/read-pdf` SKILL（中英）：同步更新技能完成调用方式
- 测试指南（中英）：startup/checkpoint 改为验证自动触发行为

### 内部

- 净删除约 1150 行代码（+431/-1562 across 35 files）
- `fs.watch` 防抖串行化（`notifyQueue` + `notifyInFlight` 防并发 SQLite 锁）
- 进程退出前 `flushPendingNotifies` 确保不丢失待处理文件通知
- `checkpointDone` 防重入，避免 `stdin.on('end')` 和 `beforeExit` 重复触发

## 1.2.0 (2026-04-01)

### 新功能

- **偏好捕获与跨 Agent 持久化**：`memory_log` 和 `memory_auto_capture` 新增可选 `slot_key` 参数，当偏好/纠错/决策事件附带 `slot_key` 时，自动同步写入 `memory_items` 表，实现跨 Agent 的用户偏好持久化存储
- **用户画像统计聚合**：UserProfile 的「用户摘要」区块从空白占位改为自动统计画像，展示学习重心、常用技能 Top 5、近 30 天活跃度等数据
- **记忆系统三层激活模型**：重写记忆系统规则，从"技能内/外"二元开关改为三层激活——始终激活（偏好捕获）、技能工作流（Vault 操作）、会话生命周期（checkpoint），解决技能外偏好无法写入的矛盾
- **技能目录补全**：`/digest` 技能加入 lifeos-rules 技能目录表格（中英双语）
- **偏好回顾步骤**：memory-protocol 在技能完成后、会话收尾前新增「偏好回顾」环节，含 `slot_key` 调用规范和示例

### 问题修复

- 修复 UserProfile 与 TaskBoard「近期决策」区块数据重复问题，决策统一保留在 TaskBoard
- 修复 TaskBoard 活跃项目摘要中 Markdown 标题符号（`#`、`**`）未剥离导致的渲染错误
- 修复 `upsertMemoryItem` UPDATE 分支覆盖 `source_event_ids` 导致溯源链断裂的问题，改为追加（保留最近 10 条）
- 修复 `buildCorrectionsSection` 未读取 `memory_items` 的一致性问题，对齐 `buildPreferencesSection` 的两阶段读取逻辑
- 移除 `buildProfileSummarySection` 中与 `buildLearningProgressSection` 重复的掌握度统计
- `slot_key` 增加 `^[a-z]+:[a-z0-9_-]+$` 格式校验
- `memory_items` 表增加 `(target, section, slot_key)` 唯一索引，防止并发写入重复记录
- 记忆系统触发条件补全 `/digest`，移除中间技能 `/read-pdf`

### 测试

- 新增 14 个测试用例覆盖 slot_key 同步、溯源链追加、UserProfile 画像统计和唯一索引约束

## 1.1.2 (2026-03-31)

### 问题修复

- 修复 `fullScan` 不清理已删除文件索引的问题：删除的文件在 `vault_index` 中残留，导致 `memory_query` 仍能检索到已不存在的文件
  - 在全量扫描后新增清理步骤，移除磁盘上已确认删除（ENOENT）的陈旧索引记录
  - 多层安全防护：校验 Vault 根目录可读且扫描前缀目录存在，区分文件删除（ENOENT）与访问错误（EACCES/EIO），避免在挂载点异常时误删有效索引

### 文档

- 将 README 默认语言改为中文，英文版移至 README.en.md
- CHANGELOG 全部改为中文描述

## 1.1.1 (2026-03-31)

### 问题修复

- 修复 `memory_auto_capture` 中的静默数据丢失：corrections、decisions、preferences 中嵌套的 `related_files` 字段因缺少 snake_case→camelCase 转换而被丢弃

### 重构

- 在 `core.ts` 中提取 `withResolvedDb` 和 `resolveScene` 辅助函数，消除 11 个工具处理器中重复的 DB 生命周期模板代码
- 在 `server.ts` 中提取泛型 `handleTool` 包装器并实现递归深层键名转换，替代 11 处手动 snake_case→camelCase 映射
- 将重复的 `refreshTaskboard`/`refreshUserprofile` 合并为配置驱动的 `refreshActiveDoc`；引用处理同理
- 移除 `retrieval.ts` 中的死代码分支和多余的 `hasCjk` 参数
- 移除 `utils/shared.ts` 中不必要的重导出
- 移除 `scanRecentlyModifiedFiles` 中未使用的 `_vaultRoot` 参数

### 内部

- 跨 7 个文件净减约 150 行代码，除上述 bug 修复外无行为变化

## 1.1.0 (2026-03-30)

### 新功能

- 新增 Windows 上 OpenCode GUI 的验证支持，与现有 macOS 上 Claude Code TUI、Codex TUI、OpenCode TUI 并列
- `lifeos init` 和 `lifeos upgrade` 不再强制创建或管理 Git 元数据；Git 由用户自行管理
- 更新 README 支持说明和发布流程，反映支持的运行时与客户端矩阵

### 内部

- 运行时基线升级至 Node.js 24.14.1+，刷新原生依赖栈，包括 `better-sqlite3` 12.8.0 和 `@types/node` 24.x
- 修补传递依赖 `path-to-regexp` 的审计问题，并新增依赖/工作流版本漂移回归测试
- 对齐 GitHub Actions CI 和发布工作流与支持的 Node.js 版本

## 1.0.3 (2026-03-30)

### 新功能

- 新增 `/digest` 技能，支持自定义主题信息周报
- `/digest` 现支持多语言周报生成，可配置论文来源、RSS 和 Web 搜索
- 扩展论文来源抓取，覆盖 `arXiv`、`bioRxiv`、`medRxiv`、`ChemRxiv`、`SocArXiv` 和 `SSRN`

## 1.0.0

- 首次发布：MCP 记忆服务器，包含 11 个工具
- Vault 索引与 FTS5 全文搜索
- 通过 @node-rs/jieba 实现中文分词
- 会话记忆与上下文组装
- 活跃文档（TaskBoard、UserProfile）
