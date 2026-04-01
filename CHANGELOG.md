# 更新日志

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
