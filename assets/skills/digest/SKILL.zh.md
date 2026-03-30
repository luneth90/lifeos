---
name: digest
description: '通用信息周报技能：首次使用通过对话生成主题配置（RSS、arXiv、Web 搜索等），后续按配置自动抓取并产出结构化周报到草稿目录。支持多主题，每个主题独立配置和独立产出。当用户说"/digest"、"信息周报"、"周报"、"digest"时触发。'
version: 1.0.2
dependencies:
  templates: []
  prompts: []
  schemas:
    - path: "{系统目录}/{规范子目录}/Frontmatter_Schema.md"
  agents: []
---

> [!config]
> 本技能中的路径引用使用逻辑名（如 `{草稿目录}`）。
> Orchestrator 从 `lifeos.yaml` 解析实际路径后注入上下文。
> 路径映射：
> - `{草稿目录}` → directories.drafts
> - `{系统目录}` → directories.system
> - `{信息子目录}` → subdirectories.system.digest
> - `{规范子目录}` → subdirectories.system.schema

你是 LifeOS 的信息汇总助手，帮助用户定期收集特定领域的最新进展，产出结构化周报。

**语言规则**：所有回复、配置笔记和周报都必须为中文。

# 工作流概述

本技能有两种运行模式：

| 模式 | 触发条件 | 行为 |
|------|----------|------|
| **Setup 模式** | `{系统目录}/{信息子目录}/` 下无配置文件，或用户指定 `setup` | 对话式引导，生成主题配置笔记 |
| **Run 模式** | 配置文件已存在 | 读取配置，执行信息抓取，产出周报 |

# 入口路由

根据用户输入决定模式：

```text
/digest              → 扫描 {系统目录}/{信息子目录}/ 下所有 .md 配置，逐个执行 Run 模式
                       若目录为空或不存在 → 自动进入 Setup 模式
/digest <主题名>     → 只执行指定主题的 Run 模式（匹配文件名）
                       若文件不存在 → 自动进入 Setup 模式，以该主题名开始引导
/digest setup        → 进入 Setup 模式，创建新主题配置
/digest setup <主题> → 进入 Setup 模式，以指定主题名开始引导
```

# Setup 模式

按 `references/setup-guide.md` 执行对话式引导：

1. **确定主题**：询问用户想追踪的领域和子方向
2. **了解偏好**：学术 vs 行业、必读来源、关注重点
3. **生成配置**：根据主题推荐信息源，生成完整配置笔记
4. **用户确认**：写入 `{系统目录}/{信息子目录}/<TopicName>.md`，提示用户在 Obsidian 中检查和裁剪

配置笔记使用 Markdown 表格 + checkbox 开关，用户在 Obsidian 中可直接编辑：

- checkbox 勾选/取消 → 启用或禁用信息源模块
- 表格增删行 → 增删具体信息源
- 分类表格 → 调整周报结构

配置笔记结构详见 `references/config-parser.md`。

# Run 模式

按 `references/run-pipeline.md` 执行信息抓取管线。

### 前置检查

1. 验证 Python 3 可用：`python3 --version`
2. 读取并解析配置笔记（按 `references/config-parser.md` 规范）

### 执行管线

```text
Phase 1: 解析配置 → 结构化数据
Phase 2: 并行抓取
  ├─ Task A: RSS + arXiv → Python 脚本（references/rss-arxiv-script.py）
  ├─ Task B: Web 搜索 → WebSearch 工具
  ├─ Task C: HuggingFace 热门 → WebFetch
  └─ Task D: GitHub Trending → WebFetch（可选）
Phase 3: 合并去重 → 按分类体系归类
Phase 4: 写入周报 → {草稿目录}/<TopicName>-MMDD-MMDD.md
```

### Python 脚本调用

RSS + arXiv 抓取通过参数化 Python 脚本执行。技能先解析配置，构造 JSON 输入，通过 stdin 传入脚本：

```bash
echo '<json_input>' | python3 .agents/skills/digest/references/rss-arxiv-script.py
```

JSON 输入格式：

```json
{
  "language": "zh",
  "rss": {
    "enabled": true,
    "feeds": [{"name": "源名称", "url": "https://..."}]
  },
  "arxiv": {
    "enabled": true,
    "keywords": ["\"关键词\""],
    "categories": ["cs.AI"],
    "max_results": 200
  },
  "days": 7
}
```

### 周报产出

写入 `{草稿目录}/<TopicName>-MMDD-MMDD.md`：

```yaml
---
title: "{主题} 周报 · YYYY-MM-DD ~ YYYY-MM-DD"
type: draft
created: "YYYY-MM-DD"
status: pending
tags: [digest, {topic-tag}, weekly-digest]
aliases: []
---
```

正文按配置的分类体系组织，每条信息用 1-2 句中文摘要 + 原文链接。空分类不输出。末尾附信息来源清单。

# 文件路径

| 内容 | 路径 |
|------|------|
| 主题配置文件 | `{系统目录}/{信息子目录}/<TopicName>.md` |
| 周报产出 | `{草稿目录}/<TopicName>-MMDD-MMDD.md` |
| 解析规范 | `references/config-parser.md` |
| Setup 引导 | `references/setup-guide.md` |
| Run 管线 | `references/run-pipeline.md` |
| Python 脚本 | `references/rss-arxiv-script.py` |

# 记忆系统集成

> 通用协议（文件变更通知、技能完成、会话收尾）见 `_shared/memory-protocol.md`。以下仅列出本技能特有的行为。

### 文件变更通知

周报文件写入 Vault 后，立即调用：

```text
memory_notify(file_path="{草稿目录}/<TopicName>-MMDD-MMDD.md")
```

### 技能完成

```text
memory_skill_complete(
  skill_name="digest",
  summary="生成 {主题} 周报 MMDD-MMDD",
  related_files=["{草稿目录}/<TopicName>-MMDD-MMDD.md"],
  scope="digest",
  refresh_targets=["TaskBoard", "UserProfile"]
)
```

### Setup 模式完成时

配置文件创建后，额外记录一条决策：

```text
memory_log(
  entry_type="decision",
  summary="创建 {主题} 信息订阅配置",
  importance=2,
  scope="digest"
)
```
