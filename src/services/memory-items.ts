import type Database from 'better-sqlite3';
import type {
	ArchiveMemoryItemInput,
	ExpireMemoryItemsResult,
	ListMemoryItemsInput,
	MemoryItemRow,
	MemoryScope,
	ReclassifyMemoryItemInput,
	RestoreMemoryItemInput,
	ScopedMemoryItem,
	UpsertMemoryItemInput,
	UpsertMemoryItemResult,
} from '../types.js';
import {
	MEMORY_ENFORCEMENTS,
	MEMORY_ITEM_KINDS,
	MEMORY_ITEM_STATUSES,
	MEMORY_SCOPE_TYPES,
	MEMORY_SOURCES,
} from '../types.js';
import { assertGlobalHardItemSafety, assertGlobalHardSafety } from './global-hard-safety.js';

const MEMORY_COLUMNS = `
	item_id, slot_key, content, item_kind, scope_type, scope_key, priority,
	enforcement, source, related_files, manual_flag, status, created_at,
	updated_at, expires_at, archived_at, archive_reason
`;
const SLOT_KEY_PATTERN = /^[a-z]+:[a-z0-9_.-]+$/;

export class MemoryItemValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MemoryItemValidationError';
	}
}

export class MemoryItemNotFoundError extends Error {
	constructor(itemId: number) {
		super(`未找到 memory item：${itemId}`);
		this.name = 'MemoryItemNotFoundError';
	}
}

export class MemoryItemConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MemoryItemConflictError';
	}
}

function validateItemId(itemId: number): void {
	if (!Number.isInteger(itemId) || itemId <= 0) {
		throw new MemoryItemValidationError('itemId 必须是正整数');
	}
}

function normalizeTimestamp(value: string, field: string): string {
	const timestamp = Date.parse(value);
	if (!value.trim() || !Number.isFinite(timestamp)) {
		throw new MemoryItemValidationError(`${field} 必须是有效时间戳`);
	}
	return new Date(timestamp).toISOString();
}

function validateSlotKey(slotKey: string): void {
	if (!SLOT_KEY_PATTERN.test(slotKey)) {
		throw new MemoryItemValidationError(
			'slotKey 必须符合 <category>:<topic>，且只能包含小写 ASCII、数字、点、下划线和连字符',
		);
	}
}

function validateScope(scope: MemoryScope): void {
	if (!MEMORY_SCOPE_TYPES.includes(scope.type)) {
		throw new MemoryItemValidationError(`非法 scope type：${scope.type}`);
	}
	if (scope.key !== scope.key.trim()) {
		throw new MemoryItemValidationError('scope key 不能包含首尾空白');
	}
	if (scope.type === 'global' ? scope.key !== '' : scope.key === '') {
		throw new MemoryItemValidationError('global scope 的 key 必须为空，其他 scope 的 key 必须非空');
	}
}

const TEMPORARY_FILE_TYPES = ['plan', 'draft'];

// 拦截逻辑：严禁为临时计划/草稿文件写入持久 rule/decision/fact/profile 记忆。
// file scope key 经 resolveMemoryScopes 规范化为 entity_id || file_path，两种形式都查；
// 命中 vault_index 且 type 为 plan/draft 即拒绝，查不到记录时不拦截。
export function assertNotTemporaryFileScope(db: Database.Database, scope: MemoryScope): void {
	if (scope.type !== 'file') return;
	const row = db
		.prepare('SELECT type FROM vault_index WHERE file_path = ? OR entity_id = ?')
		.get(scope.key, scope.key) as { type: string } | undefined;
	if (row && TEMPORARY_FILE_TYPES.includes(row.type)) {
		throw new MemoryItemValidationError(
			`[Memory Policy Violation] 严禁为临时计划或草稿文件 (${scope.key}) 写入持久记忆。阶段性方案请保留在 Markdown 正文中。`,
		);
	}
}

function parseRelatedFiles(value: string): string[] {
	try {
		const parsed: unknown = JSON.parse(value);
		if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
			throw new Error('invalid');
		}
		return parsed;
	} catch {
		throw new MemoryItemValidationError('数据库中的 related_files 不是合法字符串数组');
	}
}

