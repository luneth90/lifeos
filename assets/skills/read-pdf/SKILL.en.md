---
name: read-pdf
description: "Extract PDF text, figures, formulas, and tables by page range or chapter for use by other LifeOS skills."
version: 2.1.2
dependencies:
  templates: []
  prompts: []
  schemas:
    - path: "{system directory}/{schema subdirectory}/PDF_Extraction_Schema.json"
  scripts:
    - path: scripts/read_pdf.py
    - path: scripts/validate_pdf_extraction.py
  capabilities: [execute_command, inspect_image]
  agents: []
---


## Scoped Memory (Required)

After routing this skill and identifying its target, call the following before the first business query:

```text
memory_context(
  contract_version=2,
  scopes=[{type: "skill", key: "read-pdf"}, <resolved project/repository/tool/file scopes>],
  include_global=false,
  include_related_files=true
)
```

Do not pass unresolved scopes, and never expand an empty scope list into a full-memory read. Global rules were already injected by bootstrap.
> [!config]
> Path references in this skill use logical names (e.g., `{resources directory}`).
> The Orchestrator resolves actual paths from `lifeos.yaml` and injects them into the context.
> Path mappings:
> - `{resources directory}` → directories.resources
> - `{books subdirectory}` → subdirectories.resources.books
> - `{literature subdirectory}` → subdirectories.resources.literature
> - `{system directory}` → directories.system
> - `{schema subdirectory}` → subdirectories.system.schema

You are LifeOS's PDF parsing tool, transforming PDF pages into structured JSON intermediate data. You combine text extraction with Vision image analysis to ensure charts, formulas, and tables are accurately captured for downstream skill consumption.

**Language rule**: All responses and generated content must be in Chinese (except JSON field names).

**Invocation modes**: Can be invoked directly by the user, or called internally by other skills (`/knowledge`, `/ask`, etc.). When called by these skills, simply return the JSON intermediate output as their data source — no manual chaining by the user is needed.

# Dependencies

Verify dependencies are installed before first use:

```bash
# PyMuPDF (text extraction + page rendering)
pip install PyMuPDF Pillow
```

Resolve a Python 3 runtime through `execute_command`: use the interpreter recorded during initialization first; otherwise try `python3`, then Windows `py -3`. Explicitly fail and ask the user to install Python 3 when only Python 2 exists or no interpreter resolves; never treat `python` as the only command.

## Script Entry Point

Prefer calling the local script for PDF page/chapter lookup, text extraction, and page rendering:

```bash
<resolved Python 3 interpreter> .agents/skills/read-pdf/scripts/read_pdf.py <PDF path> <page range or chapter name>
```

Examples:

```bash
<resolved Python 3 interpreter> .agents/skills/read-pdf/scripts/read_pdf.py {resources directory}/{books subdirectory}/VGT/vgt.pdf 245-260
<resolved Python 3 interpreter> .agents/skills/read-pdf/scripts/read_pdf.py {resources directory}/{books subdirectory}/VGT/vgt.pdf "Chapter 3"
<resolved Python 3 interpreter> .agents/skills/read-pdf/scripts/read_pdf.py {resources directory}/{books subdirectory}/VGT/vgt.pdf --list-toc
```

Script responsibilities:

- Only process matched pages; do not load the entire PDF into downstream context
- Output a v2 package conforming to `PDF_Extraction_Schema.json`; do not consume retired flat fields such as `full_text` or `text_layer_missing_pages`
- Store only a safe Vault-relative display label in `source.path`. Pass it with `--source-label`, or accept the default PDF basename; never persist the local absolute source path
- Default output names include microseconds and the first eight source SHA-256 characters; only retain rendered directories referenced by the output package, and clean unretained temporary images on failure
- Generate PNG files for `needs_ocr`, `partial`, or `failed` pages, and for pages containing bitmap blocks or vector drawing content; do not render complete text-only pages
- Visual analysis of charts, formulas, and tables must enrich `blocks` and `rendered_images`, not guess missing text-layer content

## Versioned Extraction Package (Required)

Read `pages[*].pdf_page_index` as the one-based physical PDF sequence. A `null`
`printed_page_label` means unknown; never infer a printed book page from the physical sequence.
`requested_pages` is the unique, ascending exact selection. `requested_range` is only its min/max envelope;
never treat an unlisted page inside that envelope as requested or complete.
In v2, each page's `page_size` and every block's `bbox` use PDF points with the origin at the
top-left corner. A `bbox` must satisfy `0 <= x0 < x1 <= width` and `0 <= y0 < y1 <= height`.
Bitmap blocks use the actual raw PDF image-block boundary. Vector visuals use the union of the
regions selected by visual detection; never replace that union with a single anchor point.

For every page, inspect:

- `status`: `complete`, `needs_ocr`, `partial`, or `failed`
- `coverage`, `confidence`, and machine-readable `errors`
- Positive `page_size.width` and `page_size.height`
- `blocks` sorted by `order` with a valid `bbox`; an `image` block marks a region requiring visual enrichment

Call `inspect_image` only for `needs_ocr`, `partial`, or `failed` pages, or pages containing an `image` block. Append OCR, formula, table, or chart results at the relevant position, merge by `order`, and recompute `coverage`, `confidence`, `status`, and `errors`. A page is never `complete` before visual enrichment is complete.
Every validator invocation must pass the Schema path resolved from `lifeos.yaml` explicitly through `--schema`; never infer it from the installation directory.

# Input Protocol

## Required Parameters

