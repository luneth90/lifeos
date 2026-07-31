# 第五阶段幂等性与归档行为基线

> 阶段六复查：本记录“可执行协议场景”部分是受控 fixture 的串行重跑证据，不能表述为两个
> 并发写入者的原子竞态验收。`operation-safety` 明确 `atomic_race_guarantee: false`；若出现
> 不受信任并发且客户端没有原子、不跟随符号链接的文件能力，正确结果是失败关闭并保留 manifest，
> 而不是承诺并发收敛。完整场景边界见
> `development/skill-tests/2026-07-31-phase-6-contract-scenarios.md`。

> agent context=baseline
>
> 观察日期：2026-07-31
>
> 范围：只读审阅现有 `today`、`digest`、`research`、`translate`、`revise`、`archive` 中文技能文件，以及 `digest`、`revise` 的相关参考资料。未读取或使用尚不存在的 operation-safety 文件。

## 输入

本基线按以下压力场景，判断现行指导要求的原始工具或操作选择，并记录重复产物、过早完成与不可恢复移动风险：

1. 同一日重复运行 `/today`。
2. 同一 Digest 配置及时间窗重复运行。
3. Digest 单个来源失败。
4. `/research`、`/translate` 在已有草稿或翻译时重跑。
5. 已有 `pending` 复习文件时重跑 `/revise`。
6. `/archive` 遇到文件名冲突，或 Obsidian CLI 不可用。

## 逐项观察

### 1. 同一日重复运行 `/today`

**原始工具／操作选择：** 先检查 `{日记目录}/YYYY-MM-DD.md`，若已有文件则读取并更新；任务和相关项目写入两个 AUTO 托管区块，写后调用 `memory_notify`。

**关键原始证据：**

- `today/SKILL.zh.md`：「若存在：读取并更新（保留已有内容）」。
- 「不要覆盖已有内容——若今日日记已存在，仔细更新，不要覆盖」。
- 「今日日记已存在：读取并合并优先级，不要重复」。
- 「只写入用户明确选中的项目、任务和数量上限内的候选」。

**结论：** 指南明确把当日文件视为可更新对象，并要求合并、不重复，设计意图是避免重复日记和重复待办。AUTO 区块也使重跑具备可替换的承载位置。

**残余风险：** 未规定托管区块的精确替换算法、已有相同任务的稳定标识或去重键；执行者若按“追加”理解更新，仍可能重复写任务或相关项目。用户在已有 AUTO 区块中手工编辑的内容也缺少冲突策略。没有“本轮输入、候选集与写入结果相同则无操作”的明确幂等判定。

### 2. 同一 Digest 配置及时间窗重复运行

**原始工具／操作选择：** Run 模式读取配置，执行 Python 抓取脚本、WebSearch、WebFetch，合并去重后直接写 `{草稿目录}/<TopicName>-MMDD-MMDD.md`，再调用 `memory_notify`。

**关键原始证据：**

- `digest/SKILL.zh.md`：「Phase 4: 写入周报 → `{草稿目录}/<TopicName>-MMDD-MMDD.md`」。
- `digest/references/run-pipeline.zh.md`：「`end_date` = 今天」「`date_range_str` = `MMDD-MMDD`（用于文件名）」。
- 同文件：「写入 `{草稿目录}/{topic_name}-{date_range_str}.md`」。
- 同文件的去重仅写为：「同一论文（标题相似度 > 80%）只保留最详细来源」。

**结论：** 同主题、同日、相同 `period_days` 会指向同一路径。现行管线会重新抓取并写入该固定文件名；它没有先检查输出是否存在，也没有“复用、版本化、比较后跳过”规定。

**风险：高。** 若写入为覆盖，旧周报的人工补充和此前抓取结果会丢失；若底层写入采用追加，则会产生同窗重复条目。Phase 3 的论文内容去重不等于文件级幂等，且不能覆盖 RSS／Web／摘要变化。完成提示会仍然宣称「周报已写入」，容易把覆盖或非确定性重跑误呈现为正常完成。

### 3. Digest 单个来源失败

**原始工具／操作选择：** 对 RSS 和论文来源使用 `rss-arxiv-script.py`；Web、HuggingFace、GitHub 走各自抓取任务；失败被记录并继续其余来源，最后有至少一个来源成功时写周报。

**关键原始证据：**

