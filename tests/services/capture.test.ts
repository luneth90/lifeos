import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetDefaultInstance } from '../../src/config.js';
import { initDb } from '../../src/db/schema.js';
import { notifyFileChanged, notifyFilesChanged } from '../../src/services/capture.js';
import { createTempVault, createTestDb, writeTestNote } from '../setup.js';
import type { TempVault } from '../setup.js';

describe('V4 文件变更通知', () => {
	let db: Database.Database;
	let vault: TempVault;

	beforeEach(() => {
		vault = createTempVault();
		db = createTestDb(vault.dbPath);
		initDb(db);
		_resetDefaultInstance();
	});

	afterEach(() => {
		db.close();
		vault.cleanup();
		_resetDefaultInstance();
	});

	it('索引单文件并返回精确影响范围', () => {
		writeTestNote(
			vault.root,
			'20_项目/代数.md',
			{
				id: 'project-algebra',
				title: '代数学习',
				type: 'project',
				category: 'learning',
				status: 'active',
			},
			'学习群论。',
		);
		const result = notifyFileChanged(db, vault.root, '20_项目/代数.md');
		expect(result).toMatchObject({
			action: 'indexed',
			filePath: '20_项目/代数.md',
			impact: {
				vaultIndexChanged: true,
				taskboardChanged: true,
				profileChanged: true,
				changedEntityIds: ['project-algebra'],
			},
		});
		expect(result.impact.affectedScopes).toEqual(
			expect.arrayContaining([
				{ type: 'file', key: 'project-algebra' },
				{ type: 'project', key: 'project-algebra' },
			]),
		);
	});

	it('未变化文件返回 unchanged 与空影响', () => {
		writeTestNote(vault.root, '00_草稿/想法.md', {
			id: 'draft-idea',
			title: '想法',
			type: 'draft',
			status: 'pending',
		});
		notifyFileChanged(db, vault.root, '00_草稿/想法.md');
		const result = notifyFileChanged(db, vault.root, '00_草稿/想法.md');
		expect(result.action).toBe('unchanged');
		expect(result.impact).toEqual({
			vaultIndexChanged: false,
			backlinksChanged: false,
			taskboardChanged: false,
			profileChanged: false,
			affectedScopes: [],
			changedEntityIds: [],
		});
	});

	it('批量通知在同一事务内索引，并对输入路径去重', () => {
		writeTestNote(vault.root, '00_草稿/甲.md', {
			id: 'draft-a',
			title: '甲',
			type: 'draft',
			status: 'pending',
		});
		writeTestNote(vault.root, '40_知识/乙.md', {
			id: 'note-b',
			title: '乙',
			type: 'note',
			status: 'review',
		});
		const result = notifyFilesChanged(db, vault.root, [
			'40_知识/乙.md',
			'00_草稿/甲.md',
			'40_知识/乙.md',
		]);
		expect(result.results.map((item) => item.filePath)).toEqual(['00_草稿/甲.md', '40_知识/乙.md']);
		expect(result.results.every((item) => item.action === 'indexed')).toBe(true);
		expect(result.impact.taskboardChanged).toBe(true);
		expect(
			(db.prepare('SELECT COUNT(*) AS count FROM vault_index').get() as { count: number }).count,
		).toBe(2);
	});

	it('文件删除后移除索引并保留删除前的 affectedScopes', () => {
		writeTestNote(vault.root, '40_知识/旧笔记.md', {
			id: 'note-old',
			title: '旧笔记',
			type: 'note',
			status: 'review',
		});
		notifyFileChanged(db, vault.root, '40_知识/旧笔记.md');
		unlinkSync(join(vault.root, '40_知识/旧笔记.md'));
		const result = notifyFileChanged(db, vault.root, '40_知识/旧笔记.md');
		expect(result.action).toBe('removed');
		expect(result.impact.affectedScopes).toContainEqual({ type: 'file', key: 'note-old' });
		expect(db.prepare('SELECT * FROM vault_index').all()).toEqual([]);
	});

	it('越界路径转换为结构化 error，不把异常传播给调用方', () => {
		const result = notifyFileChanged(db, vault.root, '../outside.md');
		expect(result.action).toBe('error');
		expect(result.filePath).toBe('../outside.md');
		expect(result.reason).toMatch(/不在 Vault 内/);
		expect(result.impact.vaultIndexChanged).toBe(false);
	});
});
