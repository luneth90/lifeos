/**
 * capture.ts — 捕获服务。
 *
 * Handles event logging, file change notifications, auto-capture,
 * and session bridge helpers.
 */

import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type Database from 'better-sqlite3';
import { ENTRY_TYPE_LABELS, KEY_ENTRY_TYPES, daysAgo } from '../types.js';
import { buildSearchTokens } from '../utils/segmenter.js';
import {
	inferTemporaryPreference,
	normalizeRuleSummary,
	parseDetailObject,
	resolveRuleKey,
	resolveSessionId,
} from '../utils/shared.js';
import { indexSingleFile } from '../utils/vault-indexer.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LogEventOpts {
	entryType: string;
	importance: number;
	summary: string;
	scope?: string;
	sessionId?: string;
	skillName?: string;
	detail?: string | null;
	sourceRefs?: string[] | null;
	relatedFiles?: string[] | null;
	relatedEntities?: string[] | null;
	supersedes?: string | null;
}

export interface LogEventResult {
	eventId: string;
	timestamp: string;
	status: string;
}

export interface AutoCaptureItem {
	summary: string;
	detail?: string;
	importance?: number;
	scope?: string;
	relatedFiles?: string[];
}

export interface AutoCapturePayload {
	corrections?: AutoCaptureItem[];
	decisions?: AutoCaptureItem[];
	preferences?: AutoCaptureItem[];
}

export interface CapturedEventRef {
	eventId: string;
	entryType: string;
	summary: string;
}

export interface AutoCaptureResult {
	capturedCount: number;
	events: CapturedEventRef[];
}

export interface SessionBridgeRow {
	eventId: string;
	sessionId: string;
	summary: string;
	detail: string | null;
	timestamp: string;
}

