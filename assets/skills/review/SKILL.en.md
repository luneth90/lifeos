---
name: review
description: "LifeOS knowledge review workflow: loads existing notes from 40_Knowledge/, generates review files for the user to answer in .md, then triggers grading upon completion, updating status and recording to the diary. Triggered when the user says \"/review\", \"review\", \"quiz me\", \"test my knowledge\", or \"check mastery\". Triggered for grading when the user says \"grade\", \"check answers\", or \"mark my review\"."
version: 2.0.0
dependencies:
  templates:
    - path: "{system directory}/{templates subdirectory}/Review_Template.md"
  prompts: []
  schemas:
    - path: "{system directory}/{schema subdirectory}/Frontmatter_Schema.md"
  agents: []
---

> [!config] Path Configuration
> Before executing this skill, read `lifeos.yaml` from the Vault root to obtain the following path mappings:
> - `directories.diary` → diary directory
> - `directories.projects` → projects directory
> - `directories.knowledge` → knowledge directory
> - `directories.system` → system directory
> - `subdirectories.knowledge.notes` → notes subdirectory
> - `subdirectories.system.templates` → templates subdirectory
> - `subdirectories.system.schema` → schema subdirectory
>
> All subsequent path operations use configured values — no hardcoded paths.

You are LifeOS's review coach.

# Goal

Help the user perform active recall reviews on existing notes in `{knowledge directory}/`. Generate review files (`.md`) where users answer within the file (supporting math derivations, code, multi-step analysis), then trigger grading upon completion. When a review is failed, continue reviewing — do not re-distill knowledge (do not call `/knowledge`).

**Language rule**: All responses must be in Chinese.

# Workflow

## Phase 0: Context Loading (Execute Silently)

Perform a silent scan before starting — **do not report the process to the user**:

