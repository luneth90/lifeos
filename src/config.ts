/**
 * config.ts — LifeOS 路径解析的唯一入口。
 *
 * Provides VaultConfig class and module-level singleton helpers.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { ContextBudgets } from './types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DirectoriesConfig {
	drafts: string;
	diary: string;
	projects: string;
	research: string;
	knowledge: string;
	outputs: string;
	plans: string;
	resources: string;
	reflection: string;
	system: string;
	[key: string]: string;
}

export interface SubdirectoriesConfig {
	knowledge: { notes: string; wiki: string };
	resources: { books: string; literature: string; translations: string };
	system: {
		templates: string;
		schema: string;
		memory: string;
		digest: string;
		prompts: string;
		archive: { projects: string; drafts: string; plans: string; diary: string };
	};
}

export type RepositoryBindings = Record<string, string[]>;

export interface MemoryConfig {
	contract_version: 2;
	db_name: string;
	scan_prefixes: string[];
	excluded_prefixes: string[];
	context_budgets: ContextBudgets;
	repository_bindings: RepositoryBindings;
}

interface ManagedAssetRecord {
	version: string;
	sha256: string;
}

export interface LifeOSConfig {
	version?: string;
	language: string;
	directories: DirectoriesConfig;
	subdirectories: SubdirectoriesConfig;
	memory: MemoryConfig;
	installed_versions?: { cli?: string; assets?: string };
	managed_assets?: Record<string, ManagedAssetRecord>;
	[key: string]: unknown;
}

export const DEPRECATED_CONTEXT_BUDGET_KEYS = [
	'userprofile_rules',
	'revises_summary',
	'userprofile_doc_limit',
	'taskboard_doc_limit',
] as const;

export const CONTEXT_BUDGET_KEYS = [
	'layer0_total',
	'global_rules',
	'userprofile_summary',
	'taskboard_focus',
	'scoped_context',
	'single_item_max',
] as const;

export const DEFAULT_CONTEXT_BUDGETS: ContextBudgets = {
	layer0_total: 1800,
	global_rules: 600,
	userprofile_summary: 200,
	taskboard_focus: 500,
	scoped_context: 1200,
	single_item_max: 220,
};

// ─── Presets ──────────────────────────────────────────────────────────────────

const ZH_PRESET: LifeOSConfig = {
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
		context_budgets: { ...DEFAULT_CONTEXT_BUDGETS },
		repository_bindings: {},
	},
};

const EN_PRESET: LifeOSConfig = {
	version: '1.0',
	language: 'en',
	directories: {
		drafts: '00_Drafts',
		diary: '10_Diary',
		projects: '20_Projects',
		research: '30_Research',
		knowledge: '40_Knowledge',
		outputs: '50_Outputs',
		plans: '60_Plans',
		resources: '70_Resources',
		reflection: '80_Reflection',
		system: '90_System',
	},
	subdirectories: {
		knowledge: { notes: 'Notes', wiki: 'Wiki' },
		resources: { books: 'Books', literature: 'Literature', translations: 'Translations' },
		system: {
			templates: 'Templates',
			schema: 'Schema',
			memory: 'Memory',
			digest: 'Digest',
			prompts: 'Prompts',
			archive: {
				projects: 'Archive/Projects',
				drafts: 'Archive/Drafts',
				plans: 'Archive/Plans',
				diary: 'Archive/Diary',
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
		context_budgets: { ...DEFAULT_CONTEXT_BUDGETS },
		repository_bindings: {},
	},
};

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maps directory logical name → document bucket type */
const LOGICAL_TO_BUCKET: Record<string, string> = {
	diary: 'daily',
	drafts: 'draft',
	projects: 'project',
	research: 'research',
	knowledge: 'knowledge',
	resources: 'resource',
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function loadPreset(language: string): LifeOSConfig {
	return structuredClone(language === 'en' ? EN_PRESET : ZH_PRESET);
}

/**
 * Deep-merges override into base. Objects are merged recursively;
 * all other types are overwritten.
 */
function deepMerge(
	base: Record<string, unknown>,
	override: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(override)) {
		if (
			key in result &&
			typeof result[key] === 'object' &&
			result[key] !== null &&
			!Array.isArray(result[key]) &&
			typeof value === 'object' &&
			value !== null &&
			!Array.isArray(value)
		) {
			result[key] = deepMerge(
				result[key] as Record<string, unknown>,
				value as Record<string, unknown>,
			);
		} else {
			result[key] = value;
		}
	}
	return result;
}

// ─── Config validation ───────────────────────────────────────────────────────

const directoriesKeys = [
	'drafts',
	'diary',
	'projects',
	'research',
	'knowledge',
	'outputs',
	'plans',
	'resources',
	'reflection',
	'system',
] as const;

