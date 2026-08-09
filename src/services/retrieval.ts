/**
 * retrieval.ts — Retrieval service.
 */

import type Database from 'better-sqlite3';
import { inClause, queryAll } from '../db/index.js';
import type {
	ListMemoryItemsInput,
	MatchSource,
	VaultEvidenceField,
	VaultFtsSelectRow,
	VaultQueryEvidence,
	VaultRankExplanation,
	VaultSelectRow,
} from '../types.js';
import { tokenize } from '../utils/segmenter.js';
import { compactText, containsCjk, loadsJsonList } from '../utils/shared.js';
import { listMemoryItems } from './memory-items.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VaultQueryResult {
	filePath: string;
	entityId: string | null;
	title: string;
	type: string | null;
	status: string | null;
	domain: string | null;
	summary: string | null;
	displaySummary: string;
	matchSource: MatchSource;
	matchedFields: string[];
	score: number;
	rankScore: number | null;
	rankPosition: number;
	rankExplanation: VaultRankExplanation;
	evidence: VaultQueryEvidence[];
	modifiedAt: string | null;
	masteryStatus?: string | null;
	tags?: string[];
	aliases?: string[];
	wikilinks?: string[];
	backlinks?: string[];
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
	summary: 70,
	search_hints: 60,
	tags: 30,
};

const EVIDENCE_FIELDS: VaultEvidenceField[] = ['title', 'summary', 'search_hints', 'tags'];
const EVIDENCE_MAX_LENGTH = 160;
const EVIDENCE_CONTEXT_LENGTH = 48;

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Build FTS5 query string from a user query.
 * CJK → tokenize then prefix-match each term: "四元数"* "群"*
 * English → prefix match: term1* term2*
 */
