# Layer0 Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 LifeOS 增加显式且幂等的 `memory_bootstrap`，让 Agent 能稳定拉取 `_layer0`，同时避免重复执行完整 startup。

**Architecture:** 在 `src/server.ts` 增加 `memory_bootstrap` 处理器，并在 server 会话状态中维护 `layer0Dirty`。现有 `memory_query`、`memory_log`、`memory_notify` 保持兼容；只有 `memory_bootstrap` 每次显式返回 `_layer0`，其他工具仍保留首次返回 `_layer0` 的旧行为。

**Tech Stack:** TypeScript、MCP Server、Vitest、Zod

---

### Task 1: 先用测试锁定 bootstrap 与幂等语义

**Files:**
- Modify: `tests/server.test.ts`

- [ ] **Step 1: 写出 `memory_bootstrap` 首次调用会触发 startup 的失败测试**

```ts
it('memory_bootstrap 首次调用会触发 startup 并返回 _layer0', async () => {
  const result = testing.callMemoryBootstrap({ vault_root: vault.root });
  expect(coreMock.memoryStartup).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({
    status: 'ok',
    startup_ran: true,
    layer0_refreshed: false,
    _layer0: 'Layer0',
  });
});
```

- [ ] **Step 2: 写出重复 bootstrap 不会重复 startup 的失败测试**

```ts
it('重复 bootstrap 只执行一次 startup', async () => {
  testing.callMemoryBootstrap({ vault_root: vault.root });
  const second = testing.callMemoryBootstrap({ vault_root: vault.root });
  expect(coreMock.memoryStartup).toHaveBeenCalledTimes(1);
  expect(second.startup_ran).toBe(false);
});
```

- [ ] **Step 3: 写出 dirty 刷新语义的失败测试**

```ts
it('memory_log 后再次 bootstrap 会轻量刷新 layer0', async () => {
  testing.callMemoryBootstrap({ vault_root: vault.root });
  testing.callTool('memory_log', {
    vault_root: vault.root,
    slot_key: 'content:language',
    content: '所有回复使用中文',
  });
  const refreshed = testing.callMemoryBootstrap({ vault_root: vault.root });
  expect(coreMock.memoryStartup).toHaveBeenCalledTimes(1);
  expect(refreshed.layer0_refreshed).toBe(true);
});
```

- [ ] **Step 4: 运行测试确认失败**

Run: `npm test -- tests/server.test.ts`
Expected: FAIL，报出 `callMemoryBootstrap` 或相关行为尚未实现

### Task 2: 在 server 会话层实现 bootstrap、缓存与 dirty 刷新

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: 增加 server 状态与 Layer0 刷新辅助函数**

```ts
let layer0Dirty = false;

function refreshLayer0Summary(params: Record<string, unknown>): boolean {
  const { vaultRoot } = captureStartupContext(params);
  const resolvedVault = vaultRoot || startupVaultRoot || process.env.LIFEOS_VAULT_ROOT;
  if (!startupResult || !resolvedVault) return false;
  startupResult = {
    ...startupResult,
    layer0_summary: buildLayer0Summary(resolvedVault),
  };
  layer0Dirty = false;
  return true;
}
```

- [ ] **Step 2: 让 `ensureStartup()` 在任何调用时都先捕获 `vault_root`**

```ts
function ensureStartup(params: Record<string, unknown>): void {
  const { vaultRoot } = captureStartupContext(params);
  if (startedUp) return;
  // existing startup logic...
}
```

- [ ] **Step 3: 新增 `memory_bootstrap` handler，并显式返回 `_layer0`**

```ts
function handleBootstrap<P extends Record<string, unknown>>(params: P) {
  const converted = normalizeParams(params);
  const wasFirstCall = !startedUp;
  ensureStartup(params);
  const layer0Refreshed = startedUp && layer0Dirty ? refreshLayer0Summary(converted) : false;
  return {
    status: 'ok',
    startup_ran: wasFirstCall && !!startupResult,
    layer0_refreshed: layer0Refreshed,
    _layer0: startupResult?.layer0_summary ?? '',
  };
}
```

- [ ] **Step 4: 让写操作把 Layer0 标记为 dirty**

```ts
if (options.markLayer0DirtyOnSuccess) {
  layer0Dirty = true;
}
```

并补上：

```ts
core.memoryNotify({ filePath: filename, vaultRoot });
layer0Dirty = true;
```

- [ ] **Step 5: 为首个写操作返回 `_layer0` 的场景补一次即时刷新**

```ts
if (wasFirstCall && layer0Dirty) {
  refreshLayer0Summary(converted);
}
```

- [ ] **Step 6: 注册 `memory_bootstrap` 工具，并扩展 `__testing`**

```ts
server.tool('memory_bootstrap', ...);

export const __testing = {
  ...,
  callMemoryBootstrap(params) { ... },
  callTool(name, params) { ... },
};
```

- [ ] **Step 7: 运行测试确认通过**

Run: `npm test -- tests/server.test.ts`
Expected: PASS

### Task 3: 更新协议文档，切换到显式 bootstrap 入口

**Files:**
- Modify: `assets/lifeos-rules.zh.md`
- Modify: `assets/lifeos-rules.en.md`
- Modify: `assets/skills/_shared/memory-protocol.zh.md`
- Modify: `assets/skills/_shared/memory-protocol.en.md`
- Modify: `assets/skills/ask/SKILL.zh.md`
- Modify: `assets/skills/ask/SKILL.en.md`

- [ ] **Step 1: 把 rules 文档改成“进入 Vault 会话先调 `memory_bootstrap`”**

```md
> **Layer 0 上下文：** 进入任何 LifeOS Vault 会话时，第一步必须调用 `memory_bootstrap` 获取 `_layer0`。其他工具的首次返回仍可能附带 `_layer0`，但那只是兼容行为，不应作为主路径依赖。
```

- [ ] **Step 2: 在 memory-protocol 中补充显式 bootstrap 约束**

```md
> 会话初始化（startup）由 MCP server 自动执行，但 Agent 在进入 Vault 会话时必须显式调用 `memory_bootstrap` 触发并读取 `_layer0`。
```

- [ ] **Step 3: 在 ask 技能开头补兜底规则**

```md
开始处理前，若本轮尚未取得 `_layer0`，先调用 `memory_bootstrap`，再进入步骤零。
```

- [ ] **Step 4: 运行测试与类型检查，确认代码和文档变更都稳定**

Run: `npm test -- tests/server.test.ts && npm run typecheck`
Expected: 全部通过

### Task 4: 全量验证与收尾

**Files:**
- Modify: `tests/server.test.ts`
- Modify: `src/server.ts`
- Modify: `assets/...`

- [ ] **Step 1: 跑与 startup/server 相关的测试**

Run: `npm test -- tests/server.test.ts tests/services/startup.test.ts`
Expected: PASS

- [ ] **Step 2: 运行 lint / typecheck 做最终校验**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 3: 人工检查关键差异**

Run: `git diff -- src/server.ts tests/server.test.ts assets/lifeos-rules.zh.md assets/skills/_shared/memory-protocol.zh.md assets/skills/ask/SKILL.zh.md`
Expected: diff 只包含 bootstrap、dirty 刷新与协议文案修改
