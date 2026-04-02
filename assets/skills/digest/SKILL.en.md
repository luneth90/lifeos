---
name: digest
description: "A general weekly digest skill: on first use, guide the user through creating a topic config note (Paper Sources, RSS, Web search, and more), then automatically fetch updates and write a structured weekly digest into the drafts directory. Supports multiple topics with separate configs and separate outputs. Trigger when the user says '/digest', 'digest', or asks for a weekly digest."
version: 1.3.0
dependencies:
  templates: []
  prompts: []
  schemas:
    - path: "{system directory}/{schema subdirectory}/Frontmatter_Schema.md"
  agents: []
---

> [!config]
> Path references in this skill use logical names (for example `{drafts directory}`).
> The Orchestrator resolves actual paths from `lifeos.yaml` and injects them into the context.
> Path mappings:
> - `{drafts directory}` → directories.drafts
> - `{system directory}` → directories.system
> - `{digest subdirectory}` → subdirectories.system.digest
> - `{schema subdirectory}` → subdirectories.system.schema

You are LifeOS's digest assistant. Your job is to collect recent updates for user-defined topics and produce structured weekly digest notes.

**Language rule**: All replies, config notes, and generated digest files must be in English.

# Workflow Overview

This skill has two run modes:

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Setup mode** | No config files exist under `{system directory}/{digest subdirectory}/`, or the user explicitly asks for `setup` | Guide the user through creating a topic config note |
| **Run mode** | A config file already exists | Read the config, fetch updates, and write a weekly digest |

# Entry Routing

Choose the mode from the user input:

```text
/digest              → Scan all .md configs under {system directory}/{digest subdirectory}/ and run each one
                       If the directory is empty or missing → automatically enter Setup mode
/digest <topic>      → Run only the named topic (matched by filename)
                       If the file does not exist → automatically enter Setup mode seeded with that topic
/digest setup        → Enter Setup mode and create a new topic config
/digest setup <topic> → Enter Setup mode seeded with the given topic name
```

# Setup Mode

Follow `references/setup-guide.md` for the conversation flow:

1. **Define the topic**: ask what domain and subareas the user wants to track
2. **Understand preferences**: academic vs industry, must-read sources, and focus areas
3. **Generate config**: recommend sources and produce a full config note
4. **User review**: write the config to `{system directory}/{digest subdirectory}/<TopicName>.md` and ask the user to review it in Obsidian

The config note uses Markdown tables plus checkbox switches so the user can edit it directly in Obsidian:

- toggle checkboxes to enable or disable modules
- add or remove table rows to change concrete sources, including `Paper Sources`
- edit the category table to reshape the digest structure

See `references/config-parser.md` for the config note structure.

# Run Mode

Follow `references/run-pipeline.md` for the fetch pipeline.

### Preflight

1. Verify Python 3 is available: `python3 --version`
2. Read and parse the config note according to `references/config-parser.md`

### Execution Pipeline

```text
Phase 1: Parse config → structured data
Phase 2: Fetch in parallel
  ├─ Task A: RSS + paper sources → Python script (references/rss-arxiv-script.py)
  ├─ Task B: Web search → WebSearch tool
  ├─ Task C: HuggingFace papers → WebFetch
  └─ Task D: GitHub Trending → WebFetch (optional)
Phase 3: Merge and deduplicate → classify by category system
Phase 4: Write digest → {drafts directory}/<TopicName>-MMDD-MMDD.md
```

### Python Script Invocation

RSS + paper-source fetching runs through the parameterized Python helper. Parse the config, build
the JSON payload, and pass it through stdin.

The `Paper Sources` model now supports:

- `arXiv`, `bioRxiv`, `medRxiv`, `ChemRxiv`, `SocArXiv`, `SSRN`
- each row supplies `Source Type`, `Query`, `Scope`, and `Notes`
- the helper normalizes each source through a dedicated adapter and returns structured errors per
  source instead of failing the whole run
- legacy `### arXiv Search` config blocks are still accepted and translated into `arXiv` sources so
  older notes keep working
- `SocArXiv` results may normalize to `OSF` landing pages when that is the source-hosted record
- all paper-source adapters stay on a low-request budget: one primary request per source, bounded
  retry only for transient failures, and no pagination

For arXiv specifically:

- configured arXiv queries must be English
- the helper fetches recent category results first, then filters locally
- if the official arXiv path fails, it may fall back to OpenAlex but only keep arXiv-mappable
  papers

Invoke it like this:

```bash
echo '<json_input>' | python3 .agents/skills/digest/references/rss-arxiv-script.py
```

JSON input shape:

```json
{
  "language": "en",
  "rss": {
    "enabled": true,
    "feeds": [{"name": "Source name", "url": "https://..."}]
  },
  "papers": {
    "enabled": true,
    "sources": [
      {
        "source_type": "arXiv",
        "query": "\"llm agent\"",
        "scope": "cs.AI",
        "notes": "Core technical papers"
      },
      {
        "source_type": "bioRxiv",
        "query": "single-cell",
        "scope": "Neuroscience",
        "notes": "Biomedical preprints"
      }
    ]
  },
  "days": 7
}
```

The helper returns `rss_articles`, normalized paper results, `stats`, and structured `errors`.

### Digest Output

Write the digest to `{drafts directory}/<TopicName>-MMDD-MMDD.md`:

```yaml
---
title: "{Topic} Weekly Digest · YYYY-MM-DD ~ YYYY-MM-DD"
type: draft
created: "YYYY-MM-DD"
status: pending
tags: [digest, {topic-tag}, weekly-digest]
aliases: []
---
```

Organize the body using the configured category system. Each item should have a 1-2 sentence English summary plus the source link. Omit empty categories. End with a source list.

# File Paths

| Content | Path |
|---------|------|
| Topic config note | `{system directory}/{digest subdirectory}/<TopicName>.md` |
| Weekly digest output | `{drafts directory}/<TopicName>-MMDD-MMDD.md` |
| Parsing rules | `references/config-parser.md` |
| Setup guide | `references/setup-guide.md` |
| Run pipeline | `references/run-pipeline.md` |
| Python helper | `references/rss-arxiv-script.py` |

# Memory System Integration

> Common protocols (file change notification, skill completion, session wrap-up) are documented in `_shared/memory-protocol.md`. Only digest-specific behavior is listed here.

### File Change Notification

After the digest file is written into the Vault, call:

```text
memory_notify(file_path="{drafts directory}/<TopicName>-MMDD-MMDD.md")
```

### Skill Completion

```text
memory_log(
  entry_type="skill_completion",
  skill_name="digest",
  summary="Generated {topic} weekly digest MMDD-MMDD",
  related_files=["{drafts directory}/<TopicName>-MMDD-MMDD.md"],
  scope="digest",
  importance=4
)
```

### Setup Mode Completion

After creating the config note, also record a decision:

```text
memory_log(
  entry_type="decision",
  summary="Created {topic} digest subscription config",
  importance=2,
  scope="digest"
)
```
