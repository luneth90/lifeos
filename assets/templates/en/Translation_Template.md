---
title: "{{TITLE}}"
type: translation
created: "{{DATE}}"
source: "{{SOURCE}}"
project: "{{PROJECT}}"
pdf_page_range: "{{PDF_PAGE_RANGE}}"
pdf_page_labels: "{{PDF_PAGE_LABELS}}"
completeness: "{{COMPLETENESS}}"
domain: "{{DOMAIN}}"
status: draft
tags: [translation]
aliases: []
id: "{{ID}}"
---
# {{TITLE}}

> [!info] Source and range
> Source: {{SOURCE}}
> Physical PDF page range: {{PDF_PAGE_RANGE}}
> Printed page labels: {{PDF_PAGE_LABELS}}

## Page mapping

<!-- AI instruction: Record physical PDF and printed labels page by page; write “unknown” for an unknown printed label and never infer it. -->

## Chinese companion

<!-- AI instruction: Preserve the original section structure, retain English at first use of each term, and keep formulas and notation unchanged. Place each reliable visual result after its corresponding translated paragraph in source reading order, using only a Vault-relative path. Use this exact embed shape:

译文段落。

![[<Vault相对图片路径>|720]]

> 图 X.X · 原书印刷页 XX · PDF 物理页 XX

When the boundary or anchor cannot be resolved automatically, do not embed an image; emit the source-reference fallback instead. -->

## Mathematical source

<!-- AI instruction: Preserve mathematical source, LaTeX, and notation verbatim. -->

## Translator notes

<!-- AI instruction: Explain translation decisions without rewriting the source definitions or notation. -->

## Completeness record

<!-- AI instruction: Record completed sections, each missing page's physical/printed labels and error code, and actual completeness. Update status to complete only when semantic content covers the full requested range; a crop or anchor failure already downgraded to reference is not a semantic gap. Append exactly:

视觉处理：嵌入 N；转 Markdown N；转 LaTeX N；原书提示 N；忽略装饰 N

Record every reference item using:
- reference：PDF 物理页 XX；印刷页 XX/未知；图号 X.X 或 block.order N；原因：<自动降级原因>
-->
