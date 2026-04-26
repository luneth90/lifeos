/**
 * vault-indexer.ts — Vault 索引器。
 *
 * Scans Vault markdown files, parses frontmatter, and writes to the
 * SQLite index. Supports full scans, single-file indexing, incremental
 * scans via scan-state, and backlinks computation.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import Database from 'better-sqlite3';
import { parse as parseYaml } from 'yaml';
import { VaultConfig, getVaultConfig } from '../config.js';
import { initDb } from '../db/schema.js';
import { generateEnhancedSearchTerms, mergeSearchHints } from '../services/enhance.js';
import {
	type ScanStateRow,
	buildScanStateRow,
	deleteScanStateRows,
	isSameObservedState,
	loadScanState,
	upsertScanStateRows,
} from './scan-state.js';
import { buildSearchTokens } from './segmenter.js';
import { extractWikilinks, normalizeWikilink } from './wikilink.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedMarkdown {
	title: string;
	type: string | null;
	status: string | null;
	domain: string | null;
	category: string | null;
	tags: string; // JSON array string
	aliases: string; // JSON array string
	summary: string;
	searchHints: string;
	wikilinks: string; // JSON array string
	backlinks: string; // JSON array string (always [])
	sectionHeads: string; // JSON array string
	contentHash: string;
	project: string | null;
}

export interface ScanResult {
	indexed: number;
	skipped: number;
	unchanged: number;
	removed: number;
}

export interface IndexResult {
	status: 'indexed' | 'skipped' | 'removed';
	filePath?: string;
	reason?: string;
}

// ─── Scan rules ───────────────────────────────────────────────────────────────

/**
 * Determine whether a vault-relative file path should be indexed.
 * Returns true only if path ends in .md, matches an included prefix,
 * and does not match an excluded prefix.
 */
export function shouldIndex(relativePath: string, config?: VaultConfig): boolean {
	if (!relativePath.endsWith('.md')) return false;

	const cfg = config ?? getVaultConfig();
	if (!cfg) return false;

	const excluded = cfg.excludedPrefixes();
	for (const prefix of excluded) {
		if (relativePath.startsWith(prefix)) return false;
	}

	const included = cfg.scanPrefixes();
	for (const prefix of included) {
		if (relativePath.startsWith(prefix)) return true;
	}

	return false;
}

// ─── Markdown parsing ─────────────────────────────────────────────────────────

/**
 * Coerce a raw YAML value into a JSON array string.
 * Handles arrays, strings, and null/undefined.
 */
function toJsonArrayString(value: unknown): string {
	if (value == null) return JSON.stringify([]);
	if (Array.isArray(value)) {
		return JSON.stringify(value.map((item) => String(item)));
	}
	return JSON.stringify([String(value)]);
}

/**
 * Parse a markdown file's content, extracting frontmatter and body metadata.
 * Returns null if the file has no valid frontmatter.
 */
export function parseMarkdown(content: string, fileName: string): ParsedMarkdown | null {
	if (!content.startsWith('---')) return null;

	const endIdx = content.indexOf('\n---', 3);
	if (endIdx === -1) return null;

	const yamlText = content.slice(3, endIdx).trim();
	const body = content.slice(endIdx + 4).replace(/^\n+/, '');

	let fm: unknown;
	try {
		fm = parseYaml(yamlText);
	} catch (e) {
		console.warn('[lifeos] YAML parse failed:', e);
		return null;
	}

	if (!fm || typeof fm !== 'object' || Array.isArray(fm)) return null;
	const frontmatter = fm as Record<string, unknown>;
	if (Object.keys(frontmatter).length === 0) return null;

	// Core fields
	const fileStem = basename(fileName, extname(fileName));
	const title = (frontmatter.title as string | undefined) || fileStem;
	const type = (frontmatter.type as string | undefined) ?? null;
	const status = (frontmatter.status as string | undefined) ?? null;
	const domain = (frontmatter.domain as string | undefined) ?? null;
	const category = (frontmatter.category as string | undefined) ?? null;
	const project = (frontmatter.project as string | undefined) ?? null;

	// Tags & aliases
	const tags = toJsonArrayString(frontmatter.tags);
	const aliases = toJsonArrayString(frontmatter.aliases);

	// Wikilinks from body
	const wikilinks = JSON.stringify(extractWikilinks(body));

	// Section heads from body
	const sectionHeadMatches = [...body.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1].trim());
	const sectionHeads = JSON.stringify(sectionHeadMatches);

	// Summary — first 500 chars of body
	const summary = body.slice(0, 500).trim();

	// Search hints from title + summary + tags + domain
	const tagsArray = JSON.parse(tags) as string[];
	const baseSearchHints = buildSearchTokens(title, summary, tagsArray, domain);

	// Enhance: merge enhanced search terms into base hints
	const enhanceInput = { title, type, domain, status, summary, aliases, sectionHeads };
	const enhancedTerms = generateEnhancedSearchTerms(enhanceInput);
	const searchHints = mergeSearchHints(baseSearchHints, enhancedTerms);

	// Content hash
	const contentHash = createHash('md5').update(content, 'utf-8').digest('hex');

	return {
		title,
		type,
		status,
		domain,
		category,
		tags,
		aliases,
		summary,
		searchHints,
		wikilinks,
		backlinks: JSON.stringify([]),
		sectionHeads,
		contentHash,
		project,
	};
}

