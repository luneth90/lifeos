import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import type Database from 'better-sqlite3';
import { type VaultConfig, getOrCreateVaultConfig } from '../config.js';
import { STATUS_LABELS, formatDateShort } from '../types.js';
import { parseMarkdown } from '../utils/vault-indexer.js';
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

/**
 * 扫描归档项目目录（`{系统目录}/{归档子目录}/项目/`），返回可用于匹配的 key 集合。
 * 归档项目文件不在 vault_index 中（system 目录被排除），必须直接从文件系统读取，
 * 否则「归档项目的关联 review 笔记」会因 projectLookup 查不到项目而绕过 frozen 过滤。
 */
function loadArchivedProjectKeys(vaultRoot: string, config?: VaultConfig): Set<string> {
	const cfg = config ?? getOrCreateVaultConfig(vaultRoot);
	const systemSubs = (
		cfg.rawConfig.subdirectories as unknown as Record<string, Record<string, unknown>>
	).system;
	const archiveProjects = (systemSubs?.archive as Record<string, string> | undefined)?.projects;
	if (typeof archiveProjects !== 'string') return new Set();
	const keys = new Set<string>();
	const directory = join(vaultRoot, cfg.rawConfig.directories.system, archiveProjects);
	collectProjectKeys(directory, vaultRoot, keys);
	return keys;
}

function collectProjectKeys(directory: string, vaultRoot: string, keys: Set<string>): void {
	let entries: string[];
	try {
		entries = readdirSync(directory);
	} catch {
		return;
	}
	for (const entry of entries) {
		const fullPath = join(directory, entry);
		let stat: ReturnType<typeof statSync>;
		try {
			stat = statSync(fullPath);
		} catch {
			continue;
		}
		if (stat.isDirectory()) {
			collectProjectKeys(fullPath, vaultRoot, keys);
			continue;
		}
		if (!entry.endsWith('.md')) continue;
		try {
			const content = readFileSync(fullPath, 'utf-8');
			const parsed = parseMarkdown(content, entry);
			if (!parsed) continue;
			keys.add(normalizeWikilink(parsed.title));
			keys.add(normalizeWikilink(basename(entry, extname(entry))));
			if (parsed.entityId) keys.add(normalizeWikilink(parsed.entityId));
			const relNoExt = relative(vaultRoot, fullPath).replace(/\\/g, '/').replace(/\.md$/, '');
			if (relNoExt) keys.add(normalizeWikilink(relNoExt));
		} catch {
			// 单个归档文件解析失败不影响整体
		}
	}
}

/** 判定 review 笔记是否应进入复习链路：关联项目 frozen 或已归档时排除。 */
function isRevisionCandidate(
	row: RevisionCandidate,
	projects: Map<string, ProjectRef>,
	archivedKeys: Set<string>,
): boolean {
	if (!row.project) return true;
	const key = normalizeWikilink(row.project);
	if (archivedKeys.has(key)) return false;
	if (projects.get(key)?.status === 'frozen') return false;
	return true;
}

function allRevisionCandidates(
	db: Database.Database,
	vaultRoot: string,
	config?: VaultConfig,
): RevisionCandidate[] {
	const projects = projectLookup(db);
	const archivedKeys = loadArchivedProjectKeys(vaultRoot, config);
	const rows = db
		.prepare(`
			SELECT title, status, domain, project
			FROM vault_index
			WHERE type IN ('note', 'knowledge') AND status = 'review'
			ORDER BY modified_at DESC
		`)
		.all() as RevisionCandidate[];
	return rows.filter((row) => isRevisionCandidate(row, projects, archivedKeys));
}

export function selectRevisionCandidates(
	db: Database.Database,
	vaultRoot: string,
	config?: VaultConfig,
): RevisionCandidate[] {
	return allRevisionCandidates(db, vaultRoot, config).slice(0, 10);
}

export function countRevisionCandidates(
	db: Database.Database,
	vaultRoot: string,
	config?: VaultConfig,
): number {
	return allRevisionCandidates(db, vaultRoot, config).length;
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

function buildRevisionsSection(
	db: Database.Database,
	vaultRoot: string,
	config?: VaultConfig,
): string {
	const rows = selectRevisionCandidates(db, vaultRoot, config);
	if (!rows.length) return '暂无待复习的知识笔记。';
	return rows
		.map((row) => `- 待复习 **${row.title}**${row.domain ? ` [${row.domain}]` : ''}`)
		.join('\n');
}

export function buildTaskboardSections(
	db: Database.Database,
	vaultRoot: string,
	config?: VaultConfig,
): Record<string, string> {
	const projects = selectActiveProjects(db);
	return {
		focus: buildTaskboardFocusSection(db),
		'active-projects': buildActiveProjectsSection(projects),
		revises: buildRevisionsSection(db, vaultRoot, config),
	};
}
