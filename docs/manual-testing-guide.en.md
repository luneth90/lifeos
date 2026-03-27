# LifeOS Manual Testing Guide

> Install LifeOS from scratch and operate all MCP tools in Claude Code.
> Validates the complete user experience chain, distinct from `integration-test.md` which covers CLI unit verification.

## Prerequisites

- Node.js 18+
- Claude Code CLI installed (`claude` command available)
- LifeOS project source cloned

---

## 1. Build & Prepare

```bash
cd /path/to/lifeos          # Enter project directory
npm install
npm run build
npm run typecheck            # Confirm no type errors
npm test                     # Confirm tests pass
```

---

## 2. Initialize Test Vault

```bash
node bin/lifeos.js init /tmp/lifeos-manual-test --lang en
```

**Expected output:**
- 10 directories created (`00_Drafts` ~ `90_System`)
- Templates, schema, and skill files copied
- `.mcp.json`, `.codex/config.toml`, `opencode.json` registered
- Git repository initialized

**Verify:**
```bash
ls /tmp/lifeos-manual-test/
cat /tmp/lifeos-manual-test/lifeos.yaml
cat /tmp/lifeos-manual-test/.mcp.json
```

---

## 3. Configure Local MCP Server

`lifeos init` registers `npx -y lifeos` (npm package). For local testing, point to the build output instead:

```bash
LIFEOS_DIR="/path/to/lifeos"    # Replace with actual path

cat > /tmp/lifeos-manual-test/.mcp.json <<EOF
{
  "mcpServers": {
    "lifeos": {
      "command": "node",
      "args": ["$LIFEOS_DIR/dist/server.js"]
    }
  }
}
EOF
```

---

## 4. Launch Claude Code

```bash
cd /tmp/lifeos-manual-test
claude
```

After startup, confirm the MCP Server is connected — lifeos tools should be available in the Claude Code session.

---

## 5. MCP Tool Step-by-Step Testing

Run the following tests inside the Claude Code session. Simply tell Claude which tool to call.

### 5.1 memory_startup — Start Session

> Tell Claude: Call memory_startup

**Expected:**
- [ ] Returns Layer 0 summary (minimal content on first use)
- [ ] `/tmp/lifeos-manual-test/memory.db` created
- [ ] No errors

### 5.2 memory_log — Log an Event

> Tell Claude: Call memory_log to record an observation event with content "Testing manual logging"

**Expected:**
- [ ] Returns success with event ID
- [ ] Event type is observation or discovery

### 5.3 memory_recent — Query Recent Events

> Tell Claude: Call memory_recent to view recent session logs

**Expected:**
- [ ] Results include the event recorded in 5.2
- [ ] Includes session events from memory_startup

### 5.4 memory_query — Search Vault

First create a test note for searching:

```bash
# Run in a separate terminal
cat > /tmp/lifeos-manual-test/00_Drafts/test-note.md <<'EOF'
---
title: Introduction to Quantum Computing
type: note
status: draft
created: 2026-03-27
tags: [physics, quantum]
---

# Introduction to Quantum Computing

Qubits are the fundamental unit of quantum computing.
EOF
```

> Tell Claude: Call memory_notify to trigger a rescan, then call memory_query to search for "quantum computing"

**Expected:**
- [ ] memory_notify successfully triggers rescan
- [ ] memory_query returns results including "test-note.md"
- [ ] Results include file path, title, tags, and other metadata

### 5.5 memory_auto_capture — Batch Capture

> Tell Claude: Call memory_auto_capture to record a preference: "User prefers dark mode interfaces"

**Expected:**
- [ ] Returns success with captured entry count
- [ ] Entry type is preference

### 5.6 memory_refresh — Refresh Active Documents

> Tell Claude: Call memory_refresh to refresh TaskBoard

**Expected:**
- [ ] Returns refresh result
- [ ] Check TaskBoard.md AUTO sections updated:
  ```bash
  cat /tmp/lifeos-manual-test/90_System/Memory/TaskBoard.md
  ```

