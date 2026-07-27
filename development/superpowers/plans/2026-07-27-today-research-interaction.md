# Today 与 Research 交互精简实施计划

> **给自动化执行者：** 必须使用 `executing-plans` 在隔离工作树中逐项实施。本计划不使用子 Agent。

**目标：** 精简 Today 与 Research 的用户交互，并发布 LifeOS `v2.1.2`。

**架构：** 仅修改中英文技能 Markdown 资产及 Research 的规划、执行 Agent 提示词，不改变 TypeScript 运行时、模板或双 Agent 通用编排协议。发布阶段使用仓库现有版本脚本同步全部托管资产版本，并通过现有发布门禁验证。

**技术栈：** Markdown 技能资产、Node.js 发布脚本、Vitest、TypeScript、Biome、Git。

## 全局约束

- Today 只询问“今天做什么？”一个问题。
- Research 删除知识水平和方法偏好两个问题，但保留计划审核确认。
- 不新增交互约束测试。
- 中英文资产必须保持语义一致。
- 不修改用户主工作区中现有的 `package.json` 未提交格式化改动。

---

### 任务一：精简 Today 交互

**文件：**

- 修改：`assets/skills/today/SKILL.zh.md`
- 修改：`assets/skills/today/SKILL.en.md`

**接口：**

- 输入：步骤一收集的昨日遗留、活跃项目、待复习事项和其他可执行候选。
- 输出：单个“今天做什么？”候选问题，以及不含新想法捕获结果的今日日记与摘要。

- [ ] **步骤 1：记录修改前约束**

运行：

```bash
rg -n '问题 1|问题 2|问题 3|步骤四：捕获新想法|Question 1|Question 2|Question 3|Step 4: Capture New Ideas' assets/skills/today
```

预期：中英文文件各包含三个问题和一个新想法捕获步骤。

- [ ] **步骤 2：最小化修改 Today 中英文技能**

将交互改为单个候选问题：

```text
今天做什么？
```

候选由昨日遗留、活跃项目、待复习事项及“其他”组成。删除第二、第三个问题、依赖第二个问题的草稿捕获步骤，以及目标、摘要、无响应兜底中相关描述。

- [ ] **步骤 3：检查残留与双语结构**

运行：

```bash
rg -n '问题 2|问题 3|来自问题2|已记录新想法|无新想法|Question 2|Question 3|from Question 2|New ideas captured|no new ideas' assets/skills/today
```

预期：无匹配。

- [ ] **步骤 4：提交 Today 修改**

```bash
git add assets/skills/today/SKILL.zh.md assets/skills/today/SKILL.en.md
git commit -m "feat: 精简 today 每日候选交互"
```

### 任务二：精简 Research 计划后交互

**文件：**

- 修改：`assets/skills/research/SKILL.zh.md`
- 修改：`assets/skills/research/SKILL.en.md`
- 修改：`assets/skills/research/references/planning-agent-prompt.zh.md`
- 修改：`assets/skills/research/references/planning-agent-prompt.en.md`
- 修改：`assets/skills/research/references/execution-agent-prompt.zh.md`
- 修改：`assets/skills/research/references/execution-agent-prompt.en.md`

**接口：**

- 输入：Planning Agent 生成的计划路径。
- 输出：Orchestrator 展示计划路径并等待审核确认；确认后 Execution Agent 直接按计划执行。

- [ ] **步骤 1：记录修改前约束**

运行：

```bash
rg -n '了解程度|理论理解|澄清问题回答|知识水平|方法偏好|current familiarity|theoretical understanding|Clarification Question Answers|Knowledge level|Method preference' assets/skills/research
```

预期：主技能、规划提示词和执行提示词均存在相关内容。

- [ ] **步骤 2：修改 Research 主技能**

阶段二职责改为：通知计划路径、等待用户审核确认；删除两个固定问题和答案回写步骤，保留 Domain 为 `TBD` 时的领域澄清规则。

- [ ] **步骤 3：修改 Research 规划与执行提示词**

从计划模板删除“澄清问题回答”区块；从执行提示词删除读取知识水平和方法偏好、按两者调整深度与风格的要求。

- [ ] **步骤 4：检查残留与计划确认语义**

运行：

```bash
rg -n '了解程度|理论理解|澄清问题回答|知识水平|方法偏好|current familiarity|theoretical understanding|Clarification Question Answers|Knowledge level|Method preference' assets/skills/research
rg -n '等待确认|用户确认后|wait for confirmation|After User Confirmation' assets/skills/research/SKILL.*.md
```

预期：第一条无匹配；第二条中英文均匹配计划确认语义。

- [ ] **步骤 5：提交 Research 修改**

```bash
git add assets/skills/research
git commit -m "feat: 精简 research 计划后交互"
```

### 任务三：验证功能资产

**文件：** 不新增或修改测试文件。

- [ ] **步骤 1：运行资产与文档测试**

```bash
npx vitest run tests/cli/utils/assets.test.ts tests/documentation-consistency.test.ts
```

预期：全部通过。

- [ ] **步骤 2：运行完整测试与构建门禁**

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

预期：全部以状态码 0 结束。

### 任务四：准备并验证 v2.1.2 发布

**文件：**

- 修改：`CHANGELOG.md`
- 修改：`package.json`
- 修改：`package-lock.json`
- 修改：`assets/lifeos-rules.zh.md`
- 修改：`assets/lifeos-rules.en.md`
- 修改：`assets/skills/*/SKILL.zh.md`
- 修改：`assets/skills/*/SKILL.en.md`

- [ ] **步骤 1：更新更新日志**

在顶部新增 `2.1.2` 章节，记录 Today 单问题交互和 Research 删除知识水平、方法偏好问题但保留计划确认。

- [ ] **步骤 2：运行补丁版本同步脚本**

```bash
npm run release:bump -- patch
```

预期：版本从 `2.1.1` 更新为 `2.1.2`，锁文件、全部中英文技能和规则资产同步。

- [ ] **步骤 3：运行发布门禁与打包检查**

```bash
npm run release:check-version -- v2.1.2
npm run release:verify
npm run release:pack
```

预期：版本一致性、类型检查、代码检查、574 项现有测试、构建和打包全部通过。

- [ ] **步骤 4：提交发布准备**

```bash
git add CHANGELOG.md package.json package-lock.json assets
git commit -m "release: LifeOS 2.1.2"
```

### 任务五：合并、标记并推送

- [ ] **步骤 1：确认功能分支干净且完整测试通过**

```bash
git status --short
npm test
```

- [ ] **步骤 2：在主工作区合并功能分支**

在保留用户未提交 `package.json` 改动的前提下，将 `codex/today-research-interaction` 合并到 `main`。如该改动与发布版本文件冲突，先停止并报告，不覆盖用户内容。

- [ ] **步骤 3：验证合并结果并创建标签**

```bash
npm run release:check-version -- v2.1.2
npm run release:verify
git tag -a v2.1.2 -m "LifeOS v2.1.2"
```

- [ ] **步骤 4：推送主分支与标签**

```bash
git push origin main
git push origin v2.1.2
```

- [ ] **步骤 5：确认远端引用**

```bash
git ls-remote --heads --tags origin main v2.1.2
```
