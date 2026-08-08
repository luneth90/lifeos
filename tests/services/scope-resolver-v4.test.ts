import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultConfig } from '../../src/config.js';
import { initDb } from '../../src/db/schema.js';
import { upsertMemoryItem } from '../../src/services/memory-items.js';
import { resolveMemoryScopes } from '../../src/services/scope-resolver.js';
import type { MemoryScope } from '../../src/types.js';
import { createTempVault } from '../setup.js';
import type { TempVault } from '../setup.js';

describe('V4 scope resolver', () => {
	let db: Database.Database;
	let vault: TempVault;

	beforeEach(() => {
		vault = createTempVault();
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

	afterEach(() => {
		db.close();
		vault.cleanup();
	});

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

	it('repository 只由配置绑定证明，已有记忆不能让未知仓库变合法', () => {
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
			{ config },
		);
		expect(result.resolvedScopes).toEqual([{ type: 'repository', key: 'repo-config' }]);
		expect(result.unresolvedScopes).toEqual([
			{ scope: { type: 'repository', key: 'repo-memory' }, reason: 'unknown_repository' },
			{ scope: { type: 'repository', key: 'repo-new' }, reason: 'unknown_repository' },
		]);
	});

	it('已安装技能与已配置工具在零记忆时可解析，allowCreate 不能创建未知对象', () => {
		const skillRoot = join(vault.root, '.agents', 'skills', 'translate');
		mkdirSync(skillRoot, { recursive: true });
		writeFileSync(join(skillRoot, 'SKILL.md'), '# translate\n', 'utf-8');
		upsertMemoryItem(db, {
			slotKey: 'skill:language',
			content: '翻译保持术语',
			itemKind: 'rule',
			scope: { type: 'skill', key: 'translate' },
		});
		const requested: MemoryScope[] = [
			{ type: 'skill', key: 'translate' },
			{ type: 'skill', key: 'research' },
			{ type: 'tool', key: 'obsidian' },
			{ type: 'tool', key: 'unknown-tool' },
		];
		const config = new VaultConfig(vault.root);
		const result = resolveMemoryScopes(db, requested, { config });
		expect(result.resolvedScopes).toEqual([
			{ type: 'skill', key: 'translate' },
			{ type: 'tool', key: 'obsidian' },
		]);
		expect(result.unresolvedScopes.map((item) => item.reason)).toEqual([
			'unknown_skill',
			'unknown_tool',
		]);
	});

	it('tool 可通过配置中的命令或技能别名解析为稳定 ID', () => {
		const config = {
			vaultRoot: vault.root,
			repositoryBindings: () => ({}),
			toolBindings: () => ({
				obsidian: { commands: ['obsidian'], skills: ['obsidian-cli'] },
			}),
		} as unknown as VaultConfig;
		const result = resolveMemoryScopes(
			db,
			[
				{ type: 'tool', key: 'obsidian-cli' },
				{ type: 'tool', key: 'obsidian' },
			],
			{ config },
		);
		expect(result.resolvedScopes).toEqual([{ type: 'tool', key: 'obsidian' }]);
		expect(result.unresolvedScopes).toEqual([]);
	});

	it('tool 别名映射存在歧义时拒绝猜测', () => {
		const config = {
			repositoryBindings: () => ({}),
			toolBindings: () => ({
				'obsidian-a': { commands: ['obsidian'], skills: [] },
				'obsidian-b': { commands: ['obsidian'], skills: [] },
			}),
		} as unknown as VaultConfig;
		const result = resolveMemoryScopes(db, [{ type: 'tool', key: 'obsidian' }], {
			config,
		});
		expect(result.resolvedScopes).toEqual([]);
		expect(result.unresolvedScopes).toEqual([
			{
				scope: { type: 'tool', key: 'obsidian' },
				reason: 'ambiguous_tool_alias',
				candidates: ['obsidian-a', 'obsidian-b'],
			},
		]);
	});

	it('tool 单候选别名在对应工具零记忆时仍解析为稳定 ID', () => {
		const config = {
			vaultRoot: vault.root,
			repositoryBindings: () => ({}),
			toolBindings: () => ({
				obsidian: { commands: ['obsidian-cli'], skills: [] },
			}),
		} as unknown as VaultConfig;
		const result = resolveMemoryScopes(db, [{ type: 'tool', key: 'obsidian-cli' }], {
			config,
		});
		expect(result.resolvedScopes).toEqual([{ type: 'tool', key: 'obsidian' }]);
		expect(result.unresolvedScopes).toEqual([]);
	});

	it('非 tool 未绑定 scope 不带 candidates', () => {
		const result = resolveMemoryScopes(db, [{ type: 'project', key: 'missing-project' }]);
		expect(result.unresolvedScopes).toHaveLength(1);
		expect(result.unresolvedScopes[0].candidates).toBeUndefined();
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
