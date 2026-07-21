import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	assertProjectMemoryScopesResolveToCatalog,
	reindexAndAssertProjectCatalog,
} from '../../../src/cli/migrations/project-index-consistency.js';
import { VaultConfig } from '../../../src/config.js';
import { initDb } from '../../../src/db/schema.js';
import { indexFiles } from '../../../src/utils/vault-indexer.js';
import { type TempVault, createTempVault, createTestDb, writeTestNote } from '../../setup.js';

describe('升级期项目索引一致性', () => {
	let vault: TempVault;
	let db: Database.Database;
	let config: VaultConfig;

	beforeEach(() => {
		vault = createTempVault();
		db = createTestDb(vault.dbPath);
		initDb(db);
		config = new VaultConfig(vault.root);
	});

	afterEach(() => {
		db.close();
		vault.cleanup();
	});

	it('清除 unchanged 快路径并重索引全部项目主文件，目录 path 不作为文件索引', () => {
		writeTestNote(
			vault.root,
			'20_项目/Alpha.md',
			{ title: 'Alpha', type: 'project', id: 'alpha' },
			'正文',
		);
		writeTestNote(
			vault.root,
			'20_项目/组合/Beta.md',
			{ title: 'Beta', type: 'project', id: 'beta' },
			'正文',
		);
		indexFiles(db, vault.root, ['20_项目/Alpha.md', '20_项目/组合/Beta.md'], config);
		db.prepare("UPDATE vault_index SET type = 'project-doc', entity_id = 'stale' ").run();

		const result = reindexAndAssertProjectCatalog(db, vault.root, config, [
			{ id: 'alpha', paths: ['20_项目/Alpha.md'] },
			{ id: 'beta', paths: ['20_项目/组合/Beta.md', '20_项目/组合'] },
		]);

		expect(result).toEqual({
			reindexed: 2,
			projectFiles: ['20_项目/Alpha.md', '20_项目/组合/Beta.md'],
			directoryPaths: ['20_项目/组合'],
			removedStaleProjectPaths: [],
		});
		expect(
			db.prepare('SELECT file_path, type, entity_id FROM vault_index ORDER BY file_path').all(),
		).toEqual([
			{ file_path: '20_项目/Alpha.md', type: 'project', entity_id: 'alpha' },
			{ file_path: '20_项目/组合/Beta.md', type: 'project', entity_id: 'beta' },
		]);
		expect(db.prepare('SELECT file_path FROM scan_state ORDER BY file_path').all()).toEqual([
			{ file_path: '20_项目/Alpha.md' },
			{ file_path: '20_项目/组合/Beta.md' },
		]);
	});

	it('可在外层事务内执行，并随外层事务整体回滚', () => {
		writeTestNote(
			vault.root,
			'20_项目/Transactional.md',
			{ type: 'project', id: 'transactional' },
			'正文',
		);
		const catalog = [{ id: 'transactional', paths: ['20_项目/Transactional.md'] }];
		const outer = db.transaction(() => {
			expect(db.inTransaction).toBe(true);
			expect(reindexAndAssertProjectCatalog(db, vault.root, config, catalog).reindexed).toBe(1);
			expect(db.inTransaction).toBe(true);
			throw new Error('触发外层回滚');
		});

		expect(() => outer()).toThrow(/触发外层回滚/);
		expect(db.prepare('SELECT COUNT(*) AS count FROM vault_index').get()).toEqual({ count: 0 });
		expect(db.prepare('SELECT COUNT(*) AS count FROM scan_state').get()).toEqual({ count: 0 });
	});

	it('计划 id 与 Markdown 不一致时严格失败并回滚 scan_state 与索引写入', () => {
		writeTestNote(vault.root, '20_项目/Mismatch.md', { type: 'project', id: 'actual-id' }, '正文');
		db.prepare(
			`INSERT INTO scan_state
			(file_path, last_seen_hash, last_seen_mtime, last_seen_size, last_indexed_at)
			VALUES (?, ?, ?, ?, ?)`,
		).run('20_项目/Mismatch.md', 'sentinel', 1, 2, '2026-01-01T00:00:00.000Z');

		expect(() =>
			reindexAndAssertProjectCatalog(db, vault.root, config, [
				{ id: 'planned-id', paths: ['20_项目/Mismatch.md'] },
			]),
		).toThrow(/索引 id 与计划不一致/);
		expect(db.prepare('SELECT COUNT(*) AS count FROM vault_index').get()).toEqual({ count: 0 });
		expect(db.prepare('SELECT * FROM scan_state').get()).toMatchObject({
			file_path: '20_项目/Mismatch.md',
			last_seen_hash: 'sentinel',
		});
	});

	it('项目 entity_id 必须在整个 vault_index 中唯一', () => {
		writeTestNote(vault.root, '20_项目/Unique.md', { type: 'project', id: 'shared-id' }, '正文');
		writeTestNote(vault.root, '00_草稿/冲突.md', { type: 'draft', id: 'shared-id' }, '正文');
		indexFiles(db, vault.root, ['00_草稿/冲突.md'], config);

		expect(() =>
			reindexAndAssertProjectCatalog(db, vault.root, config, [
				{ id: 'shared-id', paths: ['20_项目/Unique.md'] },
			]),
		).toThrow(/entity_id 不唯一/);
		expect(db.prepare('SELECT file_path FROM vault_index ORDER BY file_path').all()).toEqual([
			{ file_path: '00_草稿/冲突.md' },
		]);
	});

	it('拒绝重复 id、多个主文件、外部路径和非项目目录路径', () => {
		writeTestNote(vault.root, '20_项目/A.md', { type: 'project', id: 'a' });
		writeTestNote(vault.root, '20_项目/B.md', { type: 'project', id: 'b' });
		writeTestNote(vault.root, '00_草稿/Outside.md', { type: 'project', id: 'outside' });
		mkdirSync(join(vault.root, '20_项目', '目录'), { recursive: true });

		expect(() =>
			reindexAndAssertProjectCatalog(db, vault.root, config, [
				{ id: 'same', paths: ['20_项目/A.md'] },
				{ id: 'same', paths: ['20_项目/B.md'] },
			]),
		).toThrow(/id 重复/);
		expect(() =>
			reindexAndAssertProjectCatalog(db, vault.root, config, [
				{ id: 'multi', paths: ['20_项目/A.md', '20_项目/B.md'] },
			]),
		).toThrow(/只能声明一个项目主文件/);
		expect(() =>
			reindexAndAssertProjectCatalog(db, vault.root, config, [
				{ id: 'absolute', paths: [join(vault.root, '20_项目/A.md')] },
			]),
		).toThrow(/Vault 相对路径/);
		expect(() =>
			reindexAndAssertProjectCatalog(db, vault.root, config, [
				{ id: 'outside', paths: ['00_草稿/Outside.md'] },
			]),
		).toThrow(/不在项目目录内/);
	});

	it('清理 catalog 外陈旧项目行及其 scan_state，形成当前项目索引闭包', () => {
		writeTestNote(vault.root, '20_项目/目录/Project.md', {
			type: 'project',
			id: 'directory-project',
		});
		indexFiles(db, vault.root, ['20_项目/目录/Project.md'], config);
		db.prepare(
			`INSERT INTO vault_index (file_path, title, type, status, entity_id)
			 VALUES (?, ?, ?, ?, ?)`,
		).run('20_项目/目录', '错误目录行', 'project', 'active', 'wrong-directory-row');
		db.prepare(
			`INSERT INTO scan_state
			 (file_path, last_seen_hash, last_seen_mtime, last_seen_size, last_indexed_at)
			 VALUES (?, ?, ?, ?, ?)`,
		).run('20_项目/目录', 'stale', 1, 1, '2026-01-01T00:00:00.000Z');

		const result = reindexAndAssertProjectCatalog(db, vault.root, config, [
			{
				id: 'directory-project',
				paths: ['20_项目/目录/Project.md', '20_项目/目录'],
			},
		]);

		expect(result.removedStaleProjectPaths).toEqual(['20_项目/目录']);
		expect(db.prepare("SELECT file_path FROM vault_index WHERE type = 'project'").all()).toEqual([
			{ file_path: '20_项目/目录/Project.md' },
		]);
		expect(db.prepare('SELECT 1 FROM scan_state WHERE file_path = ?').get('20_项目/目录')).toBe(
			undefined,
		);
	});

	it('project scope 只能解析到当前 catalog 中仍存在的项目主文件', () => {
		writeTestNote(vault.root, '20_项目/Current.md', {
			type: 'project',
			id: 'current-project',
		});
		const catalog = [{ id: 'current-project', paths: ['20_项目/Current.md'] }];
		reindexAndAssertProjectCatalog(db, vault.root, config, catalog);
		db.prepare(
			`INSERT INTO memory_items(
				slot_key, content, item_kind, scope_type, scope_key, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		).run(
			'project:deleted',
			'仍引用已删除项目',
			'decision',
			'project',
			'deleted-project',
			'2026-01-01T00:00:00.000Z',
			'2026-01-01T00:00:00.000Z',
		);

		expect(() =>
			assertProjectMemoryScopesResolveToCatalog(db, vault.root, config, catalog),
		).toThrow(/当前项目 catalog 不存在/);
	});
});
