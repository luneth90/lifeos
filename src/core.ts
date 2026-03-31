/**
 * core.ts — 核心调度层。
 *
 * Thin orchestration wrappers over service modules.
 * Each function opens a DB, calls services, closes DB, and returns results.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import {
	refreshTaskboard,
	refreshUserprofile,
	taskboardCitations,
	userprofileCitations,
} from './active-docs/index.js';
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
import { type SkillContextResult, buildSkillContext } from './skill-context/index.js';
import {
	ACTIVE_DOC_TARGETS,
	type ActiveDocTarget,
	type CheckpointResult,
	type CitationsResult,
	type RefreshResult,
	type SkillCompleteResult,
	type StartupResult,
	VALID_ENTRY_TYPES,
} from './types.js';
import {
	type ScenePolicy,
	ensureContextPolicyExists,
	loadContextPolicy,
	resolveScenePolicy,
} from './utils/context-policy.js';
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

function resolveScene(vault: string, scene?: string): ScenePolicy | null {
	if (!scene) return null;
	const policy = loadContextPolicy(vault);
	return resolveScenePolicy(policy, scene);
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
	scene?: string;
	vaultRoot?: string;
}): { results: VaultQueryResult[]; scene_policy?: ScenePolicy } {
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault }) => {
		const scenePolicy = resolveScene(vault, opts.scene);
		const result = queryVaultIndex(
			db,
			opts.query || '',
			opts.filters || null,
			opts.limit || 10,
			scenePolicy,
		);
		return scenePolicy ? { ...result, scene_policy: scenePolicy } : result;
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
	scene?: string;
	vaultRoot?: string;
}): { events: SessionEvent[]; scene_policy?: ScenePolicy } {
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault }) => {
		const scenePolicy = resolveScene(vault, opts.scene);
		const result = queryRecentEvents(db, {
			days: opts.days || 14,
			entryType: opts.entryType || null,
			scope: opts.scope || null,
			query: opts.query || null,
			limit: opts.limit || 20,
			scenePolicy,
		});
		return scenePolicy ? { ...result, scene_policy: scenePolicy } : result;
	});
}

// ─── 4. memory_log ────────────────────────────────────────────────────────────

export function memoryLog(opts: {
	dbPath?: string;
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
}): LogEventResult {
	if (!VALID_ENTRY_TYPES.has(opts.entryType)) {
		throw new Error(`Invalid entry_type: ${opts.entryType}`);
	}
	if (opts.importance < 1 || opts.importance > 5) {
		throw new Error(`importance must be 1-5, got: ${opts.importance}`);
	}
	return withResolvedDb(opts.dbPath, undefined, ({ db }) => {
		return logEvent(db, {
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
		});
	});
}

// ─── 5. memory_auto_capture ───────────────────────────────────────────────────

export function memoryAutoCapture(opts: {
	dbPath?: string;
	corrections?: AutoCaptureItem[];
	decisions?: AutoCaptureItem[];
	preferences?: AutoCaptureItem[];
	sessionId?: string;
}): AutoCaptureResult {
	return withResolvedDb(opts.dbPath, undefined, ({ db }) => {
		return autoCaptureEvents(
			db,
			{
				corrections: opts.corrections,
				decisions: opts.decisions,
				preferences: opts.preferences,
			},
			opts.sessionId,
		);
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
		refreshTaskboard(db, vault);
		refreshUserprofile(db, vault);

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

// ─── 8. memory_skill_complete ─────────────────────────────────────────────────

export function memorySkillComplete(opts: {
	dbPath?: string;
	vaultRoot?: string;
	skillName: string;
	summary: string;
	scope?: string;
	importance?: number;
	detail?: string;
	relatedFiles?: string[];
	relatedEntities?: string[];
	contextSources?: string[];
	refreshTargets?: string[];
}): SkillCompleteResult {
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault }) => {
		const logResult = logEvent(db, {
			entryType: 'skill_completion',
			importance: opts.importance || 4,
			summary: opts.summary,
			scope: opts.scope,
			skillName: opts.skillName,
			detail: opts.detail,
			relatedFiles: opts.relatedFiles,
			relatedEntities: opts.relatedEntities,
		});

		// Notify related files
		for (const fp of opts.relatedFiles || []) {
			notifyFileChanged(db, vault, fp);
		}

		// Refresh targets
		const targets = opts.refreshTargets || ['TaskBoard', 'UserProfile'];
		for (const target of targets) {
			if (target === 'TaskBoard') refreshTaskboard(db, vault);
			else if (target === 'UserProfile') refreshUserprofile(db, vault);
		}

		return {
			event_id: logResult.eventId,
			timestamp: logResult.timestamp,
			logged: true,
			skill_name: opts.skillName,
		};
	});
}

// ─── 9. memory_refresh ────────────────────────────────────────────────────────

export function memoryRefresh(opts: {
	dbPath?: string;
	vaultRoot?: string;
	target: ActiveDocTarget;
	section?: string;
	preserveManual?: boolean;
}): RefreshResult {
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault }) => {
		if (opts.target === 'TaskBoard') {
			return refreshTaskboard(db, vault, {
				section: opts.section,
				preserveManual: opts.preserveManual,
			});
		}
		if (opts.target === 'UserProfile') {
			return refreshUserprofile(db, vault, {
				section: opts.section,
				preserveManual: opts.preserveManual,
			});
		}
		throw new Error(
			`Unsupported target: ${opts.target}. Supported: ${[...ACTIVE_DOC_TARGETS].join(', ')}`,
		);
	});
}

// ─── 10. memory_citations ─────────────────────────────────────────────────────

export function memoryCitations(opts: {
	dbPath?: string;
	vaultRoot?: string;
	target: ActiveDocTarget;
	section?: string;
	keyword?: string;
}): CitationsResult {
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault }) => {
		if (opts.target === 'TaskBoard') {
			return taskboardCitations(db, {
				section: opts.section,
				keyword: opts.keyword,
			});
		}
		if (opts.target === 'UserProfile') {
			return userprofileCitations(db, {
				section: opts.section,
				keyword: opts.keyword,
			});
		}
		throw new Error(`Unsupported target: ${opts.target}`);
	});
}

// ─── 11. memory_skill_context ─────────────────────────────────────────────────

export function memorySkillContext(opts: {
	dbPath?: string;
	vaultRoot?: string;
	skillProfile: string;
	relatedFiles?: string[];
	query?: string;
	limit?: number;
}): SkillContextResult {
	return withResolvedDb(opts.dbPath, opts.vaultRoot, ({ db, vault }) => {
		return buildSkillContext(db, vault, {
			skillProfile: opts.skillProfile,
			relatedFiles: opts.relatedFiles,
			query: opts.query,
			limit: opts.limit,
		});
	});
}
