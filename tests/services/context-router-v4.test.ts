import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VaultConfig } from '../../src/config.js';
import { initDb } from '../../src/db/schema.js';
import { buildMemoryContext } from '../../src/services/context-router.js';
import { upsertMemoryItem } from '../../src/services/memory-items.js';
import type { ContextBudgets, MemoryScope } from '../../src/types.js';

const DEFAULT_BUDGETS: ContextBudgets = {
	layer0_total: 1800,
	global_rules: 600,
	userprofile_summary: 200,
	taskboard_focus: 500,
	scoped_context: 1200,
	single_item_max: 220,
};

function config(budgets: Partial<ContextBudgets> = {}): VaultConfig {
	return {
		repositoryBindings: () => ({}),
		contextBudgets: () => ({ ...DEFAULT_BUDGETS, ...budgets }),
	} as unknown as VaultConfig;
}

describe('V4 context router', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = new Database(':memory:');
		initDb(db);
		db.prepare(`
			INSERT INTO vault_index(file_path,title,type,status,entity_id)
			VALUES ('20_项目/主项目.md','主项目','project','active','project-main')
		`).run();
		db.prepare(`
			INSERT INTO vault_index(file_path,title,type,status,entity_id)
			VALUES ('40_知识/概念.md','概念','note','review','note-concept')
		`).run();
	});

	afterEach(() => db.close());

	function put(
		scope: MemoryScope,
		slotKey: string,
		content: string,
		options: {
			itemKind?: 'rule' | 'decision' | 'fact' | 'profile';
			enforcement?: 'hard' | 'soft';
			priority?: number;
			relatedFiles?: string[];
		} = {},
	): void {
		upsertMemoryItem(db, {
			slotKey,
			content,
			itemKind: options.itemKind ?? 'rule',
			scope,
			enforcement: options.enforcement,
			priority: options.priority,
			relatedFiles: options.relatedFiles,
		});
	}

	it('同一 slot 选择最具体 scope，并记录被覆盖条目', () => {
		put({ type: 'global', key: '' }, 'format:depth', '全局简洁');
		put({ type: 'project', key: 'project-main' }, 'format:depth', '项目详细');
		put({ type: 'file', key: 'note-concept' }, 'format:depth', '当前文件完整推导');

		const result = buildMemoryContext(
			db,
			'/unused',
			{
				scopes: [
					{ type: 'project', key: 'project-main' },
					{ type: 'file', key: '40_知识/概念.md' },
				],
				includeGlobal: true,
			},
			{ config: config() },
		);
		expect(result.matchedScopes).toEqual([
			{ type: 'project', key: 'project-main' },
			{ type: 'file', key: 'note-concept' },
		]);
		expect(result.effectiveItems.map((item) => item.content)).toEqual(['当前文件完整推导']);
		expect(result.overriddenItems.map((item) => item.content)).toEqual(['项目详细', '全局简洁']);
	});

	it('全局 hard 规则阻止所有局部同 slot 覆盖', () => {
		put({ type: 'global', key: '' }, 'content:language', '必须使用中文', {
			enforcement: 'hard',
			priority: 100,
		});
		put({ type: 'project', key: 'project-main' }, 'content:language', '本项目使用其他语言');

		const withGlobal = buildMemoryContext(
			db,
			'/unused',
			{
				scopes: [{ type: 'project', key: 'project-main' }],
				includeGlobal: true,
			},
			{ config: config() },
		);
		expect(withGlobal.rules.map((item) => item.content)).toEqual(['必须使用中文']);
		expect(withGlobal.overriddenItems.map((item) => item.content)).toEqual(['本项目使用其他语言']);
		expect(withGlobal.diagnostics.warnings).toContain('全局硬规则已阻止局部覆盖：content:language');

		const scopedOnly = buildMemoryContext(
			db,
			'/unused',
			{ scopes: [{ type: 'project', key: 'project-main' }] },
			{ config: config() },
		);
		expect(scopedOnly.effectiveItems).toEqual([]);
		expect(scopedOnly.overriddenItems).toHaveLength(1);
		expect(scopedOnly.diagnostics.warnings).toHaveLength(1);
	});

	it('只输出 rule、decision、fact，并可关闭 relatedFiles', () => {
		const scope: MemoryScope = { type: 'project', key: 'project-main' };
		put(scope, 'rule:one', '规则', { relatedFiles: ['规则.md'] });
		put(scope, 'decision:one', '决策', { itemKind: 'decision', relatedFiles: ['决策.md'] });
		put(scope, 'fact:one', '事实', { itemKind: 'fact', relatedFiles: ['规则.md', '事实.md'] });
		put(scope, 'profile:one', '画像', { itemKind: 'profile', relatedFiles: ['画像.md'] });

		const included = buildMemoryContext(db, '/unused', { scopes: [scope] }, { config: config() });
		expect(included.rules).toHaveLength(1);
		expect(included.decisions).toHaveLength(1);
		expect(included.facts).toHaveLength(1);
		expect(included.effectiveItems.some((item) => item.itemKind === 'profile')).toBe(false);
		expect(included.relatedFiles).toEqual(['事实.md', '决策.md', '规则.md']);

		const excluded = buildMemoryContext(
			db,
			'/unused',
			{ scopes: [scope], includeRelatedFiles: false },
			{ config: config() },
		);
		expect(excluded.relatedFiles).toEqual([]);
	});

	it('严格执行单条与总 token 预算，并给出遗漏诊断', () => {
		const scope: MemoryScope = { type: 'project', key: 'project-main' };
		put(scope, 'budget:oversized', '很长的内容'.repeat(80), { priority: 100 });
		put(scope, 'budget:first', '第一条短规则', { priority: 90 });
		put(scope, 'budget:second', '第二条短规则', { priority: 80 });
		const result = buildMemoryContext(
			db,
			'/unused',
			{ scopes: [scope], tokenBudget: 24 },
			{ config: config({ single_item_max: 20 }) },
		);
		expect(result.diagnostics.oversizedItems).toEqual(['budget:oversized']);
		expect(result.effectiveItems.map((item) => item.slotKey)).toEqual(['budget:first']);
		expect(result.diagnostics.omittedSlotKeys).toEqual(['budget:second']);
	});

	it('未知 scope 返回稳定空响应与诊断', () => {
		const request = { scopes: [{ type: 'project' as const, key: 'missing' }] };
		const first = buildMemoryContext(db, '/unused', request, { config: config() });
		const second = buildMemoryContext(db, '/unused', request, { config: config() });
		expect(first.text).toBe('');
		expect(first.effectiveItems).toEqual([]);
		expect(first.diagnostics.unresolvedScopes).toEqual([
			{ scope: { type: 'project', key: 'missing' }, reason: 'unknown_project' },
		]);
		expect(first.snapshotId).toBe(second.snapshotId);
	});
});
