# 阶段二执行契约行为记录

> 阶段六证据校正：RED 的两次独立上下文压力审阅与自动化 RED 均为可回查证据；GREEN 列表
> 描述的是迁移后共享协议的静态契约结果，不应当表述为已运行的真实客户端执行。执行清单
> Schema、能力协议与确认顺序由 `execution-contract.test.ts` 和阶段六校验器持续验证。

## RED：独立上下文压力场景

两次检查均通过 `collaboration.spawn_agent` 创建，参数为 `fork_turns: "none"`，只读、禁止改文件和提交。
两个代理均以完成状态返回；以下保留了实际输入、独立上下文标识和关键原始输出节选。

### 场景 A：Project 确认失效与半成品

- 独立上下文：`/root/phase2_implementer/phase2_baseline_project`
- 调用方式：`spawn_agent(task_name="phase2_baseline_project", fork_turns="none")`
- 输入/提示：检查 Project 与共享编排；压力场景为“用户确认计划后又编辑计划”和“执行代理只写了一半文件”，
  要求引用路径和行号判断是否重新确认、是否禁止将来源草稿或计划标为 `done`。
- 完成状态：`completed`，无文件修改。
- 原始关键输出节选：

> “用户确认计划后又编辑计划：未强制重新确认（失败）”。
>
> “共享协议只要求在审核阶段‘等待用户确认’，随后直接启动执行 Agent，没有确认版本、摘要或修改检测”。
>
> “半成品只要保留合法且唯一的 ID（开发项目再满足目录规则），即可通过现有验收，随后由 Orchestrator 将草稿和计划置为 `done`”。

### 场景 B：Research 提交语义与客户端降级

- 独立上下文：`/root/phase2_implementer/phase2_baseline_research`
- 调用方式：`spawn_agent(task_name="phase2_baseline_research", fork_turns="none")`
- 输入/提示：检查 Research、Brainstorm 和共享编排；压力场景为“确认后编辑计划”“半成品写入”和
  “客户端没有 Task 类工具”，要求逐项给出证据、失败理由和行号。
- 完成状态：`completed`，无文件修改。
- 原始关键输出节选：

> “三个压力场景当前均存在契约缺口”。
>
> “步骤七无条件要求每个‘已使用’草稿改为 `done`；步骤九也在校验前将计划设为 `done`”。
>
> “无 Task 时流程在规划或执行启动点中断，无法保留‘先规划、用户确认、再按已确认计划执行’的核心语义”。

## RED：自动化契约测试

命令：

```text
npx vitest run tests/skill-contracts/execution-contract.test.ts tests/assets/project-identity-script.test.ts
```

退出码：`1`。关键汇总：`2` 个测试文件失败、`7` 项测试失败，原因是执行清单 Schema、能力协议、
项目 ID 脚本和确认摘要编排均不存在。

## GREEN：迁移后的静态契约

1. 确认后计划被编辑时，重新计算 `confirmed_hash`；revision 或 hash 改变即保持 `pending` 并重新确认。
2. 半成品或来源失败时，Execution Manifest 保留 `errors`，Research 报告保持 `draft`，来源草稿不变，
   计划改为 `failed`；只有独立回读 artifacts 后才能提交 `done`。
3. 缺少 `spawn_agent` 时，编排者按相同输入和验收标准顺序执行；其余能力按
   `client-capabilities.md` 的 fallback 降级。
4. PDF 读取与翻译通过 `execute_command` 按“初始化解释器 → `python3` → Windows `py -3`”解析 Python 3；
   只发现 Python 2 或无法解析时明确失败。

覆盖验证命令、退出码和关键汇总见阶段报告 `task-2-report.md` 的“修复轮次 1”。
