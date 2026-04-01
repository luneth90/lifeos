/**
 * userprofile.ts — UserProfile 活文档构建器。
 *
 * Builds UserProfile sections from memory_items and session_log data.
 * Sections: profile-summary, preferences, corrections, decisions, learning-progress.
 */

import type Database from 'better-sqlite3';
import { MASTERY_STATUS_LABELS, daysAgo, formatDateShort } from '../types.js';
import { loadsJsonList, parseDetailObject } from '../utils/shared.js';

// ─── Section builders ─────────────────────────────────────────────────────────

function buildProfileSummarySection(db: Database.Database): string {
	// Priority 1: manual profile-summary in memory_items
	const item = db
		.prepare(
			`SELECT content FROM memory_items
       WHERE target = 'UserProfile' AND section = 'profile-summary' AND status = 'active'
       ORDER BY updated_at DESC LIMIT 1`,
		)
		.get() as { content: string } | undefined;

	if (item) {
		return item.content;
	}

	// Priority 2: auto-aggregate user portrait from DB statistics
	const lines: string[] = [];
	const cutoff30 = daysAgo(30);

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

	// Most used skills (last 30 days)
	const skillRows = db
		.prepare(
			`SELECT skill_name, COUNT(*) as cnt FROM session_log
       WHERE entry_type = 'skill_completion' AND skill_name IS NOT NULL AND timestamp >= ?
       GROUP BY skill_name ORDER BY cnt DESC LIMIT 5`,
		)
		.all([cutoff30]) as Array<{ skill_name: string; cnt: number }>;

	if (skillRows.length > 0) {
		const skillList = skillRows.map((r) => `/${r.skill_name}（${r.cnt}次）`).join('、');
		lines.push(`**常用技能：** ${skillList}`);
	}

	// Activity level (last 30 days)
	const activityRow = db
		.prepare(
			`SELECT COUNT(DISTINCT DATE(timestamp)) as active_days, COUNT(*) as total_events
       FROM session_log WHERE timestamp >= ?`,
		)
		.get([cutoff30]) as { active_days: number; total_events: number } | undefined;

	if (activityRow && activityRow.active_days > 0) {
		const avgEvents = (activityRow.total_events / activityRow.active_days).toFixed(1);
		lines.push(
			`**近30天活跃度：** ${activityRow.active_days}天活跃，日均 ${avgEvents} 个事件`,
		);
	}

	// Knowledge mastery is shown in learning-progress section, not duplicated here

	if (lines.length === 0) {
		return '用户画像数据尚未积累。';
	}

	return lines.join('\n');
}

function buildPreferencesSection(db: Database.Database): string {
	// First check memory_items for stored preferences
	const items = db
		.prepare(
			`SELECT slot_key, content, updated_at FROM memory_items
       WHERE target = 'UserProfile' AND section = 'preferences' AND status = 'active'
       ORDER BY updated_at DESC`,
		)
		.all() as Array<{ slot_key: string; content: string; updated_at: string }>;

	if (items.length > 0) {
		const lines: string[] = [];
		for (const item of items) {
			lines.push(`- **${item.slot_key}**: ${item.content}`);
		}
		return lines.join('\n');
	}

	// Fall back to session_log preferences
	const cutoff = daysAgo(90);
	const rows = db
		.prepare(
			`SELECT summary, detail, timestamp, rule_key FROM session_log
       WHERE entry_type = 'preference' AND timestamp >= ?
       ORDER BY importance DESC, timestamp DESC
       LIMIT 15`,
		)
		.all([cutoff]) as Array<{
		summary: string;
		detail: string | null;
		timestamp: string;
		rule_key: string | null;
	}>;

	if (rows.length === 0) {
		return '暂无记录的用户偏好。';
	}

	const lines: string[] = [];
	// Deduplicate by rule_key
	const seen = new Set<string>();
	for (const r of rows) {
		const key = r.rule_key || r.summary;
		if (seen.has(key)) continue;
		seen.add(key);
		const detailObj = parseDetailObject(r.detail);
		const isTemp = detailObj.temporary === true;
		const tempMark = isTemp ? ' *(临时)*' : '';
		lines.push(`- ${r.summary}${tempMark}`);
	}
	return lines.join('\n');
}

