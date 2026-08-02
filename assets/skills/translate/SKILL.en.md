---
name: translate
description: "Translate English PDF chapters into Chinese companion notes and update the linked learning project's progress."
version: 2.2.4
dependencies:
  templates:
    - path: "{system directory}/{templates subdirectory}/Translation_Template.md"
  prompts: []
  schemas:
    - path: "{system directory}/{schema subdirectory}/Frontmatter_Schema.md"
    - path: "{system directory}/{schema subdirectory}/PDF_Extraction_Schema.json"
  protocols:
    - path: ../_shared/operation-safety.md
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

You are LifeOS's translation assistant, converting English PDF chapters into fluent Chinese notes that can be read directly. The result is not word-by-word machine translation: it is natural Chinese organized by section, with reliable figures, formulas, and tables restored at the corresponding translated positions.

**Language rule**: Translation output must be in Chinese. Annotate English terms on first occurrence (e.g., "子群（subgroup）"), then use Chinese only.

# Goal

Make the Chinese translation note as self-contained as practical for ordinary reading: present text, formulas, tables, and reliably cropped visuals in place. Keep PDF++ as the source-verification entry point and as the destination of automatic source-reference fallbacks when a visual cannot be cropped or anchored, but do not require permanent side-by-side reading.

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
The translation note begins at `status: draft` and changes state only after both the semantic gate below and final file validation pass.

Do not reorder the following sequence:

1. Read `pages`, `blocks`, `page_size`, `status`, `coverage`, and `errors` from the validated v2
   package; never read the retired `full_text` field. `requested_pages` is the sole basis for
   completeness and `PDF_PAGE_RANGE`; never include an unrequested page merely because
   it lies inside the `requested_range` envelope.
2. Before any `inspect_image` call or block merge, persist every initial `image` block in the run-local
   `initial_image_blocks` inventory. Each item retains exactly
   `{pdf_page_index, order, bbox}` and uses `(pdf_page_index, order)` as its candidate key. Never
   reconstruct this inventory from the semantically merged package, and do not add a Frontmatter field for it.
3. For every `needs_ocr`, `partial`, or `failed` page, and every page that initially contains an `image`
   block, call `inspect_image` on the full-page render to complete OCR and the semantic content of
   formulas, tables, and charts. Merge by `block.order`, then recompute coverage, state, errors, and
   summary. This step establishes semantic completeness only; it performs no local crop or Markdown embed.
4. Write the semantically enriched package back to JSON and immediately run the strict completeness gate:

```bash
<resolved Python 3 interpreter> .agents/skills/read-pdf/scripts/validate_pdf_extraction.py <JSON output path> --schema "{system directory}/{schema subdirectory}/PDF_Extraction_Schema.json" --require-complete
```

A nonzero exit is `semantic_failure` → `status: draft`: stop all subsequent crop and embed work, record
actual completeness, missing pages, and diagnostics, and never use a source hint to bypass the content
gate. Proceed to Step 3 only after exit status 0; a later presentation failure must not be rewritten as a
semantic failure.

## Step 3: Translate to Chinese Markdown

Based on the extracted text, organize the translation by section.

Before generating, read `{system directory}/{templates subdirectory}/Translation_Template.md` and replace every
required placeholder: `TITLE`, `DATE`, `SOURCE`, `PROJECT`, `PDF_PAGE_RANGE`, `COMPLETENESS`, `DOMAIN`, and `ID`.
When no project exists, write an empty `project` value; do not retain any template placeholder.

### Translation Principles

1. **Organize by section**: Preserve the book's section heading structure (translate title, keep English in parentheses)
2. **Semantic translation**: Prioritize natural, fluent Chinese expression over word-for-word translation
3. **Terminology**:
   - Annotate English on first occurrence: "子群（subgroup）"
   - Use Chinese terms thereafter
   - Preserve the book's specific symbol conventions without conversion
