# Setup 模式引导流程

当用户首次使用 `/digest` 或执行 `/digest setup` 时，按此流程引导用户创建主题配置。

## 触发条件

- `{系统目录}/{信息子目录}/` 下没有 `.md` 配置文件
- 用户显式调用 `/digest setup` 或 `/digest setup <主题>`

## 对话流程

### Step 1: 确定主题

若用户未指定主题名：

```text
你想追踪什么领域的最新进展？

给我一个主题名（如 "LLM Agent"、"空间智能"、"Rust 生态"、"量化投资"），
以及你最关注的 2-3 个子方向。
```

若用户已指定主题名（如 `/digest setup LLM-Agent`），跳过此步，直接进入 Step 2。

**输出：** 确定 `topic_name`（英文文件名）和 `topic_display`（可中文显示名）。

### Step 2: 了解偏好

```text
关于「{topic_display}」，帮我了解几个偏好：

1. 内容类型：偏学术论文、行业动态，还是两者都要？
2. 必读来源：有没有你已经长期关注的博客、Newsletter 或账号？
3. 关注子方向：具体哪些方面最重要？这些会决定周报分类。
```

### Step 3: 生成配置

根据主题和偏好，用 Agent 能力推荐信息源，生成完整配置笔记。

**生成策略：**

1. **RSS / Newsletter**
   - 用 WebSearch 验证 URL 可用性
   - 推荐 5-15 个高质量信息源
   - 优先选择提供 RSS feed 的来源

2. **arXiv 关键词**
   - 生成 10-20 个搜索关键词（含引号短语）
   - 匹配合适的 arXiv 类别（如 `cs.AI`、`cs.CL`、`cs.CV`、`cs.RO`）
   - 非学术主题默认禁用

3. **Web 搜索**
   - 为无 RSS 的重要来源设计 3-5 条查询模板
   - 补充 5-10 个重点站点

4. **HuggingFace**
   - 为 AI / ML 主题生成筛选关键词
   - 非 AI / ML 主题默认禁用

5. **GitHub Trending**
   - 为技术主题生成筛选关键词
   - 非技术主题默认禁用

6. **分类体系**
   - 根据子方向生成 5-8 个分类
   - 第一个固定为「重要论文/重要文章」
   - 最后一个固定为「行业动态」

**配置文件模板：**

```markdown
---
title: "{topic_display} 信息"
type: system
created: "{YYYY-MM-DD}"
tags: [digest, subscription]
aliases: []
---

# {topic_display} 信息

## 基本信息

| 字段 | 值 |
|------|----|
| 主题 | {topic_display} |
| 周期 | 每周 |
| 语言 | 中文 |

## 信息源

### RSS 订阅

- [x] 启用

| 名称 | URL | 方向 |
|------|-----|------|
| {name} | {url} | {description} |
...

### arXiv 搜索

- [x] 启用

| 关键词 | 类别 |
|--------|------|
| {keyword} | {categories} |
...

### Web 搜索

- [x] 启用

| 搜索查询模板 | 目标覆盖 |
|-------------|----------|
| {query_template} | {target} |
...

**补充站点（无 RSS，Web 搜索覆盖）：**

| 名称 | URL | 方向 |
|------|-----|------|
| {name} | {url} | {description} |
...

### HuggingFace 热门论文

- [{x_or_space}] 启用

**筛选关键词：** {keyword1}, {keyword2}, ...

### GitHub Trending

- [{x_or_space}] 启用

**筛选关键词：** {keyword1}, {keyword2}, ...

## 分类体系

周报按以下分类组织，空分类不输出：

| 分类 | 覆盖范围 |
|------|----------|
| {category} | {scope} |
...

## 信息来源清单

周报末尾自动附加的来源总览（由配置自动生成）。
```

### Step 4: 用户确认

将配置笔记写入 `{系统目录}/{信息子目录}/{topic_name}.md`。

```text
✅ 配置文件已创建：{系统目录}/{信息子目录}/{topic_name}.md

请在 Obsidian 中打开检查：
- 用 checkbox 关闭不需要的信息源模块
- 增删 RSS 源、arXiv 关键词、Web 搜索目标
- 调整分类体系

确认后，运行 `/digest {topic_name}` 即可生成第一期周报。
```

## 注意事项

- 引导过程最多 3 轮对话，不要过度询问
- Agent 推荐的信息源应具体到 URL，不要只给名称
- 用户提到的必读来源必须包含在配置中
- 非技术主题（如理财、历史）应自动禁用 arXiv、HuggingFace、GitHub 模块
