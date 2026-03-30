# LifeOS
![LifeOS 示例](./example.png)
[English](./README.md) | 中文

LifeOS 帮助你将碎片灵感发展为结构化知识，并真正掌握它，从随手捕获的想法，到头脑风暴与深度研究，到体系化的项目规划与知识笔记，再到间隔复习与掌握度追踪。目标不只是建立知识库，而是帮你理解、内化和驾驭复杂知识。

## 为什么开发 LifeOS？

LifeOS 的出发点很直接：把学习工作流、技能、模板、提示词和记忆系统整合成一套可以直接落地的完整方案。你不需要自己从零拼装工具链，也不必在不同工具之间来回切换，初始化后即可开箱即用，并在真实使用中持续沉淀知识、流程与偏好。

## 核心功能

### 记忆系统

> 记忆系统是 LifeOS 的核心能力，它以目录级、技能绑定的方式工作，把学习过程中的上下文、偏好与决策持续沉淀下来，让长期学习更连贯、更可追踪，也更容易形成积累。

#### 跨会话连续性

会话桥接和活跃文档上下文会持续沉淀，Agent 不只依赖当前对话。

#### 项目级、技能绑定

记忆系统围绕当前 Vault 中的 LifeOS 项目运行，只在 `today`、`project`、`research`、`knowledge`、`revise`、`digest`、`archive` 等技能工作流里激活，并持续积累偏好、决策和上下文。

#### 比全局记忆更可控

相较于把跨目录内容和全局会话混在一起的记忆方式，项目级、技能绑定的记忆系统能减少无关噪声，让检索结果与后续决策更贴近当前 LifeOS 工作流。

### 目录自定义

LifeOS 不把目录命名固定死。执行 `lifeos rename [path]` 后，CLI 会交互式列出当前 Vault 中可调整的目录，引导你选择目录并输入新名称。

它会同步更新 `lifeos.yaml`、重命名实际目录，并批量替换 Vault 中所有相关的 wikilink。你可以根据自己的工作流、语言习惯和项目结构自由调整目录名称，同时保持配置和链接关系一致。

### 学习工作流

LifeOS 提供一组围绕学习过程设计的 Agent 技能，把“输入 -> 理解 -> 产出 -> 巩固”串成连续工作流：

- `/today`、`/brainstorm`、`/ask`：整理当天重点、澄清问题、快速展开想法
- `/project`、`/research`、`/knowledge`：把主题推进成项目、研究报告和知识笔记
- `/digest`：按主题订阅论文、RSS 与 Web 更新，自动生成结构化信息周报
- `/read-pdf`、`/revise`、`/archive`：从资料提取、复习巩固，到定期归档收束

## 核心组件

- **记忆系统**：项目级、技能绑定，为 AI Agent 提供 Vault 索引、会话记忆、上下文组装
- **CLI 脚手架**：全局安装后使用 `lifeos init` 一键创建工作空间
- **技能系统**：10 个 Agent 技能覆盖日记、项目、研究、信息周报、知识整理、复习等工作流
- **模板 + 规范**：8 个结构化模板 + Frontmatter 规范，确保笔记一致性

## 快速开始

目前已确认 macOS 上的 Claude Code TUI / Codex TUI / OpenCode TUI，以及 Windows 上 OpenCode GUI 可以正常使用。其他 GUI 桌面端或平台/客户端组合尚未完成验证，实际兼容性仍需进一步测试。

### 前置要求

开始前，请确保本机已安装 Obsidian，以及 Claude Code TUI / Codex TUI / OpenCode TUI / OpenCode GUI 中至少一种。

| 依赖 | 必须 | 用途 |
|---|---|---|
| **Node.js 24.14.1+ (LTS)** | 必须 | MCP Server 和 CLI 运行环境 |
| **Python 3** | 必须 | PDF 提取（`/read-pdf`）和信息周报抓取脚本（`/digest`） |

`lifeos init` 会在创建工作空间前自动检查所有前置依赖。

### 安装与初始化

