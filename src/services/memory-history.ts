import type Database from 'better-sqlite3';
import type { MemoryItemEvent, MemoryItemEventRow, ScopedMemoryItem } from '../types.js';
import { MemoryItemNotFoundError, MemoryItemValidationError } from './memory-items.js';

export interface MemoryHistoryResult {
	itemId: number;
	events: MemoryItemEvent[];
}

function parseSnapshot(value: string | null): ScopedMemoryItem | null {
	if (value === null) return null;
	try {
		const parsed: unknown = JSON.parse(value);
		if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
			throw new Error('不是对象');
		}
		return parsed as ScopedMemoryItem;
	} catch {
		throw new MemoryItemValidationError('数据库中的记忆事件快照不是合法 JSON 对象');
	}
}

function rowToEvent(row: MemoryItemEventRow): MemoryItemEvent {
	return {
		eventId: row.event_id,
		itemId: row.item_id,
		eventType: row.event_type,
		before: parseSnapshot(row.before_json),
		after: parseSnapshot(row.after_json),
		reason: row.reason,
		actor: row.actor,
		occurredAt: row.occurred_at,
		contractVersion: row.contract_version,
		correlationId: row.correlation_id,
	};
}

export function getMemoryHistory(
	db: Database.Database,
	input: { itemId: number; limit?: number },
): MemoryHistoryResult {
	if (!Number.isInteger(input.itemId) || input.itemId <= 0) {
		throw new MemoryItemValidationError('itemId 必须是正整数');
	}
	const limit = input.limit ?? 50;
	if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
		throw new MemoryItemValidationError('limit 必须是 1–100 的整数');
	}
	const item = db.prepare('SELECT 1 FROM memory_items WHERE item_id = ?').get(input.itemId);
	if (!item) throw new MemoryItemNotFoundError(input.itemId);
	const rows = db
		.prepare(`
			SELECT event_id, item_id, event_type, before_json, after_json,
			       reason, actor, occurred_at, contract_version, correlation_id
			FROM memory_item_events
			WHERE item_id = ?
			ORDER BY occurred_at, event_id
			LIMIT ?
		`)
		.all(input.itemId, limit) as MemoryItemEventRow[];
	return { itemId: input.itemId, events: rows.map(rowToEvent) };
}
