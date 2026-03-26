# LifeOS 集成测试手册

> 本地手动验证 CLI 命令和 MCP Server 的端到端行为。
> 每次发版前或重大重构后执行。

## 前置条件

```bash
npm run build          # 编译 TypeScript → dist/
npm link               # 全局注册 lifeos 命令（可选，也可用 node bin/lifeos.js）
```

> **提示：** `npm link` 后可直接使用 `lifeos` 命令；不想全局安装则用 `node bin/lifeos.js` 替代下方所有 `lifeos` 调用。

---

## 1. init — 创建新 Vault

### 1.1 语言自动检测（不指定 --lang）

```bash
lifeos init /tmp/test-auto --no-mcp
```

**行为：** 通过 `Intl.DateTimeFormat().resolvedOptions().locale` 检测系统 locale：
- locale 以 `zh` 开头 → 创建中文 vault
- 其他（含 `en-US`、`en-GB` 等） → 创建英文 vault

> **跨平台：** `Intl` API 在 macOS/Linux/Windows 的 Node.js 18+ 上均可用，读取操作系统的区域设置。

**验证：**
```bash
# 先确认当前系统 locale
node -e "console.log(Intl.DateTimeFormat().resolvedOptions().locale)"

# 检查生成的 vault 语言
grep 'language:' /tmp/test-auto/lifeos.yaml
# 若系统 locale 为 zh-CN → language: zh，目录名为中文
# 若系统 locale 为 en-US → language: en，目录名为英文
ls /tmp/test-auto/
```

```bash
rm -rf /tmp/test-auto
```

### 1.2 中文 Vault（显式指定）

```bash
lifeos init /tmp/test-zh --lang zh --no-mcp
```

**验证：**
- [ ] 10 个顶级目录已创建（`00_草稿` ~ `90_系统`）
- [ ] 嵌套子目录已创建（`40_知识/笔记`、`40_知识/百科`、`90_系统/模板` 等）
- [ ] 复盘子目录已创建（`80_复盘/周复盘`、`月复盘` 等 6 个）
- [ ] `lifeos.yaml` 存在且 `subdirectories` 为嵌套格式
- [ ] 模板文件已复制到 `90_系统/模板/`（8 个 `.md` 文件）
- [ ] 规范文件已复制到 `90_系统/规范/`
- [ ] 技能文件已复制到 `.agents/skills/`（9 个技能目录）
- [ ] `CLAUDE.md` 已复制到根目录
- [ ] `.git` 和 `.gitignore` 已创建

```bash
cat /tmp/test-zh/lifeos.yaml                    # 确认嵌套 subdirectories
ls /tmp/test-zh/90_系统/模板/                    # 确认 8 个模板
ls /tmp/test-zh/.agents/skills/                  # 确认 9 个技能
```

### 1.3 英文 Vault

```bash
lifeos init /tmp/test-en --lang en --no-mcp
```

**验证：**
- [ ] 目录名为英文（`00_Drafts`、`10_Diary` 等）
- [ ] `lifeos.yaml` 中 `language: en`
- [ ] 模板和技能均为英文版

```bash
cat /tmp/test-en/lifeos.yaml
ls /tmp/test-en/90_System/Templates/
```

### 1.4 重复 init 应报错

```bash
lifeos init /tmp/test-zh    # 期望: Error "Vault already initialized"
```

---

## 2. doctor — 健康检查

### 2.1 健康 Vault

```bash
lifeos doctor /tmp/test-zh
```

**验证：**
- [ ] 所有检查项均为绿色 ✓
- [ ] 输出包含 `0 warnings, 0 failures`

### 2.2 缺失目录

```bash
rm -rf /tmp/test-zh/00_草稿
lifeos doctor /tmp/test-zh
```

**验证：**
- [ ] `directory: 00_草稿` 显示黄色 ⚠ warning
- [ ] 其余检查仍通过

```bash
mkdir /tmp/test-zh/00_草稿    # 恢复
```

### 2.3 无 lifeos.yaml

```bash
lifeos doctor /tmp/test-empty    # 不存在的目录
```

**验证：**
- [ ] `lifeos.yaml: not found` 显示红色 ✗ fail

---

## 3. upgrade — 资产升级

### 3.1 版本相同时跳过

```bash
lifeos upgrade /tmp/test-zh
```

**验证：**
- [ ] 输出 "Already up to date."

### 3.2 版本不同时升级

