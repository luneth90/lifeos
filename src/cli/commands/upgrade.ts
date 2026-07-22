import { createHash, randomUUID } from 'node:crypto';
import {
	closeSync,
	existsSync,
	fsyncSync,
	linkSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import Database from 'better-sqlite3';
import { stringify as stringifyYaml } from 'yaml';
import type { LifeOSConfig, RepositoryBindings } from '../../config.js';
import { EN_REFLECTION_SUBS, ZH_REFLECTION_SUBS, resolveConfig } from '../../config.js';
import {
	acquireCutoverLock,
	bindCutoverLock,
	claimCutoverLock,
	cutoverRoot,
	isValidCutoverId,
	releaseCutoverLock,
} from '../../cutover-lock.js';
import {
	type LegacyMemoryInventoryItem,
	type LegacyScopeMapEntry,
	inspectLegacyMemoryItems,
	migrateToV4,
} from '../../db/migrations.js';
import { assertSchemaV4 } from '../../db/schema.js';
import {
	RUNTIME_RECEIPT_FILENAME,
	expectedManagedAssetPaths,
	runtimePackageSha256,
	validateRuntimeContract,
	writeRuntimeReceipt,
} from '../../runtime-contract.js';
import { assertGlobalHardSafety } from '../../services/global-hard-safety.js';
import {
	assertManagedTreeSafe,
	assertVaultPathSafe,
	canonicalVaultLocation,
	canonicalVaultRoot,
} from '../../utils/safe-path.js';
import {
	type ProjectIdPlan,
	applyProjectIdPlan,
	planProjectIds,
} from '../migrations/project-ids.js';
import {
	assertProjectMemoryScopesResolveToCatalog,
	reindexAndAssertProjectCatalog,
} from '../migrations/project-index-consistency.js';
import {
	type DiscoveredRepositoryBinding,
	type RepositoryBindingAmbiguity,
	discoverRepositoryBindings,
} from '../migrations/repository-bindings.js';
import { migrateV3Config, parseLegacyConfigYaml } from '../migrations/v3-config.js';
import {
	REVIEW_REQUIRED_SCOPE_KEY,
	type ScopeMapProject,
	type V4ScopeMapDocument,
	V4_SCOPE_MAP_FORMAT,
	V4_SCOPE_MAP_FORMAT_VERSION,
	generateV4ScopeMap,
	verifyV4ScopeMapFingerprints,
} from '../migrations/v4-scope-map.js';
import {
	advanceCutover,
	assertCutoverSourceUnchanged,
	assertVaultMatchesCutoverBackup,
	backupVault,
	createCutover,
	discardCutoverBundle,
	readCutoverJournal,
	restoreVault,
	retainOnlyCutoverBundle,
} from '../utils/cutover.js';
import { isManagedAssetRecord } from '../utils/managed-assets.js';
import { syncVault } from '../utils/sync-vault.js';
import { bold, green, log, parseArgs } from '../utils/ui.js';
import { VERSION } from '../utils/version.js';
import type { WriteSetTarget } from '../utils/write-set-backup.js';

export interface UpgradeResult {
	updated: string[];
	skipped: string[];
	unchanged: string[];
	journalPath: string;
	migratedItems: number;
}

export interface UpgradeExecutionOptions {
	sqliteBusyTimeoutMs?: number;
	retryDelaysMs?: readonly number[];
	hooks?: {
		afterWriteSetSnapshot?: () => void | Promise<void>;
		afterBackupPrepared?: () => void | Promise<void>;
		afterScopeMapPublished?: () => void;
		onSqliteRetry?: (attempt: number, error: unknown) => void;
	};
}

interface DatabaseInfo {
	version: number;
	memoryItems: number;
}

function fsyncParent(path: string): void {
	if (process.platform === 'win32') return;
	const descriptor = openSync(dirname(path), 'r');
	try {
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
}

function nodeExists(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw error;
	}
}

function atomicText(path: string, content: string, mode: number): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
	let descriptor: number | null = null;
	try {
		descriptor = openSync(temporary, 'wx', mode);
		writeFileSync(descriptor, content, 'utf-8');
		fsyncSync(descriptor);
		closeSync(descriptor);
		descriptor = null;
		renameSync(temporary, path);
		fsyncParent(path);
	} catch (error) {
		if (descriptor !== null) closeSync(descriptor);
		if (nodeExists(temporary)) unlinkSync(temporary);
		throw error;
	}
}

function atomicYaml(path: string, config: LifeOSConfig): void {
	atomicText(path, stringifyYaml(config), 0o600);
}

function atomicJson(path: string, value: unknown): void {
	atomicText(path, `${JSON.stringify(value, null, 2)}\n`, 0o600);
}

/**
 * 为需要人工审阅的 preflight 诊断创建新文件，绝不覆盖并发或人工已有内容。
 * 临时文件先完整 fsync，再通过同目录硬链接原子发布。
 */
function createJsonIfAbsent(path: string, value: unknown, onPublished?: () => void): boolean {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
	let descriptor: number | null = null;
	try {
		descriptor = openSync(temporary, 'wx', 0o600);
		writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
		fsyncSync(descriptor);
		closeSync(descriptor);
		descriptor = null;
	} catch (error) {
		if (descriptor !== null) closeSync(descriptor);
		if (nodeExists(temporary)) unlinkSync(temporary);
		throw error;
	}
	let published = false;
	try {
		linkSync(temporary, path);
		published = true;
		// 硬链接成功后最终路径已经对外可见。必须在任何后续清理或 fsync 前
		// 标记写入，避免这些步骤失败时被误判为“零写入”而跳过回滚。
		onPublished?.();
		unlinkSync(temporary);
		fsyncParent(path);
		return true;
	} catch (error) {
		if (nodeExists(temporary)) unlinkSync(temporary);
		if (!published && (error as NodeJS.ErrnoException).code === 'EEXIST') return false;
		throw error;
	}
}

function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function databaseInfo(dbPath: string): DatabaseInfo | null {
	if (!existsSync(dbPath)) return null;
	const db = new Database(dbPath, { readonly: true, fileMustExist: true });
	try {
		return databaseInfoFromConnection(db);
	} finally {
		db.close();
	}
}