- `digest/SKILL.zh.md`：「不会因为单个来源失败就中断整个流程」。
- `digest/references/run-pipeline.zh.md`：「某个来源失败时，保留成功来源并把失败写入 `errors`」。
- 同文件错误表：「RSS feed 超时：标记失败，继续其他来源」；「论文来源 adapter 失败：记录结构化来源错误，继续执行其他来源」。
- 同文件仅在「所有来源均失败」时规定「不生成周报，报告失败原因」。

**结论：** 单源失败不应中止；原始选择是继续成功来源并落盘部分结果。论文来源的结构化错误契约最明确，其他模块至少要求继续。

**残余风险：** Phase 4 的报告模板没有要求把 `errors` 或部分失败状态写入周报 frontmatter／正文；完成提示仍为「全部周报已生成」或「周报已写入」。这会造成**过早完成**风险：用户难以从产物判断覆盖范围缺失。与场景 2 叠加时，失败重跑还可能以不完整数据覆盖较完整的既有周报。

### 4. `/research`、`/translate` 在已有草稿或翻译时重跑

#### Research

**原始工具／操作选择：** 由 Planning Agent 返回计划路径、修订号和确认哈希；用户确认后由 Execution Agent 写报告 artifacts，编排者验收通过后才更新来源及计划 `status: done`。

**关键原始证据：**

- `research/SKILL.zh.md`：「已有相关研究：更新现有报告，不新建重复文件」。
- 「用户要求补充/修改时：直接修改现有研究报告文件，不创建重复文件」。
- 「验收通过后才由编排者更新来源与计划 `status: done`」。
- 「部分来源失败时保留 manifest errors、报告 `status: draft`、来源草稿保持原状」。

**结论：** Research 明确避免报告重复，并以确认哈希和验收延后 `done`，是六项中最强的重跑与过早完成保护。

**残余风险：** “已有相关研究”的匹配规则、现有报告的合并粒度和执行重跑时的 artifact 覆盖规则没有定义。相同主题若未被识别为“相关”，仍可能出现新的计划或报告；并且只对“部分来源失败”显式保持 `draft`，未写明任何已有草稿的不可覆盖保护。

#### Translate

**原始工具／操作选择：** 先查看 `{资源目录}/{翻译子目录}/{书名}/` 是否已有章节翻译；若存在，提示用户是否覆盖。随后提取 PDF、按模板写固定章节路径，回读校验，覆盖不全时保持 `draft`，全页完整才置 `complete`。

**关键原始证据：**

- `translate/SKILL.zh.md`：「若已存在，提示用户：已有翻译文件 `[[路径]]`，是否覆盖？」
- 「初始状态保持 `draft`」。
- 「任何缺口都保持 `status: draft`；只有全部页 `complete` 时才更新为 `status: complete`」。
- 边界情况：「已有翻译文件｜提示用户是否覆盖」。

**结论：** Translate 在覆盖前取得用户选择，且完整性状态门槛能避免将不完整提取宣称为完成。

**残余风险：** 用户同意覆盖后没有备份、版本文件、原子替换或“新内容比旧内容覆盖范围更低时拒绝覆盖”的规则。一次部分提取的重跑即使保持 `draft`，仍可能覆盖既有完整翻译，因此仍有数据倒退风险。

### 5. 已有 `pending` 复习文件时重跑 `/revise`

**原始工具／操作选择：** 扫描章节目录下已有 `复习_*.md`；根据历史表现生成新题并创建 `复习_YYYY-MM-DD.md`。同一天重跑同一章节时改用带序号的文件名。批改仅在用户完成作答并触发“批改”等指令后执行。

**关键原始证据：**

- `revise/SKILL.zh.md`：「扫描章节目录下已有的复习文件（`复习_*.md`），获取历史复习表现」。
- 「在章节目录下创建复习文件：`复习_YYYY-MM-DD.md`」。
- 「用户中途放弃：复习文件保持 `status: pending`，下次可继续作答」。
- 「同一天重复复习同一章节：复习文件命名加序号：`复习_YYYY-MM-DD_2.md`」。
- `revise/references/grading-protocol.zh.md`：「用户完成作答后触发」批改；批改后才将复习文件更新为 `status: graded`。

**结论：** 现行指南保护文件名不冲突，并保留 pending 文件；不会因为仅重跑就把 pending 文件标为 graded 或推动知识笔记状态，因此没有直接的过早完成问题。