export interface SeedEvent {
	entryType: string;
	summary: string;
	importance?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a 16-char entry hash from entry type, summary, and normalized detail.
 */
function buildEntryHash(entryType: string, summary: string, normalizedDetail: string): string {
	const raw = `${entryType}:${summary}:${normalizedDetail}`;
	return createHash('sha256').update(raw, 'utf-8').digest('hex').slice(0, 16);
}

/**
 * Normalize detail for rule events (decision/correction/preference).
 * Adds content, normalized_summary, rule_key, structured_by fields.
 * For preferences, also adds temporary inference fields.
 */
function normalizeRuleEventDetail(
	entryType: string,
	summary: string,
	rawDetail: string | null | undefined,
): { detailStr: string; ruleKey: string | null } {
	const detailObj = parseDetailObject(rawDetail);
	const normalizedSummary = normalizeRuleSummary(summary);
	const ruleKey = resolveRuleKey(entryType, summary, detailObj);

	const normalized: Record<string, unknown> = {
		...detailObj,
		content: rawDetail ?? summary,
		normalized_summary: normalizedSummary,
		rule_key: ruleKey,
		structured_by: 'service_v05',
	};

	// For preference events, infer temporary status
	if (entryType === 'preference') {
		const tempResult = inferTemporaryPreference(summary, detailObj);
		normalized.temporary = tempResult.temporary;
		if (tempResult.expiresInDays != null) {
			normalized.expires_in_days = tempResult.expiresInDays;
		}
		if (tempResult.expiresAt != null) {
			normalized.expires_at = tempResult.expiresAt;
		}
		if (tempResult.temporarySource != null) {
			normalized.temporary_source = tempResult.temporarySource;
		}
	}

	return { detailStr: JSON.stringify(normalized), ruleKey };
}

/**
 * Find the latest event_id with the given rule_key (excluding superseded ones).
 */
function findLatestByRuleKey(
	db: Database.Database,
	ruleKey: string,
	excludeEventId?: string,
): string | null {
	let sql = `
    SELECT event_id FROM session_log
    WHERE rule_key = ?
  `;
	const params: unknown[] = [ruleKey];

	if (excludeEventId) {
		sql += ' AND event_id != ?';
		params.push(excludeEventId);
	}

	sql += ' ORDER BY timestamp DESC LIMIT 1';

	const row = db.prepare(sql).get(params) as { event_id: string } | undefined;
	return row ? row.event_id : null;
}

// ─── logEvent ─────────────────────────────────────────────────────────────────

/**
 * Log a single event into session_log.
 * Handles detail normalization for rule events and auto-supersedes.
 */
export function logEvent(db: Database.Database, opts: LogEventOpts): LogEventResult {
	const {
		entryType,
		importance,
		summary,
		scope,
		sessionId,
		skillName,
		sourceRefs,
		relatedFiles,
		relatedEntities,
		supersedes: explicitSupersedes,
	} = opts;

	const resolvedSessionId = resolveSessionId(sessionId);
	const eventId = randomUUID();
	const timestamp = new Date().toISOString();

	// Normalize detail and resolve rule_key for rule events
	let finalDetail: string | null = opts.detail ?? null;
	let ruleKey: string | null = null;

	if (KEY_ENTRY_TYPES.has(entryType)) {
		const normalized = normalizeRuleEventDetail(entryType, summary, opts.detail);
		finalDetail = normalized.detailStr;
		ruleKey = normalized.ruleKey;
	}

	// Build entry hash
	const entryHash = buildEntryHash(entryType, summary, finalDetail ?? '');

	// Build search hints
	const searchHints = buildSearchTokens(
		summary,
		finalDetail,
		relatedEntities ?? null,
		scope ?? null,
	);

	// Serialize arrays
	const sourceRefsJson = sourceRefs ? JSON.stringify(sourceRefs) : null;
	const relatedFilesJson = relatedFiles ? JSON.stringify(relatedFiles) : null;
	const relatedEntitiesJson = relatedEntities ? JSON.stringify(relatedEntities) : null;

	// Auto-supersede: find latest event with same rule_key
	let supersedesId = explicitSupersedes ?? null;
	if (!supersedesId && ruleKey) {
		supersedesId = findLatestByRuleKey(db, ruleKey, eventId);
	}

	db.prepare(`
    INSERT INTO session_log
    (event_id, session_id, timestamp, entry_type, importance, scope, skill_name,
     summary, detail, source_refs, related_files, related_entities,
     supersedes, entry_hash, search_hints, rule_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
		eventId,
		resolvedSessionId,
		timestamp,
		entryType,
		importance,
		scope ?? null,
		skillName ?? null,
		summary,
		finalDetail,
		sourceRefsJson,
		relatedFilesJson,
		relatedEntitiesJson,
		supersedesId,
		entryHash,
		searchHints,
		ruleKey,
	);

	return { eventId, timestamp, status: 'ok' };
}

// ─── autoCaptureEvents ────────────────────────────────────────────────────────

/** Default importance per bucket type */
const BUCKET_IMPORTANCE: Record<string, number> = {
	correction: 4,
	decision: 4,
	preference: 3,
};

/**
 * Batch capture corrections/decisions/preferences.
 * Deduplicates by entry_hash across both existing DB records and current batch.
 */
export function autoCaptureEvents(
	db: Database.Database,
	payload: AutoCapturePayload,
	sessionId?: string,
): AutoCaptureResult {
	const buckets: Array<{ entryType: string; items: AutoCaptureItem[] }> = [
		{ entryType: 'correction', items: payload.corrections ?? [] },
		{ entryType: 'decision', items: payload.decisions ?? [] },
		{ entryType: 'preference', items: payload.preferences ?? [] },
	];

	const captured: CapturedEventRef[] = [];
	// Track hashes seen in this batch to deduplicate within the same call
	const batchHashes = new Set<string>();

	for (const { entryType, items } of buckets) {
		for (const item of items) {
			const summary = (item.summary ?? '').trim();
			if (!summary) continue;

			const importance = item.importance ?? BUCKET_IMPORTANCE[entryType] ?? 3;

			// Pre-compute the hash to check for duplicates
			// For rule events, detail gets normalized — compute approximate hash
			let previewDetail = item.detail ?? null;
			if (KEY_ENTRY_TYPES.has(entryType)) {
				const normalized = normalizeRuleEventDetail(entryType, summary, previewDetail);
				previewDetail = normalized.detailStr;
			}
			const hash = buildEntryHash(entryType, summary, previewDetail ?? '');

			// Skip if already seen in this batch
			if (batchHashes.has(hash)) continue;
			batchHashes.add(hash);

			// Skip if already exists in DB
			const existing = db
				.prepare('SELECT event_id FROM session_log WHERE entry_hash = ? LIMIT 1')
				.get([hash]) as { event_id: string } | undefined;
			if (existing) continue;

			const result = logEvent(db, {
				entryType,
				importance,
				summary,
				detail: item.detail,
				scope: item.scope,
				relatedFiles: item.relatedFiles,
				sessionId,
			});

			captured.push({ eventId: result.eventId, entryType, summary });
		}
	}

	return { capturedCount: captured.length, events: captured };
}

// ─── notifyFileChanged ────────────────────────────────────────────────────────

export interface NotifyFileChangedResult {
	action: string;
	filePath: string;
}

/**
 * Notify the system that a file has changed.
 * Re-indexes the file and updates the enhance queue if applicable.
 */
export function notifyFileChanged(
	db: Database.Database,
	vaultRoot: string,
	filePath: string,
): NotifyFileChangedResult {
	// Normalize to relative path
	const relPath = filePath.startsWith(vaultRoot)
		? relative(vaultRoot, filePath).replace(/\\/g, '/')
		: filePath.replace(/\\/g, '/');

	let indexResult: { status: string; filePath?: string; reason?: string };
	try {
		const dbPath = db.name; // better-sqlite3 exposes .name as the db file path
		indexResult = indexSingleFile(vaultRoot, dbPath, relPath);
	} catch {
		return { action: 'error', filePath: relPath };
	}

	if (indexResult.status === 'removed' || indexResult.status === 'skipped') {
		// Remove from enhance queue if present
		db.prepare('DELETE FROM enhance_queue WHERE file_path = ?').run(relPath);
		return { action: indexResult.status, filePath: relPath };
	}

	// File was indexed — check if it should be queued for enhancement
	if (indexResult.status === 'indexed') {
		try {
			// Check if file is already pending in enhance queue
			const existing = db
				.prepare("SELECT file_path FROM enhance_queue WHERE file_path = ? AND status = 'pending'")
				.get([relPath]) as { file_path: string } | undefined;

			if (!existing) {
				const now = new Date().toISOString();
				db.prepare(`
          INSERT OR REPLACE INTO enhance_queue
          (file_path, priority, queued_at, source, status, attempts)
          VALUES (?, ?, ?, 'notify', 'pending', 0)
        `).run(relPath, 5, now);
			}
		} catch (e) {
			console.warn('[lifeos] enhance queue update failed:', e);
		}

		return { action: 'indexed', filePath: relPath };
	}

	return { action: 'unchanged', filePath: relPath };
}

// ─── latestSessionBridge ─────────────────────────────────────────────────────

/**
 * Query the most recent session_bridge event.
 * Optionally filter by session_id.
 */
export function latestSessionBridge(
	db: Database.Database,
	sessionId?: string,
): SessionBridgeRow | null {
	let sql = `
    SELECT event_id, session_id, summary, detail, timestamp
    FROM session_log
    WHERE entry_type = 'session_bridge'
  `;
	const params: unknown[] = [];

	if (sessionId) {
		sql += ' AND session_id = ?';
		params.push(sessionId);
	}

	sql += ' ORDER BY timestamp DESC LIMIT 1';

	const row = db.prepare(sql).get(params) as
		| {
				event_id: string;
				session_id: string;
				summary: string;
				detail: string | null;
				timestamp: string;
		  }
		| undefined;

	if (!row) return null;

	return {
		eventId: row.event_id,
		sessionId: row.session_id,
		summary: row.summary,
		detail: row.detail,
		timestamp: row.timestamp,
	};
}

// ─── collectSessionBridgeSeedEvents ──────────────────────────────────────────

/**
 * Collect the most recent key events for a session to use as bridge seeds.
 * Returns decisions, corrections, milestones, and skill_completions.
 */
export function collectSessionBridgeSeedEvents(
	db: Database.Database,
	sessionId: string,
	limit = 10,
): SeedEvent[] {
	const sql = `
    SELECT entry_type, summary, importance
    FROM session_log
    WHERE session_id = ?
      AND entry_type IN ('decision', 'correction', 'preference', 'milestone', 'skill_completion')
    ORDER BY importance DESC, timestamp DESC
    LIMIT ?
  `;

	const rows = db.prepare(sql).all([sessionId, limit]) as Array<{
		entry_type: string;
		summary: string;
		importance: number;
	}>;

	return rows.map((r) => ({
		entryType: r.entry_type,
		summary: r.summary,
		importance: r.importance,
	}));
}

// ─── buildAutoSessionBridge ───────────────────────────────────────────────────

/**
 * Generate a bridge text summary from a list of seed events.
 * Used to create session_bridge entries that persist context across sessions.
 */
export function buildAutoSessionBridge(events: SeedEvent[]): string {
	if (events.length === 0) {
		return '上次会话无关键事件记录。';
	}

	const lines: string[] = ['上次会话关键事件：'];

	for (const event of events) {
		const label = ENTRY_TYPE_LABELS[event.entryType] ?? event.entryType;
		lines.push(`- [${label}] ${event.summary}`);
	}

	return lines.join('\n');
}

// ─── scanRecentlyModifiedFiles ────────────────────────────────────────────────

export interface RecentlyModifiedFile {
	filePath: string;
	modifiedAt: string;
}

/**
 * Scan for files in the vault that have been modified in the last 24 hours.
 * Uses the vault_index table modified_at field.
 */
export function scanRecentlyModifiedFiles(db: Database.Database): RecentlyModifiedFile[] {
	const cutoff = daysAgo(1);

	const rows = db
		.prepare(`
      SELECT file_path, modified_at
      FROM vault_index
      WHERE modified_at >= ?
      ORDER BY modified_at DESC
    `)
		.all([cutoff]) as Array<{ file_path: string; modified_at: string }>;

	return rows.map((r) => ({
		filePath: r.file_path,
		modifiedAt: r.modified_at,
	}));
}