function databaseInfoFromConnection(db: Database.Database): DatabaseInfo {
	const versions = db.prepare('SELECT version FROM schema_version').all() as Array<{
		version?: number;
	}>;
	if (versions.length !== 1 || !Number.isInteger(versions[0]?.version)) {
		throw new Error('schema_version 必须且只能包含一个整数版本');
	}
	const hasMemory = db
		.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_items'")
		.get();
	if (!hasMemory) throw new Error('旧数据库缺少 memory_items');
	const memoryItems = (
		db.prepare('SELECT COUNT(*) AS count FROM memory_items').get() as { count: number }
	).count;
	return { version: versions[0]?.version as number, memoryItems };
}

function isSqliteBusy(error: unknown): boolean {
	const code = (error as { code?: unknown })?.code;
	return typeof code === 'string' && code.startsWith('SQLITE_BUSY');
}

async function retryDelay(ms: number): Promise<void> {
	await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function beginUpgradeTransaction(
	dbPath: string,
	options: UpgradeExecutionOptions,
): Promise<Database.Database> {
	const delays = options.retryDelaysMs ?? [300, 1_000, 3_000];
	const busyTimeout = options.sqliteBusyTimeoutMs ?? 5_000;
	for (let attempt = 0; ; attempt += 1) {
		const db = new Database(dbPath, { fileMustExist: true, timeout: busyTimeout });
		try {
			db.pragma(`busy_timeout = ${busyTimeout}`);
			db.pragma('foreign_keys = ON');
			db.exec('BEGIN IMMEDIATE');
			return db;
		} catch (error) {
			db.close();
			const delay = delays[attempt];
			if (delay === undefined || !isSqliteBusy(error)) throw error;
			options.hooks?.onSqliteRetry?.(attempt + 1, error);
			await retryDelay(delay);
		}
	}
}

async function commitUpgradeTransaction(
	db: Database.Database,
	options: UpgradeExecutionOptions,
): Promise<void> {
	const delays = options.retryDelaysMs ?? [300, 1_000, 3_000];
	for (let attempt = 0; ; attempt += 1) {
		try {
			db.exec('COMMIT');
			return;
		} catch (error) {
			const delay = delays[attempt];
			if (delay === undefined || !db.inTransaction || !isSqliteBusy(error)) throw error;
			options.hooks?.onSqliteRetry?.(attempt + 1, error);
			await retryDelay(delay);
		}
	}
}

interface ReviewableScopeMapEntry extends LegacyScopeMapEntry {
	confirmed?: boolean;
}

type ScopeMapObject = Record<string, unknown> & { entries?: ReviewableScopeMapEntry[] };
type ScopeMapValue = ReviewableScopeMapEntry[] | ScopeMapObject;

export interface ScopeMapPlan {
	path: string;
	entries: LegacyScopeMapEntry[];
	writeValue?: ScopeMapValue;
	writeMode?: 'create' | 'replace';
	originalHash?: string;
	generatedSummary?: V4ScopeMapDocument['summary'];
}

function validateScopeMapValue(
	value: ScopeMapValue,
	path: string,
	inventory: readonly LegacyMemoryInventoryItem[],
	acceptSuggestions: boolean,
): { entries: LegacyScopeMapEntry[]; accepted: boolean } {
	const entries = Array.isArray(value) ? value : value.entries;
	if (!entries) throw new Error('v4 scope map 必须是数组或包含 entries 数组');
	const generatedDocument = !Array.isArray(value);
	if (generatedDocument) {
		if (
			value.format !== V4_SCOPE_MAP_FORMAT ||
			value.formatVersion !== V4_SCOPE_MAP_FORMAT_VERSION ||
			value.targetSchemaVersion !== 4
		) {
			throw new Error('scope map 对象格式或版本无效，请删除后重新自动生成');
		}
	}
	if (entries.length !== inventory.length) {
		throw new Error(`v4 scope map 条数 ${entries.length} 与旧记忆 ${inventory.length} 不一致`);
	}
	const legacyByIdentity = new Map(inventory.map((item) => [item.legacyIdentity, item]));
	const seen = new Set<string>();
	for (const entry of entries) {
		if (typeof entry.legacyIdentity !== 'string' || !entry.legacyIdentity.trim()) {
			throw new Error('scope map 条目缺少 legacyIdentity');
		}
		if (seen.has(entry.legacyIdentity)) {
			throw new Error(`scope map legacyIdentity 重复：${entry.legacyIdentity}`);
		}
		seen.add(entry.legacyIdentity);
		const legacy = legacyByIdentity.get(entry.legacyIdentity);
		if (!legacy) throw new Error(`scope map 包含未知条目：${entry.legacyIdentity}`);
		if (entry.contentHash !== legacy.contentHash) {
			throw new Error(`scope map 已过期，内容哈希不匹配：${entry.legacyIdentity}`);
		}
		if (entry.confirmed !== undefined && typeof entry.confirmed !== 'boolean') {
			throw new Error(`${entry.legacyIdentity} 的 confirmed 必须是布尔值`);
		}
		if (
			!entry.scope ||
			typeof entry.scope.type !== 'string' ||
			typeof entry.scope.key !== 'string'
		) {
			throw new Error(`${entry.legacyIdentity} 缺少合法 scope`);
		}
		if (entry.scope.key === REVIEW_REQUIRED_SCOPE_KEY) {
			throw new Error(
				`${entry.legacyIdentity} 尚无可用作用域；请在 ${path} 中选择 scopeCandidates 或填写真实 scope`,
			);
		}
	}
	const unconfirmed = entries.filter((entry) =>
		generatedDocument ? entry.confirmed !== true : entry.confirmed === false,
	);
	if (unconfirmed.length > 0 && !acceptSuggestions) {
		throw new Error(
			`scope map 仍有 ${unconfirmed.length} 条建议待确认：${path}\n检查 suggestionReason 后，将条目 confirmed 改为 true，或使用 --accept-scope-map 接受已有有效建议`,
		);
	}
	if (unconfirmed.length > 0) {
		for (const entry of unconfirmed) entry.confirmed = true;
		if (!Array.isArray(value)) {
			value.reviewedAt = new Date().toISOString();
			value.reviewedBy = '--accept-scope-map';
			const summary = value.summary;
			if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
				Object.assign(summary, { confirmed: entries.length, reviewRequired: 0 });
			}
		}
	}
	return { entries, accepted: unconfirmed.length > 0 };
}

