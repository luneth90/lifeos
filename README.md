# LifeOS

AI 原生知识操作系统 — Obsidian + AI Agent 驱动的终身学习工作空间。

## 是什么

LifeOS 是一套基于 Obsidian Vault 的知识管理系统，通过 AI Agent 技能自动化知识的捕获、组织、复习和输出。它不是一个 App，而是你「生活在里面」的工作空间。

**核心组件：**

- **MCP Server** — 记忆系统，为 AI Agent 提供 Vault 索引、会话记忆、上下文组装
- **CLI 脚手架** — `npx lifeos init` 一键创建工作空间
- **技能系统** — 13 个 Agent 技能覆盖日记、项目、研究、知识整理、复习、发布等工作流
- **模板 + 规范** — 16 个结构化模板 + Frontmatter 规范，确保笔记一致性

## 快速开始

```bash
# 创建新的 LifeOS 工作空间（中文）
npx lifeos init ./my-vault

# 或创建英文版
npx lifeos init ./my-vault --lang en

# 用 Obsidian 打开，然后用 Claude Code 开始工作
```

安装完成后，MCP server 自动注册到 Claude Desktop 和 Cursor。在 Vault 目录下启动 AI 编程助手即可使用所有技能。

## CLI 命令

```bash
lifeos init [path] [--lang zh|en]   # 创建新 Vault（默认中文）
lifeos upgrade [path]                # 升级资产文件（模板、技能、规范）
lifeos doctor [path]                 # 检查 Vault 健康状态
lifeos --help                        # 查看帮助
lifeos --version                     # 查看版本
```

### init

创建完整的 LifeOS 工作空间：

- 10 个顶层目录 + 子目录
- 8 个 Markdown 模板
- Frontmatter 规范
- 13 个 AI 技能（按语言自动切换）
- `CLAUDE.md` Agent 行为规范
- `lifeos.yaml` 配置文件
- Git 初始化 + `.gitignore`
- MCP server 自动注册

### upgrade

三档升级策略：

| 策略 | 适用文件 | 行为 |
|---|---|---|
| **自动覆盖** | 模板、规范 | 始终更新到最新版 |
| **智能合并** | 技能文件 | 未修改→更新，已修改→跳过并警告 |
| **不触碰** | `CLAUDE.md`、`lifeos.yaml` | 保留用户自定义 |

### doctor

检查 Vault 完整性：目录结构、模板、规范、技能、配置文件、Node.js 版本、资产版本。

## 技能一览

| 技能 | 功能 |
|---|---|
| `/today` | 晨间规划：回顾昨日、规划今日 |
| `/project` | 想法 → 结构化项目 |
| `/research` | 主题 → 深度研究报告 |
| `/knowledge` | 书籍/论文 → 知识笔记 |
| `/review` | 生成复习题、批改、追踪掌握度 |
| `/ask` | 快速问答 |
| `/brainstorm` | 交互式头脑风暴 |
| `/publish` | 知识 → 小红书文章 |
| `/ppt` | 知识 → Marp 幻灯片 |
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
npm test         # 运行测试
npm run dev      # 开发模式（热重载）
```

## License

[MIT](LICENSE)
