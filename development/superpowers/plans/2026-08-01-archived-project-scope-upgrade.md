# 已归档项目 Scope 升级兼容实施计划

> **面向 Agent 执行者：** 必须使用 `superpowers:executing-plans` 在当前会话逐项执行；功能修复必须使用 `superpowers:test-driven-development`，完成与重建标签前必须使用 `superpowers:verification-before-completion`。所有步骤使用复选框跟踪。

**目标：** 修复 `lifeos upgrade` 错把 archived/expired project scope 当作当前项目依赖的问题，同时继续拒绝无法解析的 active project scope，并把修复纳入尚未推送的本地 `v2.2.0`。

**架构：** 保持当前项目 catalog、索引重建和回滚架构不变，只把终态断言的输入收窄为 active project scope。通过单元测试证明状态过滤，通过 V4 重跑升级集成测试证明历史记录原样保留，再完成 Changelog、全量发布验证和本地标签重建。

**技术栈：** TypeScript、SQLite、better-sqlite3、Vitest、npm 发布脚本、Git 注解标签。

## 全局约束

- 只有 `status = 'active'` 的 project scope 必须解析到当前项目 catalog。
- archived 与 expired project scope 必须原样保留，不进入当前项目索引闭包。
- active project scope 缺失或索引不一致时必须继续失败并回滚。
- 不扫描或索引系统归档目录，不删除任何历史记忆。
- 版本保持 `2.2.0`；本地标签尚未推送，完整验证后重建同名标签。
- 不执行 `git push`、`npm publish` 或 GitHub Release。
- 工作区现有 `package.json` 格式化改动属于用户，任何提交都不得暂存该文件。

---

### 任务一：以回归测试收窄升级终态校验

**文件：**

- 修改：`tests/cli/migrations/project-index-consistency.test.ts`
- 修改：`tests/cli/upgrade.test.ts`
- 修改：`src/cli/migrations/project-index-consistency.ts`

**接口：**

- 消费：`assertProjectMemoryScopesResolveToCatalog(db, vaultRoot, config, catalog): void`
- 产出：该函数只查询 active project scope；异常类型和错误文案保持不变。

- [x] **步骤 1：添加单元回归测试，覆盖 archived 与 expired 孤儿 scope**

在 `project scope 只能解析到当前 catalog 中仍存在的项目主文件` 用例之前添加：

```ts
it('只校验 active project scope，保留 archived 与 expired 历史记录', () => {
	writeTestNote(vault.root, '20_项目/Current.md', {
		type: 'project',
		id: 'current-project',
	});
	const catalog = [{ id: 'current-project', paths: ['20_项目/Current.md'] }];
	reindexAndAssertProjectCatalog(db, vault.root, config, catalog);
	const insert = db.prepare(`
		INSERT INTO memory_items(
			slot_key, content, item_kind, scope_type, scope_key, status,
			created_at, updated_at, expires_at, archived_at, archive_reason
		) VALUES (?, ?, 'decision', 'project', ?, ?, ?, ?, ?, ?, ?)
	`);
	insert.run(
		'decision:archived-project',
		'已归档项目决策',
		'archived-project',
		'archived',
		'2026-01-01T00:00:00.000Z',
		'2026-01-02T00:00:00.000Z',
		null,
		'2026-01-02T00:00:00.000Z',
		'项目已归档',
	);
	insert.run(
		'decision:expired-project',
		'已过期项目决策',
		'expired-project',
		'expired',
		'2026-01-01T00:00:00.000Z',
		'2026-01-03T00:00:00.000Z',
		'2026-01-02T00:00:00.000Z',
		null,
		null,
	);

	expect(() =>
		assertProjectMemoryScopesResolveToCatalog(db, vault.root, config, catalog),
	).not.toThrow();
	expect(
		db.prepare(`
			SELECT slot_key, scope_key, status, archived_at, archive_reason
			FROM memory_items ORDER BY slot_key
		`).all(),
	).toEqual([
		{
			slot_key: 'decision:archived-project',
			scope_key: 'archived-project',
			status: 'archived',
			archived_at: '2026-01-02T00:00:00.000Z',
			archive_reason: '项目已归档',
		},
		{
			slot_key: 'decision:expired-project',
			scope_key: 'expired-project',
			status: 'expired',
			archived_at: null,
			archive_reason: null,
		},
	]);
});
```

- [x] **步骤 2：添加 V4 重跑升级集成回归**

在 `V4 重跑失败后恢复原 Vault` 用例之前添加：

```ts
it('V4 重跑允许保留当前 catalog 外的 archived project scope', async () => {
	await upgrade([fixture.root, '--scope-map', fixture.mapPath]);
	const archiveDir = join(fixture.root, '90_系统', '归档', '项目', '2026');
	mkdirSync(archiveDir, { recursive: true });
	const archivedProjectPath = join(archiveDir, 'Archived.md');
	writeFileSync(
		archivedProjectPath,
		'---\ntitle: Archived\ntype: project\nid: archived-project\nstatus: archived\n---\n历史项目\n',
		'utf-8',
	);
	const staleDb = new Database(fixture.dbPath);
	try {
		staleDb.prepare(`
			INSERT INTO memory_items(
				slot_key, content, item_kind, scope_type, scope_key, status,
				created_at, updated_at, archived_at, archive_reason
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			'decision:archived-project',
			'保留历史决策',
			'decision',
			'project',
			'archived-project',
			'archived',
			'2026-01-01T00:00:00.000Z',
			'2026-01-02T00:00:00.000Z',
			'2026-01-02T00:00:00.000Z',
			'项目已归档',
		);
	} finally {
		staleDb.close();
	}

	await upgrade([fixture.root]);

	const upgradedDb = new Database(fixture.dbPath, { readonly: true, fileMustExist: true });
	try {
		expect(
			upgradedDb.prepare(`
				SELECT scope_key, status, archived_at, archive_reason
				FROM memory_items WHERE slot_key = ?
			`).get('decision:archived-project'),
		).toEqual({
			scope_key: 'archived-project',
			status: 'archived',
			archived_at: '2026-01-02T00:00:00.000Z',
			archive_reason: '项目已归档',
		});
		expect(
			upgradedDb.prepare("SELECT file_path FROM vault_index WHERE type = 'project'").all(),
		).toEqual([{ file_path: '20_项目/GTS.md' }]);
	} finally {
		upgradedDb.close();
	}
	expect(readFileSync(archivedProjectPath, 'utf-8')).toContain('id: archived-project');
	expect(validateRuntimeContract({ vaultRoot: fixture.root, runtimeVersion: VERSION }).ok).toBe(true);
});
```

- [x] **步骤 3：运行新增用例并确认红灯来自 archived/expired 被误校验**

运行：

```bash
npx vitest run tests/cli/migrations/project-index-consistency.test.ts \
  tests/cli/upgrade.test.ts \
  -t "只校验 active project scope|V4 重跑允许保留当前 catalog 外的 archived project scope"
