/**
 * taskboard.ts — TaskBoard 活文档构建器。
 *
 * Builds TaskBoard sections from vault_index and session_log data.
 * Each section is a markdown string keyed by section name.
 */

import type Database from 'better-sqlite3';
import {
	ENTRY_TYPE_LABELS,
	MASTERY_STATUS_LABELS,
	STATUS_LABELS,
	daysAgo,
	formatDateShort,
} from '../types.js';
import { loadsJsonList } from '../utils/shared.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActiveProject {
	filePath: string;
	title: string;
	status: string | null;
	domain: string | null;
	summary: string | null;
	modifiedAt: string | null;
}

interface RecentEvent {
	eventId: string;
	entryType: string;
	importance: number;
	summary: string;
	timestamp: string;
	skillName: string | null;
	relatedFiles: string[];
}

// ─── Section builders ─────────────────────────────────────────────────────────

function buildFocusSection(projects: ActiveProject[], events: RecentEvent[]): string {
	const lines: string[] = [];

	// Top active projects (max 3)
	const topProjects = projects.slice(0, 3);
	if (topProjects.length > 0) {
		lines.push('**当前进行中的项目：**');
		for (const p of topProjects) {
			const domain = p.domain ? ` [${p.domain}]` : '';
			lines.push(`- ${p.title}${domain}：${STATUS_LABELS[p.status ?? ''] ?? p.status ?? '未知'}`);
		}
	}

	// Recent high-importance events (max 5)
	const highPriority = events.filter((e) => e.importance >= 4).slice(0, 5);
	if (highPriority.length > 0) {
		if (lines.length > 0) lines.push('');
		lines.push('**近期关键事件：**');
		for (const e of highPriority) {
			const label = ENTRY_TYPE_LABELS[e.entryType] ?? e.entryType;
			lines.push(`- [${label}] ${e.summary}`);
		}
	}

	if (lines.length === 0) {
		lines.push('暂无进行中的项目或近期关键事件。');
	}

	return lines.join('\n');
}

function buildActiveProjectsSection(projects: ActiveProject[]): string {
	if (projects.length === 0) {
		return '暂无活跃项目。';
	}

	const lines: string[] = [];
	for (const p of projects) {
		const domain = p.domain ? ` | 领域：${p.domain}` : '';
		const date = p.modifiedAt ? ` | 更新：${formatDateShort(p.modifiedAt, '未知')}` : '';
		lines.push(
			`- **${p.title}**${domain} | 状态：${STATUS_LABELS[p.status ?? ''] ?? p.status ?? '未知'}${date}`,
		);
		if (p.summary) {
			const shortSummary = p.summary
				.split('\n')
				.map((line) => line.replace(/^#+\s*/, '').replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1'))
				.filter((line) => line.trim())
				.join(' ')
				.replace(/\s+/g, ' ')
				.trim()
				.slice(0, 80);
			lines.push(`  ${shortSummary}${shortSummary.length >= 80 ? '...' : ''}`);
		}
	}
	return lines.join('\n');
}

function buildRevisesSection(db: Database.Database): string {
	// Find knowledge items needing revision (status = 'draft' or 'revise')
	const rows = db
		.prepare(
			`SELECT file_path, title, status, domain, modified_at
       FROM vault_index
       WHERE type IN ('note', 'knowledge', 'revise-record')
         AND status IN ('draft', 'revise')
       ORDER BY modified_at DESC
       LIMIT 10`,
		)
		.all() as Array<{
		file_path: string;
		title: string;
		status: string;
		domain: string | null;
		modified_at: string | null;
	}>;

	if (rows.length === 0) {
		return '暂无待复习的知识笔记。';
	}

	const lines: string[] = [];
	for (const r of rows) {
		const domain = r.domain ? ` [${r.domain}]` : '';
		const statusStr = MASTERY_STATUS_LABELS[r.status] ?? r.status;
		lines.push(`- ${statusStr} **${r.title}**${domain}`);
	}
	return lines.join('\n');
}

function buildDecisionsSection(events: RecentEvent[]): string {
	const decisions = events.filter((e) => e.entryType === 'decision').slice(0, 8);

	if (decisions.length === 0) {
		return '暂无近期决策记录。';
	}

	const lines: string[] = [];
	for (const d of decisions) {
		const date = formatDateShort(d.timestamp, '未知');
		lines.push(`- [${date}] ${d.summary}`);
	}
	return lines.join('\n');
}

function buildUpdateLogSection(events: RecentEvent[]): string {
	if (events.length === 0) {
		return '暂无近期活动记录。';
	}

	const lines: string[] = [];
	for (const e of events.slice(0, 10)) {
		const date = formatDateShort(e.timestamp, '未知');
		const label = ENTRY_TYPE_LABELS[e.entryType] ?? e.entryType;
		lines.push(`- [${date}][${label}] ${e.summary}`);
	}
	return lines.join('\n');
}

// ─── buildTaskboardSections ───────────────────────────────────────────────────

/**
 * Build all TaskBoard sections from DB data.
 * Returns a Record mapping section marker → markdown content.
 */
export function buildTaskboardSections(
	db: Database.Database,
	_vaultRoot: string,
): Record<string, string> {
	// Query active projects
	const projectRows = db
		.prepare(
			`SELECT file_path, title, status, domain, summary, modified_at
       FROM vault_index
       WHERE type = 'project' AND status = 'active'
       ORDER BY modified_at DESC
       LIMIT 20`,
		)
		.all() as Array<{
		file_path: string;
		title: string;
		status: string | null;
		domain: string | null;
		summary: string | null;
		modified_at: string | null;
	}>;

	const projects: ActiveProject[] = projectRows.map((r) => ({
		filePath: r.file_path,
		title: r.title || r.file_path.split('/').pop() || r.file_path,
		status: r.status,
		domain: r.domain,
		summary: r.summary,
		modifiedAt: r.modified_at,
	}));

	// Query recent events (last 30 days)
	const cutoff = daysAgo(30);
	const eventRows = db
		.prepare(
			`SELECT event_id, entry_type, importance, summary, timestamp, skill_name, related_files
       FROM session_log
       WHERE timestamp >= ?
       ORDER BY importance DESC, timestamp DESC
       LIMIT 50`,
		)
		.all([cutoff]) as Array<{
		event_id: string;
		entry_type: string;
		importance: number;
		summary: string;
		timestamp: string;
		skill_name: string | null;
		related_files: string | null;
	}>;

	const events: RecentEvent[] = eventRows.map((r) => ({
		eventId: r.event_id,
		entryType: r.entry_type,
		importance: r.importance,
		summary: r.summary,
		timestamp: r.timestamp,
		skillName: r.skill_name,
		relatedFiles: loadsJsonList(r.related_files),
	}));

	return {
		focus: buildFocusSection(projects, events),
		'active-projects': buildActiveProjectsSection(projects),
		revises: buildRevisesSection(db),
		decisions: buildDecisionsSection(events),
		'update-log': buildUpdateLogSection(events),
	};
}
