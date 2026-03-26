/**
 * retrieval.ts — 检索服务。
 */

import type Database from 'better-sqlite3';
import { inClause, queryAll } from '../db/index.js';
import type { MatchSource, MemoryItemRow, SessionSelectRow, VaultSelectRow } from '../types.js';
import { daysAgo } from '../types.js';
import type { ScenePolicy } from '../utils/context-policy.js';
import { tokenize } from '../utils/segmenter.js';
import { compactText, containsCjk, loadsJsonList } from '../utils/shared.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VaultQueryResult {
	filePath: string;
	title: string;
	type: string | null;
	status: string | null;
	domain: string | null;
	summary: string | null;
	displaySummary: string;
	matchSource: MatchSource;
	matchedFields: string[];
	score: number;
	modifiedAt: string | null;
	masteryStatus?: string | null;
	tags?: string[];
	aliases?: string[];
	wikilinks?: string[];
	backlinks?: string[];
}

export interface SessionEvent {
	eventId: string;
	timestamp: string;
	entryType: string;
	importance: number;
	scope: string | null;
	skillName: string | null;
	summary: string;
	detail: string | null;
	sourceRefs: string[];
	relatedFiles: string[];
	relatedEntities: string[];
}

export interface MemoryItem {
	itemId: string;
	target: string;
	section: string;
	slotKey: string;
	content: string;
	confidence: string | null;
	sourceEventIds: string[];
	sourceRefs: string[];
	relatedFiles: string[];
	manualFlag: boolean;
	status: string;
	supersededBy: string | null;
	lastConfirmedAt: string | null;
	updatedAt: string;
	expiresAt: string | null;
}

// ─── Score constants ──────────────────────────────────────────────────────────

const BASE_SCORES: Record<MatchSource, number> = {
	exact_filter: 400,
	fts5: 300,
	hybrid_expand: 200,
	like_fallback: 120,
};

const FIELD_SCORES: Record<string, number> = {
	title: 120,
	semantic_summary: 90,
	summary: 70,
	search_hints: 60,
	tags: 30,
};

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Build FTS5 query string from a user query.
 * CJK → tokenize then quote each term: "四元数" "群"
 * English → prefix match: term1* term2*
 */
function ftsQuery(q: string): string {
	const hasCjk = containsCjk(q);
	if (hasCjk) {
		const terms = tokenize(q);
		if (terms.length === 0) return '';
		return terms.map((t) => `"${t}"`).join(' ');
	}
	// English: split words, add * prefix suffix
	const words = q.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return '';
	return words.map((w) => `${w}*`).join(' ');
}

/**
 * Extract query terms for matching verification.
 */
