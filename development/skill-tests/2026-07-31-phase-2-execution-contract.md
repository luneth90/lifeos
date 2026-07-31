# 阶段二执行契约行为记录

## RED：旧行为基线

本记录由两个独立的新上下文只读场景生成，未修改技能文件。

1. 用户确认计划后编辑计划：旧共享协议只等待一次确认，随后直接执行，缺少 `plan_revision`、
   `confirmed_hash` 和重确认分支；结论为失败。
2. 执行 Agent 只写半成品：Project 的编排者只验 ID 与目录即可提交，Research 的执行 Agent 还会在
   完整性校验前把来源草稿与计划标为 `done`；结论为失败。
3. 客户端没有 Task 类工具：旧协议硬编码该工具，没有能力探测或顺序降级；结论为失败。

可回查证据：`assets/skills/_shared/dual-agent-orchestrator.zh.md` 的阶段 1—3，Project 与 Research
双语主技能和执行提示词的基线版本；压力场景输出由本阶段独立只读代理保留在当前任务会话。

## GREEN：迁移后的预期行为

1. 确认后计划被编辑时，重新计算 `confirmed_hash`；revision 或 hash 改变即保持 `pending` 并重新确认。
2. 半成品或来源失败时，Execution Manifest 保留 `errors`，Research 报告保持 `draft`，来源草稿不变，
   计划改为 `failed`；只有独立回读 artifacts 后才能提交 `done`。
3. 缺少 `spawn_agent` 时，编排者按相同输入和验收标准顺序执行；其余能力按
   `client-capabilities.md` 的 fallback 降级。

验证命令：

```text
npx vitest run tests/skill-contracts/execution-contract.test.ts tests/assets/project-identity-script.test.ts tests/documentation-consistency.test.ts tests/cli/utils/assets.test.ts
```

结果：4 个测试文件、35 项测试通过。
