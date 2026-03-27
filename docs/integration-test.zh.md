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
lifeos init tmp/test-auto --no-mcp
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
grep 'language:' tmp/test-auto/lifeos.yaml
# 若系统 locale 为 zh-CN → language: zh，目录名为中文
# 若系统 locale 为 en-US → language: en，目录名为英文
ls tmp/test-auto/
```

```bash
rm -rf tmp/test-auto
```

### 1.2 中文 Vault（显式指定）

```bash
lifeos init tmp/test-zh --lang zh --no-mcp
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
- [ ] `AGENTS.md` 已复制到根目录
- [ ] `.git` 和 `.gitignore` 已创建

```bash
cat tmp/test-zh/lifeos.yaml                    # 确认嵌套 subdirectories
ls tmp/test-zh/90_系统/模板/                    # 确认 8 个模板
ls tmp/test-zh/.agents/skills/                  # 确认 9 个技能
```

### 1.3 英文 Vault

```bash
lifeos init tmp/test-en --lang en --no-mcp
```

**验证：**
- [ ] 目录名为英文（`00_Drafts`、`10_Diary` 等）
- [ ] `lifeos.yaml` 中 `language: en`
- [ ] 模板和技能均为英文版
- [ ] `CLAUDE.md` 和 `AGENTS.md` 均为英文版

```bash
cat tmp/test-en/lifeos.yaml
ls tmp/test-en/90_System/Templates/
```

### 1.4 重复 init 应报错

```bash
lifeos init tmp/test-zh    # 期望: Error "Vault already initialized"
```

---

## 2. doctor — 健康检查

### 2.1 健康 Vault

```bash
lifeos doctor tmp/test-zh
```

**验证：**
- [ ] 所有检查项均为绿色 ✓
- [ ] 输出包含 `0 warnings, 0 failures`

### 2.2 缺失目录

```bash
rm -rf tmp/test-zh/00_草稿
lifeos doctor tmp/test-zh
```

**验证：**
- [ ] `directory: 00_草稿` 显示黄色 ⚠ warning
- [ ] 其余检查仍通过

```bash
mkdir tmp/test-zh/00_草稿    # 恢复
```

### 2.3 无 lifeos.yaml

```bash
lifeos doctor tmp/test-empty    # 不存在的目录
```

**验证：**
- [ ] `lifeos.yaml: not found` 显示红色 ✗ fail

---

## 3. upgrade — 资产升级

### 3.1 版本相同时跳过

```bash
lifeos upgrade tmp/test-zh
```

**验证：**
- [ ] 输出 "Already up to date."

### 3.2 版本不同时升级

```bash
# 手动改低版本号触发升级
sed -i '' 's/assets: .*/assets: "0.9.0"/' tmp/test-zh/lifeos.yaml
lifeos upgrade tmp/test-zh
```

**验证：**
- [ ] 模板和规范已更新（Updated: N files）
- [ ] 技能文件未修改的标记为 Unchanged
- [ ] `lifeos.yaml` 中 `installed_versions.assets` 已更新为当前版本

```bash
grep 'assets:' tmp/test-zh/lifeos.yaml    # 确认版本号已更新
```

### 3.3 用户修改的技能被保留

```bash
# 先改低版本号
sed -i '' 's/assets: .*/assets: "0.9.0"/' tmp/test-zh/lifeos.yaml
# 修改一个技能文件
echo "用户自定义内容" > tmp/test-zh/.agents/skills/knowledge/SKILL.md
lifeos upgrade tmp/test-zh
```

**验证：**
- [ ] 输出 `⚠ Skipping modified: .agents/skills/knowledge/SKILL.md`
- [ ] 文件内容仍为 "用户自定义内容"

---

## 4. rename — 目录重命名

### 4.1 重命名顶级目录

```bash
lifeos rename tmp/test-zh --logical drafts --name 00_Inbox
```

**验证：**
- [ ] 物理目录已重命名：`00_Inbox/` 存在，`00_草稿/` 不存在
- [ ] `lifeos.yaml` 中 `directories.drafts: 00_Inbox`
- [ ] 输出"重命名完成"

