---
name: translate
description: '翻译英文 PDF 章节时使用；生成中文对照阅读笔记并回填学习项目进度。'
version: 2.5.2
dependencies:
  templates:
    - path: "{系统目录}/{模板子目录}/Translation_Template.md"
  prompts: []
  schemas:
    - path: "{系统目录}/{规范子目录}/Frontmatter_Schema.md"
    - path: "{系统目录}/{规范子目录}/PDF_Extraction_Schema.json"
  protocols:
    - path: ../_shared/operation-safety.md
  capabilities: [execute_command, inspect_image]
  agents: []
---


## 作用域记忆（必须）

完成本技能的入口路由并识别对象后，在首次业务查询前调用：

```text
memory_context(
  contract_version=2,
  scopes=[{type: "skill", key: "translate"}, <已明确的 project/repository/tool/file scopes>],
  include_global=false,
  include_related_files=true
)
```

未知作用域不要传入；空作用域不得扩大为全量读取。全局规则已由 bootstrap 注入，不要重复请求。
> [!config]
> 本技能中的路径引用使用逻辑名（如 `{资源目录}`）。
> Orchestrator 从 `lifeos.yaml` 解析实际路径后注入上下文。
> 路径映射：
> - `{资源目录}` → directories.resources
> - `{翻译子目录}` → subdirectories.resources.translations
> - `{项目目录}` → directories.projects
> - `{系统目录}` → directories.system
> - `{规范子目录}` → subdirectories.system.schema
> - `{模板子目录}` → subdirectories.system.templates

你是 LifeOS 的翻译助手，将英文 PDF 章节转化为流畅、可直接阅读的中文笔记。你的产出不是逐词机翻，而是按小节组织的自然中文，并把可靠图表、公式和表格放回相应译文位置。

**语言规则**：翻译产出必须为中文。术语首次出现时标注英文原文（如「子群（subgroup）」），后续使用中文即可。

# 目标

让中文翻译笔记在常规阅读中尽可能自足：文字、公式、表格和可可靠裁剪的图表都在对应位置呈现。PDF++ 仍作为来源核查入口，并在图表无法自动裁剪或定位时承接原书提示，但不再强制用户始终双窗口对照。

# 输入协议

## 必须参数

| 参数 | 格式 | 示例 |
|------|------|------|
| 书名 | 项目名或 PDF 文件名 | `VGT`、`Artin Algebra` |
| 章节 | 页码范围或章节名 | `245-260`、`Chapter 9`、`第9章` |

## 可选参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| 项目文件 | 关联的学习项目路径 | 自动从 `{项目目录}/` 匹配 |

# 工作流

## 步骤一：定位资源与项目（静默执行）

1. **定位 PDF 文件**
   - 根据书名在 `{资源目录}/` 下搜索对应 PDF
   - 若找不到，提示用户提供完整路径

2. **定位关联项目**（可选）
   - 在 `{项目目录}/` 中查找与该书关联的学习项目
   - 若找到，后续步骤五将回填掌握度总览
   - 若未找到，跳过回填步骤，仅产出翻译

3. **检查已有翻译**
   - 查看 `{资源目录}/{翻译子目录}/{书名}/` 下是否已有该章节翻译
   - 若已存在，提示用户：已有翻译文件 `[[路径]]`，是否覆盖？

## 步骤二：提取原文

调用 `/read-pdf` 提取指定章节的文字内容：

```bash
<已解析的 Python 3 解释器> .agents/skills/read-pdf/scripts/read_pdf.py <PDF路径> <页码范围或章节名>
```