function rowToItem(row: MemoryItemRow): ScopedMemoryItem {
	return {
		itemId: row.item_id,
		slotKey: row.slot_key,
		content: row.content,
		itemKind: row.item_kind,
		scope: { type: row.scope_type, key: row.scope_key },
		priority: row.priority,
		enforcement: row.enforcement,
		source: row.source,
		relatedFiles: parseRelatedFiles(row.related_files),
		manualFlag: row.manual_flag !== 0,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		expiresAt: row.expires_at,
		archivedAt: row.archived_at,
		archiveReason: row.archive_reason,
	};
}

function selectById(db: Database.Database, itemId: number): MemoryItemRow | undefined {
	return db.prepare(`SELECT ${MEMORY_COLUMNS} FROM memory_items WHERE item_id = ?`).get(itemId) as
		| MemoryItemRow
		| undefined;
}

function requireById(db: Database.Database, itemId: number): MemoryItemRow {
	validateItemId(itemId);
	const row = selectById(db, itemId);
	if (!row) throw new MemoryItemNotFoundError(itemId);
	return row;
}

function isUniqueConstraint(error: unknown): boolean {
	return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

export function upsertMemoryItem(
	db: Database.Database,
	input: UpsertMemoryItemInput,
): UpsertMemoryItemResult {
	validateSlotKey(input.slotKey);
	if (!input.content.trim()) throw new MemoryItemValidationError('content 不能为空');
	if (!MEMORY_ITEM_KINDS.includes(input.itemKind)) {
		throw new MemoryItemValidationError(`非法 itemKind：${input.itemKind}`);
	}
	if (input.itemKind === 'event') {
		throw new MemoryItemValidationError('event 不能通过 memory_log 新建或更新');
	}
	validateScope(input.scope);
	assertNotTemporaryFileScope(db, input.scope);
	const priority = input.priority ?? 50;
	if (!Number.isInteger(priority) || priority < 0 || priority > 100) {
		throw new MemoryItemValidationError('priority 必须是 0–100 的整数');
	}
	const enforcement = input.enforcement ?? 'soft';
	if (!MEMORY_ENFORCEMENTS.includes(enforcement)) {
		throw new MemoryItemValidationError(`非法 enforcement：${enforcement}`);
	}
	const source = input.source ?? 'preference';
	if (!MEMORY_SOURCES.includes(source)) {
		throw new MemoryItemValidationError(`非法 source：${source}`);
	}
	const relatedFiles = input.relatedFiles ?? [];
	if (relatedFiles.some((file) => typeof file !== 'string' || !file.trim())) {
		throw new MemoryItemValidationError('relatedFiles 必须是非空字符串数组');
	}
	const expiresAt =
		input.expiresAt === null || input.expiresAt === undefined
			? null
			: normalizeTimestamp(input.expiresAt, 'expiresAt');
	const now = new Date().toISOString();
	const writesGlobalHard =
		input.scope.type === 'global' &&
		input.itemKind === 'rule' &&
		enforcement === 'hard' &&
		(!expiresAt || expiresAt >= now);
	if (writesGlobalHard) {
		assertGlobalHardItemSafety({
			slotKey: input.slotKey,
			content: input.content,
			relatedFiles,
		});
	}

	const write = db.transaction((): UpsertMemoryItemResult => {
		const existing = db
			.prepare(`
				SELECT ${MEMORY_COLUMNS} FROM memory_items
				WHERE scope_type = ? AND scope_key = ? AND slot_key = ?
			`)
			.get(input.scope.type, input.scope.key, input.slotKey) as MemoryItemRow | undefined;
		if (existing) {
			if (existing.status !== 'active') {
				throw new MemoryItemConflictError(
					`memory item ${existing.item_id} 为 ${existing.status}，必须先通过治理接口恢复`,
				);
			}
			if (existing.item_kind !== input.itemKind) {
				throw new MemoryItemConflictError('itemKind 变更必须使用 reclassifyMemoryItem');
			}
			const finalSource =
				existing.source === 'correction' && source === 'preference' ? 'correction' : source;
			db.prepare(`
				UPDATE memory_items SET
					content = ?, priority = ?, enforcement = ?, source = ?,
					related_files = ?, updated_at = ?, expires_at = ?
				WHERE item_id = ?
			`).run(
				input.content,
				priority,
				enforcement,
				finalSource,
				JSON.stringify(relatedFiles),
				now,
				expiresAt,
				existing.item_id,
			);
			const item = rowToItem(requireById(db, existing.item_id));
			if (writesGlobalHard) assertGlobalHardSafety(db, { now, operation: 'write' });
			return { ...item, action: 'updated' };
		}
		const result = db
			.prepare(`
				INSERT INTO memory_items(
					slot_key, content, item_kind, scope_type, scope_key, priority,
					enforcement, source, related_files, manual_flag, status,
					created_at, updated_at, expires_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?)
			`)
			.run(
				input.slotKey,
				input.content,
				input.itemKind,
				input.scope.type,
				input.scope.key,
				priority,
				enforcement,
				source,
				JSON.stringify(relatedFiles),
				now,
				now,
				expiresAt,
			);
		const itemId = Number(result.lastInsertRowid);
		const item = rowToItem(requireById(db, itemId));
		if (writesGlobalHard) assertGlobalHardSafety(db, { now, operation: 'write' });
		return { ...item, action: 'created' };
	});
	return write.immediate();
}

export function getMemoryItemById(db: Database.Database, itemId: number): ScopedMemoryItem | null {
	validateItemId(itemId);
	const row = selectById(db, itemId);
	return row ? rowToItem(row) : null;
}

export function listMemoryItems(
	db: Database.Database,
	input: ListMemoryItemsInput = {},
): ScopedMemoryItem[] {
	if (input.itemKind && !MEMORY_ITEM_KINDS.includes(input.itemKind)) {
		throw new MemoryItemValidationError(`非法 itemKind：${input.itemKind}`);
	}
	if (input.status && !MEMORY_ITEM_STATUSES.includes(input.status)) {
		throw new MemoryItemValidationError(`非法 status：${input.status}`);
	}
	if (input.source && !MEMORY_SOURCES.includes(input.source)) {
		throw new MemoryItemValidationError(`非法 source：${input.source}`);
	}
	const conditions: string[] = [];
	const params: unknown[] = [];
	if (input.itemIds) {
		if (input.itemIds.length === 0) return [];
		for (const itemId of input.itemIds) validateItemId(itemId);
		conditions.push(`item_id IN (${input.itemIds.map(() => '?').join(', ')})`);
		params.push(...input.itemIds);
	}
	if (input.slotKey) {
		conditions.push('slot_key = ?');
		params.push(input.slotKey);
	}
	if (input.itemKind) {
		conditions.push('item_kind = ?');
		params.push(input.itemKind);
	}
	if (input.scope) {
		validateScope(input.scope);
		conditions.push('scope_type = ?', 'scope_key = ?');
		params.push(input.scope.type, input.scope.key);
	}
	if (input.status) {
		conditions.push('status = ?');
		params.push(input.status);
	}
	if (input.source) {
		conditions.push('source = ?');
		params.push(input.source);
	}
	const limit = input.limit ?? 100;
	if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
		throw new MemoryItemValidationError('limit 必须是 1–10000 的整数');
	}
	const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
	const rows = db
		.prepare(`
			SELECT ${MEMORY_COLUMNS} FROM memory_items ${where}
			ORDER BY
				CASE enforcement WHEN 'hard' THEN 0 ELSE 1 END,
				priority DESC,
				CASE source WHEN 'correction' THEN 0 ELSE 1 END,
				updated_at DESC,
				scope_type, scope_key, slot_key, item_id
			LIMIT ?
		`)
		.all(...params, limit) as MemoryItemRow[];
	return rows.map(rowToItem);
}