```bash
ls tmp/test-zh/ | grep -E "00_"
grep 'drafts:' tmp/test-zh/lifeos.yaml
```

### 4.2 Wikilink 批量替换

```bash
# 先恢复（重新 init 或手动改回）
lifeos rename tmp/test-zh --logical drafts --name 00_草稿

# 创建含 wikilink 的测试文件
echo '参见 [[00_草稿/idea]] 和 [[00_草稿]]' > tmp/test-zh/10_日记/test-link.md

lifeos rename tmp/test-zh --logical drafts --name 00_Inbox
cat tmp/test-zh/10_日记/test-link.md
```

**验证：**
- [ ] 文件内容变为 `参见 [[00_Inbox/idea]] 和 [[00_Inbox]]`
- [ ] 输出显示 `1 个 wikilinks 已更新`

```bash
rm tmp/test-zh/10_日记/test-link.md    # 清理
```

### 4.3 错误处理

```bash
lifeos rename tmp/test-zh --logical nonexistent --name foo
# 期望: Error "Unknown logical name"
```

---

## 5. MCP Server — 启动验证

### 5.1 基本启动

```bash
LIFEOS_VAULT_ROOT=tmp/test-zh node dist/server.js &
MCP_PID=$!
sleep 2

# 检查进程是否存活
kill -0 $MCP_PID 2>/dev/null && echo "✓ MCP server running" || echo "✗ Failed to start"

# 停止
kill $MCP_PID
```

### 5.2 CLI 工具集成（Claude Code / Codex / OpenCode）

#### 5.2.1 配置文件生成

```bash
lifeos init tmp/test-mcp --lang zh
```

**验证：**
- [ ] 输出包含 `Claude Code →`、`Codex →`、`OpenCode →` 三条注册信息
- [ ] `.mcp.json` 存在且包含 `mcpServers.lifeos`
- [ ] `.codex/config.toml` 存在且包含 `[mcp_servers.lifeos]`
- [ ] `opencode.json` 存在且包含 `mcp.lifeos`

```bash
cat tmp/test-mcp/.mcp.json
cat tmp/test-mcp/.codex/config.toml
cat tmp/test-mcp/opencode.json
```

#### 5.2.2 实际连通性测试

> **注意：** `lifeos init` 注册的是 `npx -y lifeos`，未发布到 npm 时无法连通。
> 下面用本地路径覆写配置来验证各 CLI 能否真正连接 MCP Server。

```bash
LIFEOS_DIR="$(cd "$(dirname "$0")/../.." && pwd)"    # 调整为实际项目路径

# 覆写为本地路径
cat > tmp/test-mcp/.mcp.json <<EOF
{
  "mcpServers": {
    "lifeos": {
      "command": "node",
      "args": ["$LIFEOS_DIR/dist/server.js", "--vault-root", "tmp/test-mcp"]
    }
  }
}
EOF

cat > tmp/test-mcp/.codex/config.toml <<EOF
[mcp_servers.lifeos]
command = "node"
args = ["$LIFEOS_DIR/dist/server.js", "--vault-root", "tmp/test-mcp"]
EOF

cat > tmp/test-mcp/opencode.json <<EOF
{
  "mcp": {
    "lifeos": {
      "type": "local",
      "command": ["node", "$LIFEOS_DIR/dist/server.js", "--vault-root", "tmp/test-mcp"]
    }
  }
}
EOF
```

**Claude Code：**
```bash
cd tmp/test-mcp && claude mcp list
```
- [ ] 输出 `lifeos: ... ✓ Connected`

**Codex：**
```bash
cd tmp/test-mcp && codex mcp list
```
- [ ] 输出包含 `lifeos` 条目且 status 为 `enabled`

> **已知限制：** Codex `mcp list` 仅读取全局 `~/.codex/config.toml`，项目级 `.codex/config.toml` 需要 trusted project 才会生效。可用 `-c` 覆盖验证格式正确性：
> ```bash
> codex mcp list -c 'mcp_servers.lifeos.command="node"' \
>   -c "mcp_servers.lifeos.args=[\"$LIFEOS_DIR/dist/server.js\"]"
> ```

**OpenCode：**
```bash
cd tmp/test-mcp && opencode mcp list
```
- [ ] 输出 `✓ lifeos connected`