```bash
# 第一步：全局安装 CLI
npm install -g lifeos

# 第二步：创建新的 LifeOS 工作空间（根据系统 locale 自动检测语言）
lifeos init ./my-vault

# 或显式指定语言
lifeos init ./my-vault --lang zh   # 中文
lifeos init ./my-vault --lang en   # 英文
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
lifeos init [path] [--lang zh|en] [--no-mcp]           # 创建新 Vault
lifeos upgrade [path] [--lang zh|en] [--override]      # 升级并补齐资产与脚手架
lifeos doctor [path]                                   # 健康检查
lifeos rename [path]                                   # 交互式重命名目录
lifeos --help                                          # 查看帮助
lifeos --version                                       # 查看版本
```

### init

创建完整的 LifeOS 工作空间：

- 10 个顶层目录 + 嵌套子目录
- 8 个 Markdown 模板
- Frontmatter 规范
- 10 个 AI 技能（按语言自动切换）
- `CLAUDE.md` Agent 行为规范
- `lifeos.yaml` 配置文件
- Git 初始化 + `.gitignore`
- MCP Server 注册（Claude Code / Codex / OpenCode）

### upgrade

对已初始化的 Vault 执行升级与补全：

- **智能合并**：模板、规范、内置提示词、技能文件未修改则更新，已修改则跳过并警告
- **缺失补全**：缺失的目录和脚手架文件会补回，例如记忆目录、`.claude/skills`、`CLAUDE.md`、`AGENTS.md`、`.gitignore`、`.git`、MCP 配置
- **保留用户修改**：已存在且被用户改过的内置文件不会被强制覆盖
- **`--override` 强制刷新资源**：覆盖模板、规范、提示词、技能、`CLAUDE.md`、`AGENTS.md` 以及 MCP 配置，但不会删除用户笔记、资源、`memory.db`、记忆系统数据，也不会改写 `lifeos.yaml` 里的目录和记忆配置

默认执行 `lifeos upgrade` 时，会尽量保留你已经改过的资源文件，只更新未修改内容并补齐缺失项。如果你希望直接用当前版本的内置模板、技能、规范和 MCP 配置重新覆盖这些资源，可以显式加上 `--override`：

```bash
lifeos upgrade ./my-vault --override
```

### doctor

检查 Vault 完整性：目录结构、模板、规范、技能、配置文件、Node.js 版本、资产版本。

### rename：目录可自定义化

无需额外参数，直接执行 `lifeos rename [path]` 后，CLI 会列出当前 Vault 中可调整的目录，并通过交互引导你选择目录和输入新名称。它会同步更新 `lifeos.yaml`、重命名实际目录，并批量替换 Vault 中所有相关的 wikilink。

这意味着 LifeOS 的目录命名不是固定死的。你可以根据自己的工作流、语言习惯和项目结构，自由调整各个目录的名称，同时保持配置和链接关系一致，获得最大的使用自由度。

## 技能一览

| 技能 | 功能 |
|---|---|
| `/today` | 晨间规划：回顾昨日、规划今日 |
| `/project` | 想法 → 结构化项目 |
| `/research` | 主题 → 深度研究报告 |
| `/digest` | 主题订阅 → 结构化信息周报 |
| `/knowledge` | 书籍/论文 → 知识笔记 |
| `/revise` | 生成复习题、批改、追踪掌握度 |
| `/read-pdf` | PDF → 结构化笔记 |
| `/ask` | 快速问答 |
| `/brainstorm` | 交互式头脑风暴 |
| `/archive` | 归档已完成的项目、已处理的草稿、已完成的计划，以及超过最近 7 天的日记 |

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

## 里程碑

- ✅ LifeOS 1.0 版本已初步可用
- ✅ CLI 支持目录自定义
- ✅ CLI upgrade 支持智能更新
- ✅ 已完成 macOS 上 Claude Code TUI / Codex TUI / OpenCode TUI 与 Windows 上 OpenCode GUI 的验证
- ✅ `/digest` 技能已支持中英双语信息周报与多来源论文抓取
- ☐ 强化记忆系统精准性
- ☐ 支持自定义技能
- ☐ 支持自定义工作流

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
