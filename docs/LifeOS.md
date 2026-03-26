---
title: LifeOS
type: project
category: development
status: active
domain: "[[LifeOS]]"
created: "2026-03-26"
due:
priority: P1
difficulty: 高级
estimated-hours: 60-80
tags:
  - project
  - lifeos
  - open-source
  - npm
aliases:
  - lifeos
  - lifeos
---
# LifeOS

## 背景

**目标:** 将 npm 包 `lifeos`（原 `lifeos-memory`）从纯 MCP server 升级为 **LifeOS 运行时 + 脚手架 CLI**，实现一键初始化、资产分发和无缝升级，最终发布到 npm 供用户使用。

**动机:** LifeOS-V1.0-开源项目已完成核心技术栈迁移（TypeScript + MCP SDK + @node-rs/jieba），但缺少面向终端用户的安装和升级体验。用户需要一条命令就能创建完整的 LifeOS 工作空间，后续还能无缝升级模板、技能和记忆系统。


**成功指标:**

- [ ] `npx lifeos init ./my-vault` 一键创建完整工作空间（目录 + 模板 + 技能 + Schema + MCP 注册）
- [ ] `npx lifeos upgrade` 无缝升级资产文件（三档策略：自动覆盖 / 智能合并 / 不触碰）
- [ ] npm 发布：用户 `npx lifeos` 即可使用
- [ ] 中英双语模板和技能全部就绪
- [ ] 双语测试矩阵通过（zh/en/custom × 核心功能）
- [ ] GitHub 仓库发布，README + Quick Start 齐备

**核心挑战：**

1. CLI 脚手架需要在 Claude Code 未配置前独立运行——不能依赖 MCP 或技能
2. 升级机制需处理用户已自定义的文件——不能暴力覆盖
3. 资产（模板、技能、Schema）打包在 npm 包内——需要合理的目录组织和版本追踪

**限制条件:**

- 代码仓库: `~/code/node/lifeos`
- V1.0 只深度支持 Claude Code + codex + OpenCode
- MCP 工具接口向后兼容（只做加法，不做减法）

## 架构设计

### 包结构

```
lifeos/
├── src/                  # MCP server 源码（现有）
├── src/cli/              # CLI 子命令（新增）
│   ├── index.ts          # 命令路由
│   ├── init.ts           # scaffold 初始化
│   ├── upgrade.ts        # 资产升级
│   └── doctor.ts         # 诊断检查
├── assets/               # 打包分发的资产（新增）
│   ├── templates/zh/     # 中文模板
│   ├── templates/en/     # 英文模板
│   ├── skills/           # 技能文件
│   ├── schema/           # Frontmatter Schema
│   └── claude.md         # CLAUDE.md 模板
├── bin/lifeos.js         # 入口：无参数→MCP，有子命令→CLI
└── dist/                 # 编译输出
```

### CLI 命令

```
lifeos              # 默认：启动 MCP server（现有行为）
lifeos init [path]  # 新建 Vault
lifeos upgrade      # 升级资产文件
lifeos doctor       # 诊断检查
```

### 升级三档策略

| 策略 | 适用文件 | 行为 |
|---|---|---|
| **自动覆盖** | `lifeos` npm 包本身 | `npm update -g lifeos` |
| **智能合并** | 技能文件 `.agents/skills/` | 对比版本号，展示 diff，用户确认后覆盖 |
| **不触碰** | 模板、Schema（用户可能已自定义） | 仅提示有新版本可用 |

### 版本追踪

```yaml
# lifeos.yaml 记录已安装资产版本
installed_versions:
  skills: "1.0.0"
  templates: "1.0.0"
  schema: "1.0.0"
```

## 内容规划

### 阶段1: CLI 脚手架 + 资产打包

> **目标:** 实现 `npx lifeos init` 一键创建 Vault，资产从 npm 包内分发。

**交付物:**
- `src/cli/` CLI 框架（命令路由、init、doctor）
- `assets/` 目录：模板、技能、Schema、CLAUDE.md 打包
- `bin/lifeos.js` 改造：支持子命令分流
- `init` 流程：语言选择 → 目录创建 → 资产复制 → lifeos.yaml 生成 → git init → MCP 注册

