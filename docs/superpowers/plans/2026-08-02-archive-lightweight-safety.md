# Archive 轻量安全修补实现计划

> **供执行代理使用：** 必须使用 `executing-plans` 技能按任务执行；每个步骤用复选框跟踪。

**目标：** 让 Archive 拒绝归档开始前已存在的目标软链接或特殊节点，并将目标子目录创建失败转成结构化报告且不阻断后续候选项。

**架构：** 将现有源目录扫描函数改为通用目录树扫描，在候选预检阶段对所有已存在的目录目标统一调用。移动目录时在现有逐文件循环内局部捕获 `mkdirSync` 错误，不增加新抽象、事务或竞态防护。

**技术栈：** TypeScript、Node.js 同步文件系统 API、Vitest。

## 全局约束

- 直接修改并提交到 `main`，不创建分支或 worktree。
- 只处理归档开始前已存在的目标节点，不处理 TOCTOU 或进程竞态。
- 不增加目录句柄、事务回滚、权限极端边界或随机碰撞测试。
- 测试使用普通文件和符号链接构造确定性失败，不依赖平台权限差异。

---

### 任务 1：拒绝既有目标根软链接和目标树软链接

**文件：**

- 修改：`src/services/archive.ts:378-399,576-790`
- 测试：`tests/services/archive.test.ts:1329-1460`

**接口：**

- 使用：`lstatSync(path)` 与现有目录树扫描结果。
- 产出：`scanDirectoryTree(directory, base): DirectoryScanResult`；目标软链接冲突原因 `target_contains_symlink`。

- [x] **步骤 1：编写失败测试**

在 `tests/services/archive.test.ts` 增加两个测试：

```ts
it('源已不存在且目标根为符号链接时拒绝，不读取或写入外部目录', () => {
	const { root, cleanup } = makeTmp();
	const outside = mkdtempSync(join(tmpdir(), 'lifeos-outside-'));
	try {
		write(outside, 'P.md', `---\ntype: project\nstatus: done\nid: p\n---\n`);
		mkdirSync(join(root, '90_系统/归档/项目/2026'), { recursive: true });
		symlinkSync(outside, join(root, '90_系统/归档/项目/2026/P'));
		const report = runArchive({
			vaultRoot: root,
			archiveDate: '2026-08-02',
			candidates: [{
				type: 'project', source: '20_项目/P', target: '90_系统/归档/项目/2026/P',
				main_file: '20_项目/P/P.md', project_id: 'p',
			}],
			moveRunner: fakeMove(root),
		});
		expect(report.conflicts).toEqual([{
			path: '90_系统/归档/项目/2026/P', reason: 'target_contains_symlink',
		}]);
		expect(report.updated).toEqual([]);
	} finally {
		cleanup();
		rmSync(outside, { recursive: true, force: true });
	}
});

it('部分目标树含符号链接时拒绝，不向外部目录移动文件', () => {
	const { root, cleanup } = makeTmp();
	const outside = mkdtempSync(join(tmpdir(), 'lifeos-outside-'));
	try {
		write(root, '20_项目/P/assets/x.md', '# x');
		write(root, '90_系统/归档/项目/2026/P/P.md', `---\ntype: project\nstatus: done\nid: p\n---\n`);
		symlinkSync(outside, join(root, '90_系统/归档/项目/2026/P/assets'));
		const report = runArchive({
			vaultRoot: root,
			archiveDate: '2026-08-02',
			candidates: [{
				type: 'project', source: '20_项目/P', target: '90_系统/归档/项目/2026/P',
				main_file: '20_项目/P/P.md', project_id: 'p',
			}],
			moveRunner: fakeMove(root),
		});
		expect(report.conflicts).toEqual([{
			path: '90_系统/归档/项目/2026/P/assets', reason: 'target_contains_symlink',
		}]);
		expect(readdirSync(outside)).toEqual([]);
	} finally {
		cleanup();
		rmSync(outside, { recursive: true, force: true });
	}
});
```

- [x] **步骤 2：运行测试并确认失败**

运行：

```bash
npx vitest run tests/services/archive.test.ts -t '目标根为符号链接|部分目标树含符号链接'
```

预期：两个测试至少一个失败；当前代码会把目标根当作已完成，或忽略目标树内的符号链接。

- [x] **步骤 3：实现最小修补**

在 `src/services/archive.ts`：

1. 将 `SourceScanResult`、`scanSourceTree` 分别改名为 `DirectoryScanResult`、`scanDirectoryTree`，递归调用同步改名。
2. 在读取 `sourceStat` 后、进入 `!sourceStat` 分支前，统一预检已存在的目录型目标；源仍存在时以 `sourceStat` 判断，源已不存在时仅项目按目录处理，避免改变草稿、计划和日记目标文件的既有语义：

