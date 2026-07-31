# 项目稳定 ID 契约

新项目必须调用 `scripts/project_identity.mjs`，传入 `{ title, filename, existing_ids }` 并校验返回值。
标题优先，标题不能生成 slug 时使用去扩展名的文件名；脚本只接受 ASCII 小写字母数字 slug，冲突时从
`-2` 递增。不得自行复制或扩展算法。已有项目继续使用其已校验的既有 ID。

Planning Agent 将 `project_id` 写入计划；Execution Agent 在落盘前重新扫描 `existing_ids`，若结果与
确认版本不同，必须先更新计划修订并使确认摘要失效，重新取得用户确认。
