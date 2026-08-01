# translate PDF 图表自动嵌入实施计划

> **面向执行者：** 必须使用 `executing-plans` 或 `subagent-driven-development` 逐任务执行；每个任务都按复选框跟踪。本任务已由用户指定在当前会话内联执行，因此使用 `executing-plans`。

**目标：** 让 `translate` 能从 PDF 提取包获得图表坐标，自动裁剪并把可靠图片嵌入对应译文位置；裁剪或定位失败时自动降级为原书提示。

**架构：** `read-pdf` 提供提取包 v2 的页面尺寸和 block bbox，并通过独立 Python 脚本完成确定性局部渲染。`translate` 在视觉语义补全前保存候选清单，完成语义校验后再分类、两次裁剪、落盘与插入；呈现失败转为 `reference`，内容失败仍由现有完整性门禁保持 `draft`。

**技术栈：** Python 3、PyMuPDF、JSON Schema、TypeScript、Vitest、Obsidian Flavored Markdown、YAML 机器契约。

## 全局约束

- 不增加人工框选、确认或修图步骤。
- 裁剪或译文锚点失败必须自动写原书提示，且该呈现降级不降低 `completeness`。
- OCR、公式、表格或其他必须语义内容未提取时仍保持 `status: draft`。
- 公式优先 LaTeX，忠实表格优先 Markdown；装饰元素忽略。
- 裁剪只尝试 12 point 和 36 point padding，不回退到整页嵌入。
- 资产名固定为 `<source-sha12>-p<物理页>-b<block-order>.png`。
- 图片链接使用 Vault 相对 Obsidian 嵌入，显示宽度为 720。
- 中文、英文技能和模板保持相同机器语义。
- 只修改隔离工作树 `/Users/luneth/code/node/lifeos/.worktrees/lifeos-skill-contract-hardening`。
- 不修改产品版本、`package.json`、发布标签或远端状态。
- 所有源码修改使用 TDD：先写测试并观察预期失败，再写最小实现。
- 每个任务完成定向验证后单独提交。

---

## 文件职责

- `assets/schema/PDF_Extraction_Schema.json`：定义提取包 v2、页面尺寸和 block bbox 的结构约束。
- `assets/skills/read-pdf/scripts/read_pdf.py`：生成页面尺寸、文字/位图 bbox 和矢量视觉并集 bbox。
- `assets/skills/read-pdf/scripts/validate_pdf_extraction.py`：执行版本一致性和跨字段几何校验。
- `assets/skills/read-pdf/scripts/crop_pdf_region.py`：按物理页、bbox、padding 和 DPI 原子生成局部 PNG。
- `assets/skills/read-pdf/SKILL.zh.md`、`SKILL.en.md`：公开 v2 几何契约和裁剪脚本入口。
- `assets/skills/translate/SKILL.zh.md`、`SKILL.en.md`：定义视觉分类、裁剪重试、资产、锚点、降级和状态语义。
- `assets/templates/zh/Translation_Template.md`、`assets/templates/en/Translation_Template.md`：规定中文对照区的行内嵌图和完整性记录。
- `scripts/validate-skill-contracts.mjs`：校验中英文 `translate-visual-contract-v1` 的精确机器契约。
- `tests/assets/read-pdf-extraction.test.ts`：验证真实 PDF 的 v2 页面几何和视觉顺序。
- `tests/assets/pdf-extraction-validation.test.ts`：验证 v2 Schema 与几何语义失败关闭。
- `tests/assets/pdf-region-crop.test.ts`：运行真实裁剪脚本并验证尺寸、边界、摘要和失败原子性。
- `tests/skill-contracts/validator.test.ts`：验证 translate 视觉契约的缺失、漂移与非法值诊断。
- `tests/skill-contracts/data-contract.test.ts`：验证中英文模板公开相同的视觉记录槽位。

---

### 任务一：提取包 v2 页面几何与 block bbox

**文件：**

- 修改：`tests/assets/read-pdf-extraction.test.ts`
- 修改：`tests/assets/pdf-extraction-validation.test.ts`
- 修改：`assets/schema/PDF_Extraction_Schema.json`
- 修改：`assets/skills/read-pdf/scripts/read_pdf.py`
- 修改：`assets/skills/read-pdf/scripts/validate_pdf_extraction.py`
- 修改：`assets/skills/read-pdf/SKILL.zh.md`
- 修改：`assets/skills/read-pdf/SKILL.en.md`

