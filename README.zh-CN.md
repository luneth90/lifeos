# LifeOS

中文 | [English](./README.md)

AI 原生知识操作系统 — Obsidian + AI Agent 驱动的终身学习工作空间。

## 是什么

LifeOS 是一套基于 Obsidian Vault 的知识管理系统，通过 AI Agent 技能自动化知识的捕获、组织、复习和输出。它不是一个 App，而是你「生活在里面」的工作空间。

**核心组件：**

- **MCP Server** — 记忆系统，为 AI Agent 提供 Vault 索引、会话记忆、上下文组装
- **CLI 脚手架** — `npx lifeos init` 一键创建工作空间
- **技能系统** — 9 个 Agent 技能覆盖日记、项目、研究、知识整理、复习等工作流
- **模板 + 规范** — 8 个结构化模板 + Frontmatter 规范，确保笔记一致性

## 快速开始

```bash
# 创建新的 LifeOS 工作空间（根据系统 locale 自动检测语言）
npx lifeos init ./my-vault

# 或显式指定语言
npx lifeos init ./my-vault --lang zh   # 中文
npx lifeos init ./my-vault --lang en   # 英文

# 跳过 MCP 注册（仅创建目录和文件）
npx lifeos init ./my-vault --no-mcp

# 用 Obsidian 打开，然后用 AI 编程助手开始工作
```

安装完成后，MCP server 配置自动注册到以下工具：

| 工具 | 配置文件 |
|---|---|
| **Claude Code** | `.mcp.json` |
| **Codex** | `.codex/config.toml` |
| **OpenCode** | `opencode.json` |

在 Vault 目录下启动任一工具即可使用所有技能。

## CLI 命令

```bash
lifeos init [path] [--lang zh|en] [--no-mcp]  # 创建新 Vault
lifeos upgrade [path]                           # 升级资产文件（模板、技能、规范）
lifeos doctor [path]                            # 健康检查
lifeos rename [path] --logical <name> --name <new>  # 重命名目录
lifeos --help                                   # 查看帮助
lifeos --version                                # 查看版本
```

### init

创建完整的 LifeOS 工作空间：

- 10 个顶层目录 + 嵌套子目录
- 8 个 Markdown 模板
- Frontmatter 规范
- 9 个 AI 技能（按语言自动切换）
- `CLAUDE.md` Agent 行为规范
- `lifeos.yaml` 配置文件
- Git 初始化 + `.gitignore`
- MCP server 注册（Claude Code / Codex / OpenCode）

### upgrade

三档升级策略：

| 策略 | 适用文件 | 行为 |
|---|---|---|
| **自动覆盖** | 模板、规范 | 始终更新到最新版 |
| **智能合并** | 技能文件 | 未修改→更新，已修改→跳过并警告 |
| **不触碰** | `CLAUDE.md`、`lifeos.yaml` | 保留用户自定义 |

### doctor

检查 Vault 完整性：目录结构、模板、规范、技能、配置文件、Node.js 版本、资产版本。

### rename

重命名逻辑目录（如 `drafts`）为新的物理名称，同时更新 `lifeos.yaml` 并批量替换 Vault 中所有相关的 wikilink。

## 技能一览

| 技能 | 功能 |
|---|---|
| `/today` | 晨间规划：回顾昨日、规划今日 |
| `/project` | 想法 → 结构化项目 |
| `/research` | 主题 → 深度研究报告 |
| `/knowledge` | 书籍/论文 → 知识笔记 |
| `/revise` | 生成复习题、批改、追踪掌握度 |
| `/read-pdf` | PDF → 结构化笔记 |
| `/ask` | 快速问答 |
| `/brainstorm` | 交互式头脑风暴 |
| `/archive` | 归档已完成的项目和草稿 |

## 技术栈

- **Runtime:** TypeScript + Node.js 18+
- **Database:** SQLite + FTS5（全文搜索）
- **Segmentation:** @node-rs/jieba（中文分词）
- **Protocol:** MCP (Model Context Protocol)
- **Vault:** Obsidian（纯 Markdown + Frontmatter）

## 开发

```bash
git clone git@github.com:luneth90/lifeos.git
cd lifeos
npm install
npm run build    # 编译 TypeScript
npm test         # 运行测试（431 个）
npm run dev      # 开发模式（热重载）
```

## License

[MIT](LICENSE)
