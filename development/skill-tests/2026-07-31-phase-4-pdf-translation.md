# 阶段四 PDF 与翻译链路行为证据

日期：2026-07-31

本记录保留阶段四在修改前后的真实脚本行为。夹具均在 `/tmp` 创建；不会依赖
`.superpowers` 中的临时报告。

## 修改前

### 缺少文本层的一页

- 独立上下文：`/root/phase4_implementer/pdf_missing_text_baseline`
- 输入：两页 PDF；第 1 页有文字层，第 2 页为空白页。
- 工具：`python3`、PyMuPDF、`read_pdf.py`。
- 命令：

```bash
python3 assets/skills/read-pdf/scripts/read_pdf.py /tmp/lifeos-pdf-missing-text-baseline.pdf 1-2 --images-dir /tmp/lifeos-pdf-missing-text-images --output /tmp/lifeos-pdf-missing-text-baseline.json
```

- 关键原始输出：

```text
已输出 JSON：/tmp/lifeos-pdf-missing-text-baseline.json
摘要：共处理 2 页，渲染 2 张图片，缺少文字层页数 1。
{"pages":[1,2],"full_text":{"1":"· 1 ·······\n","2":""},"text_layer_missing_pages":[2]}
```

- 结论：旧脚本用 `text_layer_missing_pages` 标出了缺页；旧 Translate 只读取
  `full_text`，没有把该字段作为保持 `draft` 或记录缺页的必经条件，仍可能静默完成。

### 物理第 10 页、印刷页码 1

- 独立上下文：`/root/phase4_implementer/pdf_page_number_baseline`
- 输入：十页 PDF，第 10 个物理页的文字为 `Printed page number: 1`。
- 工具：`python3`、PyMuPDF、`read_pdf.py`。
- 命令：

```bash
python3 assets/skills/read-pdf/scripts/read_pdf.py /tmp/lifeos-page-number-baseline.pdf 10 --output /tmp/lifeos-page-number-baseline.json --skip-render
```

- 关键原始输出：

```text
已输出 JSON：/tmp/lifeos-page-number-baseline.json
摘要：共处理 1 页，渲染 0 张图片，缺少文字层页数 0。
{"target":"10","page_count":10,"pages":[10],"full_text":{"10":"Printed page number: 1\n"},"mode":"pages"}
```

- 结论：脚本的数字输入实际是物理 PDF 页序；旧翻译技能与模板只有
  `pdf_page_range`/`PDF 页码范围`，没有印刷页码字段或映射说明，用户可见产物会混淆两种页码。

### 公式区域只有图像

- 独立上下文：`/root/phase4_implementer/pdf_formula_image_baseline`
- 输入：含普通文字层和嵌入位图公式 `E = mc^2` 的单页 PDF。
- 工具：`python3`、PyMuPDF、`read_pdf.py`、图像查看工具。
- 命令：

```bash
python3 assets/skills/read-pdf/scripts/read_pdf.py /tmp/lifeos-formula-image-baseline.pdf 1 --output /tmp/lifeos-formula-image-baseline.json --images-dir /tmp/lifeos-formula-image-rendered
```

- 关键原始输出：

```text
已输出 JSON：/tmp/lifeos-formula-image-baseline.json
摘要：共处理 1 页，渲染 1 张图片，缺少文字层页数 0。
{"images":[{"page":1,"path":"/private/tmp/lifeos-formula-image-rendered/page_1.png"}],"charts":[],"formulas":[],"tables":[]}
```

- 结论：旧脚本只给出整页图像路径，未标记公式区域；旧 Translate 也没有要求对图片公式调用视觉补充，因此公式可能遗漏。

## 修改后

### 缺少文本层的一页

- 独立上下文：`ctx-84fd76667bed2f787d36`
- 命令：

```bash
python3 assets/skills/read-pdf/scripts/read_pdf.py /tmp/lifeos-phase4-missing-text.pdf 1-2 --output /tmp/lifeos-phase4-missing-text.json --images-dir /tmp/lifeos-phase4-missing-text-images
```

- 关键原始输出：

```text
已输出 JSON：/tmp/lifeos-phase4-missing-text.json
摘要：共处理 2 页，完整 1 页，待 OCR 1 页，失败 0 页。
{"pages":[{"pdf_page_index":1,"status":"complete","coverage":1,"errors":[]},{"pdf_page_index":2,"status":"needs_ocr","coverage":0,"errors":["TEXT_LAYER_MISSING"]}],"summary":{"complete_pages":1,"needs_ocr_pages":1,"failed_pages":0}}
```

- 结论：缺页有独立状态、零覆盖率与机器错误码；中英 Translate 都要求保留 `draft` 并列出缺页，不能静默完成。

### 物理第 10 页、印刷页码 1

- 独立上下文：`/root/phase4_implementer/pdf_page_number_verified`
- 命令：

```bash
python3 assets/skills/read-pdf/scripts/read_pdf.py /tmp/lifeos-phase4-pdf.3TLic6/physical-10-printed-1.pdf 10
```

- 关键原始输出：

```json
{"schema_version":1,"pages":[{"pdf_page_index":10,"printed_page_label":"1","status":"complete","blocks":[{"kind":"text","order":1,"content":"1"}]}]}
```

- 结论：页脚中孤立、无歧义的数字作为实际印刷页码输出；无页脚的物理第 9 页保持
  `printed_page_label: null`。中英翻译模板分别呈现物理页、印刷页与逐页映射；`null` 明确写为“未知”/`unknown`，绝不推断。

### 公式区域只有图像

- 独立上下文：`/root/phase4_implementer/pdf_formula_image_after`
- 命令：

```bash
python3 assets/skills/read-pdf/scripts/read_pdf.py /tmp/lifeos-phase4-formula-image/formula-image-only.pdf 1 --output /tmp/lifeos-phase4-formula-image/result.json --images-dir /tmp/lifeos-phase4-formula-image/rendered
```

- 关键原始输出：

```json
{"pdf_page_index":1,"status":"partial","coverage":0.5,"confidence":0.8,"errors":["VISUAL_CONTENT_PENDING"],"blocks":[{"kind":"text","order":1,"content":"Ordinary text layer before the displayed formula."},{"kind":"image","order":2,"content":""},{"kind":"text","order":3,"content":"Ordinary text layer after the displayed formula."}]}
```

- 结论：图像公式形成有序 `image` block，页面保持 `partial`；中英 Read PDF 与 Translate 都要求调用 `inspect_image`，按 block 顺序合并结果后才可改为 `complete`。翻译模板将数学原文与译注分区，译注不得改写原书定义或符号。
