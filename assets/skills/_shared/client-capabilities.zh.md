# 客户端语义能力契约

编排者只依赖本契约中的语义能力，先检测可用实现；专有客户端工具名只能出现在 `examples`。
不可用时执行同一任务的降级方案，并在交付中说明能力限制。

<!-- client-capabilities-v1 -->
```yaml
contract_version: 1
capabilities:
  spawn_agent:
    purpose: "在独立上下文执行受限子任务"
    examples: ["Task", "Codex subagent", "OpenCode agent"]
    client_specific_example_indexes: [0]
    fallback: "由编排者按同一输入和验收标准顺序执行"
  ask_user:
    purpose: "取得用户确认或处理不可消解歧义"
    examples: ["AskUserQuestion", "request_user_input", "interactive prompt"]
    client_specific_example_indexes: [0, 1]
    fallback: "停止在 pending 状态并明确请求确认"
  web_search:
    purpose: "发现外部来源"
    examples: ["WebSearch", "web search", "browser search"]
    client_specific_example_indexes: [0]
    fallback: "仅使用已提供或本地来源并记录限制"
  web_fetch:
    purpose: "读取已知外部来源"
    examples: ["WebFetch", "open URL", "browser reader"]
    client_specific_example_indexes: [0]
    fallback: "记录访问失败，不把不可访问来源作为关键结论"
  inspect_image:
    purpose: "检查图片中的内容或布局"
    examples: ["view_image", "image input", "vision"]
    client_specific_example_indexes: [0]
    fallback: "要求用户提供文字说明或跳过视觉结论"
  execute_command:
    purpose: "在受控环境运行命令或脚本"
    examples: ["exec_command", "shell", "terminal"]
    client_specific_example_indexes: [0]
    fallback: "说明无法执行，并保留可复制的命令"
  move_with_link_update:
    purpose: "移动笔记时保留或更新链接"
    examples: ["Obsidian CLI move", "rename with link update", "vault move"]
    client_specific_example_indexes: [0]
    fallback: "先更新引用，再移动并逐一回读验证"
```

Python 脚本必须经 `execute_command` 解析 Python 3：先用初始化阶段记录的解释器，再尝试
`python3`，在 Windows 最后尝试 `py -3`。只发现 Python 2 或无法解析时必须明确失败；正文不得写死
`python`。
