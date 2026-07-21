/**
 * core.ts — LifeOS V2 核心编排层。
 *
 * 所有非 bootstrap 调用在打开数据库前校验契约版本。数据库连接仍按调用创建，
 * 但配置缓存按 Vault 根目录隔离，避免跨 Vault 复用运行时状态。
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { refreshUserprofile } from './active-docs/index.js';
import { VERSION } from './cli/utils/version.js';
import { type VaultConfig, getOrCreateVaultConfig } from './config.js';
import { assertNoActiveCutover } from './cutover-lock.js';
import { initDb } from './db/schema.js';
import {
	CONTRACT_VERSION,
	assertRuntimeContract,
} from './runtime-contract.js';
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
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	return db;
}

function resolveDbAndVault(dbPath?: string, vaultRoot?: string): ResolvedRuntime {
	const vault = vaultRoot || process.env.LIFEOS_VAULT_ROOT || process.cwd();
	if (!existsSync(join(vault, 'lifeos.yaml'))) {
		throw new Error(`缺少 LifeOS 最终配置：${join(vault, 'lifeos.yaml')}`);
	}
	assertNoActiveCutover(vault);
	const config = getOrCreateVaultConfig(vault);
	const resolvedDbPath = dbPath || config.dbPath();
	if (!existsSync(resolvedDbPath)) {
		throw new Error(`缺少 LifeOS Schema V4 数据库：${resolvedDbPath}`);
	}
	const db = openDb(resolvedDbPath);

	try {
		initDb(db);
		assertRuntimeContract({
			vaultRoot: vault,
			db,
			runtimeVersion: VERSION,
			verifyManagedAssets: true,
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

function refreshMemoryAuditView(db: Database.Database, vaultRoot: string): void {
	try {
		refreshUserprofile(db, vaultRoot);
	} catch (error) {
		console.warn('[lifeos] UserProfile 审计视图刷新失败：', error);
	}
}

export function memoryStartup(opts: {
	dbPath?: string;
	vaultRoot?: string;
}): StartupResult {
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault }) => runStartup(db, vault));
}

export function memoryStartupMaintenance(
	opts: ContractRequest & {
		dbPath?: string;
		vaultRoot?: string;
	},
): StartupMaintenanceResult {
	assertContractVersion(opts.contractVersion);
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault }) =>
		runStartupMaintenance(db, vault),
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
			throw new Error(`Unresolved memory scope: ${unresolved.scope.type}:${unresolved.scope.key}`);
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
		refreshMemoryAuditView(db, vault);
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
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault }) => {
		const input: ArchiveMemoryItemInput = { itemId: opts.itemId, reason: opts.reason };
		const result = archiveMemoryItem(db, input);
		refreshMemoryAuditView(db, vault);
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
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault }) =>
		notifyFileChanged(db, vault, opts.filePath, opts.previousFilePath),
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
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault }) =>
		notifyFilesChanged(db, vault, opts.filePaths),
	);
}
