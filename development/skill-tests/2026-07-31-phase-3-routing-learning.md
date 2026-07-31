# 第三阶段：路由与学习链路行为证据

## 基线

- 上下文标识：`baseline-148e453`；提交：`148e4537846dc22f57f74c09be50cb3e5621f8aa`。
- 运行方式：四个场景均在互不共享状态的新会话中执行；先调用 `memory_bootstrap()`，路由后才加载对应 skill scope 的 `memory_context(contract_version=2, scopes=[...], include_global=false, include_related_files=true)`。
- 原始记录：`.superpowers/sdd/2026-07-31_LifeOS双语技能契约加固实施计划/task-3-baseline-scenarios.md`。

### 场景一：今天安排什么

- 输入：`今天安排什么`
- 实际路由：`today`；不要求项目。
- 原始输出：`今天做什么？`；完成摘要以 `## 早安！今日规划已就绪` 开头。
- 记忆选择：Layer 0 和 `today` 作用域由 `memory_context` 提供；只在需要候选笔记原文时使用 `memory_query`。

### 场景二：把这章英文 PDF 翻译成中文

- 输入：`把这章英文 PDF 翻译成中文`
- 实际路由：`translate`；不要求项目，缺少路径时仅补问资源和页码。
- 原始输出：`PDF 找不到 | 提示用户提供完整路径`；无项目时 `跳过步骤五，仅产出翻译文件`。
- 记忆选择：先加载 `translate` scope；PDF 原文由 `read-pdf` 获取，不用 `memory_query` 代替。

### 场景三：生成本周 AI 周报

- 输入：`生成本周 AI 周报`
- 实际路由：`digest`；不要求项目。缺配置进入 Setup，已有配置进入 Run。
- 原始输出：`写入 {草稿目录}/<TopicName>-MMDD-MMDD.md`。
- 记忆选择：只加载 `digest` scope；没有已识别对象时不扩展 project/file scope。

### 场景四：无项目背景创建一个独立概念 Wiki

- 输入：`无项目背景创建一个独立概念 Wiki`
- 实际路由：`knowledge`，但错误地要求项目。
- 原始输出：`项目文件（必须）`、`若未提供：停止执行，提示用户先使用 /project 生成项目文件`。
- 结论：独立 Wiki 被错误绑定到项目和章节，是本阶段修正目标。

## 修正后复测

- 上下文标识：`green-routing-fresh-context-20260731`；读取工作树状态：阶段三未提交修改。
- 原始复测记录：`.superpowers/sdd/2026-07-31_LifeOS双语技能契约加固实施计划/task-3-green-scenarios.md`。

### 场景一：今天安排什么

- 输入：`今天安排什么`
- 实际路由：`ask → today`；不要求项目。
- 原始输出：`今天做什么？`
- 记忆选择：`memory_bootstrap` → `today` 的 `memory_context`；仅为历史日记、候选项目等 Vault 原文使用 `memory_query`。
- 结论：通过；未选候选不会写入日记托管区块。

### 场景二：把这章英文 PDF 翻译成中文

- 输入：`把这章英文 PDF 翻译成中文`
- 实际路由：`ask → translate`；不要求项目。
- 原始输出：`请提供 PDF 的书名或完整路径，以及要翻译的章节名或页码范围。`
- 记忆选择：`memory_bootstrap` → `translate` 的 `memory_context`；收到 PDF 后由 `read-pdf` 获取原文。
- 结论：通过；缺少的是资源参数，不是项目。

### 场景三：生成本周 AI 周报

- 输入：`生成本周 AI 周报`
- 实际路由：`ask → digest`；不要求项目。
- 原始输出：`我将为“AI”生成本周周报。请先确认关注的子方向、偏好的信息类型（学术或行业）以及必读来源。`
- 记忆选择：`memory_bootstrap` → `digest` 的 `memory_context`；配置和周报写入后分别通知索引。
- 结论：通过；无配置进入 Setup，有配置进入 Run。

### 场景四：无项目背景创建一个独立概念 Wiki

- 输入：`无项目背景创建一个独立概念 Wiki`
- 实际路由：`ask → knowledge` 的独立 Wiki 路径；不要求项目。
- 原始输出：`可以按独立 Wiki 路径创建。请提供概念名，以及可核查的原文、链接或你的定义；无需项目文件。`
- 记忆选择：`memory_bootstrap` → `knowledge` 的 `memory_context`；概念明确后才查询同名候选笔记。
- 结论：通过；基线中“必须先创建项目”的阻断已经消除。