> Tell Claude: Call memory_refresh to refresh UserProfile

**Expected:**
- [ ] UserProfile.md AUTO sections updated:
  ```bash
  cat /tmp/lifeos-manual-test/90_System/Memory/UserProfile.md
  ```

### 5.7 memory_citations — Get Source Citations

> Tell Claude: Call memory_citations to query source events for an item in TaskBoard

**Expected:**
- [ ] Returns list of associated session_log events
- [ ] Each citation includes timestamp and original content

### 5.8 memory_skill_context — Skill Context Assembly

> Tell Claude: Call memory_skill_context with seed profile "today"

**Expected:**
- [ ] Returns assembled context with information relevant to the today skill
- [ ] Includes Layer 0 summary, active document summaries, etc.

### 5.9 memory_skill_complete — Mark Skill Complete

> Tell Claude: Call memory_skill_complete to mark the today skill as completed

**Expected:**
- [ ] Returns success
- [ ] Event can be found via memory_recent

### 5.10 memory_checkpoint — Close Session

> Tell Claude: Call memory_checkpoint

**Expected:**
- [ ] Returns session summary
- [ ] Active documents refreshed
- [ ] enhance_queue processed

---

## 6. Skill Trigger Testing

Trigger skills directly in Claude Code using slash commands:

| Command | Expected Behavior |
|---------|-------------------|
| `/today` | Generate daily plan, calls memory_skill_context |
| `/ask What is quantum entanglement` | Enter Q&A mode, can save as draft |
| `/brainstorm Personal knowledge management` | Guided brainstorming session |
| `/knowledge` | Create a knowledge note |
| `/review` | Review current phase of work |

**Verify:**
- [ ] Skills are correctly recognized and loaded
- [ ] Skills call corresponding MCP tools during execution
- [ ] Output files saved to correct vault directories

---

## 7. Data Persistence Verification

After exiting Claude Code, check database state:

```bash
# Check database file
ls -la /tmp/lifeos-manual-test/memory.db

# View table structure
sqlite3 /tmp/lifeos-manual-test/memory.db ".tables"

# View session log
sqlite3 /tmp/lifeos-manual-test/memory.db "SELECT id, type, title, substr(body, 1, 60) FROM session_log ORDER BY created_at DESC LIMIT 10;"

# View vault index
sqlite3 /tmp/lifeos-manual-test/memory.db "SELECT path, title, type, status FROM vault_index LIMIT 10;"

# View active document entries
sqlite3 /tmp/lifeos-manual-test/memory.db "SELECT slot, key, substr(value, 1, 60) FROM memory_items LIMIT 10;"
```

**Verify:**
- [ ] All tables created (vault_index, session_log, memory_items, etc.)
- [ ] session_log contains events recorded during testing
- [ ] vault_index contains the test note
- [ ] memory_items contains active document data

---

## 8. Cross-Session Continuity

Re-enter Claude Code and verify data persists across sessions:

```bash
cd /tmp/lifeos-manual-test
claude
```

> Tell Claude: Call memory_startup, then call memory_recent

**Verify:**
- [ ] Layer 0 summary includes information from previous session
- [ ] memory_recent returns events from the previous session

---

## Cleanup

```bash
rm -rf /tmp/lifeos-manual-test
```

---

## Troubleshooting

| Issue | How to Investigate |
|-------|-------------------|
| MCP Server not connected | Check `.mcp.json` paths; verify `node dist/server.js` starts normally |
| memory_startup errors | Check `lifeos.yaml` exists and has valid format |
| memory_query returns nothing | Call `memory_notify` first to trigger scan; confirm vault_index has data |
| Skills not recognized | Check `.agents/skills/` directory and `CLAUDE.md` skill table |
| Database locked | Ensure no other process holds memory.db (`lsof memory.db`) |
