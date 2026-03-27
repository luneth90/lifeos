# CLAUDE.md / AGENTS.md 重构建议

## 现状

4 个文件：`claude.zh.md`、`claude.en.md`、`agents.zh.md`、`agents.en.md`，每个 189 行。

**核心发现：`claude.*.md` 与 `agents.*.md` 内容 100% 相同（diff 无差异）。**

---

## 已识别问题

### 问题 1：CLAUDE.md ≡ AGENTS.md 完全重复

**严重程度：高**

两个文件内容完全一致，维护时改一个忘改另一个就会漂移。但它们的目标平台不同：
- `CLAUDE.md` → Claude Code（Anthropic）
- `AGENTS.md` → Codex（OpenAI）、OpenCode 等

目前没有任何平台差异化内容，完全是复制粘贴。

**建议**：提取共享内容为 `_base.*.md`，CLAUDE.md 和 AGENTS.md 各自只保留平台特有指令。或者如果确认长期无差异，在 init 代码中直接复制同一源文件到两个目标路径。

### 问题 2：术语与 Schema 不一致

**严重程度：高**

| 位置 | 当前内容 | 应为 |
|------|---------|------|
| 目录结构 L21 | `原子化概念` (zh) / `Atomic concepts` (en) | `百科概念` / `Wiki concepts` |
| 目录结构 L38 | `review`（回顾/复盘）隐含的 type | `retro`（Schema 已改） |
| 目录结构 L31 | `提示词/` 子目录 | 当前 lifeos.yaml 中无此子目录定义 |

### 问题 3：技能表使用硬编码触发关键词

**严重程度：高**

技能表的"触发关键词"列与已完成的技能重构方向矛盾——技能 description 已改为场景化触发，不依赖硬编码关键词。CLAUDE.md 中的触发词列表会让 Agent 只在看到这些精确词汇时才激活技能，窄化了触发范围。

**建议**：删除"触发关键词"列，改为"适用场景"列，与 SKILL.md description 对齐。

### 问题 4：read-pdf 技能缺失

**严重程度：中**

技能表列出 8 个技能，缺少 `read-pdf`。

### 问题 5：状态流转与 _shared/lifecycle.zh.md 重复

**严重程度：中**

草稿状态流转（L124-133）和知识笔记掌握度流转（L135-155）与 `_shared/lifecycle.zh.md` 内容重复。但 CLAUDE.md 作为顶层指令文件，这里的重复是有意义的——Agent 启动时只读 CLAUDE.md，不一定读 _shared/。

**建议**：保留，但确保与 _shared/lifecycle.zh.md 一致。当前内容已一致，标记为"与 `_shared/lifecycle.md` 同源维护"即可。

### 问题 6：Vault 操作工具表假设特定 MCP 插件

**严重程度：中**

L102-111 强制要求使用 `obsidian-cli`、`obsidian-markdown`、`obsidian-bases`、`json-canvas` 四个 MCP 工具。但：
1. 这些是第三方 Obsidian MCP 插件，不是 LifeOS 自带的
2. 用户不一定安装了这些插件
3. AGENTS.md 发送给 Codex 等平台，这些平台可能根本没有 MCP 支持

**建议**：改为条件性指令："若 Vault 中安装了以下 MCP 工具，优先使用它们"。或拆分到平台特有部分。

### 问题 7：`## 规则` 标题是空节

**严重程度：低**

L65 `## 规则` 后面紧跟 L67 `## 记忆系统规则`，两个同级标题，第一个没有内容。应该是 `## 规则` 作为父标题，下面的都是子节。

**建议**：删除空的 `## 规则`，或将其改为包含子节的结构（`## 规则` 下用 `###`）。

### 问题 8：目录结构列出硬编码默认名

**严重程度：低**

每个目录都标注 `（默认 XX_目录名）`。这些默认值来自 preset，如果用户自定义了 lifeos.yaml，这些注释就是错的。但作为文档参考，列出默认值有助于理解。

**建议**：保留，但标注"以 lifeos.yaml 实际配置为准"。

---

## 重构方案

### 方案 A：单源复制（推荐）

既然内容完全相同且短期内不会分化，不再维护 4 个源文件，改为 2 个：

```
assets/
  lifeos-rules.zh.md    # 唯一中文源
  lifeos-rules.en.md    # 唯一英文源
```

`init` 命令将同一源文件复制为 `CLAUDE.md` 和 `AGENTS.md`：

```typescript
// init.ts
const rulesSrc = join(assetsDir(), `lifeos-rules.${lang}.md`);
copyFileSync(rulesSrc, join(targetPath, 'CLAUDE.md'));
copyFileSync(rulesSrc, join(targetPath, 'AGENTS.md'));
```

**优点**：零重复，改一处自动同步两个目标。
**缺点**：未来需要平台差异化时要重新拆分。

