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

Update the `status` field of the corresponding note in `{knowledge directory}/` based on this grading result:

| Performance | status Change |
| --- | --- |
| All/most correct (≥80%) | → `mastered` |
| Partially correct (50%-80%) | Maintain `review` (or upgrade from `draft` to `review`) |
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
