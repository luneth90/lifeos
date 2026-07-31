# 操作安全协议

适用于会创建、更新、移动或恢复 Vault 产物的技能。先读取 `scripts/path_safety.mjs`，所有文件名组件和目标路径都必须通过其校验。

<!-- operation-safety-v1 -->
```yaml
contract_version: 1
preflight: required
validation: required
notification: memory_notify
collision: preflight_required
recovery: resume_same_run_id
run_id: stable(<skill>, <canonical-input>, <time-window-or-mode>)
target_path: resolved-vault-relative-path
decision: [create, merge, resume, skip, replace] # create|merge|resume|skip|replace
path_guard:
  resolve_scope: preflight_only
  create: createVaultPathGuard
  revalidate: revalidateVaultPathGuard
  advance: advanceVaultPathGuard
  captures: [ancestors, leaf_state, leaf_type, leaf_dev, leaf_ino, leaf_realpath]
  default_leaf_expectation: unchanged
  transitions:
    create_or_update_target: { before: missing, after: existing }
    move_source: { before: existing, after: missing }
    move_target: { before: missing, after: existing }
  required_at: [before_operation, after_operation]
  on_change: abort_and_record
  atomic_race_guarantee: false
  untrusted_concurrency: require_atomic_client_capability
directory_creation:
  create_guard: createVaultDirectoryGuard
  ensure: ensureVaultDirectory
  strategy: guard_revalidate_single_level_mkdir_advance_revalidate
  recursive_mkdir: false
manifest: { run_id: string, moves: [], collisions: [], notified: [], errors: [] }
```

## 共同约束

1. **预检（preflight）**：在写入或移动前解析路径、检查目标冲突、读取已有 `run_id` 与状态；任何冲突先写入 manifest，不能在移动后才发现。
2. **稳定运行身份**：同一规范化输入与时间窗/模式必须得到同一 `run_id` 和目标路径。`replace` 仅在用户明确提出时允许；否则选择 `merge`、`resume` 或 `skip`。
3. **托管区块**：仅可更新带 `BEGIN AUTO` / `END AUTO` 标记的 managed region，保留用户手写内容和来源列表。
4. **路径 guard 与通知**：`resolveVaultPath` 只用于 preflight，返回值不是可长期持有的安全能力。为最终目标创建 `createVaultPathGuard`：它既捕获祖先身份，也以 `lstat` 捕获叶节点；已有叶节点必须不是符号链接，并记录 type、dev、ino、realpath，不存在的叶节点记录为 `missing`。在每次实际 write/move 紧邻之前调用 `revalidateVaultPathGuard`；默认复核要求祖先和叶节点状态、身份完全不变。原地更新后再次调用 `revalidateVaultPathGuard`。若操作合法改变了叶节点状态，紧邻操作后改用 `advanceVaultPathGuard(guard, { before, after })`，并以返回的新 guard 替换旧 guard；仅允许新建/更新目标 `missing → existing`、移动源 `existing → missing` 和移动目标 `missing → existing`。推进到 `existing` 时仍拒绝符号链接，并确认 realpath 在 Vault 内。任何状态、type、dev、ino、realpath 或父级身份变化都立即中止，并把错误与恢复动作写入 manifest。不得在 guard 复核后长期复用裸路径。每次真实文件变更后调用 `memory_notify`；通知失败记录在 manifest，不得伪称完成。
5. **目录创建**：禁止以递归创建直接跨过 guard。先调用 `createVaultDirectoryGuard` 冻结从已存在 Vault root 到目标目录的逐级状态，再调用 `ensureVaultDirectory`。每个缺失目录都执行 create guard → 紧邻复核 → 单级 `mkdir` → `missing → existing` 推进 → 再复核；每个已有目录也必须验证非符号链接、目录类型、身份和祖先身份。任一变化失败关闭。
6. **恢复**：失败时将错误、已完成步骤和人工恢复动作写入 manifest；恢复时使用相同 `run_id` 进入 `resume`。没有实现自动撤销的操作不得声称已撤销。

## 原子竞态边界

guard 能发现两次复核之间的父级或叶节点替换；显式状态推进会校验操作后的实际状态，但不能证明该对象一定由当前操作创建。跨平台 Node 也不能消除“最后一次复核与系统调用之间”由不受信任进程触发的原子竞态，因此本协议不宣称提供该保证。若威胁模型包含这种并发篡改，必须使用客户端提供的不跟随符号链接、受控且原子的文件能力；该能力不可用时失败关闭。

## 降级

需要更新链接的移动优先使用 `move_with_link_update`。能力不可用时，必须取得用户对明确降级方案的同意；不得静默裸 `mv`。