function legacyInventory(dbPath: string): LegacyMemoryInventoryItem[] {
	const db = new Database(dbPath, { readonly: true, fileMustExist: true });
	try {
		return inspectLegacyMemoryItems(db).items;
	} finally {
		db.close();
	}
}

function inventoryDigest(inventory: readonly LegacyMemoryInventoryItem[]): string {
	return sha256(
		JSON.stringify(
			[...inventory]
				.sort((left, right) => left.legacyIdentity.localeCompare(right.legacyIdentity))
				.map((item) => ({
					legacyIdentity: item.legacyIdentity,
					slotKey: item.slotKey,
					contentHash: item.contentHash,
					source: item.source,
					relatedFiles: [...item.relatedFiles],
					status: item.status,
					updatedAt: item.updatedAt,
				})),
		),
	);
}

function prepareScopeMap(
	path: string,
	inventory: readonly LegacyMemoryInventoryItem[],
	projects: readonly ScopeMapProject[],
	config: LifeOSConfig,
	acceptSuggestions: boolean,
	explicitPath: boolean,
): ScopeMapPlan {
	const generated = generateV4ScopeMap(inventory, {
		generatedAt: new Date().toISOString(),
		projects,
		repositoryBindings: config.memory.repository_bindings,
	});
	const missing = !existsSync(path);
	const original = missing ? null : readFileSync(path, 'utf-8');
	let value = missing ? generated : (JSON.parse(original as string) as ScopeMapValue);
	let refreshDefault = false;
	if (!missing && !explicitPath && !Array.isArray(value)) {
		const verification = verifyV4ScopeMapFingerprints(value, inventory, {
			projects,
			repositoryBindings: config.memory.repository_bindings,
		});
		if (verification.hasFingerprintMetadata && !verification.contextMatches) {
			if (verification.entriesUnchanged) {
				value = generated;
				refreshDefault = true;
			} else {
				throw new Error(
					`默认 scope map 的生成上下文已变化，且文件已被人工修改：${path}\n请保留该文件作为审阅记录，并通过 --scope-map 指定确认后的映射`,
				);
			}
		}
	}
	try {
		const validated = validateScopeMapValue(value, path, inventory, acceptSuggestions);
		return {
			path,
			entries: validated.entries,
			...(original !== null ? { originalHash: sha256(original) } : {}),
			...(missing || refreshDefault || validated.accepted
				? {
						writeValue: value,
						writeMode: missing ? ('create' as const) : ('replace' as const),
					}
				: {}),
			...(missing || refreshDefault ? { generatedSummary: generated.summary } : {}),
		};
	} catch (error) {
		if (missing) {
			const created = createJsonIfAbsent(path, generated);
			if (!created) {
				return prepareScopeMap(path, inventory, projects, config, acceptSuggestions, explicitPath);
			}
			log(
				green('✔'),
				`已生成待审阅的 V4 scope map：${path}（${generated.summary.confirmed}/${generated.summary.total} 条已可靠识别）`,
			);
		}
		throw error;
	}
}

function assertScopeMapPlanCurrent(plan: ScopeMapPlan): void {
	if (plan.writeMode === 'create' && nodeExists(plan.path)) {
		throw new Error(`scope map 在预检后被并发创建，请重新执行 upgrade：${plan.path}`);
	}
	if (plan.originalHash !== undefined) {
		let current: string;
		try {
			current = readFileSync(plan.path, 'utf-8');
		} catch {
			throw new Error(`scope map 在预检后被删除或无法读取，请重新执行 upgrade：${plan.path}`);
		}
		if (sha256(current) !== plan.originalHash) {
			throw new Error(`scope map 在预检后发生变化，请重新执行 upgrade：${plan.path}`);
		}
	}
}

export function persistScopeMap(
	plan: ScopeMapPlan,
	explicitPath: boolean,
	beforeWrite?: () => void,
): void {
	assertScopeMapPlanCurrent(plan);
	if (!plan.writeValue || !plan.writeMode) return;
	if (plan.writeMode === 'create') {
		if (!createJsonIfAbsent(plan.path, plan.writeValue, beforeWrite)) {
			throw new Error(`scope map 在预检后被并发创建，请重新执行 upgrade：${plan.path}`);
		}
	} else if (!explicitPath) {
		beforeWrite?.();
		atomicJson(plan.path, plan.writeValue);
	}
	if (plan.generatedSummary) {
		log(
			green('✔'),
			`已自动生成 V4 scope map：${plan.path}（${plan.generatedSummary.confirmed}/${plan.generatedSummary.total} 条已可靠识别）`,
		);
	}
}

interface AutomaticUpgradePlan {
	config: LifeOSConfig;
	projectIds: ProjectIdPlan;
	inventory: LegacyMemoryInventoryItem[];
	scopeMap?: ScopeMapPlan;
	discoveredBindings: DiscoveredRepositoryBinding[];
}

function normalizedBindings(bindings: Readonly<RepositoryBindings>): RepositoryBindings {
	return Object.fromEntries(
		Object.entries(bindings)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, roots]) => [
				key,
				[...new Set(roots.map((root) => root.trim()).filter(Boolean))].sort((left, right) =>
					left.localeCompare(right),
				),
			]),
	);
}

function bindingsUsedByScopeMap(
	existing: Readonly<RepositoryBindings>,
	discovered: readonly DiscoveredRepositoryBinding[],
	entries: readonly LegacyScopeMapEntry[],
): RepositoryBindings {
	const used = new Set(
		entries.filter((entry) => entry.scope.type === 'repository').map((entry) => entry.scope.key),
	);
	const result = normalizedBindings(existing);
	for (const binding of discovered) {
		if (used.has(binding.key)) result[binding.key] = [...binding.roots];
	}
	return normalizedBindings(result);
}

function relevantRepositoryAmbiguities(
	ambiguities: readonly RepositoryBindingAmbiguity[],
	entries: readonly (LegacyScopeMapEntry & { confirmed?: boolean })[],
): RepositoryBindingAmbiguity[] {
	const byIdentity = new Map(entries.map((entry) => [entry.legacyIdentity, entry]));
	return ambiguities.filter((ambiguity) =>
		ambiguity.legacyIdentities.some((identity) => {
			const entry = byIdentity.get(identity);
			return !entry || entry.confirmed === false || entry.scope.type === 'repository';
		}),
	);
}

