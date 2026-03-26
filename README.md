# LifeOS

AI 原生知识操作系统 — Obsidian + AI Agent 驱动的终身学习工作空间。

## 是什么

LifeOS 是一套基于 Obsidian Vault 的知识管理系统，通过 AI Agent 技能自动化知识的捕获、组织、复习和输出。它不是一个 App，而是你「生活在里面」的工作空间。

**核心组件：**

- **MCP Server** — 记忆系统，为 AI Agent 提供 Vault 索引、会话记忆、上下文组装
- **CLI 脚手架** — `npx lifeos init` 一键创建工作空间
- **技能系统** — 14 个 Agent 技能覆盖日记、项目、研究、知识整理、复习、发布等工作流
- **模板 + Schema** — 16 个结构化模板 + Frontmatter 规范，确保笔记一致性

## 快速开始

```bash
# 创建新的 LifeOS 工作空间
npx lifeos init ./my-vault

# 用 Obsidian 打开，然后用 Claude Code 开始工作
```

安装完成后，MCP server 自动注册到 Claude Code。在 Vault 目录下启动 Claude Code 即可使用所有技能。

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