**接口：**

- 产出：`page_size: {width: number, height: number}`。
- 产出：每个 block 的 `bbox: {x0: number, y0: number, x1: number, y1: number}`，单位为 PDF point。
- 产出：`schema_version: 2` 和 `extractor.version: "2"`。
- 消费：PyMuPDF `page.rect`、文字/位图 raw block bbox、矢量判定中的 `selected_regions`。

- [ ] **步骤一：写真实提取 RED 测试**

在 `read-pdf-extraction.test.ts` 中把首个版本断言改为 v2，并增加手工推导的几何断言：

```ts
expect(output.schema_version).toBe(2);
expect(extractor.version).toBe('2');
expect(firstPage.page_size).toEqual({ width: 595, height: 842 });
expect(blocks[0].bbox.x0).toBeCloseTo(72, 5);
expect(blocks[0].bbox.y0).toBeCloseTo(59.1, 5);
expect(blocks[0].bbox.x1).toBeCloseTo(231.39597, 5);
expect(blocks[0].bbox.y1).toBeCloseTo(75.588, 5);
```

对位图 fixture 断言视觉 block 的边界与创建 PDF 时使用的矩形一致：

```ts
const imageBlock = blocks.find((block) => block.kind === 'image');
expect(imageBlock?.bbox).toEqual({ x0: 72, y0: 150, x1: 540, y1: 250 });
```

对矢量柱状图断言并集，而不是左上角锚点：

```ts
expect(imageBlock?.bbox).toEqual({ x0: 72, y0: 120, x1: 278, y1: 300 });
```

- [ ] **步骤二：运行提取 RED 测试并确认失败原因**

运行：

```bash
npx vitest run tests/assets/read-pdf-extraction.test.ts
```

预期：因实际 `schema_version` 仍为 1、页面缺少 `page_size`、block 缺少 `bbox` 而失败；不得接受因 fixture 创建失败或 Python 导入失败导致的错误。

- [ ] **步骤三：写 Schema 与语义校验 RED 测试**

把 `completePage()` 和 `completePackage()` 更新为合法 v2 基线：

```ts
function completePage(index = 1) {
	return {
		pdf_page_index: index,
		printed_page_label: null,
		page_size: { width: 595, height: 842 },
		status: 'complete',
		coverage: 1,
		confidence: 1,
		errors: [],
		blocks: [
			{
				kind: 'text',
				order: 1,
				content: `page ${index}`,
				bbox: { x0: 72, y0: 60, x1: 160, y1: 78 },
			},
		],
	};
}
```

`completePackage()` 使用 `schema_version: 2` 和 `extractor.version: '2'`，再增加表驱动几何失败用例：

```ts
it.each([
	['缺少 bbox', undefined, 'schema_required'],
	['横向退化', { x0: 72, y0: 60, x1: 72, y1: 78 }, 'bbox_order'],
	['纵向退化', { x0: 72, y0: 78, x1: 160, y1: 78 }, 'bbox_order'],
	['横向越界', { x0: 72, y0: 60, x1: 596, y1: 78 }, 'bbox_page_bounds'],
	['纵向越界', { x0: 72, y0: 60, x1: 160, y1: 843 }, 'bbox_page_bounds'],
])('拒绝 block bbox：%s', (_name, bbox, code) => {
	const value = completePackage();
	if (bbox === undefined) delete (value.pages[0].blocks[0] as { bbox?: unknown }).bbox;
	else value.pages[0].blocks[0].bbox = bbox;
	const result = runValidator(value);
	expect(result.status).toBe(1);
	expect(diagnostics(result).map((item) => item.code)).toContain(code);
});
```

增加版本不一致用例，分别捕获错误 extractor 版本和旧 schema 版本。

- [ ] **步骤四：运行校验 RED 测试并确认失败原因**

运行：

```bash
npx vitest run tests/assets/pdf-extraction-validation.test.ts
```

预期：合法 v2 基线被当前 v1 Schema 拒绝，几何诊断尚不存在；失败必须来自缺失功能。