**风险：中高。** “下次可继续作答”没有转换为入口的硬性恢复步骤；阶段 0 只要求扫描历史表现，阶段 1 仍会询问范围和模式，阶段 2 会创建新文件。故已有 pending 时重跑很可能生成 `_2` 文件，形成多份未作答复习与用户进度分叉。文件名序号避免冲突，却没有避免重复产物，也没有明确优先恢复 pending 的规则。

### 6. `/archive` 的文件名冲突与 CLI 不可用

**原始工具／操作选择：** 扫描完成即自动执行所有候选；先算目标并建父目录，优先 `obsidian move`，不可用时回退系统 `mv`；移动后更新 frontmatter 并通知索引。单条失败继续其他条目。

**关键原始证据：**

- `archive/SKILL.zh.md`：「扫描完成后默认一次性归档全部合规候选，不展示选择菜单、不等待用户确认」。
- 「每次操作前先确保目标父目录已存在（`mkdir -p`）」。
- 「若 `obsidian` CLI 不可用……回退到系统 `mv`」。
- 「回退后需在完成报告中标注……wikilink 可能未更新」。
- 「文件移动失败：停止当前条目归档……继续处理其余条目」。
- 「永不删除——只移动，不销毁内容」。

**结论：** CLI 不可用时的既定原始选择是系统 `mv`，并以事后报告提示 wikilink 风险。文件名冲突则没有专门规则：只建父目录，随后直接调用 move/mv；实际行为委托给底层命令。

**风险：高。** 自动批量归档且不等待确认，会在冲突发现前启动移动。`mv` 遇到目标同名时的行为没有由技能限定为“拒绝、不覆盖”；不同平台或参数处理可能失败，也可能覆盖，存在不可恢复的数据丢失风险。即便未覆盖，已完成的一部分移动也没有事务、预演、撤销清单或回滚策略。CLI 回退还会留下未更新 wikilink；报告是事后告警，不能恢复链接或防止损失。frontmatter 更新安排在移动后，也会使“移动成功、后写失败”产生半完成状态。

## 总体结论

现行指导已有几处良好基线：`today` 要求读取合并，`research` 要求更新既有报告且通过验收才置 `done`，`translate` 要求覆盖前询问并以完整性决定状态，`revise` 保留 pending 文件，Digest 对单源失败继续执行。

但操作级幂等性尚不完整。最突出的问题是：

1. Digest 使用时间窗作为唯一输出文件名，却没有存在检查、内容比较、版本化或防覆盖规则；部分失败还能覆盖完整旧产物并被报告为成功。
2. Revise 把同日重跑导向序号文件，保留 pending 却未优先恢复它，容易产生重复未完成文件。
3. Archive 在无确认的自动批量移动中没有目标冲突策略，CLI 不可用时直接降级为 `mv`，缺少不可覆盖约束、预演和回滚，风险最高。
4. Translate 的“询问是否覆盖”保护用户意图，但确认后的覆盖仍缺少备份与覆盖范围防倒退规则。

因此，后续加固应把“识别既有目标—比较或恢复—明确冲突决策—原子／可回滚执行—准确报告部分状态”写成可执行契约，不能仅靠完成后的提示语。

---

# 第五阶段静态规格审阅（非 GREEN 行为证据）

> context=static-spec-review
>
> 观察日期：2026-07-31
>
> 范围：只读审阅 `_shared/operation-safety.zh.md`、`today`、`digest`、`research`、`translate`、`revise`、`archive` 的中文技能文件，以及 `digest` 的 `run-pipeline`、`config-parser` 与 `revise` 的 `grading-protocol`。本节不执行实际文件移动、抓取或覆盖，因此只说明规格意图，不作为 GREEN 行为证据。

## 共同输入与判断基准

输入为同一规范化请求的第二次运行；其中时间窗、模式、已确认计划及源文件内容保持不变。归档额外输入包括：目标目录已有同名文件，或链接更新能力不可用。

共同安全规则要求预检解析安全路径、检查目标冲突、读取既有 `run_id` 和状态；冲突须先写入 manifest。稳定身份要求同一规范化输入和时间窗／模式得到同一 `run_id`、同一目标路径，除非用户明确提出 `replace`，否则只能选择 `merge`、`resume` 或 `skip`。写入仅限 `BEGIN AUTO`／`END AUTO` 托管区块；真实变更后才通知索引；失败须保留 manifest 并以相同 `run_id` 恢复。移动链接更新能力不可用时，必须先取得用户对明确降级方案的同意，禁止静默裸移动。

