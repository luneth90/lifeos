# 阶段一数据契约行为记录

## RED：迁移前基线（基于 `60d0749`）

| 场景 | 实际选择的 `type / status / id / category` | 模板引用 | 观察结果 |
| --- | --- | --- | --- |
| 创建非学习项目 | 计划为 `plan / active / project_id / 无 category`；主项目为 `project / active / 稳定 ID / development`（规划意图） | `Project_Template.md` | 执行提示词硬编码 `category: learning`，因此开发项目无法保证保留选定 category。 |
| 归档 done 草稿 | `draft / archived / Draft_Template / 无 category` | 无；归档技能 `templates: []` | 归档将 `done` 改为 `archived`，与 Schema 的归档字段语义冲突。 |
| 生成翻译笔记 | `translation / done / 缺失 / 无 category` | 无；翻译技能 `templates: []` | Schema 与生命周期未定义 translation，输出由内嵌 Frontmatter 决定。 |

## GREEN：迁移后行为复核

| 场景 | 预期选择的 `type / status / id / category` | 模板引用 | 验收 |
| --- | --- | --- |
| 创建非学习项目 | `project / active / 动态 ID / 选定 category` | `Project_Template.md` | 主技能、规划提示词与执行提示词均使用 `{{PROJECT_INPUT}}`；执行提示词要求直接使用计划中的最终路径并替换分类占位符。 |
| 归档 done 草稿 | `draft / done / 原动态 ID / 无 category`，追加 `archived: "YYYY-MM-DD"` | 无 | 生命周期和归档技能均保留业务终态，测试禁止 `status: archived`。 |
| 生成翻译笔记 | `translation / draft → complete / 动态 ID / 无 category` | `Translation_Template.md` | 只有覆盖请求范围、替换全部必填占位符并完成通知后，才允许进入 `complete`。 |

新上下文复核已逐项确认上述三项结果：非学习项目保留计划 category，归档草稿保留 `done` 并只追加日期，不完整翻译保持 `draft`，三类实体均使用动态 ID。

## 自动验证

- RED：`npx vitest run tests/skill-contracts/data-contract.test.ts`，5 项失败，分别覆盖缺少契约块、固定 ID、缺少翻译模板、归档迁移与输入占位符不一致。
- GREEN：同一命令通过，5/5。