```ts
const targetExists = existsSync(targetAbs);
const targetIsDirectoryCandidate = sourceStat?.isDirectory() ?? candidate.type === 'project';
if (targetExists && targetIsDirectoryCandidate) {
	let targetStat: ReturnType<typeof lstatSync>;
	try {
		targetStat = lstatSync(targetAbs);
	} catch (error) {
		report.conflicts.push({
			path: candidate.target,
			reason: `target_scan_failed:${(error as Error).message}`,
		});
		continue;
	}
	if (targetStat.isSymbolicLink()) {
		report.conflicts.push({ path: candidate.target, reason: 'target_contains_symlink' });
		continue;
	}
	if (!targetStat.isDirectory() && !targetStat.isFile()) {
		report.conflicts.push({ path: candidate.target, reason: 'target_collision' });
		continue;
	}
	if (targetStat.isDirectory()) {
		const scan = scanDirectoryTree(targetAbs);
		if (scan.status === 'error') {
			report.conflicts.push({
				path: candidate.target,
				reason: `target_scan_failed:${scan.error}`,
			});
			continue;
		}
		if (scan.status === 'unsupported') {
			const entryPath = `${candidate.target}/${scan.entry}`;
			const targetMain = candidate.main_file
				? relocatedPath(candidate.source, candidate.target, candidate.main_file)
				: null;
			report.conflicts.push({
				path: entryPath,
				reason: entryPath === targetMain ? 'target_is_symlink' : 'target_contains_symlink',
			});
			continue;
		}
	}
}
```

3. 删除后方重复声明的 `const targetExists`，源树调用改成 `scanDirectoryTree(sourceAbs)`；保留已有 `source_contains_symlink` 和 `target_scan_failed` 兼容语义。

- [x] **步骤 4：运行定向测试并确认通过**

运行：

```bash
npx vitest run tests/services/archive.test.ts -t '目标根为符号链接|部分目标树含符号链接|目标目录含不可读子目录'
```

预期：相关测试全部通过。

- [x] **步骤 5：提交任务 1**

```bash
git add src/services/archive.ts tests/services/archive.test.ts
git commit -m "fix: 归档拒绝既有目标树符号链接"
```

### 任务 2：结构化上报嵌套目标目录创建失败

**文件：**

- 修改：`src/services/archive.ts:416-467`
- 测试：`tests/services/archive.test.ts:1461-1500`

**接口：**

- 使用：现有 `ArchiveReport.failed` 与 `moveDirectory` 布尔返回值。
- 产出：失败原因 `target_dir_create_failed:<错误信息>`；后续候选项仍由现有外层循环执行。

- [x] **步骤 1：编写失败测试**

在 `tests/services/archive.test.ts` 增加：

```ts
it('目录候选创建嵌套目标目录失败时上报，并继续处理后续候选项', () => {
	const { root, cleanup } = makeTmp();
	try {
		write(root, '20_项目/P/assets/sub/x.md', '# x');
		write(root, '90_系统/归档/项目/2026/P/P.md',
			`---\ntype: project\nstatus: done\nid: p\narchived: "2026-08-02"\n---\n`);
		write(root, '90_系统/归档/项目/2026/P/assets', '阻塞目录创建');
		write(root, '00_草稿/ok.md', draftNote('ok'));
		let report: ArchiveReport;
		expect(() => {
			report = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [
					{
						type: 'project', source: '20_项目/P', target: '90_系统/归档/项目/2026/P',
						main_file: '20_项目/P/P.md', project_id: 'p',
					},
					{
						type: 'draft', source: '00_草稿/ok.md',
						target: '90_系统/归档/草稿/2026/08/ok.md', main_file: '00_草稿/ok.md',
					},
				],
				moveRunner: fakeMove(root),
			});
		}).not.toThrow();
		expect(report!.failed).toEqual([{
			path: '20_项目/P/assets/sub/x.md',
			reason: expect.stringMatching(/^target_dir_create_failed:/),
		}]);
		expect(existsSync(join(root, '20_项目/P/assets/sub/x.md'))).toBe(true);
		expect(existsSync(join(root, '90_系统/归档/草稿/2026/08/ok.md'))).toBe(true);
	} finally {
		cleanup();
	}
});
```

- [x] **步骤 2：运行测试并确认失败**

运行：

```bash
npx vitest run tests/services/archive.test.ts -t '创建嵌套目标目录失败'
```

预期：测试因 `mkdirSync` 抛出 `ENOTDIR` 而失败。

- [x] **步骤 3：实现最小修补**

将 `moveDirectory` 内的目标父目录创建改为：

```ts
try {
	mkdirSync(dirname(targetAbs), { recursive: true });
} catch (error) {
	report.failed.push({
		path: `${candidate.source}/${rel}`,
		reason: `target_dir_create_failed:${(error as Error).message}`,
	});
	return false;
}
```

不修改外层移动循环；`return false` 只终止当前候选项，后续候选项自然继续。

- [x] **步骤 4：运行定向测试并确认通过**

运行：

```bash
npx vitest run tests/services/archive.test.ts -t '创建嵌套目标目录失败|目标父目录不可写'
```

预期：相关测试全部通过。

- [x] **步骤 5：运行完整验证**

运行：

```bash
npm run release:verify
```

预期：类型检查、Biome、全部测试和构建均通过。

- [x] **步骤 6：提交任务 2**

```bash
git add src/services/archive.ts tests/services/archive.test.ts docs/superpowers/plans/2026-08-02-archive-lightweight-safety.md
git commit -m "fix: 归档上报嵌套目标目录创建失败"
```