## 逐项绿色复测

### 1. Today 同日重复运行

**输入：** 同一日期、同一批已选择项目与任务，第二次运行 `/today`。

**关键原始规则／工具选择：** `today` 固定以日期和已选项生成 `run_id`，目标为当日日记；既有文件选择 `merge`。任务与相关项目分别受 AUTO 托管区块约束，每条自动任务使用来自规范化来源对象和动作的稳定 `task_id`，按该标识更新；真实写入后才调用 `memory_notify`。

**前后变化：** 基线只有“读取并合并、不重复”的意图，缺少可执行去重键，追加式实现仍可能复制任务。绿色契约已将稳定运行身份、托管区块边界及 `task_id` 更新规则明确化。

**结论：** 可收敛。相同输入复用同一日记和 `run_id`，重复运行更新既有自动条目，不新增重复任务或相关项目；用户手写区也受托管区块边界保护。

### 2. Digest 相同配置与时间窗重复运行

**输入：** 同一 Digest 配置哈希、同一时间窗，第二次运行 `/digest`。

**关键原始规则／工具选择：** `digest` 使用 `stable(digest, config-hash, time-window)` 生成 `run_id`，目标为同一周报路径；相同身份只允许 `merge` 同一周报及来源台账。每个来源台账保留 `published_at`、`fetched_at`、`health`、`errors`；`run-pipeline` 和 `config-parser` 同时要求保存规范化配置、时间窗与逐来源运行字段。

**前后变化：** 基线仅有固定文件名与内容去重，无法阻止覆盖或追加。绿色规则先识别既有目标和身份，再合并来源台账，通用协议限制更新到托管区块，且未获明确授权不得 `replace`。

**结论：** 可收敛。重复运行不会产生第二份同窗周报，也不应把人工内容或来源列表整体覆盖；抓取结果变化时仅合并受托管区域和台账。

### 3. Digest 单一来源失败

**输入：** 同一 Digest 运行中，某一 RSS 或论文来源失败，至少一项其他来源健康。

**关键原始规则／工具选择：** `rss-arxiv-script.py` 对每个论文来源独立 adapter 返回结构化错误；`run-pipeline` 要求保留成功来源并将失败写入 `errors`。Digest 契约要求台账记录 `health` 与 `errors`，允许单一来源失败时保留健康来源；只有未知模块、缺失必填配置或全部来源失败才返回非完成状态，且不得把草稿标为完成。

**前后变化：** 基线能继续执行，却未强制将失败状态写进产物，且不完整重跑可能覆盖旧周报。绿色规则把来源健康度与错误纳入同一稳定目标的台账，并以共同托管和 `merge` 规则避免裸覆盖。

**结论：** 可收敛。单源失败产出的是带结构化失败记录的部分结果，健康来源仍被保留；全部失败或配置错误不能被报告为完成，也不会把草稿错误标为完成。

### 4. Research 重复运行

**输入：** 规范化研究输入、已确认计划 hash 与计划 revision 相同，第二次运行 `/research`。

**关键原始规则／工具选择：** `research` 用上述三项生成稳定 `run_id`，已有同 `run_id` 的草稿或 manifest 选择 `resume`，保留已验证 artifacts 和错误；仅用户明确要求时允许 `replace`。每次决策与目标路径写入 manifest，真实修改后才 `memory_notify`；部分来源失败继续保持报告 `draft`。

**前后变化：** 基线虽然要求更新既有报告，却没有以身份识别和 manifest 恢复限定执行边界。绿色规则将同一请求锁定到已有草稿／manifest，并保留可验证中间结果和错误。

**结论：** 可收敛。重复运行进入 `resume` 而非创建重复研究报告；失败后的重试利用原有 manifest，且没有明确 `replace` 授权时不得覆盖已完成报告。

### 5. Translate 重复运行

**输入：** 同一源 PDF、章节范围、提取 hash 的第二次 `/translate`。

**关键原始规则／工具选择：** `translate` 使用 `stable(translate, source-pdf, chapter-range, extraction-hash)`；同 `run_id` 的 `draft` 必须 `resume`，保留已翻页内容、OCR 错误和完整性记录。只有用户明确 `replace` 才覆盖已完成翻译；每次写入通知索引，部分失败保持 `draft`。

