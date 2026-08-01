# Translate 移除印刷页码与页码映射设计

## 背景

`/translate` 当前同时展示 PDF 物理页和原书印刷页，并在翻译模板中生成逐页映射。翻译笔记已经能够把正文、公式、表格和可靠图表放回相应位置，这组对照信息不再提供足够的阅读价值，反而增加模板字段、执行分支和完整性记录噪声。

本次调整只收窄翻译消费层。`/read-pdf` 仍是通用 PDF 提取能力，其 `printed_page_label` 字段可能被其他消费者使用，因此不修改提取脚本、Schema 或底层测试。

## 方案比较

### 方案一：只从 Translate 消费层移除（采用）

- 删除翻译技能对 `printed_page_label` 的读取、暂存和输出。
- 删除双语翻译模板中的 `pdf_page_labels`、印刷页码信息和页码映射章节。
- 保留 `pdf_page_index`，继续用于请求范围、裁剪、稳定资源名、缺页诊断和无图号回退定位。
- 保留 `/read-pdf` 的通用印刷页码字段。

优点是边界清晰、影响最小，能完整满足翻译阅读需求。代价是提取包仍包含翻译不会消费的字段，这是合理的生产者—消费者解耦。

### 方案二：同时删除 Read PDF 的印刷页码字段（不采用）

可以减少提取包字段，但会修改公共 Schema、提取脚本和所有潜在消费者，超出本次需求，也会造成不必要的兼容性破坏。

### 方案三：只隐藏模板展示（不采用）

改动最少，但技能仍会生成占位符、保存印刷页码并写入完整性记录，留下不可见的冗余契约，后续容易再次漂移。

## 最终行为

### 输入与提取

`requested_pages` 继续作为完整性和 `PDF_PAGE_RANGE` 的唯一范围依据。初始视觉候选只保留：

```text
{pdf_page_index, order, bbox}
```

候选键仍为 `(pdf_page_index, order)`。翻译流程不读取或保存 `printed_page_label`。

### 模板与占位符

双语模板都执行以下变化：

- 删除 Frontmatter 字段 `pdf_page_labels`。
- 删除占位符 `PDF_PAGE_LABELS`。
- 删除来源信息中的印刷页码行。
- 删除整个“页码映射”章节。
- 保留 `pdf_page_range` 和来源区块中的 PDF 物理页范围。

翻译技能的必填占位符列表同步移除 `PDF_PAGE_LABELS`。

### 图表呈现与回退

- 有可靠图号的嵌图图注只写 `> 图 X.X`。
- 没有可靠图号的嵌图图注写 `> 原书图表`，不得编造图号。
- 有可靠图号的自动回退只写 `> 📖 见原书图 X.X`。
- 无可靠图号时，写 `> 📖 见原书相关图表（PDF 物理页 XX，block.order N）`，保留机器可追踪定位，但不形成印刷页与物理页对照。

PDF 物理页仍可用于文件名 `<source-sha12>-p<page>-b<order>.png`、裁剪命令和故障记录。这些都是执行定位，不属于页码映射。

### 完整性记录与完成摘要

- 语义缺页只记录 `pdf_page_index`、错误码和实际完整度。
- `reference` 只记录 PDF 物理页、图号或 `block.order`、自动降级原因。
- 完成摘要的来源行只保留 PDF 物理页范围，不再追加印刷页码状态。
- 删除“印刷页码未知”的边界分支。

语义门禁、五类视觉处理、状态转换、幂等恢复、项目回填和资产清理行为保持不变。

## 双语一致性

以下四个发布资产必须同步修改：

- `assets/skills/translate/SKILL.zh.md`
- `assets/skills/translate/SKILL.en.md`
- `assets/templates/zh/Translation_Template.md`
- `assets/templates/en/Translation_Template.md`

英文资产表达同一契约，不允许保留中文版本已经删除的占位符、字段或映射章节。

## 测试设计

先添加失败测试，验证：

1. 双语 Translate 技能与模板不再包含 `PDF_PAGE_LABELS`、`pdf_page_labels`、印刷页码或页码映射语义。
2. 双语模板仍包含 `PDF_PAGE_RANGE` 与 `pdf_page_range`。
3. 初始视觉候选契约只保留 `pdf_page_index`、`order` 和 `bbox`。
4. 图注、自动回退和完整性记录使用新格式。
5. `/read-pdf` Schema 仍保留 `printed_page_label`，证明本次没有破坏公共提取协议。

目标契约测试转绿后运行技能契约、文档一致性及全量测试。

## 非目标

- 不修改 `/read-pdf` 提取脚本或 PDF Schema。
- 不删除 PDF 物理页范围或内部物理页索引。
- 不修改裁剪算法、图表分类、锚点优先级或回退状态语义。
- 不修改既有翻译笔记；新模板只影响后续生成或显式覆盖的产物。
- 不调整版本号、标签或远端发布状态。