const directoriesSchema = z.object(
	Object.fromEntries(directoriesKeys.map((k) => [k, z.string().min(1)])) as Record<
		string,
		z.ZodString
	>,
);

const subdirectoriesSchema = z.object({
	knowledge: z.object({ notes: z.string().min(1), wiki: z.string().min(1) }),
	resources: z.object({
		books: z.string().min(1),
		literature: z.string().min(1),
		translations: z.string().min(1),
	}),
	system: z.object({
		templates: z.string().min(1),
		schema: z.string().min(1),
		memory: z.string().min(1),
		digest: z.string().min(1),
		prompts: z.string().min(1),
		archive: z.object({
			projects: z.string().min(1),
			drafts: z.string().min(1),
			plans: z.string().min(1),
			diary: z.string().min(1),
		}),
	}),
});

const contextBudgetsSchema = z
	.object({
		layer0_total: z.number().nonnegative(),
		global_rules: z.number().nonnegative(),
		userprofile_summary: z.number().nonnegative(),
		taskboard_focus: z.number().nonnegative(),
		scoped_context: z.number().nonnegative(),
		single_item_max: z.number().nonnegative(),
	})
	.strict();

const repositoryIdSchema = z
	.string()
	.regex(/^[a-z0-9][a-z0-9._-]*$/, 'repository id 必须是可移植的小写 ASCII 标识符');

const memorySchema = z
	.object({
		contract_version: z.literal(2),
		db_name: z.string().min(1).default('memory.db'),
		scan_prefixes: z
			.array(z.string())
			.default([
				'drafts',
				'diary',
				'projects',
				'research',
				'knowledge',
				'outputs',
				'plans',
				'resources',
				'reflection',
			]),
		excluded_prefixes: z.array(z.string()).default(['system']),
		context_budgets: contextBudgetsSchema,
		repository_bindings: z.record(repositoryIdSchema, z.array(z.string().min(1)).min(1)),
	})
	.strict();

export const lifeosConfigSchema = z
	.object({
		version: z.string().optional(),
		language: z.enum(['zh', 'en']).optional().default('zh'),
		directories: directoriesSchema,
		subdirectories: subdirectoriesSchema,
		memory: memorySchema,
		installed_versions: z
			.object({ cli: z.string().optional(), assets: z.string().optional() })
			.optional(),
		managed_assets: z.record(z.object({ version: z.string(), sha256: z.string() })).optional(),
	})
	.passthrough();

export type ValidatedLifeOSConfig = z.infer<typeof lifeosConfigSchema>;

export class ConfigValidationError extends Error {
	readonly source: string;
	readonly errors: string[];

	constructor(source: string, errors: string[]) {
		super(`Invalid LifeOS config in ${source}:\n${errors.join('\n')}`);
		this.name = 'ConfigValidationError';
		this.source = source;
		this.errors = errors;
	}
}

function validateConfig(raw: Record<string, unknown>, source: string): void {
	const result = lifeosConfigSchema.safeParse(raw);
	if (result.success) return;

	const errors = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
	throw new ConfigValidationError(source, errors);
}

function assertNoDeprecatedContextBudgetKeys(raw: Record<string, unknown>, source: string): void {
	const memory = raw.memory;
	if (!memory || typeof memory !== 'object' || Array.isArray(memory)) return;
	const budgets = (memory as Record<string, unknown>).context_budgets;
	if (!budgets || typeof budgets !== 'object' || Array.isArray(budgets)) return;
	const keys = DEPRECATED_CONTEXT_BUDGET_KEYS.filter(
		(key) => key in (budgets as Record<string, unknown>),
	);
	if (keys.length > 0) {
		throw new ConfigValidationError(
			source,
			keys.map((key) => `  - memory.context_budgets.${key}: 已弃用；请先运行 lifeos upgrade`),
		);
	}
}

function assertFinalYamlMemoryContract(raw: Record<string, unknown>, source: string): void {
	const memory = raw.memory;
	if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
		throw new ConfigValidationError(source, ['  - memory: 最终配置必须显式提供 memory']);
	}
	const record = memory as Record<string, unknown>;
	const errors: string[] = [];
	if (record.contract_version !== 2) {
		errors.push('  - memory.contract_version: 必须显式为 2；请先运行 lifeos upgrade');
	}
	if (!('repository_bindings' in record)) {
		errors.push('  - memory.repository_bindings: 最终配置必须显式提供');
	}
	const budgets = record.context_budgets;
	if (!budgets || typeof budgets !== 'object' || Array.isArray(budgets)) {
		errors.push('  - memory.context_budgets: 最终配置必须显式提供');
	} else {
		for (const key of CONTEXT_BUDGET_KEYS) {
			if (!(key in (budgets as Record<string, unknown>))) {
				errors.push(`  - memory.context_budgets.${key}: 最终配置必须显式提供`);
			}
		}
	}
	if (errors.length > 0) throw new ConfigValidationError(source, errors);
}

