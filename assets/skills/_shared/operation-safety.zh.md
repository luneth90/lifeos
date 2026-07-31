# 操作安全协议

适用于会创建、更新、移动或恢复 Vault 产物的技能。先读取 `scripts/path_safety.mjs`，所有文件名组件和目标路径都必须通过其校验。

<!-- operation-safety-v1 -->
```yaml
contract_version: 1
run_id: stable(<skill>, <canonical-input>, <time-window-or-mode>)
target_path: resolved-vault-relative-path
decision: [create, merge, resume, skip, replace] # create|merge|resume|skip|replace
manifest: { run_id: string, moves: [], collisions: [], notified: [], errors: [] }
```

## 共同约束

1. **预检（preflight）**：在写入或移动前解析路径、检查目标冲突、读取已有 `run_id` 与状态；任何冲突先写入 manifest，不能在移动后才发现。
2. **稳定运行身份**：同一规范化输入与时间窗/模式必须得到同一 `run_id` 和目标路径。`replace` 仅在用户明确提出时允许；否则选择 `merge`、`resume` 或 `skip`。
3. **托管区块**：仅可更新带 `BEGIN AUTO` / `END AUTO` 标记的 managed region，保留用户手写内容和来源列表。
4. **路径与通知**：只对 `resolveVaultPath` 成功的路径操作。每次真实文件变更后调用 `memory_notify`；通知失败记录在 manifest，不得伪称完成。
5. **恢复**：失败时将错误和已完成步骤写入 manifest，提供由 manifest 反向执行的 rollback/恢复动作；恢复时使用相同 `run_id` 进入 `resume`。

## 降级

需要更新链接的移动优先使用 `move_with_link_update`。能力不可用时，必须取得用户对明确降级方案的同意；不得静默裸 `mv`。
