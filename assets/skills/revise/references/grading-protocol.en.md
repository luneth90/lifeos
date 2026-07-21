# Grading and Update Protocol

> Complete grading process and update rules extracted from `SKILL.en.md`.

## Phase 2.5: Grading Process

Triggered after the user completes their answers (user says "grade", "mark", "check answers", "check my review", etc.):

1. Read the user's answers from the review file
2. Evaluate each question:
   - ✅ **Correct**: Brief confirmation + optional extension points (1-2 sentences)
   - ⚠️ **Partially correct**: Point out the correct parts + supplement missing key points
   - ❌ **Incorrect/Forgotten**: Provide correct analysis + explain why it matters
3. Write grading results into the review file's `## Grading Results` block:

```markdown
## Grading Results

**Score:** X/N (XX%)
**Result:** pass / fail

---

**Q1 ✅:** [Brief confirmation + extension]

**Q2 ⚠️:** [Correct parts + missing supplement]

**Q3 ❌:** [Correct analysis + importance explanation]

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

Update the corresponding note in `{knowledge directory}/` from its pre-grading state. The score records weaknesses and determines eligibility for later mastery; it does not control the first transition:

| Status before grading | Condition | Status after grading |
| --- | --- | --- |
| `review` | The first review has been graded completely | `revised` (regardless of score) |
| `revised` | The user explicitly requested a later independent review, scored at least 80%, and cleared every prior weakness | `mastered` |
| `revised` | Any of those conditions is not met | Keep `revised` |
| `mastered` | The user explicitly requested a retest | Keep `mastered` |

> **Rule**: knowledge status only advances (`draft → review → revised → mastered`). `draft` is not eligible for `/revise`, and a first complete grading pass never jumps directly from `review` to `mastered`.

### Update Project File Mastery Indicators

After grading is complete, find the corresponding project file in `{projects directory}/` and update the mastery indicator dot for the corresponding chapter in the content plan's mastery overview table:

```
⚪ Not started    → note does not exist
🔴 Curation in progress → status: draft
🟠 Awaiting review → status: review
🟡 Revised, needs reinforcement → status: revised
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
- [[NoteTitle]] → revised / mastered (updated by this protocol)

**Project Progress:**
- [[Project name]] mastery table updated

**Suggestions:**
- [Next review focus, targeting ❌ and ⚠️ concepts]
- [If deeper exploration is needed: use /brainstorm or /ask]
```
