# 阶段一实施报告：统一 Schema、模板与生命周期

## 结果

- 已新增可解析的 `frontmatter-contract-v1`，覆盖 draft、project、plan、research、translation、knowledge、revise-record 与 retro。
- 已统一双语模板动态 ID，新增 Translation 模板，并将 Project、Research、Retrospective 的契约字段迁移到统一模型。
- 已将归档语义改为保留业务终态并追加 `archived: "YYYY-MM-DD"`。
- 已将 Project 与 Research 的调用输入统一为 `{{PROJECT_INPUT}}`、`{{RESEARCH_INPUT}}`，并要求 Project/Research/Translation 从唯一模板渲染。

## RED-GREEN 证据

### RED

命令：`npx vitest run tests/skill-contracts/data-contract.test.ts`

结果：5 项失败。失败覆盖缺少 Schema translation 契约、模板固定 ID、缺少 Translation 模板、生命周期/归档使用 archived 状态，以及 Project 输入占位符不一致。

### GREEN

命令：`npx vitest run tests/skill-contracts/data-contract.test.ts tests/cli/utils/assets.test.ts tests/documentation-consistency.test.ts`

结果：3 个测试文件、33 项测试全部通过。

## 行为记录

迁移前与迁移后三个场景的实际证据写入：
`development/skill-tests/2026-07-31-phase-1-data-contract.md`。

## 自检

- `git diff --check` 通过。
- 中英文模板、生命周期、共享协议和直接生成技能均成对更新。
- 未修改 `package.json`。

## 顾虑

本阶段将计划初始状态统一为 `pending`；依赖旧 `status: active` 作为“待确认”含义的历史计划，在后续迁移阶段应按新状态模型处理。
