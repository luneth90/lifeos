/**
 * taskboard.ts — TaskBoard active document builder.
 *
 * Builds TaskBoard sections from vault_index data.
 * Each section is a markdown string keyed by section name.
 */

import type Database from 'better-sqlite3';
import { MASTERY_STATUS_LABELS, STATUS_LABELS, formatDateShort } from '../types.js';
import { normalizeWikilink } from '../utils/wikilink.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActiveProject {
	filePath: string;
	title: string;
	status: string | null;
	domain: string | null;
	summary: string | null;
	modifiedAt: string | null;
}

// ─── Section builders ─────────────────────────────────────────────────────────

function buildFocusSection(projects: ActiveProject[]): string {
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

	if (lines.length === 0) {
		lines.push('暂无进行中的项目。');
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
	// Exclude notes whose parent project has status='frozen'
	const rows = db
		.prepare(
			`SELECT vi.file_path, vi.title, vi.status, vi.domain
       FROM vault_index vi
       LEFT JOIN vault_index proj
         ON proj.type = 'project'
         AND (vi.project = proj.file_path
               OR vi.project = '[[' || proj.title || ']]'
               OR vi.project = proj.title)
       WHERE vi.type IN ('note', 'knowledge')
         AND vi.status IN ('draft', 'revise')
         AND (proj.file_path IS NULL OR proj.status != 'frozen')
       ORDER BY vi.modified_at DESC
       LIMIT 10`,
		)
		.all() as Array<{
		file_path: string;
		title: string;
		status: string;
		domain: string | null;
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

// ─── buildTaskboardSections ───────────────────────────────────────────────────

/**
 * Build all TaskBoard sections from DB data.
 * Returns a Record mapping section marker -> markdown content.
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

	return {
		focus: buildFocusSection(projects),
		'active-projects': buildActiveProjectsSection(projects),
		revises: buildRevisesSection(db),
	};
}
