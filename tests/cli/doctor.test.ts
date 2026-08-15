import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import Database from 'better-sqlite3';
import { vi } from 'vitest';
import doctorCommand, {
	MIN_NODE_VERSION,
	isNodeVersionSupported,
} from '../../src/cli/commands/doctor.js';
import * as doctorModule from '../../src/cli/commands/doctor.js';
import initCommand from '../../src/cli/commands/init.js';
import rulesCommand from '../../src/cli/commands/rules.js';
import { memoryStartup } from '../../src/core.js';
import { initDb } from '../../src/db/schema.js';
import { RUNTIME_SCHEMA_VERSION } from '../../src/runtime-contract.js';
import { MAX_GLOBAL_HARD_ITEM_PAYLOAD_BYTES } from '../../src/services/global-hard-safety.js';
import { upsertMemoryItem } from '../../src/services/memory-items.js';
import { fullScan } from '../../src/utils/vault-indexer.js';

/** Run a `SELECT COUNT(*) AS n` query and return the number. */
function countQuery(db: Database.Database, sql: string): number {
	const row = db.prepare(sql).get();
	return row !== null && typeof row === 'object' && 'n' in row && typeof row.n === 'number'
		? row.n
		: 0;
}

function makeTmpDir() {
	const dir = mkdtempSync(join(tmpdir(), 'lifeos-doctor-'));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const FIRST_DIR = { zh: '00_草稿', en: '00_Drafts' } as const;
const DIGEST_DIR = { zh: '90_系统/信息', en: '90_System/Digest' } as const;
const GIT_AVAILABLE = spawnSync('git', ['--version']).status === 0;

describe.each(['zh', 'en'] as const)('lifeos doctor --lang %s', (lang) => {
	test('healthy vault: all checks pass', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', lang, '--no-mcp']);
			const result = await doctorCommand([dir]);
			expect(result.passed).toBe(true);
			expect(result.checks.every((c) => c.status === 'pass')).toBe(true);
			expect(result.checks.find((check) => check.name === 'runtime contract')?.detail).toBe(
				`contract=2 schema=${RUNTIME_SCHEMA_VERSION} receipt=opened`,
			);
		} finally {
			cleanup();
		}
	});
});

