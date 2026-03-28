# LifeOS Integration Test Manual

> Local manual verification of CLI commands and MCP Server end-to-end behavior.
> Execute before each release or after major refactoring.

## Prerequisites

```bash
npm run build          # Compile TypeScript → dist/
npm link               # Register global lifeos command (optional, can use node bin/lifeos.js)
```

> **Tip:** After `npm link` you can use the `lifeos` command directly; if you don't want a global install, replace all `lifeos` calls below with `node bin/lifeos.js`.

---

## 1. init — Create New Vault

### 1.1 Automatic Language Detection (no --lang)

```bash
lifeos init tmp/test-auto --no-mcp
```

**Behavior:** Detects system locale via `Intl.DateTimeFormat().resolvedOptions().locale`:
- Locale starts with `zh` → creates Chinese vault
- Others (including `en-US`, `en-GB`, etc.) → creates English vault

> **Cross-platform:** The `Intl` API is available on Node.js 18+ across macOS/Linux/Windows, reading the OS locale settings.

**Verify:**
```bash
# Check current system locale
node -e "console.log(Intl.DateTimeFormat().resolvedOptions().locale)"

# Check generated vault language
grep 'language:' tmp/test-auto/lifeos.yaml
# If locale is zh-CN → language: zh, directory names in Chinese
# If locale is en-US → language: en, directory names in English
ls tmp/test-auto/
```

```bash
rm -rf tmp/test-auto
```

### 1.2 Chinese Vault (explicit)

```bash
lifeos init tmp/test-zh --lang zh --no-mcp
```

**Verify:**
- [ ] 10 top-level directories created (`00_草稿` ~ `90_系统`)
- [ ] Nested subdirectories created (`40_知识/笔记`, `40_知识/百科`, `90_系统/模板`, etc.)
- [ ] Reflection subdirectories created (`80_复盘/周复盘`, `月复盘`, etc. — 6 total)
- [ ] `lifeos.yaml` exists with nested `subdirectories` format
- [ ] Template files copied to `90_系统/模板/` (8 `.md` files)
- [ ] Schema files copied to `90_系统/规范/`
- [ ] Skill files copied to `.agents/skills/` (9 skill directories)
- [ ] `CLAUDE.md` copied to root
- [ ] `AGENTS.md` copied to root
- [ ] `.git` and `.gitignore` created

```bash
cat tmp/test-zh/lifeos.yaml                    # Confirm nested subdirectories
ls tmp/test-zh/90_系统/模板/                    # Confirm 8 templates
ls tmp/test-zh/.agents/skills/                  # Confirm 9 skills
```

### 1.3 English Vault

```bash
lifeos init tmp/test-en --lang en --no-mcp
```

**Verify:**
- [ ] Directory names in English (`00_Drafts`, `10_Diary`, etc.)
- [ ] `lifeos.yaml` has `language: en`
- [ ] Templates and skills are English versions
- [ ] `CLAUDE.md` and `AGENTS.md` are English versions

```bash
cat tmp/test-en/lifeos.yaml
ls tmp/test-en/90_System/Templates/
```

### 1.4 Duplicate init Should Error

```bash
lifeos init tmp/test-zh    # Expected: Error "Vault already initialized"
```

---

## 2. doctor — Health Check

### 2.1 Healthy Vault

```bash
lifeos doctor tmp/test-zh
```

**Verify:**
- [ ] All checks show green ✓
- [ ] Output includes `0 warnings, 0 failures`

### 2.2 Missing Directory

```bash
rm -rf tmp/test-zh/00_草稿
lifeos doctor tmp/test-zh
```

**Verify:**
- [ ] `directory: 00_草稿` shows yellow ⚠ warning
- [ ] Other checks still pass

```bash
mkdir tmp/test-zh/00_草稿    # Restore
```

### 2.3 No lifeos.yaml

```bash
lifeos doctor tmp/test-empty    # Non-existent directory
```

