/**
 * types.ts — Central type definitions.
 *
 * Shared types, unions, and DB row interfaces used across the project.
 */

// ─── Core types ──────────────────────────────────────────────────────────────

export type ActiveDocTarget = 'TaskBoard' | 'UserProfile';

export type MatchSource = 'exact_filter' | 'fts5' | 'hybrid_expand' | 'like_fallback';

export const MEMORY_ITEM_KINDS = ['rule', 'decision', 'fact', 'profile', 'event'] as const;
export type MemoryItemKind = (typeof MEMORY_ITEM_KINDS)[number];

export const MEMORY_SCOPE_TYPES = [
	'global',
	'skill',
	'project',
	'repository',
	'tool',
	'file',
] as const;
export type ScopeType = (typeof MEMORY_SCOPE_TYPES)[number];

export const MEMORY_ITEM_STATUSES = ['active', 'expired', 'archived'] as const;
export type MemoryItemStatus = (typeof MEMORY_ITEM_STATUSES)[number];

export const MEMORY_ENFORCEMENTS = ['hard', 'soft'] as const;
export type MemoryEnforcement = (typeof MEMORY_ENFORCEMENTS)[number];

export const MEMORY_SOURCES = ['preference', 'correction'] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export interface MemoryScope {
	type: ScopeType;
	key: string;
}

export interface ContextBudgets {
	layer0_total: number;
	global_rules: number;
	userprofile_summary: number;
	taskboard_focus: number;
	scoped_context: number;
	single_item_max: number;
}

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
	entity_id: string | null;
}

export interface MemoryItemRow {
	item_id: number;
	slot_key: string;
	content: string;
	item_kind: MemoryItemKind;
	scope_type: ScopeType;
	scope_key: string;
	priority: number;
	enforcement: MemoryEnforcement;
	source: MemorySource;
	related_files: string;
	manual_flag: number;
	status: MemoryItemStatus;
	created_at: string;
	updated_at: string;
	expires_at: string | null;
	archived_at: string | null;
	archive_reason: string | null;
}

export interface ScopedMemoryItem {
	itemId: number;
	slotKey: string;
	content: string;
	itemKind: MemoryItemKind;
	scope: MemoryScope;
	priority: number;
	enforcement: MemoryEnforcement;
	source: MemorySource;
	relatedFiles: string[];
	manualFlag: boolean;
	status: MemoryItemStatus;
	createdAt: string;
	updatedAt: string;
	expiresAt: string | null;
	archivedAt: string | null;
	archiveReason: string | null;
}

export interface UpsertMemoryItemInput {
	slotKey: string;
	content: string;
	itemKind: MemoryItemKind;
	scope: MemoryScope;
	priority?: number;
	enforcement?: MemoryEnforcement;
	source?: MemorySource;
	relatedFiles?: string[];
	expiresAt?: string | null;
}

export type UpsertMemoryItemResult = ScopedMemoryItem & { action: 'created' | 'updated' };

export interface ListMemoryItemsInput {
	itemIds?: number[];
	slotKey?: string;
	itemKind?: MemoryItemKind;
	scope?: MemoryScope;
	status?: MemoryItemStatus;
	source?: MemorySource;
	limit?: number;
}

export interface ArchiveMemoryItemInput {
	itemId: number;
	reason: string;
	archivedAt?: string;
}

export interface RestoreMemoryItemInput {
	itemId: number;
	restoredAt?: string;
}

export interface ReclassifyMemoryItemInput {
	itemId: number;
	scope?: MemoryScope;
	itemKind?: MemoryItemKind;
	slotKey?: string;
	updatedAt?: string;
}

export interface ExpireMemoryItemsResult {
	expired: number;
	dryRun: boolean;
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
	| 'category'
	| 'project'
	| 'summary'
	| 'search_hints'
	| 'tags'
	| 'aliases'
	| 'wikilinks'
	| 'backlinks'
	| 'modified_at'
	| 'entity_id'
>;

// ─── Result types for core.ts ──────────────────────────────────────────────────

export interface StartupResult {
	layer0: Layer0Context;
	scopeHints: {
		availableProjects: string[];
		availableSkills: string[];
	};
	vaultStats: {
		totalFiles: number;
		updatedSinceLast: number;
		unchanged: number;
		removed: number;
		maintenancePending: boolean;
	};
	dictLoaded?: boolean;
	dictError?: string;
}

export interface StartupMaintenanceResult {
	vaultStats: {
		totalFiles: number;
		updatedSinceLast: number;
		unchanged: number;
		removed: number;
		maintenancePending: false;
	};
	activeDocs: Array<{ target: ActiveDocTarget; changed: boolean; path: string }>;
	impact: {
		taskboardChanged: boolean;
		profileChanged: boolean;
		affectedScopes: MemoryScope[];
	};
}

export interface Layer0Meta {
	tokenEstimate: number;
	tokenBudget: number;
	globalItemsTotal: number;
	globalItemsLoaded: number;
	omittedSlotKeys: string[];
	oversizedItems: string[];
	warnings: string[];
	sections: {
		globalRules: Layer0SectionMeta;
		taskboardFocus: Layer0SectionMeta;
		userprofileSummary: Layer0SectionMeta;
		revisionReminder: Layer0SectionMeta;
	};
}

export interface Layer0SectionMeta {
	total: number;
	loaded: number;
	omitted: number;
}

export interface Layer0Context {
	text: string;
	snapshotId: string;
	meta: Layer0Meta;
}

export interface ContextRequest {
	scopes: MemoryScope[];
	includeGlobal?: boolean;
	includeRelatedFiles?: boolean;
	tokenBudget?: number;
}

export interface ContextDiagnostics {
	unresolvedScopes: Array<{ scope: MemoryScope; reason: string }>;
	omittedSlotKeys: string[];
	oversizedItems: string[];
	warnings: string[];
}

export interface ContextResponse {
	snapshotId: string;
	matchedScopes: MemoryScope[];
	effectiveItems: ScopedMemoryItem[];
	overriddenItems: ScopedMemoryItem[];
	rules: ScopedMemoryItem[];
	decisions: ScopedMemoryItem[];
	facts: ScopedMemoryItem[];
	relatedFiles: string[];
	text: string;
	diagnostics: ContextDiagnostics;
}

export interface RefreshResult {
	status: 'ok';
	path: string;
	sections: string[];
	updatedSection: string;
	changed: boolean;
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
	review: '待复习',
	revised: '已复习',
	mastered: '已掌握',
};

export const NOTE_TYPE_LABELS: Readonly<Record<string, string>> = {
	project: '项目文件',
	note: '知识笔记',
	research: '研究记录',
	system: '系统文档',
	output: '成果文档',
};

export const MASTERY_STATUS_LABELS: Readonly<Record<string, string>> = {
	draft: '🔴 整理中',
	review: '🟠 待复习',
	revised: '🟡 已复习待巩固',
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
