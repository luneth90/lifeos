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

> [!info] 来源与范围
> 来源：{{SOURCE}}
> PDF 物理页范围：{{PDF_PAGE_RANGE}}
> 印刷页码：{{PDF_PAGE_LABELS}}

## 页码映射

<!-- AI指令：逐页写明 PDF 物理页与印刷页码；印刷页码未知时写“未知”，不得推测。 -->

## 中文对照

<!-- AI指令：保持原书小节结构，术语首次出现时保留英文，公式和符号约定原样保留。按原书阅读顺序把可靠视觉结果放在对应译文段落之后；只使用 Vault 相对路径。嵌图固定输出形状：

译文段落。

![[<Vault相对图片路径>|720]]

> 图 X.X · 原书印刷页 XX · PDF 物理页 XX

边界或锚点无法自动确认时不嵌图，改写原书提示。 -->

## 数学原文

<!-- AI指令：逐字保留数学原文、LaTeX 与符号约定。 -->

## 译注

<!-- AI指令：解释翻译取舍，不得改写原书定义或符号约定。 -->

## 完整性记录

<!-- AI指令：记录已完成小节、每个缺页的物理页/印刷页码/错误码和实际 completeness。只有语义内容覆盖全部请求范围后才能更新 status 为 complete；裁剪或锚点失败已自动降级为 reference，不算语义缺页。固定追加：

视觉处理：嵌入 N；转 Markdown N；转 LaTeX N；原书提示 N；忽略装饰 N

每个 reference 逐项记录：
- reference：PDF 物理页 XX；印刷页 XX/未知；图号 X.X 或 block.order N；原因：<自动降级原因>
-->
