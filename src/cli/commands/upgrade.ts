import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { extname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { LifeOSConfig } from '../../config.js';
import { resolveConfig } from '../../config.js';
import { type LegacyScopeMapEntry, migrateToV4 } from '../../db/migrations.js';
import { assertSchemaV4, initDb } from '../../db/schema.js';
import {
	runtimePackageSha256,
	validateRuntimeContract,
	writeRuntimeReceipt,
} from '../../runtime-contract.js';
import { migrateV3Config, parseLegacyConfigYaml } from '../migrations/v3-config.js';
import { advanceCutover, backupVault, createCutover, restoreVault } from '../utils/cutover.js';
import { syncVault } from '../utils/sync-vault.js';
import { bold, green, log, parseArgs } from '../utils/ui.js';
import { VERSION } from '../utils/version.js';

export interface UpgradeResult {
	updated: string[];
	skipped: string[];
	unchanged: string[];
	journalPath: string;
	migratedItems: number;
}

interface DatabaseInfo {
	version: number;
	memoryItems: number;
}

function atomicYaml(path: string, config: LifeOSConfig): void {
	const temporary = `${path}.tmp-${process.pid}`;
	writeFileSync(temporary, stringifyYaml(config), 'utf-8');
	renameSync(temporary, path);
}

function databaseInfo(dbPath: string): DatabaseInfo | null {
	if (!existsSync(dbPath)) return null;
	const db = new Database(dbPath);
	try {
		db.pragma('wal_checkpoint(TRUNCATE)');
		const exists = db
			.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'")
			.get();
		if (!exists) return { version: 1, memoryItems: 0 };
		const version = (
			db.prepare('SELECT version FROM schema_version').get() as { version?: number } | undefined
		)?.version;
		if (!Number.isInteger(version)) throw new Error('schema_version 非法');
		const hasMemory = db
			.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_items'")
			.get();
		const memoryItems = hasMemory
			? (db.prepare('SELECT COUNT(*) AS count FROM memory_items').get() as { count: number }).count
			: 0;
		return { version: version as number, memoryItems };
	} finally {
		db.close();
	}
}

function readScopeMap(path: string, expectedItems: number): LegacyScopeMapEntry[] {
	if (!existsSync(path)) {
		if (expectedItems === 0) return [];
		throw new Error(`缺少 V4 scope map：${path}`);
	}
	const value = JSON.parse(readFileSync(path, 'utf-8')) as
		| LegacyScopeMapEntry[]
		| { entries?: LegacyScopeMapEntry[] };
	const entries = Array.isArray(value) ? value : value.entries;
	if (!entries) throw new Error('v4 scope map 必须是数组或包含 entries 数组');
	if (entries.length !== expectedItems) {
		throw new Error(`v4 scope map 条数 ${entries.length} 与旧记忆 ${expectedItems} 不一致`);
	}
	return entries;
}

function* markdownFiles(directory: string): Generator<string> {
	if (!existsSync(directory)) return;
	for (const entry of readdirSync(directory)) {
		const path = join(directory, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) yield* markdownFiles(path);
		else if (stat.isFile() && extname(entry) === '.md') yield path;
	}
}

function frontmatter(path: string): Record<string, unknown> | null {
	const content = readFileSync(path, 'utf-8');
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
	if (!match?.[1]) return null;
	const parsed: unknown = parseYaml(match[1]);
	return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
		? (parsed as Record<string, unknown>)
		: null;
}

function validateProjectIds(
	vaultRoot: string,
	config: LifeOSConfig,
	scopeMap: LegacyScopeMapEntry[],
): void {
	const ids = new Map<string, string>();
	for (const path of markdownFiles(join(vaultRoot, config.directories.projects))) {
		const id = frontmatter(path)?.id;
		if (typeof id !== 'string' || !id.trim()) {
			throw new Error(`项目缺少稳定 id：${path}`);
		}
		const normalized = id.trim();
		if (
			normalized === 'Project_Template' ||
			normalized.includes('{{') ||
			normalized.toLowerCase().includes('placeholder')
		) {
			throw new Error(`项目使用占位 id：${path}`);
		}
		const existing = ids.get(normalized);
		if (existing) throw new Error(`项目 id 重复：${normalized}（${existing}、${path}）`);
		ids.set(normalized, path);
	}
	for (const entry of scopeMap) {
		if (entry.scope.type === 'project' && !ids.has(entry.scope.key)) {
			throw new Error(`scope map 引用不存在的项目 id：${entry.scope.key}`);
		}
		if (
			entry.scope.type === 'repository' &&
			!Object.prototype.hasOwnProperty.call(config.memory.repository_bindings, entry.scope.key)
		) {
			throw new Error(`scope map 引用未绑定的 repository：${entry.scope.key}`);
		}
	}
}

function markerList(content: string): string[] {
	return [...content.matchAll(/<!-- BEGIN AUTO:(\S+) -->/g)].map((match) => match[1] ?? '');
}

function validateActiveDocs(vaultRoot: string, config: LifeOSConfig): void {
	const memoryDir = join(vaultRoot, config.directories.system, config.subdirectories.system.memory);
	const taskboard = join(memoryDir, 'TaskBoard.md');
	if (existsSync(taskboard)) {
		const markers = markerList(readFileSync(taskboard, 'utf-8'));
		if (JSON.stringify(markers) !== JSON.stringify(['focus', 'active-projects', 'revises'])) {
			throw new Error('TaskBoard.md 使用未知 AUTO 区块，无法安全升级');
		}
	}
	const userprofile = join(memoryDir, 'UserProfile.md');
	if (existsSync(userprofile)) {
		const markers = markerList(readFileSync(userprofile, 'utf-8'));
		const legacy = JSON.stringify(markers) === JSON.stringify(['profile-summary', 'rules']);
		const final =
			JSON.stringify(markers) ===
			JSON.stringify(['profile-summary', 'global-rules', 'scoped-rules-index']);
		if (!legacy && !final) throw new Error('UserProfile.md 使用未知 AUTO 区块，无法安全升级');
	}
}

function rewriteLegacyUserprofile(vaultRoot: string, config: LifeOSConfig): void {
	const path = join(
		vaultRoot,
		config.directories.system,
		config.subdirectories.system.memory,
		'UserProfile.md',
	);
	if (!existsSync(path)) return;
	const content = readFileSync(path, 'utf-8');
	if (!markerList(content).includes('rules')) return;
	const replacement = `## 全局行为约束
<!-- BEGIN AUTO:global-rules -->
升级后由数据库重建
<!-- END AUTO:global-rules -->

## 作用域规则索引
<!-- BEGIN AUTO:scoped-rules-index -->
升级后由数据库重建
<!-- END AUTO:scoped-rules-index -->`;
	const updated = content.replace(
		/## [^\n]+\n<!-- BEGIN AUTO:rules -->[\s\S]*?<!-- END AUTO:rules -->/,
		replacement,
	);
	if (updated === content) throw new Error('无法安全重写 UserProfile rules AUTO 区块');
	writeFileSync(path, updated, 'utf-8');
}

function removeDeprecatedContextPolicy(vaultRoot: string, config: LifeOSConfig): void {
	const path = join(
		vaultRoot,
		config.directories.system,
		config.subdirectories.system.memory,
		'ContextPolicy.md',
	);
	if (existsSync(path)) unlinkSync(path);
}

export default async function upgrade(args: string[]): Promise<UpgradeResult> {
	if (args.includes('--override')) {
		throw new Error('V2 升级是原子整包切换，不再支持 --override 模式');
	}
	const { positionals, flags } = parseArgs(args, {
		lang: { alias: 'l' },
		'scope-map': { alias: 'm' },
	});
	const targetPath = resolve(positionals[0] ?? '.');
	const yamlPath = join(targetPath, 'lifeos.yaml');
	if (!existsSync(yamlPath)) {
		throw new Error('No lifeos.yaml found. Run `lifeos init` first.');
	}
	const legacyRaw = parseLegacyConfigYaml(readFileSync(yamlPath, 'utf-8'));
	if (flags.lang && flags.lang !== true) legacyRaw.language = flags.lang;
	const finalConfig = migrateV3Config(legacyRaw);
	const memoryDir = join(
		targetPath,
		finalConfig.directories.system,
		finalConfig.subdirectories.system.memory,
	);
	const dbPath = join(memoryDir, finalConfig.memory.db_name);
	const info = databaseInfo(dbPath);
	if (info && ![1, 2, 3, 4].includes(info.version)) {
		throw new Error(`不支持的数据库 Schema：${info.version}`);
	}
	const scopeMapPath =
		typeof flags['scope-map'] === 'string'
			? resolve(flags['scope-map'])
			: join(memoryDir, 'migrations', 'v4-scope-map.json');
	const scopeMap = info && info.version < 4 ? readScopeMap(scopeMapPath, info.memoryItems) : [];
	validateProjectIds(targetPath, finalConfig, scopeMap);
	validateActiveDocs(targetPath, finalConfig);

	const fromVersion = String(
		(legacyRaw.installed_versions as { assets?: string } | undefined)?.assets ?? 'unknown',
	);
	const packageSha256 = runtimePackageSha256();
	const { journalPath, journal } = createCutover(targetPath, fromVersion, VERSION, packageSha256);
	let migratedItems = 0;
	let vaultMutationStarted = false;
	try {
		backupVault(journal);
		advanceCutover(journalPath, journal, 'prepared');
		vaultMutationStarted = true;
		mkdirSync(memoryDir, { recursive: true });
		atomicYaml(yamlPath, finalConfig);
		const lang = finalConfig.language === 'en' ? 'en' : 'zh';
		const synced = await syncVault(targetPath, finalConfig, {
			lang,
			assetMode: 'overwrite',
			skillMode: 'overwrite',
			ensureMcp: true,
			mcpMode: 'replace',
			rulesMode: 'overwrite',
			assetVersion: VERSION,
		});
		finalConfig.managed_assets = synced.managedAssets ?? {};
		finalConfig.installed_versions = { cli: VERSION, assets: VERSION };
		removeDeprecatedContextPolicy(targetPath, finalConfig);
		rewriteLegacyUserprofile(targetPath, finalConfig);
		atomicYaml(yamlPath, finalConfig);
		resolveConfig(targetPath);
		advanceCutover(journalPath, journal, 'files_installed');

		if (!info) {
			const db = new Database(dbPath);
			try {
				db.pragma('journal_mode = WAL');
				db.pragma('foreign_keys = ON');
				initDb(db);
			} finally {
				db.close();
			}
		} else if (info.version < 4) {
			const db = new Database(dbPath);
			try {
				const migration = migrateToV4(db, {
					scopeMap,
					preparedAt: journal.prepared_at,
				});
				migratedItems = migration.itemCount;
			} finally {
				db.close();
			}
		}
		advanceCutover(journalPath, journal, 'db_committed');
		const db = new Database(dbPath, { readonly: true, fileMustExist: true });
		try {
			assertSchemaV4(db);
		} finally {
			db.close();
		}
		advanceCutover(journalPath, journal, 'verified');
		writeRuntimeReceipt(targetPath, {
			contract_version: 2,
			schema_version: 4,
			kind: 'upgrade',
			state: 'opened',
			runtime_version: VERSION,
			installed_at: new Date().toISOString(),
			journal_path: journalPath,
			cutover_id: journal.cutover_id,
			package_sha256: packageSha256,
		});
		advanceCutover(journalPath, journal, 'opened');
		const runtime = validateRuntimeContract({
			vaultRoot: targetPath,
			runtimeVersion: VERSION,
			verifyManagedAssets: true,
		});
		if (!runtime.ok) throw new Error(runtime.issues.join('\n'));
		log(green('✔'), bold('LifeOS vault upgraded atomically'));
		return {
			updated: synced.updated,
			skipped: synced.skipped,
			unchanged: synced.unchanged,
			journalPath,
			migratedItems,
		};
	} catch (error) {
		try {
			if (vaultMutationStarted) restoreVault(journal);
			advanceCutover(
				journalPath,
				journal,
				'restored',
				error instanceof Error ? error.message : String(error),
			);
		} catch (restoreError) {
			throw new AggregateError(
				[error, restoreError],
				'升级失败且自动恢复失败；请使用 cutover bundle 手工恢复',
			);
		}
		throw error;
	}
}