### 方案 B：共享基座 + 平台覆盖

```
assets/
  rules-base.zh.md      # 共享内容（目录结构、技能表、规则）
  rules-base.en.md
  claude-extra.zh.md     # Claude 特有指令（可为空）
  claude-extra.en.md
  agents-extra.zh.md     # Codex/OpenCode 特有指令（可为空）
  agents-extra.en.md
```

`init` 时拼接：`base + extra → CLAUDE.md / AGENTS.md`。

**优点**：为未来差异化预留扩展点。
**缺点**：当前 extra 全为空，过度设计。

### 推荐：方案 A

当前没有任何平台差异化需求。方案 A 最简单，未来需要分化时再拆分。

---

## 内容修改清单

无论选择哪个方案，以下内容修改都需要执行：

### 1. 术语修正

| 行 | 当前 | 修改为 |
|----|------|--------|
| zh L21 | `原子化概念` | `百科概念` |
| en L21 | `Atomic concepts` | `Wiki concepts` |

### 2. 技能表重写

删除"触发关键词"列，改为"适用场景"描述，与各 SKILL.md description 对齐。补充 read-pdf 技能。

**中文版新表：**

| 技能 | 功能 | 适用场景 |
|------|------|---------|
| `/today` | 晨间规划：回顾昨日、规划今日、连接活跃项目 | 一天开始时、想了解今天该做什么时 |
| `/project` | 将想法或资源转化为结构化项目 | 有了明确的想法想正式推进、拿到一本书想系统学习、草稿成熟到可以立项时 |
| `/research` | 深度研究主题，产出结构化报告 | 想深入了解某个主题、需要多角度调研、草稿需要展开为完整分析时 |
| `/ask` | 快速问答，可选保存为草稿 | 有具体问题想快速得到解答、不需要完整研究流程时 |
| `/brainstorm` | 交互式头脑风暴，探索和深化想法 | 有一个还不成熟的想法想聊聊、需要发散思维、探索方向可行性时 |
| `/knowledge` | 从书籍/论文蒸馏结构化知识笔记和百科概念 | 读完一章想整理笔记、需要将原文结构化为知识体系时 |
| `/review` | 生成复习文件、批改并更新掌握度 | 想复习已学内容、测验掌握程度、巩固薄弱环节时 |
| `/archive` | 归档已完成项目和已处理草稿 | 想清理 Vault、整理已完成的工作时 |
| `/read-pdf` | 解析 PDF 为结构化 JSON | 需要将 PDF 文件转为可处理的文本时 |

### 3. type 枚举同步 Schema

`review`（回顾/复盘）→ `retro`。删除 `content` 相关描述（若 Schema 中已删除）。

### 4. 修复标题层级

```markdown
## 规则                    ← 删除这个空标题

## 记忆系统规则            ← 保留
```

或改为正确的层级结构：

```markdown
## 规则

### 记忆系统规则
#### 触发条件
#### 调用规则
...
### Frontmatter 规范
### 草稿状态流转
...
```

### 5. Vault 操作工具改为条件性

```markdown
### Vault 操作工具（若已安装）

若 Vault 中配置了以下 MCP 工具，优先使用：

| 工具 | 用途 |
|------|------|
| `obsidian-cli` | Vault 目录读取、搜索、frontmatter 过滤 |
| `obsidian-markdown` | 创建/编辑 .md 笔记 |
| `obsidian-bases` | 创建/编辑 .base 文件 |
| `json-canvas` | 创建/编辑 .canvas 文件 |

未安装时，使用平台原生文件操作工具。
```

### 6. 目录结构补充说明

在目录结构开头添加：

```markdown
> 以下默认目录名来自 `lifeos.yaml` preset，实际名称以用户 Vault 中的 `lifeos.yaml` 为准。
```

---

## 实施步骤

1. **选定方案**（A 或 B）
2. **重命名源文件**（若方案 A：`claude.zh.md` → `lifeos-rules.zh.md`，删除 `agents.zh.md`）
3. **执行内容修改清单**（6 项）
4. **更新 init.ts**（复制逻辑调整）
5. **更新 upgrade.ts**（如果有涉及）
6. **运行测试**确认无回归

---

## 文件影响

| 文件 | 操作 |
|------|------|
| `assets/claude.zh.md` | 重命名为 `lifeos-rules.zh.md`（方案A）或保留并修改 |
| `assets/claude.en.md` | 重命名为 `lifeos-rules.en.md`（方案A）或保留并修改 |
| `assets/agents.zh.md` | 删除（方案A）或保留并同步修改 |
| `assets/agents.en.md` | 删除（方案A）或保留并同步修改 |
| `src/cli/commands/init.ts` | 修改复制逻辑 |
| `src/cli/commands/upgrade.ts` | 检查是否需要同步修改 |
| `assets/schema/Frontmatter_Schema.md` | 已修改完成，无需再改 |
