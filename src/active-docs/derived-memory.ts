/**
 * derived-memory.ts — memory_items 表的 CRUD 操作。
 *
 * Provides upsert, cleanup, and build helpers for the memory_items table.
 * Memory items are derived knowledge stored under targets like TaskBoard/UserProfile.
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { inClause } from '../db/index.js';
import type { MemoryItem } from '../services/retrieval.js';
import type { MemoryItemRow } from '../types.js';
import { loadsJsonList } from '../utils/shared.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BuildMemoryItemOpts {
	target: string;
	section: string;
	slotKey: string;
	content: string;
	confidence?: string | null;
	sourceEventIds?: string[];
	sourceRefs?: string[];
	relatedFiles?: string[];
	manualFlag?: boolean;
	expiresAt?: string | null;
}

// ─── upsertMemoryItem ─────────────────────────────────────────────────────────

/**
 * Upsert a memory item into the memory_items table.
 * If an active item with the same target+section+slot_key exists, update it.
 * Otherwise, insert a new row.
 * Returns the item_id of the upserted row.
 */
export function upsertMemoryItem(db: Database.Database, item: MemoryItem): string {
	const now = new Date().toISOString();

	// Check if an active item already exists for this target+section+slot_key
	const existing = db
		.prepare(
			`SELECT item_id FROM memory_items
       WHERE target = ? AND section = ? AND slot_key = ? AND status = 'active'
       LIMIT 1`,
		)
		.get([item.target, item.section, item.slotKey]) as { item_id: string } | undefined;

	const sourceEventIdsJson = JSON.stringify(item.sourceEventIds ?? []);
	const sourceRefsJson = JSON.stringify(item.sourceRefs ?? []);
	const relatedFilesJson = JSON.stringify(item.relatedFiles ?? []);

	if (existing) {
		db.prepare(
			`UPDATE memory_items SET
        content = ?,
        confidence = ?,
        source_event_ids = ?,
        source_refs = ?,
        related_files = ?,
        manual_flag = ?,
        updated_at = ?,
        expires_at = ?
       WHERE item_id = ?`,
		).run(
			item.content,
			item.confidence ?? null,
			sourceEventIdsJson,
			sourceRefsJson,
			relatedFilesJson,
			item.manualFlag ? 1 : 0,
			now,
			item.expiresAt ?? null,
			existing.item_id,
		);
		return existing.item_id;
	}

	const itemId = item.itemId || randomUUID();
	db.prepare(
		`INSERT INTO memory_items
      (item_id, target, section, slot_key, content, confidence,
       source_event_ids, source_refs, related_files,
       manual_flag, status, superseded_by, last_confirmed_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, NULL, ?, ?)`,
	).run(
		itemId,
		item.target,
		item.section,
		item.slotKey,
		item.content,
		item.confidence ?? null,
		sourceEventIdsJson,
		sourceRefsJson,
		relatedFilesJson,
		item.manualFlag ? 1 : 0,
		now,
		item.expiresAt ?? null,
	);

	return itemId;
}

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
			`SELECT item_id FROM memory_items
       WHERE expires_at IS NOT NULL AND expires_at < ? AND status = 'active'`,
		)
		.all([now]) as { item_id: string }[];

	if (dryRun) {
		return { deleted: rows.length };
	}

	if (rows.length === 0) return { deleted: 0 };

	const ids = rows.map((r) => r.item_id);
	const { clause, params } = inClause('item_id', ids);
	db.prepare(`UPDATE memory_items SET status = 'expired' WHERE ${clause}`).run(params);

	return { deleted: ids.length };
}

// ─── cleanupMemoryItems ───────────────────────────────────────────────────────

/**
 * General cleanup: remove superseded and expired items.
 * Superseded items are those with a non-null superseded_by that points to an active item.
 * Returns the total deleted count.
 */
export function cleanupMemoryItems(
	db: Database.Database,
	opts?: { now?: Date | string; dryRun?: boolean },
): { deleted: number } {
	const { dryRun = false } = opts ?? {};

	// Cleanup expired items
	const expiredResult = cleanupExpiredItems(db, { dryRun });

	// Cleanup superseded items (status = 'active' but superseded_by is set and resolved target exists)
	const supersededRows = db
		.prepare(
			`SELECT item_id FROM memory_items
       WHERE superseded_by IS NOT NULL AND status = 'active'`,
		)
		.all() as { item_id: string }[];

	let supersededCount = 0;

	if (!dryRun && supersededRows.length > 0) {
		const ids = supersededRows.map((r) => r.item_id);
		const { clause, params } = inClause('item_id', ids);
		db.prepare(`UPDATE memory_items SET status = 'superseded' WHERE ${clause}`).run(params);
		supersededCount = ids.length;
	} else {
		supersededCount = supersededRows.length;
	}

	return { deleted: expiredResult.deleted + supersededCount };
}

// ─── buildMemoryItem ──────────────────────────────────────────────────────────

/**
 * Construct a MemoryItem object from build options.
 * Does NOT write to the database — call upsertMemoryItem to persist.
 */
export function buildMemoryItem(opts: BuildMemoryItemOpts): MemoryItem {
	const now = new Date().toISOString();
	return {
		itemId: randomUUID(),
		target: opts.target,
		section: opts.section,
		slotKey: opts.slotKey,
		content: opts.content,
		confidence: opts.confidence ?? null,
		sourceEventIds: opts.sourceEventIds ?? [],
		sourceRefs: opts.sourceRefs ?? [],
		relatedFiles: opts.relatedFiles ?? [],
		manualFlag: opts.manualFlag ?? false,
		status: 'active',
		supersededBy: null,
		lastConfirmedAt: null,
		updatedAt: now,
		expiresAt: opts.expiresAt ?? null,
	};
}

// ─── getActiveMemoryItems ─────────────────────────────────────────────────────

/**
 * Query active memory items for a given target and optional section.
 */
export function getActiveMemoryItems(
	db: Database.Database,
	target: string,
	section?: string | null,
): MemoryItem[] {
	const conditions: string[] = ['target = ?', `status = 'active'`];
	const params: unknown[] = [target];

	if (section) {
		conditions.push('section = ?');
		params.push(section);
	}

	const rows = db
		.prepare(
			`SELECT item_id, target, section, slot_key, content, confidence,
              source_event_ids, source_refs, related_files,
              manual_flag, status, superseded_by, last_confirmed_at, updated_at, expires_at
       FROM memory_items
       WHERE ${conditions.join(' AND ')}
       ORDER BY updated_at DESC`,
		)
		.all(params) as MemoryItemRow[];

	return rows.map((row) => ({
		itemId: String(row.item_id),
		target: String(row.target),
		section: String(row.section),
		slotKey: String(row.slot_key),
		content: String(row.content),
		confidence: row.confidence != null ? String(row.confidence) : null,
		sourceEventIds: loadsJsonList(row.source_event_ids),
		sourceRefs: loadsJsonList(row.source_refs),
		relatedFiles: loadsJsonList(row.related_files),
		manualFlag: Number(row.manual_flag) !== 0,
		status: String(row.status),
		supersededBy: row.superseded_by != null ? String(row.superseded_by) : null,
		lastConfirmedAt: row.last_confirmed_at != null ? String(row.last_confirmed_at) : null,
		updatedAt: String(row.updated_at),
		expiresAt: row.expires_at != null ? String(row.expires_at) : null,
	}));
}
