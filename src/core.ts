/**
 * core.ts — 核心调度层。
 *
 * Thin orchestration wrappers over service modules.
 * Each function opens a DB, calls services, closes DB, and returns results.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { activeDocCitations, refreshActiveDoc } from './active-docs/index.js';
import { type VaultConfig, getOrCreateVaultConfig } from './config.js';
import { initDb } from './db/schema.js';
import {
	type AutoCaptureItem,
	type AutoCaptureResult,
	type LogEventResult,
	type NotifyFileChangedResult,
	autoCaptureEvents,
	buildAutoSessionBridge,
	collectSessionBridgeSeedEvents,
	latestSessionBridge,
	logEvent,
	notifyFileChanged,
} from './services/capture.js';
import { processEnhanceQueue } from './services/enhance.js';
import {
	type SessionEvent,
	type VaultQueryResult,
	queryRecentEvents,
	queryVaultIndex,
} from './services/retrieval.js';
import { runStartup } from './services/startup.js';
import {
	type ActiveDocTarget,
	type CheckpointResult,
	type CitationsResult,
	type StartupResult,
	VALID_ENTRY_TYPES,
} from './types.js';
import { ensureContextPolicyExists } from './utils/context-policy.js';
import { resolveSessionId } from './utils/shared.js';

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
		const resolvedSessionId = resolveSessionId(opts.sessionId);
		ensureContextPolicyExists(vault);
		return runStartup(db, vault, resolvedSessionId);
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
		return queryVaultIndex(
			db,
			opts.query || '',
			opts.filters || null,
			opts.limit || 10,
		);
	});
}

// ─── 3. memory_recent ─────────────────────────────────────────────────────────

export function memoryRecent(opts: {
	dbPath?: string;
	days?: number;
	entryType?: string;
	scope?: string;
	query?: string;
	limit?: number;
	vaultRoot?: string;
}): { events: SessionEvent[] } {
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db }) => {
		return queryRecentEvents(db, {
			days: opts.days || 14,
			entryType: opts.entryType || null,
			scope: opts.scope || null,
			query: opts.query || null,
			limit: opts.limit || 20,
		});
	});
}

// ─── 4. memory_log ────────────────────────────────────────────────────────────

export function memoryLog(opts: {
	dbPath?: string;
	vaultRoot?: string;
	entryType: string;
	importance: number;
	summary: string;
	scope?: string;
	sessionId?: string;
	skillName?: string;
	detail?: string;
	sourceRefs?: string[];
	relatedFiles?: string[];
	relatedEntities?: string[];
	supersedes?: string;
	slotKey?: string;
}): LogEventResult {
	if (!VALID_ENTRY_TYPES.has(opts.entryType)) {
		throw new Error(`Invalid entry_type: ${opts.entryType}`);
	}
	if (opts.importance < 1 || opts.importance > 5) {
		throw new Error(`importance must be 1-5, got: ${opts.importance}`);
	}
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault }) => {
		const result = logEvent(db, {
			entryType: opts.entryType,
			importance: opts.importance,
			summary: opts.summary,
			scope: opts.scope,
			sessionId: opts.sessionId,
			skillName: opts.skillName,
			detail: opts.detail,
			sourceRefs: opts.sourceRefs,
			relatedFiles: opts.relatedFiles,
			relatedEntities: opts.relatedEntities,
			supersedes: opts.supersedes,
			slotKey: opts.slotKey,
		});

		// 即时刷新：仅对有 slotKey 的偏好/纠错/决策触发
		if (opts.slotKey && ['decision', 'correction', 'preference'].includes(opts.entryType)) {
			if (opts.entryType === 'decision') {
				refreshActiveDoc(db, vault, 'TaskBoard', { section: 'decisions' });
			} else {
				const section = opts.entryType === 'preference' ? 'preferences' : 'corrections';
				refreshActiveDoc(db, vault, 'UserProfile', { section });
			}
		}

		return result;
	});
}

// ─── 5. memory_auto_capture ───────────────────────────────────────────────────

export function memoryAutoCapture(opts: {
	dbPath?: string;
	vaultRoot?: string;
	corrections?: AutoCaptureItem[];
	decisions?: AutoCaptureItem[];
	preferences?: AutoCaptureItem[];
	sessionId?: string;
}): AutoCaptureResult {
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault }) => {
		const result = autoCaptureEvents(
			db,
			{
				corrections: opts.corrections,
				decisions: opts.decisions,
				preferences: opts.preferences,
			},
			opts.sessionId,
		);

		// 批量写入后统一刷新活文档
		const hasPrefsOrCorrs = (opts.preferences?.length ?? 0) > 0 || (opts.corrections?.length ?? 0) > 0;
		const hasDecisions = (opts.decisions?.length ?? 0) > 0;

		if (hasPrefsOrCorrs) {
			refreshActiveDoc(db, vault, 'UserProfile', { section: 'preferences' });
			refreshActiveDoc(db, vault, 'UserProfile', { section: 'corrections' });
		}
		if (hasDecisions) {
			refreshActiveDoc(db, vault, 'TaskBoard', { section: 'decisions' });
		}

		return result;
	});
}

// ─── 6. memory_notify ─────────────────────────────────────────────────────────

export function memoryNotify(opts: {
	dbPath?: string;
	vaultRoot?: string;
	filePath: string;
}): NotifyFileChangedResult {
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault }) => {
		return notifyFileChanged(db, vault, opts.filePath);
	});
}

// ─── 7. memory_checkpoint ─────────────────────────────────────────────────────

export function memoryCheckpoint(opts: {
	dbPath?: string;
	vaultRoot?: string;
	sessionId?: string;
}): CheckpointResult {
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault }) => {
		const resolvedSessionId = resolveSessionId(opts.sessionId);
		const closedAt = new Date().toISOString();

		// Check for session bridge
		let sessionBridge = latestSessionBridge(db, resolvedSessionId)?.summary || null;
		if (!sessionBridge) {
			const seeds = collectSessionBridgeSeedEvents(db, resolvedSessionId);
			const autoBridge = buildAutoSessionBridge(seeds);
			if (autoBridge && autoBridge !== '上次会话无关键事件记录。') {
				logEvent(db, {
					entryType: 'session_bridge',
					importance: 4,
					summary: autoBridge,
					sessionId: resolvedSessionId,
				});
				sessionBridge = autoBridge;
			}
		}

		// Refresh active docs
		refreshActiveDoc(db, vault, 'TaskBoard');
		refreshActiveDoc(db, vault, 'UserProfile');

		// Process enhance queue
		const enhanceResult = processEnhanceQueue(db, vault, 5);

		// Close session
		db.prepare(`
      INSERT INTO session_state (session_id, started_at, last_seen_at, closed_at, close_status)
      VALUES (?, ?, ?, ?, 'checkpoint')
      ON CONFLICT(session_id) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        closed_at = excluded.closed_at,
        close_status = excluded.close_status
    `).run(resolvedSessionId, closedAt, closedAt, closedAt);

		const warnings: string[] = [];
		if (!sessionBridge) warnings.push('本次会话尚未记录 session_bridge');

		return {
			session_bridge_found: sessionBridge !== null,
			enhanced_files: enhanceResult.processed,
			active_docs_updated: true,
			session_closed: true,
			warnings,
		};
	});
}

// ─── 8. memory_citations ─────────────────────────────────────────────────────

export function memoryCitations(opts: {
	dbPath?: string;
	vaultRoot?: string;
	target: ActiveDocTarget;
	section?: string;
	keyword?: string;
}): CitationsResult {
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db }) => {
		return activeDocCitations(db, opts.target, {
			section: opts.section,
			keyword: opts.keyword,
		});
	});
}

