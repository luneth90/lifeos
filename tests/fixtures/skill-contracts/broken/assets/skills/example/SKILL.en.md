---
name: example
dependencies:
  templates:
    - path: "{system directory}/{template subdirectory}/Missing_Template.md"
  agents:
    - path: references/agent.md
  capabilities: [execute_command, unlisted_capability]
---

Caller input {{INPUT}} writes 00_草稿/result.md.

```yaml
type: draft
status: complete
```