---

## 6. 其他命令

```bash
lifeos help           # 显示帮助信息
lifeos --version      # 显示版本号 (1.0.0)
lifeos --help         # 同 help
lifeos unknown        # 显示 "Unknown command" 错误
```

---

## 7. 资产启用验证 — 技能、模板、CLAUDE.md、AGENTS.md

> 验证 `lifeos init` 生成的资产不仅存在，而且能被各 AI 编码工具**真正识别和加载**。
> 本节所有测试均可由 agent 自动化执行。

### 前置：使用 5.2.2 中覆写为本地路径的 `tmp/test-mcp` vault。

---

### 7.1 结构验证（无需外部工具）

#### 7.1.1 技能结构

```bash
# 确认 9 个技能目录
test $(ls -d tmp/test-mcp/.agents/skills/*/ | wc -l) -eq 9 && echo "✓ 9 skills" || echo "✗ skill count mismatch"

# 每个技能目录都有 SKILL.md
for skill in tmp/test-mcp/.agents/skills/*/; do
  name=$(basename "$skill")
  if [ -f "$skill/SKILL.md" ]; then
    echo "✓ $name/SKILL.md exists"
  else
    echo "✗ $name/SKILL.md missing"
  fi
done
```

**验证：**
- [ ] 9 个技能目录：ask, archive, brainstorm, knowledge, project, read-pdf, research, review, today
- [ ] 每个目录下都有 `SKILL.md`

#### 7.1.2 技能 frontmatter 有效性

```bash
# 检查每个 SKILL.md 的 YAML frontmatter 包含必需字段
for skill in tmp/test-mcp/.agents/skills/*/SKILL.md; do
  name=$(basename "$(dirname "$skill")")
  # 提取 frontmatter（两个 --- 之间的内容）
  fm=$(sed -n '/^---$/,/^---$/p' "$skill" | head -20)
  has_name=$(echo "$fm" | grep -c '^name:')
  has_desc=$(echo "$fm" | grep -c '^description:')
  has_ver=$(echo "$fm" | grep -c '^version:')
  if [ "$has_name" -ge 1 ] && [ "$has_desc" -ge 1 ] && [ "$has_ver" -ge 1 ]; then
    echo "✓ $name: frontmatter valid (name, description, version)"
  else
    echo "✗ $name: frontmatter missing fields (name=$has_name desc=$has_desc ver=$has_ver)"
  fi
done
```

**验证：**
- [ ] 所有 9 个技能的 frontmatter 都包含 `name`、`description`、`version` 字段

#### 7.1.3 技能引用交叉验证

