import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import upgrade from '../../src/cli/commands/upgrade.js';
import { VERSION } from '../../src/cli/utils/version.js';
import { validateRuntimeContract } from '../../src/runtime-contract.js';

interface UpgradeFixture {
	parent: string;
	root: string;
	dbPath: string;
	mapPath: string;
	legacyYaml: string;
	cleanup: () => void;
}

const GLOBAL_CONTENT = '所有回复使用中文';
const PROJECT_CONTENT = 'GTS 使用最终核心契约';

function sha256(content: string): string {
	return createHash('sha256').update(content).digest('hex');
}

function legacyYaml(): string {
	return `version: '1.0'
language: zh
directories:
  drafts: 00_草稿
  diary: 10_日记
  projects: 20_项目
  research: 30_研究
  knowledge: 40_知识
  outputs: 50_成果
  plans: 60_计划
  resources: 70_资源
  reflection: 80_复盘
  system: 90_系统
subdirectories:
  knowledge:
    notes: 笔记
    wiki: 百科
  resources:
    books: 书籍
    literature: 文献
    translations: 翻译
  system:
    templates: 模板
    schema: 规范
    memory: 记忆
    digest: 信息
    prompts: 提示词
    archive:
      projects: 归档/项目
      drafts: 归档/草稿
      plans: 归档/计划
      diary: 归档/日记
memory:
  db_name: memory.db
  scan_prefixes: [drafts, diary, projects, research, knowledge, outputs, plans, resources, reflection]
  excluded_prefixes: [system]
  context_budgets:
    layer0_total: 1600
    userprofile_summary: 180
    userprofile_rules: 1000
    taskboard_focus: 420
    revises_summary: 100
  repository_bindings: {}
installed_versions:
  cli: 1.8.3
  assets: 1.8.3
`;
}

function createV3Database(path: string): void {
	const db = new Database(path);
	try {
		db.pragma('journal_mode = WAL');
		db.exec(`
			CREATE TABLE schema_version (version INTEGER NOT NULL);
			INSERT INTO schema_version(version) VALUES (3);
			CREATE TABLE vault_index (
				file_path TEXT PRIMARY KEY,
				title TEXT,
				type TEXT,
				status TEXT,
				domain TEXT,
				category TEXT,
				tags TEXT,
				aliases TEXT,
				summary TEXT,
				search_hints TEXT,
				wikilinks TEXT,
				backlinks TEXT,
				section_heads TEXT,
				content_hash TEXT,
				file_size INTEGER,
				created_at TEXT,
				modified_at TEXT,
				indexed_at TEXT
			);
			CREATE TABLE memory_items (
				slot_key TEXT PRIMARY KEY,
				content TEXT NOT NULL,
				source TEXT NOT NULL DEFAULT 'preference',
				related_files TEXT NOT NULL DEFAULT '[]',
				manual_flag INTEGER NOT NULL DEFAULT 0,
				status TEXT NOT NULL DEFAULT 'active',
				updated_at TEXT,
				expires_at TEXT
			);
		`);
		const insert = db.prepare(`
			INSERT INTO memory_items(
				slot_key, content, source, related_files, manual_flag, status, updated_at, expires_at
			) VALUES (?, ?, ?, ?, 0, 'active', ?, NULL)
		`);
		insert.run('content:language', GLOBAL_CONTENT, 'correction', '[]', '2026-07-01T00:00:00.000Z');
		insert.run(
			'project:gts-core',
			PROJECT_CONTENT,
			'preference',
			'["20_项目/GTS.md"]',
			'2026-07-02T00:00:00.000Z',
		);
	} finally {
		db.close();
	}
}

function scopeMap(projectKey = 'gts-learning', projectHash = sha256(PROJECT_CONTENT)) {
	return [
		{
			legacyIdentity: 'slot:content:language',
			contentHash: sha256(GLOBAL_CONTENT),
			scope: { type: 'global', key: '' },
			itemKind: 'rule',
			priority: 100,
			enforcement: 'hard',
		},
		{
			legacyIdentity: 'slot:project:gts-core',
			contentHash: projectHash,
			scope: { type: 'project', key: projectKey },
			itemKind: 'decision',
			priority: 80,
			enforcement: 'soft',
		},
	];
}