- [ ] **步骤五：实现最小 v2 Schema**

将 `$id`、版本常量和 required 字段更新为 v2。`page_size` 和 `bbox` 使用 `additionalProperties: false`，每个坐标声明为 number；数值关系交给语义校验器。

关键结构应为：

```json
"page_size": {
  "type": "object",
  "required": ["width", "height"],
  "properties": {
    "width": {"type": "number", "minimum": 0},
    "height": {"type": "number", "minimum": 0}
  },
  "additionalProperties": false
}
```

当前自建 Schema 校验器不支持 `exclusiveMinimum`，因此使用 `minimum: 0`，并由语义校验器严格拒绝零尺寸。增加一个 `page_size.width = 0` 的用例，要求诊断 `page_size_positive`。block 的 bbox 同理只声明 number，顺序与边界由语义校验器检查。

- [ ] **步骤六：实现提取器几何输出**

在 `read_pdf.py` 中定义类型和裁剪助手：

```python
BBox = Tuple[float, float, float, float]


def bounded_bbox(page: fitz.Page, raw_bbox: Sequence[float]) -> Optional[BBox]:
    rectangle = fitz.Rect(*raw_bbox) & page.rect
    if not rectangle.is_valid or rectangle.is_empty:
        return None
    return (float(rectangle.x0), float(rectangle.y0), float(rectangle.x1), float(rectangle.y1))


def bbox_payload(bbox: BBox) -> Dict[str, float]:
    return {"x0": bbox[0], "y0": bbox[1], "x1": bbox[2], "y1": bbox[3]}
```

把 `vector_visual_anchor()` 改名为 `vector_visual_bbox()`，返回 `selected_regions` 的并集：

```python
return (
    min(region[0] for region in selected_regions),
    min(region[1] for region in selected_regions),
    max(region[2] for region in selected_regions),
    max(region[3] for region in selected_regions),
)
```

`extract_blocks()` 的排序项保留完整 bbox，输出每个 block 的 `bbox_payload()`；`extract_page()` 增加：

```python
"page_size": {"width": float(page.rect.width), "height": float(page.rect.height)},
```

`build_result()` 输出版本 2。

- [ ] **步骤七：实现跨字段几何校验**

在 `validate_pdf_extraction.py` 新增：

```python
def validate_page_geometry(page: Dict[str, Any], index: int, diagnostics: List[Diagnostic]) -> None:
    path = f"$.pages[{index}]"
    page_size = page.get("page_size")
    if not isinstance(page_size, dict):
        return
    width = number_value(page_size.get("width"))
    height = number_value(page_size.get("height"))
    if width is None or height is None or width <= 0 or height <= 0:
        add_diagnostic(diagnostics, "page_size_positive", f"{path}.page_size")
        return
    blocks = page.get("blocks")
    if not isinstance(blocks, list):
        return
    for block_index, block in enumerate(blocks):
        if not isinstance(block, dict) or not isinstance(block.get("bbox"), dict):
            continue
        bbox = block["bbox"]
        values = [number_value(bbox.get(key)) for key in ("x0", "y0", "x1", "y1")]
        if any(value is None for value in values):
            continue
        x0, y0, x1, y1 = values
        if not x0 < x1 or not y0 < y1:
            add_diagnostic(diagnostics, "bbox_order", f"{path}.blocks[{block_index}].bbox")
        elif x0 < 0 or y0 < 0 or x1 > width or y1 > height:
            add_diagnostic(diagnostics, "bbox_page_bounds", f"{path}.blocks[{block_index}].bbox")
```

在每页既有状态语义校验前调用它，并验证 `schema_version == 2` 与 `extractor.version == "2"` 一致。

- [ ] **步骤八：更新 read-pdf 双语契约和示例**

同步声明提取包 v2、`page_size`、`bbox`、PDF point 单位和矢量并集边界；更新示例 JSON。保持两次校验入口、选择性整页渲染和 Python 3 解析规则不变。

- [ ] **步骤九：运行定向测试并重构**

运行：

```bash
npx vitest run tests/assets/read-pdf-extraction.test.ts tests/assets/pdf-extraction-validation.test.ts
```

