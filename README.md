# LifeOS

中文 | [English](./README.en.md)

Obsidian + AI Agent，你的终身学习系统。

## 是什么

LifeOS 帮助你将碎片灵感发展为结构化知识，并真正掌握它，从随手捕获的想法，到头脑风暴与深度研究，到体系化的项目规划与知识笔记，再到间隔复习与掌握度追踪。目标不只是建立知识库，而是帮你理解、内化和驾驭复杂知识。

**核心组件：**

- **MCP Server**：记忆系统，为 AI Agent 提供 Vault 索引、会话记忆、上下文组装
- **CLI 脚手架**：`npx lifeos init` 一键创建工作空间
- **技能系统**：9 个 Agent 技能覆盖日记、项目、研究、知识整理、复习等工作流
- **模板 + 规范**：8 个结构化模板 + Frontmatter 规范，确保笔记一致性

## 前置要求

| 依赖 | 必须 | 用途 |
|---|---|---|
| **Node.js 18+** | 必须 | MCP Server 和 CLI 运行环境 |
| **Git** | 必须 | Vault 版本控制（包括记忆数据库） |
| **Python 3** | 必须 | PDF 提取（`/read-pdf` 技能） |

`lifeos init` 会在创建工作空间前自动检查所有前置依赖。

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

安装完成后，MCP server 配置会自动注册到以下工具：

| 工具 | 配置文件 |
|---|---|
| **Claude Code** | `.mcp.json` |
| **Codex** | `.codex/config.toml` |
| **OpenCode** | `opencode.json` |

在 Vault 目录下启动任一工具即可使用所有技能。

## CLI 命令

```bash
lifeos init [path] [--lang zh|en] [--no-mcp]       # 创建新 Vault
lifeos upgrade [path] [--lang zh|en]               # 升级并补齐资产与脚手架
lifeos doctor [path]                               # 健康检查
lifeos rename [path] --logical <name> --name <new>  # 重命名目录
lifeos --help                                      # 查看帮助
lifeos --version                                   # 查看版本
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
- MCP Server 注册（Claude Code / Codex / OpenCode）

### upgrade

对已初始化的 Vault 执行升级与补全：

- **始终更新**：模板、规范、提示词
- **智能合并**：技能文件未修改则更新，已修改则跳过并警告
- **缺失补全**：缺失的目录和脚手架文件会补回，例如记忆目录、`.claude/skills`、`CLAUDE.md`、`AGENTS.md`、`.gitignore`、`.git`、MCP 配置
- **尽量保留用户修改**：已存在且可能被用户自定义的文件不强制覆盖

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
| `/archive` | 归档已完成的项目、已处理的草稿和已完成的计划 |

## 自定义专家提示词

`/research` 技能会自动扫描 Vault 中提示词目录下的所有专家人格文件。LifeOS 内置了 AI/LLM、数学、艺术、历史等领域的专家人格，你可以添加自己的提示词来扩展研究能力到任何领域。

### 工作原理

调用 `/research` 时，Planning Agent 会：

1. 列出 `{系统目录}/提示词/` 下所有 `.md` 文件
2. 读取每个文件的 frontmatter 和**领域覆盖**章节
3. 将研究主题与最匹配的专家提示词进行比对
4. 将匹配的专家提示词的分析框架和输出格式应用到研究报告中

### 添加自定义专家提示词

在 Vault 的提示词目录（`{系统目录}/提示词/`）下创建 `.md` 文件即可。Planning Agent 在下次 `/research` 调用时会自动发现，无需重启或重新初始化。文件结构参照同目录下的预设提示词即可。

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
