/** Vault Markdown 的增量、批量索引器。 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { parse as parseYaml } from 'yaml';
import { type VaultConfig, getOrCreateVaultConfig } from '../config.js';
import { initDb } from '../db/schema.js';
import { generateEnhancedSearchTerms, mergeSearchHints } from '../services/enhance.js';
import type { MemoryScope } from '../types.js';
import {
	type ScanStateEntry,
	buildScanStateRow,
	deleteScanStateRows,
	isSameObservedState,
	loadScanState,
	upsertScanStateRows,
} from './scan-state.js';
import { buildSearchTokens } from './segmenter.js';
import { extractWikilinks, normalizeWikilink } from './wikilink.js';

export interface ParsedMarkdown {
	title: string;
	type: string | null;
	status: string | null;
	domain: string | null;
	category: string | null;
	tags: string;
	aliases: string;
	summary: string;
	searchHints: string;
	wikilinks: string;
	backlinks: string;
	sectionHeads: string;
	contentHash: string;
	project: string | null;
	entityId: string | null;
}

export interface IndexImpact {
	vaultIndexChanged: boolean;
	backlinksChanged: boolean;
	taskboardChanged: boolean;
	profileChanged: boolean;
	affectedScopes: MemoryScope[];
	changedEntityIds: string[];
}

export interface ScanResult {
	indexed: number;
	skipped: number;
	unchanged: number;
	removed: number;
	impact: IndexImpact;
}

export interface IndexResult {
	status: 'indexed' | 'unchanged' | 'skipped' | 'removed';
	filePath: string;
	reason?: string;
}

export interface BatchIndexResult {
	results: IndexResult[];
	impact: IndexImpact;
}

interface IndexedRow {
	file_path: string;
	title: string | null;
	type: string | null;
	status: string | null;
	domain: string | null;
	category: string | null;
	summary: string | null;
	modified_at: string | null;
	project: string | null;
	entity_id: string | null;
}

interface IndexChange {
	result: IndexResult;
	before: IndexedRow | null;
	after: IndexedRow | null;
	changed: boolean;
}

const EMPTY_IMPACT: IndexImpact = {
	vaultIndexChanged: false,
	backlinksChanged: false,
	taskboardChanged: false,
	profileChanged: false,
	affectedScopes: [],
	changedEntityIds: [],
};

export function shouldIndex(relativePath: string, config?: VaultConfig): boolean {
	if (!relativePath.endsWith('.md')) return false;
	if (!config) return false;
	if (config.excludedPrefixes().some((prefix) => relativePath.startsWith(prefix))) return false;
	return config.scanPrefixes().some((prefix) => relativePath.startsWith(prefix));
}

function toJsonArrayString(value: unknown): string {
	if (value == null) return JSON.stringify([]);
	if (Array.isArray(value)) return JSON.stringify(value.map((item) => String(item)));
	return JSON.stringify([String(value)]);
}

export function parseMarkdown(content: string, fileName: string): ParsedMarkdown | null {
	if (!content.startsWith('---')) return null;
	const endIndex = content.indexOf('\n---', 3);
	if (endIndex === -1) return null;
	const yamlText = content.slice(3, endIndex).trim();
	const body = content.slice(endIndex + 4).replace(/^\n+/, '');

	let parsedFrontmatter: unknown;
	try {
		parsedFrontmatter = parseYaml(yamlText);
	} catch (error) {
		console.warn('[lifeos] YAML 解析失败:', error);
		return null;
	}
	if (
		!parsedFrontmatter ||
		typeof parsedFrontmatter !== 'object' ||
		Array.isArray(parsedFrontmatter)
	) {
		return null;
	}
	const frontmatter = parsedFrontmatter as Record<string, unknown>;
	if (Object.keys(frontmatter).length === 0) return null;

	const fileStem = basename(fileName, extname(fileName));
	const title = (frontmatter.title as string | undefined) || fileStem;
	const type = (frontmatter.type as string | undefined) ?? null;
	const status = (frontmatter.status as string | undefined) ?? null;
	const domain = (frontmatter.domain as string | undefined) ?? null;
	const category = (frontmatter.category as string | undefined) ?? null;
	const project = (frontmatter.project as string | undefined) ?? null;
	const rawId = frontmatter.id;
	const entityId =
		typeof rawId === 'string' && rawId.trim() && !/\{\{.*?\}\}/.test(rawId.trim())
			? rawId.trim()
			: null;
	const tags = toJsonArrayString(frontmatter.tags);
	const aliases = toJsonArrayString(frontmatter.aliases);
	const wikilinks = JSON.stringify(extractWikilinks(body));
	const sectionHeads = JSON.stringify(
		[...body.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1]?.trim() ?? ''),
	);
	const summary = body.slice(0, 500).trim();
	const tagsArray = JSON.parse(tags) as string[];
	const baseSearchHints = buildSearchTokens(title, summary, tagsArray, domain);
	const enhancedTerms = generateEnhancedSearchTerms({
		title,
		type,
		domain,
		status,
		summary,
		aliases,
		sectionHeads,
	});
	return {
		title,
		type,
		status,
		domain,
		category,
		tags,
		aliases,
		summary,
		searchHints: mergeSearchHints(baseSearchHints, enhancedTerms),
		wikilinks,
		backlinks: JSON.stringify([]),
		sectionHeads,
		contentHash: createHash('md5').update(content, 'utf-8').digest('hex'),
		project,
		entityId,
	};
}

function selectIndexedRow(db: Database.Database, filePath: string): IndexedRow | null {
	return (
		(db
			.prepare(`
				SELECT file_path, title, type, status, domain, category, summary,
				       modified_at, project, entity_id
				FROM vault_index WHERE file_path = ?
			`)
			.get(filePath) as IndexedRow | undefined) ?? null
	);
}

function upsertIndex(
	db: Database.Database,
	filePath: string,
	parsed: ParsedMarkdown,
	fileSize: number,
	createdAt: string,
	modifiedAt: string,
): void {
	const now = new Date().toISOString();
	db.prepare(`
		INSERT INTO vault_index (
			file_path, title, type, status, domain, category, tags, aliases,
			summary, search_hints, wikilinks, backlinks, section_heads,
			content_hash, file_size, created_at, modified_at, indexed_at, project, entity_id
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(file_path) DO UPDATE SET
			title = excluded.title,
			type = excluded.type,
			status = excluded.status,
			domain = excluded.domain,
			category = excluded.category,
			tags = excluded.tags,
			aliases = excluded.aliases,
			summary = excluded.summary,
			search_hints = excluded.search_hints,
			wikilinks = excluded.wikilinks,
			section_heads = excluded.section_heads,
			content_hash = excluded.content_hash,
			file_size = excluded.file_size,
			modified_at = excluded.modified_at,
			indexed_at = excluded.indexed_at,
			project = excluded.project,
			entity_id = excluded.entity_id
	`).run(
		filePath,
		parsed.title,
		parsed.type,
		parsed.status,
		parsed.domain,
		parsed.category,
		parsed.tags,
		parsed.aliases,
		parsed.summary,
		parsed.searchHints,
		parsed.wikilinks,
		parsed.sectionHeads,
		parsed.contentHash,
		fileSize,
		createdAt,
		modifiedAt,
		now,
		parsed.project,
		parsed.entityId,
	);
}

function removeIndexEntry(db: Database.Database, filePath: string): void {
	db.prepare('DELETE FROM vault_index WHERE file_path = ?').run(filePath);
	deleteScanStateRows(db, [filePath]);
}

function isConfirmedMissing(path: string): boolean {
	try {
		statSync(path);
		return false;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'ENOENT';
	}
}

function* walkMdFiles(directory: string): Generator<string> {
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
		if (stat.isDirectory()) yield* walkMdFiles(fullPath);
		else if (stat.isFile() && entry.endsWith('.md')) yield fullPath;
	}
}

interface BacklinkIndexRow {
	file_path: string;
	title: string | null;
	aliases: string | null;
	wikilinks: string | null;
	backlinks: string | null;
}

interface WikilinkResolver {
	byPath: Map<string, string>;
	byTitle: Map<string, string | null>;
	byAlias: Map<string, string | null>;
	byStem: Map<string, string | null>;
}

function safeParseArray(raw: string): string[] {
	try {
		const value: unknown = JSON.parse(raw);
		return Array.isArray(value) ? value.map(String) : [];
	} catch {
		return [];
	}
}

function addUnique(
	map: Map<string, string | null>,
	key: string | null | undefined,
	filePath: string,
): void {
	const normalized = normalizeWikilink(String(key ?? ''));
	if (!normalized) return;
	const existing = map.get(normalized);
	if (existing === undefined) map.set(normalized, filePath);
	else if (existing !== filePath) map.set(normalized, null);
}

function buildWikilinkResolver(rows: BacklinkIndexRow[]): WikilinkResolver {
	const byPath = new Map<string, string>();
	const byTitle = new Map<string, string | null>();
	const byAlias = new Map<string, string | null>();
	const byStem = new Map<string, string | null>();
	for (const row of rows) {
		byPath.set(row.file_path, row.file_path);
		if (row.file_path.endsWith('.md')) byPath.set(row.file_path.slice(0, -3), row.file_path);
		addUnique(byTitle, row.title, row.file_path);
		addUnique(byStem, basename(row.file_path, extname(row.file_path)), row.file_path);
		for (const alias of safeParseArray(row.aliases ?? '[]')) {
			addUnique(byAlias, alias, row.file_path);
		}
	}
	return { byPath, byTitle, byAlias, byStem };
}

function resolveWikilinkTarget(target: string, resolver: WikilinkResolver): string | null {
	const normalized = normalizeWikilink(target);
	if (!normalized) return null;
	return (
		resolver.byPath.get(normalized) ??
		resolver.byPath.get(`${normalized}.md`) ??
		resolver.byTitle.get(normalized) ??
		resolver.byAlias.get(normalized) ??
		resolver.byStem.get(normalized) ??
		null
	);
}

export function recomputeAllBacklinks(db: Database.Database): boolean {
	const rows = db
		.prepare('SELECT file_path, title, aliases, wikilinks, backlinks FROM vault_index')
		.all() as BacklinkIndexRow[];
	if (rows.length === 0) return false;
	const resolver = buildWikilinkResolver(rows);
	const desired = new Map(rows.map((row) => [row.file_path, new Set<string>()]));
	for (const row of rows) {
		for (const target of safeParseArray(row.wikilinks ?? '[]')) {
			const targetPath = resolveWikilinkTarget(target, resolver);
			if (targetPath) desired.get(targetPath)?.add(row.file_path);
		}
	}
	const update = db.prepare('UPDATE vault_index SET backlinks = ? WHERE file_path = ?');
	let changed = false;
	for (const row of rows) {
		const value = JSON.stringify([...(desired.get(row.file_path) ?? [])].sort());
		const current = JSON.stringify(safeParseArray(row.backlinks ?? '[]').sort());
		if (value !== current) {
			update.run(value, row.file_path);
			changed = true;
		}
	}
	return changed;
}

function normalizeRelative(vaultRoot: string, filePath: string): string {
	const root = resolve(vaultRoot);
	const absolute = isAbsolute(filePath) ? resolve(filePath) : resolve(root, filePath);
	const rel = relative(root, absolute).replace(/\\/g, '/');
	if (!rel || rel === '..' || rel.startsWith('../')) {
		throw new Error(`文件路径不在 Vault 内：${filePath}`);
	}
	return rel;
}

function indexOne(
	db: Database.Database,
	vaultRoot: string,
	filePath: string,
	config: VaultConfig,
	scanState: Record<string, ScanStateEntry>,
): IndexChange {
	const relPath = normalizeRelative(vaultRoot, filePath);
	const before = selectIndexedRow(db, relPath);
	if (!shouldIndex(relPath, config)) {
		return {
			result: { status: 'skipped', filePath: relPath, reason: 'excluded by scan rules' },
			before,
			after: before,
			changed: false,
		};
	}
	const absolutePath = join(vaultRoot, relPath);
	if (!existsSync(absolutePath)) {
		if (before) removeIndexEntry(db, relPath);
		return {
			result: { status: 'removed', filePath: relPath },
			before,
			after: null,
			changed: before !== null,
		};
	}
	let stat: ReturnType<typeof statSync>;
	let content: string;
	try {
		stat = statSync(absolutePath);
		content = readFileSync(absolutePath, 'utf-8');
	} catch {
		return {
			result: { status: 'skipped', filePath: relPath, reason: 'could not read file' },
			before,
			after: before,
			changed: false,
		};
	}
	const state = scanState[relPath];
	if (state && before && isSameObservedState(state, stat.mtimeMs, stat.size)) {
		return {
			result: { status: 'unchanged', filePath: relPath },
			before,
			after: before,
			changed: false,
		};
	}
	const parsed = parseMarkdown(content, basename(absolutePath));
	if (!parsed) {
		if (before) removeIndexEntry(db, relPath);
		return {
			result: {
				status: before ? 'removed' : 'skipped',
				filePath: relPath,
				reason: 'no valid frontmatter',
			},
			before,
			after: null,
			changed: before !== null,
		};
	}
	const modifiedAt = new Date(stat.mtimeMs).toISOString();
	upsertIndex(db, relPath, parsed, stat.size, modifiedAt, modifiedAt);
	upsertScanStateRows(db, [
		buildScanStateRow(
			relPath,
			parsed.contentHash,
			stat.mtimeMs,
			stat.size,
			new Date().toISOString(),
		),
	]);
	const after = selectIndexedRow(db, relPath);
	return {
		result: { status: 'indexed', filePath: relPath },
		before,
		after,
		changed: true,
	};
}

function addScope(scopes: Map<string, MemoryScope>, scope: MemoryScope): void {
	scopes.set(`${scope.type}\u0000${scope.key}`, scope);
}

function rowAffectsTaskboard(row: IndexedRow | null): boolean {
	if (!row) return false;
	if (row.type === 'project') return true;
	return (
		(row.type === 'note' || row.type === 'knowledge') &&
		(row.status === 'review' || row.project !== null)
	);
}

function rowAffectsProfile(row: IndexedRow | null): boolean {
	return row?.type === 'project' && row.category === 'learning';
}

function buildImpact(changes: IndexChange[], backlinksChanged: boolean): IndexImpact {
	if (!changes.length) return { ...EMPTY_IMPACT };
	const scopes = new Map<string, MemoryScope>();
	const entityIds = new Set<string>();
	let taskboardChanged = false;
	let profileChanged = false;
	for (const change of changes) {
		for (const row of [change.before, change.after]) {
			if (!row) continue;
			addScope(scopes, { type: 'file', key: row.entity_id || row.file_path });
			if (row.entity_id) entityIds.add(row.entity_id);
			if (row.type === 'project' && row.entity_id) {
				addScope(scopes, { type: 'project', key: row.entity_id });
			}
		}
		taskboardChanged ||= rowAffectsTaskboard(change.before) || rowAffectsTaskboard(change.after);
		profileChanged ||= rowAffectsProfile(change.before) || rowAffectsProfile(change.after);
	}
	return {
		vaultIndexChanged: true,
		backlinksChanged,
		taskboardChanged,
		profileChanged,
		affectedScopes: [...scopes.values()],
		changedEntityIds: [...entityIds].sort(),
	};
}

export function indexFiles(
	db: Database.Database,
	vaultRoot: string,
	filePaths: string[],
	config?: VaultConfig,
): BatchIndexResult {
	const cfg = config ?? getOrCreateVaultConfig(vaultRoot);
	const scanState = loadScanState(db);
	const normalized = [
		...new Set(filePaths.map((path) => normalizeRelative(vaultRoot, path))),
	].sort();
	const transaction = db.transaction(() => {
		const changes = normalized.map((path) => indexOne(db, vaultRoot, path, cfg, scanState));
		const effective = changes.filter((change) => change.changed);
		const backlinksChanged = effective.length > 0 ? recomputeAllBacklinks(db) : false;
		return {
			results: changes.map((change) => change.result),
			impact: buildImpact(effective, backlinksChanged),
		};
	});
	return transaction.immediate();
}

export function indexSingleFile(
	db: Database.Database,
	vaultRoot: string,
	filePath: string,
	config?: VaultConfig,
): IndexResult {
	return indexFiles(db, vaultRoot, [filePath], config).results[0] as IndexResult;
}

function configuredRootsReadable(vaultRoot: string, config: VaultConfig): boolean {
	return config.scanPrefixes().every((prefix) => {
		try {
			const directory = join(vaultRoot, prefix.replace(/\/$/, ''));
			return statSync(directory).isDirectory() && Array.isArray(readdirSync(directory));
		} catch {
			return false;
		}
	});
}

export function fullScan(
	vaultRoot: string,
	dbOrPath: string | Database.Database,
	config?: VaultConfig,
): ScanResult {
	const cfg = config ?? getOrCreateVaultConfig(vaultRoot);
	const owned = typeof dbOrPath === 'string';
	const db = owned ? new Database(dbOrPath) : dbOrPath;
	if (owned) {
		db.pragma('journal_mode = WAL');
		initDb(db);
	}
	try {
		const paths: string[] = [];
		const seen = new Set<string>();
		for (const prefix of [...new Set(cfg.scanPrefixes())]) {
			const directory = join(vaultRoot, prefix.replace(/\/$/, ''));
			for (const absolutePath of walkMdFiles(directory)) {
				const relPath = relative(vaultRoot, absolutePath).replace(/\\/g, '/');
				if (!shouldIndex(relPath, cfg)) continue;
				seen.add(relPath);
				paths.push(relPath);
			}
		}
		const scanState = loadScanState(db);
		const transaction = db.transaction(() => {
			const changes = [...new Set(paths)]
				.sort()
				.map((path) => indexOne(db, vaultRoot, path, cfg, scanState));
			if (configuredRootsReadable(vaultRoot, cfg)) {
				const indexedPaths = db.prepare('SELECT file_path FROM vault_index').all() as Array<{
					file_path: string;
				}>;
				for (const { file_path } of indexedPaths) {
					if (
						shouldIndex(file_path, cfg) &&
						!seen.has(file_path) &&
						isConfirmedMissing(join(vaultRoot, file_path))
					) {
						const before = selectIndexedRow(db, file_path);
						removeIndexEntry(db, file_path);
						changes.push({
							result: { status: 'removed', filePath: file_path },
							before,
							after: null,
							changed: before !== null,
						});
					}
				}
			}
			const effective = changes.filter((change) => change.changed);
			const backlinksChanged = effective.length > 0 ? recomputeAllBacklinks(db) : false;
			return { changes, impact: buildImpact(effective, backlinksChanged) };
		});
		const { changes, impact } = transaction.immediate();
		return {
			indexed: changes.filter((change) => change.result.status === 'indexed').length,
			skipped: changes.filter((change) => change.result.status === 'skipped').length,
			unchanged: changes.filter((change) => change.result.status === 'unchanged').length,
			removed: changes.filter((change) => change.result.status === 'removed').length,
			impact,
		};
	} finally {
		if (owned) db.close();
	}
}