预期：两个测试文件全部通过。随后运行 `git diff --check`，只在测试保持绿色时整理命名和重复代码。

- [ ] **步骤十：提交任务一**

```bash
git add assets/schema/PDF_Extraction_Schema.json \
  assets/skills/read-pdf/scripts/read_pdf.py \
  assets/skills/read-pdf/scripts/validate_pdf_extraction.py \
  assets/skills/read-pdf/SKILL.zh.md \
  assets/skills/read-pdf/SKILL.en.md \
  tests/assets/read-pdf-extraction.test.ts \
  tests/assets/pdf-extraction-validation.test.ts
git commit -m "feat: 公开 PDF 区域几何契约"
```

---

### 任务二：确定性 PDF 局部裁剪工具

**文件：**

- 新建：`tests/assets/pdf-region-crop.test.ts`
- 新建：`assets/skills/read-pdf/scripts/crop_pdf_region.py`
- 修改：`assets/skills/read-pdf/SKILL.zh.md`
- 修改：`assets/skills/read-pdf/SKILL.en.md`

**接口：**

- 消费：PDF 路径、从 1 开始的物理页码、四个 PDF point 坐标、padding、DPI、PNG 输出路径。
- 产出：原子生成 PNG；标准输出 JSON 包含 `ok`、`page`、`requested_bbox`、`effective_bbox`、`padding`、`dpi`、`width`、`height`、`sha256`、`output`。
- 错误：标准错误 JSON 包含稳定 `error.code` 和 `error.message`，退出码非零。

- [ ] **步骤一：写成功路径 RED 测试**

新测试使用真实 `formulaImagePdf`，以 `--padding 0 --dpi 144` 裁剪 `[72, 150, 540, 250]`：

```ts
expect(result.status, result.stderr).toBe(0);
expect(payload).toMatchObject({
	ok: true,
	page: 1,
	requested_bbox: { x0: 72, y0: 150, x1: 540, y1: 250 },
	effective_bbox: { x0: 72, y0: 150, x1: 540, y1: 250 },
	padding: 0,
	dpi: 144,
	width: 936,
	height: 200,
});
expect(existsSync(outputPath)).toBe(true);
expect(payload.sha256).toBe(createHash('sha256').update(readFileSync(outputPath)).digest('hex'));
```

该尺寸能捕获“错误渲染整页”这一真实回归。

- [ ] **步骤二：运行成功路径 RED 测试**

运行：

```bash
npx vitest run tests/assets/pdf-region-crop.test.ts
```

预期：脚本文件不存在，测试失败；fixture 本身必须成功创建。

- [ ] **步骤三：写边界和失败原子性 RED 测试**

增加以下真实行为断言：

- bbox 靠近左上角时，12 point padding 被限制在 `{x0: 0, y0: 0}`。
- 页码 0 和超过总页数返回 `PAGE_OUT_OF_RANGE`。
- 退化、非有限或完全位于页面外的 bbox 返回 `INVALID_BBOX`。
- padding 小于 0 或大于 144 返回 `INVALID_PADDING`。
- DPI 小于 72 或大于 600 返回 `INVALID_DPI`。
- 输出后缀不是 `.png` 返回 `INVALID_OUTPUT`。
- 父路径是普通文件时返回 `WRITE_FAILED`，不留下 `.tmp` 文件。
- 目标文件已有哨兵内容且参数校验失败时，目标内容保持不变。

- [ ] **步骤四：实现最小裁剪脚本**

使用 `JsonArgumentParser` 和 `CropPdfError` 统一机器错误。解析参数后按以下顺序执行：

```python
resolved_pdf = resolve_pdf_path(args.pdf_path)
output_path = resolve_output_path(args.output)
validate_padding(args.padding)
validate_dpi(args.dpi)
with fitz.open(str(resolved_pdf)) as document:
    page = resolve_page(document, args.page)
    requested_bbox = resolve_bbox(args.bbox)
    effective_bbox = padded_bbox(page, requested_bbox, args.padding)
    pixmap = page.get_pixmap(clip=fitz.Rect(*effective_bbox), dpi=args.dpi, alpha=False)
    write_png_atomically(pixmap, output_path)
```

