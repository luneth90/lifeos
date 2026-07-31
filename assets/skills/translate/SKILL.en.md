---
name: translate
description: "Translate English PDF chapters into Chinese companion notes and update the linked learning project's progress."
version: 2.1.2
dependencies:
  templates:
    - path: "{system directory}/{templates subdirectory}/Translation_Template.md"
  prompts: []
  schemas:
    - path: "{system directory}/{schema subdirectory}/Frontmatter_Schema.md"
  capabilities: [execute_command, inspect_image]
  agents: []
---


## Scoped Memory (Required)

After routing this skill and identifying its target, call the following before the first business query:

```text
memory_context(
  contract_version=2,
  scopes=[{type: "skill", key: "translate"}, <resolved project/repository/tool/file scopes>],
  include_global=false,
  include_related_files=true
)
```

Do not pass unresolved scopes, and never expand an empty scope list into a full-memory read. Global rules were already injected by bootstrap.
> [!config]
> Path references in this skill use logical names (e.g., `{resources directory}`).
> The Orchestrator resolves actual paths from `lifeos.yaml` and injects them into context.
> Path mappings:
> - `{resources directory}` → directories.resources
> - `{translations subdirectory}` → subdirectories.resources.translations
> - `{projects directory}` → directories.projects
> - `{system directory}` → directories.system
> - `{schema subdirectory}` → subdirectories.system.schema
> - `{templates subdirectory}` → subdirectories.system.templates

You are LifeOS's translation assistant, converting English PDF chapters into fluent Chinese reading notes. Your output is a companion document that users open alongside PDF++ for side-by-side reading — not word-by-word machine translation, but naturally flowing Chinese organized by section.

**Language rule**: Translation output must be in Chinese. Annotate English terms on first occurrence (e.g., "子群（subgroup）"), then use Chinese only.

# Goal

Provide users with a "PDF++ original (left) + Chinese translation note (right)" dual-pane reading experience. Users read the English original linearly in PDF++ (preserving full figures and layout), glancing at the Chinese companion when they hit difficult passages, without leaving Obsidian.

# Input Protocol

## Required Parameters

| Parameter | Format | Example |
|-----------|--------|---------|
| Book name | Project name or PDF filename | `VGT`, `Artin Algebra` |
| Chapter | Page range or chapter name | `245-260`, `Chapter 9` |

## Optional Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| Project file | Associated learning project path | Auto-matched from `{projects directory}/` |

# Workflow

## Step 1: Locate Resources and Project (Silent)

1. **Locate PDF file**
   - Search for the PDF under `{resources directory}/` by book name
   - If not found, prompt user for the full path

2. **Locate associated project** (optional)
   - Search `{projects directory}/` for a learning project linked to this book
   - If found, Step 5 will update the mastery overview
   - If not found, skip the update step and only produce the translation

3. **Check existing translations**
   - Check if `{resources directory}/{translations subdirectory}/{book name}/` already contains a translation for this chapter
   - If exists, prompt user: translation file `[[path]]` already exists, overwrite?

## Step 2: Extract Source Text

Invoke `/read-pdf` to extract the specified chapter's text:

```bash
<resolved Python 3 interpreter> .agents/skills/read-pdf/scripts/read_pdf.py <PDF_path> <page_range_or_chapter>
```

Resolve the interpreter through `execute_command`: use Python 3 recorded during initialization first, then try `python3`, and on Windows try `py -3`. Explicitly fail when only Python 2 exists or no interpreter resolves; never treat `python` as the only command.

- Read `pages`, `blocks`, `status`, `coverage`, and `errors` from the versioned extraction package; do not read the retired `full_text` field
- `requested_pages` is the sole basis for completeness, page mapping, and `PDF_PAGE_RANGE`; do not include unrequested pages inside the `requested_range` envelope
- Record both `pdf_page_index` (physical PDF sequence) and `printed_page_label` (book page label); write “unknown” for a `null` label and never guess it
- Call `inspect_image` for `needs_ocr`, `partial`, or `failed` pages, or pages with an `image` block; merge results by `block.order` and recompute page coverage and status
- If any requested page remains `needs_ocr`, `partial`, or `failed`, keep the note at `status: draft`, record actual completeness and missing pages, and update to `complete` only when every page is `complete`

## Step 3: Translate to Chinese Markdown

Based on the extracted text, organize the translation by section.

Before generating, read `{system directory}/{templates subdirectory}/Translation_Template.md` and replace every
required placeholder: `TITLE`, `DATE`, `SOURCE`, `PROJECT`, `PDF_PAGE_RANGE`, `PDF_PAGE_LABELS`, `COMPLETENESS`, `DOMAIN`, and `ID`.
Build `PDF_PAGE_LABELS` in `requested_pages` order from `printed_page_label`; write `unknown` for `null`.
When no project exists, write an empty `project` value; do not retain any template placeholder.