export function archiveMemoryItem(
	db: Database.Database,
	input: ArchiveMemoryItemInput,
): ScopedMemoryItem {
	if (!input.reason.trim()) throw new MemoryItemValidationError('归档原因不能为空');
	const archivedAt = normalizeTimestamp(input.archivedAt ?? new Date().toISOString(), 'archivedAt');
	const archive = db.transaction(() => {
		const existing = requireById(db, input.itemId);
		if (existing.status === 'archived') {
			throw new MemoryItemConflictError(`memory item ${input.itemId} 已归档`);
		}
		db.prepare(`
			UPDATE memory_items SET status = 'archived', archived_at = ?,
			archive_reason = ?, updated_at = ? WHERE item_id = ?
		`).run(archivedAt, input.reason.trim(), archivedAt, input.itemId);
		return rowToItem(requireById(db, input.itemId));
	});
	return archive.immediate();
}

export function forgetScopeMemoryItems(
	db: Database.Database,
	scope: MemoryScope,
	reason: string,
): number {
	validateScope(scope);
	if (scope.type === 'global') {
		// 安全保护：禁止一键清空全部全局行为约束（Layer 0），全局条目须逐条 item_id 归档
		throw new MemoryItemValidationError('禁止批量归档 global scope，请改用逐条 item_id 归档');
	}
	if (!reason.trim()) throw new MemoryItemValidationError('归档原因不能为空');
	// 仅清理 active 条目；expired 已是终态、不出现在 active 上下文，保留不动（预期语义）
	const stmt = db.prepare(`
		UPDATE memory_items
		SET status = 'archived', archived_at = ?, archive_reason = ?, updated_at = ?
		WHERE scope_type = ? AND scope_key = ? AND status = 'active'
	`);
	const now = new Date().toISOString();
	return stmt.run(now, reason.trim(), now, scope.type, scope.key).changes;
}