原子写函数在目标目录使用 `tempfile.NamedTemporaryFile(delete=False, suffix=".png")`，保存成功后调用
`Path.replace()`；异常时只删除本次临时文件。SHA-256 使用 1 MiB 分块读取。

- [ ] **步骤五：更新 read-pdf 双语脚本依赖与调用说明**

在两个 frontmatter 的 `dependencies.scripts` 加入 `scripts/crop_pdf_region.py`。正文公开命令参数、机器输出、PDF point 单位和调用边界；明确裁剪脚本不负责视觉分类或译文插入。

- [ ] **步骤六：运行任务二定向验证**

```bash
npx vitest run tests/assets/pdf-region-crop.test.ts tests/assets/read-pdf-extraction.test.ts tests/assets/pdf-extraction-validation.test.ts
node scripts/validate-skill-contracts.mjs
git diff --check
```

预期：全部退出 0，临时目录由测试清理，技能依赖验证通过。

- [ ] **步骤七：提交任务二**

```bash
git add assets/skills/read-pdf/scripts/crop_pdf_region.py \
  assets/skills/read-pdf/SKILL.zh.md \
  assets/skills/read-pdf/SKILL.en.md \
  tests/assets/pdf-region-crop.test.ts
git commit -m "feat: 增加 PDF 区域裁剪工具"
```

---

### 任务三：translate 双语视觉编排、自动降级与契约门禁

**文件：**

- 修改：`assets/skills/translate/SKILL.zh.md`
- 修改：`assets/skills/translate/SKILL.en.md`
- 修改：`assets/templates/zh/Translation_Template.md`
- 修改：`assets/templates/en/Translation_Template.md`
- 修改：`scripts/validate-skill-contracts.mjs`
- 修改：`tests/skill-contracts/validator.test.ts`
- 修改：`tests/skill-contracts/data-contract.test.ts`
- 修改：`tests/assets/pdf-extraction-validation.test.ts`

**接口：**

- 消费：初始 v2 `image` block 清单、视觉语义补全后的合法提取包、`crop_pdf_region.py`。
- 产出：`embed | markdown | latex | ignore | reference` 五类视觉结果。
- 产出：Vault 相对 Obsidian 嵌入和视觉处理统计。
- 产出：中英文完全一致的 `translate-visual-contract-v1` YAML 机器契约。

- [ ] **步骤一：写 translate 机器契约 RED 测试**

在 `validator.test.ts` 中先要求两个技能包含并通过以下精确契约：

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

先增加基线 `validateAssets()` 诊断期望，再用临时 mutation 覆盖三类回归：删除契约、把第二次 padding 改为 72、把 `manual_confirmation` 改为 `required`。

- [ ] **步骤二：运行契约 RED 测试**

```bash
npx vitest run tests/skill-contracts/validator.test.ts
```

预期：当前技能缺少 marker 和校验器逻辑，因此新增测试失败；现有 validator 测试仍保持原有结果。

- [ ] **步骤三：写模板与状态 RED 测试**

在 `data-contract.test.ts` 中解析中英文 Translation 模板，验证两者都提供：

- 中文对照区内部的按阅读顺序嵌图指令。
- Vault 相对 `![[...|720]]` 语法。
- 五类视觉统计槽位。
- `reference` 逐项记录物理页、印刷页、图号或 block.order 和原因。

在 `pdf-extraction-validation.test.ts` 的 translate 消费流程测试中增加行为顺序断言：先保存初始视觉清单，再完成视觉语义校验，之后才裁剪与嵌入；`crop_or_anchor_failure` 不得出现在 `status: draft` 分支，`semantic_failure` 必须进入 draft 分支。

- [ ] **步骤四：实现 translate 双语工作流**

同步修改两个技能：

1. 目标改为中文笔记优先直接阅读，PDF++ 保留为来源核查和自动降级后的定位入口。
2. 初始提取后保存 `{pdf_page_index, printed_page_label, order, bbox}` 临时视觉清单。
3. 继续整页 `inspect_image` 语义补全并运行 `--require-complete`；不得用裁剪降级绕过内容门禁。
4. 按五类结果处理候选。
5. `embed` 先用 12 point，再在截断时用 36 point；第二次仍失败改为 `reference`，不嵌整页。
6. 图号明确时优先放在首次引用段落后；否则按前一个 text block；没有可靠锚点时在小节末写提示。
7. 有图号时写 `> 📖 见原书 p.XX 图 X.X`；无图号时写印刷页和 PDF 物理页提示，不编造编号。
8. 只保留实际被 Markdown 引用的稳定资产；恢复同一 run 时避免重复嵌入。
9. 完整性记录写五类计数和逐项 `reference` 原因。