function queryTerms(query: string): string[] {
	if (containsCjk(query)) {
		return tokenize(query);
	}
	return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Check if text contains all query terms.
 */
function textMatchesTerms(text: string, terms: string[], hasCjk: boolean): boolean {
	if (terms.length === 0) return false;
	const lower = text.toLowerCase();
	if (hasCjk) {
		return terms.every((t) => lower.includes(t));
	}
	return terms.every((t) => lower.includes(t));
}

/**
 * Check which fields in a row matched the query.
 */
function matchedFields(query: string, row: VaultSelectRow): string[] {
	if (!query.trim()) return [];
	const terms = queryTerms(query);
	const hasCjk = containsCjk(query);
	const fieldMap: Record<string, string> = {
		title: 'title',
		summary: 'summary',
		semantic_summary: 'semantic_summary',
		search_hints: 'search_hints',
		tags: 'tags',
	};
	return Object.entries(fieldMap)
		.filter(([col]) => {
			const value = row[col as keyof VaultSelectRow];
			return value != null && textMatchesTerms(String(value), terms, hasCjk);
		})
		.map(([, name]) => name);
}

/**
 * Score a result based on match source and matched fields.
 */
function scoreResult(matchSource: MatchSource, fields: string[]): number {
	const base = BASE_SCORES[matchSource] ?? 100;
	const fieldBonus = fields.reduce((acc, f) => acc + (FIELD_SCORES[f] ?? 0), 0);
	return base + fieldBonus;
}

/**
 * Build a VaultQueryResult from a database row.
 */
function buildQueryResult(
	row: VaultSelectRow,
	matchSource: MatchSource,
	fields: string[],
): VaultQueryResult {
	const summary = row.summary != null ? String(row.summary) : null;
	const semanticSummary = row.semantic_summary != null ? String(row.semantic_summary) : null;

	return {
		filePath: String(row.file_path),
		title: row.title != null ? String(row.title) : '',
		type: row.type != null ? String(row.type) : null,
		status: row.status != null ? String(row.status) : null,
		domain: row.domain != null ? String(row.domain) : null,
		summary,
		displaySummary: compactText(semanticSummary ?? summary),
		matchSource,
		matchedFields: fields,
		score: scoreResult(matchSource, fields),
		modifiedAt: row.modified_at != null ? String(row.modified_at) : null,
		masteryStatus: row.status != null ? String(row.status) : null,
		tags: loadsJsonList(row.tags),
		aliases: loadsJsonList(row.aliases),
		wikilinks: loadsJsonList(row.wikilinks),
		backlinks: loadsJsonList(row.backlinks),
	};
}

/**
 * Build a SessionEvent from a database row.
 */
function buildSessionEvent(row: SessionSelectRow): SessionEvent {
	return {
		eventId: String(row.event_id),
		timestamp: String(row.timestamp),
		entryType: String(row.entry_type),
		importance: Number(row.importance),
		scope: row.scope != null ? String(row.scope) : null,
		skillName: row.skill_name != null ? String(row.skill_name) : null,
		summary: String(row.summary),
		detail: row.detail != null ? String(row.detail) : null,
		sourceRefs: loadsJsonList(row.source_refs),
		relatedFiles: loadsJsonList(row.related_files),
		relatedEntities: loadsJsonList(row.related_entities),
	};
}

/**
 * Merge two arrays and deduplicate by a key function.
 * Items from primary appear first; secondary items are appended if not already seen.
 */
function mergeAndDedupe<T>(primary: T[], secondary: T[], keyFn: (item: T) => string): T[] {
	const seen = new Set(primary.map(keyFn));
	const merged = [...primary];
	for (const item of secondary) {
		const key = keyFn(item);
		if (!seen.has(key)) {
			seen.add(key);
			merged.push(item);
		}
	}
	return merged;
}

/**
 * Rerank vault query results using scene policy.
 */
function rerankQueryResults(
	results: VaultQueryResult[],
	scenePolicy?: ScenePolicy | null,
): VaultQueryResult[] {
	if (!scenePolicy) return results;

	const rankingBias = scenePolicy.ranking_bias;
	if (!rankingBias || Object.keys(rankingBias).length === 0) return results;

	const scored = results.map((r) => {
		let bonus = 0;
		if (r.type && rankingBias[r.type] != null) {
			bonus += rankingBias[r.type];
		}
		if (r.domain && rankingBias[r.domain] != null) {
			bonus += rankingBias[r.domain];
		}
		return { result: r, finalScore: r.score + bonus };
	});

	scored.sort((a, b) => b.finalScore - a.finalScore);
	return scored.map((s) => s.result);
}

/**
 * Rerank session events using scene policy.
 */
function rerankRecentEvents(
	events: SessionEvent[],
	scenePolicy?: ScenePolicy | null,
): SessionEvent[] {
	if (!scenePolicy) return events;

	const bias = scenePolicy.recent_event_bias;
	if (!bias || Object.keys(bias).length === 0) return events;

	const scored = events.map((e) => ({
		event: e,
		bonus: bias[e.entryType] ?? 0,
	}));
	scored.sort((a, b) => b.bonus - a.bonus);
	return scored.map((s) => s.event);
}

// ─── Vault index SELECT fragment ──────────────────────────────────────────────

const VAULT_SELECT = `
  vi.file_path, vi.title, vi.type, vi.status, vi.domain,
  vi.summary, vi.semantic_summary, vi.search_hints,
  vi.tags, vi.aliases, vi.wikilinks, vi.backlinks,
  vi.modified_at
`.trim();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Main vault search: FTS5 + LIKE fallback + exact filter.
 */
export function queryVaultIndex(
	db: Database.Database,
	query: string,
	filters: Record<string, string> | null,
	limit: number,
	scenePolicy?: ScenePolicy | null,
): { results: VaultQueryResult[] } {
	const q = (query ?? '').trim();
	const hasQuery = q.length > 0;
	const hasFilters = filters != null && Object.keys(filters).length > 0;

	// Build WHERE clause for filters
	const filterConditions: string[] = [];
	const filterParams: unknown[] = [];
	if (hasFilters && filters != null) {
		for (const [key, value] of Object.entries(filters)) {
			filterConditions.push(`vi.${key} = ?`);
			filterParams.push(value);
		}
	}
	const filterWhere = filterConditions.length > 0 ? filterConditions.join(' AND ') : '';

	// Case 1: No query, no filters → empty
	if (!hasQuery && !hasFilters) {
		return { results: [] };
	}

	// Case 2: No query, has filters → exact filter
	if (!hasQuery && hasFilters) {
		const sql = `
      SELECT ${VAULT_SELECT}
      FROM vault_index vi
      WHERE ${filterWhere}
      ORDER BY vi.modified_at DESC
      LIMIT ?
    `;
		const rows = queryAll<VaultSelectRow>(db, sql, ...filterParams, limit);
		const results = rows.map((row) => buildQueryResult(row, 'exact_filter', matchedFields(q, row)));
		return { results: rerankQueryResults(results, scenePolicy) };
	}

	// Case 3: Has query — try FTS5 first
	const ftsQ = ftsQuery(q);
	let ftsRows: VaultSelectRow[] = [];
	let ftsError = false;

	if (ftsQ) {
		try {
			let sql = `
        SELECT ${VAULT_SELECT}
        FROM vault_index vi
        JOIN vault_fts vf ON vf.rowid = vi.rowid
        WHERE vault_fts MATCH ?
      `;
			const params: unknown[] = [ftsQ];

			if (filterWhere) {
				sql += ` AND ${filterWhere}`;
				params.push(...filterParams);
			}

			sql += ' ORDER BY vi.modified_at DESC LIMIT ?';
			params.push(limit * 2); // Over-fetch for reranking

			ftsRows = queryAll<VaultSelectRow>(db, sql, ...params);
		} catch {
			ftsError = true;
		}
	}

	const hasCjk = containsCjk(q);
	const needsFallback = ftsError || (hasCjk && ftsRows.length < 3);

	// FTS5 succeeded and has enough results
	if (!needsFallback && ftsRows.length > 0) {
		const results = ftsRows
			.slice(0, limit)
			.map((row) => buildQueryResult(row, 'fts5', matchedFields(q, row)));
		return { results: rerankQueryResults(results, scenePolicy) };
	}

	// Case 4: LIKE fallback (CJK with few FTS results, or FTS error)
	if (needsFallback || ftsRows.length === 0) {
		// Try LIKE fallback
		const likePattern = `%${q}%`;
		let likeWhere = `(
      vi.semantic_summary LIKE ? OR
      vi.search_hints LIKE ? OR
      vi.summary LIKE ? OR
      vi.title LIKE ? OR
      vi.tags LIKE ?
    )`;
		const likeParams: unknown[] = [likePattern, likePattern, likePattern, likePattern, likePattern];

		if (filterWhere) {
			likeWhere += ` AND ${filterWhere}`;
			likeParams.push(...filterParams);
		}

		const likeSql = `
      SELECT ${VAULT_SELECT}
      FROM vault_index vi
      WHERE ${likeWhere}
      ORDER BY vi.modified_at DESC
      LIMIT ?
    `;
		likeParams.push(limit);

		const likeRows = queryAll<VaultSelectRow>(db, likeSql, ...likeParams);

		// Merge FTS rows + LIKE rows, deduplicate by file_path
		const likeSource: MatchSource = ftsRows.length > 0 ? 'hybrid_expand' : 'like_fallback';
		const ftsTagged = ftsRows.map((row) => ({ row, source: 'fts5' as MatchSource }));
		const likeTagged = likeRows.map((row) => ({ row, source: likeSource }));
		const merged = mergeAndDedupe(ftsTagged, likeTagged, (item) => String(item.row.file_path));

		const results = merged
			.slice(0, limit)
			.map(({ row, source }) => buildQueryResult(row, source, matchedFields(q, row)));
		return { results: rerankQueryResults(results, scenePolicy) };
	}

	return { results: [] };
}

/**
 * Query recent session log events.
 */
export function queryRecentEvents(
	db: Database.Database,
	opts: {
		days: number;
		entryType?: string | null;
		scope?: string | null;
		query?: string | null;
		limit: number;
		scenePolicy?: ScenePolicy | null;
	},
): { events: SessionEvent[] } {
	const { days, entryType, scope, query, limit, scenePolicy } = opts;

	const cutoff = daysAgo(days);
	const q = (query ?? '').trim();
	const hasQuery = q.length > 0;

	// Build base conditions
	const baseConds: string[] = ['sl.timestamp >= ?'];
	const baseParams: unknown[] = [cutoff];

	if (entryType) {
		baseConds.push('sl.entry_type = ?');
		baseParams.push(entryType);
	}
	if (scope) {
		baseConds.push('sl.scope = ?');
		baseParams.push(scope);
	}

	const baseWhere = baseConds.join(' AND ');

	const SESSION_SELECT = `
    sl.event_id, sl.timestamp, sl.entry_type, sl.importance,
    sl.scope, sl.skill_name, sl.summary, sl.detail,
    sl.source_refs, sl.related_files, sl.related_entities
  `.trim();

	// No query → direct filter
	if (!hasQuery) {
		const sql = `
      SELECT ${SESSION_SELECT}
      FROM session_log sl
      WHERE ${baseWhere}
      ORDER BY sl.timestamp DESC
      LIMIT ?
    `;
		const rows = queryAll<SessionSelectRow>(db, sql, ...baseParams, limit);
		const events = rows.map(buildSessionEvent);
		return { events: rerankRecentEvents(events, scenePolicy) };
	}

	// Has query → try FTS5
	const ftsQ = ftsQuery(q);
	let ftsRows: SessionSelectRow[] = [];
	let ftsError = false;

	if (ftsQ) {
		try {
			const sql = `
        SELECT ${SESSION_SELECT}
        FROM session_log sl
        JOIN session_fts sf ON sf.rowid = sl.id
        WHERE session_fts MATCH ?
          AND ${baseWhere}
        ORDER BY sl.timestamp DESC
        LIMIT ?
      `;
			ftsRows = queryAll<SessionSelectRow>(db, sql, ftsQ, ...baseParams, limit * 2);
		} catch {
			ftsError = true;
		}
	}

	const hasCjk = containsCjk(q);
	const needsFallback = ftsError || (hasCjk && ftsRows.length < 3);

	if (!needsFallback && ftsRows.length > 0) {
		const events = ftsRows.slice(0, limit).map(buildSessionEvent);
		return { events: rerankRecentEvents(events, scenePolicy) };
	}

	// LIKE fallback
	const likePattern = `%${q}%`;
	const likeWhere = `(
    sl.summary LIKE ? OR
    sl.detail LIKE ? OR
    sl.related_entities LIKE ? OR
    sl.search_hints LIKE ?
  )`;
	const likeParams: unknown[] = [likePattern, likePattern, likePattern, likePattern, ...baseParams];

	const likeSql = `
    SELECT ${SESSION_SELECT}
    FROM session_log sl
    WHERE ${likeWhere} AND ${baseWhere}
    ORDER BY sl.timestamp DESC
    LIMIT ?
  `;
	likeParams.push(limit);

	const likeRows = queryAll<SessionSelectRow>(db, likeSql, ...likeParams);

	// Merge FTS + LIKE rows, deduplicate by event_id
	const merged = mergeAndDedupe(ftsRows, likeRows, (row) => String(row.event_id));

	const events = merged.slice(0, limit).map(buildSessionEvent);
	return { events: rerankRecentEvents(events, scenePolicy) };
}

/**
 * Lookup vault index entries by exact file paths.
 * Results are returned in the same order as the requested paths.
 */
export function queryVaultIndexByPaths(
	db: Database.Database,
	filePaths: string[],
): { results: VaultQueryResult[] } {
	if (filePaths.length === 0) return { results: [] };

	const { clause, params: inParams } = inClause('vi.file_path', filePaths);
	const sql = `
    SELECT ${VAULT_SELECT}
    FROM vault_index vi
    WHERE ${clause}
  `;
	const rows = queryAll<VaultSelectRow>(db, sql, ...inParams);

	// Sort by requested order
	const rowMap = new Map<string, VaultSelectRow>();
	for (const row of rows) {
		rowMap.set(String(row.file_path), row);
	}

	const results: VaultQueryResult[] = [];
	for (const fp of filePaths) {
		const row = rowMap.get(fp);
		if (row) {
			results.push(buildQueryResult(row, 'exact_filter', []));
		}
	}

	return { results };
}

/**
 * Lookup vault index entries by title (exact match).
 */
export function queryVaultIndexByTitles(
	db: Database.Database,
	titles: string[],
	pathPrefix?: string,
): { results: VaultQueryResult[] } {
	if (titles.length === 0) return { results: [] };

	const { clause, params: inParams } = inClause('vi.title', titles);
	const params: unknown[] = [...inParams];
	let sql = `
    SELECT ${VAULT_SELECT}
    FROM vault_index vi
    WHERE ${clause}
  `;

	if (pathPrefix) {
		sql += ' AND vi.file_path LIKE ?';
		params.push(`${pathPrefix}%`);
	}

	sql += ' ORDER BY vi.modified_at DESC';

	const rows = queryAll<VaultSelectRow>(db, sql, ...params);
	const results = rows.map((row) => buildQueryResult(row, 'exact_filter', []));
	return { results };
}

/**
 * Query vault index entries by path prefix(es).
 */
export function queryVaultIndexByPrefixes(
	db: Database.Database,
	opts: {
		prefixes: string[];
		typeFilter?: string | null;
		statusFilter?: string | null;
		limit?: number;
	},
): { results: VaultQueryResult[] } {
	const { prefixes, typeFilter, statusFilter, limit = 50 } = opts;

	if (prefixes.length === 0) return { results: [] };

	const conditions: string[] = [];
	const params: unknown[] = [];

	// prefix OR conditions
	const prefixConds = prefixes.map(() => 'vi.file_path LIKE ?').join(' OR ');
	conditions.push(`(${prefixConds})`);
	for (const prefix of prefixes) {
		params.push(`${prefix}%`);
	}

	if (typeFilter) {
		conditions.push('vi.type = ?');
		params.push(typeFilter);
	}

	if (statusFilter) {
		conditions.push('vi.status = ?');
		params.push(statusFilter);
	}

	const sql = `
    SELECT ${VAULT_SELECT}
    FROM vault_index vi
    WHERE ${conditions.join(' AND ')}
    ORDER BY vi.modified_at DESC
    LIMIT ?
  `;
	params.push(limit);

	const rows = queryAll<VaultSelectRow>(db, sql, ...params);
	const results = rows.map((row) => buildQueryResult(row, 'exact_filter', []));
	return { results };
}

/**
 * Query vault index entries by domain(s) or tag(s).
 */
export function queryVaultIndexByDomainsOrTags(
	db: Database.Database,
	opts: {
		domains?: string[] | null;
		tags?: string[] | null;
		typeFilter?: string | null;
		limit?: number;
	},
): { results: VaultQueryResult[] } {
	const { domains, tags, typeFilter, limit = 50 } = opts;

	const orConditions: string[] = [];
	const params: unknown[] = [];

	if (domains && domains.length > 0) {
		const { clause, params: domainParams } = inClause('vi.domain', domains);
		orConditions.push(clause);
		params.push(...domainParams);
	}

	if (tags && tags.length > 0) {
		// Tags are stored as JSON arrays, use LIKE for each tag
		const tagConds = tags.map(() => 'vi.tags LIKE ?').join(' OR ');
		orConditions.push(`(${tagConds})`);
		for (const tag of tags) {
			params.push(`%"${tag}"%`);
		}
	}

	if (orConditions.length === 0) return { results: [] };

	const conditions: string[] = [`(${orConditions.join(' OR ')})`];

	if (typeFilter) {
		conditions.push('vi.type = ?');
		params.push(typeFilter);
	}

	const sql = `
    SELECT ${VAULT_SELECT}
    FROM vault_index vi
    WHERE ${conditions.join(' AND ')}
    ORDER BY vi.modified_at DESC
    LIMIT ?
  `;
	params.push(limit);

	const rows = queryAll<VaultSelectRow>(db, sql, ...params);
	const results = rows.map((row) => buildQueryResult(row, 'exact_filter', []));
	return { results };
}

/**
 * Query memory items.
 */
export function queryMemoryItems(
	db: Database.Database,
	opts: {
		target?: string | null;
		section?: string | null;
		slotKey?: string | null;
		statusFilter?: string | null;
		limit?: number;
	},
): { items: MemoryItem[] } {
	const { target, section, slotKey, statusFilter, limit = 100 } = opts;

	const conditions: string[] = [];
	const params: unknown[] = [];

	if (target) {
		conditions.push('target = ?');
		params.push(target);
	}

	if (section) {
		conditions.push('section = ?');
		params.push(section);
	}

	if (slotKey) {
		conditions.push('slot_key = ?');
		params.push(slotKey);
	}

	if (statusFilter) {
		conditions.push('status = ?');
		params.push(statusFilter);
	}

	const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

	const sql = `
    SELECT
      item_id, target, section, slot_key, content,
      confidence, source_event_ids, source_refs, related_files,
      manual_flag, status, superseded_by, last_confirmed_at,
      updated_at, expires_at
    FROM memory_items
    ${whereClause}
    ORDER BY updated_at DESC
    LIMIT ?
  `;
	params.push(limit);

	const rows = queryAll<MemoryItemRow>(db, sql, ...params);

	const items: MemoryItem[] = rows.map((row) => ({
		itemId: String(row.item_id),
		target: String(row.target),
		section: String(row.section),
		slotKey: String(row.slot_key),
		content: String(row.content),
		confidence: row.confidence != null ? String(row.confidence) : null,
		sourceEventIds: loadsJsonList(row.source_event_ids),
		sourceRefs: loadsJsonList(row.source_refs),
		relatedFiles: loadsJsonList(row.related_files),
		manualFlag: Number(row.manual_flag) !== 0,
		status: String(row.status),
		supersededBy: row.superseded_by != null ? String(row.superseded_by) : null,
		lastConfirmedAt: row.last_confirmed_at != null ? String(row.last_confirmed_at) : null,
		updatedAt: String(row.updated_at),
		expiresAt: row.expires_at != null ? String(row.expires_at) : null,
	}));

	return { items };
}