// ─── VaultConfig class ────────────────────────────────────────────────────────

export class VaultConfig {
	private readonly _vaultRoot: string;
	private readonly _config: LifeOSConfig;

	constructor(vaultRoot: string, config?: Record<string, unknown>) {
		this._vaultRoot = resolve(vaultRoot);
		this._config = this._load(config);
	}

	private _load(config?: Record<string, unknown>): LifeOSConfig {
		if (config !== undefined) {
			assertNoDeprecatedContextBudgetKeys(config, 'programmatic config');
			const lang = (config.language as string | undefined) ?? 'zh';
			const preset = loadPreset(lang);
			const merged = deepMerge(preset as unknown as Record<string, unknown>, config);
			validateConfig(merged, 'programmatic config');
			return merged as unknown as LifeOSConfig;
		}

		const yamlPath = join(this._vaultRoot, 'lifeos.yaml');
		if (existsSync(yamlPath)) {
			const raw = readFileSync(yamlPath, 'utf-8');
			const userConfig: Record<string, unknown> = (parseYaml(raw) as Record<string, unknown>) ?? {};
			assertNoDeprecatedContextBudgetKeys(userConfig, yamlPath);
			assertFinalYamlMemoryContract(userConfig, yamlPath);
			const lang = (userConfig.language as string | undefined) ?? 'zh';
			const preset = loadPreset(lang);
			const merged = deepMerge(preset as unknown as Record<string, unknown>, userConfig);
			validateConfig(merged, yamlPath);
			return merged as unknown as LifeOSConfig;
		}

		// No yaml file — detect from vault contents (default to zh)
		return loadPreset('zh');
	}

	// ── Accessors ──────────────────────────────────────────────────────────────

	get vaultRoot(): string {
		return this._vaultRoot;
	}

	get rawConfig(): LifeOSConfig {
		return this._config;
	}

	// ── Directory helpers ──────────────────────────────────────────────────────

	/** Resolve a logical directory name to an absolute filesystem path. */
	dirPath(logicalName: string): string {
		const dirs = this._config.directories;
		if (!(logicalName in dirs)) {
			throw new Error(`Unknown directory: ${logicalName}`);
		}
		return join(this._vaultRoot, dirs[logicalName]);
	}

	/** Returns the physical directory name with a trailing slash (for prefix matching). */
	dirPrefix(logicalName: string): string {
		const dirs = this._config.directories;
		if (!(logicalName in dirs)) {
			throw new Error(`Unknown directory: ${logicalName}`);
		}
		return `${dirs[logicalName]}/`;
	}

	/** Resolve a logical subdirectory name to an absolute filesystem path. */
	subDirPath(parent: string, child: string): string {
		const parentDir = this._config.directories[parent];
		if (!parentDir) throw new Error(`Unknown directory: ${parent}`);
		const group = (
			this._config.subdirectories as unknown as Record<string, Record<string, unknown>>
		)[parent];
		if (!group || typeof group[child] !== 'string') {
			throw new Error(`Unknown subdirectory: ${parent}/${child}`);
		}
		return join(this._vaultRoot, parentDir, group[child] as string);
	}

	/** Returns the relative prefix for a subdirectory (parent/sub/). */
	subDirPrefix(parent: string, child: string): string {
		const parentDir = this._config.directories[parent];
		if (!parentDir) throw new Error(`Unknown directory: ${parent}`);
		const group = (
			this._config.subdirectories as unknown as Record<string, Record<string, unknown>>
		)[parent];
		if (!group || typeof group[child] !== 'string') {
			throw new Error(`Unknown subdirectory: ${parent}/${child}`);
		}
		return `${parentDir}/${group[child] as string}/`;
	}

	// ── Memory helpers ─────────────────────────────────────────────────────────

	/** List of physical directory prefixes (with slash) to scan for indexing. */
	scanPrefixes(): string[] {
		const logicalNames: string[] = this._config.memory.scan_prefixes ?? [];
		return logicalNames.map((name) => this.dirPrefix(name));
	}

	/** List of physical directory prefixes (with slash) to exclude from indexing. */
	excludedPrefixes(): string[] {
		const logicalNames: string[] = this._config.memory.excluded_prefixes ?? [];
		return logicalNames.map((name) => this.dirPrefix(name));
	}

	/** Absolute path to the memory subdirectory. */
	memoryDir(): string {
		return this.subDirPath('system', 'memory');
	}

