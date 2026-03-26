/**
 * config.ts — LifeOS 路径解析的唯一入口。
 *
 * Migrated from Python vault_config.py. Provides VaultConfig class and
 * module-level singleton helpers.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DirectoriesConfig {
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

interface SubdirectoriesConfig {
	knowledge_notes: string;
	knowledge_wiki: string;
	templates: string;
	schema: string;
	memory: string;
	archive_projects: string;
	archive_drafts: string;
	archive_plans: string;
	[key: string]: string;
}

interface MemoryConfig {
	db_name: string;
	scan_prefixes: string[];
	excluded_prefixes: string[];
	enhance_priority: Record<string, number>;
	context_budgets: Record<string, number>;
}

interface LifeOSConfig {
	version?: string;
	language: string;
	directories: DirectoriesConfig;
	subdirectories: SubdirectoriesConfig;
	memory: MemoryConfig;
	installed_versions?: { cli?: string; assets?: string };
	[key: string]: unknown;
}

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
		knowledge_notes: '笔记',
		knowledge_wiki: '百科',
		templates: '模板',
		schema: '规范',
		memory: '记忆',
		archive_projects: '归档/项目',
		archive_drafts: '归档/草稿',
		archive_plans: '归档/计划',
	},
	memory: {
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
		enhance_priority: { projects: 8, knowledge: 6 },
		context_budgets: {
			layer0_total: 1200,
			userprofile_summary: 400,
			taskboard_focus: 800,
			userprofile_doc_limit: 2000,
			taskboard_doc_limit: 3000,
		},
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
		knowledge_notes: 'Notes',
		knowledge_wiki: 'Wiki',
		templates: 'Templates',
		schema: 'Schema',
		memory: 'Memory',
		archive_projects: 'Archive/Projects',
		archive_drafts: 'Archive/Drafts',
		archive_plans: 'Archive/Plans',
	},
	memory: {
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
		enhance_priority: { projects: 8, knowledge: 6 },
		context_budgets: {
			layer0_total: 1200,
			userprofile_summary: 400,
			taskboard_focus: 800,
			userprofile_doc_limit: 2000,
			taskboard_doc_limit: 3000,
		},
	},
};

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maps subdirectory logical name → parent directory logical name */
const SUBDIR_PARENTS: Record<string, string> = {
	knowledge_notes: 'knowledge',
	knowledge_wiki: 'knowledge',
	templates: 'system',
	schema: 'system',
	memory: 'system',
	archive_projects: 'system',
	archive_drafts: 'system',
	archive_plans: 'system',
};

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
	return language === 'en' ? { ...EN_PRESET } : { ...ZH_PRESET };
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
			const lang = (config.language as string | undefined) ?? 'zh';
			const preset = loadPreset(lang);
			return deepMerge(
				preset as unknown as Record<string, unknown>,
				config,
			) as unknown as LifeOSConfig;
		}

		const yamlPath = join(this._vaultRoot, 'lifeos.yaml');
		if (existsSync(yamlPath)) {
			const raw = readFileSync(yamlPath, 'utf-8');
			const userConfig: Record<string, unknown> = (parseYaml(raw) as Record<string, unknown>) ?? {};
			const lang = (userConfig.language as string | undefined) ?? 'zh';
			const preset = loadPreset(lang);
			return deepMerge(
				preset as unknown as Record<string, unknown>,
				userConfig,
			) as unknown as LifeOSConfig;
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
	subDirPath(logicalName: string): string {
		const subdirs = this._config.subdirectories;
		if (!(logicalName in subdirs)) {
			throw new Error(`Unknown subdirectory: ${logicalName}`);
		}
		const parentLogical = SUBDIR_PARENTS[logicalName];
		return join(this.dirPath(parentLogical), subdirs[logicalName]);
	}

	/** Returns the relative prefix for a subdirectory (parent/sub/). */
	subDirPrefix(logicalName: string): string {
		const subdirs = this._config.subdirectories;
		if (!(logicalName in subdirs)) {
			throw new Error(`Unknown subdirectory: ${logicalName}`);
		}
		const parentLogical = SUBDIR_PARENTS[logicalName];
		const parentDir = this._config.directories[parentLogical];
		return `${parentDir}/${subdirs[logicalName]}/`;
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
		return this.subDirPath('memory');
	}

	/** Absolute path to the SQLite database file. */
	dbPath(): string {
		const dbName = this._config.memory.db_name ?? 'memory.db';
		return join(this.memoryDir(), dbName);
	}

	/** Map of physical directory prefix → enhance priority weight. */
	enhancePriority(): Record<string, number> {
		const logicalMap = this._config.memory.enhance_priority ?? {};
		const result: Record<string, number> = {};
		for (const [logicalName, weight] of Object.entries(logicalMap)) {
			result[this.dirPrefix(logicalName)] = weight;
		}
		return result;
	}

	/** Context budget configuration object. */
	contextBudgets(): Record<string, number> {
		return { ...(this._config.memory.context_budgets ?? {}) };
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
		const notesSub = this._config.subdirectories.knowledge_notes ?? '笔记';
		const wikiSub = this._config.subdirectories.knowledge_wiki ?? '百科';

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

let _defaultInstance: VaultConfig | null = null;

/** Get the current global VaultConfig (null if not set). */
export function getVaultConfig(): VaultConfig | null {
	return _defaultInstance;
}

/** Set the global VaultConfig singleton. */
export function setVaultConfig(cfg: VaultConfig): void {
	_defaultInstance = cfg;
}

/**
 * Get the existing singleton or create a new one from vaultRoot.
 * Throws if no singleton exists and vaultRoot is not provided.
 */
export function getOrCreateVaultConfig(vaultRoot?: string): VaultConfig {
	if (_defaultInstance !== null) return _defaultInstance;
	if (vaultRoot === undefined) {
		throw new Error('vault_root is required when no global VaultConfig exists');
	}
	_defaultInstance = new VaultConfig(vaultRoot);
	return _defaultInstance;
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
	_defaultInstance = null;
}

// ─── Re-exports for CLI ──────────────────────────────────────────────────────

export { ZH_PRESET, EN_PRESET, SUBDIR_PARENTS };
export type { LifeOSConfig };