```

预期：两个新增用例均失败，错误包含“当前项目 catalog 不存在”；不能出现 SQL 约束、测试夹具或文件路径错误。

- [x] **步骤 4：实现最小状态过滤**

将 `assertProjectMemoryScopesResolveToCatalog` 的查询改为：

```ts
const projectScopes = db
	.prepare(
		`SELECT slot_key, scope_key
		 FROM memory_items
		 WHERE scope_type = 'project' AND status = 'active'
		 ORDER BY slot_key, scope_key`,
	)
	.all() as Array<{ slot_key: string; scope_key: string }>;
```

同时把函数注释改为“严格保证每条 active project scope 都指向当前 catalog 中仍存在且已正确索引的主文件”。不得修改其他断言、catalog 生成或回滚逻辑。

- [x] **步骤 5：运行目标测试并确认绿灯**

运行：

```bash
npx vitest run tests/cli/migrations/project-index-consistency.test.ts tests/cli/upgrade.test.ts
```

预期：两个测试文件全部通过；现有 active 孤儿 scope 用例仍通过其失败断言。

- [x] **步骤 6：提交源码与回归测试**

```bash
git add src/cli/migrations/project-index-consistency.ts \
  tests/cli/migrations/project-index-consistency.test.ts \
  tests/cli/upgrade.test.ts
git commit -m "fix: 兼容已归档项目记忆升级"
```

提交前运行 `git diff --cached --check`，并确认 `package.json` 未暂存。

---

### 任务二：补充 2.2.0 发布说明

**文件：**

- 修改：`CHANGELOG.md`

**接口：**

- 消费：已通过的升级回归行为。
- 产出：`2.2.0` 发布说明明确 archived/expired 历史 project scope 不再阻断升级。

- [x] **步骤 1：在 2.2.0 的“修复”章节添加发布说明**

添加以下条目：

```markdown
- 修正升级终态校验误把 archived/expired project scope 当作当前项目依赖的问题；已归档项目的历史记忆保持不变，只有 active scope 必须解析到当前项目 catalog
```

- [x] **步骤 2：验证版本与发布说明可提取**

```bash
npm run release:check-version -- v2.2.0
node scripts/release/extract-changelog.mjs v2.2.0
git diff --check
```

预期：版本一致性通过，提取结果包含新增修复条目，工作区无空白错误。

- [x] **步骤 3：提交 Changelog**

```bash
git add CHANGELOG.md
git commit -m "docs: 补充归档项目升级兼容说明"
```

确认 `package.json` 仍未暂存。

---

### 任务三：完整验证并重建本地 v2.2.0 发布边界

**文件与引用：**

- 验证：整个仓库
- 生成：`lifeos-2.2.0.tgz`（已被 `.gitignore` 忽略）
- 更新：本地注解标签 `v2.2.0`

**接口：**

- 消费：任务一的修复提交、任务二的 Changelog 提交。
- 产出：指向最终验证提交的本地 `v2.2.0` 标签与测试包；远端保持不变。

- [x] **步骤 1：运行完整发布门禁**

```bash
npm run release:check-version -- v2.2.0
npm run release:verify
npm run release:pack
```

预期：版本一致性、类型检查、Lint、全量测试、构建和打包全部以状态码 0 结束，并输出 `lifeos-2.2.0.tgz`。

- [x] **步骤 2：核验提交边界与用户改动隔离**

```bash
git status --short --branch
git diff -- package.json
git diff --check
git log -3 --oneline --decorate
```

预期：只有 `package.json` 的用户格式化改动未提交；源码、测试、Changelog 和设计/计划均已提交。旧 `v2.2.0` 仍指向 `c2cbd0a`，当前 HEAD 位于其后。

- [x] **步骤 3：在验证通过后重建本地注解标签**

```bash
git tag -d v2.2.0
git tag -a v2.2.0 -m "LifeOS v2.2.0"
```

不得在发布门禁失败时执行本步骤。

- [x] **步骤 4：核验最终标签、测试包和远端未变**

```bash
git rev-parse HEAD
git rev-parse 'v2.2.0^{}'
git cat-file -t v2.2.0
git for-each-ref refs/tags/v2.2.0 \
  --format='%(refname:short) %(objecttype) %(objectname) %(subject)'
shasum -a 256 lifeos-2.2.0.tgz
git log -1 --oneline --decorate origin/main
git status --short --branch
```

预期：HEAD 与剥离后的标签提交一致，标签对象类型为 `tag`，远端仍停留在原提交，工作区仍只保留用户 `package.json` 修改。禁止执行任何 push 或 publish。
