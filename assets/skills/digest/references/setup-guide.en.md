# Setup Mode Guide

Use this flow when the user first runs `/digest` or explicitly asks for `/digest setup`.

## Trigger Conditions

- no `.md` config files exist under `{system directory}/{digest subdirectory}/`
- the user explicitly runs `/digest setup` or `/digest setup <topic>`

## Conversation Flow

### Step 1: Define the Topic

If the user did not provide a topic name:

```text
What area do you want to track with a weekly digest?

Give me a topic name (for example "LLM Agent", "Spatial AI", "Rust ecosystem", or "quant investing"),
plus the 2-3 subareas you care about most.
```

If the user already supplied a topic name (for example `/digest setup LLM-Agent`), skip this step and go straight to Step 2.

**Output:** decide `topic_name` (English filename) and `topic_display` (user-facing display name).

### Step 2: Understand Preferences

```text
For "{topic_display}", help me understand a few preferences:

1. Content type: more academic papers, more industry updates, or both?
2. Must-read sources: are there blogs, newsletters, or accounts you already follow closely?
3. Focus areas: which subtopics matter most? These will shape the digest categories.
```

### Step 3: Generate the Config

Based on the topic and preferences, use agent capabilities to recommend sources and produce a full config note.

**Generation strategy:**

1. **RSS / Newsletter**
   - verify URLs with WebSearch
   - recommend 5-15 high-quality sources
   - prefer sources that expose RSS feeds

2. **arXiv keywords**
   - generate 10-20 English keywords, including quoted English phrases
   - prefer reasonably narrow arXiv categories such as `cs.AI`, `cs.CL`, `cs.CV`, and `cs.RO`
   - remember that digest now pulls recent arXiv papers by category first, then filters them locally
     with the configured English keywords
   - disable by default for non-academic topics

3. **Web search**
   - design 3-5 query templates for important sources without RSS
   - add 5-10 supplemental sites

4. **HuggingFace**
   - generate filtering keywords for AI / ML topics
   - disable by default for non-AI / ML topics

5. **GitHub Trending**
   - generate filtering keywords for technical topics
   - disable by default for non-technical topics

6. **Category system**
   - generate 5-8 categories from the chosen subareas
   - fix the first category as "Key Papers / Key Articles"
   - fix the last category as "Industry Updates"

**Config note template:**

```markdown
---
title: "{topic_display} Digest"
type: system
created: "{YYYY-MM-DD}"
tags: [digest, subscription]
aliases: []
---

# {topic_display} Digest

## Basic Info

| Field | Value |
|-------|-------|
| Topic | {topic_display} |
| Cadence | Weekly |
| Language | English |

## Sources

### RSS Feeds

- [x] Enabled

| Name | URL | Focus |
|------|-----|-------|
| {name} | {url} | {description} |
...

### arXiv Search

- [x] Enabled

| Keyword | Categories |
|---------|------------|
| {english_keyword} | {categories} |
...

### Web Search

- [x] Enabled

| Query Template | Coverage |
|----------------|----------|
| {query_template} | {target} |
...

**Supplemental Sites (covered via Web search):**

| Name | URL | Focus |
|------|-----|-------|
| {name} | {url} | {description} |
...

### HuggingFace Papers

- [{x_or_space}] Enabled

**Filter keywords:** {keyword1}, {keyword2}, ...

### GitHub Trending

- [{x_or_space}] Enabled

**Filter keywords:** {keyword1}, {keyword2}, ...

## Categories

The digest is organized by the following categories. Omit empty categories:

| Category | Coverage |
|----------|----------|
| {category} | {scope} |
...

## Source List

Automatically appended at the end of each digest.
```

### Step 4: User Review

Write the config note to `{system directory}/{digest subdirectory}/{topic_name}.md`.

```text
Config note created: {system directory}/{digest subdirectory}/{topic_name}.md

Ask the user to review it in Obsidian:
- disable modules they do not want with checkboxes
- keep arXiv keywords in English, then add or remove RSS feeds, arXiv rows, and Web search targets
- adjust the category system

After review, they can run `/digest {topic_name}` to generate the first digest.
```

## Notes

- keep the setup conversation within 3 rounds whenever possible
- source recommendations should include concrete URLs, not only names
- any must-read source mentioned by the user must appear in the config
- non-technical topics such as finance or history should disable arXiv, HuggingFace, and GitHub by default
