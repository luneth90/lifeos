# 操作安全协议

适用于会创建、更新、移动或恢复 Vault 产物的技能。先读取 `scripts/path_safety.mjs`，所有文件名组件和目标路径都必须通过其校验。

<!-- operation-safety-v1 -->
```yaml
contract_version: 1
run_id: stable(<skill>, <canonical-input>, <time-window-or-mode>)
target_path: resolved-vault-relative-path
decision: [create, merge, resume, skip, replace] # create|merge|resume|skip|replace
path_guard:
  resolve_scope: preflight_only
  create: createVaultPathGuard
  revalidate: revalidateVaultPathGuard
  required_at: [before_operation, after_operation]
  on_change: abort_and_record
  atomic_race_guarantee: false
  untrusted_concurrency: require_atomic_client_capability
manifest: { run_id: string, moves: [], collisions: [], notified: [], errors: [] }
```

## 共同约束

1. **预检（preflight）**：在写入或移动前解析路径、检查目标冲突、读取已有 `run_id` 与状态；任何冲突先写入 manifest，不能在移动后才发现。
2. **稳定运行身份**：同一规范化输入与时间窗/模式必须得到同一 `run_id` 和目标路径。`replace` 仅在用户明确提出时允许；否则选择 `merge`、`resume` 或 `skip`。
3. **托管区块**：仅可更新带 `BEGIN AUTO` / `END AUTO` 标记的 managed region，保留用户手写内容和来源列表。
4. **路径 guard 与通知**：`resolveVaultPath` 只用于 preflight，返回值不是可长期持有的安全能力。为最终目标创建 `createVaultPathGuard`，在每次实际 write/move 紧邻的前后都调用 `revalidateVaultPathGuard`；祖先的 realpath、dev 或 ino 变化、父级被替换或变成符号链接时立即中止，并把错误与恢复动作写入 manifest。不得在 guard 复核后长期复用裸路径。每次真实文件变更后调用 `memory_notify`；通知失败记录在 manifest，不得伪称完成。
5. **恢复**：失败时将错误和已完成步骤写入 manifest，提供由 manifest 反向执行的 rollback/恢复动作；恢复时使用相同 `run_id` 进入 `resume`。

## 原子竞态边界

guard 能发现两次复核之间的父级替换，但不能在跨平台 Node 中消除“最后一次复核与系统调用之间”由不受信任进程触发的原子竞态，因此本协议不宣称提供该保证。若威胁模型包含这种并发篡改，必须使用客户端提供的不跟随符号链接、受控且原子的文件能力；该能力不可用时失败关闭。

## 降级

需要更新链接的移动优先使用 `move_with_link_update`。能力不可用时，必须取得用户对明确降级方案的同意；不得静默裸 `mv`。