若提取包为临时输出（默认在平台临时目录，`tempfile.gettempdir()` 解析，macOS/Linux 为 `/tmp/`、Windows 为 `%TEMP%\`），在**完成全部视觉识别与翻译产出后**（即步骤五收尾时），删除该 JSON 及对应的 `*-images-*` 渲染目录；translate 自身不新增落盘中间产物，`initial_image_blocks` 仅存于本次对话工作区。若提取包由 `/read-pdf` 显式输出到 Vault 内路径，则不清理。

通过 `execute_command` 解析解释器：优先使用初始化阶段已记录的 Python 3，其次尝试 `python3`，Windows
再尝试 `py -3`。只有 Python 2 或无法解析时明确失败；不得把 `python` 当作唯一命令。
翻译笔记从 `status: draft` 开始，只有下述语义门禁和最终文件校验都通过后才转换状态。

处理顺序不得调整：

1. 读取已通过基础校验的 v2 提取包中的 `pages`、`blocks`、`page_size`、`status`、`coverage` 与
   `errors`；不得读取已废弃的 `full_text`。`requested_pages` 是完整性与
   `PDF_PAGE_RANGE` 的唯一范围依据，不得把 `requested_range` 包络内未请求的页写入翻译或
   completeness。
2. 在任何 `inspect_image` 或 block 合并前，把初始包中的每个 `image` block 保存为本次运行的
   `initial_image_blocks` 临时清单。每项固定保留 `{pdf_page_index, order, bbox}`，以
   `(pdf_page_index, order)` 为候选键。不得从语义合并后的包反推这份清单，也不得为此新增
   Frontmatter 字段。
3. 对 `needs_ocr`、`partial`、`failed` 页，或初始含 `image` block 的页面使用整页渲染调用
   `inspect_image`，完成 OCR、公式、表格和图表的语义识别；按 `block.order` 合并结果并重新计算
   coverage、状态、错误和 summary。此时只保证内容语义完整，不进行局部裁剪或 Markdown 嵌入。
4. 把视觉语义合并后的提取包写回 JSON，并立即执行强完整性门禁：

```bash
<已解析的 Python 3 解释器> .agents/skills/read-pdf/scripts/validate_pdf_extraction.py <JSON输出路径> --schema "{系统目录}/{规范子目录}/PDF_Extraction_Schema.json" --require-complete
```

命令非 0 即为 `semantic_failure` → `status: draft`：停止后续裁剪与嵌入，写入实际 completeness、
缺页和诊断，不得用图片提示绕过内容门禁。只有命令退出 0，才进入步骤三；后续呈现失败不反向伪造
语义失败。

## 步骤三：翻译为中文 Markdown

基于提取的原文，按小节组织翻译产出。

在生成前必须读取 `{系统目录}/{模板子目录}/Translation_Template.md`，并替换全部必填占位符：
`TITLE`、`DATE`、`SOURCE`、`PROJECT`、`PDF_PAGE_RANGE`、`COMPLETENESS`、`DOMAIN`、`ID`。项目不存在时将
`project` 写为空字符串；不得保留模板占位符。

### 翻译原则

1. **按小节分段**：保持原书的小节标题结构（翻译标题，括号内保留英文原标题）
2. **意译为主**：追求中文表述自然流畅，不要逐词对照翻译
3. **术语处理**：
   - 数学术语首次出现时标注英文：「子群（subgroup）」
   - 后续直接使用中文术语
   - 原书特有的符号约定必须保留，不做转换
4. **公式保留**：数学原文与中文翻译分别放在“数学原文”和“译注”区块；LaTeX 与原书符号约定原样保留，译注不得改写定义或符号约定
5. **视觉结果**：按下述五类自动处理，禁止把所有图表统一替换为原书提示
6. **习题翻译**：章末练习题同样翻译，保留题号结构，便于用户对照原书做题

### 视觉结果自动呈现（必须）

强完整性门禁通过后，按物理页和 `order` 顺序遍历 `initial_image_blocks`，结合已完成的视觉语义结果
自动归入且只归入一类：

| 分类 | 自动处理 |
| --- | --- |
| `embed` | 图表、示意图、照片等需要保留视觉形态且边界可靠；执行局部裁剪并嵌入 |
| `markdown` | 能忠实表达的表格；在对应位置写 Markdown 表格，不再生成图片资产 |
| `latex` | 公式或公式组；在对应位置写原书符号约定的 LaTeX，不再生成图片资产 |
| `ignore` | 页眉装饰、分隔线、无语义图标等；不输出正文内容 |
| `reference` | 边界、裁剪或译文锚点无法自动可靠确定；只写原书定位提示 |

对 `embed` 候选执行以下全自动流程，不询问用户，也不等待人工框选或确认：

1. 取 `source.sha256` 前 12 位，资产路径固定为
   `{资源目录}/{翻译子目录}/<书名>/assets/<source-sha12>-p<page>-b<order>.png`，其中 `page` 是
   物理页，`order` 是初始 `block.order`。
2. 先调用 12 point 留白裁剪：

```bash
<已解析的 Python 3 解释器> .agents/skills/read-pdf/scripts/crop_pdf_region.py <PDF路径> <物理页> --bbox <x0> <y0> <x1> <y1> --padding 12 --dpi 300 --output <稳定PNG路径>
```

3. 用 `inspect_image` 自动检查裁剪结果是否完整保留主体、坐标轴、图例和必要标签。首次命令失败或
   检出关键边缘截断时，以同一稳定路径和 `--padding 36` 再试一次。第二次仍失败或仍不完整时，
   删除本次运行产生且未被 Markdown 引用的候选资产，将其改为 `reference`；禁止嵌入整页截图。
4. 裁剪通过后按锚点优先级插入：原文首次明确图号引用段落之后 → 候选前一个 `text` block 对应的
   译文段落之后。嵌入固定使用 Vault 相对语法 `![[<图片路径>|720]]`，下一行写
   `> 图 X.X`；无可靠图号时写 `> 原书图表`。不得编造图号。
5. 若上述两个锚点都不可靠，不嵌图片；在所属小节末尾生成 `reference` 原书提示。此时
   `crop_or_anchor_failure` → `reference`，该呈现降级计为已处理，不改变语义完整性或笔记状态。

`reference` 文案必须完全自动生成：有可靠图号时写 `> 📖 见原书图 X.X`；无可靠图号时写
`> 📖 见原书相关图表（PDF 物理页 XX，block.order N）`。不得伪造图号，也不得留下待人工确认项。

同一 `run_id` 恢复时，以候选键和稳定文件名检查现有嵌图、Markdown、LaTeX 或原书提示，原位补全而
不重复追加。结束前只清理本次 `initial_image_blocks` 候选集合中由当前运行新建且未被任何翻译
Markdown 引用的资产；同一来源摘要下不属于本次候选集合的图片、运行前已存在的图片和其他文件一律
不得删除。

### 产出格式

报告结构、Frontmatter 和完整性记录只来自 `Translation_Template.md`。将翻译内容填入「中文对照」区块，
初始状态保持 `draft`；不得维护第二套内嵌 Frontmatter 或报告标题。

### 产出路径

```
{资源目录}/{翻译子目录}/<书名>/<章节名>.md
```

示例：`{资源目录}/{翻译子目录}/VGT/第9章_Sylow定理.md`

## 步骤四：完整性校验与文件变更通知

落盘后回读文件，确认请求页范围全部覆盖、全部必填占位符已替换、Frontmatter 完整且项目回填（如适用）
已完成。Frontmatter `completeness` 必须等于请求页的实际语义 coverage；“完整性记录”列出每个语义
非完整页的 `pdf_page_index` 与错误码，并固定记录五类视觉计数以及每个 `reference` 的物理页、图号或
`block.order` 和自动降级原因。

步骤二的 `--require-complete` 结果是状态转换的唯一内容门禁。若为 `semantic_failure`，保持
`status: draft`；若门禁已退出 0，且模板、页范围、占位符和项目回填校验均通过，则更新为
`status: complete`。`reference` 计为视觉已呈现，裁剪或锚点降级本身不降低 `completeness`，也不阻止
完成状态。提取包若在门禁后发生任何语义修改，必须先重新执行同一门禁；不得凭自然语言判断、
`summary.complete_pages` 或 coverage 平均值绕过。

```
memory_notify(contract_version=2, file_path="<翻译文件相对路径>")
```

## 步骤五：回填项目掌握度总览（若有关联项目）

1. 读取关联项目文件中的掌握度总览表格
2. 检查表格是否已有「翻译」列：
   - **无翻译列**：在表格末尾新增「翻译」列，所有行默认填 `—`
   - **已有翻译列**：直接更新对应章节行
3. 将刚生成的翻译文件以 wikilink 填入对应章节行：
   - 格式：`[[{翻译子目录}/{书名}/{章节名}|✓]]`
   - 无翻译的章节保持 `—`

**示例（更新后）：**

```markdown
| 章节 | 掌握度 | 笔记 | Wiki | 翻译 |
| --- | --- | --- | --- | --- |
| 第9章 Sylow理论 | ⚪ 未学 | — | — | [[翻译/VGT/第9章_Sylow定理|✓]] |
| 第10章 Galois理论 | ⚪ 未学 | — | — | — |
```

4. 通知文件变更，并在回填完成后执行步骤四的完整性校验：
```
memory_notify(contract_version=2, file_path="<项目文件相对路径>")
```

# 输出摘要

完成后输出简洁摘要：

```markdown
## 📖 翻译完成