export function restoreMemoryItem(
	db: Database.Database,
	input: RestoreMemoryItemInput,
): ScopedMemoryItem {
	const restoredAt = normalizeTimestamp(input.restoredAt ?? new Date().toISOString(), 'restoredAt');
	const restore = db.transaction(() => {
		const existing = requireById(db, input.itemId);
		if (existing.status !== 'archived') {
			throw new MemoryItemConflictError(`memory item ${input.itemId} 未归档`);
		}
		if (existing.item_kind === 'event') {
			throw new MemoryItemConflictError('event 不能恢复为有效记忆');
		}
		const nextStatus =
			existing.expires_at && Date.parse(existing.expires_at) < Date.parse(restoredAt)
				? 'expired'
				: 'active';
		db.prepare(`
			UPDATE memory_items SET status = ?, archived_at = NULL,
			archive_reason = NULL, updated_at = ? WHERE item_id = ?
		`).run(nextStatus, restoredAt, input.itemId);
		const item = rowToItem(requireById(db, input.itemId));
		if (
			item.status === 'active' &&
			item.scope.type === 'global' &&
			item.itemKind === 'rule' &&
			item.enforcement === 'hard'
		) {
			assertGlobalHardSafety(db, { now: restoredAt, operation: 'write' });
		}
		return item;
	});
	return restore.immediate();
}

export function reclassifyMemoryItem(
	db: Database.Database,
	input: ReclassifyMemoryItemInput,
): ScopedMemoryItem {
	const updatedAt = normalizeTimestamp(input.updatedAt ?? new Date().toISOString(), 'updatedAt');
	const reclassify = db.transaction(() => {
		const existing = requireById(db, input.itemId);
		const scope = input.scope ?? { type: existing.scope_type, key: existing.scope_key };
		const slotKey = input.slotKey ?? existing.slot_key;
		const itemKind = input.itemKind ?? existing.item_kind;
		validateScope(scope);
		assertNotTemporaryFileScope(db, scope);
		validateSlotKey(slotKey);
		if (!MEMORY_ITEM_KINDS.includes(itemKind)) {
			throw new MemoryItemValidationError(`非法 itemKind：${itemKind}`);
		}
		if (itemKind === 'event' && existing.status !== 'archived') {
			throw new MemoryItemConflictError('只有已归档条目才能重分类为 event');
		}
		try {
			db.prepare(`
				UPDATE memory_items SET scope_type = ?, scope_key = ?, slot_key = ?,
				item_kind = ?, updated_at = ? WHERE item_id = ?
			`).run(scope.type, scope.key, slotKey, itemKind, updatedAt, input.itemId);
		} catch (error) {
			if (isUniqueConstraint(error)) {
				throw new MemoryItemConflictError('重分类目标复合键已存在');
			}
			throw error;
		}
		const item = rowToItem(requireById(db, input.itemId));
		if (
			item.status === 'active' &&
			item.scope.type === 'global' &&
			item.itemKind === 'rule' &&
			item.enforcement === 'hard'
		) {
			assertGlobalHardSafety(db, { now: updatedAt, operation: 'write' });
		}
		return item;
	});
	return reclassify.immediate();
}

export function expireMemoryItems(
	db: Database.Database,
	options: { now?: string; dryRun?: boolean } = {},
): ExpireMemoryItemsResult {
	const now = normalizeTimestamp(options.now ?? new Date().toISOString(), 'now');
	const count = (
		db
			.prepare(`
				SELECT COUNT(*) AS count FROM memory_items
				WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ?
			`)
			.get(now) as { count: number }
	).count;
	if (!options.dryRun && count > 0) {
		db.prepare(`
			UPDATE memory_items SET status = 'expired', updated_at = ?
			WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ?
		`).run(now, now);
	}
	return { expired: count, dryRun: options.dryRun === true };
}
