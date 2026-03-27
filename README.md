# LifeOS

中文 | [English](./README.en.md)

LifeOS 帮助你将碎片灵感发展为结构化知识，并真正掌握它，从随手捕获的想法，到头脑风暴与深度研究，到体系化的项目规划与知识笔记，再到间隔复习与掌握度追踪。目标不只是建立知识库，而是帮你理解、内化和驾驭复杂知识。

## 记忆系统

> **记忆系统为什么重要**
>
> 记忆系统是 LifeOS 的核心能力，它以目录级、技能绑定的方式工作，把学习过程中的上下文、偏好与决策持续沉淀下来，让长期学习更连贯、更可追踪，也更容易形成积累。
> 1. **跨会话连续性**：会话桥接和活跃文档上下文会持续沉淀，Agent 不只依赖当前对话。
> 2. **项目级、技能绑定**：记忆系统围绕当前 Vault 中的 LifeOS 项目运行，只在 `today`、`project`、`research`、`knowledge`、`revise`、`archive` 等技能工作流里激活，并持续积累偏好、决策和上下文。
> 3. **比全局记忆更可控**：相较于把跨目录内容和全局会话混在一起的记忆方式，项目级、技能绑定的记忆系统能减少无关噪声，让检索结果与后续决策更贴近当前 LifeOS 工作流。

**核心组件：**

- **记忆系统**：项目级、技能绑定，为 AI Agent 提供 Vault 索引、会话记忆、上下文组装
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

开始前，请确保本机已安装 Obsidian，以及 Claude Code / Codex / OpenCode CLI 中至少一种。

```bash
# 创建新的 LifeOS 工作空间（根据系统 locale 自动检测语言）
npx lifeos init ./my-vault

# 或显式指定语言
npx lifeos init ./my-vault --lang zh   # 中文
npx lifeos init ./my-vault --lang en   # 英文
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
npx lifeos init [path] [--lang zh|en] [--no-mcp]       # 创建新 Vault
npx lifeos upgrade [path] [--lang zh|en]               # 升级并补齐资产与脚手架
npx lifeos doctor [path]                               # 健康检查
npx lifeos rename [path]                               # 交互式重命名目录
npx lifeos --help                                      # 查看帮助
npx lifeos --version                                   # 查看版本
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

- **智能合并**：模板、规范、内置提示词、技能文件未修改则更新，已修改则跳过并警告
- **缺失补全**：缺失的目录和脚手架文件会补回，例如记忆目录、`.claude/skills`、`CLAUDE.md`、`AGENTS.md`、`.gitignore`、`.git`、MCP 配置
- **保留用户修改**：已存在且被用户改过的内置文件不会被强制覆盖

### doctor

检查 Vault 完整性：目录结构、模板、规范、技能、配置文件、Node.js 版本、资产版本。

### rename：目录可自定义化

无需额外参数，直接执行 `npx lifeos rename [path]` 后，CLI 会列出当前 Vault 中可调整的目录，并通过交互引导你选择目录和输入新名称。它会同步更新 `lifeos.yaml`、重命名实际目录，并批量替换 Vault 中所有相关的 wikilink。

这意味着 LifeOS 的目录命名不是固定死的。你可以根据自己的工作流、语言习惯和项目结构，自由调整各个目录的名称，同时保持配置和链接关系一致，获得最大的使用自由度。

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

## 致谢

本项目的灵感来源于 [MarsWang42/OrbitOS](https://github.com/MarsWang42/OrbitOS)。
