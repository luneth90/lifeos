# 模板加载协议

本协议适用于所有需要读取 Vault 模板文件的技能。

## 加载规则

1. 在生成任何内容之前，**必须**使用文件读取能力读取 Vault 中的准确模板文件
2. **禁止猜测模板结构** — 即使你"记得"模板内容，也必须重新读取
3. 读取后记住以下关键元素：
   - Obsidian Callouts 格式（`> [!info]`、`> [!note]` 等）
   - frontmatter 字段结构和必填字段
   - 区块标记和分隔符

## AI 指令注释处理

若模板包含 HTML 注释形式的 AI 指令（`<!-- AI指令：... -->`）：

1. **必须执行**该指令，生成对应区块内容
2. **最终输出中绝对不能保留** `<!-- AI指令：... -->` 注释原文
3. 注释必须被替换为生成的内容

## 模板路由

| 场景 | 模板 |
| --- | --- |
| 每日日记 | `Daily_Template.md` |
| 草稿 | `Draft_Template.md` |
| 百科 | `Wiki_Template.md` |
| 项目文件 | `Project_Template.md` |
| 复习记录 | `Revise_Template.md` |
| 通用知识笔记 | `Knowledge_Template.md` |
| 深度研究报告 | `Research_Template.md` |
| 周期复盘 | `Retrospective_Template.md` |

## 模板路径解析

模板路径通过 `lifeos.yaml` 配置解析：
- 模板目录：`{系统目录}/{模板子目录}/`
- 具体模板文件名在各技能的 `dependencies.templates` 中声明
