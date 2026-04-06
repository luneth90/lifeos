# Template Loading Protocol

This protocol applies to all skills that need to read Vault template files.

## Loading Rules

1. Before generating any content, you **must** use file reading capabilities to read the exact template file from the Vault
2. **Never guess template structure** — even if you "remember" the template content, you must re-read it
3. After reading, note the following key elements:
   - Obsidian Callouts format (`> [!info]`, `> [!note]`, etc.)
   - Frontmatter field structure and required fields
   - Block markers and separators

## AI Instruction Comment Handling

If a template contains AI instructions in HTML comment form (`<!-- AI instruction: ... -->`):

1. You **must execute** the instruction and generate the corresponding block content
2. The `<!-- AI instruction: ... -->` comment **must never appear** in the final output
3. Comments must be replaced with the generated content

## Template Routing

| Scenario | Template |
| --- | --- |
| Daily journal | `Daily_Template.md` |
| Draft | `Draft_Template.md` |
| Wiki | `Wiki_Template.md` |
| Project file | `Project_Template.md` |
| Review record | `Revise_Template.md` |
| General knowledge note | `Knowledge_Template.md` |
| In-depth research report | `Research_Template.md` |
| Periodic retrospective | `Retrospective_Template.md` |

## Template Path Resolution

Template paths are resolved via `lifeos.yaml` configuration:
- Template directory: `{system directory}/{template subdirectory}/`
- Specific template filenames are declared in each skill's `dependencies.templates`