function buildCorrectionsSection(db: Database.Database): string {
	// First check memory_items for stored corrections
	const items = db
		.prepare(
			`SELECT slot_key, content, updated_at FROM memory_items
       WHERE target = 'UserProfile' AND section = 'corrections' AND status = 'active'
       ORDER BY updated_at DESC`,
		)
		.all() as Array<{ slot_key: string; content: string; updated_at: string }>;

	if (items.length > 0) {
		const lines: string[] = [];
		for (const item of items) {
			lines.push(`- **${item.slot_key}**: ${item.content}`);
		}
		return lines.join('\n');
	}

	// Fall back to session_log corrections
	const cutoff = daysAgo(60);
	const rows = db
		.prepare(
			`SELECT summary, timestamp, rule_key FROM session_log
       WHERE entry_type = 'correction' AND timestamp >= ?
       ORDER BY importance DESC, timestamp DESC
       LIMIT 10`,
		)
		.all([cutoff]) as Array<{
		summary: string;
		timestamp: string;
		rule_key: string | null;
	}>;

	if (rows.length === 0) {
		return '近期暂无纠错记录。';
	}

	const lines: string[] = [];
	const seen = new Set<string>();
	for (const r of rows) {
		const key = r.rule_key || r.summary;
		if (seen.has(key)) continue;
		seen.add(key);
		const date = formatDateShort(r.timestamp);
		lines.push(`- [${date}] ${r.summary}`);
	}
	return lines.join('\n');
}

function buildDecisionsSection(_db: Database.Database): string {
	// Decisions are now only maintained in TaskBoard to avoid duplication.
	// This section is repurposed for user-level preference decisions only.
	// See: LifeOS系统改进建议 — 问题1
	return '决策记录已统一至 TaskBoard。';
}

function buildLearningProgressSection(db: Database.Database): string {
	// Active learning projects
	const projectRows = db
		.prepare(
			`SELECT title, status, domain FROM vault_index
       WHERE type = 'project' AND category = 'learning' AND status = 'active'
       ORDER BY modified_at DESC
       LIMIT 5`,
		)
		.all() as Array<{ title: string; status: string; domain: string | null }>;

	// Knowledge mastery summary
	const masteryRows = db
		.prepare(
			`SELECT status, COUNT(*) as cnt FROM vault_index
       WHERE type IN ('note', 'knowledge')
       GROUP BY status`,
		)
		.all() as Array<{ status: string; cnt: number }>;

	const lines: string[] = [];

	if (projectRows.length > 0) {
		lines.push('**学习中的项目：**');
		for (const p of projectRows) {
			const domain = p.domain ? ` [${p.domain}]` : '';
			lines.push(`- ${p.title}${domain}`);
		}
	}

	if (masteryRows.length > 0) {
		if (lines.length > 0) lines.push('');
		lines.push('**知识掌握度：**');
		for (const r of masteryRows) {
			const label = r.status == null ? '⚪ 未标注' : (MASTERY_STATUS_LABELS[r.status] ?? r.status);
			lines.push(`- ${label}: ${r.cnt} 篇`);
		}
	}

	if (lines.length === 0) {
		return '暂无学习进度记录。';
	}

	return lines.join('\n');
}

// ─── buildUserprofileSections ─────────────────────────────────────────────────

/**
 * Build all UserProfile sections from DB data.
 * Returns a Record mapping section marker → markdown content.
 */
export function buildUserprofileSections(
	db: Database.Database,
	_vaultRoot: string,
): Record<string, string> {
	return {
		'profile-summary': buildProfileSummarySection(db),
		preferences: buildPreferencesSection(db),
		corrections: buildCorrectionsSection(db),
		decisions: buildDecisionsSection(db),
		'learning-progress': buildLearningProgressSection(db),
	};
}