```bash
# CLAUDE.md 技能表中列出的技能 ↔ 实际技能目录
# 注意：read-pdf 只通过 MCP 触发，不在 CLAUDE.md 技能表中
CLAUDE_SKILLS=$(grep -oP '(?<=`/)\w+(?=`)' tmp/test-mcp/CLAUDE.md | sort -u)
DIR_SKILLS=$(ls tmp/test-mcp/.agents/skills/ | sort)

echo "CLAUDE.md 中引用的技能："
echo "$CLAUDE_SKILLS"
echo ""
echo "实际技能目录："
echo "$DIR_SKILLS"
echo ""

# 检查 CLAUDE.md 中每个技能是否有对应目录
for s in $CLAUDE_SKILLS; do
  if [ -d "tmp/test-mcp/.agents/skills/$s" ]; then
    echo "✓ /$s → .agents/skills/$s/"
  else
    echo "✗ /$s 在 CLAUDE.md 中引用但目录不存在"
  fi
done
```

**验证：**
- [ ] CLAUDE.md 技能表中的 8 个技能（today, project, research, ask, brainstorm, knowledge, review, archive）都有对应的 `.agents/skills/` 目录
- [ ] `read-pdf` 目录存在但不在技能表中（仅通过 MCP 触发，属于正常情况）

#### 7.1.4 模板结构验证

```bash
LANG=$(grep 'language:' tmp/test-mcp/lifeos.yaml | awk '{print $2}')

# 确认 8 个模板文件
TPL_DIR=$([ "$LANG" = "en" ] && echo "90_System/Templates" || echo "90_系统/模板")
TPL_COUNT=$(ls tmp/test-mcp/$TPL_DIR/*.md 2>/dev/null | wc -l)
test "$TPL_COUNT" -eq 8 && echo "✓ 8 templates" || echo "✗ template count: $TPL_COUNT"

# 每个模板有 frontmatter 且包含 title 和 type
for tpl in tmp/test-mcp/$TPL_DIR/*.md; do
  name=$(basename "$tpl")
  fm=$(sed -n '/^---$/,/^---$/p' "$tpl" | head -10)
  has_title=$(echo "$fm" | grep -c 'title:')
  has_type=$(echo "$fm" | grep -c 'type:')
  if [ "$has_title" -ge 1 ] && [ "$has_type" -ge 1 ]; then
    echo "✓ $name: frontmatter valid"
  else
    echo "✗ $name: missing title=$has_title type=$has_type"
  fi
done
```

**验证：**
- [ ] 8 个模板文件存在
- [ ] 每个模板的 frontmatter 包含 `title` 和 `type`

#### 7.1.5 模板路由交叉验证

```bash
# CLAUDE.md 模板路由表中的模板名 ↔ 实际模板文件
CLAUDE_TEMPLATES=$(grep -oP '\w+_Template\.md' tmp/test-mcp/CLAUDE.md | sort -u)
ACTUAL_TEMPLATES=$(ls tmp/test-mcp/$TPL_DIR/*.md | xargs -I{} basename {} | sort)

for t in $CLAUDE_TEMPLATES; do
  if echo "$ACTUAL_TEMPLATES" | grep -q "^${t}$"; then
    echo "✓ $t"
  else
    echo "✗ $t 在 CLAUDE.md 路由表中但文件不存在"
  fi
done
```

**验证：**
- [ ] CLAUDE.md 模板路由表中的 8 个模板名与实际文件一一对应

#### 7.1.6 CLAUDE.md 与 AGENTS.md 一致性

```bash
# AGENTS.md 应与 CLAUDE.md 内容一致
if diff -q tmp/test-mcp/CLAUDE.md tmp/test-mcp/AGENTS.md > /dev/null 2>&1; then
  echo "✓ CLAUDE.md 和 AGENTS.md 内容一致"
else
  echo "✗ CLAUDE.md 和 AGENTS.md 内容不一致"
  diff tmp/test-mcp/CLAUDE.md tmp/test-mcp/AGENTS.md | head -20
fi
```

**验证：**
- [ ] `CLAUDE.md` 和 `AGENTS.md` 内容完全一致

#### 7.1.7 Frontmatter Schema 覆盖验证

```bash
SCHEMA_DIR=$([ "$LANG" = "en" ] && echo "90_System/Schema" || echo "90_系统/规范")
SCHEMA_FILE="tmp/test-mcp/$SCHEMA_DIR/Frontmatter_Schema.md"

# 提取 Schema 中定义的 type 枚举
SCHEMA_TYPES=$(grep -oP '(?<=`)\w+(?=`)' "$SCHEMA_FILE" | head -20)
echo "Schema 定义的 type: $SCHEMA_TYPES"

# 提取所有模板中使用的 type 值
for tpl in tmp/test-mcp/$TPL_DIR/*.md; do
  name=$(basename "$tpl")
  ttype=$(sed -n '/^---$/,/^---$/p' "$tpl" | grep '^type:' | awk '{print $2}')
  echo "  $name → type: $ttype"
done
```

**验证：**
- [ ] 所有模板中的 `type` 值都在 Frontmatter_Schema.md 的枚举范围内

---

### 7.2 CLI 识别验证（需要安装对应工具）

> 以下测试需要对应的 CLI 工具已安装。跳过未安装的工具。

#### 7.2.1 Claude Code

```bash
cd tmp/test-mcp

# 验证 MCP Server 连接
claude mcp list
```

**验证：**
- [ ] 输出包含 `lifeos: ... connected`（或类似的连接成功标识）
- [ ] Claude Code 会自动加载 vault 根目录的 `CLAUDE.md` 和 `.agents/skills/`

#### 7.2.2 Codex

```bash
cd tmp/test-mcp
LIFEOS_DIR="$(cd "$(dirname "$0")/../.." && pwd)"    # 调整为实际项目路径

# Codex 项目级配置需要 -c 覆盖验证
codex mcp list \
  -c 'mcp_servers.lifeos.command="node"' \
  -c "mcp_servers.lifeos.args=[\"$LIFEOS_DIR/dist/server.js\"]"
```

**验证：**
- [ ] 输出包含 `lifeos` 条目
- [ ] Codex 会自动加载 vault 根目录的 `AGENTS.md`

> **已知限制：** Codex `mcp list` 读取全局 `~/.codex/config.toml`，项目级 `.codex/config.toml` 需要 trusted project 才生效，因此必须用 `-c` 参数覆盖测试。

#### 7.2.3 OpenCode

```bash
cd tmp/test-mcp && opencode mcp list
```

**验证：**
- [ ] 输出包含 `lifeos` 且状态为 connected
- [ ] OpenCode 会自动加载 vault 根目录的 `AGENTS.md`

---

### 7.3 功能冒烟测试（端到端 MCP 调用）

> 通过 JSON-RPC over stdio 直接与 MCP Server 交互，验证完整链路可用。

#### 7.3.1 MCP 协议握手

```bash
LIFEOS_DIR="$(cd "$(dirname "$0")/../.." && pwd)"    # 调整为实际项目路径

# 发送 initialize + tools/list 请求
{
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"integration-test","version":"0.1"}}}'
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
} | LIFEOS_VAULT_ROOT=tmp/test-mcp node "$LIFEOS_DIR/dist/server.js" 2>/dev/null | head -5
```

**验证：**
- [ ] 第一条响应包含 `"result"` 和 `"serverInfo"`（initialize 成功）
- [ ] 第二条响应包含 `"tools"` 数组，列出 LifeOS 提供的所有 MCP 工具

#### 7.3.2 调用 memory_startup 工具

```bash
{
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"integration-test","version":"0.1"}}}'
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"memory_startup","arguments":{}}}'
} | LIFEOS_VAULT_ROOT=tmp/test-mcp node "$LIFEOS_DIR/dist/server.js" 2>/dev/null | head -10
```

**验证：**
- [ ] 响应包含 `"result"` 和 `"content"`（工具调用成功）
- [ ] 不包含 `"error"`
- [ ] 返回内容包含 Layer 0 摘要或空 vault 提示

#### 7.3.3 通过 CLI 工具调用（可选）

如果 CLI 工具已安装，可进一步验证通过 CLI 间接调用 MCP 工具：

**Claude Code：**
```bash
cd tmp/test-mcp
# 在 Claude Code 会话中触发 memory_startup（交互式，需人工观察）
claude "调用 memory_startup 工具"
```

**Codex：**
```bash
cd tmp/test-mcp
codex "调用 memory_startup 工具"
```

- [ ] Agent 成功调用 `memory_startup` 并返回结果
- [ ] Agent 能识别 CLAUDE.md / AGENTS.md 中定义的技能和规则

---

## 清理

```bash
rm -rf tmp/test-auto tmp/test-zh tmp/test-en tmp/test-mcp tmp/test-empty tmp/test-chain
npm unlink -g lifeos    # 移除全局链接（如果使用了 npm link）
```

---

## 快速验证脚本

完整验证的最小命令序列：

```bash
npm run build && npm run typecheck && npm test

# CLI 快速冒烟测试
node bin/lifeos.js init tmp/smoke-zh --lang zh --no-mcp
node bin/lifeos.js doctor tmp/smoke-zh
node bin/lifeos.js rename tmp/smoke-zh --logical drafts --name 00_Inbox
grep 'drafts: 00_Inbox' tmp/smoke-zh/lifeos.yaml && echo "✓ rename OK"
test -f tmp/smoke-zh/AGENTS.md && echo "✓ AGENTS.md OK" || echo "✗ AGENTS.md missing"
diff -q tmp/smoke-zh/CLAUDE.md tmp/smoke-zh/AGENTS.md && echo "✓ CLAUDE=AGENTS OK"
node bin/lifeos.js --version
rm -rf tmp/smoke-zh
```
