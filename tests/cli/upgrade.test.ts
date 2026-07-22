import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import upgrade, { persistScopeMap, type ScopeMapPlan } from '../../src/cli/commands/upgrade.js';
import {
	advanceCutover,
	backupVault,
	createCutover,
	retainOnlyCutoverBundle,
} from '../../src/cli/utils/cutover.js';
import { VERSION } from '../../src/cli/utils/version.js';
import {
	acquireCutoverLock,
	bindCutoverLock,
	cutoverLockPath,
	cutoverRoot,
	releaseCutoverLock,
} from '../../src/cutover-lock.js';
import { validateRuntimeContract } from '../../src/runtime-contract.js';
import { MAX_GLOBAL_HARD_ITEM_PAYLOAD_BYTES } from '../../src/services/global-hard-safety.js';

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

function fileSha256(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function gitRepository(parent: string, name: string): string {
	const root = join(parent, name);
	mkdirSync(join(root, '.git'), { recursive: true });
	writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8');
	return realpathSync.native(root);
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
	writeFileSync(
		join(root, '20_项目', 'GTS_Doc.md'),
		'---\ntitle: GTS 项目文档\ntype: project-doc\n---\n项目辅助文档无需项目 id\n',
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

function exitedChildPid(): number {
	const child = spawnSync(process.execPath, ['-e', '']);
	if (!child.pid) throw new Error('测试无法取得已退出子进程 PID');
	return child.pid;
}

function findJournals(root: string): string[] {
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = join(root, entry.name);
		if (entry.isDirectory()) return findJournals(path);
		return entry.name === 'journal.json' ? [path] : [];
	});
}

function vaultJournals(vaultRoot: string): string[] {
	return findJournals(cutoverRoot(vaultRoot)).sort();
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
			backup_format: 'write-set-v1',
			package_sha256: receipt.package_sha256,
		});
		const runtimeResult = validateRuntimeContract({
			vaultRoot: fixture.root,
			runtimeVersion: VERSION,
		});
		expect(runtimeResult.ok).toBe(true);
		expect(vaultJournals(fixture.root)).toEqual([result.journalPath]);
		expect(existsSync((journal.backup_path as string) ?? '')).toBe(true);
		expect(existsSync(join(fixture.root, '90_系统', '记忆', 'migrations'))).toBe(false);
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

	it.skipIf(process.platform === 'win32')(
		'升级保留现有 Claude 相对符号链接，且不把未修改目录纳入写集',
		async () => {
			const agentsSkills = join(fixture.root, '.agents', 'skills');
			const claudeDir = join(fixture.root, '.claude');
			const claudeSkills = join(claudeDir, 'skills');
			mkdirSync(agentsSkills, { recursive: true });
			mkdirSync(claudeDir, { recursive: true });
			symlinkSync('../.agents/skills', claudeSkills);

			const result = await upgrade([fixture.root, '--scope-map', fixture.mapPath]);
			const journal = JSON.parse(readFileSync(result.journalPath, 'utf-8')) as {
				backup_path: string;
			};
			const manifest = JSON.parse(
				readFileSync(join(journal.backup_path, 'manifest.json'), 'utf-8'),
			) as { entries: Array<{ path: string }> };

			expect(readlinkSync(claudeSkills)).toBe('../.agents/skills');
			expect(manifest.entries.some((entry) => entry.path === '.claude/skills')).toBe(false);
			expect(dbVersion(fixture.dbPath)).toBe(4);
		},
	);

	it('备份期间 .git 与 .obsidian 波动不会阻断升级，也不会进入回滚写集', async () => {
		const gitHead = join(fixture.root, '.git', 'HEAD');
		const workspace = join(fixture.root, '.obsidian', 'workspace.json');
		const result = await upgrade([fixture.root, '--scope-map', fixture.mapPath], {
			hooks: {
				afterWriteSetSnapshot: () => {
					mkdirSync(dirname(gitHead), { recursive: true });
					mkdirSync(dirname(workspace), { recursive: true });
					writeFileSync(gitHead, 'ref: refs/heads/concurrent\n', 'utf-8');
					writeFileSync(workspace, '{"concurrent":true}\n', 'utf-8');
				},
			},
		});
		const journal = JSON.parse(readFileSync(result.journalPath, 'utf-8')) as {
			backup_path: string;
		};
		const manifest = JSON.parse(
			readFileSync(join(journal.backup_path, 'manifest.json'), 'utf-8'),
		) as { entries: Array<{ path: string }> };

		expect(dbVersion(fixture.dbPath)).toBe(4);
		expect(readFileSync(gitHead, 'utf-8')).toContain('concurrent');
		expect(readFileSync(workspace, 'utf-8')).toContain('concurrent');
		expect(manifest.entries.some((entry) => entry.path.startsWith('.git'))).toBe(false);
		expect(manifest.entries.some((entry) => entry.path.startsWith('.obsidian'))).toBe(false);
	});

	it('项目文件在备份后被并发编辑时拒绝升级，且不反向覆盖新内容', async () => {
		const projectPath = join(fixture.root, '20_项目', 'Concurrent.md');
		const initial = '---\ntitle: Concurrent\ntype: project\nstatus: active\n---\n并发前内容\n';
		const concurrent = `${initial}编辑器并发写入\n`;
		writeFileSync(projectPath, initial, 'utf-8');

		await expect(
			upgrade([fixture.root, '--scope-map', fixture.mapPath], {
				hooks: {
					afterBackupPrepared: () => writeFileSync(projectPath, concurrent, 'utf-8'),
				},
			}),
		).rejects.toThrow(/升级写集在切换前发生变化[\s\S]*Concurrent\.md/);

		expect(readFileSync(projectPath, 'utf-8')).toBe(concurrent);
		expect(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')).toBe(fixture.legacyYaml);
		expect(dbVersion(fixture.dbPath)).toBe(3);
		expect(vaultJournals(fixture.root)).toEqual([]);
		expect(existsSync(cutoverLockPath(fixture.root))).toBe(false);
	});

	it('通用写集在 prepared 后发生变化时零写入失败，并保留并发内容', async () => {
		const agentsPath = join(fixture.root, 'AGENTS.md');
		const concurrent = '编辑器在 prepared 后写入的新规则\n';

		await expect(
			upgrade([fixture.root, '--scope-map', fixture.mapPath], {
				hooks: {
					afterBackupPrepared: () => writeFileSync(agentsPath, concurrent, 'utf-8'),
				},
			}),
		).rejects.toThrow(/升级写集在切换前发生变化[\s\S]*AGENTS\.md/);

		expect(readFileSync(agentsPath, 'utf-8')).toBe(concurrent);
		expect(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')).toBe(fixture.legacyYaml);
		expect(dbVersion(fixture.dbPath)).toBe(3);
		expect(vaultJournals(fixture.root)).toEqual([]);
		expect(existsSync(cutoverLockPath(fixture.root))).toBe(false);
	});

	it.skipIf(process.platform === 'win32')('备份轮换拒绝跟随伪造的 bundle 符号链接', async () => {
		const result = await upgrade([fixture.root, '--scope-map', fixture.mapPath]);
		const journal = JSON.parse(readFileSync(result.journalPath, 'utf-8')) as {
			cutover_id: string;
		};
		const outside = join(fixture.parent, 'outside-cutover-data');
		mkdirSync(outside);
		writeFileSync(join(outside, 'must-survive.txt'), '不得删除\n', 'utf-8');
		const link = join(cutoverRoot(fixture.root), 'malicious-link');
		symlinkSync(outside, link, 'dir');

		expect(() => retainOnlyCutoverBundle(fixture.root, journal.cutover_id)).toThrow(
			/cutover bundle 不是安全目录/,
		);
		expect(readFileSync(join(outside, 'must-survive.txt'), 'utf-8')).toBe('不得删除\n');
		rmSync(link);
	});

	it('scope map 缺失时自动生成，高置信映射无需人工准备即可继续升级', async () => {
		rmSync(fixture.mapPath);
		const result = await upgrade([fixture.root, '--scope-map', fixture.mapPath]);

		expect(result.migratedItems).toBe(2);
		expect(dbVersion(fixture.dbPath)).toBe(4);
		const generated = JSON.parse(readFileSync(fixture.mapPath, 'utf-8')) as {
			summary: { total: number; confirmed: number; reviewRequired: number };
			entries: Array<{ confirmed: boolean; suggestionReason: string; contentPreview: string }>;
		};
		expect(generated.summary).toEqual({ total: 2, confirmed: 2, reviewRequired: 0 });
		expect(generated.entries).toHaveLength(2);
		expect(generated.entries.every((entry) => entry.confirmed)).toBe(true);
		expect(generated.entries.every((entry) => entry.suggestionReason && entry.contentPreview)).toBe(
			true,
		);
	});

	it('不传 --scope-map 时自动消费高置信映射，并在成功后清理迁移目录', async () => {
		const defaultMapPath = join(fixture.root, '90_系统', '记忆', 'migrations', 'v4-scope-map.json');
		expect(existsSync(defaultMapPath)).toBe(false);

		const result = await upgrade([fixture.root]);

		expect(result.migratedItems).toBe(2);
		expect(dbVersion(fixture.dbPath)).toBe(4);
		expect(existsSync(dirname(defaultMapPath))).toBe(false);
	});

	it('默认 scope map 在 prepared 后被并发创建时不会被回滚删除', async () => {
		const defaultMapPath = join(fixture.root, '90_系统', '记忆', 'migrations', 'v4-scope-map.json');
		const concurrent = '{"createdBy":"editor"}\n';

		await expect(
			upgrade([fixture.root], {
				hooks: {
					afterBackupPrepared: () => {
						mkdirSync(dirname(defaultMapPath), { recursive: true });
						writeFileSync(defaultMapPath, concurrent, 'utf-8');
					},
				},
			}),
		).rejects.toThrow(/升级写集在切换前发生变化[\s\S]*migrations/);

		expect(readFileSync(defaultMapPath, 'utf-8')).toBe(concurrent);
		expect(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')).toBe(fixture.legacyYaml);
		expect(dbVersion(fixture.dbPath)).toBe(3);
		expect(vaultJournals(fixture.root)).toEqual([]);
	});

	it('scope map 发布后的落盘故障会按已写入处理并完整回滚', async () => {
		const defaultMapPath = join(fixture.root, '90_系统', '记忆', 'migrations', 'v4-scope-map.json');

		await expect(
			upgrade([fixture.root], {
				hooks: {
					afterScopeMapPublished: () => {
						throw new Error('模拟 scope map 发布后的落盘故障');
					},
				},
			}),
		).rejects.toThrow(/模拟 scope map 发布后的落盘故障/);

		expect(existsSync(defaultMapPath)).toBe(false);
		expect(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')).toBe(fixture.legacyYaml);
		expect(dbVersion(fixture.dbPath)).toBe(3);
		const journals = vaultJournals(fixture.root);
		expect(journals).toHaveLength(1);
		expect(JSON.parse(readFileSync(journals[0] ?? '', 'utf-8'))).toMatchObject({
			state: 'restored',
		});
		expect(existsSync(cutoverLockPath(fixture.root))).toBe(false);
	});

	it('成功升级清理整个 migrations 工作区，但不删除外部 scope map，回滚可恢复原目录', async () => {
		const migrationsDir = join(fixture.root, '90_系统', '记忆', 'migrations');
		const sentinel = join(migrationsDir, '旧迁移', '保留到回滚.txt');
		mkdirSync(dirname(sentinel), { recursive: true });
		writeFileSync(sentinel, '升级成功后应清理，回滚后应恢复\n', 'utf-8');
		const externalMapBefore = readFileSync(fixture.mapPath, 'utf-8');

		const result = await upgrade([fixture.root, '--scope-map', fixture.mapPath]);

		expect(existsSync(migrationsDir)).toBe(false);
		expect(readFileSync(fixture.mapPath, 'utf-8')).toBe(externalMapBefore);

		await upgrade([fixture.root, '--restore', result.journalPath]);
		expect(readFileSync(sentinel, 'utf-8')).toBe('升级成功后应清理，回滚后应恢复\n');
		expect(readFileSync(fixture.mapPath, 'utf-8')).toBe(externalMapBefore);
	});

	it('一条命令补项目 ID、写回 Markdown、发现实际仓库并重建项目索引', async () => {
		const gtsPath = join(fixture.root, '20_项目', 'GTS.md');
		const visualPath = join(fixture.root, '20_项目', 'Visual-Group-Theory学习.md');
		const originalGts =
			'---\r\ntitle: GTS\r\ntype: project\r\nstatus: active # 保留注释\r\n---\r\n用户项目内容\r\n';
		const originalVisual =
			'---\r\ntitle: Visual-Group-Theory学习\r\ntype: project\r\nstatus: active\r\n---\r\n第二个项目正文\r\n';
		writeFileSync(gtsPath, originalGts, 'utf-8');
		writeFileSync(visualPath, originalVisual, 'utf-8');
		chmodSync(visualPath, 0o640);
		const originalMode = statSync(visualPath).mode & 0o777;
		const lifeosRoot = gitRepository(fixture.parent, 'lifeos');
		const learningAppRoot = gitRepository(fixture.parent, 'LearningApp');
		const codexRoot = gitRepository(fixture.parent, 'codex');
		const db = new Database(fixture.dbPath);
		try {
			const insert = db.prepare(`
				INSERT INTO memory_items(
					slot_key, content, source, related_files, manual_flag, status, updated_at, expires_at
				) VALUES (?, ?, 'preference', ?, 0, 'active', ?, NULL)
			`);
			insert.run(
				'tool:lifeos-source-path',
				`LifeOS 源码路径固定为 ${lifeosRoot}`,
				JSON.stringify([lifeosRoot]),
				'2026-07-03T00:00:00.000Z',
			);
			insert.run(
				'workflow:lifeos-source-dir',
				`后续源码修改必须在 ${lifeosRoot} 中完成`,
				'[]',
				'2026-07-04T00:00:00.000Z',
			);
			insert.run(
				'tool:learningapp-source-path',
				`LearningApp 源码路径固定为 ${learningAppRoot}`,
				'[]',
				'2026-07-05T00:00:00.000Z',
			);
			insert.run(
				'tool:codex-source-path',
				`Codex 源码路径固定为 ${codexRoot}`,
				'[]',
				'2026-07-06T00:00:00.000Z',
			);
		} finally {
			db.close();
		}

		const result = await upgrade([fixture.root]);

		const upgradedGts = readFileSync(gtsPath, 'utf-8');
		const upgradedVisual = readFileSync(visualPath, 'utf-8');
		expect(upgradedGts).toContain('\r\nid: "gts"\r\n---\r\n用户项目内容\r\n');
		expect(upgradedGts).toContain('status: active # 保留注释');
		expect(upgradedVisual).toContain('\r\nid: "visual-group-theory"\r\n---\r\n第二个项目正文\r\n');
		expect(upgradedVisual).not.toMatch(/(?<!\r)\n/);
		expect(statSync(visualPath).mode & 0o777).toBe(originalMode);
		expect(result.updated).toEqual(
			expect.arrayContaining(['20_项目/GTS.md', '20_项目/Visual-Group-Theory学习.md']),
		);

		const config = parseYaml(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')) as {
			memory: { repository_bindings: Record<string, string[]> };
		};
		expect(config.memory.repository_bindings).toEqual({
			learningapp: [learningAppRoot],
			lifeos: [lifeosRoot],
		});

		const migrated = new Database(fixture.dbPath, { readonly: true, fileMustExist: true });
		try {
			expect(
				migrated
					.prepare(`
						SELECT slot_key, scope_type, scope_key
						FROM memory_items
						WHERE slot_key IN (
							'project:gts-core', 'tool:lifeos-source-path',
							'workflow:lifeos-source-dir', 'tool:learningapp-source-path',
							'tool:codex-source-path'
						)
						ORDER BY slot_key
					`)
					.all(),
			).toEqual([
				{ slot_key: 'project:gts-core', scope_type: 'project', scope_key: 'gts' },
				{ slot_key: 'tool:codex-source-path', scope_type: 'tool', scope_key: 'codex' },
				{
					slot_key: 'tool:learningapp-source-path',
					scope_type: 'repository',
					scope_key: 'learningapp',
				},
				{
					slot_key: 'tool:lifeos-source-path',
					scope_type: 'repository',
					scope_key: 'lifeos',
				},
				{
					slot_key: 'workflow:lifeos-source-dir',
					scope_type: 'repository',
					scope_key: 'lifeos',
				},
			]);
			expect(
				migrated
					.prepare(
						"SELECT file_path, entity_id FROM vault_index WHERE type = 'project' ORDER BY file_path",
					)
					.all(),
			).toEqual([
				{ file_path: '20_项目/GTS.md', entity_id: 'gts' },
				{
					file_path: '20_项目/Visual-Group-Theory学习.md',
					entity_id: 'visual-group-theory',
				},
			]);
		} finally {
			migrated.close();
		}

		expect(existsSync(join(fixture.root, '90_系统', '记忆', 'migrations'))).toBe(false);

		await upgrade([fixture.root, '--restore', result.journalPath]);
		expect(readFileSync(gtsPath, 'utf-8')).toBe(originalGts);
		expect(readFileSync(visualPath, 'utf-8')).toBe(originalVisual);
		expect(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')).toBe(fixture.legacyYaml);
	});

	it('缺少旧数据库时在生成 scope map 或建立 cutover 前零写入失败', async () => {
		const yamlPath = join(fixture.root, 'lifeos.yaml');
		const agentsPath = join(fixture.root, 'AGENTS.md');
		const defaultMapPath = join(fixture.root, '90_系统', '记忆', 'migrations', 'v4-scope-map.json');
		const beforeYaml = readFileSync(yamlPath, 'utf-8');
		const beforeAgents = readFileSync(agentsPath, 'utf-8');
		rmSync(fixture.dbPath);

		await expect(upgrade([fixture.root])).rejects.toThrow(/缺少旧记忆数据库/);

		expect(readFileSync(yamlPath, 'utf-8')).toBe(beforeYaml);
		expect(readFileSync(agentsPath, 'utf-8')).toBe(beforeAgents);
		expect(existsSync(fixture.dbPath)).toBe(false);
		expect(existsSync(defaultMapPath)).toBe(false);
		expect(existsSync(cutoverLockPath(fixture.root))).toBe(false);
		expect(findJournals(join(fixture.parent, '.lifeos-cutovers'))).toEqual([]);
	});

	it('仓库证据有歧义时只生成审阅草案，不写项目 ID、配置或 cutover', async () => {
		const yamlPath = join(fixture.root, 'lifeos.yaml');
		const projectPath = join(fixture.root, '20_项目', 'GTS.md');
		const originalProject = '---\ntitle: GTS\ntype: project\nstatus: active\n---\n原始正文\n';
		writeFileSync(projectPath, originalProject, 'utf-8');
		const firstRoot = gitRepository(join(fixture.parent, 'one'), 'lifeos');
		const secondRoot = gitRepository(join(fixture.parent, 'two'), 'lifeos-alt');
		const db = new Database(fixture.dbPath);
		try {
			db.prepare(`
				INSERT INTO memory_items(
					slot_key, content, source, related_files, manual_flag, status, updated_at, expires_at
				) VALUES (?, ?, 'preference', '[]', 0, 'active', ?, NULL)
			`).run(
				'tool:lifeos-source-path',
				`LifeOS 源码同时指向 ${firstRoot} 和 ${secondRoot}`,
				'2026-07-03T00:00:00.000Z',
			);
		} finally {
			db.close();
		}
		const defaultMapPath = join(fixture.root, '90_系统', '记忆', 'migrations', 'v4-scope-map.json');

		await expect(upgrade([fixture.root])).rejects.toThrow(
			/repository_bindings 自动配置存在歧义[\s\S]*多个 Git 仓库/,
		);

		expect(readFileSync(projectPath, 'utf-8')).toBe(originalProject);
		expect(readFileSync(yamlPath, 'utf-8')).toBe(fixture.legacyYaml);
		expect(dbVersion(fixture.dbPath)).toBe(3);
		expect(existsSync(defaultMapPath)).toBe(true);
		expect(existsSync(cutoverLockPath(fixture.root))).toBe(false);
		expect(findJournals(join(fixture.parent, '.lifeos-cutovers'))).toEqual([]);
	});

	it('显式 scope map 条数不符或引用不存在项目时在建立 cutover 前零写入失败', async () => {
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
		expect(existsSync(cutoverLockPath(fixture.root))).toBe(false);
		expect(findJournals(join(fixture.parent, '.lifeos-cutovers'))).toEqual([]);
	});

	it('file scope 拒绝 ../../ 路径穿越，且不会修改 Vault 外文件', async () => {
		const outsidePath = join(fixture.parent, 'outside.md');
		writeFileSync(outsidePath, '外部文件不得修改\n', 'utf-8');
		const malicious = scopeMap();
		malicious[1] = {
			...malicious[1],
			scope: { type: 'file', key: '../../outside.md' },
		};
		writeFileSync(fixture.mapPath, `${JSON.stringify(malicious, null, 2)}\n`, 'utf-8');

		await expect(upgrade([fixture.root, '--scope-map', fixture.mapPath])).rejects.toThrow(
			/file scope 必须是安全的 Vault 相对路径或唯一 entity_id/,
		);

		expect(readFileSync(outsidePath, 'utf-8')).toBe('外部文件不得修改\n');
		expect(dbVersion(fixture.dbPath)).toBe(3);
		expect(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')).toBe(fixture.legacyYaml);
		expect(existsSync(cutoverLockPath(fixture.root))).toBe(false);
		expect(findJournals(join(fixture.parent, '.lifeos-cutovers'))).toEqual([]);
	});

	it('拒绝被篡改格式版本的自动生成 scope map', async () => {
		const db = new Database(fixture.dbPath);
		try {
			db.prepare(`
				INSERT INTO memory_items(
					slot_key, content, source, related_files, manual_flag, status, updated_at, expires_at
				) VALUES (?, ?, 'preference', '[]', 0, 'active', ?, NULL)
			`).run('misc:opaque', '无法自动判断归属的旧记忆', '2026-07-03T00:00:00.000Z');
		} finally {
			db.close();
		}
		const defaultMapPath = join(fixture.root, '90_系统', '记忆', 'migrations', 'v4-scope-map.json');
		await expect(upgrade([fixture.root])).rejects.toThrow(/尚无可用作用域/);
		const generated = JSON.parse(readFileSync(defaultMapPath, 'utf-8')) as Record<string, unknown>;
		generated.formatVersion = 999;
		writeFileSync(defaultMapPath, `${JSON.stringify(generated, null, 2)}\n`, 'utf-8');

		await expect(upgrade([fixture.root, '--accept-scope-map'])).rejects.toThrow(
			/scope map 对象格式或版本无效/,
		);
		expect(dbVersion(fixture.dbPath)).toBe(3);
		expect(existsSync(cutoverLockPath(fixture.root))).toBe(false);
		expect(findJournals(join(fixture.parent, '.lifeos-cutovers'))).toEqual([]);
	});

	it.skipIf(process.platform === 'win32')(
		'memory 目录为符号链接时拒绝升级且不写入外部目标',
		async () => {
			const memoryDir = join(fixture.root, '90_系统', '记忆');
			const outsideMemory = join(fixture.parent, 'outside-memory');
			const outsideSentinel = join(outsideMemory, 'sentinel.txt');
			mkdirSync(outsideMemory);
			writeFileSync(outsideSentinel, '外部目录不得修改\n', 'utf-8');
			rmSync(memoryDir, { recursive: true, force: true });
			symlinkSync(outsideMemory, memoryDir, 'dir');

			await expect(upgrade([fixture.root, '--scope-map', fixture.mapPath])).rejects.toThrow(
				/符号链接/,
			);

			expect(readFileSync(outsideSentinel, 'utf-8')).toBe('外部目录不得修改\n');
			expect(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')).toBe(fixture.legacyYaml);
			expect(existsSync(cutoverLockPath(fixture.root))).toBe(false);
			expect(findJournals(join(fixture.parent, '.lifeos-cutovers'))).toEqual([]);
		},
	);

	it.skipIf(process.platform === 'win32')(
		'memory.db 为符号链接时拒绝升级且不写入外部数据库',
		async () => {
			const outsideDb = join(fixture.parent, 'outside-memory.db');
			renameSync(fixture.dbPath, outsideDb);
			const beforeHash = fileSha256(outsideDb);
			symlinkSync(outsideDb, fixture.dbPath, 'file');

			await expect(upgrade([fixture.root, '--scope-map', fixture.mapPath])).rejects.toThrow(
				/符号链接/,
			);

			expect(fileSha256(outsideDb)).toBe(beforeHash);
			expect(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')).toBe(fixture.legacyYaml);
			expect(existsSync(cutoverLockPath(fixture.root))).toBe(false);
			expect(findJournals(join(fixture.parent, '.lifeos-cutovers'))).toEqual([]);
		},
	);

	it('未知映射自动生成审阅草案，禁止占位 scope，人工补齐后可复跑', async () => {
		const db = new Database(fixture.dbPath);
		try {
			db.prepare(`
				INSERT INTO memory_items(
					slot_key, content, source, related_files, manual_flag, status, updated_at, expires_at
				) VALUES (?, ?, 'preference', '[]', 0, 'active', ?, NULL)
			`).run('misc:opaque', '无法自动判断归属的旧记忆', '2026-07-03T00:00:00.000Z');
		} finally {
			db.close();
		}
		rmSync(fixture.mapPath);

		await expect(upgrade([fixture.root, '--scope-map', fixture.mapPath])).rejects.toThrow(
			/尚无可用作用域[\s\S]*选择 scopeCandidates 或填写真实 scope/,
		);
		expect(dbVersion(fixture.dbPath)).toBe(3);
		expect(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')).toBe(fixture.legacyYaml);
		expect(existsSync(cutoverLockPath(fixture.root))).toBe(false);
		expect(findJournals(join(fixture.parent, '.lifeos-cutovers'))).toEqual([]);
		const generated = JSON.parse(readFileSync(fixture.mapPath, 'utf-8')) as {
			summary: { reviewRequired: number };
			entries: Array<{
				legacyIdentity: string;
				confirmed: boolean;
				scope: { type: string; key: string };
			}>;
		};
		expect(generated.summary.reviewRequired).toBe(1);
		const unknown = generated.entries.find((entry) => entry.legacyIdentity === 'slot:misc:opaque');
		expect(unknown).toMatchObject({
			confirmed: false,
			scope: { type: 'file', key: '__REVIEW_REQUIRED__' },
		});
		await expect(
			upgrade([fixture.root, '--scope-map', fixture.mapPath, '--accept-scope-map']),
		).rejects.toThrow(/尚无可用作用域/);

		if (!unknown) throw new Error('测试 scope map 缺少未知条目');
		unknown.scope = { type: 'project', key: 'gts-learning' };
		unknown.confirmed = true;
		writeFileSync(fixture.mapPath, `${JSON.stringify(generated, null, 2)}\n`, 'utf-8');
		const result = await upgrade([fixture.root, '--scope-map', fixture.mapPath]);
		expect(result.migratedItems).toBe(3);
		expect(dbVersion(fixture.dbPath)).toBe(4);
	});

	it('显式 map 有有效歧义候选时，可在内存接受且不覆盖外部审阅文件', async () => {
		writeFileSync(
			join(fixture.root, '20_项目', 'GTS_Writing.md'),
			'---\ntitle: GTS\ntype: project\nid: gts-writing\nstatus: active\n---\n另一个 GTS 项目\n',
			'utf-8',
		);
		const db = new Database(fixture.dbPath);
		try {
			db.prepare("UPDATE memory_items SET related_files = '[]' WHERE slot_key = ?").run(
				'project:gts-core',
			);
		} finally {
			db.close();
		}
		rmSync(fixture.mapPath);

		await expect(upgrade([fixture.root, '--scope-map', fixture.mapPath])).rejects.toThrow(
			/建议待确认/,
		);
		const result = await upgrade([
			fixture.root,
			'--scope-map',
			fixture.mapPath,
			'--accept-scope-map',
		]);
		expect(result.migratedItems).toBe(2);
		const reviewed = JSON.parse(readFileSync(fixture.mapPath, 'utf-8')) as {
			reviewedBy?: string;
			summary: { confirmed: number; reviewRequired: number };
		};
		expect(reviewed.reviewedBy).toBeUndefined();
		expect(reviewed.summary).toEqual({ total: 2, confirmed: 1, reviewRequired: 1 });
	});

	it('已有显式 map 只校验不覆盖，预检后外部变更会阻断持久化', () => {
		const original = readFileSync(fixture.mapPath, 'utf-8');
		const plan: ScopeMapPlan = {
			path: fixture.mapPath,
			entries: scopeMap(),
			writeValue: {
				format: 'lifeos-v4-scope-map',
				entries: scopeMap().map((entry) => ({ ...entry, confirmed: true })),
			},
			writeMode: 'replace',
			originalHash: sha256(original),
		};

		persistScopeMap(plan, true);
		expect(readFileSync(fixture.mapPath, 'utf-8')).toBe(original);

		const concurrent = `${original.trimEnd()}\n\n`;
		writeFileSync(fixture.mapPath, concurrent, 'utf-8');
		expect(() => persistScopeMap(plan, true)).toThrow(/scope map 在预检后发生变化/);
		expect(readFileSync(fixture.mapPath, 'utf-8')).toBe(concurrent);
	});

	it('已有默认 map 在 CAS 校验后才执行计划写入，并发变更不被覆盖', () => {
		const defaultMapPath = join(fixture.root, '90_系统', '记忆', 'migrations', 'v4-scope-map.json');
		mkdirSync(join(defaultMapPath, '..'), { recursive: true });
		const originalValue = { format: 'old', entries: scopeMap() };
		const replacementValue = { format: 'new', entries: scopeMap() };
		const original = `${JSON.stringify(originalValue, null, 2)}\n`;
		writeFileSync(defaultMapPath, original, 'utf-8');
		const plan: ScopeMapPlan = {
			path: defaultMapPath,
			entries: scopeMap(),
			writeValue: replacementValue,
			writeMode: 'replace',
			originalHash: sha256(original),
		};

		persistScopeMap(plan, false);
		expect(JSON.parse(readFileSync(defaultMapPath, 'utf-8'))).toEqual(replacementValue);

		writeFileSync(defaultMapPath, original, 'utf-8');
		const concurrent = `${original.trimEnd()}\n \n`;
		writeFileSync(defaultMapPath, concurrent, 'utf-8');
		expect(() => persistScopeMap(plan, false)).toThrow(/scope map 在预检后发生变化/);
		expect(readFileSync(defaultMapPath, 'utf-8')).toBe(concurrent);
	});

	it('未人工改动的默认 map 在项目上下文变化后自动刷新并在成功后清理', async () => {
		const secondProject = join(fixture.root, '20_项目', 'GTS_Writing.md');
		writeFileSync(
			secondProject,
			'---\ntitle: GTS\ntype: project\nid: gts-writing\nstatus: active\n---\n另一个 GTS 项目\n',
			'utf-8',
		);
		const db = new Database(fixture.dbPath);
		try {
			db.prepare("UPDATE memory_items SET related_files = '[]' WHERE slot_key = ?").run(
				'project:gts-core',
			);
		} finally {
			db.close();
		}
		const defaultMapPath = join(fixture.root, '90_系统', '记忆', 'migrations', 'v4-scope-map.json');

		await expect(upgrade([fixture.root])).rejects.toThrow(/建议待确认/);
		const before = JSON.parse(readFileSync(defaultMapPath, 'utf-8')) as {
			contextFingerprint: string;
			summary: { reviewRequired: number };
		};
		expect(before.summary.reviewRequired).toBe(1);
		rmSync(secondProject);

		await upgrade([fixture.root]);
		expect(before.contextFingerprint).toMatch(/^[a-f0-9]{64}$/);
		expect(existsSync(dirname(defaultMapPath))).toBe(false);
		expect(dbVersion(fixture.dbPath)).toBe(4);
	});

	it('人工编辑过的默认 map 在上下文变化后受保护，不被自动覆盖', async () => {
		const secondProject = join(fixture.root, '20_项目', 'GTS_Writing.md');
		writeFileSync(
			secondProject,
			'---\ntitle: GTS\ntype: project\nid: gts-writing\nstatus: active\n---\n另一个 GTS 项目\n',
			'utf-8',
		);
		const db = new Database(fixture.dbPath);
		try {
			db.prepare("UPDATE memory_items SET related_files = '[]' WHERE slot_key = ?").run(
				'project:gts-core',
			);
		} finally {
			db.close();
		}
		const defaultMapPath = join(fixture.root, '90_系统', '记忆', 'migrations', 'v4-scope-map.json');
		await expect(upgrade([fixture.root])).rejects.toThrow(/建议待确认/);
		const edited = JSON.parse(readFileSync(defaultMapPath, 'utf-8')) as {
			entries: Array<{ legacyIdentity: string; suggestionReason: string }>;
		};
		const projectEntry = edited.entries.find(
			(entry) => entry.legacyIdentity === 'slot:project:gts-core',
		);
		if (!projectEntry) throw new Error('测试缺少项目 scope map 条目');
		projectEntry.suggestionReason = `${projectEntry.suggestionReason}；人工备注`;
		writeFileSync(defaultMapPath, `${JSON.stringify(edited, null, 2)}\n`, 'utf-8');
		const editedBytes = readFileSync(defaultMapPath, 'utf-8');
		rmSync(secondProject);

		await expect(upgrade([fixture.root])).rejects.toThrow(/生成上下文已变化[\s\S]*人工修改/);
		expect(readFileSync(defaultMapPath, 'utf-8')).toBe(editedBytes);
		expect(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')).toBe(fixture.legacyYaml);
		expect(dbVersion(fixture.dbPath)).toBe(3);
		expect(findJournals(join(fixture.parent, '.lifeos-cutovers'))).toEqual([]);
	});

	it('SQLite 短暂写锁会有限重试，释放后继续完成升级', async () => {
		const lockScript = `
const Database = require('better-sqlite3');
const db = new Database(process.argv[1]);
db.pragma('busy_timeout = 0');
db.exec('BEGIN IMMEDIATE');
process.stdout.write('locked\\n');
setTimeout(() => {
	db.exec('ROLLBACK');
	db.close();
}, 350);
`;
		const child = spawn(process.execPath, ['-e', lockScript, fixture.dbPath], {
			cwd: process.cwd(),
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stderr = '';
		child.stderr.setEncoding('utf-8');
		child.stderr.on('data', (chunk: string) => {
			stderr += chunk;
		});
		await new Promise<void>((resolvePromise, rejectPromise) => {
			let stdout = '';
			child.stdout.setEncoding('utf-8');
			child.stdout.on('data', (chunk: string) => {
				stdout += chunk;
				if (stdout.includes('locked\n')) resolvePromise();
			});
			child.once('error', rejectPromise);
			child.once('exit', (code) => {
				if (!stdout.includes('locked\n')) {
					rejectPromise(new Error(`SQLite 持锁子进程提前退出（${code}）：${stderr}`));
				}
			});
		});

		let retries = 0;
		try {
			const result = await upgrade([fixture.root, '--scope-map', fixture.mapPath], {
				sqliteBusyTimeoutMs: 10,
				retryDelaysMs: [20, 40, 80, 160, 320],
				hooks: {
					onSqliteRetry: () => {
						retries += 1;
					},
				},
			});
			expect(result.migratedItems).toBe(2);
		} finally {
			if (child.exitCode === null && child.signalCode === null) child.kill();
			await new Promise<void>((resolvePromise) => {
				if (child.exitCode !== null || child.signalCode !== null) resolvePromise();
				else child.once('exit', () => resolvePromise());
			});
		}

		expect(retries).toBeGreaterThan(0);
		expect(dbVersion(fixture.dbPath)).toBe(4);
	});

	it('SQLite 在线快照包含尚未 checkpoint 的 WAL 提交', async () => {
		const keeper = new Database(fixture.dbPath);
		let keeperOpen = true;
		try {
			keeper.pragma('journal_mode = WAL');
			keeper.pragma('wal_autocheckpoint = 0');
			keeper.exec(`
				CREATE TABLE wal_sentinel(value TEXT NOT NULL);
				INSERT INTO wal_sentinel(value) VALUES ('只存在于 WAL 的提交');
			`);
			expect(existsSync(`${fixture.dbPath}-wal`)).toBe(true);
			expect(statSync(`${fixture.dbPath}-wal`).size).toBeGreaterThan(0);

			const result = await upgrade([fixture.root, '--scope-map', fixture.mapPath], {
				hooks: {
					afterBackupPrepared: () => {
						keeper.close();
						keeperOpen = false;
					},
				},
			});
			await upgrade([fixture.root, '--restore', result.journalPath]);

			const restored = new Database(fixture.dbPath, { readonly: true, fileMustExist: true });
			try {
				expect(restored.prepare('SELECT value FROM wal_sentinel').get()).toEqual({
					value: '只存在于 WAL 的提交',
				});
				expect(restored.pragma('quick_check')).toEqual([{ quick_check: 'ok' }]);
			} finally {
				restored.close();
			}
			expect(dbVersion(fixture.dbPath)).toBe(3);
		} finally {
			if (keeperOpen) keeper.close();
		}
	});

	it('现有 MCP JSON 损坏时拒绝覆盖，并原样恢复已修改的其他客户端配置', async () => {
		const claudePath = join(fixture.root, '.mcp.json');
		const codexPath = join(fixture.root, '.codex', 'config.toml');
		const opencodePath = join(fixture.root, 'opencode.json');
		const projectPath = join(fixture.root, '20_项目', 'GTS.md');
		const originalProject =
			'---\r\ntitle: GTS\r\ntype: project\r\nstatus: active\r\n---\r\n失败时必须恢复\r\n';
		const originalClaude = '{"mcpServers":{"other":{"command":"other"}}}\n';
		const originalCodex = '[mcp_servers.other]\ncommand = "other"\n';
		const malformedOpencode = '{"mcp":\n';
		mkdirSync(join(fixture.root, '.codex'), { recursive: true });
		writeFileSync(claudePath, originalClaude, 'utf-8');
		writeFileSync(codexPath, originalCodex, 'utf-8');
		writeFileSync(opencodePath, malformedOpencode, 'utf-8');
		writeFileSync(projectPath, originalProject, 'utf-8');
		writeFileSync(fixture.mapPath, `${JSON.stringify(scopeMap('gts'), null, 2)}\n`, 'utf-8');
		mkdirSync(join(fixture.root, '.agents', 'skills'), { recursive: true });

		const customSkill = join(fixture.root, '.agents', 'skills', 'custom', 'SKILL.md');
		const userNote = join(fixture.root, '00_草稿', 'user-note.md');
		await expect(
			upgrade([fixture.root, '--scope-map', fixture.mapPath], {
				hooks: {
					afterBackupPrepared: () => {
						mkdirSync(dirname(customSkill), { recursive: true });
						writeFileSync(customSkill, '并发创建的用户 Skill\n', 'utf-8');
						writeFileSync(userNote, '升级期间继续编辑的用户笔记\n', 'utf-8');
					},
				},
			}),
		).rejects.toThrow(/现有 JSON 配置无法解析，拒绝覆盖/);

		expect(readFileSync(claudePath, 'utf-8')).toBe(originalClaude);
		expect(readFileSync(codexPath, 'utf-8')).toBe(originalCodex);
		expect(readFileSync(opencodePath, 'utf-8')).toBe(malformedOpencode);
		expect(readFileSync(projectPath, 'utf-8')).toBe(originalProject);
		expect(readFileSync(customSkill, 'utf-8')).toBe('并发创建的用户 Skill\n');
		expect(readFileSync(userNote, 'utf-8')).toBe('升级期间继续编辑的用户笔记\n');
		expect(readFileSync(join(fixture.root, 'AGENTS.md'), 'utf-8')).toBe('OLD AGENT CONTRACT\n');
		expect(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')).toBe(fixture.legacyYaml);
		expect(dbVersion(fixture.dbPath)).toBe(3);
		const journals = findJournals(join(fixture.parent, '.lifeos-cutovers'));
		expect(journals).toHaveLength(1);
		expect(JSON.parse(readFileSync(journals[0] ?? '', 'utf-8'))).toMatchObject({
			state: 'restored',
		});
		expect(existsSync(cutoverLockPath(fixture.root))).toBe(false);
	});

	it('失败回滚会恢复旧 managed_assets 中被整包升级删除的退役文件', async () => {
		const obsoleteRelative = 'legacy-assets/Obsolete.md';
		const obsoletePath = join(fixture.root, obsoleteRelative);
		const obsoleteContent = '仍属于旧托管清单的退役资产\n';
		mkdirSync(dirname(obsoletePath), { recursive: true });
		writeFileSync(obsoletePath, obsoleteContent, 'utf-8');
		const yamlWithManagedAsset = `${fixture.legacyYaml}managed_assets:\n  ${obsoleteRelative}:\n    version: 1.8.3\n    sha256: ${sha256(obsoleteContent)}\n  00_草稿:\n    version: 1.8.3\n    sha256: ${'a'.repeat(64)}\n`;
		writeFileSync(join(fixture.root, 'lifeos.yaml'), yamlWithManagedAsset, 'utf-8');
		writeFileSync(join(fixture.root, 'opencode.json'), '{"mcp":\n', 'utf-8');
		const userNote = join(fixture.root, '00_草稿', 'user-note.md');

		await expect(
			upgrade([fixture.root, '--scope-map', fixture.mapPath], {
				hooks: {
					afterBackupPrepared: () =>
						writeFileSync(userNote, '目录型旧清单不得扩大回滚范围\n', 'utf-8'),
				},
			}),
		).rejects.toThrow(/现有 JSON 配置无法解析，拒绝覆盖/);

		expect(readFileSync(obsoletePath, 'utf-8')).toBe(obsoleteContent);
		expect(readFileSync(userNote, 'utf-8')).toBe('目录型旧清单不得扩大回滚范围\n');
		expect(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')).toBe(yamlWithManagedAsset);
		expect(dbVersion(fixture.dbPath)).toBe(3);
		const journalPath = vaultJournals(fixture.root)[0];
		if (!journalPath) throw new Error('测试缺少 restored journal');
		const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as { backup_path: string };
		const manifest = JSON.parse(
			readFileSync(join(journal.backup_path, 'manifest.json'), 'utf-8'),
		) as { entries: Array<{ path: string; strategy: string }> };
		expect(manifest.entries).toContainEqual({
			path: '00_草稿',
			strategy: 'directory-presence',
			originalKind: 'directory',
			sourceFingerprint: 'directory',
		});
	});

	it('事务迁移失败时恢复 V3 升级写集，并留下 restored journal', async () => {
		if (process.platform !== 'win32') chmodSync(fixture.dbPath, 0o600);
		const invalidMap = scopeMap();
		invalidMap[1] = { ...invalidMap[1], status: 'archived' };
		writeFileSync(fixture.mapPath, `${JSON.stringify(invalidMap, null, 2)}\n`, 'utf-8');
		await expect(upgrade([fixture.root, '--scope-map', fixture.mapPath])).rejects.toThrow(
			/归档元数据不完整/,
		);

		expect(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')).toBe(fixture.legacyYaml);
		expect(readFileSync(join(fixture.root, 'AGENTS.md'), 'utf-8')).toBe('OLD AGENT CONTRACT\n');
		expect(readFileSync(join(fixture.root, '00_草稿', 'user-note.md'), 'utf-8')).toBe(
			'用户数据不得丢失\n',
		);
		expect(dbVersion(fixture.dbPath)).toBe(3);
		if (process.platform !== 'win32') {
			expect(statSync(fixture.dbPath).mode & 0o777).toBe(0o600);
		}
		expect(existsSync(join(fixture.root, '90_系统', '记忆', 'runtime-receipt.json'))).toBe(false);
		const journals = findJournals(join(fixture.parent, '.lifeos-cutovers'));
		expect(journals).toHaveLength(1);
		expect(JSON.parse(readFileSync(journals[0] ?? '', 'utf-8'))).toMatchObject({
			state: 'restored',
			contract_version: 2,
			schema_version: 4,
		});
		expect(existsSync(cutoverLockPath(fixture.root))).toBe(false);
	});

	it('V3 超大 global hard 迁移失败时完整回滚，且不泄漏 opened receipt 或 journal', async () => {
		const oversized = 'a'.repeat(MAX_GLOBAL_HARD_ITEM_PAYLOAD_BYTES * 64);
		const db = new Database(fixture.dbPath);
		try {
			db.prepare('UPDATE memory_items SET content = ? WHERE slot_key = ?').run(
				oversized,
				'content:language',
			);
		} finally {
			db.close();
		}
		const oversizedMap = scopeMap();
		oversizedMap[0] = { ...oversizedMap[0], contentHash: sha256(oversized) };
		writeFileSync(fixture.mapPath, `${JSON.stringify(oversizedMap, null, 2)}\n`, 'utf-8');

		await expect(upgrade([fixture.root, '--scope-map', fixture.mapPath])).rejects.toThrow(
			/全局 hard 规则触发运行时安全上限/,
		);

		expect(dbVersion(fixture.dbPath)).toBe(3);
		expect(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')).toBe(fixture.legacyYaml);
		expect(existsSync(join(fixture.root, '90_系统', '记忆', 'runtime-receipt.json'))).toBe(false);
		const journals = findJournals(join(fixture.parent, '.lifeos-cutovers'));
		expect(journals).toHaveLength(1);
		for (const journalPath of journals) {
			expect(JSON.parse(readFileSync(journalPath, 'utf-8'))).toMatchObject({
				state: 'restored',
				contract_version: 2,
				schema_version: 4,
			});
		}
		expect(existsSync(cutoverLockPath(fixture.root))).toBe(false);
	});

	it('显式恢复拒绝活动 owner，随后可用受控 journal 恢复并释放写闸', async () => {
		const result = await upgrade([fixture.root, '--scope-map', fixture.mapPath]);
		const uncontrolledJournal = join(fixture.parent, 'copied-journal.json');
		writeFileSync(uncontrolledJournal, readFileSync(result.journalPath, 'utf-8'), 'utf-8');
		await expect(upgrade([fixture.root, '--restore', uncontrolledJournal])).rejects.toThrow(
			/受控恢复目录|路径不能经过符号链接/,
		);
		expect(dbVersion(fixture.dbPath)).toBe(4);
		const liveLock = acquireCutoverLock(fixture.root);
		const lockBefore = readFileSync(cutoverLockPath(fixture.root), 'utf-8');
		await expect(upgrade([fixture.root, '--restore', result.journalPath])).rejects.toThrow(
			/仍由活动进程持有/,
		);
		expect(dbVersion(fixture.dbPath)).toBe(4);
		expect(readFileSync(cutoverLockPath(fixture.root), 'utf-8')).toBe(lockBefore);
		expect(JSON.parse(readFileSync(result.journalPath, 'utf-8'))).toMatchObject({
			state: 'opened',
		});
		releaseCutoverLock(fixture.root, liveLock.token);

		const restored = await upgrade([fixture.root, '--restore', result.journalPath]);
		expect(restored.journalPath).toBe(result.journalPath);
		expect(dbVersion(fixture.dbPath)).toBe(3);
		expect(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')).toBe(fixture.legacyYaml);
		expect(JSON.parse(readFileSync(result.journalPath, 'utf-8'))).toMatchObject({
			state: 'restored',
			error: '用户显式执行恢复',
		});
		expect(existsSync(cutoverLockPath(fixture.root))).toBe(false);
	});

	it('数据库已是 V4 时不再读取旧 scope map，并将重复升级收敛为一个备份', async () => {
		const first = await upgrade([fixture.root, '--scope-map', fixture.mapPath]);
		const firstJournal = JSON.parse(readFileSync(first.journalPath, 'utf-8')) as Record<
			string,
			unknown
		>;
		for (const cutoverId of ['legacy-copy-a', 'legacy-copy-b']) {
			const bundle = join(cutoverRoot(fixture.root), cutoverId);
			cpSync(dirname(first.journalPath), bundle, { recursive: true });
			writeFileSync(
				join(bundle, 'journal.json'),
				`${JSON.stringify(
					{
						...firstJournal,
						cutover_id: cutoverId,
						backup_path: join(bundle, 'vault'),
					},
					null,
					2,
				)}\n`,
				'utf-8',
			);
		}
		expect(vaultJournals(fixture.root)).toHaveLength(3);
		const staleDb = new Database(fixture.dbPath);
		try {
			staleDb
				.prepare(
					`INSERT INTO vault_index(file_path, title, type, status, entity_id)
					 VALUES (?, ?, ?, ?, ?)`,
				)
				.run('20_项目/Deleted.md', '已删除项目', 'project', 'active', 'deleted-project');
			staleDb
				.prepare(
					`INSERT INTO scan_state(
						file_path, last_seen_hash, last_seen_mtime, last_seen_size, last_indexed_at
					) VALUES (?, ?, ?, ?, ?)`,
				)
				.run('20_项目/Deleted.md', 'stale', 1, 1, '2026-01-01T00:00:00.000Z');
		} finally {
			staleDb.close();
		}
		const yamlPath = join(fixture.root, 'lifeos.yaml');
		const upgradedYaml = readFileSync(yamlPath, 'utf-8')
			.replace('layer0_total: 1600', 'layer0_total: 1901')
			.replace('global_rules: 600', 'global_rules: 701')
			.replace('userprofile_summary: 180', 'userprofile_summary: 251')
			.replace('taskboard_focus: 420', 'taskboard_focus: 551')
			.replace('scoped_context: 1200', 'scoped_context: 1451')
			.replace('single_item_max: 220', 'single_item_max: 199');
		writeFileSync(yamlPath, upgradedYaml, 'utf-8');
		const defaultMapPath = join(fixture.root, '90_系统', '记忆', 'migrations', 'v4-scope-map.json');
		mkdirSync(join(fixture.root, '90_系统', '记忆', 'migrations'), { recursive: true });
		writeFileSync(defaultMapPath, '{这不是有效 JSON', 'utf-8');

		const result = await upgrade([fixture.root]);

		expect(result.migratedItems).toBe(0);
		expect(result.journalPath).not.toBe(first.journalPath);
		expect(existsSync(first.journalPath)).toBe(false);
		expect(vaultJournals(fixture.root)).toEqual([result.journalPath]);
		expect(dbVersion(fixture.dbPath)).toBe(4);
		expect(existsSync(dirname(defaultMapPath))).toBe(false);
		const config = parseYaml(readFileSync(yamlPath, 'utf-8')) as {
			memory: {
				context_budgets: Record<string, number>;
				repository_bindings: Record<string, string[]>;
			};
		};
		expect(config.memory.repository_bindings).toEqual({});
		expect(config.memory.context_budgets).toEqual({
			layer0_total: 1901,
			global_rules: 701,
			userprofile_summary: 251,
			taskboard_focus: 551,
			scoped_context: 1451,
			single_item_max: 199,
		});
		const verifiedDb = new Database(fixture.dbPath, { readonly: true, fileMustExist: true });
		try {
			expect(
				verifiedDb
					.prepare('SELECT 1 FROM vault_index WHERE file_path = ?')
					.get('20_项目/Deleted.md'),
			).toBeUndefined();
			expect(
				verifiedDb
					.prepare('SELECT 1 FROM scan_state WHERE file_path = ?')
					.get('20_项目/Deleted.md'),
			).toBeUndefined();
		} finally {
			verifiedDb.close();
		}
		const journal = JSON.parse(readFileSync(result.journalPath, 'utf-8')) as {
			backup_path: string;
			backup_receipt_detached: boolean;
		};
		expect(journal.backup_receipt_detached).toBe(true);
		const backupReceipt = JSON.parse(
			readFileSync(
				join(journal.backup_path, 'payload', '90_系统', '记忆', 'runtime-receipt.json'),
				'utf-8',
			),
		) as Record<string, unknown>;
		expect(backupReceipt.kind).toBe('fresh-install');
		expect(backupReceipt).not.toHaveProperty('journal_path');
		expect(validateRuntimeContract({ vaultRoot: fixture.root, runtimeVersion: VERSION }).ok).toBe(
			true,
		);
	});

	it('重复升级后可用唯一备份显式回滚，恢复出的 runtime receipt 不依赖旧 bundle', async () => {
		const first = await upgrade([fixture.root, '--scope-map', fixture.mapPath]);
		const userNote = join(fixture.root, '00_草稿', 'user-note.md');
		writeFileSync(userNote, '第二次升级前必须保留\n', 'utf-8');

		const second = await upgrade([fixture.root]);
		expect(existsSync(first.journalPath)).toBe(false);
		expect(vaultJournals(fixture.root)).toEqual([second.journalPath]);
		writeFileSync(userNote, '第二次升级后用户继续编辑\n', 'utf-8');

		const restored = await upgrade([fixture.root, '--restore', second.journalPath]);

		expect(restored.journalPath).toBe(second.journalPath);
		expect(readFileSync(userNote, 'utf-8')).toBe('第二次升级后用户继续编辑\n');
		expect(dbVersion(fixture.dbPath)).toBe(4);
		expect(vaultJournals(fixture.root)).toEqual([second.journalPath]);
		const receipt = JSON.parse(
			readFileSync(join(fixture.root, '90_系统', '记忆', 'runtime-receipt.json'), 'utf-8'),
		) as Record<string, unknown>;
		expect(receipt.kind).toBe('fresh-install');
		expect(receipt).not.toHaveProperty('journal_path');
		expect(validateRuntimeContract({ vaultRoot: fixture.root, runtimeVersion: VERSION }).ok).toBe(
			true,
		);
		expect(JSON.parse(readFileSync(second.journalPath, 'utf-8'))).toMatchObject({
			state: 'restored',
		});
		expect(existsSync(cutoverLockPath(fixture.root))).toBe(false);

		const yamlPath = join(fixture.root, 'lifeos.yaml');
		const editedAfterRestore = `${readFileSync(yamlPath, 'utf-8')}# 恢复完成后的用户编辑\n`;
		writeFileSync(yamlPath, editedAfterRestore, 'utf-8');
		await upgrade([fixture.root, '--restore', second.journalPath]);
		expect(readFileSync(yamlPath, 'utf-8')).toBe(editedAfterRestore);
		expect(existsSync(cutoverLockPath(fixture.root))).toBe(false);
	});

	it('V4 重跑失败后恢复原 Vault，并且仍只保留一个可用备份', async () => {
		const first = await upgrade([fixture.root, '--scope-map', fixture.mapPath]);
		const yamlBefore = readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8');
		const staleDb = new Database(fixture.dbPath);
		try {
			staleDb
				.prepare(
					`INSERT INTO vault_index(file_path, title, type, status, entity_id)
					 VALUES (?, ?, ?, ?, ?)`,
				)
				.run('20_项目/Deleted.md', '已删除项目', 'project', 'active', 'deleted-project');
			staleDb
				.prepare(
					`INSERT INTO memory_items(
						slot_key, content, item_kind, scope_type, scope_key, created_at, updated_at
					) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					'project:deleted',
					'仍引用已删除项目',
					'decision',
					'project',
					'deleted-project',
					'2026-01-01T00:00:00.000Z',
					'2026-01-01T00:00:00.000Z',
				);
		} finally {
			staleDb.close();
		}

		await expect(upgrade([fixture.root])).rejects.toThrow(/当前项目 catalog 不存在/);

		expect(dbVersion(fixture.dbPath)).toBe(4);
		expect(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')).toBe(yamlBefore);
		const restoredDb = new Database(fixture.dbPath, { readonly: true, fileMustExist: true });
		try {
			expect(
				restoredDb
					.prepare('SELECT entity_id FROM vault_index WHERE file_path = ?')
					.get('20_项目/Deleted.md'),
			).toEqual({ entity_id: 'deleted-project' });
			expect(
				restoredDb
					.prepare('SELECT scope_key FROM memory_items WHERE slot_key = ?')
					.get('project:deleted'),
			).toEqual({ scope_key: 'deleted-project' });
		} finally {
			restoredDb.close();
		}
		const journals = vaultJournals(fixture.root);
		expect(journals).toHaveLength(1);
		expect(journals).not.toContain(first.journalPath);
		expect(existsSync(first.journalPath)).toBe(false);
		expect(JSON.parse(readFileSync(journals[0] ?? '', 'utf-8'))).toMatchObject({
			state: 'restored',
			backup_receipt_detached: true,
		});
		expect(validateRuntimeContract({ vaultRoot: fixture.root, runtimeVersion: VERSION }).ok).toBe(
			true,
		);
		expect(existsSync(cutoverLockPath(fixture.root))).toBe(false);
	});

	it('旧版完整 Vault journal 在目录切换中断后仍可自动续接恢复', async () => {
		const cutover = createCutover(fixture.root, '1.8.3', VERSION, 'a'.repeat(64));
		await backupVault(cutover.journal);
		expect(cutover.journal.backup_format).toBeUndefined();
		for (const state of [
			'prepared',
			'files_installed',
			'db_committed',
			'verified',
			'opened',
		] as const) {
			advanceCutover(cutover.journalPath, cutover.journal, state);
		}
		writeFileSync(join(fixture.root, '00_草稿', 'user-note.md'), '旧备份之后的改动\n');

		const interruptedLock = acquireCutoverLock(fixture.root);
		const boundLock = bindCutoverLock(
			fixture.root,
			interruptedLock.token,
			cutover.journal.cutover_id,
		);
		writeFileSync(
			cutoverLockPath(fixture.root),
			`${JSON.stringify({ ...boundLock, pid: exitedChildPid() }, null, 2)}\n`,
			'utf-8',
		);
		const staging = join(
			fixture.parent,
			`.${basename(fixture.root)}.restore-${cutover.journal.cutover_id}`,
		);
		const displaced = join(
			fixture.parent,
			`.${basename(fixture.root)}.previous-${cutover.journal.cutover_id}`,
		);
		cpSync(cutover.journal.backup_path, staging, {
			recursive: true,
			preserveTimestamps: true,
			verbatimSymlinks: true,
		});
		renameSync(fixture.root, displaced);

		await upgrade([fixture.root, '--restore', cutover.journalPath]);

		expect(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')).toBe(fixture.legacyYaml);
		expect(readFileSync(join(fixture.root, '00_草稿', 'user-note.md'), 'utf-8')).toBe(
			'用户数据不得丢失\n',
		);
		expect(dbVersion(fixture.dbPath)).toBe(3);
		expect(existsSync(staging)).toBe(false);
		expect(existsSync(displaced)).toBe(false);
		expect(existsSync(cutoverLockPath(fixture.root))).toBe(false);
	});

	it('显式恢复可从已恢复部分写集的中断状态幂等续接', async () => {
		const result = await upgrade([fixture.root, '--scope-map', fixture.mapPath]);
		const journal = JSON.parse(readFileSync(result.journalPath, 'utf-8')) as {
			cutover_id: string;
			backup_path: string;
		};
		const interruptedLock = acquireCutoverLock(fixture.root);
		const boundLock = bindCutoverLock(fixture.root, interruptedLock.token, journal.cutover_id);
		writeFileSync(
			cutoverLockPath(fixture.root),
			`${JSON.stringify({ ...boundLock, pid: exitedChildPid() }, null, 2)}\n`,
			'utf-8',
		);
		writeFileSync(
			join(fixture.root, 'lifeos.yaml'),
			readFileSync(join(journal.backup_path, 'payload', 'lifeos.yaml')),
		);
		writeFileSync(join(fixture.root, '00_草稿', 'user-note.md'), '恢复期间的用户编辑必须保留\n');

		const restored = await upgrade([fixture.root, '--restore', result.journalPath]);

		expect(restored.journalPath).toBe(result.journalPath);
		expect(dbVersion(fixture.dbPath)).toBe(3);
		expect(readFileSync(join(fixture.root, 'lifeos.yaml'), 'utf-8')).toBe(fixture.legacyYaml);
		expect(readFileSync(join(fixture.root, '00_草稿', 'user-note.md'), 'utf-8')).toBe(
			'恢复期间的用户编辑必须保留\n',
		);
		expect(existsSync(cutoverLockPath(fixture.root))).toBe(false);
	});

	it('未知 AUTO marker、非法显式项目 ID 和未知 Schema 均在预检阶段失败', async () => {
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
		writeFileSync(
			join(fixture.root, '20_项目', 'GTS.md'),
			'---\ntype: project\nid: Invalid ID\n---\n',
			'utf-8',
		);
		await expect(upgrade([fixture.root, '--scope-map', fixture.mapPath])).rejects.toThrow(
			/项目 id 必须是可移植的小写 ASCII 标识符/,
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