**Verify:**
- [ ] `lifeos.yaml: not found` shows red ✗ fail

---

## 3. upgrade — Asset Upgrade

### 3.1 Skip When Version Matches

```bash
lifeos upgrade tmp/test-zh
```

**Verify:**
- [ ] Output: "Already up to date."

### 3.2 Upgrade When Version Differs

```bash
# Manually lower version number to trigger upgrade
sed -i '' 's/assets: .*/assets: "0.9.0"/' tmp/test-zh/lifeos.yaml
lifeos upgrade tmp/test-zh
```

**Verify:**
- [ ] Templates and schema updated (Updated: N files)
- [ ] Unmodified skill files marked as Unchanged
- [ ] `lifeos.yaml` `installed_versions.assets` updated to current version

```bash
grep 'assets:' tmp/test-zh/lifeos.yaml    # Confirm version updated
```

### 3.3 User-Modified Skills Preserved

```bash
# Lower version number first
sed -i '' 's/assets: .*/assets: "0.9.0"/' tmp/test-zh/lifeos.yaml
# Modify a skill file
echo "User custom content" > tmp/test-zh/.agents/skills/knowledge/SKILL.md
lifeos upgrade tmp/test-zh
```

**Verify:**
- [ ] Output: `⚠ Skipping modified: .agents/skills/knowledge/SKILL.md`
- [ ] File content is still "User custom content"

---

## 4. rename — Directory Rename

### 4.1 Rename Top-Level Directory

```bash
lifeos rename tmp/test-zh --logical drafts --name 00_Inbox
```

**Verify:**
- [ ] Physical directory renamed: `00_Inbox/` exists, `00_草稿/` does not
- [ ] `lifeos.yaml` has `directories.drafts: 00_Inbox`
- [ ] Output: "Rename complete"

```bash
ls tmp/test-zh/ | grep -E "00_"
grep 'drafts:' tmp/test-zh/lifeos.yaml
```

### 4.2 Wikilink Batch Replacement

```bash
# Restore first (re-init or manually change back)
lifeos rename tmp/test-zh --logical drafts --name 00_草稿

# Create test file with wikilinks
echo 'See [[00_草稿/idea]] and [[00_草稿]]' > tmp/test-zh/10_日记/test-link.md

lifeos rename tmp/test-zh --logical drafts --name 00_Inbox
cat tmp/test-zh/10_日记/test-link.md
```

**Verify:**
- [ ] File content changed to `See [[00_Inbox/idea]] and [[00_Inbox]]`
- [ ] Output shows `1 wikilinks updated`

```bash
rm tmp/test-zh/10_日记/test-link.md    # Cleanup
```

### 4.3 Error Handling

```bash
lifeos rename tmp/test-zh --logical nonexistent --name foo
# Expected: Error "Unknown logical name"
```

---

## 5. MCP Server — Startup Verification

### 5.1 Basic Startup

```bash
LIFEOS_VAULT_ROOT=tmp/test-zh node dist/server.js &
MCP_PID=$!
sleep 2

# Check if process is alive
kill -0 $MCP_PID 2>/dev/null && echo "✓ MCP server running" || echo "✗ Failed to start"

# Stop
kill $MCP_PID
```

### 5.2 CLI Tool Integration (Claude Code / Codex / OpenCode)

#### 5.2.1 Config File Generation

```bash
lifeos init tmp/test-mcp --lang zh
```

**Verify:**
- [ ] Output includes `Claude Code →`, `Codex →`, `OpenCode →` registration lines
- [ ] `.mcp.json` exists and contains `mcpServers.lifeos`
- [ ] `.codex/config.toml` exists and contains `[mcp_servers.lifeos]`
- [ ] `opencode.json` exists and contains `mcp.lifeos`

```bash
cat tmp/test-mcp/.mcp.json
cat tmp/test-mcp/.codex/config.toml
cat tmp/test-mcp/opencode.json
```

#### 5.2.2 Actual Connectivity Test

