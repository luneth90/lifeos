import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	ConfigValidationError,
	EN_PRESET,
	VaultConfig,
	ZH_PRESET,
	_resetDefaultInstance,
	getOrCreateVaultConfig,
	getVaultConfig,
	resolveConfig,
	setVaultConfig,
} from '../src/config.js';

// ─── Helper: minimal temp vault ──────────────────────────────────────────────

interface TempDir {
	root: string;
	cleanup: () => void;
}

function createTempDir(): TempDir {
	const root = mkdtempSync(join(tmpdir(), 'lifeos-cfg-test-'));
	return {
		root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

function writeyaml(root: string, content: string): void {
	writeFileSync(join(root, 'lifeos.yaml'), content, 'utf-8');
}

function finalYaml(prefix: string, dbName = 'memory.db'): string {
	return `${prefix}
memory:
  contract_version: 2
  db_name: ${dbName}
  scan_prefixes: [drafts, diary, projects, research, knowledge, outputs, plans, resources, reflection]
  excluded_prefixes: [system]
  context_budgets:
    layer0_total: 1800
    global_rules: 600
    userprofile_summary: 200
    taskboard_focus: 500
    scoped_context: 1200
    single_item_max: 220
  repository_bindings: {}
`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('VaultConfig — zh preset (default)', () => {
	let tmp: TempDir;

	afterEach(() => {
		tmp?.cleanup();
		_resetDefaultInstance();
	});

	it('loads zh preset when no lifeos.yaml exists', () => {
		tmp = createTempDir();
		const cfg = new VaultConfig(tmp.root);
		expect(cfg.rawConfig.language).toBe('zh');
		expect(cfg.rawConfig.directories.drafts).toBe('00_草稿');
		expect(cfg.rawConfig.subdirectories.system.digest).toBe('信息');
		expect((cfg.rawConfig.subdirectories.system.archive as Record<string, string>).diary).toBe(
			'归档/日记',
		);
	});

	it('exports zh and en digest preset names', () => {
		expect(ZH_PRESET.subdirectories.system.digest).toBe('信息');
		expect(EN_PRESET.subdirectories.system.digest).toBe('Digest');
	});

	it('vaultRoot returns the absolute path', () => {
		tmp = createTempDir();
		const cfg = new VaultConfig(tmp.root);
		expect(cfg.vaultRoot).toBe(tmp.root);
	});

	it.each([
		['drafts', '00_草稿'],
		['knowledge', '40_知识'],
		['system', '90_系统'],
	] as const)('dirPath(%s) resolves to absolute path', (name, expected) => {
		tmp = createTempDir();
		const cfg = new VaultConfig(tmp.root);
		expect(cfg.dirPath(name)).toBe(join(tmp.root, expected));
	});

	it('dirPath throws on unknown logical name', () => {
		tmp = createTempDir();
		const cfg = new VaultConfig(tmp.root);
		expect(() => cfg.dirPath('nonexistent')).toThrow(/Unknown directory/);
	});

	it('dirPrefix and subDirPrefix return physical names with trailing slash', () => {
		tmp = createTempDir();
		const cfg = new VaultConfig(tmp.root);
		expect(cfg.dirPrefix('drafts')).toBe('00_草稿/');
		expect(cfg.dirPrefix('projects')).toBe('20_项目/');
		expect(cfg.subDirPrefix('knowledge', 'notes')).toBe('40_知识/笔记/');
		expect(cfg.subDirPrefix('system', 'digest')).toBe('90_系统/信息/');
		expect(cfg.subDirPrefix('system', 'memory')).toBe('90_系统/记忆/');
	});

	it('subDirPath resolves subdirectory to absolute path', () => {
		tmp = createTempDir();
		const cfg = new VaultConfig(tmp.root);
		expect(cfg.subDirPath('knowledge', 'notes')).toBe(join(tmp.root, '40_知识', '笔记'));
		expect(cfg.subDirPath('knowledge', 'wiki')).toBe(join(tmp.root, '40_知识', '百科'));
		expect(cfg.subDirPath('system', 'digest')).toBe(join(tmp.root, '90_系统', '信息'));
		expect(cfg.subDirPath('system', 'memory')).toBe(join(tmp.root, '90_系统', '记忆'));
		expect(cfg.subDirPath('system', 'templates')).toBe(join(tmp.root, '90_系统', '模板'));
	});

	it('subDirPath throws on unknown subdirectory', () => {
		tmp = createTempDir();
		const cfg = new VaultConfig(tmp.root);
		expect(() => cfg.subDirPath('system', 'nonexistent')).toThrow(/Unknown subdirectory/);
	});

	it('memoryDir and dbPath resolve correctly', () => {
		tmp = createTempDir();
		const cfg = new VaultConfig(tmp.root);
		expect(cfg.memoryDir()).toBe(join(tmp.root, '90_系统', '记忆'));
		expect(cfg.dbPath()).toBe(join(tmp.root, '90_系统', '记忆', 'memory.db'));
	});

	it('scanPrefixes returns physical dir names with slash', () => {
		tmp = createTempDir();
		const cfg = new VaultConfig(tmp.root);
		const prefixes = cfg.scanPrefixes();
		expect(prefixes).toContain('00_草稿/');
		expect(prefixes).toContain('10_日记/');
		expect(prefixes).toContain('20_项目/');
		expect(prefixes).not.toContain('90_系统/');
	});

	it('excludedPrefixes returns system prefix', () => {
		tmp = createTempDir();
		const cfg = new VaultConfig(tmp.root);
		expect(cfg.excludedPrefixes()).toContain('90_系统/');
	});

	it('contextBudgets returns budget object', () => {
		tmp = createTempDir();
		const cfg = new VaultConfig(tmp.root);
		const budgets = cfg.contextBudgets();
		expect(budgets.layer0_total).toBe(1800);
		expect(budgets.global_rules).toBe(600);
		expect(budgets.userprofile_summary).toBe(200);
		expect(budgets.taskboard_focus).toBe(500);
		expect(budgets.scoped_context).toBe(1200);
		expect(budgets.single_item_max).toBe(220);
		expect(budgets).not.toHaveProperty('userprofile_rules');
		expect(budgets).not.toHaveProperty('revises_summary');
	});
});

describe('VaultConfig — lifeos.yaml loading', () => {
	let tmp: TempDir;

	afterEach(() => {
		tmp?.cleanup();
		_resetDefaultInstance();
	});

	it('loads and merges user lifeos.yaml over zh preset', () => {
		tmp = createTempDir();
		writeyaml(tmp.root, finalYaml(`version: '1.0'\nlanguage: zh\ndirectories:\n  drafts: "Draft"`));
		const cfg = new VaultConfig(tmp.root);
		// User override applies
		expect(cfg.dirPath('drafts')).toBe(join(tmp.root, 'Draft'));
		// Preset values preserved
		expect(cfg.dirPath('diary')).toBe(join(tmp.root, '10_日记'));
	});

	it('respects language: en in lifeos.yaml', () => {
		tmp = createTempDir();
		writeyaml(tmp.root, finalYaml(`version: '1.0'\nlanguage: en`));
		const cfg = new VaultConfig(tmp.root);
		expect(cfg.rawConfig.language).toBe('en');
		// en preset uses English folder names
		expect(cfg.dirPath('drafts')).toBe(join(tmp.root, '00_Drafts'));
		expect(cfg.subDirPath('system', 'digest')).toBe(join(tmp.root, '90_System', 'Digest'));
		expect((cfg.rawConfig.subdirectories.system.archive as Record<string, string>).diary).toBe(
			'Archive/Diary',
		);
	});

	it('custom db_name overrides default', () => {
		tmp = createTempDir();
		writeyaml(tmp.root, finalYaml(`version: '1.0'\nlanguage: zh`, 'custom.db'));
		const cfg = new VaultConfig(tmp.root);
		expect(cfg.dbPath()).toBe(join(tmp.root, '90_系统', '记忆', 'custom.db'));
	});

	it.each([
		[
			'扩展 directories 同样不允许路径穿越',
			finalYaml(`version: '1.0'\nlanguage: zh\ndirectories:\n  external: ../outside`),
		],
		[
			'directories 不允许 .. 路径穿越',
			finalYaml(`version: '1.0'\nlanguage: zh\ndirectories:\n  drafts: ../outside`),
		],
		[
			'directories 不允许绝对路径',
			finalYaml(`version: '1.0'\nlanguage: zh\ndirectories:\n  system: /tmp/lifeos-outside`),
		],
		[
			'subdirectories 不允许 .. 路径穿越',
			finalYaml(`version: '1.0'\nlanguage: zh\nsubdirectories:\n  system:\n    memory: ../outside`),
		],
		[
			'subdirectories 不允许绝对路径',
			finalYaml(
				`version: '1.0'\nlanguage: zh\nsubdirectories:\n  knowledge:\n    notes: /tmp/lifeos-outside`,
			),
		],
		['db_name 不允许包含正斜杠目录', finalYaml(`version: '1.0'\nlanguage: zh`, 'nested/memory.db')],
		[
			'db_name 不允许包含反斜杠目录',
			finalYaml(`version: '1.0'\nlanguage: zh`, String.raw`nested\memory.db`),
		],
	] as const)('拒绝不安全 Vault 路径：%s', (_label, yaml) => {
		tmp = createTempDir();
		writeyaml(tmp.root, yaml);
		expect(() => new VaultConfig(tmp.root)).toThrow(ConfigValidationError);
	});

	it.each([
		['缺少 memory', `version: '1.0'\nlanguage: zh\n`],
		[
			'缺少 contract_version',
			finalYaml(`version: '1.0'\nlanguage: zh`).replace('  contract_version: 2\n', ''),
		],
		[
			'旧 contract_version',
			finalYaml(`version: '1.0'\nlanguage: zh`).replace(
				'contract_version: 2',
				'contract_version: 1',
			),
		],
		[
			'旧预算键',
			finalYaml(`version: '1.0'\nlanguage: zh`).replace(
				'    global_rules: 600',
				'    global_rules: 600\n    userprofile_rules: 1000',
			),
		],
		[
			'旧 scope_mode',
			finalYaml(`version: '1.0'\nlanguage: zh`).replace(
				'  repository_bindings: {}',
				'  repository_bindings: {}\n  scope_mode: enforced',
			),
		],
	] as const)('拒绝最终 V2 契约之外的配置：%s', (_label, yaml) => {
		tmp = createTempDir();
		writeyaml(tmp.root, yaml);
		expect(() => new VaultConfig(tmp.root)).toThrow(ConfigValidationError);
	});

	it('接受值为 0 的最终预算，但不补齐 YAML 中缺失的预算键', () => {
		tmp = createTempDir();
		writeyaml(
			tmp.root,
			finalYaml(`version: '1.0'\nlanguage: zh`).replace('layer0_total: 1800', 'layer0_total: 0'),
		);
		expect(new VaultConfig(tmp.root).contextBudgets().layer0_total).toBe(0);

		writeyaml(
			tmp.root,
			finalYaml(`version: '1.0'\nlanguage: zh`).replace('    single_item_max: 220\n', ''),
		);
		expect(() => new VaultConfig(tmp.root)).toThrow(ConfigValidationError);
	});

	it('throws structured validation error for invalid lifeos.yaml values', () => {
		tmp = createTempDir();
		writeyaml(tmp.root, 'directories:\n  drafts: 42\n');
		expect(() => new VaultConfig(tmp.root)).toThrow(ConfigValidationError);
	});
});

describe('VaultConfig — config object injection', () => {
	let tmp: TempDir;

	afterEach(() => {
		tmp?.cleanup();
		_resetDefaultInstance();
	});

	it('accepts config object directly (skips file loading)', () => {
		tmp = createTempDir();
		const cfg = new VaultConfig(tmp.root, {
			language: 'zh',
			directories: { drafts: 'MyDrafts' },
		});
		expect(cfg.dirPath('drafts')).toBe(join(tmp.root, 'MyDrafts'));
		// Merged with preset — other dirs still exist
		expect(cfg.dirPath('diary')).toBe(join(tmp.root, '10_日记'));
	});

	it('throws structured validation error for invalid injected config', () => {
		tmp = createTempDir();
		expect(
			() =>
				new VaultConfig(tmp.root, {
					language: 'zh',
					subdirectories: { system: { memory: 42 } },
				}),
		).toThrow(ConfigValidationError);
	});
});

describe('VaultConfig — path inference', () => {
	let tmp: TempDir;

	afterEach(() => {
		tmp?.cleanup();
		_resetDefaultInstance();
	});

	it.each([
		['40_知识/笔记/Math/LinearAlgebra/ch1.md', 'Math'],
		['40_知识/百科/CS/Recursion.md', 'CS'],
		['30_研究/SpatialAI/report.md', 'SpatialAI'],
	] as const)('inferDomainFromPath(%s) → %s', (path, expected) => {
		tmp = createTempDir();
		const cfg = new VaultConfig(tmp.root);
		expect(cfg.inferDomainFromPath(path)).toBe(expected);
	});

	it('inferDomainFromPath returns null for non-domain paths', () => {
		tmp = createTempDir();
		const cfg = new VaultConfig(tmp.root);
		expect(cfg.inferDomainFromPath('00_草稿/note.md')).toBeNull();
		expect(cfg.inferDomainFromPath('10_日记/2025-01-01.md')).toBeNull();
	});

	it.each([
		['10_日记/2025-01-01.md', 'daily'],
		['00_草稿/idea.md', 'draft'],
		['20_项目/my-project.md', 'project'],
		['30_研究/topic/report.md', 'research'],
		['40_知识/笔记/book.md', 'knowledge'],
		['70_资源/Books/book.pdf', 'resource'],
		['90_系统/记忆/memory.db', null],
		['unknown/file.md', null],
	] as const)('pathToBucket(%s) → %s', (path, expected) => {
		tmp = createTempDir();
		const cfg = new VaultConfig(tmp.root);
		expect(cfg.pathToBucket(path)).toBe(expected);
	});
});

describe('resolveConfig convenience function', () => {
	let tmp: TempDir;

	afterEach(() => {
		tmp?.cleanup();
		_resetDefaultInstance();
	});

	it('returns a VaultConfig instance', () => {
		tmp = createTempDir();
		const cfg = resolveConfig(tmp.root);
		expect(cfg).toBeInstanceOf(VaultConfig);
		expect(cfg.vaultRoot).toBe(tmp.root);
	});
});

describe('singleton helpers', () => {
	let tmp: TempDir;

	afterEach(() => {
		tmp?.cleanup();
		_resetDefaultInstance();
	});

	it('getVaultConfig returns null before set', () => {
		expect(getVaultConfig()).toBeNull();
	});

	it('setVaultConfig / getVaultConfig round-trip', () => {
		tmp = createTempDir();
		const cfg = new VaultConfig(tmp.root);
		setVaultConfig(cfg);
		expect(getVaultConfig()).toBe(cfg);
	});

	it('getOrCreateVaultConfig creates and caches', () => {
		tmp = createTempDir();
		const cfg = getOrCreateVaultConfig(tmp.root);
		expect(cfg).toBeInstanceOf(VaultConfig);
		// Second call returns same instance
		expect(getOrCreateVaultConfig()).toBe(cfg);
	});

	it('getOrCreateVaultConfig throws without vault_root when no instance', () => {
		expect(() => getOrCreateVaultConfig()).toThrow(/vault_root/);
	});
});
