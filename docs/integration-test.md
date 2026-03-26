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
- [ ] `AGENTS.md` 已复制到根目录
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
- [ ] `CLAUDE.md` 和 `AGENTS.md` 均为英文版

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
LIFEOS_VAULT_ROOT=/tmp/test-zh node dist/server.js &
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
lifeos init /tmp/test-mcp --lang zh
```

**验证：**
- [ ] 输出包含 `Claude Code →`、`Codex →`、`OpenCode →` 三条注册信息
- [ ] `.mcp.json` 存在且包含 `mcpServers.lifeos`
- [ ] `.codex/config.toml` 存在且包含 `[mcp_servers.lifeos]`
- [ ] `opencode.json` 存在且包含 `mcp.lifeos`

```bash
cat /tmp/test-mcp/.mcp.json
cat /tmp/test-mcp/.codex/config.toml
cat /tmp/test-mcp/opencode.json
```

#### 5.2.2 实际连通性测试

> **注意：** `lifeos init` 注册的是 `npx -y lifeos`，未发布到 npm 时无法连通。
> 下面用本地路径覆写配置来验证各 CLI 能否真正连接 MCP Server。

```bash
LIFEOS_DIR="$(cd "$(dirname "$0")/../.." && pwd)"    # 调整为实际项目路径

# 覆写为本地路径
cat > /tmp/test-mcp/.mcp.json <<EOF
{
  "mcpServers": {
    "lifeos": {
      "command": "node",
      "args": ["$LIFEOS_DIR/dist/server.js", "--vault-root", "/tmp/test-mcp"]
    }
  }
}
EOF

cat > /tmp/test-mcp/.codex/config.toml <<EOF
[mcp_servers.lifeos]
command = "node"
args = ["$LIFEOS_DIR/dist/server.js", "--vault-root", "/tmp/test-mcp"]
EOF

cat > /tmp/test-mcp/opencode.json <<EOF
{
  "mcp": {
    "lifeos": {
      "type": "local",
      "command": ["node", "$LIFEOS_DIR/dist/server.js", "--vault-root", "/tmp/test-mcp"]
    }
  }
}
EOF
```

**Claude Code：**
```bash
cd /tmp/test-mcp && claude mcp list
```
- [ ] 输出 `lifeos: ... ✓ Connected`

**Codex：**
```bash
cd /tmp/test-mcp && codex mcp list
```
- [ ] 输出包含 `lifeos` 条目且 status 为 `enabled`

> **已知限制：** Codex `mcp list` 仅读取全局 `~/.codex/config.toml`，项目级 `.codex/config.toml` 需要 trusted project 才会生效。可用 `-c` 覆盖验证格式正确性：
> ```bash
> codex mcp list -c 'mcp_servers.lifeos.command="node"' \
>   -c "mcp_servers.lifeos.args=[\"$LIFEOS_DIR/dist/server.js\"]"
> ```

**OpenCode：**
```bash
cd /tmp/test-mcp && opencode mcp list
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

### 前置：使用 5.2.2 中覆写为本地路径的 `/tmp/test-mcp` vault。

---

### 7.1 结构验证（无需外部工具）

#### 7.1.1 技能结构