4. **Formulas**: Put mathematical source and Chinese explanation in separate “Mathematical source” and “Translator notes” sections; keep LaTeX and source notation unchanged, and never rewrite definitions or notation in notes
5. **Visual results**: Apply the five-way automatic handling below; do not replace every visual with a source hint
6. **Translate exercises**: Translate end-of-chapter exercises as well, preserving problem numbering structure for side-by-side reference

### Automatic Visual Presentation (Required)

After the strict completeness gate passes, traverse `initial_image_blocks` in physical-page and `order`
sequence. Combine each candidate with its completed visual semantics and assign it to exactly one class:

| Classification | Automatic handling |
| --- | --- |
| `embed` | A chart, diagram, photograph, or other visual whose form matters and whose boundary is reliable; crop and embed it |
| `markdown` | A table that can be represented faithfully; write a Markdown table in place and create no image asset |
| `latex` | A formula or formula group; write source-faithful LaTeX in place and create no image asset |
| `ignore` | A header ornament, separator, or nonsemantic icon; emit no body content |
| `reference` | A boundary, crop, or translation anchor that cannot be resolved automatically and reliably; emit only a source-location hint |

For an `embed` candidate, execute this fully automatic flow. Never ask the user to draw a box, inspect a
draft, or confirm the result:

1. Take the first 12 characters of `source.sha256`. Use the stable asset path
   `{resources directory}/{translations subdirectory}/<book-name>/assets/<source-sha12>-p<page>-b<order>.png`,
   where `page` is the physical page and `order` is the initial `block.order`.
2. First render with 12 PDF points of padding:

```bash
<resolved Python 3 interpreter> .agents/skills/read-pdf/scripts/crop_pdf_region.py <PDF path> <physical page> --bbox <x0> <y0> <x1> <y1> --padding 12 --dpi 300 --output <stable PNG path>
```

3. Use `inspect_image` to verify automatically that the crop retains the full subject, axes, legend, and
   required labels. If the first command fails or the inspection detects critical edge clipping, retry the
   same stable path with `--padding 36`. If the second attempt still fails or remains incomplete, delete
   the unreferenced candidate asset created by this run and reclassify it as `reference`; never embed a
   full-page screenshot.
4. After a crop passes, insert it by anchor priority: after the first translated paragraph whose source
   explicitly cites the figure number, then after the translated paragraph corresponding to the preceding
   source `text` block. Use only the Vault-relative form `![[<image path>|720]]`, followed by
   `> 图 X.X`; without a reliable figure number, write `> 原书图表`. Never invent a figure number.
5. If neither anchor is reliable, do not embed the image. Emit a `reference` hint at the end of the owning
   subsection. Here `crop_or_anchor_failure` → `reference`; this presentation downgrade counts as handled
   and does not change semantic completeness or note state.

Generate every `reference` automatically. With a reliable figure number, write `> 📖 见原书图 X.X`.
Without one, write `> 📖 见原书相关图表（PDF 物理页 XX，block.order N）`. Never fabricate a figure number
and never leave an item awaiting manual confirmation.

When resuming the same `run_id`, use the candidate key and stable filename to detect an existing embed,
Markdown table, LaTeX block, or source hint; complete it in place without appending a duplicate. Before
finishing, clean up only assets that this run created for candidates in its `initial_image_blocks` set and
that no translation Markdown references. Never delete an image outside the current candidate set, an image
that existed before this run, or any other file merely because it shares the source digest.

### Output Format

The report structure, frontmatter, and completeness record come only from `Translation_Template.md`. Put the
translation in its Chinese companion section and keep the initial status as `draft`; do not maintain another
embedded frontmatter or report heading.

### Output Path

```
{resources directory}/{translations subdirectory}/<book-name>/<chapter-name>.md
```

Example: `{resources directory}/{translations subdirectory}/VGT/第9章_Sylow定理.md`

## Step 4: Completeness Validation and File Change Notification

