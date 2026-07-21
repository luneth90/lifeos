import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../../src/db/schema.js';
import { buildLayer0Context } from '../../src/services/layer0.js';
import { upsertMemoryItem } from '../../src/services/memory-items.js';
import type { ContextBudgets } from '../../src/types.js';

const BUDGETS: ContextBudgets = {
	layer0_total: 1800,
	global_rules: 600,
	userprofile_summary: 200,
	taskboard_focus: 500,
	scoped_context: 1200,
	single_item_max: 220,
};

describe('V4 Layer 0', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = new Database(':memory:');
		initDb(db);
	});

	afterEach(() => db.close());

	it('只加载 global rule，不把局部规则或 profile 当成行为约束', () => {
		upsertMemoryItem(db, {
			slotKey: 'content:language',
			content: '必须使用中文',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
		});
		upsertMemoryItem(db, {
			slotKey: 'content:language',
			content: '项目局部语言',
			itemKind: 'rule',
			scope: { type: 'project', key: 'project-1' },
		});
		upsertMemoryItem(db, {
			slotKey: 'profile:work_style',
			content: '单主线工作',
			itemKind: 'profile',
			scope: { type: 'global', key: '' },
		});

		const result = buildLayer0Context(db, '/unused', BUDGETS);
		expect(result.text).toContain('必须使用中文');
		expect(result.text).not.toContain('项目局部语言');
		expect(result.text).toContain('单主线工作');
		expect(result.meta.globalItemsTotal).toBe(1);
		expect(result.meta.globalItemsLoaded).toBe(1);
	});

	it('global hard 即使超单条和总预算也始终加载并告警', () => {
		upsertMemoryItem(db, {
			slotKey: 'safety:language',
			content: '必须使用中文并严格遵守约束'.repeat(30),
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
			enforcement: 'hard',
			priority: 100,
		});
		const result = buildLayer0Context(db, '/unused', {
			...BUDGETS,
			layer0_total: 1,
			global_rules: 1,
			single_item_max: 1,
		});
		expect(result.text).toContain('safety:language');
		expect(result.meta.oversizedItems).toEqual(['safety:language']);
		expect(result.meta.warnings).toEqual(
			expect.arrayContaining([
				'全局硬规则超过单条预算：safety:language',
				'全局硬规则总量超过 global_rules 预算',
				'全局硬规则导致 Layer 0 超过总预算',
			]),
		);
	});

	it('soft 规则按优先级装载，超预算条目进入 omittedSlotKeys', () => {
		for (const [slotKey, priority] of [
			['soft:first', 90],
			['soft:second', 80],
		] as const) {
			upsertMemoryItem(db, {
				slotKey,
				content: `${slotKey} 的内容`,
				itemKind: 'rule',
				scope: { type: 'global', key: '' },
				priority,
			});
		}
		const result = buildLayer0Context(db, '/unused', {
			...BUDGETS,
			global_rules: 14,
			layer0_total: 30,
		});
		expect(result.text).toContain('soft:first');
		expect(result.text).not.toContain('soft:second');
		expect(result.meta.omittedSlotKeys).toEqual(['soft:second']);
	});

	it('组合 TaskBoard 焦点、全局画像与复习提醒', () => {
		db.prepare(`
			INSERT INTO vault_index(file_path,title,type,status,category,domain,modified_at,entity_id)
			VALUES ('20_项目/代数.md','代数学习','project','active','learning','数学','2026-07-21','project-algebra')
		`).run();
		db.prepare(`
			INSERT INTO vault_index(file_path,title,type,status,domain,modified_at,entity_id)
			VALUES ('40_知识/群论.md','群论','note','review','数学','2026-07-21','note-group')
		`).run();
		upsertMemoryItem(db, {
			slotKey: 'profile:thinking_preference',
			content: '偏好先看结构再看细节',
			itemKind: 'profile',
			scope: { type: 'global', key: '' },
		});

		const first = buildLayer0Context(db, '/unused', BUDGETS);
		const second = buildLayer0Context(db, '/unused', BUDGETS);
		expect(first.text).toContain('代数学习');
		expect(first.text).toContain('偏好先看结构再看细节');
		expect(first.text).toContain('待复习笔记：1 篇');
		expect(first.snapshotId).toBe(second.snapshotId);
	});

	it('排除已过期 global rule', () => {
		upsertMemoryItem(db, {
			slotKey: 'temporary:old',
			content: '过期规则',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
			expiresAt: '2000-01-01T00:00:00.000Z',
		});
		const result = buildLayer0Context(db, '/unused', BUDGETS);
		expect(result.text).not.toContain('过期规则');
		expect(result.meta.globalItemsTotal).toBe(0);
	});

	it('非规则区块和复习提醒被预算省略时写入 diagnostics', () => {
		db.prepare(`
			INSERT INTO vault_index(file_path,title,type,status,category,modified_at,entity_id)
			VALUES ('20_项目/a.md','项目甲','project','active','learning','2026-07-21','project-a')
		`).run();
		db.prepare(`
			INSERT INTO vault_index(file_path,title,type,status,modified_at,entity_id)
			VALUES ('40_知识/a.md','知识甲','note','review','2026-07-21','note-a')
		`).run();
		upsertMemoryItem(db, {
			slotKey: 'profile:work_style',
			content: '偏好完整的结构化说明',
			itemKind: 'profile',
			scope: { type: 'global', key: '' },
		});
		const result = buildLayer0Context(db, '/unused', {
			...BUDGETS,
			layer0_total: 1,
			taskboard_focus: 1,
			userprofile_summary: 1,
		});
		expect(result.meta.warnings).toEqual(
			expect.arrayContaining([
				'TaskBoard 当前焦点已按预算裁剪',
				'UserProfile 速览已按预算裁剪',
				'复习提醒因 Layer 0 总预算被省略',
			]),
		);
	});
});