// ─── Database upsert ──────────────────────────────────────────────────────────

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
    INSERT OR REPLACE INTO vault_index
    (file_path, title, type, status, domain, category, tags, aliases,
     summary, search_hints, wikilinks, backlinks,
     section_heads, content_hash, file_size, created_at, modified_at, indexed_at, project)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
		parsed.backlinks,
		parsed.sectionHeads,
		parsed.contentHash,
		fileSize,
		createdAt,
		modifiedAt,
		now,
		parsed.project,
	);
}

function removeIndexEntry(db: Database.Database, filePath: string): void {
	db.prepare('DELETE FROM vault_index WHERE file_path = ?').run(filePath);
}

/** Return true only when statSync fails with ENOENT (file confirmed deleted).
 *  Any other error (EACCES, EIO, etc.) returns false to avoid purging live rows. */
function isConfirmedMissing(absPath: string): boolean {
	try {
		statSync(absPath);
		return false;
	} catch (err: unknown) {
		return (err as NodeJS.ErrnoException).code === 'ENOENT';
	}
}

/** Check that the vault looks genuine before allowing pruning.
 *  The root must be readable AND at least one configured scan-prefix directory
 *  must exist on disk. This prevents mass-deletion when the vault root points
 *  at an empty/stale mountpoint that is technically readable but has none of
 *  the vault's actual content. */
function isVaultIntact(vaultRoot: string, cfg: VaultConfig): boolean {
	try {
		readdirSync(vaultRoot);
	} catch {
		return false;
	}
	// At least one scan-prefix dir must exist (e.g. "00_草稿/", "20_项目/")
	for (const prefix of cfg.scanPrefixes()) {
		// prefix has trailing slash (e.g. "00_草稿/"), strip it for the dir check
		const dir = join(vaultRoot, prefix.replace(/\/$/, ''));
		try {
			statSync(dir);
			return true;
		} catch {
			// try next prefix
		}
	}
	return false;
}

// ─── Recursive file walk ──────────────────────────────────────────────────────

function* walkMdFiles(dir: string): Generator<string> {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const entry of entries) {
		const fullPath = join(dir, entry);
		let stat: ReturnType<typeof statSync>;
		try {
			stat = statSync(fullPath);
		} catch {
			continue;
		}
		if (stat.isDirectory()) {
			yield* walkMdFiles(fullPath);
		} else if (stat.isFile() && entry.endsWith('.md')) {
			yield fullPath;
		}
	}
}

// ─── Backlinks ────────────────────────────────────────────────────────────────

interface BacklinkIndexRow {
	file_path: string;
	title: string | null;
	aliases: string | null;
	wikilinks: string | null;
}

interface WikilinkResolver {
	byPath: Map<string, string>;
	byTitle: Map<string, string | null>;
	byAlias: Map<string, string | null>;
	byStem: Map<string, string | null>;
}

function addUnique(
	map: Map<string, string | null>,
	key: string | null | undefined,
	filePath: string,
) {
	const normalized = normalizeWikilink(String(key ?? ''));
	if (!normalized) return;
	const existing = map.get(normalized);
	if (existing === undefined) {
		map.set(normalized, filePath);
	} else if (existing !== filePath) {
		map.set(normalized, null);
	}
}

