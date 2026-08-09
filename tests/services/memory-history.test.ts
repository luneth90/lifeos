import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../../src/db/schema.js';
import { getMemoryHistory } from '../../src/services/memory-history.js';
import {
	MemoryItemNotFoundError,
	MemoryItemValidationError,
	archiveMemoryItem,
	reclassifyMemoryItem,
	restoreMemoryItem,
	upsertMemoryItem,
} from '../../src/services/memory-items.js';

describe('记忆变更历史', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = new Database(':memory:');
		initDb(db);
	});

	afterEach(() => db.close());

	it('按 occurredAt 与 eventId 稳定返回完整 create→update→archive→restore→reclassify 历史', () => {
		const created = upsertMemoryItem(db, {
			slotKey: 'decision:history',
			content: '采用方案甲',
			itemKind: 'decision',
			scope: { type: 'project', key: 'project-before' },
			reason: '首次确认',
			actor: 'mcp:memory_log',
			correlationId: 'request:create',
			occurredAt: '2026-08-09T00:00:00.000Z',
		});
		upsertMemoryItem(db, {
			slotKey: 'decision:history',
			content: '采用方案乙',
			itemKind: 'decision',
			scope: { type: 'project', key: 'project-before' },
			reason: '用户修正',
			actor: 'mcp:memory_log',
			correlationId: 'request:update',
			occurredAt: '2026-08-09T00:01:00.000Z',
		});
		archiveMemoryItem(db, {
			itemId: created.itemId,
			reason: '暂时归档',
			actor: 'mcp:memory_forget',
			correlationId: 'request:archive',
			archivedAt: '2026-08-09T00:02:00.000Z',
		});
		restoreMemoryItem(db, {
			itemId: created.itemId,
			reason: '重新启用',
			actor: 'cli:rules:restore',
			correlationId: 'request:restore',
			restoredAt: '2026-08-09T00:03:00.000Z',
		});
		reclassifyMemoryItem(db, {
			itemId: created.itemId,
			scope: { type: 'project', key: 'project-after' },
			slotKey: 'decision:history-reclassified',
			reason: '移动到正式项目',
			actor: 'cli:rules:classify',
			correlationId: 'request:reclassify',
			updatedAt: '2026-08-09T00:04:00.000Z',
		});

		const history = getMemoryHistory(db, { itemId: created.itemId, limit: 10 });
		expect(history.itemId).toBe(created.itemId);
		expect(history.events.map((event) => event.eventType)).toEqual([
			'create',
			'update',
			'archive',
			'restore',
			'reclassify',
		]);
		expect(history.events.map((event) => event.occurredAt)).toEqual([
			'2026-08-09T00:00:00.000Z',
			'2026-08-09T00:01:00.000Z',
			'2026-08-09T00:02:00.000Z',
			'2026-08-09T00:03:00.000Z',
			'2026-08-09T00:04:00.000Z',
		]);
		expect(history.events[0]).toMatchObject({
			before: null,
			reason: '首次确认',
			actor: 'mcp:memory_log',
			correlationId: 'request:create',
			contractVersion: 2,
		});
		expect(history.events[1]).toMatchObject({
			before: { content: '采用方案甲' },
			after: { content: '采用方案乙' },
			reason: '用户修正',
		});
		expect(history.events[2]).toMatchObject({
			before: { status: 'active', archiveReason: null },
			after: { status: 'archived', archiveReason: '暂时归档' },
		});
		expect(history.events[3]).toMatchObject({
			before: { status: 'archived' },
			after: { status: 'active', archiveReason: null },
		});
		expect(history.events[4]).toMatchObject({
			before: { slotKey: 'decision:history', scope: { type: 'project', key: 'project-before' } },
			after: {
				slotKey: 'decision:history-reclassified',
				scope: { type: 'project', key: 'project-after' },
			},
		});
	});

	it('同一 occurredAt 以 eventId 打破并列并遵守 limit 上限', () => {
		const created = upsertMemoryItem(db, {
			slotKey: 'fact:stable-order',
			content: '第一版',
			itemKind: 'fact',
			scope: { type: 'global', key: '' },
			occurredAt: '2026-08-09T00:00:00.000Z',
		});
		upsertMemoryItem(db, {
			slotKey: 'fact:stable-order',
			content: '第二版',
			itemKind: 'fact',
			scope: { type: 'global', key: '' },
			occurredAt: '2026-08-09T00:00:00.000Z',
		});

		const history = getMemoryHistory(db, { itemId: created.itemId, limit: 2 });
		expect(history.events.map((event) => event.eventId)).toEqual([1, 2]);
		expect(() => getMemoryHistory(db, { itemId: created.itemId, limit: 101 })).toThrow(
			MemoryItemValidationError,
		);
	});

	it('未知 item 与非法 limit 返回准确错误', () => {
		expect(() => getMemoryHistory(db, { itemId: 999, limit: 10 })).toThrow(MemoryItemNotFoundError);
		expect(() => getMemoryHistory(db, { itemId: 0, limit: 10 })).toThrow(MemoryItemValidationError);
		expect(() => getMemoryHistory(db, { itemId: 1, limit: 0 })).toThrow(MemoryItemValidationError);
	});

	it('事件仅保存业务快照和显式元数据，不保存未声明的会话正文', () => {
		const secretRequest = '这是不得进入历史的原始会话正文 SECRET-REQUEST-9';
		const input = {
			slotKey: 'fact:privacy',
			content: '可持久化业务事实',
			itemKind: 'fact' as const,
			scope: { type: 'global' as const, key: '' },
			reason: '显式事实来源',
			actor: 'mcp:memory_log',
			correlationId: 'request:privacy',
			occurredAt: '2026-08-09T00:00:00.000Z',
			requestText: secretRequest,
		};
		const created = upsertMemoryItem(db, input);

		const raw = db
			.prepare(
				'SELECT before_json, after_json, reason, actor, correlation_id FROM memory_item_events',
			)
			.get() as Record<string, unknown>;
		expect(JSON.stringify(raw)).not.toContain(secretRequest);
		expect(raw).toMatchObject({
			before_json: null,
			reason: '显式事实来源',
			actor: 'mcp:memory_log',
			correlation_id: 'request:privacy',
		});
		expect(JSON.parse(String(raw.after_json))).toEqual({
			itemId: created.itemId,
			slotKey: 'fact:privacy',
			content: '可持久化业务事实',
			itemKind: 'fact',
			scope: { type: 'global', key: '' },
			priority: 50,
			enforcement: 'soft',
			source: 'preference',
			relatedFiles: [],
			manualFlag: false,
			status: 'active',
			createdAt: '2026-08-09T00:00:00.000Z',
			updatedAt: '2026-08-09T00:00:00.000Z',
			expiresAt: null,
			archivedAt: null,
			archiveReason: null,
		});
	});
});