> **Note:** `lifeos init` registers the global `lifeos --vault-root ...` command; when testing from local source, install globally first or run `npm link`.
> Override with local paths below to verify each CLI can actually connect to the MCP Server.

```bash
LIFEOS_DIR="$(cd "$(dirname "$0")/../.." && pwd)"    # Adjust to actual project path

# Override with local paths
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

**Claude Code:**
```bash
cd tmp/test-mcp && claude mcp list
```
- [ ] Output: `lifeos: ... ✓ Connected`

**Codex:**
```bash
cd tmp/test-mcp && codex mcp list
```
- [ ] Output includes `lifeos` entry with status `enabled`

> **Known limitation:** Codex `mcp list` only reads global `~/.codex/config.toml`; project-level `.codex/config.toml` requires trusted project. Use `-c` override to verify format correctness:
> ```bash
> codex mcp list -c 'mcp_servers.lifeos.command="node"' \
>   -c "mcp_servers.lifeos.args=[\"$LIFEOS_DIR/dist/server.js\"]"
> ```

**OpenCode:**
```bash
cd tmp/test-mcp && opencode mcp list
```
- [ ] Output: `✓ lifeos connected`

---

## 6. Other Commands

```bash
lifeos help           # Show help information
lifeos --version      # Show version (1.0.2)
lifeos --help         # Same as help
lifeos unknown        # Show "Unknown command" error
```

---

## 7. Asset Enablement Verification — Skills, Templates, CLAUDE.md, AGENTS.md

> Verify that assets generated by `lifeos init` not only exist but are **actually recognized and loaded** by AI coding tools.
> All tests in this section can be automated by an agent.

### Prerequisite: Use the `tmp/test-mcp` vault with local path overrides from 5.2.2.

---

### 7.1 Structural Verification (no external tools needed)

#### 7.1.1 Skill Structure

```bash
# Confirm 9 skill directories
test $(ls -d tmp/test-mcp/.agents/skills/*/ | wc -l) -eq 9 && echo "✓ 9 skills" || echo "✗ skill count mismatch"

# Each skill directory has SKILL.md
for skill in tmp/test-mcp/.agents/skills/*/; do
  name=$(basename "$skill")
  if [ -f "$skill/SKILL.md" ]; then
    echo "✓ $name/SKILL.md exists"
  else
    echo "✗ $name/SKILL.md missing"
  fi
done
```

**Verify:**
- [ ] 9 skill directories: ask, archive, brainstorm, knowledge, project, read-pdf, research, review, today
- [ ] Each directory contains `SKILL.md`

#### 7.1.2 Skill Frontmatter Validity

```bash
# Check each SKILL.md YAML frontmatter for required fields
for skill in tmp/test-mcp/.agents/skills/*/SKILL.md; do
  name=$(basename "$(dirname "$skill")")
  # Extract frontmatter (content between two ---)
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

**Verify:**
- [ ] All 9 skills have frontmatter with `name`, `description`, `version` fields

#### 7.1.3 Skill Reference Cross-Validation

```bash
# Skills listed in CLAUDE.md skill table ↔ actual skill directories
# Note: read-pdf is MCP-triggered only, not in CLAUDE.md skill table
CLAUDE_SKILLS=$(grep -oP '(?<=`/)\w+(?=`)' tmp/test-mcp/CLAUDE.md | sort -u)
DIR_SKILLS=$(ls tmp/test-mcp/.agents/skills/ | sort)

echo "Skills referenced in CLAUDE.md:"
echo "$CLAUDE_SKILLS"
echo ""
echo "Actual skill directories:"
echo "$DIR_SKILLS"
echo ""

# Check each CLAUDE.md skill has a corresponding directory
for s in $CLAUDE_SKILLS; do
  if [ -d "tmp/test-mcp/.agents/skills/$s" ]; then
    echo "✓ /$s → .agents/skills/$s/"
  else
    echo "✗ /$s referenced in CLAUDE.md but directory missing"
  fi
done
```

**Verify:**
- [ ] All 8 skills in CLAUDE.md skill table (today, project, research, ask, brainstorm, knowledge, review, archive) have corresponding `.agents/skills/` directories
- [ ] `read-pdf` directory exists but is not in the skill table (MCP-triggered only, this is expected)

#### 7.1.4 Template Structure Verification

```bash
LANG=$(grep 'language:' tmp/test-mcp/lifeos.yaml | awk '{print $2}')

# Confirm 8 template files
TPL_DIR=$([ "$LANG" = "en" ] && echo "90_System/Templates" || echo "90_系统/模板")
TPL_COUNT=$(ls tmp/test-mcp/$TPL_DIR/*.md 2>/dev/null | wc -l)
test "$TPL_COUNT" -eq 8 && echo "✓ 8 templates" || echo "✗ template count: $TPL_COUNT"

# Each template has frontmatter with title and type
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

**Verify:**
- [ ] 8 template files exist
- [ ] Each template frontmatter contains `title` and `type`

#### 7.1.5 Template Routing Cross-Validation

```bash
# Template names in CLAUDE.md routing table ↔ actual template files
CLAUDE_TEMPLATES=$(grep -oP '\w+_Template\.md' tmp/test-mcp/CLAUDE.md | sort -u)
ACTUAL_TEMPLATES=$(ls tmp/test-mcp/$TPL_DIR/*.md | xargs -I{} basename {} | sort)

for t in $CLAUDE_TEMPLATES; do
  if echo "$ACTUAL_TEMPLATES" | grep -q "^${t}$"; then
    echo "✓ $t"
  else
    echo "✗ $t in CLAUDE.md routing table but file missing"
  fi
done
```

**Verify:**
- [ ] All 8 template names in CLAUDE.md routing table match actual files

#### 7.1.6 CLAUDE.md and AGENTS.md Consistency

```bash
# AGENTS.md should match CLAUDE.md content
if diff -q tmp/test-mcp/CLAUDE.md tmp/test-mcp/AGENTS.md > /dev/null 2>&1; then
  echo "✓ CLAUDE.md and AGENTS.md are identical"
else
  echo "✗ CLAUDE.md and AGENTS.md differ"
  diff tmp/test-mcp/CLAUDE.md tmp/test-mcp/AGENTS.md | head -20
fi
```

**Verify:**
- [ ] `CLAUDE.md` and `AGENTS.md` are identical

#### 7.1.7 Frontmatter Schema Coverage Verification

```bash
SCHEMA_DIR=$([ "$LANG" = "en" ] && echo "90_System/Schema" || echo "90_系统/规范")
SCHEMA_FILE="tmp/test-mcp/$SCHEMA_DIR/Frontmatter_Schema.md"

# Extract type enums defined in Schema
SCHEMA_TYPES=$(grep -oP '(?<=`)\w+(?=`)' "$SCHEMA_FILE" | head -20)
echo "Types defined in Schema: $SCHEMA_TYPES"

# Extract type values used in all templates
for tpl in tmp/test-mcp/$TPL_DIR/*.md; do
  name=$(basename "$tpl")
  ttype=$(sed -n '/^---$/,/^---$/p' "$tpl" | grep '^type:' | awk '{print $2}')
  echo "  $name → type: $ttype"
done
```

**Verify:**
- [ ] All `type` values in templates are within the Frontmatter_Schema.md enum range

---

### 7.2 CLI Recognition Verification (requires corresponding tools installed)

> The following tests require the corresponding CLI tools. Skip tools that are not installed.

#### 7.2.1 Claude Code

```bash
cd tmp/test-mcp

# Verify MCP Server connection
claude mcp list
```

**Verify:**
- [ ] Output includes `lifeos: ... connected` (or similar success indicator)
- [ ] Claude Code auto-loads `CLAUDE.md` and `.agents/skills/` from vault root

#### 7.2.2 Codex

```bash
cd tmp/test-mcp
LIFEOS_DIR="$(cd "$(dirname "$0")/../.." && pwd)"    # Adjust to actual project path

# Codex project-level config needs -c override for verification
codex mcp list \
  -c 'mcp_servers.lifeos.command="node"' \
  -c "mcp_servers.lifeos.args=[\"$LIFEOS_DIR/dist/server.js\"]"
```

**Verify:**
- [ ] Output includes `lifeos` entry
- [ ] Codex auto-loads `AGENTS.md` from vault root

> **Known limitation:** Codex `mcp list` reads global `~/.codex/config.toml`; project-level `.codex/config.toml` requires trusted project, so `-c` parameter override is necessary for testing.

#### 7.2.3 OpenCode

```bash
cd tmp/test-mcp && opencode mcp list
```

**Verify:**
- [ ] Output includes `lifeos` with connected status
- [ ] OpenCode auto-loads `AGENTS.md` from vault root

---

### 7.3 Smoke Test (end-to-end MCP calls)

> Interact with the MCP Server directly via JSON-RPC over stdio to verify the complete chain.

#### 7.3.1 MCP Protocol Handshake

```bash
LIFEOS_DIR="$(cd "$(dirname "$0")/../.." && pwd)"    # Adjust to actual project path

# Send initialize + tools/list requests
{
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"integration-test","version":"0.1"}}}'
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
} | LIFEOS_VAULT_ROOT=tmp/test-mcp node "$LIFEOS_DIR/dist/server.js" 2>/dev/null | head -5
```

**Verify:**
- [ ] First response contains `"result"` and `"serverInfo"` (initialize success)
- [ ] Second response contains `"tools"` array listing all LifeOS MCP tools

#### 7.3.2 Call memory_startup Tool

```bash
{
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"integration-test","version":"0.1"}}}'
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"memory_startup","arguments":{}}}'
} | LIFEOS_VAULT_ROOT=tmp/test-mcp node "$LIFEOS_DIR/dist/server.js" 2>/dev/null | head -10
```

**Verify:**
- [ ] Response contains `"result"` and `"content"` (tool call success)
- [ ] No `"error"` present
- [ ] Content includes Layer 0 summary or empty vault message

#### 7.3.3 Via CLI Tool (optional)

If CLI tools are installed, further verify indirect MCP tool calls through CLI:

**Claude Code:**
```bash
cd tmp/test-mcp
# Trigger memory_startup in Claude Code session (interactive, requires manual observation)
claude "Call the memory_startup tool"
```

**Codex:**
```bash
cd tmp/test-mcp
codex "Call the memory_startup tool"
```

- [ ] Agent successfully calls `memory_startup` and returns results
- [ ] Agent recognizes skills and rules defined in CLAUDE.md / AGENTS.md

---

## Cleanup

```bash
rm -rf tmp/test-auto tmp/test-zh tmp/test-en tmp/test-mcp tmp/test-empty tmp/test-chain
npm unlink -g lifeos    # Remove global link (if npm link was used)
```

---

## Quick Verification Script

Minimal command sequence for full verification:

```bash
npm run build && npm run typecheck && npm test

# CLI quick smoke test
node bin/lifeos.js init tmp/smoke-zh --lang zh --no-mcp
node bin/lifeos.js doctor tmp/smoke-zh
node bin/lifeos.js rename tmp/smoke-zh --logical drafts --name 00_Inbox
grep 'drafts: 00_Inbox' tmp/smoke-zh/lifeos.yaml && echo "✓ rename OK"
test -f tmp/smoke-zh/AGENTS.md && echo "✓ AGENTS.md OK" || echo "✗ AGENTS.md missing"
diff -q tmp/smoke-zh/CLAUDE.md tmp/smoke-zh/AGENTS.md && echo "✓ CLAUDE=AGENTS OK"
node bin/lifeos.js --version
rm -rf tmp/smoke-zh
```
