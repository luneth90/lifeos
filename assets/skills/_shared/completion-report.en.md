# Skill Completion Report Style Guide

All skills should output a completion report following a unified structure, allowing users to quickly scan results.

## Standard Structure

```markdown
## [Action] Complete

**Created/Modified:**
- [[File Name]] — path: `<relative path>`
- [[File Name]] — path: `<relative path>`

**Status Updates:**
- [[Source File]] → status updated to `<new status>`
- (Omit this section if no status changes)

**Suggested Next Steps:**
- [Related skill suggestions, e.g. `/review` for review, `/archive` for archiving]
- (Only list when there are clear follow-up actions)
```

## Formatting Rules

- Title uses `## [Action] Complete`, no emoji
- File references use wikilinks `[[File Name]]` + path
- Status changes explicitly note source and target status
- Suggested next steps list only the most relevant 1-3 skills
- Do not repeat full file contents (unless the user requests it)
- Output in the user's language
