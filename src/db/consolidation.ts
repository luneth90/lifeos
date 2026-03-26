/**
 * consolidation.ts — 数据库合并工具。
 *
 * Merges session_log rows from a source database into a target database,
 * skipping duplicates by event_id.
 */

import type Database from 'better-sqlite3';
import type { SessionLogRow } from '../types.js';
import { queryAll } from './index.js';

export interface ConsolidateResult {
	merged: number;
}

/**
 * Copy session_log entries from source to target, ignoring duplicates by event_id.
 */
export function consolidateDb(
	source: Database.Database,
	target: Database.Database,
): ConsolidateResult {
	const rows = queryAll<SessionLogRow>(source, 'SELECT * FROM session_log');

	const insert = target.prepare(`
    INSERT OR IGNORE INTO session_log
    (event_id, session_id, timestamp, entry_type, importance, scope, skill_name,
     summary, detail, source_refs, related_files, related_entities,
     supersedes, entry_hash, search_hints, rule_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

	let merged = 0;
	for (const row of rows) {
		const result = insert.run(
			row.event_id,
			row.session_id,
			row.timestamp,
			row.entry_type,
			row.importance,
			row.scope,
			row.skill_name,
			row.summary,
			row.detail,
			row.source_refs,
			row.related_files,
			row.related_entities,
			row.supersedes,
			row.entry_hash,
			row.search_hints,
			row.rule_key,
		);
		if (result.changes > 0) merged++;
	}

	return { merged };
}