```bash
# 手动改低版本号触发升级
sed -i '' 's/assets: .*/assets: "0.9.0"/' /tmp/test-zh/lifeos.yaml
lifeos upgrade /tmp/test-zh
```

**验证：**
- [ ] 模板和规范已更新（Updated: N files）
- [ ] 技能文件未修改的标记为 Unchanged
- [ ] `lifeos.yaml` 中 `installed_versions.assets` 已更新为当前版本

```bash
grep 'assets:' /tmp/test-zh/lifeos.yaml    # 确认版本号已更新
```

### 3.3 用户修改的技能被保留

```bash
# 先改低版本号
sed -i '' 's/assets: .*/assets: "0.9.0"/' /tmp/test-zh/lifeos.yaml
# 修改一个技能文件
echo "用户自定义内容" > /tmp/test-zh/.agents/skills/knowledge/SKILL.md
lifeos upgrade /tmp/test-zh
```

**验证：**
- [ ] 输出 `⚠ Skipping modified: .agents/skills/knowledge/SKILL.md`
- [ ] 文件内容仍为 "用户自定义内容"

---

## 4. rename — 目录重命名

### 4.1 重命名顶级目录

```bash
lifeos rename /tmp/test-zh --logical drafts --name 00_Inbox
```

**验证：**
- [ ] 物理目录已重命名：`00_Inbox/` 存在，`00_草稿/` 不存在
- [ ] `lifeos.yaml` 中 `directories.drafts: 00_Inbox`
- [ ] 输出"重命名完成"

```bash
ls /tmp/test-zh/ | grep -E "00_"
grep 'drafts:' /tmp/test-zh/lifeos.yaml
```

### 4.2 Wikilink 批量替换

```bash
# 先恢复（重新 init 或手动改回）
lifeos rename /tmp/test-zh --logical drafts --name 00_草稿

# 创建含 wikilink 的测试文件
echo '参见 [[00_草稿/idea]] 和 [[00_草稿]]' > /tmp/test-zh/10_日记/test-link.md

lifeos rename /tmp/test-zh --logical drafts --name 00_Inbox
cat /tmp/test-zh/10_日记/test-link.md
```

**验证：**
- [ ] 文件内容变为 `参见 [[00_Inbox/idea]] 和 [[00_Inbox]]`
- [ ] 输出显示 `1 个 wikilinks 已更新`

```bash
rm /tmp/test-zh/10_日记/test-link.md    # 清理
```

### 4.3 错误处理

```bash
lifeos rename /tmp/test-zh --logical nonexistent --name foo
# 期望: Error "Unknown logical name"
```

---

## 5. MCP Server — 启动验证

### 5.1 基本启动

```bash
VAULT_ROOT=/tmp/test-zh node dist/server.js &
MCP_PID=$!
sleep 2

# 检查进程是否存活
kill -0 $MCP_PID 2>/dev/null && echo "✓ MCP server running" || echo "✗ Failed to start"

# 停止
kill $MCP_PID
```

### 5.2 Claude Desktop 集成

```bash
# 创建带 MCP 注册的 vault（需要已安装 Claude Desktop）
lifeos init /tmp/test-mcp --lang zh
```

**验证：**
- [ ] 输出包含 `Claude Desktop →` 注册信息
- [ ] `~/Library/Application Support/Claude/claude_desktop_config.json` 中包含 lifeos 条目

---

## 6. 其他命令

```bash
lifeos help           # 显示帮助信息
lifeos --version      # 显示版本号 (1.0.0)
lifeos --help         # 同 help
lifeos unknown        # 显示 "Unknown command" 错误
```

---

## 清理

```bash
rm -rf /tmp/test-auto /tmp/test-zh /tmp/test-en /tmp/test-mcp /tmp/test-empty
npm unlink -g lifeos    # 移除全局链接（如果使用了 npm link）
```

---

## 快速验证脚本

完整验证的最小命令序列：

```bash
npm run build && npm run typecheck && npm test

# CLI 快速冒烟测试
node bin/lifeos.js init /tmp/smoke-zh --lang zh --no-mcp
node bin/lifeos.js doctor /tmp/smoke-zh
node bin/lifeos.js rename /tmp/smoke-zh --logical drafts --name 00_Inbox
grep 'drafts: 00_Inbox' /tmp/smoke-zh/lifeos.yaml && echo "✓ rename OK"
node bin/lifeos.js --version
rm -rf /tmp/smoke-zh
```