After writing, reread the note and confirm the requested page range is fully covered, every required placeholder
is replaced, the frontmatter is complete, and the project update (when applicable) is complete. Frontmatter
`completeness` must equal aggregate semantic coverage. The completeness record lists every semantically
incomplete page's `pdf_page_index` and error code. It also records the fixed five-way visual counts and, for
every `reference`, its physical page, figure number or `block.order`, and automatic downgrade reason.

The Step 2 `--require-complete` result is the sole content gate for state transition. On `semantic_failure`,
keep `status: draft`. When the gate exits 0 and the template, page range, placeholders, and project update all
validate, update to `status: complete`. A `reference` counts as a presented visual: crop or anchor downgrade
alone neither reduces `completeness` nor blocks completion. If any semantic extraction data changes after the
gate, rerun that same gate first. Never bypass it using prose judgment, `summary.complete_pages`, or average coverage.

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

**Source:** [[PDF filename]] physical PDF pages XX — XX
**Output:** [[{translations subdirectory}/{book name}/{chapter name}]]
**Sections:** N sections
**Visual handling:** 嵌入 N；转 Markdown N；转 LaTeX N；原书提示 N；忽略装饰 N
**Project update:** ✅ Updated [[project name]] mastery overview / ⏭️ No associated project, skipped

---

Usage: Read the Chinese note directly. Open PDF++ only when verifying the source or following a source-reference hint.
```

# Edge Cases

| Scenario | Handling |
|----------|----------|
| PDF not found | Prompt user for full path |
| Chapter name mismatch | Output TOC for user selection |
| Translation already exists | Ask user whether to overwrite |
| No associated learning project | Skip Step 5, only produce translation |
| Text layer or visual enrichment incomplete | List missing pages and error codes, keep `draft` at actual coverage |
| Visual boundary or both crop attempts remain unreliable | Emit a source hint automatically; never embed a full page or await manual confirmation |
| No reliable translation anchor | Emit the source hint at the end of the owning subsection and remove the unreferenced candidate asset from this run |
| Chapter too long (>50 pages) | Suggest batch processing, 20-30 pages per batch |
| Mastery overview has no translation column | Auto-add column, fill existing rows with `—` |
| Non-learning project | Skip mastery overview update |

# Memory System Integration

> See `_shared/memory-protocol.md` for the general protocol (file change notifications, behavioral rule capture). This skill has no skill-specific pre-queries.

<!-- translate-visual-contract-v1 -->
```yaml
contract_version: 1
candidate_source: initial_image_blocks
geometry_fields: [pdf_page_index, block.order, block.bbox]
classifications: [embed, markdown, latex, ignore, reference]
crop:
  script: read-pdf/scripts/crop_pdf_region.py
  padding_points: [12, 36]
  exhausted: reference
  full_page_fallback: forbidden
assets:
  filename: <source-sha12>-p<page>-b<order>.png
  link_style: vault_relative_obsidian_embed
  width: 720
anchors: [explicit_figure_reference, previous_text_block, subsection_reference]
completion:
  semantic_failure: draft
  crop_or_anchor_failure: reference
  reference_counts_as_presented: true
  manual_confirmation: forbidden
cleanup:
  retain: referenced_assets_only
```

## Resumable Translation Contract

Read `_shared/operation-safety.md`. Build a stable `run_id` from source PDF, chapter range, and extraction hash. A draft with the same `run_id` must `resume`, retaining completed pages, OCR errors, candidate-key visual results, and completeness records; overwrite a completed translation only after explicit user `replace`. Notify the index after each write and keep `draft` for semantic partial failure.

<!-- operation-safety-v1 -->
```yaml
contract_version: 1
safety_protocol: operation-safety-v1
operation: translate
run_id: stable(translate, source-pdf, chapter-range, extraction-hash)
target_path: "{resources directory}/{translations subdirectory}/<book-name>/<chapter-name>.md"
decision: [create, merge, resume, skip, replace]
on_draft: resume
replace_requires: explicit_user_request
```
