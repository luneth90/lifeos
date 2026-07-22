/**
 * core.ts — LifeOS V2 核心编排层。
 *
 * 所有非 bootstrap 调用在打开数据库前校验契约版本。数据库连接与配置快照均按调用创建，
 * 同一次调用显式传播同一份配置，避免 singleton 污染或中途重读产生不一致。
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { refreshUserprofile } from './active-docs/index.js';
import { VERSION } from './cli/utils/version.js';
import { type VaultConfig, resolveConfig } from './config.js';
import { assertNoActiveCutover } from './cutover-lock.js';
import { assertSchemaV4 } from './db/schema.js';
import { CONTRACT_VERSION, assertRuntimeContract } from './runtime-contract.js';
import { notifyFileChanged, notifyFilesChanged } from './services/capture.js';
import { buildMemoryContext } from './services/context-router.js';
import { archiveMemoryItem, listMemoryItems, upsertMemoryItem } from './services/memory-items.js';
import { type VaultQueryResult, queryVaultIndex } from './services/retrieval.js';
import { resolveMemoryScopes } from './services/scope-resolver.js';
import { runStartup, runStartupMaintenance } from './services/startup.js';
import type {
	ArchiveMemoryItemInput,
	ContextRequest,
	ContextResponse,
	ListMemoryItemsInput,
	MemoryEnforcement,
	MemoryItemKind,
	MemoryScope,
	MemorySource,
	ScopedMemoryItem,
	StartupMaintenanceResult,
	StartupResult,
	UpsertMemoryItemResult,
} from './types.js';
import { assertVaultPathSafe, canonicalVaultRoot } from './utils/safe-path.js';

interface ResolvedRuntime {
	db: Database.Database;
	vault: string;
	config: VaultConfig;
}

export interface ContractRequest {
	contractVersion: number;
}

function assertContractVersion(contractVersion: number): void {
	if (contractVersion !== CONTRACT_VERSION) {
		throw new Error(
			`Unsupported LifeOS contract_version: ${String(contractVersion)}; expected ${CONTRACT_VERSION}`,
		);
	}
}

function openDb(dbPath: string): Database.Database {
	const db = new Database(dbPath, { fileMustExist: true });
	try {
		assertSchemaV4(db);
		db.pragma('journal_mode = WAL');
		db.pragma('foreign_keys = ON');
		return db;
	} catch (error) {
		db.close();
		throw error;
	}
}

function resolveDbAndVault(dbPath?: string, vaultRoot?: string): ResolvedRuntime {
	const vault = canonicalVaultRoot(vaultRoot || process.env.LIFEOS_VAULT_ROOT || process.cwd());
	const yamlPath = join(vault, 'lifeos.yaml');
	if (!existsSync(yamlPath)) {
		throw new Error(`缺少 LifeOS 最终配置：${yamlPath}`);
	}
	assertVaultPathSafe(vault, yamlPath);
	assertNoActiveCutover(vault);
	const config = resolveConfig(vault);
	const configuredDbPath = assertVaultPathSafe(vault, config.dbPath());
	const resolvedDbPath = dbPath ? assertVaultPathSafe(vault, dbPath) : configuredDbPath;
	if (resolvedDbPath !== configuredDbPath) {
		throw new Error('dbPath 必须指向 lifeos.yaml 配置的 Vault 内数据库');
	}
	if (!existsSync(resolvedDbPath)) {
		throw new Error(`缺少 LifeOS Schema V4 数据库：${resolvedDbPath}`);
	}
	const db = openDb(resolvedDbPath);

	try {
		assertRuntimeContract({
			vaultRoot: vault,
			db,
			config,
			runtimeVersion: VERSION,
			verifyManagedAssets: false,
		});
		return { db, vault, config };
	} catch (error) {
		db.close();
		throw error;
	}
}

function withResolvedDb<T>(
	dbPath: string | undefined,
	vaultRoot: string | undefined,
	fn: (ctx: ResolvedRuntime) => T,
): T {
	const ctx = resolveDbAndVault(dbPath, vaultRoot);
	try {
		return fn(ctx);
	} finally {
		ctx.db.close();
	}
}

function refreshMemoryAuditView(
	db: Database.Database,
	vaultRoot: string,
	config: VaultConfig,
): void {
	try {
		refreshUserprofile(db, vaultRoot, { config });
	} catch (error) {
		console.warn('[lifeos] UserProfile 审计视图刷新失败：', error);
	}
}

export function memoryStartup(opts: {
	dbPath?: string;
	vaultRoot?: string;
}): StartupResult {
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault, config }) =>
		runStartup(db, vault, config),
	);
}

export function memoryStartupMaintenance(
	opts: ContractRequest & {
		dbPath?: string;
		vaultRoot?: string;
	},
): StartupMaintenanceResult {
	assertContractVersion(opts.contractVersion);
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault, config }) =>
		runStartupMaintenance(db, vault, config),
	);
}

export function memoryQuery(
	opts: ContractRequest & {
		dbPath?: string;
		query?: string;
		filters?: Record<string, string>;
		limit?: number;
		vaultRoot?: string;
	},
): { results: VaultQueryResult[] } {
	assertContractVersion(opts.contractVersion);
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db }) =>
		queryVaultIndex(db, opts.query || '', opts.filters || null, opts.limit || 10),
	);
}

export function memoryContext(
	opts: ContractRequest & {
		dbPath?: string;
		vaultRoot?: string;
		request: ContextRequest;
	},
): ContextResponse {
	assertContractVersion(opts.contractVersion);
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault, config }) =>
		buildMemoryContext(db, vault, opts.request, { config }),
	);
}

export function memoryLog(
	opts: ContractRequest & {
		dbPath?: string;
		vaultRoot?: string;
		slotKey: string;
		content: string;
		scope: MemoryScope;
		itemKind: MemoryItemKind;
		priority?: number;
		enforcement?: MemoryEnforcement;
		source?: MemorySource;
		relatedFiles?: string[];
		expiresAt?: string | null;
	},
): UpsertMemoryItemResult {
	assertContractVersion(opts.contractVersion);
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault, config }) => {
		const resolution = resolveMemoryScopes(db, [opts.scope], {
			config,
			allowCreate: true,
			requireRepositoryBinding: true,
		});
		if (resolution.unresolvedScopes.length > 0) {
			const unresolved = resolution.unresolvedScopes[0];
			if (unresolved.reason === 'unknown_repository') {
				const yamlPath = join(vault, 'lifeos.yaml');
				const repositoryId = JSON.stringify(unresolved.scope.key);
				throw new Error(
					`unknown_repository：repository scope ${repositoryId} 尚未绑定。请在 ${yamlPath} 现有的 memory.repository_bindings 下合并以下条目，并把占位符替换为真实 Git 根目录的绝对路径：\n` +
						`${repositoryId}:\n  - "/请替换为真实仓库绝对路径"`,
				);
			}
			throw new Error(
				`无法解析 memory scope：${unresolved.scope.type}:${unresolved.scope.key}（${unresolved.reason}）`,
			);
		}
		const scope = resolution.resolvedScopes[0];
		if (!scope) throw new Error('Unresolved memory scope');

		const result = upsertMemoryItem(db, {
			slotKey: opts.slotKey,
			content: opts.content,
			scope,
			itemKind: opts.itemKind,
			priority: opts.priority,
			enforcement: opts.enforcement,
			source: opts.source,
			relatedFiles: opts.relatedFiles,
			expiresAt: opts.expiresAt,
		});
		refreshMemoryAuditView(db, vault, config);
		return result;
	});
}

export function memoryRules(
	opts: ContractRequest & {
		dbPath?: string;
		vaultRoot?: string;
		filters?: ListMemoryItemsInput;
	},
): { items: ScopedMemoryItem[] } {
	assertContractVersion(opts.contractVersion);
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db }) => ({
		items: listMemoryItems(db, opts.filters),
	}));
}

export function memoryForget(
	opts: ContractRequest & {
		dbPath?: string;
		vaultRoot?: string;
		itemId: number;
		reason: string;
	},
): ScopedMemoryItem {
	assertContractVersion(opts.contractVersion);
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault, config }) => {
		const input: ArchiveMemoryItemInput = { itemId: opts.itemId, reason: opts.reason };
		const result = archiveMemoryItem(db, input);
		refreshMemoryAuditView(db, vault, config);
		return result;
	});
}

export function memoryNotify(
	opts: ContractRequest & {
		dbPath?: string;
		vaultRoot?: string;
		filePath: string;
		previousFilePath?: string;
	},
) {
	assertContractVersion(opts.contractVersion);
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault, config }) =>
		notifyFileChanged(db, vault, opts.filePath, opts.previousFilePath, config),
	);
}

export function memoryNotifyBatch(
	opts: ContractRequest & {
		dbPath?: string;
		vaultRoot?: string;
		filePaths: string[];
	},
) {
	assertContractVersion(opts.contractVersion);
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault, config }) =>
		notifyFilesChanged(db, vault, opts.filePaths, config),
	);
}
