/**
 * core.ts — Core orchestration layer.
 *
 * Thin orchestration wrappers over service modules.
 * Each function opens a DB, calls services, closes DB, and returns results.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { refreshActiveDoc } from './active-docs/index.js';
import { type VaultConfig, getOrCreateVaultConfig } from './config.js';
import { initDb } from './db/schema.js';
import {
	type NotifyFileChangedResult,
	type UpsertRuleResult,
	notifyFileChanged,
	upsertRule,
} from './services/capture.js';
import { type VaultQueryResult, queryVaultIndex } from './services/retrieval.js';
import { runStartup } from './services/startup.js';
import type { StartupResult } from './types.js';
// ─── Internal helpers ─────────────────────────────────────────────────────────

function openDb(dbPath: string): Database.Database {
	mkdirSync(dirname(dbPath), { recursive: true });
	const db = new Database(dbPath);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	return db;
}

function resolveDbAndVault(
	dbPath?: string,
	vaultRoot?: string,
): { db: Database.Database; vault: string; config: VaultConfig } {
	const vault = vaultRoot || process.env.LIFEOS_VAULT_ROOT || process.cwd();
	const config = getOrCreateVaultConfig(vault);
	const resolvedDbPath = dbPath || config.dbPath().toString();
	const db = openDb(resolvedDbPath);
	initDb(db);
	return { db, vault, config };
}

function withResolvedDb<T>(
	dbPath: string | undefined,
	vaultRoot: string | undefined,
	fn: (ctx: { db: Database.Database; vault: string; config: VaultConfig }) => T,
): T {
	const ctx = resolveDbAndVault(dbPath, vaultRoot);
	try {
		return fn(ctx);
	} finally {
		ctx.db.close();
	}
}

// ─── 1. memory_startup ────────────────────────────────────────────────────────

export function memoryStartup(opts: {
	dbPath?: string;
	vaultRoot?: string;
	sessionId?: string;
}): StartupResult {
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault }) => {
		return runStartup(db, vault);
	});
}

// ─── 2. memory_query ──────────────────────────────────────────────────────────

export function memoryQuery(opts: {
	dbPath?: string;
	query?: string;
	filters?: Record<string, string>;
	limit?: number;
	vaultRoot?: string;
}): { results: VaultQueryResult[] } {
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db }) => {
		return queryVaultIndex(db, opts.query || '', opts.filters || null, opts.limit || 10);
	});
}

// ─── 3. memory_log ──────────────────────────────────────────────────────────

export function memoryLog(opts: {
	dbPath?: string;
	vaultRoot?: string;
	slotKey: string;
	content: string;
	source?: 'preference' | 'correction';
	relatedFiles?: string[];
	expiresAt?: string;
	refreshActiveDoc?: boolean;
}): UpsertRuleResult {
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault }) => {
		const result = upsertRule(db, {
			slotKey: opts.slotKey,
			content: opts.content,
			source: opts.source,
			relatedFiles: opts.relatedFiles,
			expiresAt: opts.expiresAt,
		});

		if (opts.refreshActiveDoc !== false) {
			// Refresh the matching UserProfile section after upsert
			const section = opts.slotKey.startsWith('profile:') ? 'profile-summary' : 'rules';
			refreshActiveDoc(db, vault, 'UserProfile', { section });
		}

		return result;
	});
}

// ─── 4. memory_notify ─────────────────────────────────────────────────────────

export function memoryNotify(opts: {
	dbPath?: string;
	vaultRoot?: string;
	filePath: string;
}): NotifyFileChangedResult {
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault }) => {
		return notifyFileChanged(db, vault, opts.filePath);
	});
}
