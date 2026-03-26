/**
 * maintenance.ts — 维护服务。
 *
 * Periodic maintenance: prunes old low-importance session log entries.
 */

import type Database from 'better-sqlite3';
import type { MaintenanceResult } from '../types.js';
import { daysAgo } from '../types.js';
import { KEY_ENTRY_TYPES, coerceNow, isArchiveSummary } from '../utils/shared.js';

// ─── needsMaintenance ─────────────────────────────────────────────────────────

/**
 * Return true if there are session_log entries older than 30 days that are
 * candidates for pruning (low importance, non-key entry types).
 */
export function needsMaintenance(db: Database.Database, now?: Date | string | null): boolean {
	const cutoff = daysAgo(30, coerceNow(now));
	const keyTypes = [...KEY_ENTRY_TYPES];
	const placeholders = keyTypes.map(() => '?').join(',');
	const row = db
		.prepare(
			`SELECT 1 FROM session_log
       WHERE timestamp < ? AND importance < 3 AND entry_type NOT IN (${placeholders})
       LIMIT 1`,
		)
		.get(cutoff, ...keyTypes);
	return row !== undefined;
}

// ─── pruneSessionLog ──────────────────────────────────────────────────────────

/**
 * Delete low-importance, non-key session_log entries that are between
 * 30 and 180 days old. Entries that are archive summaries are preserved.
 *
 * @param dryRun - When true, compute the count but do not delete.
 * @returns Number of deleted (or would-be-deleted) rows and dry-run flag.
 */
export function pruneSessionLog(
	db: Database.Database,
	now?: Date | string | null,
	dryRun = false,
): { deleted: number; dryRun: boolean } {
	const nowDt = coerceNow(now);
	const newerCutoff = daysAgo(30, nowDt);
	const olderCutoff = daysAgo(180, nowDt);

	const rows = db
		.prepare(
			`SELECT event_id, entry_type, importance, summary
       FROM session_log
       WHERE timestamp >= ? AND timestamp < ?`,
		)
		.all(olderCutoff, newerCutoff) as Array<{
		event_id: string;
		entry_type: string;
		importance: number;
		summary: string;
	}>;

	const keyTypes = KEY_ENTRY_TYPES;
	const deletableIds = rows
		.filter(
			(r) =>
				r.importance < 3 &&
				!keyTypes.has(r.entry_type) &&
				!isArchiveSummary(r.summary, r.entry_type),
		)
		.map((r) => r.event_id);

	if (!dryRun && deletableIds.length > 0) {
		const del = db.prepare('DELETE FROM session_log WHERE event_id = ?');
		const tx = db.transaction(() => {
			for (const id of deletableIds) del.run(id);
		});
		tx();
	}

	return { deleted: deletableIds.length, dryRun };
}

// ─── maintenanceRun ───────────────────────────────────────────────────────────

/**
 * Run all maintenance tasks and return a summary of actions taken.
 */
export function maintenanceRun(
	db: Database.Database,
	now?: Date | string | null,
	dryRun = false,
): MaintenanceResult {
	const pruneResult = pruneSessionLog(db, now, dryRun);
	return {
		deleted: pruneResult.deleted,
		compressed_groups: 0,
		compressed_events: 0,
		memory_items_merged: 0,
		memory_items_deleted: 0,
		expired_items_deleted: 0,
		dry_run: dryRun,
	};
}
