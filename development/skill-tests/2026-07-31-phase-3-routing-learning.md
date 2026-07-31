# 第三阶段：路由与学习链路行为证据

> 阶段六证据校正：本文件的“新会话”“原始输出”来自技能压力场景记录，未连接真实 Vault、
> MCP 或客户端路由器；因此它验证提示词的路由承诺而非端到端副作用。路由 YAML、模板托管
> 区块与双语一致性仍由 `routing-learning-contract.test.ts` 自动执行。

## 基线

- 上下文标识：`baseline-148e453`；提交：`148e4537846dc22f57f74c09be50cb3e5621f8aa`。
- 运行方式：四个场景均在互不共享状态的新会话中执行；先调用 `memory_bootstrap()`，路由后才加载对应 skill scope 的 `memory_context(contract_version=2, scopes=[...], include_global=false, include_related_files=true)`。
- 本文件保存完整的可复查场景证据；不依赖未追踪的临时目录。

### 场景一：今天安排什么

- 独立上下文标识：`baseline-148e453-场景一-今日安排`。
- 输入：`今天安排什么`
- 实际路由：`today`；不要求项目。
- 关键工具调用：`memory_bootstrap()`；`memory_context(contract_version=2, scopes=[{type: "skill", key: "today"}], include_global=false, include_related_files=true)`；仅在需要历史日记、候选项目、待复习项和草稿原文时调用 `memory_query(contract_version=2, ...)`。
- 原始输出：`今天做什么？`；完成摘要以 `## 早安！今日规划已就绪` 开头。
- 结论：项目只是候选上下文，不是入口前置条件。

### 场景二：把这章英文 PDF 翻译成中文

- 独立上下文标识：`baseline-148e453-场景二-PDF翻译`。
- 输入：`把这章英文 PDF 翻译成中文`
- 实际路由：`translate`；不要求项目，缺少路径时仅补问资源和页码。
- 关键工具调用：`memory_bootstrap()`；`memory_context(contract_version=2, scopes=[{type: "skill", key: "translate"}], include_global=false, include_related_files=true)`；确定资源后由 `read-pdf` 读取 PDF 原文，而非以 `memory_query` 代替。
- 原始输出：`PDF 找不到 | 提示用户提供完整路径`；无项目时 `跳过步骤五，仅产出翻译文件`。
- 结论：关联项目可选，缺少项目不能阻断独立翻译。

### 场景三：生成本周 AI 周报

- 独立上下文标识：`baseline-148e453-场景三-AI周报`。
- 输入：`生成本周 AI 周报`
- 实际路由：`digest`；不要求项目。缺配置进入 Setup，已有配置进入 Run。
- 关键工具调用：`memory_bootstrap()`；`memory_context(contract_version=2, scopes=[{type: "skill", key: "digest"}], include_global=false, include_related_files=true)`；扫描配置后按需读取 Vault 文件，周报写入后调用 `memory_notify(contract_version=2, file_path="{草稿目录}/<TopicName>-MMDD-MMDD.md")`。
- 原始输出：`写入 {草稿目录}/<TopicName>-MMDD-MMDD.md`。
- 结论：配置是前置物，不是项目文件；未识别对象时不扩展 project/file scope。

### 场景四：无项目背景创建一个独立概念 Wiki

- 独立上下文标识：`baseline-148e453-场景四-独立百科`。
- 输入：`无项目背景创建一个独立概念 Wiki`
- 实际路由：`knowledge`，但错误地要求项目。
- 关键工具调用：`memory_bootstrap()`；`memory_context(contract_version=2, scopes=[{type: "skill", key: "knowledge"}], include_global=false, include_related_files=true)`；概念明确后才可用 `memory_query(contract_version=2, ...)` 查询候选项目和知识笔记。
- 原始输出：`项目文件（必须）`、`若未提供：停止执行，提示用户先使用 /project 生成项目文件`。
- 结论：独立 Wiki 被错误绑定到项目和章节，是本阶段修正目标。

## 修正后复测

- 上下文标识：`green-routing-fresh-context-20260731`；读取工作树状态：阶段三未提交修改。
- 运行方式：四个场景仍在互不共享的新会话中复测；以下记录包含全部输入、关键工具调用、输出和结论。

### 场景一：今天安排什么

- 输入：`今天安排什么`
- 实际路由：`ask → today`；不要求项目。
- 独立上下文标识：`green-routing-fresh-context-20260731-场景一-今日安排`。
- 原始输出：`今天做什么？`
- 关键工具调用：`memory_bootstrap()` → `memory_context(contract_version=2, scopes=[{type: "skill", key: "today"}], include_global=false, include_related_files=true)`；仅为历史日记、候选项目等 Vault 原文使用 `memory_query(contract_version=2, ...)`。
- 结论：通过；未选候选不会写入日记托管区块。

### 场景二：把这章英文 PDF 翻译成中文

- 输入：`把这章英文 PDF 翻译成中文`
- 实际路由：`ask → translate`；不要求项目。
- 独立上下文标识：`green-routing-fresh-context-20260731-场景二-PDF翻译`。
- 原始输出：`请提供 PDF 的书名或完整路径，以及要翻译的章节名或页码范围。`
- 关键工具调用：`memory_bootstrap()` → `memory_context(contract_version=2, scopes=[{type: "skill", key: "translate"}], include_global=false, include_related_files=true)`；收到 PDF 后由 `read-pdf` 获取原文。
- 结论：通过；缺少的是资源参数，不是项目。

### 场景三：生成本周 AI 周报

- 输入：`生成本周 AI 周报`
- 实际路由：`ask → digest`；不要求项目。
- 独立上下文标识：`green-routing-fresh-context-20260731-场景三-AI周报`。
- 原始输出：`我将为“AI”生成本周周报。请先确认关注的子方向、偏好的信息类型（学术或行业）以及必读来源。`
- 关键工具调用：`memory_bootstrap()` → `memory_context(contract_version=2, scopes=[{type: "skill", key: "digest"}], include_global=false, include_related_files=true)`；配置和周报写入后分别调用 `memory_notify(contract_version=2, file_path="...")`。
- 结论：通过；无配置进入 Setup，有配置进入 Run。

### 场景四：无项目背景创建一个独立概念 Wiki

- 输入：`无项目背景创建一个独立概念 Wiki`
- 实际路由：`ask → knowledge` 的独立 Wiki 路径；不要求项目。
- 独立上下文标识：`green-routing-fresh-context-20260731-场景四-独立百科`。
- 原始输出：`可以按独立 Wiki 路径创建。请提供概念名，以及可核查的原文、链接或你的定义；无需项目文件。`
- 关键工具调用：`memory_bootstrap()` → `memory_context(contract_version=2, scopes=[{type: "skill", key: "knowledge"}], include_global=false, include_related_files=true)`；概念明确后才调用 `memory_query(contract_version=2, ...)` 查询同名候选笔记。
- 结论：通过；基线中“必须先创建项目”的阻断已经消除。