function repositoryAmbiguityError(
	ambiguities: readonly RepositoryBindingAmbiguity[],
	cause?: unknown,
): Error {
	const details = ambiguities.map((ambiguity) => `- ${ambiguity.message}`).join('\n');
	return new Error(
		`repository_bindings 自动配置存在歧义，未修改项目或配置：\n${details}`,
		cause === undefined ? undefined : { cause },
	);
}

function buildAutomaticUpgradePlan(options: {
	vaultRoot: string;
	baseConfig: LifeOSConfig;
	dbPath: string;
	database: DatabaseInfo;
	scopeMapPath: string;
	scopeMapIsExplicit: boolean;
	acceptSuggestions: boolean;
}): AutomaticUpgradePlan {
	const projectIds = planProjectIds(options.vaultRoot, options.baseConfig);
	const config = structuredClone(options.baseConfig);
	if (options.database.version >= 4 || options.database.memoryItems === 0) {
		return { config, projectIds, inventory: [], discoveredBindings: [] };
	}

	const inventory = legacyInventory(options.dbPath);
	const existingBindings = normalizedBindings(config.memory.repository_bindings);
	const discovery = discoverRepositoryBindings({
		inventory,
		existingBindings,
		vaultRoot: options.vaultRoot,
	});
	const provisionalConfig = structuredClone(config);
	provisionalConfig.memory.repository_bindings = discovery.bindings;
	const provisionalDocument = generateV4ScopeMap(inventory, {
		generatedAt: new Date().toISOString(),
		projects: projectIds.catalog,
		repositoryBindings: provisionalConfig.memory.repository_bindings,
	});

	let scopeMap: ScopeMapPlan;
	try {
		scopeMap = prepareScopeMap(
			options.scopeMapPath,
			inventory,
			projectIds.catalog,
			provisionalConfig,
			options.acceptSuggestions,
			options.scopeMapIsExplicit,
		);
	} catch (error) {
		const relevant = relevantRepositoryAmbiguities(
			discovery.ambiguities,
			provisionalDocument.entries,
		);
		if (relevant.length > 0) throw repositoryAmbiguityError(relevant, error);
		throw error;
	}

	const relevant = relevantRepositoryAmbiguities(discovery.ambiguities, scopeMap.entries);
	if (relevant.length > 0) throw repositoryAmbiguityError(relevant);
	config.memory.repository_bindings = bindingsUsedByScopeMap(
		existingBindings,
		discovery.discovered,
		scopeMap.entries,
	);

	// 新生成的 map 必须以最终会持久化的 bindings 为上下文，不能把未使用的候选写进指纹。
	if (
		scopeMap.generatedSummary ||
		JSON.stringify(provisionalConfig.memory.repository_bindings) !==
			JSON.stringify(config.memory.repository_bindings)
	) {
		scopeMap = prepareScopeMap(
			options.scopeMapPath,
			inventory,
			projectIds.catalog,
			config,
			options.acceptSuggestions,
			options.scopeMapIsExplicit,
		);
	}
	validateScopeReferences(
		options.vaultRoot,
		options.dbPath,
		projectIds.catalog,
		config,
		scopeMap.entries,
	);
	return {
		config,
		projectIds,
		inventory,
		scopeMap,
		discoveredBindings: discovery.discovered.filter((binding) =>
			Object.prototype.hasOwnProperty.call(config.memory.repository_bindings, binding.key),
		),
	};
}

