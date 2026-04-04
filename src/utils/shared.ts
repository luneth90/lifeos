/**
 * shared.ts — Shared utility functions.
 *
 * Provides utility functions used by all other modules.
 */

import type Database from 'better-sqlite3';

// ─── Constants ────────────────────────────────────────────────────────────────

export const ALLOWED_COUNT_TABLES: Set<string> = new Set(['vault_index', 'enhance_queue']);

export const BUCKET_TYPE_MAP: Record<string, Set<string>> = {
	daily: new Set(['daily', 'diary']),
	draft: new Set(['draft']),
	project: new Set(['project']),
	research: new Set(['research']),
	knowledge: new Set(['knowledge', 'note', 'revise-record']),
	resource: new Set(['resource']),
};

// ─── Time ─────────────────────────────────────────────────────────────────────

/**
 * Coerce various input types to a Date object.
 * - No argument → current UTC time
 * - Date → returned as-is
 * - string → parsed via Date constructor (ISO format)
 * - Other types → throw TypeError
 */
export function coerceNow(now?: Date | string | null): Date {
	if (now == null) {
		return new Date();
	}
	if (now instanceof Date) {
		return now;
	}
	if (typeof now === 'string') {
		const parsed = new Date(now);
		if (Number.isNaN(parsed.getTime())) {
			throw new TypeError(`Cannot parse date string: ${now}`);
		}
		return parsed;
	}
	throw new TypeError(`Unsupported time type: ${typeof now}`);
}

// ─── JSON / List helpers ──────────────────────────────────────────────────────

/**
 * Coerce a value to a list of strings.
 * Handles null/undefined, raw arrays, JSON array strings, and plain strings.
 */
export function loadsJsonList(value: string | string[] | null | undefined): string[] {
	if (value == null) return [];
	if (Array.isArray(value)) {
		return value.filter((item) => item != null).map((item) => String(item));
	}
	if (typeof value === 'string') {
		const stripped = value.trim();
		if (!stripped) return [];
		let parsed: unknown;
		try {
			parsed = JSON.parse(stripped);
		} catch {
			return [stripped];
		}
		if (parsed === null) return [];
		if (Array.isArray(parsed)) {
			return parsed.filter((item) => item != null).map((item) => String(item));
		}
		return [String(parsed)];
	}
	return [String(value)];
}

/**
 * Parse a JSON string into a plain object.
 * Returns an empty object on failure or if the result is not an object.
 */
export function parseDetailObject(detail: string | null | undefined): Record<string, unknown> {
	if (!detail) return {};
	try {
		const parsed = JSON.parse(detail);
		if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return {};
	} catch {
		return {};
	}
}

// ─── Text / Token helpers ─────────────────────────────────────────────────────

/**
 * Estimate the token count for a text string.
 * CJK characters count as 1 token each.
 * Latin words count as 1.3 tokens each (ceiling).
 * Other non-whitespace characters count as 0.5 tokens each (floor).
 */
export function estimateTokens(text: string): number {
	if (!text.trim()) return 0;
	const cjkCount = [...text].filter((ch) => ch >= '\u4e00' && ch <= '\u9fff').length;
	const latinWords = (text.match(/[A-Za-z0-9_]+/g) ?? []).length;
	const otherChars = (text.match(/[^\sA-Za-z0-9_\u4e00-\u9fff]/g) ?? []).length;
	return cjkCount + Math.ceil(latinWords * 1.3) + Math.max(Math.floor(otherChars / 2), 0);
}

/**
 * Return true if the text contains at least one CJK character (U+4E00-U+9FFF).
 */
export function containsCjk(text: string): boolean {
	return [...text].some((ch) => ch >= '\u4e00' && ch <= '\u9fff');
}

/**
 * Strip [[ and ]] from a wikilink value, trimming whitespace.
 * Returns null for null input.
 */
export function normalizeWikilinkValue(value: unknown): string | null {
	if (value == null) return null;
	let normalized = String(value).trim();
	if (normalized.startsWith('[[') && normalized.endsWith(']]')) {
		normalized = normalized.slice(2, -2).trim();
	}
	return normalized;
}

/**
 * Compact text to at most `limit` characters, appending '...' if truncated.
 * Normalizes internal whitespace. Returns '暂无摘要' for empty input.
 */
export function compactText(text: string | null | undefined, limit = 160): string {
	const normalized = (text ?? '').replace(/\s+/g, ' ').trim();
	if (!normalized) return '暂无摘要';
	if (normalized.length <= limit) return normalized;
	return `${normalized.slice(0, Math.max(limit - 3, 0)).trimEnd()}...`;
}

// ─── Database helpers ─────────────────────────────────────────────────────────

/**
 * Count rows in an allowed table, with optional WHERE clause.
 * Throws if the table name is not in ALLOWED_COUNT_TABLES.
 */
export function countRows(
	conn: Database.Database,
	table: string,
	whereSql = '',
	params: unknown[] = [],
): number {
	if (!ALLOWED_COUNT_TABLES.has(table)) {
		throw new Error(`Invalid table: ${table}`);
	}
	let sql = `SELECT COUNT(*) FROM ${table}`;
	if (whereSql) sql += ` WHERE ${whereSql}`;
	const row = conn.prepare(sql).get(params) as { 'COUNT(*)': number } | undefined;
	return row ? Number(row['COUNT(*)']) : 0;
}
