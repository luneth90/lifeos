---
name: example
dependencies:
  templates:
    - path: "{系统目录}/{模板子目录}/Missing_Template.md"
  agents:
    - path: references/agent.md
  capabilities: [execute_command, unlisted_capability]
---

调用输入 {{INPUT}}，写入 00_草稿/结果.md。

```yaml
type: draft
status: complete
```