function isInside(root: string, path: string): boolean {
	const rel = relative(root, path);
	return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function assertScopeMapPathSafe(vaultRoot: string, scopeMapPath: string): void {
	if (isInside(vaultRoot, scopeMapPath)) {
		assertVaultPathSafe(vaultRoot, scopeMapPath);
		return;
	}
	const parent = dirname(scopeMapPath);
	if (!existsSync(parent) || realpathSync.native(parent) !== resolve(parent)) {
		throw new Error(`外部 scope map 的父目录必须已存在且不能经过符号链接：${parent}`);
	}
	if (existsSync(scopeMapPath)) {
		const stat = lstatSync(scopeMapPath);
		if (stat.isSymbolicLink() || !stat.isFile()) {
			throw new Error(`scope map 必须是普通文件：${scopeMapPath}`);
		}
	}
}

function assertUpgradePathsSafe(
	vaultRoot: string,
	config: LifeOSConfig,
	scopeMapPath: string,
): void {
	const configuredPaths: string[] = [...Object.values(config.directories), config.memory.db_name];
	for (const group of Object.values(config.subdirectories)) {
		for (const value of Object.values(group as Record<string, unknown>)) {
			if (typeof value === 'string') configuredPaths.push(value);
			else if (value && typeof value === 'object' && !Array.isArray(value)) {
				for (const nested of Object.values(value as Record<string, unknown>)) {
					if (typeof nested === 'string') configuredPaths.push(nested);
				}
			}
		}
	}
	if (configuredPaths.some((path) => path.includes('\\'))) {
		throw new Error('upgrade 配置路径必须使用 / 作为分隔符，不能包含反斜杠');
	}
	const relativeTargets = new Set<string>([
		'lifeos.yaml',
		'AGENTS.md',
		'CLAUDE.md',
		'.mcp.json',
		join('.codex', 'config.toml'),
		'opencode.json',
		'.agents',
		'.claude',
		'.codex',
	]);
	for (const directory of Object.values(config.directories)) relativeTargets.add(directory);
	for (const [logicalParent, group] of Object.entries(config.subdirectories)) {
		const parent = config.directories[logicalParent];
		if (!parent) continue;
		for (const value of Object.values(group as Record<string, unknown>)) {
			if (typeof value === 'string') relativeTargets.add(join(parent, value));
			else if (value && typeof value === 'object' && !Array.isArray(value)) {
				for (const nested of Object.values(value as Record<string, unknown>)) {
					if (typeof nested === 'string') relativeTargets.add(join(parent, nested));
				}
			}
		}
	}
	const memoryDir = join(config.directories.system, config.subdirectories.system.memory);
	for (const name of [
		config.memory.db_name,
		'ContextPolicy.md',
		'UserProfile.md',
		'runtime-receipt.json',
		'migrations',
	]) {
		relativeTargets.add(join(memoryDir, name));
	}
	for (const target of relativeTargets) {
		assertVaultPathSafe(vaultRoot, join(vaultRoot, target));
	}
	for (const tree of [
		join(vaultRoot, '.agents', 'skills'),
		join(vaultRoot, config.directories.system, config.subdirectories.system.templates),
		join(vaultRoot, config.directories.system, config.subdirectories.system.schema),
		join(vaultRoot, config.directories.system, config.subdirectories.system.prompts),
		join(vaultRoot, memoryDir, 'migrations'),
	]) {
		assertManagedTreeSafe(vaultRoot, tree);
	}
	assertScopeMapPathSafe(vaultRoot, scopeMapPath);
}

function portableRelativePath(path: string): string {
	return path.replaceAll('\\', '/');
}

function safePreviousManagedAssetPath(vaultRoot: string, path: string): string | null {
	if (
		!path ||
		path.includes('\0') ||
		path.includes('\\') ||
		isAbsolute(path) ||
		win32.isAbsolute(path)
	)
		return null;
	const candidate = resolve(vaultRoot, portableRelativePath(path));
	const rel = relative(vaultRoot, candidate);
	if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
	try {
		assertVaultPathSafe(vaultRoot, candidate);
	} catch {
		// syncVault 对同一类不安全历史清单项会跳过，写集也不应因此扩大或失败。
		return null;
	}
	return portableRelativePath(rel);
}

function addDirectoryParents(paths: Set<string>, relativePath: string): void {
	let current = portableRelativePath(dirname(relativePath));
	while (current && current !== '.') {
		paths.add(current);
		const parent = portableRelativePath(dirname(current));
		if (!parent || parent === '.' || parent === current) break;
		current = parent;
	}
}

function configuredDirectoryPaths(config: LifeOSConfig): Set<string> {
	const result = new Set<string>();
	for (const directory of Object.values(config.directories)) {
		result.add(portableRelativePath(directory));
	}
	for (const [logicalParent, group] of Object.entries(config.subdirectories)) {
		const parent = config.directories[logicalParent];
		if (!parent) continue;
		for (const value of Object.values(group as Record<string, unknown>)) {
			if (typeof value === 'string') {
				result.add(portableRelativePath(join(parent, value)));
				continue;
			}
			if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
			for (const nested of Object.values(value as Record<string, unknown>)) {
				if (typeof nested === 'string') {
					result.add(portableRelativePath(join(parent, nested)));
				}
			}
		}
	}
	const reflectionSubs = config.language === 'en' ? EN_REFLECTION_SUBS : ZH_REFLECTION_SUBS;
	for (const subdirectory of reflectionSubs) {
		result.add(portableRelativePath(join(config.directories.reflection, subdirectory)));
	}
	return result;
}

function compactContentTargets(paths: ReadonlySet<string>): string[] {
	const ordered = [...paths].sort((left, right) => {
		const depth = left.split('/').length - right.split('/').length;
		return depth || left.localeCompare(right);
	});
	const compacted: string[] = [];
	for (const path of ordered) {
		if (!compacted.some((parent) => path.startsWith(`${parent}/`))) compacted.push(path);
	}
	return compacted;
}

function buildUpgradeWriteSet(options: {
	vaultRoot: string;
	baseConfig: LifeOSConfig;
	plan: AutomaticUpgradePlan;
	explicitScopeMap: boolean;
}): WriteSetTarget[] {
	const { vaultRoot, baseConfig, plan } = options;
	const finalConfig = plan.config;
	const memoryDirectory = portableRelativePath(
		join(finalConfig.directories.system, finalConfig.subdirectories.system.memory),
	);
	const contentPaths = new Set<string>([
		'lifeos.yaml',
		'.mcp.json',
		portableRelativePath(join('.codex', 'config.toml')),
		'opencode.json',
		portableRelativePath(join(memoryDirectory, 'ContextPolicy.md')),
		portableRelativePath(join(memoryDirectory, 'UserProfile.md')),
		portableRelativePath(join(memoryDirectory, 'migrations')),
		portableRelativePath(join(memoryDirectory, RUNTIME_RECEIPT_FILENAME)),
	]);
	const expectedAssetPaths = expectedManagedAssetPaths(finalConfig);
	for (const path of expectedAssetPaths) {
		contentPaths.add(portableRelativePath(path));
	}
	const claudeSkillsPath = join(vaultRoot, '.claude', 'skills');
	if (!nodeExists(claudeSkillsPath)) {
		contentPaths.add(portableRelativePath(join('.claude', 'skills')));
	}
	for (const [path, record] of Object.entries(baseConfig.managed_assets ?? {})) {
		if (!isManagedAssetRecord(record) || expectedAssetPaths.includes(portableRelativePath(path))) {
			continue;
		}
		const safePath = safePreviousManagedAssetPath(vaultRoot, path);
		if (!safePath) continue;
		const absolutePath = join(vaultRoot, safePath);
		if (!existsSync(absolutePath)) continue;
		const stat = lstatSync(absolutePath);
		if (!stat.isFile() || stat.isSymbolicLink()) continue;
		// syncVault 会在真正删除时重新比较旧哈希；当前普通文件均是潜在删除目标。
		contentPaths.add(safePath);
	}
	for (const change of plan.projectIds.changes) {
		contentPaths.add(portableRelativePath(change.relativePath));
	}
	const scopeMapWillBeWritten =
		plan.scopeMap?.writeMode === 'create' ||
		(plan.scopeMap?.writeMode === 'replace' && !options.explicitScopeMap);
	if (scopeMapWillBeWritten && plan.scopeMap && isInside(vaultRoot, plan.scopeMap.path)) {
		contentPaths.add(portableRelativePath(relative(vaultRoot, plan.scopeMap.path)));
	}

	const compactedContent = compactContentTargets(contentPaths);
	const databasePath = portableRelativePath(join(memoryDirectory, finalConfig.memory.db_name));
	if (compactedContent.some((parent) => databasePath.startsWith(`${parent}/`))) {
		throw new Error('SQLite 数据库不能位于其他写集目录目标内');
	}

	const directoryPaths = configuredDirectoryPaths(finalConfig);
	for (const path of [...directoryPaths]) addDirectoryParents(directoryPaths, path);
	for (const path of [...compactedContent, databasePath]) addDirectoryParents(directoryPaths, path);
	const directoryTargets = [...directoryPaths]
		.filter(
			(path) =>
				path &&
				path !== '.' &&
				!compactedContent.some((content) => path === content || path.startsWith(`${content}/`)),
		)
		.sort((left, right) => left.localeCompare(right));

	return [
		...compactedContent.map((path) => ({ path, strategy: 'content' as const })),
		{ path: databasePath, strategy: 'sqlite' as const },
		...directoryTargets.map((path) => ({ path, strategy: 'directory-presence' as const })),
	];
}

function legacyVaultIndexColumns(db: Database.Database): Set<string> {
	return new Set(
		(db.prepare('PRAGMA table_info(vault_index)').all() as Array<{ name: string }>).map(
			(column) => column.name,
		),
	);
}

function validateFileScope(
	db: Database.Database,
	vaultRoot: string,
	key: string,
	hasEntityId: boolean,
): void {
	if (key !== key.trim() || !key || key.includes('\0')) {
		throw new Error(`file scope key 非法：${JSON.stringify(key)}`);
	}
	if (hasEntityId) {
		const rows = db
			.prepare('SELECT file_path FROM vault_index WHERE entity_id = ?')
			.all(key) as Array<{ file_path: string }>;
		if (rows.length > 1) throw new Error(`file scope entity_id 重复：${key}`);
		if (rows.length === 1) return;
	}
	const portable = key.replaceAll('\\', '/');
	if (
		isAbsolute(key) ||
		win32.isAbsolute(key) ||
		portable.startsWith('/') ||
		portable.split('/').some((component) => component === '.' || component === '..')
	) {
		throw new Error(`file scope 必须是安全的 Vault 相对路径或唯一 entity_id：${key}`);
	}
	const candidate = assertVaultPathSafe(vaultRoot, resolve(vaultRoot, portable));
	const indexed = db.prepare('SELECT 1 FROM vault_index WHERE file_path = ? LIMIT 1').get(portable);
	if (indexed) return;
	if (!existsSync(candidate) || !lstatSync(candidate).isFile()) {
		throw new Error(`file scope 未对应索引或现存文件：${key}`);
	}
}

function validateScopeReferences(
	vaultRoot: string,
	dbPath: string,
	projects: readonly ScopeMapProject[],
	config: LifeOSConfig,
	scopeMap: LegacyScopeMapEntry[],
): void {
	const ids = new Set(projects.map((project) => project.id));
	const db = new Database(dbPath, { readonly: true, fileMustExist: true });
	try {
		const columns = legacyVaultIndexColumns(db);
		if (!columns.has('file_path')) throw new Error('旧 vault_index 缺少 file_path');
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
			if (entry.scope.type === 'file') {
				validateFileScope(db, vaultRoot, entry.scope.key, columns.has('entity_id'));
			}
		}
	} finally {
		db.close();
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

function removeMigrationArtifacts(vaultRoot: string, config: LifeOSConfig): void {
	const path = join(
		vaultRoot,
		config.directories.system,
		config.subdirectories.system.memory,
		'migrations',
	);
	assertManagedTreeSafe(vaultRoot, path);
	if (!existsSync(path)) return;
	const stat = lstatSync(path);
	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		throw new Error(`migrations 必须是 Vault 内普通目录：${path}`);
	}
	rmSync(path, { recursive: true });
	fsyncParent(path);
}

function restoreCutover(vaultRoot: string, journalPath: string): UpgradeResult {
	const resolvedJournalPath = resolve(journalPath);
	if (!existsSync(resolvedJournalPath)) {
		throw new Error(`cutover journal 不存在：${resolvedJournalPath}`);
	}
	const journalStat = lstatSync(resolvedJournalPath);
	if (journalStat.isSymbolicLink() || !journalStat.isFile()) {
		throw new Error('cutover journal 必须是受控目录内的普通文件');
	}
	if (realpathSync.native(resolvedJournalPath) !== resolvedJournalPath) {
		throw new Error('cutover journal 路径不能经过符号链接');
	}
	const journal = readCutoverJournal(resolvedJournalPath);
	if (canonicalVaultLocation(journal.vault_root) !== canonicalVaultLocation(vaultRoot)) {
		throw new Error('cutover journal 不属于目标 Vault');
	}
	if (
		!isValidCutoverId(journal.cutover_id) ||
		journal.contract_version !== 2 ||
		journal.schema_version !== 4 ||
		journal.to_version !== VERSION ||
		![
			'preparing',
			'prepared',
			'files_installed',
			'db_committed',
			'verified',
			'opened',
			'restored',
		].includes(journal.state)
	) {
		throw new Error('cutover journal 契约或目标版本无效');
	}
	const expectedJournalPath = join(cutoverRoot(vaultRoot), journal.cutover_id, 'journal.json');
	if (resolvedJournalPath !== expectedJournalPath) {
		throw new Error(`cutover journal 不在目标 Vault 的受控恢复目录：${resolvedJournalPath}`);
	}
	const bundlePath = dirname(expectedJournalPath);
	const bundleStat = lstatSync(bundlePath);
	if (bundleStat.isSymbolicLink() || !bundleStat.isDirectory()) {
		throw new Error('cutover bundle 目录不安全');
	}
	if (resolve(journal.backup_path) !== join(bundlePath, 'vault')) {
		throw new Error('cutover journal 的 backup_path 无效');
	}
	const lock = claimCutoverLock(vaultRoot, journal.cutover_id);
	if (journal.state === 'preparing') {
		advanceCutover(resolvedJournalPath, journal, 'restored', '用户显式执行恢复');
		discardCutoverBundle(vaultRoot, journal.cutover_id);
	} else if (journal.state === 'restored') {
		// restored 是已完成且已验证的终态。重复恢复只校验并保留备份，不能再次改写 Vault。
		retainOnlyCutoverBundle(vaultRoot, journal.cutover_id);
	} else {
		restoreVault(journal);
		assertVaultMatchesCutoverBackup(journal);
		advanceCutover(resolvedJournalPath, journal, 'restored', '用户显式执行恢复');
		retainOnlyCutoverBundle(vaultRoot, journal.cutover_id);
	}
	// 上述任一步失败都会提前抛错并保留写闸；仅在恢复成功后释放。
	releaseCutoverLock(vaultRoot, lock.token);
	log(green('✔'), bold('LifeOS cutover 已恢复'));
	return {
		updated: [],
		skipped: [],
		unchanged: [],
		journalPath: resolvedJournalPath,
		migratedItems: 0,
	};
}

interface PreparedUpgradeContext {
	yamlSource: string;
	baseConfig: LifeOSConfig;
	memoryDir: string;
	dbPath: string;
	explicitScopeMap: boolean;
	info: DatabaseInfo;
	packageSha256: string;
	plan: AutomaticUpgradePlan;
	cutover: ReturnType<typeof createCutover>;
}

export default async function upgrade(
	args: string[],
	executionOptions: UpgradeExecutionOptions = {},
): Promise<UpgradeResult> {
	if (args.includes('--override')) {
		throw new Error('V2 升级是原子整包切换，不再支持 --override 模式');
	}
	const { positionals, flags } = parseArgs(args, {
		lang: { alias: 'l' },
		'scope-map': { alias: 'm' },
		'accept-scope-map': {},
		restore: {},
	});
	const requestedTargetPath = resolve(positionals[0] ?? '.');
	if (flags.restore !== undefined) {
		if (typeof flags.restore !== 'string') {
			throw new Error('--restore 必须指定 cutover journal 路径');
		}
		return restoreCutover(requestedTargetPath, flags.restore);
	}
	const targetPath = canonicalVaultRoot(requestedTargetPath);
	if (flags['scope-map'] === true) throw new Error('--scope-map 必须指定文件路径');
	if (flags['accept-scope-map'] !== undefined && flags['accept-scope-map'] !== true) {
		throw new Error('--accept-scope-map 是无参数确认开关，请放在 Vault 路径之后');
	}
	const yamlPath = join(targetPath, 'lifeos.yaml');
	if (!existsSync(yamlPath)) {
		throw new Error('No lifeos.yaml found. Run `lifeos init` first.');
	}
	assertVaultPathSafe(targetPath, yamlPath);
	// 尽早取得写闸：后续配置解析、项目扫描、scope 规划和数据库快照都在同一排他窗口内。
	const cutoverLock = acquireCutoverLock(targetPath);
	let prepared: PreparedUpgradeContext;
	try {
		const yamlSource = readFileSync(yamlPath, 'utf-8');
		const legacyRaw = parseLegacyConfigYaml(yamlSource);
		if (flags.lang && flags.lang !== true) legacyRaw.language = flags.lang;
		const baseConfig = migrateV3Config(legacyRaw);
		const memoryDir = join(
			targetPath,
			baseConfig.directories.system,
			baseConfig.subdirectories.system.memory,
		);
		const dbPath = join(memoryDir, baseConfig.memory.db_name);
		const explicitScopeMapValue =
			typeof flags['scope-map'] === 'string' ? flags['scope-map'] : undefined;
		const explicitScopeMap = explicitScopeMapValue !== undefined;
		const scopeMapPath =
			explicitScopeMapValue !== undefined
				? join(
						realpathSync.native(dirname(resolve(explicitScopeMapValue))),
						basename(explicitScopeMapValue),
					)
				: join(memoryDir, 'migrations', 'v4-scope-map.json');
		assertUpgradePathsSafe(targetPath, baseConfig, scopeMapPath);
		const info = databaseInfo(dbPath);
		if (!info) {
			throw new Error('缺少旧记忆数据库；upgrade 不会创建空库，请对新 Vault 使用 lifeos init');
		}
		if (![1, 2, 3, 4].includes(info.version)) {
			throw new Error(`不支持的数据库 Schema：${info.version}`);
		}
		validateActiveDocs(targetPath, baseConfig);
		const plan = buildAutomaticUpgradePlan({
			vaultRoot: targetPath,
			baseConfig,
			dbPath,
			database: info,
			scopeMapPath,
			scopeMapIsExplicit: explicitScopeMap,
			acceptSuggestions: flags['accept-scope-map'] === true,
		});
		if (plan.scopeMap?.writeMode === 'create' && !isInside(targetPath, plan.scopeMap.path)) {
			persistScopeMap(plan.scopeMap, true);
			plan.scopeMap.originalHash = sha256(readFileSync(plan.scopeMap.path, 'utf-8'));
			plan.scopeMap.writeValue = undefined;
			plan.scopeMap.writeMode = undefined;
		}
		if (readFileSync(yamlPath, 'utf-8') !== yamlSource) {
			throw new Error('lifeos.yaml 在升级预检期间发生变化，请重新执行 upgrade');
		}
		const currentInfo = databaseInfo(dbPath);
		if (
			!currentInfo ||
			currentInfo.version !== info.version ||
			currentInfo.memoryItems !== info.memoryItems
		) {
			throw new Error('数据库在升级预检期间发生变化，请重新执行 upgrade');
		}
		const fromVersion = String(
			(legacyRaw.installed_versions as { assets?: string } | undefined)?.assets ?? 'unknown',
		);
		const packageSha256 = runtimePackageSha256();
		const cutover = createCutover(targetPath, fromVersion, VERSION, packageSha256);
		bindCutoverLock(targetPath, cutoverLock.token, cutover.journal.cutover_id);
		prepared = {
			yamlSource,
			baseConfig,
			memoryDir,
			dbPath,
			explicitScopeMap,
			info: currentInfo,
			packageSha256,
			plan,
			cutover,
		};
	} catch (error) {
		releaseCutoverLock(targetPath, cutoverLock.token);
		throw error;
	}
	const {
		yamlSource,
		baseConfig,
		memoryDir,
		dbPath,
		explicitScopeMap,
		info,
		packageSha256,
		plan,
		cutover,
	} = prepared;
	const { journalPath, journal } = cutover;
	let migratedItems = 0;
	let vaultMutationStarted = false;
	let db: Database.Database | undefined;
	let transactionOpen = false;
	try {
		const finalConfig = plan.config;
		const writeSet = buildUpgradeWriteSet({
			vaultRoot: targetPath,
			baseConfig,
			plan,
			explicitScopeMap,
		});
		db = await beginUpgradeTransaction(dbPath, executionOptions);
		transactionOpen = true;
		const lockedInfo = databaseInfoFromConnection(db);
		if (lockedInfo.version !== info.version || lockedInfo.memoryItems !== info.memoryItems) {
			throw new Error('数据库在升级预检后发生变化，请重新执行 upgrade');
		}
		if (info.version < 4 && info.memoryItems > 0) {
			const lockedInventory = inspectLegacyMemoryItems(db).items;
			if (inventoryDigest(lockedInventory) !== inventoryDigest(plan.inventory)) {
				throw new Error('旧记忆内容在升级预检后发生变化，请重新执行 upgrade');
			}
		}
		await backupVault(journal, {
			runtimeReceiptPath: join(memoryDir, RUNTIME_RECEIPT_FILENAME),
			targets: writeSet,
			retryDelaysMs: executionOptions.retryDelaysMs,
			hooks: { afterSourceSnapshot: executionOptions.hooks?.afterWriteSetSnapshot },
			onSqliteRetry: executionOptions.hooks?.onSqliteRetry,
		});
		if (readFileSync(yamlPath, 'utf-8') !== yamlSource) {
			throw new Error('lifeos.yaml 与升级计划不一致，请重新执行 upgrade');
		}
		advanceCutover(journalPath, journal, 'prepared');
		await executionOptions.hooks?.afterBackupPrepared?.();
		// 在任何 Vault 改写前统一校验写集，再补充项目全树与外部 scope map 的 CAS。
		assertCutoverSourceUnchanged(journal);
		if (readFileSync(yamlPath, 'utf-8') !== yamlSource) {
			throw new Error('lifeos.yaml 与升级计划不一致，请重新执行 upgrade');
		}
		if (plan.scopeMap) assertScopeMapPlanCurrent(plan.scopeMap);
		const markVaultMutation = (): void => {
			vaultMutationStarted = true;
		};
		const appliedProjects = applyProjectIdPlan(plan.projectIds, {
			beforeWrite: markVaultMutation,
		});
		if (JSON.stringify(appliedProjects.catalog) !== JSON.stringify(plan.projectIds.catalog)) {
			throw new Error('项目 id 应用结果与升级计划不一致');
		}
		if (plan.scopeMap) {
			persistScopeMap(plan.scopeMap, explicitScopeMap, () => {
				markVaultMutation();
				if (plan.scopeMap?.writeMode === 'create') {
					executionOptions.hooks?.afterScopeMapPublished?.();
				}
			});
		}
		markVaultMutation();
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
		const runtimeConfig = resolveConfig(targetPath);
		advanceCutover(journalPath, journal, 'files_installed');

		if (info.version < 4) {
			const migration = migrateToV4(db, {
				scopeMap: plan.scopeMap?.entries ?? [],
				preparedAt: journal.prepared_at,
			});
			migratedItems = migration.itemCount;
		}
		assertSchemaV4(db);
		reindexAndAssertProjectCatalog(db, targetPath, runtimeConfig, appliedProjects.catalog);
		assertProjectMemoryScopesResolveToCatalog(
			db,
			targetPath,
			runtimeConfig,
			appliedProjects.catalog,
		);
		assertGlobalHardSafety(db, { operation: 'write' });
		await commitUpgradeTransaction(db, executionOptions);
		transactionOpen = false;
		db.close();
		db = undefined;
		advanceCutover(journalPath, journal, 'db_committed');
		// scope map 只服务于一次性迁移。成功提交数据库后清理整个临时目录；
		// 后续验证失败时，外层 cutover 仍会从精确写集备份恢复它。
		removeMigrationArtifacts(targetPath, finalConfig);
		const verificationDb = new Database(dbPath, { readonly: true, fileMustExist: true });
		try {
			assertSchemaV4(verificationDb);
		} finally {
			verificationDb.close();
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
		const runtime = validateRuntimeContract({
			vaultRoot: targetPath,
			runtimeVersion: VERSION,
			verifyManagedAssets: true,
			allowActiveCutover: true,
			expectedJournalState: 'verified',
		});
		if (!runtime.ok) throw new Error(runtime.issues.join('\n'));
		advanceCutover(journalPath, journal, 'opened');
		const openedRuntime = validateRuntimeContract({
			vaultRoot: targetPath,
			runtimeVersion: VERSION,
			verifyManagedAssets: true,
			allowActiveCutover: true,
			expectedJournalState: 'opened',
		});
		if (!openedRuntime.ok) throw new Error(openedRuntime.issues.join('\n'));
		retainOnlyCutoverBundle(targetPath, journal.cutover_id);
		releaseCutoverLock(targetPath, cutoverLock.token);
		for (const change of plan.projectIds.changes) {
			log(green('✔'), `已为项目写入稳定 id：${change.relativePath} → ${change.id}`);
		}
		for (const binding of plan.discoveredBindings) {
			log(green('✔'), `已自动绑定 repository：${binding.key} → ${binding.roots.join('、')}`);
		}
		log(green('✔'), bold('LifeOS vault upgraded atomically'));
		return {
			updated: [
				...new Set([
					...synced.updated,
					...plan.projectIds.changes.map((change) => change.relativePath),
				]),
			],
			skipped: synced.skipped,
			unchanged: synced.unchanged,
			journalPath,
			migratedItems,
		};
	} catch (error) {
		try {
			if (transactionOpen) db?.exec('ROLLBACK');
			transactionOpen = false;
			db?.close();
			db = undefined;
			if (vaultMutationStarted) {
				restoreVault(journal);
				assertVaultMatchesCutoverBackup(journal);
				advanceCutover(
					journalPath,
					journal,
					'restored',
					error instanceof Error ? error.message : String(error),
				);
				retainOnlyCutoverBundle(targetPath, journal.cutover_id);
			} else {
				advanceCutover(
					journalPath,
					journal,
					'restored',
					error instanceof Error ? error.message : String(error),
				);
				discardCutoverBundle(targetPath, journal.cutover_id);
			}
			releaseCutoverLock(targetPath, cutoverLock.token);
		} catch (restoreError) {
			throw new AggregateError(
				[error, restoreError],
				'升级失败且自动恢复失败；请使用 cutover bundle 手工恢复',
			);
		}
		throw error;
	} finally {
		if (transactionOpen) {
			try {
				db?.exec('ROLLBACK');
			} catch {
				// 主错误或恢复结果优先。
			}
		}
		db?.close();
	}
}
