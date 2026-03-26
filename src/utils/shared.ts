/**
 * shared.ts — 通用工具函数。
 *
 * Provides utility functions used by all other modules.
 */

import type Database from 'better-sqlite3';

// ─── Constants ────────────────────────────────────────────────────────────────

export const SESSION_ID_ENV_KEYS = [
	'LIFEOS_SESSION_ID',
	'CLAUDE_SESSION_ID',
	'CODEX_SESSION_ID',
	'OPENCODE_SESSION_ID',
] as const;

export const ALLOWED_COUNT_TABLES: Set<string> = new Set([
	'vault_index',
	'enhance_queue',
	'session_log',
]);

export { VALID_ENTRY_TYPES, KEY_ENTRY_TYPES, ACTIVE_DOC_TARGETS } from '../types.js';
export { daysAgo, formatDateShort } from '../types.js';

export const RULE_KEY_DETAIL_FIELDS = ['rule_key', 'preference_slot', 'constraint_key'] as const;

export const RULE_KEY_PREFIXES: Record<string, string> = {
	decision: 'decision',
	correction: 'correction',
	preference: 'prefer',
};

export const TEMPORARY_PREFERENCE_KEYWORDS = [
	'这次',
	'暂时',
	'先这样',
	'本周',
	'今天',
	'当前先',
	'这一轮',
	'这两天',
] as const;

export const STABLE_PREFERENCE_KEYWORDS = ['长期', '一直', '固定', '习惯', '通常', '默认'] as const;

export const DEFAULT_TEMPORARY_PREFERENCE_DAYS = 14;
export const ALL_TIME_DAYS = 3650;
export const FALLBACK_THRESHOLD = 3;
export const SUMMARY_MAX_LEN = 500;

export const BUCKET_TYPE_MAP: Record<string, Set<string>> = {
	daily: new Set(['daily', 'diary']),
	draft: new Set(['draft']),
	project: new Set(['project']),
	research: new Set(['research']),
	knowledge: new Set(['knowledge', 'note', 'review-record']),
	resource: new Set(['resource']),
};

// ─── Session ──────────────────────────────────────────────────────────────────

/**
 * Resolve a session ID from the provided value or environment variables.
 * Returns 'untracked' when no valid session ID can be found.
 */
export function resolveSessionId(sessionId?: string | null): string {
	if (sessionId != null && String(sessionId).trim()) {
		return String(sessionId).trim();
	}
	for (const envKey of SESSION_ID_ENV_KEYS) {
		const value = process.env[envKey];
		if (value?.trim()) {
			return value.trim();
		}
	}
	return 'untracked';
}

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
 * Return true if the text contains at least one CJK character (U+4E00–U+9FFF).
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

/**
 * Normalize whitespace and truncate to `limit` characters (no ellipsis).
 * Returns empty string for empty/null input.
 */
export function normalizeRuleSummary(text: string | null | undefined, limit = 160): string {
	const normalized = String(text ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	if (!normalized) return '';
	if (normalized.length <= limit) return normalized;
	return normalized.slice(0, limit).trimEnd();
}

// ─── Rule key helpers ─────────────────────────────────────────────────────────

/**
 * Build a default rule key from entry type and summary text.
 * Returns null if the entry type has no prefix or the summary is empty.
 */
export function buildDefaultRuleKey(entryType: string, text: string): string | null {
	const prefix = RULE_KEY_PREFIXES[entryType];
	const normalized = normalizeRuleSummary(text);
	if (!prefix || !normalized) return null;
	return `${prefix}:${normalized}`;
}

/**
 * Extract an explicit rule key value from a detail object.
 * Checks rule_key, preference_slot, constraint_key in order.
 */
export function extractRuleKeyValue(
	detailObj: Record<string, unknown> | null | undefined,
): string | null {
	const payload = detailObj ?? {};
	for (const field of RULE_KEY_DETAIL_FIELDS) {
		const value = payload[field];
		if (value) return String(value).trim();
	}
	return null;
}

/**
 * Resolve the final rule key for an entry.
 * Prefers explicit keys in detail_obj, falls back to building from entry type + summary.
 */
export function resolveRuleKey(
	entryType: string,
	summary: string,
	detailObj?: Record<string, unknown> | null,
): string | null {
	const explicit = extractRuleKeyValue(detailObj);
	if (explicit) return explicit;
	return buildDefaultRuleKey(entryType, summary);
}

// ─── Preference inference ─────────────────────────────────────────────────────

type TemporaryPreferenceResult = {
	temporary: boolean;
	expiresInDays?: number;
	expiresAt?: string;
	temporarySource?: string;
};

function coerceBoolValue(value: unknown): boolean {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') {
		const lower = value.toLowerCase().trim();
		if (lower === 'false' || lower === '0' || lower === 'no') return false;
		return Boolean(value);
	}
	return Boolean(value);
}

/**
 * Infer whether a preference entry is temporary based on text keywords
 * or explicit fields in the detail object.
 */
export function inferTemporaryPreference(
	text: string,
	detailObj?: Record<string, unknown> | null,
): TemporaryPreferenceResult {
	const payload = detailObj ?? {};

	// Check for explicit fields in detail_obj
	const hasExplicitFields = ['temporary', 'expires_at', 'expires_in_days', 'temporary_source'].some(
		(key) => payload[key] != null,
	);

	if (hasExplicitFields) {
		const result: TemporaryPreferenceResult = { temporary: true };
		if (payload.temporary != null) {
			result.temporary = coerceBoolValue(payload.temporary);
		}
		const rawExpiresInDays = payload.expires_in_days;
		if (rawExpiresInDays != null) {
			const days = Number.parseInt(String(rawExpiresInDays), 10);
			if (!Number.isNaN(days)) result.expiresInDays = days;
		}
		if (payload.expires_at) {
			result.expiresAt = String(payload.expires_at);
		}
		if (payload.temporary_source) {
			result.temporarySource = String(payload.temporary_source);
		} else {
			result.temporarySource = 'explicit';
		}
		return result;
	}

	// Keyword-based inference
	const normalized = normalizeRuleSummary(text);
	if (STABLE_PREFERENCE_KEYWORDS.some((kw) => normalized.includes(kw))) {
		return { temporary: false };
	}
	if (TEMPORARY_PREFERENCE_KEYWORDS.some((kw) => normalized.includes(kw))) {
		return {
			temporary: true,
			expiresInDays: DEFAULT_TEMPORARY_PREFERENCE_DAYS,
			temporarySource: 'keyword_fallback',
		};
	}
	return { temporary: false };
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

// ─── Archive helpers ──────────────────────────────────────────────────────────

/**
 * Return true if the summary represents an archive summary entry.
 */
export function isArchiveSummary(summary: unknown, entryType?: string): boolean {
	if (entryType === 'archive_summary') return true;
	return String(summary ?? '').startsWith('归档摘要：');
}