**备注:** 这是最高优先级，完成后用户即可体验完整安装流程。

### 阶段2: 模板和技能双语化

> **目标:** 将 16 个模板和 13 个技能全部双语化，按语言打包到 `assets/` 中。

**交付物:**
- 16 × 2 双语模板（`assets/templates/zh/` + `assets/templates/en/`）
- 13 个技能的中英文版本
- CLAUDE.md 中英文版本
- Schema 保持英文 key（机器读取，不需双语化）

**备注:** 承接原 LifeOS-V1.0-开源项目的 Step 2 和 Step 3。

### 阶段3: 升级机制

> **目标:** 实现 `npx lifeos upgrade` 无缝升级。

**交付物:**
- `src/cli/upgrade.ts` 升级命令
- 版本追踪：资产文件头部版本标记 + `lifeos.yaml` 已安装版本记录
- 三档升级策略实现
- 变更清单展示 + 用户确认交互

**备注:** 依赖阶段1完成。

### 阶段4: 测试体系

> **目标:** 建立双语测试矩阵，确保中英文配置下行为一致。

**交付物:**
- CLI 集成测试（init / upgrade / doctor）
- 双语测试矩阵（zh / en / custom × 核心功能）
- GitHub Actions CI（Node 18/20/22）

**备注:** 承接原项目 Step 6。

### 阶段5: 文档与发布

> **目标:** 完成文档体系和 npm/GitHub 发布。

**交付物:**
- README.md（30 秒理解 + Quick Start）
- User Guide + Developer Guide
- npm 发布 `lifeos`
- GitHub 仓库 `lifeos`
- LICENSE、CHANGELOG.md、CONTRIBUTING.md

**备注:** 承接原项目 Step 7。

## 关键设计决策

1. **Scaffold CLI 取代 git clone** — 用户执行 `npx lifeos init` 生成全新 Vault，无 upstream 冲突
2. **资产打包在 npm 包内** — 模板、技能、Schema 随版本发布，升级有据可查
3. **三档升级策略** — 自动覆盖运行时，智能合并技能，不触碰用户自定义文件
4. **CLI 独立于 MCP** — init/upgrade/doctor 不依赖 Claude Code 或 MCP 协议，纯 Node.js CLI
5. **MCP 工具接口向后兼容** — 已发布的工具签名只做加法
6. **CLI init 取代 lifeos-init 技能** — 旧的 `/lifeos-init` 技能存在鸡生蛋问题（需要 MCP + 技能已加载才能执行初始化），且依赖 Python 环境（`setup.py`、`PyYAML`、`jieba`），与当前 TypeScript + Node.js 架构脱节。CLI `init` 命令纯 Node.js 实现，`npx` 直接执行，无前置依赖。技能中的完整性检查清单（目录结构、模板清单、Schema 检查）可作为 CLI 实现参考，技能本身在 CLI 完成后移除

## 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 双语模板维护成本（16 × 2 = 32 文件） | 长期同步负担 | CI 检查双语同步 |
| npm 包跨平台 native 依赖（better-sqlite3、@node-rs/jieba） | 安装失败风险 | prebuild 二进制 + 回退编译 |
| 用户自定义模板与升级冲突 | 升级覆盖用户修改 | 三档策略 + diff 展示 + 用户确认 |
| CLI 需要在无 Claude Code 环境独立运行 | 不能依赖 MCP | CLI 子命令纯 Node.js 实现 |


## 参考资源


**外部资源:**

- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) — MCP 协议实现
- [lifeos 代码仓库](~/code/node/lifeos) — 本地开发目录

## 相关

- [[90_系统/归档/项目/2026/LifeOS-V1.0-开源/LifeOS-V1.0-开源]] — 前序项目（status: done）
- [[90_系统/归档/项目/2026/LifeOS记忆系统/LifeOS记忆系统]] — 记忆系统 V0.5（status: done）

## 备注

- 技术栈：TypeScript + Node 18+ + better-sqlite3 + @node-rs/jieba + MCP TS SDK
- 核心原则：保持 Obsidian 原生、保持零外部服务依赖、保持技能可插拔、保持中文为一等公民
- 代码仓库：`~/code/node/lifeos`
