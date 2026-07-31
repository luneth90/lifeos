# 阶段一数据契约行为记录

> 阶段六证据校正：本记录的 GREEN 表格是模板、Schema 与技能提示词的静态契约复核，
> 不是一次真实 Vault 创建、归档或翻译执行的原始输出。下文“实际选择”均表示契约规定的
> 预期结果；可执行保护由 `data-contract.test.ts` 与阶段六校验器负责。

## RED：迁移前基线（基于 `60d0749`）

| 场景 | 实际选择的 `type / status / id / category` | 模板引用 | 观察结果 |
| --- | --- | --- | --- |
| 创建非学习项目 | 计划为 `plan / active / project_id / 无 category`；主项目为 `project / active / 稳定 ID / development`（规划意图） | `Project_Template.md` | 执行提示词硬编码 `category: learning`，因此开发项目无法保证保留选定 category。 |
| 归档 done 草稿 | `draft / archived / Draft_Template / 无 category` | 无；归档技能 `templates: []` | 归档将 `done` 改为 `archived`，与 Schema 的归档字段语义冲突。 |
| 生成翻译笔记 | `translation / done / 缺失 / 无 category` | 无；翻译技能 `templates: []` | Schema 与生命周期未定义 translation，输出由内嵌 Frontmatter 决定。 |

## GREEN：迁移后静态契约复核

| 场景 | 合同输入 | 契约规定的产物 | 可回查证据 |
| --- | --- | --- | --- |
| 创建非学习项目 | `{{PROJECT_INPUT}} = "开发一个命令行工具"` | 计划选择 `development`；主项目为 `project / active / 动态最终 project_id / development`，从 `Project_Template.md` 渲染。 | `Project_Template.md` 的 `category: "{{CATEGORY}}"` 和 `id: "{{ID}}"`；Project 规划/执行提示词要求直接使用确认后的最终路径与计划分类。 |
| 归档 done 草稿 | 已有 `type: draft, status: done, id: draft-idea` 的草稿 | 移动后保持 `draft / done / draft-idea / 无 category`，追加 `archived: "YYYY-MM-DD"`，不使用模板。 | `archive/SKILL.zh.md` 的移动后更新规则；`lifecycle.zh.md` 的草稿归档规则；`Draft_Template.md` 的动态 ID。 |
| 生成不完整翻译 | 请求页范围存在未完成页面 | 生成 `translation / draft / 动态 ID / 无 category`，从 `Translation_Template.md` 渲染；不会进入 `complete`。 | `Translation_Template.md` 的初始 `draft` 与完整性记录；`translate/SKILL.zh.md` 的完整性校验；`lifecycle.zh.md` 的 `draft → complete` 门槛。 |

新上下文静态复核确认：非学习项目必须保留计划 category，归档草稿必须保留 `done` 并只追加日期，不完整翻译必须保持 `draft`，三类实体均使用动态 ID。

## 自动验证

- RED：`npx vitest run tests/skill-contracts/data-contract.test.ts`，5 项失败，分别覆盖缺少契约块、固定 ID、缺少翻译模板、归档迁移与输入占位符不一致。
- GREEN：同一命令通过，5/5。