```bash
# 确认 9 个技能目录
test $(ls -d /tmp/test-mcp/.agents/skills/*/ | wc -l) -eq 9 && echo "✓ 9 skills" || echo "✗ skill count mismatch"

# 每个技能目录都有 SKILL.md
for skill in /tmp/test-mcp/.agents/skills/*/; do
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
for skill in /tmp/test-mcp/.agents/skills/*/SKILL.md; do
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
CLAUDE_SKILLS=$(grep -oP '(?<=`/)\w+(?=`)' /tmp/test-mcp/CLAUDE.md | sort -u)
DIR_SKILLS=$(ls /tmp/test-mcp/.agents/skills/ | sort)

echo "CLAUDE.md 中引用的技能："
echo "$CLAUDE_SKILLS"
echo ""
echo "实际技能目录："
echo "$DIR_SKILLS"
echo ""

# 检查 CLAUDE.md 中每个技能是否有对应目录
for s in $CLAUDE_SKILLS; do
  if [ -d "/tmp/test-mcp/.agents/skills/$s" ]; then
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
LANG=$(grep 'language:' /tmp/test-mcp/lifeos.yaml | awk '{print $2}')

# 确认 8 个模板文件
TPL_DIR=$([ "$LANG" = "en" ] && echo "90_System/Templates" || echo "90_系统/模板")
TPL_COUNT=$(ls /tmp/test-mcp/$TPL_DIR/*.md 2>/dev/null | wc -l)
test "$TPL_COUNT" -eq 8 && echo "✓ 8 templates" || echo "✗ template count: $TPL_COUNT"

# 每个模板有 frontmatter 且包含 title 和 type
for tpl in /tmp/test-mcp/$TPL_DIR/*.md; do
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
CLAUDE_TEMPLATES=$(grep -oP '\w+_Template\.md' /tmp/test-mcp/CLAUDE.md | sort -u)
ACTUAL_TEMPLATES=$(ls /tmp/test-mcp/$TPL_DIR/*.md | xargs -I{} basename {} | sort)

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
if diff -q /tmp/test-mcp/CLAUDE.md /tmp/test-mcp/AGENTS.md > /dev/null 2>&1; then
  echo "✓ CLAUDE.md 和 AGENTS.md 内容一致"
else
  echo "✗ CLAUDE.md 和 AGENTS.md 内容不一致"
  diff /tmp/test-mcp/CLAUDE.md /tmp/test-mcp/AGENTS.md | head -20
fi
```

**验证：**
- [ ] `CLAUDE.md` 和 `AGENTS.md` 内容完全一致

#### 7.1.7 Frontmatter Schema 覆盖验证

```bash
SCHEMA_DIR=$([ "$LANG" = "en" ] && echo "90_System/Schema" || echo "90_系统/规范")
SCHEMA_FILE="/tmp/test-mcp/$SCHEMA_DIR/Frontmatter_Schema.md"

# 提取 Schema 中定义的 type 枚举
SCHEMA_TYPES=$(grep -oP '(?<=`)\w+(?=`)' "$SCHEMA_FILE" | head -20)
echo "Schema 定义的 type: $SCHEMA_TYPES"

# 提取所有模板中使用的 type 值
for tpl in /tmp/test-mcp/$TPL_DIR/*.md; do
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
cd /tmp/test-mcp

# 验证 MCP Server 连接
claude mcp list
```

**验证：**
- [ ] 输出包含 `lifeos: ... connected`（或类似的连接成功标识）
- [ ] Claude Code 会自动加载 vault 根目录的 `CLAUDE.md` 和 `.agents/skills/`

#### 7.2.2 Codex

```bash
cd /tmp/test-mcp
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
cd /tmp/test-mcp && opencode mcp list
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
} | LIFEOS_VAULT_ROOT=/tmp/test-mcp node "$LIFEOS_DIR/dist/server.js" 2>/dev/null | head -5
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
} | LIFEOS_VAULT_ROOT=/tmp/test-mcp node "$LIFEOS_DIR/dist/server.js" 2>/dev/null | head -10
```

**验证：**
- [ ] 响应包含 `"result"` 和 `"content"`（工具调用成功）
- [ ] 不包含 `"error"`
- [ ] 返回内容包含 Layer 0 摘要或空 vault 提示

#### 7.3.3 通过 CLI 工具调用（可选）

如果 CLI 工具已安装，可进一步验证通过 CLI 间接调用 MCP 工具：

**Claude Code：**
```bash
cd /tmp/test-mcp
# 在 Claude Code 会话中触发 memory_startup（交互式，需人工观察）
claude "调用 memory_startup 工具"
```

**Codex：**
```bash
cd /tmp/test-mcp
codex "调用 memory_startup 工具"
```

- [ ] Agent 成功调用 `memory_startup` 并返回结果
- [ ] Agent 能识别 CLAUDE.md / AGENTS.md 中定义的技能和规则

---

## 8. 技能功能验证 — 9 个技能产出正确性（自动化）

> 通过 `claude -p` 非交互模式自动执行每个技能，然后用脚本验证 vault 中的文件产出和 frontmatter。
> 每个技能独立测试，8.10 为完整依赖链集成测试。

### 前置条件

1. 使用 5.2.2 中覆写为本地路径的 `/tmp/test-mcp` vault，MCP 已连通
2. `claude` CLI 已安装（`claude --version`）
3. 已授权 MCP 工具和文件操作权限（首次运行需确认）

```bash
VAULT="/tmp/test-mcp"
TODAY=$(date +%Y-%m-%d)
YEAR=$(date +%Y)
MONTH=$(date +%m)

# 确认 MCP 连通
cd "$VAULT" && claude mcp list 2>&1 | grep -q "lifeos" && echo "✓ MCP ready" || echo "✗ MCP not connected"
```

### 辅助验证函数

将以下函数粘贴到 shell 中，后续所有测试复用：

```bash
VAULT="/tmp/test-mcp"
TODAY=$(date +%Y-%m-%d)
YEAR=$(date +%Y)
MONTH=$(date +%m)
PASS=0; FAIL=0

pass() { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

# 按 glob 查找文件，返回第一个匹配
find_file() { find "$VAULT" -path "$1" -type f 2>/dev/null | head -1; }

# 断言：文件存在
assert_exists() {
  local pattern="$1" desc="$2"
  local f=$(find_file "$pattern")
  if [ -n "$f" ]; then pass "$desc → $(basename "$f")"; echo "$f"
  else fail "$desc (no match: $pattern)"; fi
}

# 断言：文件不存在
assert_not_exists() {
  local pattern="$1" desc="$2"
  local f=$(find_file "$pattern")
  [ -z "$f" ] && pass "$desc" || fail "$desc (found: $f)"
}

# 断言：frontmatter 字段值
assert_fm() {
  local file="$1" key="$2" expected="$3"
  [ ! -f "$file" ] && { fail "FM $key: file not found"; return; }
  local val=$(awk "/^---$/{n++; next} n==1 && /^${key}:/{
    sub(/^${key}:[[:space:]]*/,\"\"); gsub(/[\"\x27]/,\"\"); print; exit
  }" "$file")
  [ "$val" = "$expected" ] && pass "FM $key: $expected" || fail "FM $key: expected '$expected', got '$val'"
}

# 断言：frontmatter 字段存在（不检查具体值）
assert_fm_exists() {
  local file="$1" key="$2"
  [ ! -f "$file" ] && { fail "FM $key: file not found"; return; }
  awk "/^---$/{n++; next} n==1 && /^${key}:/{found=1; exit} END{exit !found}" "$file" \
    && pass "FM $key: present" || fail "FM $key: missing"
}

# 断言：frontmatter 通用规则 [FM]
assert_fm_valid() {
  local file="$1"
  [ ! -f "$file" ] && { fail "[FM] file not found"; return; }
  # 以 --- 开头
  head -1 "$file" | grep -q '^---$' && pass "[FM] starts with ---" || fail "[FM] missing opening ---"
  # created 格式
  assert_fm_exists "$file" "created"
  local created=$(awk '/^---$/{n++; next} n==1 && /^created:/{
    sub(/^created:[[:space:]]*/,""); gsub(/["'"'"']/,""); print; exit
  }' "$file")
  echo "$created" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' \
    && pass "[FM] created format: $created" || fail "[FM] created format invalid: $created"
  # type 属于枚举
  local ftype=$(awk '/^---$/{n++; next} n==1 && /^type:/{
    sub(/^type:[[:space:]]*/,""); gsub(/["'"'"']/,""); print; exit
  }' "$file")
  echo "$ftype" | grep -qE '^(project|project-doc|knowledge|wiki|draft|note|research|review|content|system|review-record)$' \
    && pass "[FM] type: $ftype" || fail "[FM] type invalid: $ftype"
}

# 文件快照（用于 /ask 验证无新文件）
snapshot_before() { find "$VAULT" -type f | sort > /tmp/_vault_snap_before; }
snapshot_no_new() {
  find "$VAULT" -type f | sort > /tmp/_vault_snap_after
  local new=$(comm -13 /tmp/_vault_snap_before /tmp/_vault_snap_after)
  [ -z "$new" ] && pass "无新文件产生" || fail "产生了新文件: $new"
}

# 执行技能
run_skill() {
  local prompt="$1"
  echo ">>> claude -p \"${prompt:0:80}...\""
  cd "$VAULT" && claude -p "$prompt" --output-format text 2>/dev/null
}

summary() { echo ""; echo "=== 结果: $PASS passed, $FAIL failed ==="; }
```

### Frontmatter 通用验证规则

每个产出文件的 frontmatter 必须满足以下条件（依据 `Frontmatter_Schema.md`），由 `assert_fm_valid` 自动检查：

1. 以 `---` 开头和结尾，无重复 key
2. `created` 格式为 `"YYYY-MM-DD"`（不使用 `date`）
3. `type` 值属于 Schema 枚举：`project | project-doc | knowledge | wiki | draft | note | research | review | content | system | review-record`
4. `status` 值与对应 `type` 的枚举一致（如 draft 的 status 应为 `pending`）
5. frontmatter 结束的 `---` 后不留空行
6. 不使用 emoji 作为枚举值

以下简写 `[FM]` 表示对产出文件执行 `assert_fm_valid`。

---

### 8.1 `/today` — 晨间规划

```bash
echo "=== 8.1 /today ==="
run_skill "执行 /today 技能，开始今天的规划。简要列出 3 个示例任务即可，不要问我问题。"

# 验证日记文件
FILE=$(assert_exists "$VAULT/10_日记/${TODAY}.md" "日记文件 ${TODAY}.md")
if [ -n "$FILE" ]; then
  assert_fm_valid "$FILE"
  assert_fm "$FILE" type note
  assert_fm "$FILE" created "$TODAY"
  # 检查模板结构（至少包含一个段落标题）
  grep -qE '^##' "$FILE" && pass "使用了 Daily_Template 结构" || fail "缺少模板段落标题"
fi
```

**验证项：**
- [ ] `{diary}/YYYY-MM-DD.md` 已创建
- [ ] [FM] `type: note`，`created` 为当天日期
- [ ] 文件内容使用了 `Daily_Template.md` 模板结构

---

### 8.2 `/project` — 创建项目

```bash
echo "=== 8.2 /project ==="
run_skill "执行 /project 技能，创建一个新项目：学习线性代数，category 为 learning，domain 为 Math。不要问我问题，直接用这些参数创建。"

# 验证计划文件
PLAN=$(assert_exists "$VAULT/60_计划/Plan_${TODAY}_*.md" "计划文件")

# 验证项目文件
PROJ=$(find "$VAULT/20_项目" -name "*.md" -newer "$VAULT/lifeos.yaml" 2>/dev/null | head -1)
if [ -n "$PROJ" ]; then
  pass "项目文件 → $(basename "$PROJ")"
  assert_fm_valid "$PROJ"
  assert_fm "$PROJ" type project
  assert_fm "$PROJ" status active
  assert_fm "$PROJ" category learning
  assert_fm_exists "$PROJ" domain
  grep -qE '^##' "$PROJ" && pass "使用了 Project_Template 结构" || fail "缺少模板段落标题"
else
  fail "项目文件未找到"
fi
```

**验证项：**
- [ ] `{plans}/Plan_YYYY-MM-DD_*.md` 已创建
- [ ] `{projects}/<ProjectName>/<ProjectName>.md` 已创建
- [ ] [FM] `type: project`，`status: active`，`category: learning`，`domain` 存在

---

### 8.3 `/research` — 深度研究

```bash
echo "=== 8.3 /research ==="
run_skill "执行 /research 技能，深度研究 Transformer 注意力机制的最新进展。不要问我澄清问题，直接开始研究并产出报告。"

# 验证计划文件
RPLAN=$(assert_exists "$VAULT/60_计划/Plan_${TODAY}_*.md" "研究计划文件")

# 验证研究报告
REPORT=$(find "$VAULT/30_研究" -name "*.md" -newer "$VAULT/lifeos.yaml" 2>/dev/null | head -1)
if [ -n "$REPORT" ]; then
  pass "研究报告 → $(basename "$REPORT")"
  assert_fm_valid "$REPORT"
  assert_fm "$REPORT" type research
  assert_fm "$REPORT" created "$TODAY"
else
  fail "研究报告未找到"
fi
```

**验证项：**
- [ ] `{plans}/Plan_YYYY-MM-DD_*.md` 已创建
- [ ] `{research}/` 下研究报告已创建
- [ ] [FM] `type: research`，`created` 为当天日期

---

### 8.4 `/ask` — 快速问答

```bash
echo "=== 8.4 /ask ==="
snapshot_before
ANSWER=$(run_skill "执行 /ask 技能，快速问一下：什么是 CAP 定理？")
snapshot_no_new

# 验证回答内容
echo "$ANSWER" | grep -qi "CAP\|consistency\|availability\|partition\|一致性\|可用性\|分区" \
  && pass "回答包含 CAP 相关内容" || fail "回答未包含 CAP 相关内容"

# 验证 MCP 调用了 memory_skill_complete（通过查询 session_log）
LIFEOS_DIR="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd || echo /Users/luneth/code/node/lifeos)"
{
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}'
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"memory_recent","arguments":{"days":1,"entry_type":"skill_completion","limit":5}}}'
} | LIFEOS_VAULT_ROOT="$VAULT" node "$LIFEOS_DIR/dist/server.js" 2>/dev/null \
  | tail -1 | grep -q "ask" \
  && pass "memory_skill_complete 已记录 ask" || fail "memory_skill_complete 未记录 ask"
```

**验证项：**
- [ ] **不产生任何新文件**
- [ ] agent 回答了 CAP 定理问题
- [ ] `memory_skill_complete` 已记录问答事件

---

### 8.5 `/brainstorm` — 头脑风暴

```bash
echo "=== 8.5 /brainstorm ==="
run_skill "执行 /brainstorm 技能，头脑风暴：如何用 AI 辅助代码审查。不要问我问题，直接展开讨论并将结果保存为草稿。"

# 验证草稿文件
DRAFT=$(find "$VAULT/00_草稿" -name "*.md" -newer "$VAULT/lifeos.yaml" 2>/dev/null | head -1)
if [ -n "$DRAFT" ]; then
  pass "草稿文件 → $(basename "$DRAFT")"
  assert_fm_valid "$DRAFT"
  assert_fm "$DRAFT" type draft
  assert_fm "$DRAFT" status pending
  assert_fm "$DRAFT" created "$TODAY"
else
  fail "草稿文件未找到"
fi
```

**验证项：**
- [ ] `{drafts}/` 下草稿文件已创建
- [ ] [FM] `type: draft`，`status: pending`，`created` 为当天日期

---

### 8.6 `/knowledge` — 知识整理

**前置准备：** 需要 8.2 中已创建的学习线性代数项目。

```bash
echo "=== 8.6 /knowledge ==="
run_skill "执行 /knowledge 技能，把以下内容整理为知识笔记，domain 为 Math，关联项目 [[学习线性代数]]：

矩阵乘法（Matrix Multiplication）是线性代数中的核心运算。给定 m×n 矩阵 A 和 n×p 矩阵 B，其乘积 C = AB 是一个 m×p 矩阵，其中 C[i][j] = Σ(k=1..n) A[i][k] × B[k][j]。

矩阵乘法具有以下性质：
1. 结合律：(AB)C = A(BC)
2. 分配律：A(B+C) = AB + AC
3. 不满足交换律：AB ≠ BA（一般情况）
4. 单位矩阵 I 满足 AI = IA = A

应用场景包括线性变换、图论中的路径计数、计算机图形学中的坐标变换等。"

# 验证知识笔记
NOTE=$(find "$VAULT/40_知识/笔记" -name "*.md" -newer "$VAULT/lifeos.yaml" 2>/dev/null | grep -v "Review_" | head -1)
if [ -n "$NOTE" ]; then
  pass "知识笔记 → $(basename "$NOTE")"
  assert_fm_valid "$NOTE"
  assert_fm "$NOTE" type knowledge
  assert_fm "$NOTE" status draft
  assert_fm_exists "$NOTE" domain
else
  fail "知识笔记未找到"
fi
```

**验证项：**
- [ ] `{knowledge}/{notes}/` 下知识笔记已创建
- [ ] [FM] `type: knowledge`，`status: draft`，`domain` 存在
- [ ] 文件内容使用了 `Knowledge_Template.md` 模板结构

---

### 8.7 `/review` — 知识复习

**前置准备：** 需要 8.6 中已创建的知识笔记（`status: draft`）。

```bash
echo "=== 8.7 /review ==="

# 找到 8.6 产出的笔记
NOTE=$(find "$VAULT/40_知识/笔记" -name "*.md" -newer "$VAULT/lifeos.yaml" 2>/dev/null | grep -v "Review_" | head -1)
NOTE_NAME=$(basename "$NOTE" .md)

run_skill "执行 /review 技能，复习知识笔记 [[$NOTE_NAME]]。完成出题后请自行回答所有问题（给出正确答案），然后完成批改。全程不要问我问题。"

# 验证复习记录
NOTE_DIR=$(dirname "$NOTE")
REVIEW=$(find "$NOTE_DIR" -name "Review_${TODAY}*.md" 2>/dev/null | head -1)
if [ -n "$REVIEW" ]; then
  pass "复习记录 → $(basename "$REVIEW")"
  assert_fm_valid "$REVIEW"
  assert_fm "$REVIEW" type review-record
  assert_fm_exists "$REVIEW" note
  assert_fm_exists "$REVIEW" mode
  # 检查批改结果
  assert_fm_exists "$REVIEW" score
  assert_fm_exists "$REVIEW" result
else
  fail "复习记录未找到"
fi

# 检查知识笔记 status 是否升级
if [ -n "$NOTE" ]; then
  NEW_STATUS=$(awk '/^---$/{n++; next} n==1 && /^status:/{
    sub(/^status:[[:space:]]*/,""); gsub(/["'"'"']/,""); print; exit
  }' "$NOTE")
  [ "$NEW_STATUS" = "review" ] && pass "笔记 status 升级为 review" || echo "  ℹ 笔记 status: $NEW_STATUS（若 fail 则不升级）"
fi
```

**验证项：**
- [ ] `Review_YYYY-MM-DD.md` 复习记录已创建
- [ ] [FM] `type: review-record`，含 `note`、`mode`、`score`、`result`
- [ ] 如果 pass，知识笔记 `status` 从 `draft` 升级为 `review`

---

### 8.8 `/archive` — 归档

**前置准备：** 手动设置归档条件。

```bash
echo "=== 8.8 /archive ==="

# 找到 8.2 产出的项目文件，将 status 改为 done
PROJ=$(find "$VAULT/20_项目" -name "*.md" -newer "$VAULT/lifeos.yaml" 2>/dev/null | head -1)
if [ -n "$PROJ" ]; then
  sed -i '' 's/^status:.*/status: done/' "$PROJ"
  echo "  已将 $(basename "$PROJ") status 改为 done"
fi

# 在 drafts 中创建一个已处理的草稿
cat > "$VAULT/00_草稿/test_archive_target.md" <<EOF
---
title: 归档测试草稿
type: draft
status: researched
created: "$TODAY"
---
这是一个已处理的草稿，应被归档。
EOF

# 创建一个 pending 草稿（不应被归档）
cat > "$VAULT/00_草稿/test_archive_keep.md" <<EOF
---
title: 保留测试草稿
type: draft
status: pending
created: "$TODAY"
---
这是一个未处理的草稿，不应被归档。
EOF

run_skill "执行 /archive 技能，归档已完成的项目和已处理的草稿。不要问我问题，直接执行归档。"

# 验证：已处理草稿被归档
ARCHIVED_DRAFT=$(find "$VAULT/90_系统/归档/草稿" -name "test_archive_target.md" 2>/dev/null | head -1)
if [ -n "$ARCHIVED_DRAFT" ]; then
  pass "已处理草稿已归档"
  assert_fm_exists "$ARCHIVED_DRAFT" archived
else
  fail "已处理草稿未归档"
fi

# 验证：pending 草稿未被归档
test -f "$VAULT/00_草稿/test_archive_keep.md" \
  && pass "pending 草稿未被归档（仍在 drafts）" \
  || fail "pending 草稿被错误归档"

# 验证：项目被归档
if [ -n "$PROJ" ]; then
  PROJ_NAME=$(basename "$PROJ")
  ARCHIVED_PROJ=$(find "$VAULT/90_系统/归档/项目" -name "$PROJ_NAME" 2>/dev/null | head -1)
  if [ -n "$ARCHIVED_PROJ" ]; then
    pass "已完成项目已归档"
    assert_fm_exists "$ARCHIVED_PROJ" archived
  else
    fail "已完成项目未归档"
  fi
fi

# 清理测试文件
rm -f "$VAULT/00_草稿/test_archive_keep.md" 2>/dev/null
```

**验证项：**
- [ ] 已完成项目移动到 `{system}/{archive_projects}/` 并含 `archived` 字段
- [ ] 已处理草稿移动到 `{system}/{archive_drafts}/` 并含 `archived` 字段
- [ ] `status: pending` 的草稿**未被归档**

---

### 8.9 `/read-pdf` — PDF 提取

```bash
echo "=== 8.9 /read-pdf ==="

# 创建测试 PDF
python3 -c "
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
c = canvas.Canvas('/tmp/test_lifeos.pdf', pagesize=A4)
c.drawString(100, 700, 'LifeOS Integration Test')
c.drawString(100, 680, 'This is a test PDF for read-pdf skill validation.')
c.save()
" 2>/dev/null || {
  # 如果没有 reportlab，用 minimal PDF
  printf '%%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>>>endobj\n4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\nxref\n0 5\ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n0\n%%%%EOF' > /tmp/test_lifeos.pdf
}

snapshot_before
RESULT=$(run_skill "执行 /read-pdf 技能，读取 /tmp/test_lifeos.pdf 的内容并返回给我。")
snapshot_no_new

# 验证返回了内容
[ -n "$RESULT" ] && pass "read-pdf 返回了内容" || fail "read-pdf 无返回内容"

rm -f /tmp/test_lifeos.pdf
```

**验证项：**
- [ ] 技能正常执行，无报错
- [ ] 返回了提取内容
- [ ] **不产生 vault 内永久文件**

---

### 8.10 技能依赖链集成测试

> 在一个干净 vault 中按顺序执行全链路技能，验证上下游数据流转正确。

```bash
echo "========================================="
echo "  8.10 技能依赖链集成测试"
echo "========================================="

# 创建干净的测试 vault
rm -rf /tmp/test-chain
LIFEOS_DIR="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd || echo /Users/luneth/code/node/lifeos)"
node "$LIFEOS_DIR/bin/lifeos.js" init /tmp/test-chain --lang zh --no-mcp

# 覆写 MCP 配置为本地路径
cat > /tmp/test-chain/.mcp.json <<EOF
{
  "mcpServers": {
    "lifeos": {
      "command": "node",
      "args": ["$LIFEOS_DIR/dist/server.js", "--vault-root", "/tmp/test-chain"]
    }
  }
}
EOF

VAULT="/tmp/test-chain"
cd "$VAULT"
PASS=0; FAIL=0

# ─── Step 1: /today ───
echo ""
echo "--- Step 1: /today ---"
run_skill "执行 /today 技能，开始今天的规划。列出 3 个学习任务即可，不要问我问题。"
DIARY=$(assert_exists "$VAULT/10_日记/${TODAY}.md" "日记文件")
[ -n "$DIARY" ] && assert_fm "$DIARY" type note

# ─── Step 2: /research ───
echo ""
echo "--- Step 2: /research ---"
run_skill "执行 /research 技能，深度研究 Rust 所有权模型（ownership model）。不要问我澄清问题，直接开始研究并产出报告。"
REPORT=$(find "$VAULT/30_研究" -name "*.md" -newer "$VAULT/lifeos.yaml" 2>/dev/null | head -1)
[ -n "$REPORT" ] && { pass "研究报告 → $(basename "$REPORT")"; assert_fm "$REPORT" type research; } || fail "研究报告未找到"

# ─── Step 3: /project ───
echo ""
echo "--- Step 3: /project ---"
run_skill "执行 /project 技能，创建项目：学习 Rust 基础，category 为 learning，domain 为 Programming。不要问我问题。"
PROJ=$(find "$VAULT/20_项目" -name "*.md" -newer "$VAULT/lifeos.yaml" 2>/dev/null | head -1)
[ -n "$PROJ" ] && { pass "项目文件 → $(basename "$PROJ")"; assert_fm "$PROJ" type project; assert_fm "$PROJ" status active; } || fail "项目文件未找到"

# ─── Step 4: /knowledge ───
echo ""
echo "--- Step 4: /knowledge ---"
PROJ_NAME=$(basename "${PROJ:-.}" .md)
run_skill "执行 /knowledge 技能，整理以下内容为知识笔记，domain 为 Programming，关联项目 [[$PROJ_NAME]]：

Rust 所有权规则：
1. 每个值都有且只有一个所有者（owner）
2. 同一时刻只能有一个所有者
3. 当所有者离开作用域（scope），值会被丢弃（drop）

借用规则：
- 在任意给定时间，要么有一个可变引用（&mut T），要么有任意数量的不可变引用（&T）
- 引用必须始终有效（不能有悬垂引用）"
NOTE=$(find "$VAULT/40_知识/笔记" -name "*.md" -newer "$VAULT/lifeos.yaml" 2>/dev/null | grep -v "Review_" | head -1)
[ -n "$NOTE" ] && { pass "知识笔记 → $(basename "$NOTE")"; assert_fm "$NOTE" type knowledge; assert_fm "$NOTE" status draft; } || fail "知识笔记未找到"

# ─── Step 5: /review ───
echo ""
echo "--- Step 5: /review ---"
NOTE_NAME=$(basename "${NOTE:-.}" .md)
run_skill "执行 /review 技能，复习知识笔记 [[$NOTE_NAME]]。完成出题后请自行回答所有问题（给出正确答案），然后完成批改。全程不要问我问题。"
if [ -n "$NOTE" ]; then
  NOTE_DIR=$(dirname "$NOTE")
  REVIEW=$(find "$NOTE_DIR" -name "Review_${TODAY}*.md" 2>/dev/null | head -1)
  [ -n "$REVIEW" ] && { pass "复习记录 → $(basename "$REVIEW")"; assert_fm "$REVIEW" type review-record; assert_fm_exists "$REVIEW" result; } || fail "复习记录未找到"
fi

# ─── Step 6: 手动设置归档条件 ───
echo ""
echo "--- Step 6: 设置归档条件 ---"
[ -n "$PROJ" ] && sed -i '' 's/^status:.*/status: done/' "$PROJ" && pass "项目 status → done"

# ─── Step 7: /archive ───
echo ""
echo "--- Step 7: /archive ---"
run_skill "执行 /archive 技能，归档已完成的项目。不要问我问题，直接执行。"
if [ -n "$PROJ" ]; then
  PROJ_BASENAME=$(basename "$PROJ")
  ARCHIVED=$(find "$VAULT/90_系统/归档/项目" -name "$PROJ_BASENAME" 2>/dev/null | head -1)
  [ -n "$ARCHIVED" ] && { pass "项目已归档 → $ARCHIVED"; assert_fm_exists "$ARCHIVED" archived; } || fail "项目未归档"
fi

# ─── 全链路结果 ───
echo ""
echo "========================================="
summary
echo "========================================="

# 清理
rm -rf /tmp/test-chain
```

**全链路验证：**
- [ ] 日记文件存在于 `{diary}/`，`type: note`
- [ ] 研究报告在 `{research}/`，`type: research`
- [ ] 项目文件在 `{projects}/`，`type: project`，`status: active`
- [ ] 知识笔记在 `{knowledge}/{notes}/`，`type: knowledge`，`status: draft`
- [ ] 复习记录在笔记同目录下，`type: review-record`，含 `result`
- [ ] 归档后项目在 `{system}/{archive_projects}/`，含 `archived` 字段
- [ ] 所有产出文件的 frontmatter 均符合 Frontmatter_Schema.md

---

## 清理

```bash
rm -rf /tmp/test-auto /tmp/test-zh /tmp/test-en /tmp/test-mcp /tmp/test-empty /tmp/test-chain
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
test -f /tmp/smoke-zh/AGENTS.md && echo "✓ AGENTS.md OK" || echo "✗ AGENTS.md missing"
diff -q /tmp/smoke-zh/CLAUDE.md /tmp/smoke-zh/AGENTS.md && echo "✓ CLAUDE=AGENTS OK"
node bin/lifeos.js --version
rm -rf /tmp/smoke-zh
```
