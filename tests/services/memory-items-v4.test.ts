import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../../src/db/schema.js';
import {
	MemoryItemConflictError,
	MemoryItemValidationError,
	archiveMemoryItem,
	expireMemoryItems,
	getMemoryItemById,
	listMemoryItems,
	reclassifyMemoryItem,
	restoreMemoryItem,
	upsertMemoryItem,
} from '../../src/services/memory-items.js';

describe('V4 记忆条目治理', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = new Database(':memory:');
		initDb(db);
	});

	afterEach(() => db.close());

	it('以 scope 与 slotKey 的复合身份分别创建和更新条目', () => {
		const global = upsertMemoryItem(db, {
			slotKey: 'format:answer',
			content: '全局保持简洁',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
		});
		const project = upsertMemoryItem(db, {
			slotKey: 'format:answer',
			content: '本项目需要完整推导',
			itemKind: 'rule',
			scope: { type: 'project', key: 'project-1' },
			source: 'correction',
		});

		expect(global.itemId).not.toBe(project.itemId);
		expect(listMemoryItems(db, { slotKey: 'format:answer' })).toHaveLength(2);

		const updated = upsertMemoryItem(db, {
			slotKey: 'format:answer',
			content: '全局只保留结论',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
			source: 'correction',
		});
		expect(updated.action).toBe('updated');
		expect(updated.itemId).toBe(global.itemId);
		expect(getMemoryItemById(db, project.itemId)?.content).toBe('本项目需要完整推导');
	});

	it('更新时不允许 correction 降级，也不允许隐式改变 itemKind', () => {
		const created = upsertMemoryItem(db, {
			slotKey: 'content:language',
			content: '必须使用中文',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
			source: 'correction',
		});
		const updated = upsertMemoryItem(db, {
			slotKey: 'content:language',
			content: '继续使用中文',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
			source: 'preference',
		});
		expect(updated.source).toBe('correction');
		expect(() =>
			upsertMemoryItem(db, {
				slotKey: 'content:language',
				content: '语言事实',
				itemKind: 'fact',
				scope: { type: 'global', key: '' },
			}),
		).toThrow(MemoryItemConflictError);
		expect(getMemoryItemById(db, created.itemId)?.itemKind).toBe('rule');
	});

	it('拒绝非法 slot、scope、优先级、关联文件和 event 写入', () => {
		const base = {
			content: '内容',
			itemKind: 'rule' as const,
			scope: { type: 'global' as const, key: '' },
		};
		expect(() => upsertMemoryItem(db, { ...base, slotKey: 'Bad Key' })).toThrow(
			MemoryItemValidationError,
		);
		expect(() =>
			upsertMemoryItem(db, {
				...base,
				slotKey: 'scope:bad',
				scope: { type: 'global', key: 'not-empty' },
			}),
		).toThrow(MemoryItemValidationError);
		expect(() => upsertMemoryItem(db, { ...base, slotKey: 'priority:bad', priority: 101 })).toThrow(
			MemoryItemValidationError,
		);
		expect(() =>
			upsertMemoryItem(db, { ...base, slotKey: 'files:bad', relatedFiles: [''] }),
		).toThrow(MemoryItemValidationError);
		expect(() =>
			upsertMemoryItem(db, {
				...base,
				slotKey: 'event:bad',
				itemKind: 'event',
			}),
		).toThrow(MemoryItemValidationError);
	});

	it('按 hard、priority、correction 的治理顺序列出条目', () => {
		upsertMemoryItem(db, {
			slotKey: 'order:soft',
			content: '软规则',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
			priority: 100,
		});
		upsertMemoryItem(db, {
			slotKey: 'order:hard-low',
			content: '低优先级硬规则',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
			priority: 10,
			enforcement: 'hard',
		});
		upsertMemoryItem(db, {
			slotKey: 'order:hard-high',
			content: '高优先级硬规则',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
			priority: 90,
			enforcement: 'hard',
			source: 'correction',
		});

		expect(listMemoryItems(db).map((item) => item.slotKey)).toEqual([
			'order:hard-high',
			'order:hard-low',
			'order:soft',
		]);
	});

	it('归档后拒绝普通 upsert，并可通过治理接口恢复', () => {
		const created = upsertMemoryItem(db, {
			slotKey: 'workflow:review',
			content: '每周复盘',
			itemKind: 'rule',
			scope: { type: 'skill', key: 'today' },
		});
		const archived = archiveMemoryItem(db, {
			itemId: created.itemId,
			reason: '暂时停用',
			archivedAt: '2026-07-20T00:00:00.000Z',
		});
		expect(archived).toMatchObject({ status: 'archived', archiveReason: '暂时停用' });
		expect(() =>
			upsertMemoryItem(db, {
				slotKey: 'workflow:review',
				content: '恢复复盘',
				itemKind: 'rule',
				scope: { type: 'skill', key: 'today' },
			}),
		).toThrow(MemoryItemConflictError);

		const restored = restoreMemoryItem(db, {
			itemId: created.itemId,
			restoredAt: '2026-07-21T00:00:00.000Z',
		});
		expect(restored).toMatchObject({ status: 'active', archivedAt: null, archiveReason: null });
	});

	it('仅允许已归档条目重分类为 event，且 event 不可恢复', () => {
		const created = upsertMemoryItem(db, {
			slotKey: 'decision:old',
			content: '采用方案甲',
			itemKind: 'decision',
			scope: { type: 'project', key: 'project-1' },
		});
		expect(() => reclassifyMemoryItem(db, { itemId: created.itemId, itemKind: 'event' })).toThrow(
			MemoryItemConflictError,
		);
		archiveMemoryItem(db, { itemId: created.itemId, reason: '已完成决策' });
		const event = reclassifyMemoryItem(db, {
			itemId: created.itemId,
			itemKind: 'event',
			slotKey: 'event:decision-old',
		});
		expect(event.itemKind).toBe('event');
		expect(() => restoreMemoryItem(db, { itemId: created.itemId })).toThrow(
			MemoryItemConflictError,
		);
	});

	it('重分类遇到复合键冲突时保持原条目不变', () => {
		const first = upsertMemoryItem(db, {
			slotKey: 'fact:topic',
			content: '项目甲事实',
			itemKind: 'fact',
			scope: { type: 'project', key: 'project-a' },
		});
		upsertMemoryItem(db, {
			slotKey: 'fact:topic',
			content: '项目乙事实',
			itemKind: 'fact',
			scope: { type: 'project', key: 'project-b' },
		});
		expect(() =>
			reclassifyMemoryItem(db, {
				itemId: first.itemId,
				scope: { type: 'project', key: 'project-b' },
			}),
		).toThrow(MemoryItemConflictError);
		expect(getMemoryItemById(db, first.itemId)?.scope).toEqual({
			type: 'project',
			key: 'project-a',
		});
	});

	it('过期操作支持 dryRun，并只更新到期的 active 条目', () => {
		const expired = upsertMemoryItem(db, {
			slotKey: 'temporary:past',
			content: '已到期',
			itemKind: 'fact',
			scope: { type: 'global', key: '' },
			expiresAt: '2026-07-20T00:00:00.000Z',
		});
		const future = upsertMemoryItem(db, {
			slotKey: 'temporary:future',
			content: '尚未到期',
			itemKind: 'fact',
			scope: { type: 'global', key: '' },
			expiresAt: '2026-07-22T00:00:00.000Z',
		});
		expect(expireMemoryItems(db, { now: '2026-07-21T00:00:00.000Z', dryRun: true })).toEqual({
			expired: 1,
			dryRun: true,
		});
		expect(getMemoryItemById(db, expired.itemId)?.status).toBe('active');
		expect(expireMemoryItems(db, { now: '2026-07-21T00:00:00.000Z' })).toEqual({
			expired: 1,
			dryRun: false,
		});
		expect(getMemoryItemById(db, expired.itemId)?.status).toBe('expired');
		expect(getMemoryItemById(db, future.itemId)?.status).toBe('active');
	});
});
