# 第六阶段技能契约与场景证据

日期：2026-07-31

本记录把可机械验证的资产契约与判断型压力场景分开保存。除明确标注为“受控执行”的一节外，
场景均为独立新上下文对资产的只读审阅，不把静态结论冒充真实客户端或 Vault 端到端执行。

## 契约校验器受控执行

- 输入：仓库根目录及 `tests/fixtures/skill-contracts/broken` 下的最小错误资产。
- 上下文标识：`phase6-validator-controlled-20260731`。
- 旧行为：跨语言成对性、依赖、占位符、模板 ID、能力和生命周期只能依靠分散静态测试；默认目录示例与未声明移动能力不会集中失败。
- 新行为：`validateSkillContracts(root)` 独立遍历 Markdown、YAML 与 JSON，并以稳定排序返回 `{ ok, diagnostics }`；CLI 对错误资产返回 `1`，对真实资产返回 `0`。
- 产物：`scripts/validate-skill-contracts.mjs`、最小错误资产夹具和诊断列表。
- 状态变化：无 Vault 实体状态变化；真实资产只能在诊断为空时视为可发布。
- 关键原始输出：`技能契约校验通过`；错误夹具包含 `missing_locale_pair`、`missing_dependency`、`placeholder_mismatch`、`unknown_generated_type`、`invalid_template_id`、`hardcoded_logical_path`、`undeclared_capability`、`invalid_lifecycle_transition` 与 `capability_contract_mismatch`。
- 证据等级：受控自动执行；`validator.test.ts` 同时验证诊断形状、路径排序和 CLI 退出码。

## 场景一：上下文压缩恢复

- 输入：`我想做一个帮助研究人员梳理论文的个人知识图谱工具`；发散阶段已有部分结论后发生上下文压缩。
- 独立上下文标识：`/root/phase6_implementer/scenario_context_recovery`。
- 旧行为：基线只要求阶段 0 最小查询并规定“Phase 1 全程不再中断查 Vault”，未指定 checkpoint、索引通知或压缩后的恢复入口。
- 新行为：首次 checkpoint 复用或由 `Draft_Template.md` 创建 `{草稿目录}/Brainstorm_YYYY-MM-DD_<Topic>.md`；发散、收敛、交接边界保存确认结论、未决问题和下一步，写后紧邻 `memory_notify(contract_version=2, file_path=...)`；压缩后读取最新 checkpoint 续接。
- 产物：同名 Brainstorm 草稿、最新 `Checkpoint：发散/收敛/交接` 段和索引通知。
- 状态变化：无 Frontmatter 生命周期迁移；执行状态从“依赖会话残留”改为“从 checkpoint 指定的下一步恢复”。
- 关键原始输出：旧规则“`Phase 1 全程不再中断查 Vault，保持对话流畅性。`”；新规则“`上下文压缩后从最近 checkpoint 恢复，不重新开始。`”。
- 证据等级：独立新上下文的静态压力审阅；尚未执行真实压缩恢复，不能作为端到端通过结论。

## 场景二：用户 persona 注入

- 输入：研究主题 `Agent Memory` 完全命中 persona 核心领域，persona 自带 `Output Format`。
- 独立上下文标识：`/root/phase6_implementer/scenario_persona_injection`。
- 旧行为：规划与执行提示词均允许 persona 的 `Output Format` 完整替换默认章节，研究模板不再是唯一权威。
- 新行为：persona 仅影响分析重点、证据标准、术语和表达；任何适用模式下 Frontmatter、标题和章节均来自 `Research_Template.md`。
- 产物：包含 persona 路径、理由与适用模式的计划；由 `Research_Template.md` 渲染的研究报告。
- 状态变化：报告先为 `research / draft`，仅完整性校验通过后变为 `complete`；persona 不拥有状态变更权。
- 关键原始输出：旧规则“`用专家 Output Format 完整替换默认章节结构`”；新规则“`persona 不得替换、删除或重排模板结构`”。
- 证据等级：独立新上下文的静态压力审阅；`data-contract.test.ts` 自动检查四份双语 Research 提示词的模板权威约束，未执行真实研究。