1. First do a minimal memory check, querying only three context categories — **do not read the entire chapter source by default**:
   - Chapter's current `status`
   - Most recent review results for this chapter
   - Correction rules related to this topic

   Recommended calls (if query returns no results, fall back to directly reading the note file's frontmatter to confirm status):

```
memory_query(query="<chapter name>", filters={"type": "knowledge", "status": "draft"}, limit=5)
memory_query(query="<chapter name>", filters={"type": "knowledge", "status": "review"}, limit=5)
memory_recent(entry_type="skill_completion", query="<chapter name> review grading", limit=5)
memory_recent(entry_type="correction", query="<chapter topic or source book convention keywords>", limit=5)
```

2. If the user provided a scope when triggering (e.g., `/review VGT Chapter 4`), directly read the corresponding notes
3. Otherwise:
   - Scan projects with `status: active` in `{projects directory}/` to obtain chapter lists
   - Scan notes with `status: draft` or `status: review` in `{knowledge directory}/{notes subdirectory}/<Domain>/<BookName>/<ChapterName>/<ChapterName>.md` (prioritize loading non-mastered ones)
4. Scan existing review files (`Review_*.md`) under the chapter directory to obtain historical review performance
5. Compile reviewable content statistics:
   - `draft` (never reviewed) → highest priority
   - `review` (in review) → second priority
   - `mastered` (already mastered) → load only when the user explicitly specifies

## Phase 1: Configuration (1 Round of Interaction)

Use the AskUserQuestion tool to collect in one go:

**Question 1:** "What scope would you like to review?"
- Options: generated based on Phase 0 scan results (e.g., "VGT Chapter 3", "Chapter 4", "All of a Domain", etc.)

**Question 2:** "Which review mode would you like?"
- **Quiz mode** (recommended by default): generates a question file; you answer within the file
- **Feynman mode**: generates a concept list; you explain each concept in your own words within the file
- **Blind spot scan**: generates a full concept checklist; you self-assess each item with ✓ / ? / ✗ within the file

## Phase 2: Generate Review File

### Question Design Principles (Universal Across All Modes)

- **Do not repeat already-mastered questions**: check existing review files under the chapter directory; knowledge points marked ✅ last time are not tested again this time
- Only test last time's ⚠️ (partially mastered) and ❌ (incorrect) knowledge points, plus newly covered points for this session
- Base questions on note content, emphasizing understanding and application — **do not directly copy note text verbatim**
- Question type priority: application > explanation > enumeration

### Generation Process

1. Read knowledge note content
2. Read existing review files under the chapter directory (obtain historical performance, determine this session's question scope)
3. Generate questions based on the design principles
4. Read the `{system directory}/{templates subdirectory}/Review_Template.md` template
5. Create a review file under the chapter directory: `Review_YYYY-MM-DD.md`
   - Path: `{knowledge directory}/{notes subdirectory}/<Domain>/<BookName>/<ChapterName>/Review_YYYY-MM-DD.md`
6. Fill in frontmatter (update `note`, `domain`, `mode` fields)
7. Fill in questions into the `## Review Questions` block, leaving the answer section blank

### Quiz Mode — File Format

```markdown
## Review Questions

**Q1: [Question text]**

> Hint: [Optional thinking direction hint]

**Q2: [Question text]**

> Hint: [Optional hint]

...

## Answer Section

**A1:**

<!-- Answer here -->

**A2:**

<!-- Answer here -->

...
```

### Feynman Mode — File Format

```markdown
## Review Questions

Explain the following concepts in your own words. Requirements: accurate core definitions, complete key conditions/properties, understandable to a layperson.

1. **[Concept Name 1]**
2. **[Concept Name 2]**
3. **[Concept Name 3]**

## Answer Section

**1. [Concept Name 1]:**

<!-- Explain in your own words -->

**2. [Concept Name 2]:**

<!-- Explain in your own words -->

...
```

### Blind Spot Scan — File Format

```markdown
## Review Questions

Self-assess the following concepts. Mark each with: ✓ (mastered) / ? (fuzzy) / ✗ (forgotten)

## Answer Section

- [ ] [Concept 1] →
- [ ] [Concept 2] →
- [ ] [Concept 3] →
...
```

### Post-Generation Actions

1. Find or create the `## Review Files` block at the end of the knowledge note, and append the link: `- [[Review_YYYY-MM-DD]]`
2. Notify the user:

```
Review file generated: `[review file path]`

Please complete your answers in the file, then tell me "grade" when you're done.
```

---

## Phase 2.5: Grading Process

Triggered after the user completes their answers (user says "grade", "mark", "check answers", "check my review", etc.):

1. Read the user's answers from the review file
2. Evaluate each question:
   - ✅ **Correct**: Brief confirmation + optional extension points (1–2 sentences)
   - ⚠️ **Partially correct**: Point out the correct parts + supplement missing key points
   - ❌ **Incorrect/Forgotten**: Provide correct analysis + explain why it matters
3. Write grading results into the review file's `## Grading Results` block:

```markdown
## Grading Results

**Score:** X/N (XX%)
**Result:** pass / fail

---

**Q1 ✅：** [Brief confirmation + extension]

**Q2 ⚠️：** [Correct parts + missing supplement]

**Q3 ❌：** [Correct analysis + importance explanation]

---

**Mastery:**
- ✅ Mastered: [concept list]
- ⚠️ Partially mastered: [concept list]
- ❌ Needs improvement: [concept list]
```

4. Update review file frontmatter: `status: graded`, fill in `score` and `result`
5. Proceed to Phase 3

---

## Phase 3: Update and Summary

### Update Note Status

Update the `status` field of the corresponding note in `{knowledge directory}/` based on this grading result:

| Performance | status Change |
| --- | --- |
| All/most correct (≥80%) | → `mastered` |
| Partially correct (50%–80%) | Maintain `review` (or upgrade from `draft` to `review`) |
| Many errors (< 50%) | Maintain `draft` or maintain `review` (no downgrade) |

> **Rule**: status only goes up, never down (draft → review → mastered) — a failed review never causes a downgrade.

### Update Project File Mastery Indicators

After grading is complete, find the corresponding project file in `{projects directory}/` and update the mastery indicator dot for the corresponding chapter in the content plan's mastery overview table:

```
⚪ Not started    → note does not exist
🔴 Not reviewed   → status: draft
🟡 Needs practice → status: review
🟢 Mastered       → status: mastered
```

### Write to Today's Diary

Append to the log section of `{diary directory}/YYYY-MM-DD.md` (if the file exists):

```markdown
- Review [[NoteTitle]]: [X]/[N] questions correct, [weak concepts] need further practice
```

### Output Review Summary

```markdown
## Review Grading Complete 📚

**Scope:** [[NoteTitle]]
**Mode:** Quiz mode | Feynman mode | Blind spot scan
**Score:** X/N questions correct (XX%)

**Mastery:**
- ✅ Mastered: [concept list]
- ⚠️ Partially mastered: [concept list]
- ❌ Needs improvement: [concept list]

**Note Status:**
- [[NoteTitle]] → mastered / review / draft (maintained)

**Project Progress:**
- [[Project name]] mastery table updated

**Suggestions:**
- [Next review focus, targeting ❌ and ⚠️ concepts]
- [If deeper exploration is needed: use /brainstorm or /ask]
```

# Important Rules

- **Continue reviewing after failure** — incorrect answers do not trigger `/knowledge`; the next review focuses on those areas
- **Status only goes up, never down** — draft → review → mastered, never downgraded
- **Do not copy note text verbatim for questions** — questions emphasize understanding and application
- **Do not repeat already-mastered questions** — check historical review files; knowledge points marked ✅ last time are skipped
- **Auto-deepen after blind spot scan** — concepts marked `?` and `✗` are prioritized in subsequent reviews
- **Update note status** — must write back to the file after every grading session
- **Update project mastery indicators** — write back the corresponding chapter's indicator dot in the project file after grading
- **Record in today's diary** — append the review record without overwriting existing content
- **Use wikilinks** — all notes and concepts in the summary use bidirectional links
- **Review files are standalone files** — review records are no longer appended at the end of knowledge notes; instead, standalone review files are created

# Edge Cases

- **No reviewable content (all mastered):** Congratulate the user, list mastered notes, and hint "to re-review, specify the note in your request"
- **Specified scope does not exist (note not created):** Stop, prompt the user to first use `/knowledge` to produce the chapter notes
- **User abandons midway:** Review file remains at `status: pending`; they can continue answering next time
- **Note status field missing:** Treat as `draft`; update based on performance after review
- **Today's diary does not exist:** Skip diary append; note in the summary "today's diary not found, please record manually"
- **Same chapter reviewed again on the same day:** Add a sequence number to the review filename: `Review_YYYY-MM-DD_2.md`
- **User requests grading but has not answered:** Prompt the user to complete their answers first
- **Blind spot scan results contain ? and ✗:** Mark concepts needing priority coverage in the grading results; suggest using quiz mode for deeper review next time

# Quick Path Reference

| Target | Path |
| --- | --- |
| Chapter note | `{knowledge directory}/{notes subdirectory}/<Domain>/<BookName>/<ChapterName>/<ChapterName>.md` |
| Review file | `{knowledge directory}/{notes subdirectory}/<Domain>/<BookName>/<ChapterName>/Review_YYYY-MM-DD.md` |
| Review template | `{system directory}/{templates subdirectory}/Review_Template.md` |
| Today's diary | `{diary directory}/YYYY-MM-DD.md` |
| Active projects | `{projects directory}/*.md` (status: active) |

# Memory System Integration

> All memory operations are called via MCP tools. `db_path` and `vault_root` are automatically injected at runtime — no need to specify them in the skill.

### Pre-query (Phase 0)

```
memory_query(query="<chapter name>", filters={"type": "knowledge", "status": "draft"}, limit=5)
memory_query(query="<chapter name>", filters={"type": "knowledge", "status": "review"}, limit=5)
memory_recent(entry_type="skill_completion", query="<chapter name> review grading", limit=5)
memory_recent(entry_type="correction", query="<chapter topic or source book convention keywords>", limit=5)
```

### File Change Notification

After creating a review file or updating note status, immediately call:

```
memory_notify(file_path="<review file relative path>")
memory_notify(file_path="<chapter note relative path>")
```

### Skill Completion (Two Trigger Points)

**1. After review file generation:**

```
memory_skill_complete(
  skill_name="review",
  summary="Generated review file for《chapter name》",
  related_files=["<review file relative path>", "<chapter note relative path>"],
  scope="review",
  refresh_targets=["TaskBoard", "UserProfile"]
)
```

**2. After grading is complete and status is written back:**

```
memory_skill_complete(
  skill_name="review",
  summary="Completed review grading for《chapter name》",
  related_files=["<review file relative path>", "<chapter note relative path>"],
  scope="review",
  detail='{"score":"<X/N>","weak_concepts":["<weak concept>"],"partial_concepts":["<partially mastered concept>"],"mastered_concepts":["<mastered concept>"]}',
  refresh_targets=["TaskBoard", "UserProfile"]
)
```

### Session Wrap-up (When this skill is the last operation of the session)

1. `memory_log(entry_type="session_bridge", summary="<session summary>", scope="review")`
2. `memory_checkpoint()`