function buildWikilinkResolver(rows: BacklinkIndexRow[]): WikilinkResolver {
	const byPath = new Map<string, string>();
	const byTitle = new Map<string, string | null>();
	const byAlias = new Map<string, string | null>();
	const byStem = new Map<string, string | null>();

	for (const row of rows) {
		byPath.set(row.file_path, row.file_path);
		if (row.file_path.endsWith('.md')) {
			byPath.set(row.file_path.slice(0, -3), row.file_path);
		}

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

	const pathMatch = resolver.byPath.get(normalized) ?? resolver.byPath.get(`${normalized}.md`);
	if (pathMatch) return pathMatch;

	const titleMatch = resolver.byTitle.get(normalized);
	if (titleMatch) return titleMatch;

	const aliasMatch = resolver.byAlias.get(normalized);
	if (aliasMatch) return aliasMatch;

	const stemMatch = resolver.byStem.get(normalized);
	if (stemMatch) return stemMatch;

	return null;
}

/**
 * Recompute backlinks for all indexed files based on current wikilinks.
 *
 * Reads every row's wikilinks, builds a reverse index (target → list of
 * sources), then writes the aggregated backlinks back to each target's
 * row. Files with no incoming links get an empty array.
 */
function recomputeAllBacklinks(db: Database.Database): void {
	// Reset all backlinks first
	db.prepare("UPDATE vault_index SET backlinks = '[]'").run();

	const rows = db
		.prepare('SELECT file_path, title, aliases, wikilinks FROM vault_index')
		.all() as BacklinkIndexRow[];

	if (rows.length === 0) return;

	const resolver = buildWikilinkResolver(rows);
	const linkMap = new Map<string, Set<string>>();
	for (const row of rows) {
		let targets: string[];
		try {
			targets = JSON.parse(row.wikilinks ?? '[]');
		} catch {
			continue;
		}
		if (!Array.isArray(targets)) continue;

		for (const target of targets) {
			const targetPath = resolveWikilinkTarget(String(target), resolver);
			if (!targetPath) continue;
			if (!linkMap.has(targetPath)) linkMap.set(targetPath, new Set());
			linkMap.get(targetPath)?.add(row.file_path);
		}
	}

	if (linkMap.size === 0) return;

	const stmt = db.prepare('UPDATE vault_index SET backlinks = ? WHERE file_path = ?');
	for (const [target, sources] of linkMap) {
		stmt.run(JSON.stringify([...sources]), target);
	}
}

// ─── Full scan ────────────────────────────────────────────────────────────────

/**
 * Scan all .md files in the vault and index them into the SQLite database.
 *
 * Supports incremental scans: when a scan_state table is available, files
 * whose mtime + size match the last indexed state are skipped.
 *
 * @param vaultRoot   Absolute path to the vault root
 * @param dbOrPath    SQLite database path (string) or an already-open
 *                     better-sqlite3 Database. When a Database is passed,
 *                     the caller retains ownership (no initDb / close).
 * @param config      Optional pre-resolved VaultConfig
 * @returns           Counts of indexed, skipped, unchanged, and removed files
 */
export function fullScan(
	vaultRoot: string,
	dbOrPath: string | Database.Database,
	config?: VaultConfig,
): ScanResult {
	const cfg = config ?? getVaultConfig() ?? new VaultConfig(vaultRoot);

	const ownDb = typeof dbOrPath === 'string';
	const db: Database.Database = ownDb ? new Database(dbOrPath) : dbOrPath;
	if (ownDb) {
		db.pragma('journal_mode = WAL');
		initDb(db);
	}

	try {
		const scanState = loadScanState(db);
		const newScanRows: ScanStateRow[] = [];
		const now = new Date().toISOString();
		let indexed = 0;
		let skipped = 0;
		let unchanged = 0;
		const seenPaths = new Set<string>();

		for (const absPath of walkMdFiles(vaultRoot)) {
			const relPath = relative(vaultRoot, absPath).replace(/\\/g, '/');
			seenPaths.add(relPath);

			if (!shouldIndex(relPath, cfg)) {
				skipped++;
				continue;
			}

			let stat: ReturnType<typeof statSync>;
			try {
				stat = statSync(absPath);
			} catch {
				skipped++;
				continue;
			}

			// Incremental: skip unchanged files
			const state = scanState[relPath];
			if (state && isSameObservedState(state, stat.mtimeMs, stat.size)) {
				const idxRow = db.prepare('SELECT 1 FROM vault_index WHERE file_path = ?').get(relPath);
				if (idxRow) {
					unchanged++;
					continue;
				}
			}

			let content: string;
			try {
				content = readFileSync(absPath, 'utf-8');
			} catch {
				skipped++;
				continue;
			}

			const parsed = parseMarkdown(content, basename(absPath));
			if (parsed === null) {
				skipped++;
				continue;
			}

			const fileSize = stat.size;
			const modifiedAt = new Date(stat.mtimeMs).toISOString();
			const createdAt = modifiedAt;

			upsertIndex(db, relPath, parsed, fileSize, createdAt, modifiedAt);
			newScanRows.push(buildScanStateRow(relPath, parsed.contentHash, stat.mtimeMs, fileSize, now));
			indexed++;
		}

		// Batch upsert scan state for changed/new files
		upsertScanStateRows(db, newScanRows);

		// Remove stale entries for files confirmed deleted from disk.
		let removed = 0;
		if (isVaultIntact(vaultRoot, cfg)) {
			const rows = db.prepare('SELECT file_path FROM vault_index').all() as Array<{
				file_path: string;
			}>;
			const removedPaths: string[] = [];
			for (const { file_path } of rows) {
				if (!seenPaths.has(file_path) && isConfirmedMissing(join(vaultRoot, file_path))) {
					removeIndexEntry(db, file_path);
					removedPaths.push(file_path);
					removed++;
				}
			}
			// Clean up scan_state for removed files
			if (removedPaths.length > 0) {
				deleteScanStateRows(db, removedPaths);
			}
		}

		// Compute backlinks after stale rows are removed.
		recomputeAllBacklinks(db);

		return { indexed, skipped, unchanged, removed };
	} finally {
		if (ownDb) db.close();
	}
}

// ─── Index single file ────────────────────────────────────────────────────────

/**
 * Index or re-index a single file. Handles absolute or relative paths.
 * If the file has been deleted, removes its entry from the index.
 */
export function indexSingleFile(
	vaultRoot: string,
	dbPath: string,
	filePath: string,
	config?: VaultConfig,
): IndexResult {
	const cfg = config ?? getVaultConfig() ?? new VaultConfig(vaultRoot);

	// Normalise to relative path
	const relPath = filePath.startsWith(vaultRoot)
		? relative(vaultRoot, filePath).replace(/\\/g, '/')
		: filePath.replace(/\\/g, '/');

	if (!shouldIndex(relPath, cfg)) {
		return { status: 'skipped', reason: 'excluded by scan rules' };
	}

	const fullPath = join(vaultRoot, relPath);

	let stat: ReturnType<typeof statSync>;

	if (!existsSync(fullPath)) {
		// File was deleted — remove from index and recompute backlinks
		const db = new Database(dbPath);
		db.pragma('journal_mode = WAL');
		initDb(db);
		try {
			removeIndexEntry(db, relPath);
			deleteScanStateRows(db, [relPath]);

			recomputeAllBacklinks(db);
		} finally {
			db.close();
		}
		return { status: 'removed' };
	}

	let content: string;
	try {
		content = readFileSync(fullPath, 'utf-8');
	} catch {
		return { status: 'skipped', reason: 'could not read file' };
	}

	const parsed = parseMarkdown(content, basename(fullPath));
	if (parsed === null) {
		return { status: 'skipped', reason: 'no valid frontmatter' };
	}

	stat = statSync(fullPath);
	const fileSize = stat.size;
	const modifiedAt = new Date(stat.mtimeMs).toISOString();
	const createdAt = modifiedAt;

	const db = new Database(dbPath);
	db.pragma('journal_mode = WAL');
	initDb(db);
	try {
		upsertIndex(db, relPath, parsed, fileSize, createdAt, modifiedAt);

		// Persist scan state
		upsertScanStateRows(db, [
			buildScanStateRow(
				relPath,
				parsed.contentHash,
				stat.mtimeMs,
				fileSize,
				new Date().toISOString(),
			),
		]);

		recomputeAllBacklinks(db);
	} finally {
		db.close();
	}

	return { status: 'indexed', filePath: relPath };
}

/** Safely parse a JSON array string; returns [] on failure. */
function safeParseArray(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}
