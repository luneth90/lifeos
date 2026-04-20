# Layer0 Bootstrap 机制设计

## 背景

当前 LifeOS 的 Layer0 依赖一个隐式前提，Agent 需要先调用任意一个 LifeOS MCP 工具，server 才会自动执行 startup，并在首次工具返回中附带 `_layer0`。这个机制在服务端本身是成立的，但在协议层存在空窗期：

- Agent 在第一次调用 LifeOS 工具之前，可能已经开始读文件、跑 shell、扫描源码
- `ask` 等技能内部又把 `memory_query` 视为“按需查询”，容易让 Agent 误以为无需主动触发 Layer0
- 当 `_layer0` 中携带源码路径、行为约束、当前焦点时，Agent 可能在拿到这些信息前就做出错误决策

问题不在于 server 无法生成 `_layer0`，而在于“获取 `_layer0` 的入口不是显式能力，而是附着在任意工具首次调用上的副作用”。

## 目标

- 为 Agent 提供一个显式、轻量、语义清晰的 Layer0 入口
- 让“进入 LifeOS Vault 会话先拿 `_layer0`”成为硬约束，而不是经验约定
- 允许技能层安全兜底，不会因为重复调用而重复执行 startup
- 避免使用 `memory_query` 伪装 bootstrap，减少无意义查询噪声

## 非目标

- 不重写现有 startup 主流程
- 不改变 `memory_query`、`memory_log`、`memory_notify` 的业务语义
- 不在这次改动中扩展 Layer0 内容结构

## 方案概览

新增一个显式 MCP 工具 `memory_bootstrap`，只负责确保本会话已完成初始化，并返回当前应遵守的 `_layer0`。它是 Layer0 的唯一显式入口。

规则层改为要求 Agent 在进入任何 LifeOS Vault 会话时，第一步先调用 `memory_bootstrap`。技能层仍保留兜底，但兜底动作不再调用 `memory_query`，而是调用同一个 `memory_bootstrap`。由于 `memory_bootstrap` 在服务端是幂等的，所以规则层和技能层同时存在时也不会重复执行完整 startup。

## 接口设计

### 新增工具

工具名：`memory_bootstrap`

输入参数：

- `db_path`：可选，沿用现有自动解析逻辑
- `vault_root`：可选，沿用现有自动解析逻辑

输出语义：

- 返回一个极轻量状态对象，例如 `status`、`startup_ran`、`layer0_refreshed`
- 响应体中始终显式包含 `_layer0`
- 其他工具仍维持现有“首次工具返回带 `_layer0`”的兼容行为

设计原则：

- 不承担检索职责
- 不返回搜索结果
- 不引入额外上下文推断逻辑

## 服务端行为

### 1. 显式 bootstrap

`memory_bootstrap` 调用时：

- 若会话尚未 startup，则执行一次完整 startup
- 返回当前缓存或刷新后的 `_layer0`

### 2. 幂等保证

server 继续保留现有 `startedUp` 守卫：

- 同一 MCP server 进程内，完整 startup 只能执行一次
- 后续再次调用 `memory_bootstrap` 时，不再重复 full scan、active docs refresh、watcher 初始化

### 3. Layer0 脏标记

新增轻量状态位 `layer0Dirty`：

- 初始为 `false`
- 当 `memory_log` 成功写入规则后，设为 `true`
- 当 `memory_notify` 成功处理文件变更后，设为 `true`
- watcher 触发的自动 `memoryNotify` 成功后，也设为 `true`

### 4. 轻量刷新

当 `memory_bootstrap` 在已 startup 的会话中再次调用时：

- 若 `layer0Dirty = false`，直接返回缓存的 `_layer0`
- 若 `layer0Dirty = true`，只重建 `layer0_summary`
- 轻量刷新只调用 Layer0 摘要构建逻辑，不重复执行完整 startup
- 刷新完成后将 `layer0Dirty` 置回 `false`

这样可以保证：

- 规则层先调一次 `memory_bootstrap`
- 技能层再兜底调一次 `memory_bootstrap`

以上序列最多多一次轻量调用，不会多跑一次完整 startup。

## 与现有工具包装层的关系

现有 `handleTool()` 包装层已经负责：

- 首次工具调用前执行 `ensureStartup()`
- 在首次工具返回中附加 `_layer0`

这层逻辑保留，但职责调整为“兼容旧行为”，不再承担 Layer0 的唯一入口职责。

改动后建议行为：

- `memory_bootstrap` 是推荐且显式的入口，并且每次调用都显式返回 `_layer0`
- 其他工具仍可维持旧行为，避免破坏兼容性
- 如果 Agent 没有先调用 `memory_bootstrap`，首次调用其他工具仍能拿到 `_layer0`

也就是说，新机制是“显式优先，旧行为兼容保留”。

## 文档与协议修改

需要同步更新以下文档：

- `assets/lifeos-rules.zh.md`
- `assets/lifeos-rules.en.md`
- `assets/skills/_shared/memory-protocol.zh.md`
- `assets/skills/_shared/memory-protocol.en.md`
- 至少一个高频入口技能文档，例如 `assets/skills/ask/SKILL.zh.md` 与英文对应版本

文档方向：

- 明确规定进入 LifeOS Vault 会话时，第一步应调用 `memory_bootstrap`
- 明确技能兜底应复用 `memory_bootstrap`
- 不再建议用 `memory_query` 作为 startup 触发器

## 测试策略

### server 行为测试

新增或扩展以下测试：

- 首次调用 `memory_bootstrap` 会触发 `memoryStartup`
- 连续两次调用 `memory_bootstrap`，`memoryStartup` 只执行一次
- `memory_log` 后再次调用 `memory_bootstrap`，不会重跑 startup，但会触发 Layer0 轻量刷新
- `memory_notify` 后再次调用 `memory_bootstrap`，不会重跑 startup，但会触发 Layer0 轻量刷新

### 兼容性测试

- 首次调用 `memory_query` 时，仍然会附带 `_layer0`
- 若先调用 `memory_bootstrap`，后续 `memory_query` 不应再次附带首次启动语义

## 风险与权衡

### 优点

- Layer0 获取入口显式化，协议更清楚
- 技能兜底与规则层可以复用同一机制
- 避免 `memory_query` 造成的噪声和语义污染
- 兼容旧客户端和旧技能行为

### 代价

- server 需要维护一份额外的 `layer0Dirty` 状态
- 文档需要同步更新中英文多处副本
- 测试需要覆盖“首次启动”和“已启动后的轻量刷新”两条路径

## 实施顺序

1. 在 server 层新增 `memory_bootstrap` 和 `layer0Dirty`
2. 为 `memory_log`、`memory_notify`、watcher 自动通知补上脏标记
3. 增加 server 测试，验证幂等和轻量刷新
4. 更新规则与技能文档，切换到显式 bootstrap 说法
5. 最后人工验证一次：新会话先 `memory_bootstrap`，再执行 `memory_query`、`memory_log`、`memory_bootstrap`

## 结论

这次改动的核心不是新增一个“能启动”的工具，而是把 Layer0 从“首次任意工具调用的隐式副作用”收敛成“显式、幂等、可复用的会话入口”。只要 `memory_bootstrap` 成为唯一推荐入口，规则层和技能层就能协同工作，而不会重复加载完整 Layer0。