	/** Absolute path to the SQLite database file. */
	dbPath(): string {
		const dbName = this._config.memory.db_name ?? 'memory.db';
		return join(this.memoryDir(), dbName);
	}

	/** 返回独立副本，避免调用方污染缓存配置。 */
	contextBudgets(): ContextBudgets {
		return { ...this._config.memory.context_budgets };
	}

	repositoryBindings(): RepositoryBindings {
		return Object.fromEntries(
			Object.entries(this._config.memory.repository_bindings).map(([id, roots]) => [
				id,
				[...roots],
			]),
		);
	}

	// ── Path inference ─────────────────────────────────────────────────────────

	/**
	 * Infer a domain name from a vault-relative file path.
	 * Returns null if the path does not belong to a domain-organized directory.
	 */
	inferDomainFromPath(relPath: string): string | null {
		const parts = relPath.split('/');
		const knowledgeDir = this._config.directories.knowledge ?? '';
		const researchDir = this._config.directories.research ?? '';
		const notesSub = this._config.subdirectories.knowledge?.notes ?? '笔记';
		const wikiSub = this._config.subdirectories.knowledge?.wiki ?? '百科';

		// 40_知识/笔记/<Domain>/... or 40_知识/百科/<Domain>/...
		if (
			parts.length >= 4 &&
			parts[0] === knowledgeDir &&
			(parts[1] === notesSub || parts[1] === wikiSub)
		) {
			const candidate = parts[2];
			if (candidate && !candidate.startsWith('.')) return candidate;
		}

		// 30_研究/<Domain>/...
		if (parts.length >= 3 && parts[0] === researchDir) {
			const candidate = parts[1];
			if (candidate && !candidate.startsWith('.')) return candidate;
		}

		return null;
	}

	/**
	 * Map a vault-relative file path to a document bucket type.
	 * Returns null if the path does not match any known bucket.
	 */
	pathToBucket(relPath: string): string | null {
		const dirs = this._config.directories;
		for (const [logicalName, bucket] of Object.entries(LOGICAL_TO_BUCKET)) {
			const physicalDir = dirs[logicalName] ?? '';
			if (physicalDir && relPath.startsWith(`${physicalDir}/`)) {
				return bucket;
			}
		}
		return null;
	}
}

// ─── Module-level singleton ───────────────────────────────────────────────────

const _instances = new Map<string, VaultConfig>();
let _defaultRoot: string | null = null;

/** Get the current global VaultConfig (null if not set). */
export function getVaultConfig(vaultRoot?: string): VaultConfig | null {
	if (vaultRoot !== undefined) return _instances.get(resolve(vaultRoot)) ?? null;
	return _defaultRoot ? (_instances.get(_defaultRoot) ?? null) : null;
}

/** Set the global VaultConfig singleton. */
export function setVaultConfig(cfg: VaultConfig): void {
	_instances.set(cfg.vaultRoot, cfg);
	_defaultRoot = cfg.vaultRoot;
}

/**
 * Get the existing singleton or create a new one from vaultRoot.
 * Throws if no singleton exists and vaultRoot is not provided.
 */
export function getOrCreateVaultConfig(vaultRoot?: string): VaultConfig {
	if (vaultRoot === undefined) {
		const current = getVaultConfig();
		if (!current) throw new Error('vault_root is required when no VaultConfig exists');
		return current;
	}
	const key = resolve(vaultRoot);
	const existing = _instances.get(key);
	if (existing) {
		_defaultRoot = key;
		return existing;
	}
	const created = new VaultConfig(key);
	setVaultConfig(created);
	return created;
}

/**
 * Convenience factory: create a VaultConfig from a vault root path.
 * Does NOT register it as the global singleton.
 */
export function resolveConfig(vaultRoot: string, config?: Record<string, unknown>): VaultConfig {
	return new VaultConfig(vaultRoot, config);
}

/**
 * Reset the module-level singleton (for use in tests only).
 */
export function _resetDefaultInstance(): void {
	_instances.clear();
	_defaultRoot = null;
}

// ─── Reflection subdirectory names ───────────────────────────────────────────

/** Reflection subdirectory names by language */
const ZH_REFLECTION_SUBS: readonly string[] = [
	'周复盘',
	'月复盘',
	'季度复盘',
	'年度复盘',
	'项目复盘',
];
const EN_REFLECTION_SUBS: readonly string[] = [
	'Weekly',
	'Monthly',
	'Quarterly',
	'Yearly',
	'Projects',
];

// ─── Re-exports for CLI ──────────────────────────────────────────────────────

export { ZH_PRESET, EN_PRESET, ZH_REFLECTION_SUBS, EN_REFLECTION_SUBS };
export type { ContextBudgets, ManagedAssetRecord };
