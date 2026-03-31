/**
 * types.ts — 中央类型定义。
 *
 * Shared types, unions, and DB row interfaces used across the project.
 * This eliminates stringly-typed code and Record<string, unknown> casts.
 */

// ─── Entry types ──────────────────────────────────────────────────────────────

export type EntryType =
	| 'skill_completion'
	| 'decision'
	| 'preference'
	| 'correction'
	| 'blocker'
	| 'milestone'
	| 'session_bridge';

export type KeyEntryType = 'decision' | 'correction' | 'preference';

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
}

export interface SessionLogRow {
	id: number;
	event_id: string;
	session_id: string;
	timestamp: string;
	entry_type: string;
	importance: number;
	scope: string | null;
	skill_name: string | null;
	summary: string;
	detail: string | null;
	source_refs: string | null;
	related_files: string | null;
	related_entities: string | null;
	supersedes: string | null;
	entry_hash: string | null;
	search_hints: string | null;
	rule_key: string | null;
}

export interface MemoryItemRow {
	item_id: string;
	target: string;
	section: string;
	slot_key: string;
	content: string;
	confidence: string | null;
	source_event_ids: string | null;
	source_refs: string | null;
	related_files: string | null;
	manual_flag: number;
	status: string;
	superseded_by: string | null;
	last_confirmed_at: string | null;
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

export interface SessionStateRow {
	session_id: string;
	started_at: string;
	last_seen_at: string;
	closed_at: string | null;
	close_status: string | null;
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

/** The columns selected by SESSION_SELECT in retrieval.ts */
export type SessionSelectRow = Pick<
	SessionLogRow,
	| 'event_id'
	| 'timestamp'
	| 'entry_type'
	| 'importance'
	| 'scope'
	| 'skill_name'
	| 'summary'
	| 'detail'
	| 'source_refs'
	| 'related_files'
	| 'related_entities'
>;

// ─── Result types for core.ts ──────────────────────────────────────────────────

export interface StartupResult {
	layer0_summary: string;
	vault_stats: { total_files: number; updated_since_last: number; removed: number };
	enhance_queue_size: number;
	enhanced_files: number;
	last_session_bridge: string | null;
	recovered_from_unclean_shutdown: boolean;
	previous_unclean_session_id: string | null;
	maintenance: MaintenanceResult | null;
}

export interface MaintenanceResult {
	deleted: number;
	compressed_groups: number;
	compressed_events: number;
	memory_items_merged: number;
	memory_items_deleted: number;
	expired_items_deleted: number;
	dry_run: boolean;
}

export interface CheckpointResult {
	session_bridge_found: boolean;
	enhanced_files: number;
	active_docs_updated: boolean;
	session_closed: boolean;
	warnings: string[];
}

export interface SkillCompleteResult {
	event_id: string;
	timestamp: string;
	logged: boolean;
	skill_name: string;
}

export interface RefreshResult {
	status: 'ok';
	path: string;
	sections: string[];
	updatedSection: string;
}

export interface CitationsResult {
	target: string;
	section: string | null;
	keyword: string | null;
	total: number;
	items: CitationItem[];
	sourceEvents: CitationSourceEvent[];
}

export interface CitationItem {
	itemId: string;
	section: string;
	slotKey: string;
	content: string;
	sourceEventIds: string[];
	sourceRefs: string[];
	updatedAt: string;
}

export interface CitationSourceEvent {
	eventId: string;
	entryType: string;
	summary: string;
	timestamp: string;
	skillName: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const VALID_ENTRY_TYPES: ReadonlySet<string> = new Set<EntryType>([
	'skill_completion',
	'decision',
	'preference',
	'correction',
	'blocker',
	'milestone',
	'session_bridge',
]);

export const KEY_ENTRY_TYPES: ReadonlySet<string> = new Set<KeyEntryType>([
	'decision',
	'correction',
	'preference',
]);

export const ACTIVE_DOC_TARGETS: ReadonlySet<string> = new Set<ActiveDocTarget>([
	'TaskBoard',
	'UserProfile',
]);

// ─── Shared label maps ────────────────────────────────────────────────────────

export const ENTRY_TYPE_LABELS: Readonly<Record<string, string>> = {
	decision: '决策',
	correction: '纠错',
	preference: '偏好',
	milestone: '里程碑',
	skill_completion: '技能完成',
	blocker: '阻塞',
	session_bridge: '会话桥接',
};

export const STATUS_LABELS: Readonly<Record<string, string>> = {
	active: '进行中',
	'on-hold': '搁置中',
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
	done: '已完成',
	draft: '处于草稿阶段',
	revise: '待复习巩固',
	mastered: '已掌握',
	'on-hold': '当前搁置',
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
