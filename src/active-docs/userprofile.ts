/**
 * userprofile.ts — UserProfile active document builder.
 *
 * Builds UserProfile sections from memory_items and vault_index data.
 * Sections: profile-summary, rules, learning-progress.
 */

import type Database from 'better-sqlite3';
import { MASTERY_STATUS_LABELS } from '../types.js';

// ─── Section builders ─────────────────────────────────────────────────────────

function buildProfileSummarySection(db: Database.Database): string {
	// Priority 1: manual profile-summary in memory_items
	const item = db
		.prepare(
			`SELECT content FROM memory_items
       WHERE slot_key = 'profile:summary' AND status = 'active'
       LIMIT 1`,
		)
		.get() as { content: string } | undefined;

	if (item) {
		return item.content;
	}

	// Priority 2: auto-aggregate user portrait from DB statistics
	const lines: string[] = [];

	// Learning focus: active learning projects by domain
	const domainRows = db
		.prepare(
			`SELECT domain, COUNT(*) as cnt FROM vault_index
       WHERE type = 'project' AND category = 'learning' AND status = 'active' AND domain IS NOT NULL
       GROUP BY domain ORDER BY cnt DESC LIMIT 3`,
		)
		.all() as Array<{ domain: string; cnt: number }>;

	if (domainRows.length > 0) {
		lines.push(`**学习重心：** ${domainRows.map((r) => r.domain).join('、')}`);
	}

	if (lines.length === 0) {
		return '用户画像数据尚未积累。';
	}

	return lines.join('\n');
}

function buildRulesSection(db: Database.Database): string {
	const items = db
		.prepare(
			`SELECT slot_key, content, source FROM memory_items
       WHERE status = 'active'
       ORDER BY CASE source WHEN 'correction' THEN 0 ELSE 1 END, updated_at DESC`,
		)
		.all() as Array<{ slot_key: string; content: string; source: string }>;

	if (items.length === 0) return '暂无行为约束。';

	const lines: string[] = [];
	for (const item of items) {
		lines.push(`- **${item.slot_key}**: ${item.content}`);
	}
	return lines.join('\n');
}

function buildLearningProgressSection(db: Database.Database): string {
	// Knowledge mastery summary
	const masteryRows = db
		.prepare(
			`SELECT status, COUNT(*) as cnt FROM vault_index
       WHERE type IN ('note', 'knowledge')
       GROUP BY status`,
		)
		.all() as Array<{ status: string; cnt: number }>;

	if (masteryRows.length === 0) {
		return '暂无知识掌握度记录。';
	}

	const lines: string[] = ['**知识掌握度：**'];
	for (const r of masteryRows) {
		const label = r.status == null ? '⚪ 未标注' : (MASTERY_STATUS_LABELS[r.status] ?? r.status);
		lines.push(`- ${label}: ${r.cnt} 篇`);
	}
	return lines.join('\n');
}

// ─── buildUserprofileSections ─────────────────────────────────────────────────

/**
 * Build all UserProfile sections from DB data.
 * Returns a Record mapping section marker -> markdown content.
 */
export function buildUserprofileSections(
	db: Database.Database,
	_vaultRoot: string,
): Record<string, string> {
	return {
		'profile-summary': buildProfileSummarySection(db),
		rules: buildRulesSection(db),
		'learning-progress': buildLearningProgressSection(db),
	};
}
