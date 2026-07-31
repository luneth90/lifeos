# 双 Agent 执行编排协议

本协议是 Project 与 Research 的唯一提交语义。先读取 `client-capabilities.md` 并通过语义能力
`spawn_agent` 启动独立上下文；该能力不可用时由编排者顺序执行同一提示词、输入和验收标准。

## 阶段 0：记忆与输入检查

调用最小 `memory_query(contract_version=2, ...)`，检查同主题产物、来源草稿的 `status: pending` 与近期决策。
读取计划、模板、Schema 和来源文件；计划创建时必须写为 `status: pending`。

## 阶段 1：规划与确认摘要

1. 以 `spawn_agent` 运行 Planning Agent；它返回计划路径、`plan_revision`（从 `1` 开始）与计划内容的
   SHA-256 `confirmed_hash`。
2. 回读计划，生成包含路径、revision、hash、来源草稿与预期 artifacts 的快照，再请求用户确认。
3. 用户取消时把计划写为 `status: cancelled`，不消费来源草稿并结束。

## 阶段 2：确认校验与执行

严格按以下顺序执行：`plan(status: pending) → snapshot → user-confirm → hash-check → plan(status: active) → execute → manifest → independent-validate → notify-each-file → mutate-sources → plan(status: done) → report`。

开始执行前再次回读计划并重算 SHA-256。`plan_revision` 或 `confirmed_hash` 任一变化都会使确认摘要失效：
把计划保留或恢复为 `status: pending`，展示新摘要并重新确认，绝不能继续执行。通过校验后才更新为
`status: active` 并启动 Execution Agent。

Execution Agent 只能写预期 artifacts，不得更新计划、来源草稿或持久记忆；它返回符合
`assets/schema/Execution_Manifest_Schema.json` 的 manifest，包含实际 artifacts、验证项、拟议状态变更和
`errors`。失败将 manifest phase 写为 `failed`，计划写为 `status: failed`，来源草稿保持原状。

## 阶段 3：独立验收与提交

编排者独立回读 manifest 的每个 artifact，核对计划范围、模板、Schema、链接、来源台账和完成度；不得把
Execution Agent 自报当作验收。任一 artifact 缺失、半成品或任何关键验证失败时，保留来源草稿原状态，计划
写为 `status: failed`，报告缺口，不得提交来源状态。

所有验证通过后，按 artifact 逐个调用 `memory_notify(contract_version=2, file_path="<Vault 相对路径>")`，
然后才更新来源草稿和其他允许的来源状态；最后将计划写为 `status: done` 并通知用户。报告必须列出 artifacts、
验证结果、状态变更和 errors（即使为空）。
