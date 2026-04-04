# Dual-Agent Orchestration Protocol

This protocol defines the standard orchestration pattern for LifeOS workflows using a "Planning Agent + Execution Agent" two-phase approach.

## Phase 0: Memory Pre-check (Required)

Before launching the Planning Agent, query minimal memory context via MCP tools:

1. Check whether output on the same topic already exists (avoid duplicates)
2. Check whether related drafts exist and their status
3. Check recent related decisions (avoid conflicting with existing direction)

Standard query pattern:
```
memory_query(query="<topic keywords>", filters={"type": "<entity type>"}, limit=5)
memory_query(query="<topic keywords>", limit=10)
```

If a file under {drafts directory}/ is found, read its frontmatter to confirm whether it is still status: pending.

## Phase 1: Launch Planning Agent

1. Read the full contents of `references/planning-agent-prompt.md`
2. Replace user input into the prompt's placeholders
3. Launch the Planning Agent using the Task tool
4. Planning Agent creates the plan file and returns its path

## Phase 2: User Review

1. Notify the user of the plan file path
2. [Skill-specific: clarification questions may be inserted here]
3. Wait for user confirmation

## Phase 3: Launch Execution Agent (After User Confirmation)

1. Read the full contents of `references/execution-agent-prompt.md`
2. Replace the plan file path into the prompt's placeholders
3. Launch the Execution Agent via the Task tool (clean context, reads only the plan file)
4. Report execution results
