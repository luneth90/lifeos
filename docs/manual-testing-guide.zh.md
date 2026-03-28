# LifeOS 手动测试指南

> 从零开始安装 LifeOS 并在 Claude Code 中实际操作全部 MCP 工具。
> 用于验证完整用户体验链路，区别于 `integration-test.md` 的 CLI 单元验证。

## 前置条件

- Node.js 18+
- Claude Code CLI 已安装（`claude` 命令可用）
- LifeOS 项目源码已 clone

---

## 1. 构建与本地注册

```bash
cd /path/to/lifeos          # 进入项目目录
npm install
npm run build
npm run typecheck            # 确认无类型错误
npm test                     # 确认测试通过
npm link                     # 全局注册 lifeos 命令
```

> **关键：** `npm link` 会将本地构建注册为全局包，之后 `lifeos` 命令会解析到本地构建产物。
> 这样 `lifeos init` 生成的 `.mcp.json`（默认使用 `lifeos --vault-root ...`）无需手动覆写即可直接工作。

**验证注册成功：**
```bash
lifeos --version             # 应输出 1.0.2
which lifeos                 # 应指向全局 node_modules 的 symlink
```

---

## 2. 初始化测试 Vault

```bash
lifeos init tmp/lifeos-manual-test --lang zh
```

**预期输出：**
- 10 个目录已创建（`00_草稿` ~ `90_系统`）
- 模板、规范、提示词、技能文件已复制
- `.claude/skills` → `.agents/skills` 符号链接已创建
- `.mcp.json`、`.codex/config.toml`、`opencode.json` 已注册
- Git 仓库已初始化

**验证：**
```bash
ls tmp/lifeos-manual-test/
cat tmp/lifeos-manual-test/lifeos.yaml
cat tmp/lifeos-manual-test/.mcp.json
ls -la tmp/lifeos-manual-test/.claude/skills   # 确认是 symlink
```

---

## 3. 启动 Claude Code

```bash
cd tmp/lifeos-manual-test
claude
```

启动后确认 MCP Server 已连接——在 Claude Code 会话中可看到 lifeos 工具可用。

---

## 4. MCP 工具逐项测试

以下测试在 Claude Code 会话中执行。每一步直接告诉 Claude 要调用的工具即可。

### 4.1 memory_startup — 启动会话

> 对 Claude 说：调用 memory_startup

**预期：**
- [ ] 返回 Layer 0 摘要（首次使用时内容较少）
- [ ] `tmp/lifeos-manual-test/memory.db` 已创建
- [ ] 无报错

### 4.2 memory_log — 记录事件

> 对 Claude 说：调用 memory_log，记录一条观察事件，内容为"测试手动记录功能"

**预期：**
- [ ] 返回成功，包含事件 ID
- [ ] 事件类型为 observation 或 discovery

### 4.3 memory_recent — 查询最近事件

> 对 Claude 说：调用 memory_recent，查看最近的会话日志

**预期：**
- [ ] 返回列表中包含 5.2 刚记录的事件
- [ ] 包含 memory_startup 产生的会话事件

### 4.4 memory_query — 搜索 Vault

先创建一个测试笔记用于搜索：

```bash
# 在另一个终端中执行
cat > tmp/lifeos-manual-test/00_草稿/测试笔记.md <<'EOF'
---
title: 量子计算入门笔记
type: note
status: draft
created: 2026-03-27
tags: [physics, quantum]
---

# 量子计算入门

量子比特是量子计算的基本单元。
EOF
```

> 对 Claude 说：调用 memory_notify 通知有文件变更，然后调用 memory_query 搜索"量子计算"

**预期：**
- [ ] memory_notify 成功触发重新扫描
- [ ] memory_query 返回结果中包含"测试笔记.md"
- [ ] 结果包含文件路径、标题、标签等元数据

### 4.5 memory_auto_capture — 批量捕获

> 对 Claude 说：调用 memory_auto_capture，记录一个偏好："用户喜欢使用中文界面"

**预期：**
- [ ] 返回成功，包含捕获的条目数量
- [ ] 条目类型为 preference

### 4.6 memory_refresh — 刷新活跃文档

> 对 Claude 说：调用 memory_refresh 刷新 TaskBoard

