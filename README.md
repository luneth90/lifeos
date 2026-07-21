<p align="center">
  <img src="./assets/logo.svg" alt="LifeOS" width="480" />
</p>

<p align="center">
  <a href="./README.en.md">English</a> | 中文
</p>

LifeOS 帮助你将碎片灵感发展为结构化知识，并真正掌握它，从随手捕获的想法，到头脑风暴与深度研究，到体系化的项目规划与知识笔记，再到间隔复习与掌握度追踪。目标不只是建立知识库，而是帮你理解、内化和驾驭复杂知识。

## 为什么开发 LifeOS？

LifeOS 的出发点很直接：把学习工作流、技能、模板、提示词和记忆系统整合成一套可以直接落地的完整方案。你不需要自己从零拼装工具链，也不必在不同工具之间来回切换，初始化后即可开箱即用，并在真实使用中持续沉淀知识、流程与偏好。

## 核心功能

### 目录结构

清晰的目录结构是知识学习和研究的基础，LifeOS 围绕「灵感 → 研究 → 学习 → 复习 → 归档」的学习流程设计了 10 个顶层目录：

```
Vault/
├── 00_草稿/          # 无结构知识池，零碎想法随时写入
├── 10_日记/          # 每日日志（YYYY-MM-DD.md）
├── 20_项目/          # 进行中的项目
├── 30_研究/          # 深度研究报告，按 领域/主题/ 组织
├── 40_知识/          # 知识库：体系化笔记 + 百科概念
├── 50_成果/          # 文章、教程、讲稿等可交付输出
├── 60_计划/          # /research 和 /project 的执行计划
├── 70_资源/          # 原始资料：书籍、文献
├── 80_复盘/          # 周期性回顾与系统校准
└── 90_系统/          # 模板、规范、提示词、归档
```

1. `lifeos init` 会自动生成上述默认目录结构。
2. 所有目录名均可通过 `lifeos rename` 自定义。

### 学习工作流

LifeOS 提供一组围绕学习过程设计的 Agent 技能，把”输入 -> 理解 -> 产出 -> 巩固”串成连续工作流：

- `/today`、`/brainstorm`、`/ask`：整理当天重点、澄清问题、快速展开想法
- `/project`、`/research`、`/knowledge`：把主题推进成项目、研究报告和知识笔记
- `/digest`：按主题订阅论文、RSS 与 Web 更新，自动生成结构化信息周报
- `/read-pdf`、`/revise`、`/archive`：从资料提取、复习巩固，到定期归档

知识笔记的掌握状态只按 `draft → review → revised → mastered` 向前推进，不允许降级。

### 记忆系统

LifeOS 当前使用单一最终契约：`contract_version=2` 与 `Schema V4`。MCP 固定暴露 7 个工具：

| 工具 | 用途 |
| --- | --- |
| `memory_bootstrap` | 新会话第一步，返回只含全局信息的 Layer 0 |
| `memory_query` | 查询 Vault 中的笔记、项目和知识索引 |
| `memory_context` | 任务路由后，按显式 scope 获取局部上下文 |
| `memory_log` | 写入显式 `item_kind` 与 `scope` 的规则、决策、事实或画像 |
| `memory_rules` | 审计记忆条目 |
| `memory_forget` | 按 `item_id` 和原因软归档条目 |
| `memory_notify` | 通知单个 Vault 文件发生变化 |

`memory_bootstrap` 是唯一不传 `contract_version`、也是唯一返回 `_layer0` 的工具。其余工具必须传 `contract_version=2`，版本错误会在运行时触碰 Vault 或数据库前被拒绝。

记忆条目以 `(scope.type, scope.key, slot_key)` 为稳定身份。scope 支持 `global`、`skill`、`project`、`repository`、`tool`、`file`；同一 slot 可以在不同 scope 中分别存在。Layer 0 只加载全局规则、画像摘要和当前焦点，局部规则必须通过 `memory_context` 显式请求。

完整字段、优先级、预算、升级与治理说明见 [记忆协议 V2](./docs/memory-contract-v2.md)。

## 快速开始

已验证可用：macOS 上的 Claude Code CLI、Codex（CLI / Desktop）、OpenCode（CLI / Desktop）；Windows 上的 Codex Desktop、OpenCode Desktop。其他平台或客户端组合尚未验证。

### 前置要求

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

## 升级

当 LifeOS 发布新版本后，按以下步骤升级已有 Vault：

