/**
 * derived-memory.ts — memory_items table CRUD operations.
 *
 * Provides cleanup helpers for the memory_items table (V2 schema).
 */

import type Database from 'better-sqlite3';

// ─── cleanupExpiredItems ──────────────────────────────────────────────────────

/**
 * Mark expired memory items as 'expired'.
 * Items with expires_at < now are marked inactive.
 * Returns the count of affected items.
 */
export function cleanupExpiredItems(
	db: Database.Database,
	opts?: { dryRun?: boolean },
): { deleted: number } {
	const { dryRun = false } = opts ?? {};
	const now = new Date().toISOString();

	const rows = db
		.prepare(
			`SELECT slot_key FROM memory_items
       WHERE expires_at IS NOT NULL AND expires_at < ? AND status = 'active'`,
		)
		.all([now]) as { slot_key: string }[];

	if (dryRun) {
		return { deleted: rows.length };
	}

	if (rows.length === 0) return { deleted: 0 };

	const stmt = db.prepare(`UPDATE memory_items SET status = 'expired' WHERE slot_key = ?`);
	const tx = db.transaction(() => {
		for (const row of rows) {
			stmt.run(row.slot_key);
		}
	});
	tx();

	return { deleted: rows.length };
}

// ─── cleanupMemoryItems ───────────────────────────────────────────────────────

/**
 * General cleanup: expire items past their expiration date.
 * Returns the total deleted count.
 */
export function cleanupMemoryItems(
	db: Database.Database,
	opts?: { dryRun?: boolean },
): { deleted: number } {
	return cleanupExpiredItems(db, opts);
}