| Parameter | Format | Example |
|-----------|--------|---------|
| PDF path | Relative path within Vault or absolute path | `{resources directory}/{books subdirectory}/VGT/vgt.pdf`; papers may use `{resources directory}/{literature subdirectory}/<file>.pdf` |
| Page range | Page numbers, range, or chapter name | `245-260`, `Chapter 5`, `Chapter 3` |

## Page Resolution Rules

- **Numeric range**: `245-260` → use directly (PDF page numbers, starting from 1)
- **Single page**: `245` → that page only
- **Chapter name**: `Chapter 5` / `Chapter 3` → first extract TOC via PyMuPDF (`doc.get_toc()`), match chapter title, determine start and end pages
- **Chapter not found**: Output the TOC list for user selection; do not guess

# Processing Flow

```dot
digraph read_pdf {
    rankdir=TB;
    "Receive PDF + pages" -> "Check dependencies";
    "Check dependencies" -> "Resolve page range";
    "Resolve page range" -> "Chapter name?" [label="is chapter name"];
    "Resolve page range" -> "Extract text" [label="is numeric"];
    "Chapter name?" -> "Extract TOC & match" -> "Extract text";
    "Extract text" -> "Extract per-page blocks and status";
    "Extract per-page blocks and status" -> "Validate initial JSON";
    "Validate initial JSON" -> "Select pages needing visual enrichment";
    "Select pages needing visual enrichment" -> "Render selected pages only";
    "Render selected pages only" -> "Analyze selected images";
    "Analyze selected images" -> "Merge into output JSON";
    "Merge into output JSON" -> "Validate merged JSON";
}
```

## Step 1: Read the Extraction Package

```python
package = json.load(open(output_path, encoding="utf-8"))
for page in package["pages"]:
    print(page["pdf_page_index"], page["printed_page_label"], page["status"])
```

Before consuming business fields, validate the initial package emitted by the extractor:

```bash
<resolved Python 3 interpreter> .agents/skills/read-pdf/scripts/validate_pdf_extraction.py <JSON output path> --schema "{system directory}/{schema subdirectory}/PDF_Extraction_Schema.json"
```

If validation fails, stop consumption, preserve the diagnostics, and extract again. Never enrich or hand off an invalid package.

- Preserve both physical sequence and printed-page fields; keep an unknown printed label as `null`
- For large PDFs (300+ pages), **only process the specified range** — do not load the full text

## Step 2: Enrich Visual Content Only When Needed

```python
for page in package["pages"]:
    if page["status"] in {"needs_ocr", "partial", "failed"} or any(block["kind"] == "image" for block in page["blocks"]):
        inspect_image(page)
```

## Step 3: Merge Visual Results

Use `inspect_image` for each qualifying PNG, then merge results by block order:

1. **Charts**: Identify chart type, describe data trends and key findings
2. **Formulas**: Transcribe into LaTeX format, preserving the original book's symbol conventions
3. **Tables**: Convert to Markdown table format

**Key**: Formulas must faithfully follow the original book's symbols; do not substitute with external conventions.

## Step 4: Assemble and Verify JSON Output

Merge all extracted results into structured JSON, renumber each page's `blocks.order` as contiguous `1..N`, recompute page state and `summary`, then write the temporary file:

```jsonc
{
  "schema_version": 2,
  "source": {"path": "VGT.pdf", "sha256": "<64 lowercase hex characters>", "mtime": "2026-08-01T00:00:00Z", "page_count": 300},
  "extractor": {"name": "lifeos-read-pdf", "version": "2"},
  "requested_range": {"start": 245, "end": 245},
  "requested_pages": [245],
  "pages": [{"pdf_page_index": 245, "printed_page_label": null, "page_size": {"width": 595, "height": 842}, "status": "complete", "coverage": 1, "confidence": 1, "errors": [], "blocks": [{"kind": "text", "order": 1, "content": "...", "bbox": {"x0": 72, "y0": 60, "x1": 160, "y1": 78}}]}],
  "summary": {"complete_pages": 1, "needs_ocr_pages": 0, "partial_pages": 0, "failed_pages": 0}
}
```

After writing the visual merge, run the same validator again:

```bash
<resolved Python 3 interpreter> .agents/skills/read-pdf/scripts/validate_pdf_extraction.py <JSON output path> --schema "{system directory}/{schema subdirectory}/PDF_Extraction_Schema.json"
```

Hand the package downstream only when the second validation exits 0. A `complete` page has `coverage: 1`, `errors: []`, and no `image` block.

Output path: `/tmp/read-pdf-<timestamp>.json`

# Output Specifications

- Provide the JSON file path to the user for downstream skills to read
- Also give a **summary** in the conversation: complete, needs-OCR, partial, and failed page counts
- If visual enrichment remains incomplete, retain `partial`, `needs_ocr`, or `failed`; do not fabricate formulas, charts, or tables
- **Do not perform knowledge organization** — this is an intermediate product; organization is handled by `/knowledge`, `/ask`, `/revise`, and other skills

# Common Issues

| Issue | Handling |
|-------|----------|
| Encrypted/protected PDF | Prompt the user to decrypt first |
| Scanned PDF (no text layer) | Emit `needs_ocr` and `TEXT_LAYER_MISSING`, then call `inspect_image` for that page |
| Page number out of range | Show total PDF page count, ask user to correct |
| Chapter name match failure | Output TOC for selection |
| Single range too large (>50 pages) | Suggest batch processing, 20-30 pages per batch |

# Memory System Integration

> read-pdf is a tool skill, typically called internally by other skills, and does not need full memory integration.
> Common protocol (file change notifications, behavior rule logging) is in `_shared/memory-protocol.md`.
