import type Database from 'better-sqlite3';
import { STATUS_LABELS, formatDateShort } from '../types.js';
import { normalizeWikilink } from '../utils/wikilink.js';

export interface ActiveProject {
	filePath: string;
	title: string;
	status: string | null;
	domain: string | null;
	summary: string | null;
	modifiedAt: string | null;
}

interface ProjectRef {
	file_path: string;
	title: string | null;
	status: string | null;
}

export interface RevisionCandidate {
	title: string;
	status: string;
	domain: string | null;
	project: string | null;
}

export function selectActiveProjects(db: Database.Database): ActiveProject[] {
	const rows = db
		.prepare(`
			SELECT file_path, title, status, domain, summary, modified_at
			FROM vault_index
			WHERE type = 'project' AND status = 'active'
			ORDER BY modified_at DESC
			LIMIT 20
		`)
		.all() as Array<{
		file_path: string;
		title: string | null;
		status: string | null;
		domain: string | null;
		summary: string | null;
		modified_at: string | null;
	}>;
	return rows.map((row) => ({
		filePath: row.file_path,
		title: row.title || row.file_path.split('/').pop() || row.file_path,
		status: row.status,
		domain: row.domain,
		summary: row.summary,
		modifiedAt: row.modified_at,
	}));
}

function projectLookup(db: Database.Database): Map<string, ProjectRef> {
	const rows = db
		.prepare("SELECT file_path, title, status FROM vault_index WHERE type = 'project'")
		.all() as ProjectRef[];
	const map = new Map<string, ProjectRef>();
	for (const row of rows) {
		const path = normalizeWikilink(row.file_path);
		const title = row.title ? normalizeWikilink(row.title) : '';
		if (path) map.set(path, row);
		if (title) map.set(title, row);
	}
	return map;
}

function allRevisionCandidates(db: Database.Database): RevisionCandidate[] {
	const projects = projectLookup(db);
	const rows = db
		.prepare(`
			SELECT title, status, domain, project
			FROM vault_index
			WHERE type IN ('note', 'knowledge') AND status = 'review'
			ORDER BY modified_at DESC
		`)
		.all() as RevisionCandidate[];
	return rows.filter(
		(row) => !row.project || projects.get(normalizeWikilink(row.project))?.status !== 'frozen',
	);
}

export function selectRevisionCandidates(db: Database.Database): RevisionCandidate[] {
	return allRevisionCandidates(db).slice(0, 10);
}

export function countRevisionCandidates(db: Database.Database): number {
	return allRevisionCandidates(db).length;
}

export function buildTaskboardFocusSection(db: Database.Database): string {
	const projects = selectActiveProjects(db).slice(0, 3);
	if (!projects.length) return '暂无进行中的项目。';
	return [
		'**当前进行中的项目：**',
		...projects.map(
			(project) =>
				`- ${project.title}${project.domain ? ` [${project.domain}]` : ''}：${STATUS_LABELS[project.status ?? ''] ?? project.status ?? '未知'}`,
		),
	].join('\n');
}

function buildActiveProjectsSection(projects: ActiveProject[]): string {
	if (!projects.length) return '暂无活跃项目。';
	const lines: string[] = [];
	for (const project of projects) {
		lines.push(
			`- **${project.title}**${project.domain ? ` | 领域：${project.domain}` : ''} | 状态：${STATUS_LABELS[project.status ?? ''] ?? project.status ?? '未知'}${project.modifiedAt ? ` | 更新：${formatDateShort(project.modifiedAt, '未知')}` : ''}`,
		);
		if (project.summary) {
			const summary = project.summary
				.split('\n')
				.map((line) => line.replace(/^#+\s*/, '').replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1'))
				.filter((line) => line.trim())
				.join(' ')
				.replace(/\s+/g, ' ')
				.trim()
				.slice(0, 80);
			if (summary) lines.push(`  ${summary}${summary.length >= 80 ? '...' : ''}`);
		}
	}
	return lines.join('\n');
}

function buildRevisionsSection(db: Database.Database): string {
	const rows = selectRevisionCandidates(db);
	if (!rows.length) return '暂无待复习的知识笔记。';
	return rows
		.map((row) => `- 待复习 **${row.title}**${row.domain ? ` [${row.domain}]` : ''}`)
		.join('\n');
}

export function buildTaskboardSections(
	db: Database.Database,
	_vaultRoot: string,
): Record<string, string> {
	const projects = selectActiveProjects(db);
	return {
		focus: buildTaskboardFocusSection(db),
		'active-projects': buildActiveProjectsSection(projects),
		revises: buildRevisionsSection(db),
	};
}
