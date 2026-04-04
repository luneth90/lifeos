/**
 * types.ts — Central type definitions.
 *
 * Shared types, unions, and DB row interfaces used across the project.
 */

// ─── Core types ──────────────────────────────────────────────────────────────

export type ActiveDocTarget = 'TaskBoard' | 'UserProfile';

export type MatchSource = 'exact_filter' | 'fts5' | 'hybrid_expand' | 'like_fallback';

// ─── DB row interfaces ────────────────────────────────────────────────────────
// These map 1:1 to the SQLite column names (snake_case) as returned by better-sqlite3.

export interface VaultIndexRow {
	file_path: string;
	title: string | null;
	type: string | null;
	status: string | null;
	domain: string | null;
	category: string | null;
	tags: string | null;
	aliases: string | null;
	summary: string | null;
	semantic_summary: string | null;
	search_hints: string | null;
	wikilinks: string | null;
	backlinks: string | null;
	section_heads: string | null;
	content_hash: string | null;
	file_size: number | null;
	created_at: string | null;
	modified_at: string | null;
	indexed_at: string | null;
	project: string | null;
}

export interface MemoryItemRow {
	slot_key: string;
	content: string;
	source: string | null;
	related_files: string | null;
	manual_flag: number;
	status: string;
	updated_at: string;
	expires_at: string | null;
}

export interface EnhanceQueueRow {
	file_path: string;
	priority: number;
	queued_at: string;
	source: string | null;
	status: string;
	attempts: number;
	last_attempt_at: string | null;
	error_message: string | null;
}

// ─── Partial row types for SELECT subsets ──────────────────────────────────────

/** The columns selected by VAULT_SELECT in retrieval.ts */
export type VaultSelectRow = Pick<
	VaultIndexRow,
	| 'file_path'
	| 'title'
	| 'type'
	| 'status'
	| 'domain'
	| 'summary'
	| 'semantic_summary'
	| 'search_hints'
	| 'tags'
	| 'aliases'
	| 'wikilinks'
	| 'backlinks'
	| 'modified_at'
>;

// ─── Result types for core.ts ──────────────────────────────────────────────────

export interface StartupResult {
	layer0_summary: string;
	vault_stats: { total_files: number; updated_since_last: number; removed: number };
	enhance_queue_size: number;
	enhanced_files: number;
}

export interface RefreshResult {
	status: 'ok';
	path: string;
	sections: string[];
	updatedSection: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const ACTIVE_DOC_TARGETS: ReadonlySet<string> = new Set<ActiveDocTarget>([
	'TaskBoard',
	'UserProfile',
]);

export const STATUS_LABELS: Readonly<Record<string, string>> = {
	active: '进行中',
	frozen: '🔒 封存',
	done: '已完成',
	draft: '草稿',
	revise: '待复习',
	mastered: '已掌握',
};

export const NOTE_TYPE_LABELS: Readonly<Record<string, string>> = {
	project: '项目文件',
	note: '知识笔记',
	research: '研究记录',
	system: '系统文档',
	output: '成果文档',
};

export const ENHANCE_STATUS_LABELS: Readonly<Record<string, string>> = {
	active: '正在推进',
	frozen: '🔒 封存',
	done: '已完成',
	draft: '处于草稿阶段',
	revise: '待复习巩固',
	mastered: '已掌握',
};

export const MASTERY_STATUS_LABELS: Readonly<Record<string, string>> = {
	draft: '🔴 未复习',
	revise: '🟡 待巩固',
	mastered: '🟢 已掌握',
};

// ─── Shared utility: date helpers ──────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/** ISO string for N days ago from now (or from a given date). */
export function daysAgo(n: number, from?: Date): string {
	return new Date((from ?? new Date()).getTime() - n * MS_PER_DAY).toISOString();
}

/** Format an ISO date string to YYYY-MM-DD, returning fallback on failure. */
export function formatDateShort(isoStr: string | null | undefined, fallback = ''): string {
	if (!isoStr) return fallback;
	return isoStr.slice(0, 10);
}