**前后变化：** 基线要求询问是否覆盖，用户同意后仍可能以不完整翻译倒退覆盖完整成果。绿色契约区分未完成草稿的恢复与已完成翻译的替换授权，并保留页级恢复证据。

**结论：** 可收敛。相同未完成翻译会恢复，不再覆盖或新建；已完成翻译无明确 `replace` 不能被重跑覆盖，部分提取继续保持 `draft`。

### 6. Revise 已有 pending 记录时重复运行

**输入：** 同一知识笔记、同一模式，存在 `status: pending` 的复习记录后再次 `/revise`。

**关键原始规则／工具选择：** `revise` 优先命中同一笔记和 mode 的 pending 记录并选择 `resume`，不新建题目；`run_id` 稳定包含知识笔记标识、模式与笔记 hash。题目带 `knowledge_point_id`、`source_refs`、隐藏评分标准；批改前检查笔记 hash，变化时重新出题。盲点扫描不得推进知识状态，评分和状态推进由独立记录维护。

**前后变化：** 基线以同日序号避免命名冲突，却会留下多份 pending 文件。绿色规则将 pending 记录变成入口的优先恢复目标，不再将序号当作默认重跑路径。

**结论：** 可收敛。第二次运行恢复同一份待作答记录，题目与用户进度不会分叉；只有笔记内容变化时才按规则重新出题，且盲点自评不会过早推进知识状态。

### 7. Archive 文件名冲突

**输入：** 待归档候选的解析目标路径已存在同名文件。

**关键原始规则／工具选择：** `archive` 在任何移动前完成 preflight：枚举所有候选、解析安全源／目标路径、检查 collision，并把碰撞写入逐文件 move manifest（含 `moves`、`collisions`、`notified`、`errors`）。通用协议规定预检发现冲突后不得在移动后才发现；未获用户明确 `replace` 授权时只能 `merge`、`resume` 或 `skip`。

**前后变化：** 基线未定义冲突策略，自动批处理可能把控制权交给底层 `mv`。绿色规则将冲突前移为 manifest 决策，并禁止默认替换。

**结论：** 可收敛且防止覆盖风险。冲突候选在移动前被记录并跳过、恢复或合并；没有用户明确 `replace` 时不能覆盖目标文件。其他无冲突候选仍可按逐文件 manifest 继续处理，失败保留恢复动作。

### 8. Archive 链接更新能力不可用

**输入：** `move_with_link_update` 或等价的 Obsidian 链接更新能力不可用。

**关键原始规则／工具选择：** `archive` 优先使用链接更新移动能力；能力不可用时停止并说明影响，仅在用户明确接受已记录的降级方案后才允许继续，严禁静默裸移动。每项移动后立即通知索引；只有新路径索引确认后才清理旧项目作用域记忆；失败保留 manifest 和可执行恢复动作，以同一 `run_id` 进入 `resume`。

**前后变化：** 基线曾允许不可用时直接降级为系统移动，再事后报告链接可能失效。绿色规则把用户同意置于任何降级移动之前，并把索引确认和记忆清理排序固定下来。

**结论：** 可收敛且防止未更新链接风险。未获得明确降级同意时不移动任何文件；获得同意后，移动过程仍有 manifest、通知、索引确认和恢复路径，不能伪称已完成。

## 总体结论

静态阅读显示，新规格意图是把六类重复运行收敛为稳定 `run_id` 下的 `merge` 或 `resume`，把覆盖限定为用户明确 `replace`，并用托管区块、来源／步骤 manifest 和索引通知保护用户内容。是否实际收敛由下方受控 fixture 的可执行协议场景验证；本节本身不作行为通过结论。

---

# 第五阶段可执行协议场景证据

> context=protocol-adapter-fixture
>
> 边界：此适配器实际创建、读取和重复写入受控 fixture Vault，验证技能操作协议及路径 guard；不执行真实客户端 Agent、网络抓取或 MCP 索引，因此不等同于端到端客户端验收。

## 可复现命令

```text
node tests/assets/helpers/operation-scenarios.mjs
npx vitest run tests/assets/operation-scenarios.test.ts
```

上下文标识、输入、两次运行的 `run_id`、目标、decision、状态、manifest 和最终文件树均由首条命令输出；第二条命令对这些真实文件副作用做自动断言。

## 输入