**来源:** [[PDF文件名]] PDF 物理页 XX — XX
**产出:** [[{翻译子目录}/{书名}/{章节名}]]
**小节数:** N 个小节
**视觉处理:** 嵌入 N；转 Markdown N；转 LaTeX N；原书提示 N；忽略装饰 N
**项目回填:** ✅ 已更新 [[项目名]] 掌握度总览（若有关联项目）/ ⏭️ 无关联项目，跳过回填

---

打开方式：优先直接阅读中文笔记；需要核查来源或遇到原书提示时，再用 PDF++ 跳转对应页。
```

# 边界情况

| 场景 | 处理 |
|------|------|
| PDF 找不到 | 提示用户提供完整路径 |
| 章节名匹配失败 | 输出 TOC 供用户选择 |
| 已有翻译文件 | 提示用户是否覆盖 |
| 无关联学习项目 | 跳过步骤五，仅产出翻译文件 |
| 文字层/视觉补充不完整 | 列出缺页与错误码，按实际 coverage 保持 `draft` |
| 图表边界或两次裁剪仍不可靠 | 自动写原书提示，不嵌整页，不等待人工确认 |
| 找不到可靠译文锚点 | 在所属小节末尾写原书提示，并删除未引用的本次候选资产 |
| 章节过长（>50页） | 建议分批处理，每批 20-30 页 |
| 掌握度总览无翻译列 | 自动新增翻译列，已有行填 `—` |
| 非学习类项目 | 跳过掌握度回填 |

# 记忆系统集成

> 通用协议（文件变更通知、行为约束写入）见 `_shared/memory-protocol.md`。本技能无特有的前置查询。

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

## 可恢复翻译契约

先读取 `_shared/operation-safety.md`。以源 PDF、章节范围和提取 hash 生成稳定 `run_id`。同 `run_id` 的 draft 必须 `resume`，保留已翻页、OCR 错误、候选键对应的视觉结果和完整性记录；只有用户明确 `replace` 才覆盖已完成翻译。每次写入后通知索引，语义部分失败保持 `draft`。

<!-- operation-safety-v1 -->
```yaml
contract_version: 1
safety_protocol: operation-safety-v1
operation: translate
run_id: stable(translate, source-pdf, chapter-range, extraction-hash)
target_path: "{资源目录}/{翻译子目录}/<书名>/<章节名>.md"
decision: [create, merge, resume, skip, replace]
on_draft: resume
replace_requires: explicit_user_request
```