**预期：**
- [ ] 返回刷新结果
- [ ] 检查 vault 中 TaskBoard.md 的 AUTO 区块已更新：
  ```bash
  cat tmp/lifeos-manual-test/90_系统/记忆/TaskBoard.md
  ```

> 对 Claude 说：调用 memory_refresh 刷新 UserProfile

**预期：**
- [ ] UserProfile.md 的 AUTO 区块已更新：
  ```bash
  cat tmp/lifeos-manual-test/90_系统/记忆/UserProfile.md
  ```

### 4.7 memory_citations — 获取来源引用

> 对 Claude 说：调用 memory_citations，查询 TaskBoard 中某个条目的来源事件

**预期：**
- [ ] 返回关联的 session_log 事件列表
- [ ] 每条引用包含时间戳和原始内容

### 4.8 memory_skill_context — 技能上下文组装

> 对 Claude 说：调用 memory_skill_context，使用 seed profile "today"

**预期：**
- [ ] 返回组装后的上下文，包含与 today 技能相关的信息
- [ ] 包含 Layer 0 摘要、活跃文档摘要等

### 4.9 memory_skill_complete — 标记技能完成

> 对 Claude 说：调用 memory_skill_complete，标记 today 技能已完成

**预期：**
- [ ] 返回成功
- [ ] 该事件可通过 memory_recent 查询到

### 4.10 memory_checkpoint — 关闭会话

> 对 Claude 说：调用 memory_checkpoint

**预期：**
- [ ] 返回会话摘要
- [ ] 活跃文档已刷新
- [ ] enhance_queue 已处理

---

## 5. 技能触发测试

在 Claude Code 会话中直接使用斜杠命令触发技能：

| 命令 | 预期行为 |
|------|---------|
| `/today` | 生成今日计划，调用 memory_skill_context |
| `/ask 什么是量子纠缠` | 进入问答模式，可保存为草稿 |
| `/brainstorm 个人知识管理方案` | 引导式头脑风暴 |
| `/knowledge` | 创建知识笔记 |
| `/revise` | 复盘当前阶段工作 |

**验证：**
- [ ] 技能被正确识别和加载
- [ ] 技能执行中调用了相应的 MCP 工具
- [ ] 产出文件保存到正确的 vault 目录

---

## 6. 数据持久化验证

退出 Claude Code 后检查数据库状态：

```bash
# 检查数据库文件
ls -la tmp/lifeos-manual-test/memory.db

# 查看表结构
sqlite3 tmp/lifeos-manual-test/memory.db ".tables"

# 查看会话日志
sqlite3 tmp/lifeos-manual-test/memory.db "SELECT id, type, title, substr(body, 1, 60) FROM session_log ORDER BY created_at DESC LIMIT 10;"

# 查看 vault 索引
sqlite3 tmp/lifeos-manual-test/memory.db "SELECT path, title, type, status FROM vault_index LIMIT 10;"

# 查看活跃文档条目
sqlite3 tmp/lifeos-manual-test/memory.db "SELECT slot, key, substr(value, 1, 60) FROM memory_items LIMIT 10;"
```

**验证：**
- [ ] 所有表已创建（vault_index, session_log, memory_items 等）
- [ ] session_log 中包含测试过程中记录的事件
- [ ] vault_index 中包含测试笔记
- [ ] memory_items 中包含活跃文档数据

---

## 7. 重启后连续性

重新进入 Claude Code，验证数据跨会话保持：

```bash
cd tmp/lifeos-manual-test
claude
```

> 对 Claude 说：调用 memory_startup，然后调用 memory_recent

**验证：**
- [ ] Layer 0 摘要包含上一会话的信息
- [ ] memory_recent 能查到上一会话的事件

---

## 清理

```bash
rm -rf tmp/lifeos-manual-test
```

---

## 问题排查

| 问题 | 排查方法 |
|------|---------|
| MCP Server 未连接 | 检查 `.mcp.json` 路径是否正确；`node dist/server.js` 能否正常启动 |
| memory_startup 报错 | 检查 `lifeos.yaml` 是否存在且格式正确 |
| memory_query 无结果 | 先调用 `memory_notify` 触发扫描，确认 vault_index 有数据 |
| 技能未识别 | 检查 `.agents/skills/` 目录和 `CLAUDE.md` 技能表 |
| 数据库锁定 | 确保没有其他进程持有 memory.db（`lsof memory.db`） |