function makeFixture(): UpgradeFixture {
	const parent = mkdtempSync(join(tmpdir(), 'lifeos-v2-upgrade-'));
	const root = join(parent, 'vault');
	const memoryDir = join(root, '90_系统', '记忆');
	mkdirSync(join(root, '20_项目'), { recursive: true });
	mkdirSync(join(root, '00_草稿'), { recursive: true });
	mkdirSync(memoryDir, { recursive: true });
	const yaml = legacyYaml();
	writeFileSync(join(root, 'lifeos.yaml'), yaml, 'utf-8');
	writeFileSync(
		join(root, '20_项目', 'GTS.md'),
		'---\ntitle: GTS\ntype: project\nid: gts-learning\nstatus: active\n---\n用户项目内容\n',
		'utf-8',
	);
	writeFileSync(join(root, '00_草稿', 'user-note.md'), '用户数据不得丢失\n', 'utf-8');
	writeFileSync(join(root, 'AGENTS.md'), 'OLD AGENT CONTRACT\n', 'utf-8');
	writeFileSync(join(memoryDir, 'ContextPolicy.md'), '旧上下文配置\n', 'utf-8');
	writeFileSync(
		join(memoryDir, 'UserProfile.md'),
		`# 用户画像

## 用户摘要
<!-- BEGIN AUTO:profile-summary -->
旧摘要
<!-- END AUTO:profile-summary -->

## 行为规则
<!-- BEGIN AUTO:rules -->
旧规则
<!-- END AUTO:rules -->
`,
		'utf-8',
	);
	const dbPath = join(memoryDir, 'memory.db');
	createV3Database(dbPath);
	const mapPath = join(parent, 'v4-scope-map.json');
	writeFileSync(mapPath, `${JSON.stringify(scopeMap(), null, 2)}\n`, 'utf-8');
	return {
		parent,
		root,
		dbPath,
		mapPath,
		legacyYaml: yaml,
		cleanup: () => rmSync(parent, { recursive: true, force: true }),
	};
}

function dbVersion(path: string): number {
	const db = new Database(path, { readonly: true, fileMustExist: true });
	try {
		return (db.prepare('SELECT version FROM schema_version').get() as { version: number }).version;
	} finally {
		db.close();
	}
}

function findJournals(root: string): string[] {
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = join(root, entry.name);
		if (entry.isDirectory()) return findJournals(path);
		return entry.name === 'journal.json' ? [path] : [];
	});
}

