import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { stringify as stringifyYaml } from 'yaml';
import { VERSION } from '../../src/cli/utils/version.js';
import { _resetDefaultInstance, resolveConfig } from '../../src/config.js';
import { initDb } from '../../src/db/schema.js';
import { writeFreshInstallReceipt } from '../../src/runtime-contract.js';

export interface MemoryCounts {
	vaultIndex: number;
	activeMemoryItems: number;
	archivedMemoryItems: number;
}

export interface IsolatedMemoryVault {
	root: string;
	dbPath: string;
	snapshotCounts(): MemoryCounts;
	cleanup(): void;
}

function canonicalExistingPath(path: string): string {
	return realpathSync.native(resolve(path));
}

export function assertNotProductionVault(root: string): void {
	const temporaryRoot = canonicalExistingPath(tmpdir());
	const target = canonicalExistingPath(root);
	const child = relative(temporaryRoot, target);
	if (!child || child.startsWith('..') || isAbsolute(child)) {
		throw new Error('真实环境测试 Vault 必须位于系统临时目录内');
	}
}

function writeNote(
	root: string,
	relativePath: string,
	frontmatter: Record<string, unknown>,
	body: string,
): void {
	const path = join(root, relativePath);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `---\n${stringifyYaml(frontmatter)}---\n${body}\n`, 'utf-8');
}

function writeFixtureFiles(root: string): void {
	writeNote(
		root,
		'00_草稿/测试草稿.md',
		{ id: 'fixture-draft', title: '测试草稿', type: 'draft', status: 'pending' },
		'临时草稿样本。',
	);
	writeNote(
		root,
		'60_计划/测试计划.md',
		{ id: 'fixture-plan', title: '测试计划', type: 'plan', status: 'pending' },
		'临时计划样本。',
	);
	writeNote(
		root,
		'20_项目/稳定项目定位.md',
		{
			id: 'fixture-project',
			title: '稳定项目定位',
			type: 'project',
			category: 'learning',
			status: 'active',
			summary: '用于验证项目作用域与稳定实体标识。',
			tags: ['密码学', 'Agent'],
		},
		'项目正文包含密码学 Agent 学习路线。',
	);
	writeNote(
		root,
		'40_知识/百科/群论夹具.md',
		{
			id: 'fixture-group-theory',
			title: '群论与群作用',
			type: 'knowledge',
			status: 'review',
			summary: '群论、群同态、同构与 Group Action 的检索夹具。',
			tags: ['群论', 'Group Action', '同构', 'Lagrange'],
		},
		`群公理描述封闭性、结合律、单位元和逆元。${'填充段落。'.repeat(150)}深层唯一术语离散几何覆盖验证。`,
	);
	writeNote(
		root,
		'30_研究/空间智能夹具.md',
		{
			id: 'fixture-spatial-intelligence',
			title: '空间智能研究',
			type: 'research',
			status: 'done',
			summary: '已有空间智能研究报告，用于避重检索。',
		},
		'空间智能已有研究结论。',
	);
}

function initialConfig(root: string): Record<string, unknown> {
	return {
		version: '1.0',
		language: 'zh',
		directories: {
			drafts: '00_草稿',
			diary: '10_日记',
			projects: '20_项目',
			research: '30_研究',
			knowledge: '40_知识',
			outputs: '50_成果',
			plans: '60_计划',
			resources: '70_资源',
			reflection: '80_复盘',
			system: '90_系统',
		},
		subdirectories: {
			knowledge: { notes: '笔记', wiki: '百科' },
			resources: { books: '书籍', literature: '文献', translations: '翻译' },
			system: {
				templates: '模板',
				schema: '规范',
				memory: '记忆',
				digest: '信息',
				prompts: '提示词',
				archive: {
					projects: '归档/项目',
					drafts: '归档/草稿',
					plans: '归档/计划',
					diary: '归档/日记',
				},
			},
		},
		memory: {
			contract_version: 2,
			db_name: 'memory.db',
			scan_prefixes: [
				'drafts',
				'diary',
				'projects',
				'research',
				'knowledge',
				'outputs',
				'plans',
				'resources',
				'reflection',
			],
			excluded_prefixes: ['system'],
			context_budgets: {
				layer0_total: 1800,
				global_rules: 600,
				userprofile_summary: 200,
				taskboard_focus: 500,
				scoped_context: 1200,
				single_item_max: 220,
			},
			repository_bindings: {
				learningapp: [join(root, 'repositories', 'learningapp')],
				lifeos: [join(root, 'repositories', 'lifeos')],
			},
			tool_bindings: {
				obsidian: { commands: ['obsidian'], skills: ['obsidian-cli'] },
			},
		},
		installed_versions: { cli: VERSION, assets: VERSION },
		managed_assets: {},
	};
}