## 场景三：并发相同 run_id

- 输入：同一 Digest 配置哈希与时间窗，以及 Archive 目标已存在同名文件；另假设两个不受信任执行者同时持有相同 `run_id`。
- 上下文标识：`/root/phase6_implementer/scenario_concurrent_runid`；受控串行 fixture 为 `phase6-concurrent-run-id-controlled-20260731 / protocol-adapter-fixture`。
- 旧行为：Digest 固定文件名却没有文件级身份或合并决定，可能覆盖或追加；Archive 碰撞由底层移动命令决定。
- 新行为：相同输入生成相同 `run_id` 和目标；串行重跑时 Digest 从 `create` 收敛到 `merge`，Archive 在任何移动前以 `skip / failed` 记录冲突，并给出同一 `run_id` 的恢复动作。对真正的未受信任并发，协议明确 `atomic_race_guarantee: false`：必须要求客户端原子、不跟随符号链接的文件能力；该能力不存在时失败关闭。
- 产物：Digest 来源台账和 Archive manifest。
- 状态变化：受控串行 Digest 两次均保持 `partial`；Archive 两次均保持 `failed`，没有移动源文件。真正并发不承诺“恰好一次创建”。
- 关键原始输出：`digest-0c30dd120e9d` 两次目标均为 `00_Drafts/AI-2026-07-25--2026-07-31.md`，decision 为 `create`、`merge`；`archive-9c3d805e8c73` 两次均为 `skip`，`errors: ["collision_preflight"]`，`recovery: ["resolve_collision_then_resume_same_run_id"]`。
- 证据等级：独立新上下文静态审阅加受控串行执行；适配器真实创建、读取和重复写入临时 Vault，但不执行真实客户端、网络、MCP 索引或两个并发写入者。因此该场景证明稳定身份、串行收敛和失败关闭边界，不把它表述为并发竞态验收。

## 场景四：Schema 升级

- 输入：旧资产缺少 `translation` 类型、模板实体 ID 固定、或生成 `draft / complete` 这类非法状态组合。
- 独立上下文标识：`/root/phase6_implementer/scenario_schema_upgrade`。
- 旧行为：类型、状态和模板映射分散在提示词与内嵌 Frontmatter，translation 与归档语义存在漂移。
- 新行为：`Frontmatter_Schema.md` 的 `frontmatter-contract-v1` 是唯一机器可读来源；`Execution_Manifest_Schema.json` 与 `PDF_Extraction_Schema.json` 分别约束执行清单和版本化逐页提取包。校验器解析模板和 YAML 片段，拒绝未知 type、固定 ID、无映射模板和非法生命周期状态。
- 产物：双语模板、Schema 契约块以及稳定排序的诊断。
- 状态变化：translation 从初始 `draft` 仅在完整性验证后进入 `complete`；归档写 `archived` 日期而不改写业务 status。
- 关键原始输出：错误夹具得到 `unknown_generated_type`、`invalid_template_id` 和 `invalid_lifecycle_transition`；真实 assets 输出 `技能契约校验通过`。
- 证据等级：独立新上下文静态审阅加校验器受控执行；未对历史 Vault 数据做就地迁移。

## 阶段一至五记录复查结论

- 阶段一 GREEN 已改标为静态契约复核；其唯一可执行证据为自动化测试。
- 阶段二 GREEN 已改标为静态契约；RED 独立上下文和自动化 RED 保持原证据等级。
- 阶段三路由压力场景保留输入和上下文标识，但明确不声称真实 Vault/MCP 端到端副作用。
- 阶段四记录包含真实 PyMuPDF 脚本输入、命令和 JSON 输出，维持“受控脚本执行”证据等级。
- 阶段五已区分静态规格审阅与受控 fixture 的可执行协议场景，维持该边界。