在两个文件加入同值 `translate-visual-contract-v1` YAML 块，机器字段使用上一步的精确值。

- [ ] **步骤五：更新中英文 Translation 模板**

不增加 frontmatter 字段。在“中文对照”注释中加入以下输出形状：

```markdown
译文段落。

![[<Vault相对图片路径>|720]]

> 图 X.X · 原书印刷页 XX · PDF 物理页 XX
```

在“完整性记录”注释中要求固定统计：

```text
视觉处理：嵌入 N；转 Markdown N；转 LaTeX N；原书提示 N；忽略装饰 N
```

英文模板使用英文指令，但规定的最终笔记结构、Obsidian 语法和五类计数完全相同。

- [ ] **步骤六：实现技能契约校验器**

在 `validate-skill-contracts.mjs` 增加 `isValidTranslateVisualContract()`，使用 `hasExactKeys()` 和 `sameValue()` 对上述对象逐层精确校验。对每个 translate 语言文件读取 marker：

```js
const visualContract = readMarkedYaml(
	path,
	'translate-visual-contract-v1',
	() => add('invalid_marked_yaml', assetPath(path), 'Translate 视觉机器契约无法解析'),
);
```

非法或缺失时产生 `invalid_translate_visual_contract`；中英文机器对象不完全相等时产生
`translate_visual_contract_mismatch`。继续保留现有翻译目标目录验证。

- [ ] **步骤七：运行任务三定向验证并修正**

```bash
npx vitest run tests/skill-contracts/validator.test.ts \
  tests/skill-contracts/data-contract.test.ts \
  tests/assets/pdf-extraction-validation.test.ts \
  tests/assets/read-pdf-extraction.test.ts \
  tests/assets/pdf-region-crop.test.ts
node scripts/validate-skill-contracts.mjs
git diff --check
```

预期：所有测试和契约校验退出 0；中英文契约不出现字段或值漂移。

- [ ] **步骤八：提交任务三**

```bash
git add assets/skills/translate/SKILL.zh.md \
  assets/skills/translate/SKILL.en.md \
  assets/templates/zh/Translation_Template.md \
  assets/templates/en/Translation_Template.md \
  scripts/validate-skill-contracts.mjs \
  tests/skill-contracts/validator.test.ts \
  tests/skill-contracts/data-contract.test.ts \
  tests/assets/pdf-extraction-validation.test.ts
git commit -m "feat: 强化翻译图表自动嵌入契约"
```

---

### 任务四：全量验证与交付核对

**文件：**

- 核对：`docs/superpowers/specs/2026-08-01-translate-pdf-visual-embedding-design.md`
- 核对：本计划列出的全部源码、测试、技能和模板。

**接口：**

- 消费：前三个任务的提交。
- 产出：可复现的全量验证证据和干净工作区；本任务不制造“仅为提交而提交”的空变更。

- [ ] **步骤一：逐条核对设计覆盖**

确认以下每项都有源码和测试证据：v2 几何、矢量并集、局部裁剪、两次 padding、稳定资产、Vault 相对嵌入、三层锚点、五类视觉结果、自动 `reference`、内容失败 draft、无人工确认、临时资产清理、中英文一致。

- [ ] **步骤二：运行完整验证矩阵**

```bash
npm run build
npm test
npm run typecheck
npm run lint
node scripts/validate-skill-contracts.mjs
git diff --check
```

预期：全部退出 0；Vitest 报告 0 个失败测试；契约校验输出通过；无 whitespace error。

- [ ] **步骤三：核对提交和工作区**

```bash
git status --short --branch
git log -4 --oneline
```

预期：工作区干净，最近提交依次包含设计、PDF 几何、裁剪工具和 translate 视觉契约；不包含 `package.json`、版本号、tag、push 或其他工作树的改动。