```bash
# 第一步：更新 CLI 到最新版本
npm update -g lifeos

# 第二步：升级 Vault 资产与脚手架
lifeos upgrade ./my-vault
```

`npm update -g lifeos` 会拉取最新 CLI 和内置资源；`lifeos upgrade` 执行离线、原子化 cutover：先在 Vault 外创建备份和 journal，再安装最终资产、迁移数据库、验证完整契约并写入 runtime receipt。任一步失败都会尝试恢复原 Vault。

运行时只接受 `Schema V4`，不会隐式迁移旧数据库。`Schema V1`、`Schema V2`、`Schema V3` 中存在旧记忆条目时，升级必须提供逐条核验的 scope map：

```bash
lifeos upgrade ./my-vault --scope-map ./v4-scope-map.json
```

`--override` 已删除。升级会切换整套托管资产，不提供双结构兼容模式；用户笔记和资源通过 cutover 备份保护。

## CLI 命令

```bash
lifeos init [path] [--lang zh|en] [--no-mcp]              # 创建新 Vault
lifeos upgrade [path] [--lang zh|en] [--scope-map file]   # 离线原子升级；旧记忆需要 scope map
lifeos doctor [path]                                      # 健康检查
lifeos rename [path]                                      # 交互式重命名目录
lifeos rules list|audit|export [path]                      # 只读审计与导出记忆
lifeos rules classify|archive|restore [path]               # 显式治理记忆条目
lifeos --help                                             # 查看帮助
lifeos --version                                          # 查看版本
```

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
| `/translate` | 英文 PDF 章节 → 中文对照阅读笔记，支持 PDF++ 双窗口阅读 |
| `/ask` | 快速问答 |
| `/brainstorm` | 交互式头脑风暴 |
| `/archive` | 归档已完成的项目、已处理的草稿、已完成的计划，以及超过最近 7 天的日记 |

## 自定义科研信息周报

`/digest` 技能帮你按主题订阅论文、RSS 和 Web 更新，自动生成结构化信息周报。

### 配置（Setup）

首次使用时，运行 `/digest setup` 进入交互式配置：

1. **定义主题**：输入关注的主题名称和 2–3 个子方向
2. **选择偏好**：说明偏向学术还是产业、有哪些必读来源
3. **生成配置**：Agent 自动推荐 RSS、论文源（arXiv / bioRxiv / SSRN 等）、Web 搜索模板、HuggingFace Papers、GitHub Trending，并写入配置文件
4. **审阅调整**：配置文件保存为 Markdown，你可以在 Obsidian 中直接编辑——切换来源开关、增删 RSS、调整搜索关键词

### 生成周报（Run）

配置完成后，运行 `/digest <主题>` 即可生成周报：

1. **解析配置**：读取主题配置，计算时间窗口（周刊 7 天 / 双周刊 14 天 / 月刊 30 天）
2. **并行抓取**：同时从 RSS + 论文源、Web 搜索、HuggingFace、GitHub Trending 四路获取数据
3. **去重分类**：合并结果、去除重复，按配置的分类体系归入各板块
4. **输出周报**：生成带摘要的结构化周报到草稿目录，标注重点论文和文章

支持多主题并行，每个主题独立配置、独立产出。

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

- **Runtime:** TypeScript + Node.js 24+
- **Protocol:** MCP SDK（@modelcontextprotocol/sdk）
- **Database:** better-sqlite3 + FTS5（全文搜索）
- **Segmentation:** @node-rs/jieba（中文分词）
- **Validation:** Zod（schema 校验）
- **Test:** Vitest
- **Lint:** Biome
- **Vault:** Obsidian（纯 Markdown + Frontmatter）

## 里程碑

- ✅ LifeOS 1.0 版本已初步可用
- ✅ CLI 支持目录自定义
- ✅ CLI upgrade 支持 V1/V2/V3 → V4 离线原子升级与失败恢复
- ✅ 记忆系统支持全局、技能、项目、仓库、工具和文件 scope
- ✅ 已完成 macOS（Claude Code CLI、Codex CLI/Desktop、OpenCode CLI/Desktop）与 Windows（Codex Desktop、OpenCode Desktop）的验证
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
npm test         # 运行全部测试
npm run dev      # 开发模式（热重载）
```

## License

[MIT](LICENSE)

## 致谢

本项目的灵感来源于 [MarsWang42/OrbitOS](https://github.com/MarsWang42/OrbitOS)。
