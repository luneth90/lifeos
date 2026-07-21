import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VaultConfig } from '../../src/config.js';
import { initDb } from '../../src/db/schema.js';
import { upsertMemoryItem } from '../../src/services/memory-items.js';
import { resolveMemoryScopes } from '../../src/services/scope-resolver.js';
import type { MemoryScope } from '../../src/types.js';

describe('V4 scope resolver', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = new Database(':memory:');
		initDb(db);
		db.prepare(`
			INSERT INTO vault_index(file_path,title,type,status,entity_id)
			VALUES (?,?,?,?,?)
		`).run('20_项目/代数.md', '代数学习', 'project', 'active', 'project-algebra');
		db.prepare(`
			INSERT INTO vault_index(file_path,title,type,status,entity_id)
			VALUES (?,?,?,?,?)
		`).run('40_知识/群论.md', '群论', 'note', 'review', 'note-group');
	});

	afterEach(() => db.close());

	it('项目仅按稳定 entity_id 解析，不按标题或路径猜测', () => {
		const result = resolveMemoryScopes(db, [
			{ type: 'project', key: 'project-algebra' },
			{ type: 'project', key: '代数学习' },
			{ type: 'project', key: '20_项目/代数.md' },
		]);
		expect(result.resolvedScopes).toEqual([{ type: 'project', key: 'project-algebra' }]);
		expect(result.unresolvedScopes).toEqual([
			{ scope: { type: 'project', key: '代数学习' }, reason: 'unknown_project' },
			{ scope: { type: 'project', key: '20_项目/代数.md' }, reason: 'unknown_project' },
		]);
	});

	it('文件路径规范化为 entity_id，并按规范身份去重', () => {
		const result = resolveMemoryScopes(db, [
			{ type: 'file', key: '40_知识/群论.md' },
			{ type: 'file', key: 'note-group' },
			{ type: 'file', key: ' note-group ' },
		]);
		expect(result.resolvedScopes).toEqual([{ type: 'file', key: 'note-group' }]);
		expect(result.unresolvedScopes).toEqual([]);
	});

	it('repository 可由配置绑定或已有记忆证明，未知仓库不自动创建', () => {
		upsertMemoryItem(db, {
			slotKey: 'repo:rule',
			content: '仓库规则',
			itemKind: 'rule',
			scope: { type: 'repository', key: 'repo-memory' },
		});
		const config = {
			repositoryBindings: () => ({ 'repo-config': ['/workspace/repo'] }),
		} as unknown as VaultConfig;
		const result = resolveMemoryScopes(
			db,
			[
				{ type: 'repository', key: 'repo-config' },
				{ type: 'repository', key: 'repo-memory' },
				{ type: 'repository', key: 'repo-new' },
			],
			{ config, allowCreate: true },
		);
		expect(result.resolvedScopes).toEqual([
			{ type: 'repository', key: 'repo-config' },
			{ type: 'repository', key: 'repo-memory' },
		]);
		expect(result.unresolvedScopes[0]).toEqual({
			scope: { type: 'repository', key: 'repo-new' },
			reason: 'unknown_repository',
		});
	});

	it('skill 与 tool 默认要求已有 active 记忆，allowCreate 时可显式创建', () => {
		upsertMemoryItem(db, {
			slotKey: 'skill:language',
			content: '翻译保持术语',
			itemKind: 'rule',
			scope: { type: 'skill', key: 'translate' },
		});
		const requested: MemoryScope[] = [
			{ type: 'skill', key: 'translate' },
			{ type: 'skill', key: 'research' },
			{ type: 'tool', key: 'obsidian-cli' },
		];
		expect(resolveMemoryScopes(db, requested).resolvedScopes).toEqual([
			{ type: 'skill', key: 'translate' },
		]);
		expect(resolveMemoryScopes(db, requested, { allowCreate: true }).resolvedScopes).toEqual(
			requested,
		);
	});

	it('global 只接受空 key，并对无效 scope 返回诊断而非抛错', () => {
		const invalidType = { type: 'unknown', key: 'x' } as unknown as MemoryScope;
		const result = resolveMemoryScopes(db, [
			{ type: 'global', key: '' },
			{ type: 'global', key: 'not-empty' },
			{ type: 'file', key: '' },
			invalidType,
		]);
		expect(result.resolvedScopes).toEqual([{ type: 'global', key: '' }]);
		expect(result.unresolvedScopes).toHaveLength(3);
		expect(result.unresolvedScopes.map((item) => item.reason)).toEqual([
			'invalid_scope',
			'invalid_scope',
			'invalid_scope',
		]);
	});
});