describe('lifeos upgrade：V3 一次性原子切到最终 V2/V4', () => {
	let fixture: UpgradeFixture;
	let logSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		fixture = makeFixture();
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		logSpy.mockRestore();
		fixture.cleanup();
	});

	it('在一个 cutover 中升级配置、资产、客户端、数据库和运行收据', async () => {
		const result = await upgrade([fixture.root, '--scope-map', fixture.mapPath]);

		expect(result.migratedItems).toBe(2);
		expect(result.skipped).toEqual([]);
		expect(dbVersion(fixture.dbPath)).toBe(4);
		const db = new Database(fixture.dbPath, { readonly: true, fileMustExist: true });
		try {
			const rows = db
				.prepare(`
					SELECT item_id, slot_key, item_kind, scope_type, scope_key, priority, enforcement, content
					FROM memory_items ORDER BY item_id
				`)
				.all() as Array<Record<string, unknown>>;
			expect(rows).toHaveLength(2);
			expect(rows).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						slot_key: 'content:language',
						item_kind: 'rule',
						scope_type: 'global',
						scope_key: '',
						priority: 100,
						enforcement: 'hard',
						content: GLOBAL_CONTENT,
					}),
					expect.objectContaining({
						slot_key: 'project:gts-core',
						item_kind: 'decision',
						scope_type: 'project',
						scope_key: 'gts-learning',
						content: PROJECT_CONTENT,
					}),
				]),
			);
			expect(
				db
					.prepare('PRAGMA index_list(memory_items)')
					.all()
					.some((row) => (row as { unique: number }).unique === 1),
			).toBe(true);
		} finally {
			db.close();
		}

		const config = parseYaml(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')) as {
			memory: Record<string, unknown> & { context_budgets: Record<string, number> };
			installed_versions: { cli: string; assets: string };
		};
		expect(config.memory.contract_version).toBe(2);
		expect(config.memory).not.toHaveProperty('scope_mode');
		expect(config.memory.context_budgets).toEqual({
			layer0_total: 1600,
			global_rules: 600,
			userprofile_summary: 180,
			taskboard_focus: 420,
			scoped_context: 1200,
			single_item_max: 220,
		});
		expect(config.memory.context_budgets).not.toHaveProperty('userprofile_rules');
		expect(config.memory.context_budgets).not.toHaveProperty('revises_summary');
		expect(config.installed_versions).toEqual({ cli: VERSION, assets: VERSION });

		const receipt = JSON.parse(
			readFileSync(join(fixture.root, '90_系统', '记忆', 'runtime-receipt.json'), 'utf-8'),
		) as Record<string, unknown>;
		expect(receipt).toMatchObject({
			contract_version: 2,
			schema_version: 4,
			kind: 'upgrade',
			state: 'opened',
			runtime_version: VERSION,
			journal_path: result.journalPath,
		});
		expect(receipt.package_sha256).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
		const journal = JSON.parse(readFileSync(result.journalPath, 'utf-8')) as Record<
			string,
			unknown
		>;
		expect(journal).toMatchObject({
			contract_version: 2,
			schema_version: 4,
			state: 'opened',
			package_sha256: receipt.package_sha256,
		});
		expect(validateRuntimeContract({ vaultRoot: fixture.root, runtimeVersion: VERSION }).ok).toBe(
			true,
		);
	});

	it('整包覆盖旧协议和旧客户端配置，但保留用户数据文件', async () => {
		mkdirSync(join(fixture.root, '.codex'), { recursive: true });
		writeFileSync(
			join(fixture.root, '.codex', 'config.toml'),
			'[mcp_servers.lifeos]\ncommand = "legacy-lifeos"\nargs = ["--shadow"]\n',
			'utf-8',
		);
		await upgrade([fixture.root, '--scope-map', fixture.mapPath]);

		expect(readFileSync(join(fixture.root, '00_草稿', 'user-note.md'), 'utf-8')).toBe(
			'用户数据不得丢失\n',
		);
		expect(readFileSync(join(fixture.root, 'AGENTS.md'), 'utf-8')).not.toContain(
			'OLD AGENT CONTRACT',
		);
		const codex = readFileSync(join(fixture.root, '.codex', 'config.toml'), 'utf-8');
		expect(codex).toContain('command = "lifeos"');
		expect(codex).not.toContain('legacy-lifeos');
		expect(codex).not.toContain('shadow');
		expect(existsSync(join(fixture.root, '90_系统', '记忆', 'ContextPolicy.md'))).toBe(false);
		const profile = readFileSync(join(fixture.root, '90_系统', '记忆', 'UserProfile.md'), 'utf-8');
		expect(profile).toContain('<!-- BEGIN AUTO:global-rules -->');
		expect(profile).toContain('<!-- BEGIN AUTO:scoped-rules-index -->');
		expect(profile).not.toContain('<!-- BEGIN AUTO:rules -->');
	});

	it('映射缺失、条数不符或引用不存在项目时在建立 cutover 前零写入失败', async () => {
		rmSync(fixture.mapPath);
		await expect(upgrade([fixture.root, '--scope-map', fixture.mapPath])).rejects.toThrow(
			/缺少 V4 scope map/,
		);
		expect(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')).toBe(fixture.legacyYaml);
		expect(dbVersion(fixture.dbPath)).toBe(3);
		expect(existsSync(join(fixture.parent, '.lifeos-cutovers'))).toBe(false);

		writeFileSync(fixture.mapPath, `${JSON.stringify(scopeMap().slice(0, 1))}\n`, 'utf-8');
		await expect(upgrade([fixture.root, '--scope-map', fixture.mapPath])).rejects.toThrow(
			/条数 1 与旧记忆 2 不一致/,
		);

		writeFileSync(
			fixture.mapPath,
			`${JSON.stringify(scopeMap('missing-project'), null, 2)}\n`,
			'utf-8',
		);
		await expect(upgrade([fixture.root, '--scope-map', fixture.mapPath])).rejects.toThrow(
			/scope map 引用不存在的项目 id/,
		);
		expect(dbVersion(fixture.dbPath)).toBe(3);
	});

	it('事务迁移失败时恢复完整 V3 Vault，并留下 restored journal', async () => {
		writeFileSync(
			fixture.mapPath,
			`${JSON.stringify(scopeMap('gts-learning', '0'.repeat(64)), null, 2)}\n`,
			'utf-8',
		);
		await expect(upgrade([fixture.root, '--scope-map', fixture.mapPath])).rejects.toThrow(
			/内容哈希不匹配/,
		);

		expect(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')).toBe(fixture.legacyYaml);
		expect(readFileSync(join(fixture.root, 'AGENTS.md'), 'utf-8')).toBe('OLD AGENT CONTRACT\n');
		expect(readFileSync(join(fixture.root, '00_草稿', 'user-note.md'), 'utf-8')).toBe(
			'用户数据不得丢失\n',
		);
		expect(dbVersion(fixture.dbPath)).toBe(3);
		expect(existsSync(join(fixture.root, '90_系统', '记忆', 'runtime-receipt.json'))).toBe(false);
		const journals = findJournals(join(fixture.parent, '.lifeos-cutovers'));
		expect(journals).toHaveLength(1);
		expect(JSON.parse(readFileSync(journals[0] ?? '', 'utf-8'))).toMatchObject({
			state: 'restored',
			contract_version: 2,
			schema_version: 4,
		});
	});

	it('未知 AUTO marker、缺失项目 ID 和未知 Schema 均在预检阶段失败', async () => {
		writeFileSync(
			join(fixture.root, '90_系统', '记忆', 'UserProfile.md'),
			'<!-- BEGIN AUTO:legacy-shadow -->\n旧内容\n<!-- END AUTO:legacy-shadow -->\n',
			'utf-8',
		);
		await expect(upgrade([fixture.root, '--scope-map', fixture.mapPath])).rejects.toThrow(
			/未知 AUTO 区块/,
		);
		expect(dbVersion(fixture.dbPath)).toBe(3);

		writeFileSync(
			join(fixture.root, '90_系统', '记忆', 'UserProfile.md'),
			'# 无 AUTO 区块\n',
			'utf-8',
		);
		writeFileSync(join(fixture.root, '20_项目', 'GTS.md'), '---\ntype: project\n---\n', 'utf-8');
		await expect(upgrade([fixture.root, '--scope-map', fixture.mapPath])).rejects.toThrow(
			/项目缺少稳定 id/,
		);

		writeFileSync(
			join(fixture.root, '20_项目', 'GTS.md'),
			'---\ntype: project\nid: gts-learning\n---\n',
			'utf-8',
		);
		const db = new Database(fixture.dbPath);
		try {
			db.prepare('UPDATE schema_version SET version = 5').run();
		} finally {
			db.close();
		}
		await expect(upgrade([fixture.root, '--scope-map', fixture.mapPath])).rejects.toThrow(
			/不支持的数据库 Schema：5/,
		);
	});

	it('明确拒绝旧 --override 兼容模式和未初始化 Vault', async () => {
		await expect(
			upgrade([fixture.root, '--scope-map', fixture.mapPath, '--override']),
		).rejects.toThrow(/不再支持 --override/);
		expect(dbVersion(fixture.dbPath)).toBe(3);

		const empty = join(fixture.parent, 'empty');
		mkdirSync(empty);
		await expect(upgrade([empty])).rejects.toThrow(/No lifeos.yaml/);
	});
});
