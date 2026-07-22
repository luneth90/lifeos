import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VaultConfig } from '../../src/config.js';
import { initDb } from '../../src/db/schema.js';
import { buildMemoryContext } from '../../src/services/context-router.js';
import {
	GlobalHardRuleLimitError,
	MAX_ACTIVE_GLOBAL_HARD_RULES,
	MAX_GLOBAL_HARD_ITEM_PAYLOAD_BYTES,
	describeGlobalHardSafety,
	inspectGlobalHardSafety,
} from '../../src/services/global-hard-safety.js';
import { buildLayer0Context } from '../../src/services/layer0.js';
import {
	archiveMemoryItem,
	getMemoryItemById,
	reclassifyMemoryItem,
	restoreMemoryItem,
	upsertMemoryItem,
} from '../../src/services/memory-items.js';
import type { ContextBudgets } from '../../src/types.js';

const BUDGETS: ContextBudgets = {
	layer0_total: 1800,
	global_rules: 600,
	userprofile_summary: 200,
	taskboard_focus: 500,
	scoped_context: 1200,
	single_item_max: 220,
};

const CONFIG = {
	repositoryBindings: () => ({}),
	contextBudgets: () => ({ ...BUDGETS }),
} as unknown as VaultConfig;

function insertRawGlobalHard(db: Database.Database, slotKey: string, content: string): void {
	const now = new Date().toISOString();
	db.prepare(`
		INSERT INTO memory_items(
			slot_key, content, item_kind, scope_type, scope_key, priority,
			enforcement, source, related_files, manual_flag, status,
			created_at, updated_at, expires_at, archived_at, archive_reason
		) VALUES (?, ?, 'rule', 'global', '', 50, 'hard', 'preference', '[]', 0,
			'active', ?, ?, NULL, NULL, NULL)
	`).run(slotKey, content, now, now);
}

describe('global hard 运行时安全保险丝', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = new Database(':memory:');
		initDb(db);
	});

	afterEach(() => db.close());

	it('写入前拒绝超大单条 payload，不让异常正文进入数据库', () => {
		const oversized = 'a'.repeat(MAX_GLOBAL_HARD_ITEM_PAYLOAD_BYTES * 64);
		let thrown: unknown;
		try {
			upsertMemoryItem(db, {
				slotKey: 'safety:bytes',
				content: oversized,
				itemKind: 'rule',
				scope: { type: 'global', key: '' },
				enforcement: 'hard',
			});
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(GlobalHardRuleLimitError);
		expect((thrown as Error).message).toContain('tokens 未计算');
		expect(db.prepare('SELECT COUNT(*) AS count FROM memory_items').get()).toEqual({ count: 0 });
	});

	it('已过期的超大 global hard 可写入，且不计入运行时安全足迹', () => {
		const result = upsertMemoryItem(db, {
			slotKey: 'safety:expired-oversized',
			content: 'a'.repeat(MAX_GLOBAL_HARD_ITEM_PAYLOAD_BYTES * 64),
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
			enforcement: 'hard',
			expiresAt: '2000-01-01T00:00:00.000Z',
		});

		expect(result.action).toBe('created');
		expect(inspectGlobalHardSafety(db, '2026-07-22T00:00:00.000Z')).toMatchObject({
			ok: true,
			count: 0,
			totalBytes: 0,
		});
	});

	it('第 257 条规则触发数量上限，并由事务回滚最后一次写入', () => {
		for (let index = 0; index < MAX_ACTIVE_GLOBAL_HARD_RULES; index += 1) {
			upsertMemoryItem(db, {
				slotKey: `safety:count-${index}`,
				content: '短规则',
				itemKind: 'rule',
				scope: { type: 'global', key: '' },
				enforcement: 'hard',
			});
		}
		expect(() =>
			upsertMemoryItem(db, {
				slotKey: 'safety:count-overflow',
				content: '第 257 条',
				itemKind: 'rule',
				scope: { type: 'global', key: '' },
				enforcement: 'hard',
			}),
		).toThrow(GlobalHardRuleLimitError);
		expect(db.prepare('SELECT COUNT(*) AS count FROM memory_items').get()).toEqual({
			count: MAX_ACTIVE_GLOBAL_HARD_RULES,
		});
	});

	it('多条单独合法的规则不能绕过总 payload 上限', () => {
		for (let index = 0; index < 4; index += 1) {
			upsertMemoryItem(db, {
				slotKey: `safety:total-${index}`,
				content: 'a'.repeat(15_000),
				itemKind: 'rule',
				scope: { type: 'global', key: '' },
				enforcement: 'hard',
			});
		}
		expect(() =>
			upsertMemoryItem(db, {
				slotKey: 'safety:total-overflow',
				content: 'b'.repeat(15_000),
				itemKind: 'rule',
				scope: { type: 'global', key: '' },
				enforcement: 'hard',
			}),
		).toThrow(GlobalHardRuleLimitError);
		expect(db.prepare('SELECT COUNT(*) AS count FROM memory_items').get()).toEqual({ count: 4 });
	});

	it('历史异常数据会让 Layer 0 和 scoped context 整体失败，不返回部分 hard 规则', () => {
		const oversized = 'x'.repeat(MAX_GLOBAL_HARD_ITEM_PAYLOAD_BYTES + 1);
		insertRawGlobalHard(db, 'safety:legacy', oversized);
		upsertMemoryItem(db, {
			slotKey: 'workflow:local',
			content: '局部规则',
			itemKind: 'rule',
			scope: { type: 'skill', key: 'revise' },
		});

		const inspection = inspectGlobalHardSafety(db);
		expect(inspection.ok).toBe(false);
		expect(inspection.maxItemTokens).toBeNull();
		expect(describeGlobalHardSafety(inspection)).not.toContain(oversized);
		expect(() => buildLayer0Context(db, '/unused', BUDGETS)).toThrow(GlobalHardRuleLimitError);
		expect(() =>
			buildMemoryContext(
				db,
				'/unused',
				{ scopes: [{ type: 'skill', key: 'revise' }], includeGlobal: true },
				{ config: CONFIG },
			),
		).toThrow(GlobalHardRuleLimitError);
	});

	it('恢复和重分类无法绕过保险丝，失败时保持原状态', () => {
		const archived = upsertMemoryItem(db, {
			slotKey: 'safety:restore',
			content: '原规则',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
			enforcement: 'hard',
		});
		archiveMemoryItem(db, { itemId: archived.itemId, reason: '测试恢复保护' });
		db.prepare('UPDATE memory_items SET content = ? WHERE item_id = ?').run(
			'a'.repeat(MAX_GLOBAL_HARD_ITEM_PAYLOAD_BYTES + 1),
			archived.itemId,
		);
		expect(() => restoreMemoryItem(db, { itemId: archived.itemId })).toThrow(
			GlobalHardRuleLimitError,
		);
		expect(getMemoryItemById(db, archived.itemId)?.status).toBe('archived');

		const local = upsertMemoryItem(db, {
			slotKey: 'safety:reclassify',
			content: 'b'.repeat(MAX_GLOBAL_HARD_ITEM_PAYLOAD_BYTES + 1),
			itemKind: 'rule',
			scope: { type: 'skill', key: 'revise' },
			enforcement: 'hard',
		});
		expect(() =>
			reclassifyMemoryItem(db, {
				itemId: local.itemId,
				scope: { type: 'global', key: '' },
			}),
		).toThrow(GlobalHardRuleLimitError);
		expect(getMemoryItemById(db, local.itemId)?.scope).toEqual({ type: 'skill', key: 'revise' });
	});
});