function initializeRuntime(root: string): string {
	for (const directory of [
		'00_草稿',
		'10_日记',
		'20_项目',
		'30_研究',
		'40_知识/笔记',
		'40_知识/百科',
		'50_成果',
		'60_计划',
		'70_资源/书籍',
		'70_资源/文献',
		'70_资源/翻译',
		'80_复盘',
		'90_系统/记忆',
		'90_系统/模板',
		'90_系统/规范',
		'90_系统/信息',
		'90_系统/提示词',
		'90_系统/归档/项目',
		'90_系统/归档/草稿',
		'90_系统/归档/计划',
		'90_系统/归档/日记',
		'repositories/learningapp',
		'repositories/lifeos',
	]) {
		mkdirSync(join(root, directory), { recursive: true });
	}

	writeFileSync(join(root, 'lifeos.yaml'), stringifyYaml(initialConfig(root)), 'utf-8');
	writeFixtureFiles(root);
	for (const skillName of [
		'ask',
		'brainstorm',
		'digest',
		'knowledge',
		'research',
		'revise',
		'today',
	]) {
		const skillRoot = join(root, '.agents', 'skills', skillName);
		mkdirSync(skillRoot, { recursive: true });
		copyFileSync(
			fileURLToPath(new URL(`../../assets/skills/${skillName}/SKILL.zh.md`, import.meta.url)),
			join(skillRoot, 'SKILL.md'),
		);
	}

	_resetDefaultInstance();
	const config = structuredClone(resolveConfig(root).rawConfig);
	config.installed_versions = { cli: VERSION, assets: VERSION };
	config.managed_assets = {};
	writeFileSync(join(root, 'lifeos.yaml'), stringifyYaml(config), 'utf-8');

	const dbPath = join(root, '90_系统', '记忆', 'memory.db');
	const db = new Database(dbPath);
	try {
		db.pragma('auto_vacuum = INCREMENTAL');
		db.pragma('journal_mode = WAL');
		db.pragma('foreign_keys = ON');
		initDb(db);
	} finally {
		db.close();
	}
	writeFreshInstallReceipt(root, config, VERSION);
	_resetDefaultInstance();
	return dbPath;
}

export function createIsolatedMemoryVault(): IsolatedMemoryVault {
	const temporaryRoot = canonicalExistingPath(tmpdir());
	const root = mkdtempSync(join(temporaryRoot, 'lifeos-memory-real-env-v2-'));
	assertNotProductionVault(root);
	let cleaned = false;
	try {
		const dbPath = initializeRuntime(root);
		return {
			root,
			dbPath,
			snapshotCounts: () => {
				assertNotProductionVault(root);
				const db = new Database(dbPath, { readonly: true, fileMustExist: true });
				try {
					const count = (table: string, where = '') =>
						(
							db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get() as {
								count: number;
							}
						).count;
					return {
						vaultIndex: count('vault_index'),
						activeMemoryItems: count('memory_items', "WHERE status = 'active'"),
						archivedMemoryItems: count('memory_items', "WHERE status = 'archived'"),
					};
				} finally {
					db.close();
				}
			},
			cleanup: () => {
				if (cleaned || !existsSync(root)) return;
				assertNotProductionVault(root);
				_resetDefaultInstance();
				rmSync(root, { recursive: true, force: true });
				cleaned = true;
			},
		};
	} catch (error) {
		if (existsSync(root)) rmSync(root, { recursive: true, force: true });
		throw error;
	}
}
