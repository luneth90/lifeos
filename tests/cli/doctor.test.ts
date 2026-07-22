import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import Database from 'better-sqlite3';
import { vi } from 'vitest';
import doctorCommand, {
	MIN_NODE_VERSION,
	isNodeVersionSupported,
} from '../../src/cli/commands/doctor.js';
import initCommand from '../../src/cli/commands/init.js';
import rulesCommand from '../../src/cli/commands/rules.js';
import { memoryStartup } from '../../src/core.js';
import { initDb } from '../../src/db/schema.js';
import { MAX_GLOBAL_HARD_ITEM_PAYLOAD_BYTES } from '../../src/services/global-hard-safety.js';
import { upsertMemoryItem } from '../../src/services/memory-items.js';

function makeTmpDir() {
	const dir = mkdtempSync(join(tmpdir(), 'lifeos-doctor-'));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const FIRST_DIR = { zh: '00_草稿', en: '00_Drafts' } as const;
const DIGEST_DIR = { zh: join('90_系统', '信息'), en: join('90_System', 'Digest') } as const;
const GIT_AVAILABLE = spawnSync('git', ['--version']).status === 0;

describe.each(['zh', 'en'] as const)('lifeos doctor --lang %s', (lang) => {
	test('healthy vault: all checks pass', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', lang, '--no-mcp']);
			const result = await doctorCommand([dir]);
			expect(result.passed).toBe(true);
			expect(result.checks.every((c) => c.status === 'pass')).toBe(true);
		} finally {
			cleanup();
		}
	});

	test('missing directory: reports warning', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', lang, '--no-mcp']);
			const dirName = FIRST_DIR[lang];
			rmSync(join(dir, dirName), { recursive: true });
			const result = await doctorCommand([dir]);
			expect(result.passed).toBe(true); // warnings don't fail
			const warn = result.checks.find((c) => c.detail === 'missing' && c.name.includes(dirName));
			expect(warn).toBeDefined();
		} finally {
			cleanup();
		}
	});

	test('missing digest subdirectory: reports warning', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', lang, '--no-mcp']);
			rmSync(join(dir, DIGEST_DIR[lang]), { recursive: true, force: true });
			const result = await doctorCommand([dir]);
			expect(result.passed).toBe(true);
			expect(
				result.checks.some(
					(c) => c.name === `subdirectory: ${DIGEST_DIR[lang]}` && c.status === 'warn',
				),
			).toBe(true);
		} finally {
			cleanup();
		}
	});
});

describe('lifeos doctor', () => {
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
	);

	test.skipIf(!GIT_AVAILABLE)('Git worktree 已忽略 WAL/SHM 时通过检查', async () => {
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
	});

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
	);

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
});
