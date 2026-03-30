# Run 模式执行管线

当用户执行 `/digest` 或 `/digest <主题名>` 时，按此管线执行信息抓取和周报生成。

## 前置检查

1. 检查 Python 3 是否可用：`python3 --version`
   - 不可用 → 提示用户安装 Python 3 并重试
2. 扫描 `{系统目录}/{信息子目录}/` 下的 `.md` 文件
   - 无配置文件 → 自动进入 Setup 模式（见 `setup-guide.md`）
   - 指定了主题名 → 只加载匹配文件
   - 未指定主题名 → 加载全部配置并逐个执行

## 执行管线（每个主题独立执行）

### Phase 1: 解析配置

按 `config-parser.md` 规范解析配置笔记，产出结构化数据：

```text
config = {
  topic: "LLM Agent",
  period_days: 7,
  language: "中文",
  modules: {
    rss: { enabled, feeds },
    papers: { enabled, sources },
    web: { enabled, queries, sites },
    huggingface: { enabled, keywords },
    github: { enabled, keywords }
  },
  categories: [{ name, scope }]
}
```

旧版 `arxiv` 配置块在过渡期内仍然兼容，会在执行前归一化为 `papers.sources`。

计算日期范围：

- `end_date` = 今天
- `start_date` = 今天 - `period_days`
- `date_range_str` = `MMDD-MMDD`（用于文件名）
- `date_range_display` = `YYYY-MM-DD ~ YYYY-MM-DD`（用于标题）

### Phase 2: 并行抓取

按启用的模块执行抓取。RSS + arXiv 通过 Python 脚本批量处理，其余通过 Agent 工具处理。

#### Task A: RSS + paper sources（Python 脚本）

对论文来源，脚本应遵循以下运行契约：

1. 将 `Paper Sources` 行归一化为来源 adapter 输入
2. 依次运行 `arXiv`、`bioRxiv`、`medRxiv`、`ChemRxiv`、`SocArXiv`、`SSRN` 的来源 adapters
3. 返回归一化后的论文结果以及结构化的逐来源错误
4. 某个来源失败时，保留成功来源并把失败写入 `errors`
5. 旧版 `arxiv` 配置块会先转换成 `arXiv` adapter 输入，再继续执行
6. `arXiv` adapter 在 arXiv 检索失败时会保留现有的 OpenAlex fallback 行为
7. `SocArXiv` 可以归一化到 `OSF` 落地页；`SSRN` 优先保留源站 SSRN 链接
8. 传输层保持低请求预算：每个来源一次主请求，不做分页

构造 JSON 输入并通过 stdin 传给脚本：

```bash
echo '<json_config>' | python3 .agents/skills/digest/references/rss-arxiv-script.py
```

JSON 输入从 Phase 1 的配置构造，至少包括：

```json
{
  "language": "zh",
  "rss": {...},
  "papers": {
    "enabled": true,
    "sources": [
      {
        "source_type": "arXiv",
        "query": "\"llm agent\"",
        "scope": "cs.AI",
        "notes": "核心技术论文"
      },
      {
        "source_type": "bioRxiv",
        "query": "single-cell",
        "scope": "Neuroscience",
        "notes": "生物医学预印本"
      },
      {
        "source_type": "SocArXiv",
        "query": "social identity",
        "scope": "Sociology",
        "notes": "社会科学预印本"
      }
    ]
  },
  "days": 7
}
```

脚本输出 JSON：

```json
{
  "rss_articles": [...],
  "papers": [...],
  "stats": { "rss_count": 12, "paper_count": 45 },
  "errors": [...]
}
```

#### Task B: Web 搜索（WebSearch）

对每条搜索查询模板：

1. 将 `{日期范围}` 替换为实际日期
2. 执行 WebSearch
3. 收集结果

对补充站点：

1. 生成 `site:{url} {topic}` 查询
2. 执行 WebSearch

对高价值结果，用 `defuddle` 提取正文摘要。

#### Task C: HuggingFace 热门论文（WebFetch）

1. 用 WebFetch 打开 `https://huggingface.co/papers`
2. 用配置关键词过滤结果
3. 记录标题、链接和简要描述
4. 与 arXiv 结果去重（按标题模糊匹配）

#### Task D: GitHub Trending（WebFetch，仅启用时）

1. 用 WebFetch 打开 `https://github.com/trending`
2. 用配置关键词过滤结果
3. 记录仓库名、描述、星标数和链接

### Phase 3: 合并去重

1. **去重规则**
   - 同一论文（标题相似度 > 80%）只保留最详细来源
   - 优先级：arXiv 原文 > HuggingFace > RSS 摘要 > Web 搜索

2. **分类归类**
   - 根据标题和摘要匹配配置中的分类体系
   - 「重要论文/重要文章」分类从全量结果里选出影响最大的 3-5 条
   - 无法归类的信息放入最后一个分类（通常是「行业动态」）

3. **摘要生成**
   - 每条信息用 1-2 句中文提炼核心内容
   - 附原文链接

### Phase 4: 写入周报

写入 `{草稿目录}/{topic_name}-{date_range_str}.md`。

**Frontmatter：**

```yaml
---
title: "{topic_display} 周报 · {date_range_display}"
type: draft
created: "{YYYY-MM-DD}"
status: pending
tags: [digest, {topic_tag}, weekly-digest]
aliases: []
---
```

**正文结构：**

```markdown
# {topic_display} 周报 · {date_range_display}

> 自动汇总 · RSS {N} 篇 · arXiv {M} 篇 · Web 补充 {K} 条 · 生成时间 {HH:MM}

## {category_1}

- **[标题](链接)** — 一句话中文摘要

## {category_2}

...

---

## 信息来源

**RSS 订阅：** {rss_names_list}
**论文来源：** {paper_source_summaries}
**旧版 arXiv 搜索：** {legacy_arxiv_summary if present}
**Web 搜索：** {web_sites_list}
**HuggingFace：** huggingface.co/papers
**GitHub：** github.com/trending
```

只列出已启用模块的来源。空分类不输出。

### Phase 5: 收尾

1. 调用 `memory_notify(file_path="{周报文件路径}")`
2. 输出完成提示：

```text
✅ {topic_display} 周报已写入：{草稿目录}/{topic_name}-{date_range_str}.md
   RSS {N} 篇 + arXiv {M} 篇 + Web {K} 条
```

## 多主题执行

当无参数调用 `/digest` 且存在多个配置文件时：

- 按文件名字母序逐个执行
- 每个主题独立产出一份周报
- 全部主题完成后统一输出汇总

```text
✅ 全部周报已生成：
- LLM-Agent: 00_草稿/LLM-Agent-0324-0330.md（RSS 12 + arXiv 45 + Web 8）
- SpatialAI: 00_草稿/SpatialAI-0324-0330.md（RSS 8 + arXiv 67 + Web 5）
```

## 错误处理

| 错误 | 处理 |
|------|------|
| Python 不可用 | 报错提示安装并中止执行 |
| RSS feed 超时 | 标记失败，继续其他来源 |
| 论文来源 adapter 失败 | 记录结构化来源错误，继续执行其他来源 |
| arXiv API 无响应 | 记录结构化 arXiv 错误，并尝试 OpenAlex fallback |
| WebSearch 无结果 | 跳过该查询，继续 |
| 配置解析失败 | 报错并提示具体问题 |
| 所有来源均失败 | 不生成周报，报告失败原因 |
