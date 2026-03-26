/**
 * citations.ts — 来源引用链查询。
 *
 * Returns source event IDs and refs for memory_items matching
 * a given target (TaskBoard / UserProfile) and optional section/keyword.
 */

import type Database from 'better-sqlite3';
import { inClause } from '../db/index.js';
import type { CitationItem, CitationSourceEvent, CitationsResult } from '../types.js';
import { loadsJsonList } from '../utils/shared.js';

// ─── getCitations ─────────────────────────────────────────────────────────────

/**
 * Retrieve citation metadata (source event IDs, source refs) for memory items
 * matching the given target and optional section/keyword filter.
 *
 * Returns an object with:
 * - items: array of { itemId, slotKey, sourceEventIds, sourceRefs, content }
 * - total: total count of matched items
 */
export function getCitations(
	db: Database.Database,
	target: string,
	opts?: { section?: string; keyword?: string },
): CitationsResult {
	const { section, keyword } = opts ?? {};

	const conditions: string[] = ['target = ?', `status = 'active'`];
	const params: unknown[] = [target];

	if (section) {
		conditions.push('section = ?');
		params.push(section);
	}

	if (keyword) {
		conditions.push('(content LIKE ? OR slot_key LIKE ?)');
		params.push(`%${keyword}%`, `%${keyword}%`);
	}

	const rows = db
		.prepare(
			`SELECT item_id, section, slot_key, content, source_event_ids, source_refs, updated_at
       FROM memory_items
       WHERE ${conditions.join(' AND ')}
       ORDER BY updated_at DESC
       LIMIT 50`,
		)
		.all(params) as Array<{
		item_id: string;
		section: string;
		slot_key: string;
		content: string;
		source_event_ids: string | null;
		source_refs: string | null;
		updated_at: string;
	}>;

	const items: CitationItem[] = rows.map((r) => ({
		itemId: r.item_id,
		section: r.section,
		slotKey: r.slot_key,
		content: r.content.slice(0, 120) + (r.content.length > 120 ? '...' : ''),
		sourceEventIds: loadsJsonList(r.source_event_ids),
		sourceRefs: loadsJsonList(r.source_refs),
		updatedAt: r.updated_at,
	}));

	// Gather all unique source event details
	const allEventIds = [...new Set(items.flatMap((i) => i.sourceEventIds))];
	let sourceEvents: CitationSourceEvent[] = [];

	if (allEventIds.length > 0) {
		const { clause, params: inParams } = inClause('event_id', allEventIds);
		const eventRows = db
			.prepare(
				`SELECT event_id, entry_type, summary, timestamp, skill_name
         FROM session_log
         WHERE ${clause}
         ORDER BY timestamp DESC`,
			)
			.all(inParams) as Array<{
			event_id: string;
			entry_type: string;
			summary: string;
			timestamp: string;
			skill_name: string | null;
		}>;

		sourceEvents = eventRows.map((r) => ({
			eventId: r.event_id,
			entryType: r.entry_type,
			summary: r.summary,
			timestamp: r.timestamp,
			skillName: r.skill_name,
		}));
	}

	return {
		target,
		section: section ?? null,
		keyword: keyword ?? null,
		total: items.length,
		items,
		sourceEvents,
	};
}