function ftsQuery(q: string): string {
	const hasCjk = containsCjk(q);
	if (hasCjk) {
		const terms = tokenize(q);
		if (terms.length === 0) return '';
		return terms.map((t) => `"${t}"*`).join(' ');
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
function textMatchesTerms(text: string, terms: string[]): boolean {
	if (terms.length === 0) return false;
	const lower = text.toLowerCase();
	return terms.every((t) => lower.includes(t));
}

/**
 * Check which fields in a row matched the query.
 */
function matchedFields(query: string, row: VaultSelectRow): string[] {
	if (!query.trim()) return [];
	const terms = queryTerms(query);
	const fieldMap: Record<string, string> = {
		title: 'title',
		summary: 'summary',
		search_hints: 'search_hints',
		tags: 'tags',
	};
	return Object.entries(fieldMap)
		.filter(([col]) => {
			const value = row[col as keyof VaultSelectRow];
			return value != null && textMatchesTerms(String(value), terms);
		})
		.map(([, name]) => name);
}

function compactEvidenceText(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function evidenceSnippet(
	value: string,
	terms: string[],
): { snippet: string; terms: string[] } | null {
	const text = compactEvidenceText(value);
	const lower = text.toLowerCase();
	const firstMatch = terms
		.map((term) => lower.indexOf(term.toLowerCase()))
		.filter((index) => index >= 0)
		.sort((left, right) => left - right)[0];
	if (firstMatch === undefined) return null;

	const start = Math.max(0, firstMatch - EVIDENCE_CONTEXT_LENGTH);
	const prefix = start > 0 ? '…' : '';
	const rawBudget = EVIDENCE_MAX_LENGTH - prefix.length - 1;
	let raw = text.slice(start, start + rawBudget);
	const suffix = start + raw.length < text.length ? '…' : '';
	if (!suffix) raw = text.slice(start, start + EVIDENCE_MAX_LENGTH - prefix.length);
	const snippet = `${prefix}${raw}${suffix}`;
	const snippetLower = snippet.toLowerCase();
	const matchedTerms = [...new Set(terms)].filter((term) =>
		snippetLower.includes(term.toLowerCase()),
	);
	return matchedTerms.length > 0 ? { snippet, terms: matchedTerms } : null;
}

function buildEvidence(query: string, row: VaultSelectRow): VaultQueryEvidence[] {
	if (!query.trim()) return [];
	const terms = queryTerms(query);
	const sourcePath = String(row.file_path);
	const evidence: VaultQueryEvidence[] = [];
	for (const field of EVIDENCE_FIELDS) {
		const value = row[field];
		if (value == null || !textMatchesTerms(String(value), terms)) continue;
		const excerpt = evidenceSnippet(String(value), terms);
		if (!excerpt) continue;
		evidence.push({
			field,
			snippet: excerpt.snippet,
			matchedTerms: excerpt.terms,
			sourcePath,
		});
	}
	return evidence;
}

function buildRankExplanation(
	row: VaultSelectRow,
	matchSource: MatchSource,
	rankScore: number | null,
	requestedOrder = false,
): VaultRankExplanation {
	if (requestedOrder) {
		return {
			rankSource: 'requested_order',
			sortKeys: [{ field: 'filePath', direction: 'input', value: String(row.file_path) }],
		};
	}
	const modifiedAt = row.modified_at != null ? String(row.modified_at) : null;
	const filePath = String(row.file_path);
	if (rankScore !== null) {
		return {
			rankSource: 'vault_fts_bm25',
			sortKeys: [
				{ field: 'rankScore', direction: 'asc', value: rankScore },
				{ field: 'modifiedAt', direction: 'desc', value: modifiedAt },
				{ field: 'filePath', direction: 'asc', value: filePath },
			],
		};
	}
	return {
		rankSource: 'deterministic_fallback',
		sortKeys: [
			...(matchSource === 'hybrid_expand'
				? ([{ field: 'rankScore', direction: 'asc', value: null }] as const)
				: []),
			{ field: 'modifiedAt', direction: 'desc', value: modifiedAt },
			{ field: 'filePath', direction: 'asc', value: filePath },
		],
	};
}

/**
 * Compute a coarse display score based on match source and matched fields.
 * The score is for display purposes only and never participates in result
 * ordering; FTS result order is determined entirely by the SQL bm25() ranking.
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
	query = '',
	rankScore: number | null = null,
	requestedOrder = false,
): VaultQueryResult {
	const summary = row.summary != null ? String(row.summary) : null;

	return {
		filePath: String(row.file_path),
		entityId: row.entity_id != null ? String(row.entity_id) : null,
		title: row.title != null ? String(row.title) : '',
		type: row.type != null ? String(row.type) : null,
		status: row.status != null ? String(row.status) : null,
		domain: row.domain != null ? String(row.domain) : null,
		summary,
		displaySummary: compactText(summary),
		matchSource,
		matchedFields: fields,
		score: scoreResult(matchSource, fields),
		rankScore,
		rankPosition: 0,
		rankExplanation: buildRankExplanation(row, matchSource, rankScore, requestedOrder),
		evidence: buildEvidence(query, row),
		modifiedAt: row.modified_at != null ? String(row.modified_at) : null,
		masteryStatus: row.status != null ? String(row.status) : null,
		tags: loadsJsonList(row.tags),
		aliases: loadsJsonList(row.aliases),
		wikilinks: loadsJsonList(row.wikilinks),
		backlinks: loadsJsonList(row.backlinks),
	};
}

function withRankPositions(results: VaultQueryResult[]): VaultQueryResult[] {
	return results.map((result, index) => ({ ...result, rankPosition: index + 1 }));
}

function compareTextAsc(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

interface SearchCandidate {
	row: VaultSelectRow;
	source: MatchSource;
	rankScore: number | null;
}

function compareSearchCandidates(left: SearchCandidate, right: SearchCandidate): number {
	if (left.rankScore !== null && right.rankScore !== null) {
		const rankOrder = left.rankScore - right.rankScore;
		if (rankOrder !== 0) return rankOrder;
	} else {
		if (left.rankScore !== null) return -1;
		if (right.rankScore !== null) return 1;
	}
	const modifiedOrder = compareTextAsc(
		String(right.row.modified_at ?? ''),
		String(left.row.modified_at ?? ''),
	);
	if (modifiedOrder !== 0) return modifiedOrder;
	return compareTextAsc(String(left.row.file_path), String(right.row.file_path));
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

// ─── Vault index SELECT fragment ──────────────────────────────────────────────

const VAULT_SELECT = `
  vi.file_path, vi.title, vi.type, vi.status, vi.domain,
  vi.category, vi.project, vi.entity_id, vi.summary, vi.search_hints,
  vi.tags, vi.aliases, vi.wikilinks, vi.backlinks,
  vi.modified_at
`.trim();

const VAULT_FILTER_COLUMNS = new Set([
	'file_path',
	'title',
	'type',
	'status',
	'domain',
	'category',
	'project',
	'entity_id',
]);

function buildFilters(filters: Record<string, string> | null): {
	where: string;
	params: string[];
} {
	const conditions: string[] = [];
	const params: string[] = [];
	for (const [key, value] of Object.entries(filters ?? {})) {
		if (!VAULT_FILTER_COLUMNS.has(key)) {
			throw new Error(`不支持的 Vault 过滤字段：${key}`);
		}
		conditions.push(`vi.${key} = ?`);
		params.push(value);
	}
	return { where: conditions.join(' AND '), params };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Main vault search: FTS5 + LIKE fallback + exact filter.
 */
export function queryVaultIndex(
	db: Database.Database,
	query: string,
	filters: Record<string, string> | null,
	limit: number,
): { results: VaultQueryResult[] } {
	const q = (query ?? '').trim();
	const hasQuery = q.length > 0;
	const hasFilters = filters != null && Object.keys(filters).length > 0;

	const { where: filterWhere, params: filterParams } = buildFilters(filters);

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
      ORDER BY vi.modified_at DESC, vi.file_path ASC
      LIMIT ?
    `;
		const rows = queryAll<VaultSelectRow>(db, sql, ...filterParams, limit);
		const results = withRankPositions(
			rows.map((row) => buildQueryResult(row, 'exact_filter', matchedFields(q, row), q)),
		);
		return { results };
	}

	// Case 3: Has query — try FTS5 first
	const ftsQ = ftsQuery(q);
	let ftsRows: VaultFtsSelectRow[] = [];
	let ftsError = false;

	if (ftsQ) {
		try {
			let sql = `
        SELECT ${VAULT_SELECT}, bm25(vault_fts, 0, 4, 3, 10, 2) AS rank_score
        FROM vault_index vi
        JOIN vault_fts vf ON vf.rowid = vi.rowid
        WHERE vault_fts MATCH ?
      `;
			const params: unknown[] = [ftsQ];

			if (filterWhere) {
				sql += ` AND ${filterWhere}`;
				params.push(...filterParams);
			}

			// 权重按 FTS 列顺序 file_path、title、summary、search_hints、tags 对应
			// 0、4、3、10、2；rank_score 是查询实际使用的原始 BM25 值。
			sql += ' ORDER BY rank_score ASC, vi.modified_at DESC, vi.file_path ASC LIMIT ?';
			params.push(limit);

			ftsRows = queryAll<VaultFtsSelectRow>(db, sql, ...params);
		} catch {
			ftsError = true;
		}
	}

	const hasCjk = containsCjk(q);
	const needsFallback = ftsError || (hasCjk && ftsRows.length < 3);

	// FTS5 succeeded and has enough results
	if (!needsFallback && ftsRows.length > 0) {
		const results = withRankPositions(
			ftsRows.map((row) =>
				buildQueryResult(row, 'fts5', matchedFields(q, row), q, Number(row.rank_score)),
			),
		);
		return { results };
	}

	// Case 4: LIKE fallback (CJK with few FTS results, or FTS error)
	// Phased approach: narrow columns first (title + search_hints),
	// expand to summary + tags only if insufficient.

	const likePattern = `%${q}%`;

	function runLikeQuery(columns: string[], fetchLimit: number): VaultSelectRow[] {
		const conds = columns.map((col) => `vi.${col} LIKE ?`).join(' OR ');
		let likeWhere = `(${conds})`;
		const likeParams: unknown[] = columns.map(() => likePattern);

		if (filterWhere) {
			likeWhere += ` AND ${filterWhere}`;
			likeParams.push(...filterParams);
		}

		const likeSql = `
			    SELECT ${VAULT_SELECT}
			    FROM vault_index vi
			    WHERE ${likeWhere}
			    ORDER BY vi.modified_at DESC, vi.file_path ASC
			    LIMIT ?
			  `;
		likeParams.push(fetchLimit);
		return queryAll<VaultSelectRow>(db, likeSql, ...likeParams);
	}

	// Phase 1: title + search_hints (smaller columns, faster scan)
	let likeRows = runLikeQuery(['title', 'search_hints'], limit);

	// Phase 2: expand if not enough results
	if (likeRows.length < 2) {
		likeRows = runLikeQuery(['title', 'search_hints', 'summary', 'tags'], limit);
	}

	// 明确合并 FTS 与 LIKE 两个候选源；这一步只去重并按公开排序键稳定排序。
	const likeSource: MatchSource = ftsRows.length > 0 ? 'hybrid_expand' : 'like_fallback';
	const ftsTagged: SearchCandidate[] = ftsRows.map((row) => ({
		row,
		source: 'fts5' as MatchSource,
		rankScore: Number(row.rank_score),
	}));
	const likeTagged: SearchCandidate[] = likeRows.map((row) => ({
		row,
		source: likeSource,
		rankScore: null,
	}));
	const merged = mergeAndDedupe(ftsTagged, likeTagged, (item) => String(item.row.file_path));

	const results = withRankPositions(
		merged
			.sort(compareSearchCandidates)
			.slice(0, limit)
			.map(({ row, source, rankScore }) =>
				buildQueryResult(row, source, matchedFields(q, row), q, rankScore),
			),
	);
	return { results };
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
			results.push(buildQueryResult(row, 'exact_filter', [], '', null, true));
		}
	}

	return { results: withRankPositions(results) };
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

	sql += ' ORDER BY vi.modified_at DESC, vi.file_path ASC';

	const rows = queryAll<VaultSelectRow>(db, sql, ...params);
	const results = withRankPositions(rows.map((row) => buildQueryResult(row, 'exact_filter', [])));
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
    ORDER BY vi.modified_at DESC, vi.file_path ASC
    LIMIT ?
  `;
	params.push(limit);

	const rows = queryAll<VaultSelectRow>(db, sql, ...params);
	const results = withRankPositions(rows.map((row) => buildQueryResult(row, 'exact_filter', [])));
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
    ORDER BY vi.modified_at DESC, vi.file_path ASC
    LIMIT ?
  `;
	params.push(limit);

	const rows = queryAll<VaultSelectRow>(db, sql, ...params);
	const results = withRankPositions(rows.map((row) => buildQueryResult(row, 'exact_filter', [])));
	return { results };
}

/**
 * Query memory items by slot_key pattern or status.
 */
export function queryMemoryItems(db: Database.Database, input: ListMemoryItemsInput = {}) {
	return { items: listMemoryItems(db, input) };
}