describe('lifeos doctor', () => {
	test('freelist 健康告警同时要求比例达到 25% 且字节达到 64 MiB', () => {
		expect(typeof doctorModule.assessFreelistHealth).toBe('function');
		const assessFreelistHealth = doctorModule.assessFreelistHealth;
		expect(
			assessFreelistHealth({ pageCount: 1_000, freelistCount: 260, pageSize: 4_096 }),
		).toMatchObject({ status: 'pass', freelistRatio: 0.26, freelistBytes: 1_064_960 });
		expect(
			assessFreelistHealth({ pageCount: 256, freelistCount: 64, pageSize: 1024 * 1024 }),
		).toMatchObject({ status: 'warn', freelistRatio: 0.25, freelistBytes: 64 * 1024 * 1024 });
		expect(
			assessFreelistHealth({ pageCount: 257, freelistCount: 64, pageSize: 1024 * 1024 }),
		).toMatchObject({ status: 'pass', freelistBytes: 64 * 1024 * 1024 });
	});

	test('missing directory: reports warning', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			const dirName = FIRST_DIR.zh;
			rmSync(join(dir, dirName), { recursive: true });
			const result = await doctorCommand([dir]);
			expect(result.passed).toBe(true);
			const warn = result.checks.find((c) => c.detail === 'missing' && c.name.includes(dirName));
			expect(warn).toBeDefined();
		} finally {
			cleanup();
		}
	});

	test('missing digest subdirectory: reports warning', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			rmSync(join(dir, DIGEST_DIR.zh), { recursive: true, force: true });
			const result = await doctorCommand([dir]);
			expect(result.passed).toBe(true);
			expect(
				result.checks.some(
					(c) => c.name === `subdirectory: ${DIGEST_DIR.zh}` && c.status === 'warn',
				),
			).toBe(true);
		} finally {
			cleanup();
		}
	});

	test('no lifeos.yaml: fails', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			const result = await doctorCommand([dir]);
			expect(result.passed).toBe(false);
			expect(result.checks[0].name).toBe('lifeos.yaml');
			expect(result.checks[0].status).toBe('fail');
		} finally {
			cleanup();
		}
	});

	test('invalid YAML reports failure', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			writeFileSync(join(dir, 'lifeos.yaml'), '{{invalid yaml');
			const result = await doctorCommand([dir]);
			expect(result.passed).toBe(false);
			expect(result.checks.some((c) => c.name === 'lifeos.yaml' && c.status === 'fail')).toBe(true);
		} finally {
			cleanup();
		}
	});

	test('invalid config schema reports failure', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			const yamlPath = join(dir, 'lifeos.yaml');
			const content = readFileSync(yamlPath, 'utf-8');
			writeFileSync(yamlPath, content.replace('drafts: 00_草稿', 'drafts: 42'));
			const result = await doctorCommand([dir]);
			expect(result.passed).toBe(false);
			expect(result.checks.some((c) => c.name === 'lifeos.yaml' && c.status === 'fail')).toBe(true);
		} finally {
			cleanup();
		}
	});

	test('版本不一致既告警，也由最终 runtime contract 阻断', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			const yamlPath = join(dir, 'lifeos.yaml');
			const content = readFileSync(yamlPath, 'utf-8');
			writeFileSync(yamlPath, content.replace(/assets: \S+/, 'assets: 0.0.1'));
			const result = await doctorCommand([dir]);
			expect(result.passed).toBe(false);
			expect(result.checks.some((c) => c.name === 'assets version' && c.status === 'warn')).toBe(
				true,
			);
			expect(result.checks.some((c) => c.name === 'runtime contract' && c.status === 'fail')).toBe(
				true,
			);
		} finally {
			cleanup();
		}
	});

	test('managed template 缺失必须阻断最终 runtime', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			unlinkSync(join(dir, '90_系统', '模板', 'Daily_Template.md'));
			const result = await doctorCommand([dir]);
			expect(result.passed).toBe(false);
			expect(
				result.checks.some((c) => c.name.includes('Daily_Template') && c.status === 'warn'),
			).toBe(true);
			expect(result.checks.some((c) => c.name === 'runtime contract' && c.status === 'fail')).toBe(
				true,
			);
		} finally {
			cleanup();
		}
	});

	test('managed skills 目录缺失必须阻断最终 runtime', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			rmSync(join(dir, '.agents'), { recursive: true });
			const result = await doctorCommand([dir]);
			expect(result.passed).toBe(false);
			expect(result.checks.some((c) => c.name === '.agents/skills/' && c.status === 'warn')).toBe(
				true,
			);
			expect(result.checks.some((c) => c.name === 'runtime contract' && c.status === 'fail')).toBe(
				true,
			);
		} finally {
			cleanup();
		}
	});

	test('Node.js version check always present', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			const result = await doctorCommand([dir]);
			expect(result.checks.some((c) => c.name === `Node.js >= ${MIN_NODE_VERSION}`)).toBe(true);
		} finally {
			cleanup();
		}
	});

	test('Node.js version helper enforces the full minimum version', () => {
		expect(isNodeVersionSupported('v24.14.1')).toBe(true);
		expect(isNodeVersionSupported('v24.14.0')).toBe(false);
		expect(isNodeVersionSupported('v24.15.0')).toBe(true);
		expect(isNodeVersionSupported('v25.0.0')).toBe(true);
		expect(isNodeVersionSupported('v23.99.99')).toBe(false);
	});

	test('缺失 runtime receipt 时失败，不回退到旧启动路径', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			unlinkSync(join(dir, '90_系统', '记忆', 'runtime-receipt.json'));
			const result = await doctorCommand([dir]);
			expect(result.passed).toBe(false);
			expect(
				result.checks.some(
					(c) =>
						c.name === 'runtime contract' && c.status === 'fail' && c.detail?.includes('receipt'),
				),
			).toBe(true);
		} finally {
			cleanup();
		}
	});

	test('旧预算键与 scope_mode 作为非法最终配置失败', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			const yamlPath = join(dir, 'lifeos.yaml');
			const content = readFileSync(yamlPath, 'utf-8')
				.replace('    global_rules: 600', '    global_rules: 600\n    userprofile_rules: 1000')
				.replace('  repository_bindings: {}', '  repository_bindings: {}\n  scope_mode: shadow');
			writeFileSync(yamlPath, content, 'utf-8');
			const result = await doctorCommand([dir]);
			expect(result.passed).toBe(false);
			expect(result.checks[0]).toMatchObject({ name: 'lifeos.yaml', status: 'fail' });
		} finally {
			cleanup();
		}
	});

	test('旧 MCP 协议残留是发布阻断项，不只是 warning', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			writeFileSync(
				join(dir, 'AGENTS.md'),
				'调用 memory_recent() 和 memory_log(slot_key, content)',
			);
			const result = await doctorCommand([dir]);
			expect(result.passed).toBe(false);
			expect(
				result.checks.some((c) => c.name === 'memory protocol assets' && c.status === 'fail'),
			).toBe(true);
		} finally {
			cleanup();
		}
	});

	test('项目稳定 ID 缺失、重复或不可移植均阻断最终 V4', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			writeFileSync(join(dir, '20_项目', 'missing.md'), '---\ntype: project\n---\n');
			writeFileSync(join(dir, '20_项目', 'one.md'), '---\ntype: project\nid: duplicate\n---\n');
			writeFileSync(join(dir, '20_项目', 'two.md'), '---\ntype: project\nid: duplicate\n---\n');
			writeFileSync(
				join(dir, '20_项目', 'invalid.md'),
				'---\ntype: project\nid: Project_Invalid\n---\n',
			);
			const result = await doctorCommand([dir]);
			expect(result.passed).toBe(false);
			const check = result.checks.find((item) => item.name === 'project ids');
			expect(check).toMatchObject({ status: 'fail' });
			expect(check?.detail).toContain('缺少 id');
			expect(check?.detail).toContain('重复 id duplicate');
			expect(check?.detail).toContain('不是可移植的小写 ASCII 标识符');
		} finally {
			cleanup();
		}
	});

	test.skipIf(!GIT_AVAILABLE)(
		'Git worktree 中未忽略 WAL/SHM 时只告警且不改 .gitignore',
		async () => {
			const { dir, cleanup } = makeTmpDir();
			try {
				await initCommand([dir, '--lang', 'zh', '--no-mcp']);
				spawnSync('git', ['init', dir], { stdio: 'ignore' });
				const result = await doctorCommand([dir]);
				expect(result.passed).toBe(true);
				expect(result.checks).toContainEqual(
					expect.objectContaining({ name: 'database Git hygiene', status: 'warn' }),
				);
				expect(existsSync(join(dir, '.gitignore'))).toBe(false);
			} finally {
				cleanup();
			}
		},
		30000,
	);

	// Windows 上 git init + doctor 较慢（多次 spawn git），放宽超时
	test.skipIf(!GIT_AVAILABLE)(
		'Git worktree 已忽略 WAL/SHM 时通过检查',
		async () => {
			const { dir, cleanup } = makeTmpDir();
			try {
				await initCommand([dir, '--lang', 'zh', '--no-mcp']);
				spawnSync('git', ['init', dir], { stdio: 'ignore' });
				writeFileSync(join(dir, '.gitignore'), '*.db-wal\n*.db-shm\n', 'utf-8');
				const result = await doctorCommand([dir]);
				expect(result.checks).toContainEqual(
					expect.objectContaining({ name: 'database Git hygiene', status: 'pass' }),
				);
			} finally {
				cleanup();
			}
		},
		30000,
	);

	test.skipIf(!GIT_AVAILABLE)(
		'Git 已跟踪特殊字符路径中的 WAL 时告警且不修改索引或 .gitignore',
		async () => {
			const { dir: gitRoot, cleanup } = makeTmpDir();
			const vaultPath = join(gitRoot, 'Vault [literal] $');
			try {
				await initCommand([vaultPath, '--lang', 'zh', '--no-mcp']);
				expect(spawnSync('git', ['init', gitRoot], { stdio: 'ignore' }).status).toBe(0);
				const ignorePath = join(gitRoot, '.gitignore');
				const ignoreBefore = '# 用户已有规则\n*.tmp\n';
				writeFileSync(ignorePath, ignoreBefore, 'utf-8');

				const walPath = join(vaultPath, '90_系统', '记忆', 'memory.db-wal');
				const walRelativePath = relative(gitRoot, walPath).replace(/\\/g, '/');
				writeFileSync(walPath, '仅用于验证 Git 索引状态', 'utf-8');
				const addResult = spawnSync(
					'git',
					['--literal-pathspecs', '-C', gitRoot, 'add', '-f', '--', walRelativePath],
					{ encoding: 'utf8' },
				);
				expect(addResult.status, addResult.stderr).toBe(0);
				unlinkSync(walPath);

				const result = await doctorCommand([vaultPath]);
				const hygiene = result.checks.find((check) => check.name === 'database Git hygiene');
				expect(result.passed).toBe(true);
				expect(hygiene).toMatchObject({ status: 'warn' });
				expect(hygiene?.detail).toContain('已被 Git 跟踪');
				expect(hygiene?.detail).toContain(walRelativePath);
				expect(readFileSync(ignorePath, 'utf-8')).toBe(ignoreBefore);

				const trackedResult = spawnSync(
					'git',
					[
						'--literal-pathspecs',
						'-C',
						gitRoot,
						'ls-files',
						'--error-unmatch',
						'--',
						walRelativePath,
					],
					{ encoding: 'utf8' },
				);
				expect(trackedResult.status, trackedResult.stderr).toBe(0);
			} finally {
				cleanup();
			}
		},
		30000,
	);

	test('已归档记忆不算孤儿作用域，孤儿只统计活跃记忆', async () => {
		const { dir, cleanup } = makeTmpDir();
		let db: Database.Database | undefined;
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			const dbPath = join(dir, '90_系统', '记忆', 'memory.db');
			db = new Database(dbPath);
			initDb(db);
			const activeDb = db;
			const now = new Date().toISOString();
			// 已归档（archived）的项目/文件记忆：作用域无对应实体，但不应计入孤儿
			const insertArchived = (slotKey: string, scopeKey: string) =>
				activeDb
					.prepare(`
					INSERT INTO memory_items(
						slot_key, content, item_kind, scope_type, scope_key, priority,
						enforcement, source, related_files, manual_flag, status,
						created_at, updated_at, expires_at, archived_at, archive_reason
					) VALUES (?, '已归档', 'decision', ?, ?, 50, 'soft',
						'correction', '[]', 0, 'archived', ?, ?, NULL, ?, 'test')
				`)
					.run(slotKey, 'project', scopeKey, now, now, now);
			insertArchived('p:archived-1', 'gone-project-a');
			insertArchived('p:archived-2', 'gone-project-b');
			activeDb
				.prepare(`
				INSERT INTO memory_items(
					slot_key, content, item_kind, scope_type, scope_key, priority,
					enforcement, source, related_files, manual_flag, status,
					created_at, updated_at, expires_at, archived_at, archive_reason
				) VALUES ('f:archived', '已归档', 'decision', 'file', 'gone-file.md', 50, 'soft',
					'correction', '[]', 0, 'archived', ?, ?, NULL, ?, 'test')
			`)
				.run(now, now, now);
			// 活跃但无实体的记忆：仍应计入孤儿
			upsertMemoryItem(db, {
				slotKey: 'p:active-orphan',
				content: '活跃孤儿',
				itemKind: 'decision',
				scope: { type: 'project', key: 'ghost-project' },
			});
			const result = await doctorCommand([dir]);
			const scopes = result.checks.find((check) => check.name === 'memory scopes');
			expect(scopes?.status).toBe('fail');
			expect(scopes?.detail).toBe('1 orphan');
			expect(result.passed).toBe(false);
		} finally {
			db?.close();
			cleanup();
		}
	});

	test('历史异常 global hard 可按 Doctor 参数归档并恢复启动', async () => {
		const { dir, cleanup } = makeTmpDir();
		let db: Database.Database | undefined;
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			const dbPath = join(dir, '90_系统', '记忆', 'memory.db');
			db = new Database(dbPath);
			const now = new Date().toISOString();
			const content = 'x'.repeat(MAX_GLOBAL_HARD_ITEM_PAYLOAD_BYTES + 1);
			const inserted = db
				.prepare(`
					INSERT INTO memory_items(
						slot_key, content, item_kind, scope_type, scope_key, priority,
						enforcement, source, related_files, manual_flag, status,
						created_at, updated_at, expires_at, archived_at, archive_reason
					) VALUES ('safety:legacy', ?, 'rule', 'global', '', 50, 'hard',
						'preference', '[]', 0, 'active', ?, ?, NULL, NULL, NULL)
				`)
				.run(content, now, now);
			const itemId = Number(inserted.lastInsertRowid);

			expect(() => memoryStartup({ vaultRoot: dir })).toThrow(/全局 hard 规则触发运行时安全上限/);
			const result = await doctorCommand([dir]);
			const safety = result.checks.find((check) => check.name === 'global hard runtime safety');
			expect(safety).toMatchObject({ status: 'fail' });
			expect(safety?.detail).toContain(`Vault=${JSON.stringify(dir)}`);
			expect(safety?.detail).toContain(`item_id=${itemId}`);
			expect(safety?.detail).toContain('lifeos rules archive');
			expect(safety?.detail).toContain('reason=缩减全局 hard 规则');
			expect(safety?.detail).not.toContain(content);
			expect(safety?.detail?.length).toBeLessThan(1_000);

			db.close();
			db = undefined;
			const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
			try {
				const archived = (await rulesCommand([
					'archive',
					dir,
					'--id',
					String(itemId),
					'--reason',
					'缩减全局 hard 规则',
				])) as { status: string; archiveReason: string };
				expect(archived).toMatchObject({
					status: 'archived',
					archiveReason: '缩减全局 hard 规则',
				});
			} finally {
				logSpy.mockRestore();
			}
			expect(() => memoryStartup({ vaultRoot: dir })).not.toThrow();
		} finally {
			db?.close();
			cleanup();
		}
	});

	test('Schema V3 和超预算 global hard rule 都是硬失败', async () => {
		const { dir, cleanup } = makeTmpDir();
		let db: Database.Database | undefined;
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			const dbPath = join(dir, '90_系统', '记忆', 'memory.db');
			db = new Database(dbPath);
			initDb(db);
			upsertMemoryItem(db, {
				slotKey: 'content:oversized',
				content: '必须遵守'.repeat(500),
				itemKind: 'rule',
				scope: { type: 'global', key: '' },
				enforcement: 'hard',
			});
			let result = await doctorCommand([dir]);
			expect(result.passed).toBe(false);
			for (const name of [
				'global hard rules budget',
				'global hard single-item budget',
				'global hard Layer 0 budget',
			]) {
				expect(result.checks.some((c) => c.name === name && c.status === 'fail')).toBe(true);
			}

			db.prepare('UPDATE schema_version SET version = 3').run();
			result = await doctorCommand([dir]);
			expect(result.passed).toBe(false);
			expect(result.checks.some((c) => c.name === 'database schema' && c.status === 'fail')).toBe(
				true,
			);
		} finally {
			db?.close();
			cleanup();
		}
	});

	test('小库高 freelist 比例不告警；--compact-db 终态满足比例与 WAL 验收', async () => {
		const { dir, cleanup } = makeTmpDir();
		let db: Database.Database | undefined;
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			const dbPath = join(dir, '90_系统', '记忆', 'memory.db');
			// Recreate the DB with default settings (auto_vacuum = none) so the
			// auto_vacuum check warns; the init-created file uses INCREMENTAL.
			for (const suffix of ['', '-wal', '-shm']) {
				rmSync(`${dbPath}${suffix}`, { force: true });
			}
			db = new Database(dbPath);
			initDb(db);
			const now = new Date().toISOString();
			const insert = db.prepare(`
					INSERT INTO memory_items(
						slot_key, content, item_kind, scope_type, scope_key, priority,
						enforcement, source, related_files, manual_flag, status,
						created_at, updated_at
					) VALUES (?, 'bulk', 'fact', 'file', 'bulk.md', 50, 'soft',
						'preference', '[]', 0, 'active', ?, ?)
				`);
			db.transaction((count: number) => {
				for (let i = 0; i < count; i += 1) insert.run(`bulk:${i}`, now, now);
			})(100_000);

			let result = await doctorCommand([dir]);
			expect(
				result.checks.some((c) => c.name === 'database auto_vacuum' && c.status === 'warn'),
			).toBe(true);
			expect(
				result.checks.some((c) => c.name === 'database memory_items size' && c.status === 'warn'),
			).toBe(true);

			// 删除全部行制造高比例 freelist；该临时库不足 64 MiB，按双阈值不告警。
			db.exec('DELETE FROM memory_items');
			const beforePages = db.pragma('page_count', { simple: true }) as number;
			db.close();
			db = undefined;

			result = await doctorCommand([dir]);
			const freelist = result.checks.find((c) => c.name === 'database freelist');
			expect(freelist).toMatchObject({ status: 'pass' });
			expect(freelist?.detail).toMatch(/\d+%; [\d.]+ MiB\)$/);

			const compactResult = await doctorCommand([dir, '--compact-db']);
			expect(compactResult.checks.find((c) => c.name === 'database compact')).toMatchObject({
				status: 'pass',
				detail: expect.stringContaining('state=succeeded'),
			});

			db = new Database(dbPath);
			const afterPages = db.pragma('page_count', { simple: true }) as number;
			const afterFreelist = db.pragma('freelist_count', { simple: true }) as number;
			expect(afterFreelist / afterPages).toBeLessThan(0.05);
			const walPath = `${dbPath}-wal`;
			expect(existsSync(walPath) ? statSync(walPath).size : 0).toBe(0);
			expect(afterPages).toBeLessThanOrEqual(beforePages * 0.2);
			expect(db.pragma('auto_vacuum', { simple: true })).toBe(2);
		} finally {
			db?.close();
			cleanup();
		}
	});

	test('--compact-db 在读事务阻止 WAL TRUNCATE 时失败并返回 checkpoint 诊断', async () => {
		const { dir, cleanup } = makeTmpDir();
		let reader: Database.Database | undefined;
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			const dbPath = join(dir, '90_系统', '记忆', 'memory.db');
			reader = new Database(dbPath);
			reader.pragma('journal_mode = WAL');
			reader.exec('BEGIN');
			reader.prepare('SELECT COUNT(*) FROM schema_version').get();

			const writer = new Database(dbPath);
			try {
				writer.pragma('journal_mode = WAL');
				writer.exec('CREATE TABLE checkpoint_busy(payload TEXT NOT NULL)');
				writer.prepare('INSERT INTO checkpoint_busy(payload) VALUES (?)').run('busy'.repeat(4096));
			} finally {
				writer.close();
			}

			const result = await doctorCommand([dir, '--compact-db']);
			expect(result.passed).toBe(false);
			expect(result.checks.find((check) => check.name === 'database compact')).toMatchObject({
				status: 'fail',
				detail: expect.stringMatching(
					/wal_checkpoint\(TRUNCATE\).*busy=1.*log=\d+.*checkpointed=\d+/,
				),
			});
			expect(existsSync(`${dbPath}-wal`) ? statSync(`${dbPath}-wal`).size : 0).toBeGreaterThan(0);
		} finally {
			if (reader) {
				reader.exec('ROLLBACK');
				reader.close();
			}
			cleanup();
		}
	});

	test('--reindex clears scan_state and rebuilds the index', async () => {
		const { dir, cleanup } = makeTmpDir();
		let db: Database.Database | undefined;
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			const dbPath = join(dir, '90_系统', '记忆', 'memory.db');
			writeFileSync(join(dir, '00_草稿', 'alpha.md'), '---\ntitle: Alpha Note\n---\nAlpha body\n');
			writeFileSync(join(dir, '00_草稿', 'beta.md'), '---\ntitle: Beta Note\n---\nBeta body\n');

			db = new Database(dbPath);
			const seeded = fullScan(dir, db);
			expect(seeded.indexed).toBeGreaterThanOrEqual(2);
			const seededState = countQuery(db, 'SELECT COUNT(*) AS n FROM scan_state');
			expect(seededState).toBeGreaterThanOrEqual(2);
			// scan_state stays populated: --reindex must clear it itself. If the
			// command skipped the DELETE, fullScan would short-circuit on
			// matching scan state and report unchanged instead of re-indexing.
			db.close();
			db = undefined;

			const result = await doctorCommand([dir, '--reindex']);
			const reindex = result.checks.find((c) => c.name === 'database reindex');
			expect(reindex).toMatchObject({ status: 'pass' });
			expect(reindex?.detail).toContain(`indexed=${seeded.indexed}`);
			expect(reindex?.detail).toContain('unchanged=0');

			db = new Database(dbPath);
			const rebuiltState = countQuery(db, 'SELECT COUNT(*) AS n FROM scan_state');
			expect(rebuiltState).toBe(seededState);
			const ftsMatches = countQuery(
				db,
				"SELECT COUNT(*) AS n FROM vault_fts WHERE vault_fts MATCH 'alpha'",
			);
			expect(ftsMatches).toBeGreaterThan(0);
		} finally {
			db?.close();
			cleanup();
		}
	});

	test('--reindex loads custom_dict.txt before rebuilding search hints', async () => {
		const { dir, cleanup } = makeTmpDir();
		let db: Database.Database | undefined;
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			const dbPath = join(dir, '90_系统', '记忆', 'memory.db');
			// Custom dictionary turns the otherwise default-segmented
			// 四元数群 (四元 / 数 / 群) into a single token.
			writeFileSync(join(dir, '90_系统', '记忆', 'custom_dict.txt'), '四元数群 5 n\n', 'utf-8');
			writeFileSync(
				join(dir, '00_草稿', 'quat.md'),
				'---\ntitle: 四元数群笔记\n---\n四元数群 的几何性质\n',
			);

			db = new Database(dbPath);
			const seeded = fullScan(dir, db);
			expect(seeded.indexed).toBeGreaterThanOrEqual(1);
			db.close();
			db = undefined;

			const result = await doctorCommand([dir, '--reindex']);
			const reindex = result.checks.find((c) => c.name === 'database reindex');
			expect(reindex).toMatchObject({ status: 'pass' });

			db = new Database(dbPath);
			const row = db
				.prepare("SELECT search_hints FROM vault_index WHERE file_path LIKE '%quat.md'")
				.get() as { search_hints: string };
			const hints: string[] = row.search_hints.startsWith('[')
				? (JSON.parse(row.search_hints) as string[])
				: row.search_hints.split(/\s+/);
			expect(hints).toContain('四元数群');
		} finally {
			db?.close();
			cleanup();
		}
	});

	test('--reindex fails closed when custom_dict.txt is corrupted', async () => {
		const { dir, cleanup } = makeTmpDir();
		let db: Database.Database | undefined;
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			const dbPath = join(dir, '90_系统', '记忆', 'memory.db');
			writeFileSync(join(dir, '00_草稿', 'alpha.md'), '---\ntitle: Alpha Note\n---\nAlpha body\n');

			db = new Database(dbPath);
			const seeded = fullScan(dir, db);
			expect(seeded.indexed).toBeGreaterThanOrEqual(1);
			const seededState = countQuery(db, 'SELECT COUNT(*) AS n FROM scan_state');
			expect(seededState).toBeGreaterThanOrEqual(1);
			const seededRows = db
				.prepare('SELECT file_path, search_hints, indexed_at FROM vault_index ORDER BY file_path')
				.all();
			db.close();
			db = undefined;

			// Corrupted dictionary (invalid UTF-8): the rebuild must abort
			// before touching scan_state or the index. If it proceeded, the
			// seeded rows would be rewritten (indexed_at bumped) and the
			// check would pass.
			writeFileSync(
				join(dir, '90_系统', '记忆', 'custom_dict.txt'),
				Buffer.from([0xff, 0xfe, 0x80, 0x81]),
			);

			const result = await doctorCommand([dir, '--reindex']);
			const reindex = result.checks.find((c) => c.name === 'database reindex');
			expect(reindex).toMatchObject({ status: 'fail' });
			expect(reindex?.detail).toMatch(/custom_dict/);

			db = new Database(dbPath);
			const afterState = countQuery(db, 'SELECT COUNT(*) AS n FROM scan_state');
			expect(afterState).toBe(seededState);
			const afterRows = db
				.prepare('SELECT file_path, search_hints, indexed_at FROM vault_index ORDER BY file_path')
				.all();
			expect(afterRows).toEqual(seededRows);
		} finally {
			db?.close();
			cleanup();
		}
	});
});
