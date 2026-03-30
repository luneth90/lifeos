# 配置笔记解析规范

本文档定义 `/digest` 技能如何解析 `{系统目录}/{信息子目录}/<TopicName>.md` 配置笔记。

## 文件结构

配置笔记由以下固定 section 组成，按二级/三级标题识别：

```text
# <主题名> 信息              ← 标题（不解析）
## 基本信息                   ← 键值表格
## 信息源                     ← 容器标题（不解析）
  ### RSS 订阅               ← 模块：checkbox + 表格
  ### Paper Sources          ← 模块：checkbox + 表格
  ### arXiv 搜索             ← 旧版模块：checkbox + 表格（仍兼容）
  ### Web 搜索               ← 模块：checkbox + 表格 + 补充站点表格
  ### HuggingFace 热门论文    ← 模块：checkbox + 关键词行
  ### GitHub Trending         ← 模块：checkbox + 关键词行
## 分类体系                   ← 分类表格
## 信息来源清单               ← 不解析，周报生成时自动填充
```

## 解析规则

### 1. 基本信息

定位 `## 基本信息`，解析其下的两列表格（`字段 | 值`）：

| 字段 | 用途 | 必填 |
|------|------|------|
| 主题 | 主题名，用于周报标题和文件命名 | 是 |
| 周期 | `每周` / `每两周` / `每月`，决定回溯天数 | 是 |
| 语言 | 周报输出语言 | 是 |

**周期映射：**

- `每周` → 7 天
- `每两周` → 14 天
- `每月` → 30 天

### 2. 模块启用状态

每个三级标题（`###`）后的第一个 checkbox 决定启用状态：

```markdown
### RSS 订阅

- [x] 启用
```

```markdown
### GitHub Trending

- [ ] 启用
```

**解析逻辑：**

1. 找到 `###` 标题行
2. 向下扫描，找到第一个匹配 `- \[[ x]\]` 的行
3. `[x]` 视为启用，`[ ]` 视为禁用

### 3. 模块数据解析

#### RSS 订阅

表格 schema：`名称 | URL | 方向`

```json
{
  "enabled": true,
  "feeds": [
    {"name": "Import AI", "url": "https://importai.substack.com", "description": "AI 前沿研究综述"}
  ]
}
```

**URL 处理：**

- 若 URL 不以 `http` 开头，自动补全 `https://`
- 若 URL 不含 `/feed` 或 `/rss`，可尝试在末尾追加 `/feed` 作为 RSS 地址

#### Paper Sources

表格 schema：`Source Type | Query | Scope | Notes`

```json
{
  "enabled": true,
  "sources": [
    {
      "source_type": "arXiv",
      "query": "\"LLM agent\"",
      "scope": "cs.AI, cs.CL",
      "notes": "核心技术论文"
    },
    {
      "source_type": "bioRxiv",
      "query": "single-cell",
      "scope": "Neuroscience",
      "notes": "生物医学预印本"
    }
  ]
}
```

**Phase 1 支持的来源类型：** `arXiv`、`bioRxiv`、`medRxiv`、`ChemRxiv`。
**字段含义：** `Query` 是检索词或关键词短语；`Scope` 是该来源使用的类别、集合或期刊
过滤；`Notes` 是给 helper 的自由说明。
**归一化：** helper 会把每一行转换成独立来源 adapter 输入，并在不同来源之间去重。
**兼容策略：** 新配置优先使用这个模型。

#### arXiv 搜索

表格 schema：`关键词 | 类别`

```json
{
  "enabled": true,
  "keywords": ["\"LLM agent\"", "\"tool use\" language model"],
  "categories": ["cs.AI", "cs.CL", "cs.IR"],
  "max_results": 200
}
```

**旧版兼容：** 解析器仍然接受 `### arXiv 搜索`，并将其归一化为一个 `arXiv` 论文来源，
确保旧配置继续可用。
**关键词语言：** 关键词必须是英文词或英文引号短语。若出现中文关键词，则将 arXiv
来源视为配置错误。
**类别去重：** 合并所有行的类别列，去重后作为搜索范围。
**主抓取行为：** 类别用于官方 arXiv feed 抓取，关键词只在本地对标题和摘要做过滤。
**fallback 行为：** 若类别缺失，或官方 arXiv 路径失败，可回退到 OpenAlex，但只保留能映射回
arXiv 的论文。
**max_results：** 固定 200，不在配置中暴露。

#### Web 搜索

两张表格：

1. **搜索查询模板**（`搜索查询模板 | 目标覆盖`）
2. **补充站点**（`名称 | URL | 方向`）

查询模板中的 `{日期范围}` 在运行时替换为实际日期。补充站点用于额外构造 `site:` 查询。

#### HuggingFace 热门论文

定位 `**筛选关键词：**` 行，按逗号分割提取关键词列表。

#### GitHub Trending

同 HuggingFace，定位 `**筛选关键词：**` 行。

### 4. 分类体系

定位 `## 分类体系`，解析表格 `分类 | 覆盖范围`：

```json
{
  "categories": [
    {"name": "重要论文", "scope": "本周影响力最大的 3-5 篇论文"},
    {"name": "框架与工具", "scope": "Agent 框架、开发工具、SDK 更新"}
  ]
}
```

## 容错规则

| 异常 | 处理 |
|------|------|
| 模块标题不在枚举中 | 忽略该 section |
| 模块无 checkbox | 视为启用 |
| 表格列数不匹配 | 按已有列解析，缺失列填空 |
| 基本信息缺少必填字段 | 报错并提示用户补全 |
| 配置文件为空或格式错误 | 报错并建议运行 `/digest setup` |
