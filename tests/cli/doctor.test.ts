import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import doctorCommand, {
	MIN_NODE_VERSION,
	isNodeVersionSupported,
} from '../../src/cli/commands/doctor.js';
import initCommand from '../../src/cli/commands/init.js';
import { initDb } from '../../src/db/schema.js';
import { upsertMemoryItem } from '../../src/services/memory-items.js';

function makeTmpDir() {
	const dir = mkdtempSync(join(tmpdir(), 'lifeos-doctor-'));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const FIRST_DIR = { zh: '00_草稿', en: '00_Drafts' } as const;
const DIGEST_DIR = { zh: join('90_系统', '信息'), en: join('90_System', 'Digest') } as const;

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
				content: '必须遵守'.repeat(2000),
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