- Today：日期 `2026-07-31`，选择 `project-demo`。
- Digest：配置 hash `cfg-ai-v1`，时间窗 `2026-07-25--2026-07-31`，一条健康 RSS 与一条超时论文来源。
- Research：主题 `agent-memory`、revision `1`、确认 hash `plan-001`。
- Translate：`book.pdf` 第 1 章、提取 hash `extract-001`。
- Revise：笔记 `book-chapter-1`、模式 `quiz`、笔记 hash `note-001`。
- Archive：源 `20_Projects/Demo.md`，目标 `90_System/Archive/Projects/2026/Demo.md` 已预置同名文件。

## 关键原始 JSON 输出

```json
{
  "context": "protocol-adapter-fixture",
  "boundary": "验证技能操作协议，不执行真实客户端或网络抓取",
  "runs": {
    "today": [
      {"run_id":"today-921dbf4746f7","target_path":"10_Diary/2026-07-31.md","decision":"create","status":"active"},
      {"run_id":"today-921dbf4746f7","target_path":"10_Diary/2026-07-31.md","decision":"merge","status":"active"}
    ],
    "digest": [
      {"run_id":"digest-0c30dd120e9d","target_path":"00_Drafts/AI-2026-07-25--2026-07-31.md","decision":"create","status":"partial"},
      {"run_id":"digest-0c30dd120e9d","target_path":"00_Drafts/AI-2026-07-25--2026-07-31.md","decision":"merge","status":"partial"}
    ],
    "research": [
      {"run_id":"research-7abd9b4ffe9e","target_path":"30_Research/agent-memory.md","decision":"create","status":"draft"},
      {"run_id":"research-7abd9b4ffe9e","target_path":"30_Research/agent-memory.md","decision":"resume","status":"draft"}
    ],
    "translate": [
      {"run_id":"translate-5b4d2d7a0566","target_path":"70_Resources/Translations/Book/Chapter-1.md","decision":"create","status":"draft"},
      {"run_id":"translate-5b4d2d7a0566","target_path":"70_Resources/Translations/Book/Chapter-1.md","decision":"resume","status":"draft"}
    ],
    "revise": [
      {"run_id":"revise-1b7838db2dda","target_path":"40_Knowledge/Notes/Book/Chapter-1/revise.md","decision":"create","status":"pending"},
      {"run_id":"revise-1b7838db2dda","target_path":"40_Knowledge/Notes/Book/Chapter-1/revise.md","decision":"resume","status":"pending"}
    ],
    "archive": [
      {"run_id":"archive-9c3d805e8c73","target_path":"90_System/Archive/Projects/2026/Demo.md","decision":"skip","status":"failed"},
      {"run_id":"archive-9c3d805e8c73","target_path":"90_System/Archive/Projects/2026/Demo.md","decision":"skip","status":"failed"}
    ]
  },
  "digest_sources": [
    {"id":"rss-main","published_at":"2026-07-30","fetched_at":"2026-07-31T08:00:00Z","health":"healthy","errors":[]},
    {"id":"paper-backup","published_at":null,"fetched_at":"2026-07-31T08:00:00Z","health":"failed","errors":["source_timeout"]}
  ],
  "archive_manifest": {
    "run_id":"archive-9c3d805e8c73",
    "moves":[],
    "collisions":[{"source":"20_Projects/Demo.md","target":"90_System/Archive/Projects/2026/Demo.md"}],
    "notified":[],
    "errors":["collision_preflight"],
    "recovery":["resolve_collision_then_resume_same_run_id"]
  },
  "file_tree": [
    "00_Drafts/AI-2026-07-25--2026-07-31.md",
    "10_Diary/2026-07-31.md",
    "20_Projects/Demo.md",
    "30_Research/agent-memory.md",
    "40_Knowledge/Notes/Book/Chapter-1/revise.md",
    "70_Resources/Translations/Book/Chapter-1.md",
    "90_System/Archive/Projects/2026/Demo.md"
  ]
}
```

## 执行结论

- 六个适配场景均实际运行两次；每组两次 `run_id` 与目标一致，第二次按契约进入 `merge`、`resume` 或冲突 `skip`。
- Digest 的失败来源保留完整台账，两个尝试都保持 `partial`，没有提前写成完成。
- Archive 在 preflight 发现 collision，两个尝试的 `moves` 始终为空；源与既有目标均原样保留，并输出同一 `run_id` 的恢复动作。
- 每次 fixture 写入均在实际系统调用前后执行路径 guard 复核；自动测试另行覆盖父目录被替换为 Vault 外符号链接和同路径新 inode 时的失败行为。