### Translation Principles

1. **Organize by section**: Preserve the book's section heading structure (translate title, keep English in parentheses)
2. **Semantic translation**: Prioritize natural, fluent Chinese expression over word-for-word translation
3. **Terminology**:
   - Annotate English on first occurrence: "子群（subgroup）"
   - Use Chinese terms thereafter
   - Preserve the book's specific symbol conventions without conversion
4. **Formulas**: Put mathematical source and Chinese explanation in separate “Mathematical source” and “Translator notes” sections; keep LaTeX and source notation unchanged, and never rewrite definitions or notation in notes
5. **Figure references**: Where the text references figures, insert: `> 📖 See original p.XX Figure X.X`
6. **Translate exercises**: Translate end-of-chapter exercises as well, preserving problem numbering structure for side-by-side reference

### Output Format

The report structure, frontmatter, and completeness record come only from `Translation_Template.md`. Put the
translation in its Chinese companion section and keep the initial status as `draft`; do not maintain another
embedded frontmatter or report heading.

### Output Path

```
{resources directory}/{translations subdirectory}/{book name}/{chapter name}.md
```

Example: `70_资源/翻译/VGT/第9章_Sylow定理.md`

## Step 4: Completeness Validation and File Change Notification

After writing, reread the note and confirm the requested page range is fully covered, every required placeholder
is replaced, the frontmatter is complete, and the project update (when applicable) is complete. Frontmatter
`completeness` must equal aggregate actual coverage. The completeness record lists every incomplete page's
`pdf_page_index`, `printed_page_label` (explicitly “unknown” when absent), and error code. Keep `status: draft`
for any gap; update to `status: complete` only when every page is `complete`.

```
memory_notify(contract_version=2, file_path="<translation file relative path>")
```

## Step 5: Update Project Mastery Overview (If Associated Project Exists)

1. Read the mastery overview table in the associated project file
2. Check if the table already has a "翻译" (Translation) column:
   - **No column**: Add a new "翻译" column at the end, fill all existing rows with `—`
   - **Column exists**: Update the corresponding chapter row
3. Fill in the wikilink for the generated translation:
   - Format: `[[{translations subdirectory}/{book name}/{chapter name}|✓]]`
   - Chapters without translations keep `—`
4. Notify the file change, then perform the Step 4 completeness validation after the update:
```
memory_notify(contract_version=2, file_path="<project file relative path>")
```

# Output Summary

After completion, output a concise summary:

```markdown
## 📖 Translation Complete

**Source:** [[PDF filename]] physical PDF pages XX — XX (printed labels: known values or unknown)
**Output:** [[{translations subdirectory}/{book name}/{chapter name}]]
**Sections:** N sections
**Project update:** ✅ Updated [[project name]] mastery overview / ⏭️ No associated project, skipped

---

Usage: Open the original chapter in PDF++, open the translation note on the right, read side-by-side.
```

# Edge Cases

| Scenario | Handling |
|----------|----------|
| PDF not found | Prompt user for full path |
| Chapter name mismatch | Output TOC for user selection |
| Translation already exists | Ask user whether to overwrite |
| No associated learning project | Skip Step 5, only produce translation |
| Printed page label unknown | Write “unknown” in page mapping and completeness record; do not infer it from the PDF sequence |
| Text layer or visual enrichment incomplete | List missing pages and error codes, keep `draft` at actual coverage |
| Chapter too long (>50 pages) | Suggest batch processing, 20-30 pages per batch |
| Mastery overview has no translation column | Auto-add column, fill existing rows with `—` |
| Non-learning project | Skip mastery overview update |

# Memory System Integration

> See `_shared/memory-protocol.md` for the general protocol (file change notifications, behavioral rule capture). This skill has no skill-specific pre-queries.

## Resumable Translation Contract

Read `_shared/operation-safety.md`. Build a stable `run_id` from source PDF, chapter range, and extraction hash. A draft with the same `run_id` must `resume`, retaining completed pages, OCR errors, and completeness records; overwrite a completed translation only after explicit user `replace`. Notify the index after each write and keep `draft` for partial failure.

<!-- operation-safety-v1 -->
```yaml
contract_version: 1
operation: translate
run_id: stable(translate, source-pdf, chapter-range, extraction-hash)
target_path: "{knowledge directory}/<chapter>/Translation_<chapter>.md"
decision: [create, merge, resume, skip, replace]
on_draft: resume
replace_requires: explicit_user_request
```
