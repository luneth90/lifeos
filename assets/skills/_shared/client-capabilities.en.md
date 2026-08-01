# Client Semantic Capability Contract

An Orchestrator depends only on the semantic capabilities in this contract and detects an available implementation first. Client-specific tool names may appear only in `examples`. When unavailable, use the equivalent fallback and disclose the limitation in the delivery.

<!-- client-capabilities-v1 -->
```yaml
contract_version: 1
capabilities:
  spawn_agent:
    purpose: "Run a bounded subtask in an independent context"
    examples: ["Task", "Codex subagent", "OpenCode agent"]
    client_specific_example_indexes: [0]
    fallback: "The Orchestrator performs it sequentially with the same input and acceptance criteria"
  ask_user:
    purpose: "Obtain user confirmation or resolve an ambiguity"
    examples: ["AskUserQuestion", "request_user_input", "interactive prompt"]
    client_specific_example_indexes: [0, 1]
    fallback: "Stop in pending state and explicitly request confirmation"
  web_search:
    purpose: "Discover external sources"
    examples: ["WebSearch", "web search", "browser search"]
    client_specific_example_indexes: [0]
    fallback: "Use only supplied or local sources and record the limitation"
  web_fetch:
    purpose: "Read a known external source"
    examples: ["WebFetch", "open URL", "browser reader"]
    client_specific_example_indexes: [0]
    fallback: "Record the access failure and do not use an inaccessible source for a key conclusion"
  inspect_image:
    purpose: "Inspect image content or layout"
    examples: ["view_image", "image input", "vision"]
    client_specific_example_indexes: [0]
    fallback: "Ask for a textual description or omit visual conclusions"
  execute_command:
    purpose: "Run a command or script in a controlled environment"
    examples: ["exec_command", "shell", "terminal"]
    client_specific_example_indexes: [0]
    fallback: "Explain that execution is unavailable and retain a copyable command"
  move_with_link_update:
    purpose: "Move a note while preserving or updating links"
    examples: ["Obsidian CLI move", "rename with link update", "vault move"]
    client_specific_example_indexes: [0]
    fallback: "Update references first, then move and reread every affected note"
```

Python scripts must resolve Python 3 through `execute_command`: use the interpreter recorded during initialization first, then try `python3`, and on Windows finally try `py -3`. Explicitly fail when only Python 2 exists or no interpreter resolves; skill text must not hard-code `python`.
