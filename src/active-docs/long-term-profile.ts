/**
 * long-term-profile.ts — 长期画像数据查询。
 *
 * Builds stable long-term profile items from session_log:
 * preferences, corrections, and decisions that are not temporary
 * and have appeared multiple times or have high importance.
 */

import type Database from 'better-sqlite3';
import { parseDetailObject } from '../utils/shared.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LongTermItem {
	ruleKey: string | null;
	entryType: string;
	summary: string;
	importance: number;
	occurrences: number;
	latestTimestamp: string;
	isTemporary: boolean;
}

// ─── buildLongTermItems ───────────────────────────────────────────────────────

/**
 * Build stable long-term profile items from session_log.
 * Groups by rule_key and returns items that are:
 * - Not temporary preferences
 * - High importance (>= 3) OR appeared multiple times
 */
export function buildLongTermItems(db: Database.Database): LongTermItem[] {
	// Query all key events (decision, correction, preference)
	const rows = db
		.prepare(
			`SELECT entry_type, summary, importance, detail, rule_key, timestamp
       FROM session_log
       WHERE entry_type IN ('decision', 'correction', 'preference')
       ORDER BY timestamp DESC`,
		)
		.all() as Array<{
		entry_type: string;
		summary: string;
		importance: number;
		detail: string | null;
		rule_key: string | null;
		timestamp: string;
	}>;

	// Group by rule_key (or summary if no rule_key)
	const groups = new Map<
		string,
		{
			entryType: string;
			summary: string;
			importance: number;
			occurrences: number;
			latestTimestamp: string;
			isTemporary: boolean;
			ruleKey: string | null;
		}
	>();

	for (const row of rows) {
		const key = row.rule_key || row.summary;
		const detailObj = parseDetailObject(row.detail);
		const isTemporary = detailObj.temporary === true;

		const existing = groups.get(key);
		if (existing !== undefined) {
			existing.occurrences++;
			if (row.timestamp > existing.latestTimestamp) {
				existing.latestTimestamp = row.timestamp;
				existing.summary = row.summary; // Use latest summary
			}
			existing.importance = Math.max(existing.importance, row.importance);
		} else {
			groups.set(key, {
				entryType: row.entry_type,
				summary: row.summary,
				importance: row.importance,
				occurrences: 1,
				latestTimestamp: row.timestamp,
				isTemporary,
				ruleKey: row.rule_key,
			});
		}
	}

	// Filter to long-term stable items
	const items: LongTermItem[] = [];
	for (const [_key, g] of groups) {
		// Include if: not temporary AND (high importance OR multiple occurrences)
		if (!g.isTemporary && (g.importance >= 3 || g.occurrences >= 2)) {
			items.push({
				ruleKey: g.ruleKey,
				entryType: g.entryType,
				summary: g.summary,
				importance: g.importance,
				occurrences: g.occurrences,
				latestTimestamp: g.latestTimestamp,
				isTemporary: g.isTemporary,
			});
		}
	}

	// Sort by importance desc, then occurrences desc
	items.sort((a, b) => {
		if (b.importance !== a.importance) return b.importance - a.importance;
		return b.occurrences - a.occurrences;
	});

	return items;
}
