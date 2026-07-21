import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetDefaultInstance } from '../../src/config.js';
import { initDb } from '../../src/db/schema.js';
import { upsertMemoryItem } from '../../src/services/memory-items.js';
import { runStartup, runStartupMaintenance } from '../../src/services/startup.js';
import { createTempVault, createTestDb, writeTestNote } from '../setup.js';
import type { TempVault } from '../setup.js';

describe('V4 启动路径', () => {
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

	it('快速启动不全量扫描、不刷新 active docs，只读取现有索引', () => {
		writeTestNote(vault.root, '20_项目/尚未索引.md', {
			id: 'project-unindexed',
			title: '尚未索引',
			type: 'project',
			status: 'active',
		});
		const taskboard = join(vault.root, '90_系统', '记忆', 'TaskBoard.md');
		const userprofile = join(vault.root, '90_系统', '记忆', 'UserProfile.md');

		const result = runStartup(db, vault.root);

		expect(result.vaultStats).toEqual({
			totalFiles: 0,
			updatedSinceLast: 0,
			unchanged: 0,
			removed: 0,
			maintenancePending: true,
		});
		expect(db.prepare('SELECT * FROM vault_index').all()).toEqual([]);
		expect(existsSync(taskboard)).toBe(false);
		expect(existsSync(userprofile)).toBe(false);
	});

	it('从现有索引和 active memory 返回 scopeHints 与 Layer 0', () => {
		db.prepare(`
			INSERT INTO vault_index(file_path,title,type,status,entity_id)
			VALUES ('20_项目/代数.md','代数学习','project','active','project-algebra')
		`).run();
		upsertMemoryItem(db, {
			slotKey: 'content:language',
			content: '必须使用中文',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
			enforcement: 'hard',
		});
		upsertMemoryItem(db, {
			slotKey: 'skill:terminology',
			content: '保持术语一致',
			itemKind: 'rule',
			scope: { type: 'skill', key: 'translate' },
		});

		const result = runStartup(db, vault.root);
		expect(result.scopeHints).toEqual({
			availableProjects: ['project-algebra'],
			availableSkills: ['translate'],
		});
		expect(result.vaultStats.totalFiles).toBe(1);
		expect(result.layer0.text).toContain('必须使用中文');
		expect(result.layer0.text).not.toContain('保持术语一致');
		expect(result.layer0.snapshotId).toMatch(/^ctx-[0-9a-f]{20}$/);
	});

	it('快速启动同步失效过期条目，但不删除历史记录', () => {
		const item = upsertMemoryItem(db, {
			slotKey: 'temporary:old',
			content: '旧临时约束',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
			expiresAt: '2000-01-01T00:00:00.000Z',
		});

		runStartup(db, vault.root);
		const row = db
			.prepare('SELECT status FROM memory_items WHERE item_id = ?')
			.get(item.itemId) as {
			status: string;
		};
		expect(row.status).toBe('expired');
		expect(db.prepare('SELECT COUNT(*) AS count FROM memory_items').get()).toEqual({ count: 1 });
	});
});

describe('V4 启动维护路径', () => {
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

	it('全量维护负责索引并原子刷新两个 active docs', () => {
		writeTestNote(
			vault.root,
			'20_项目/代数.md',
			{
				id: 'project-algebra',
				title: '代数学习',
				type: 'project',
				category: 'learning',
				status: 'active',
				domain: '数学',
			},
			'研究群论结构。',
		);

		const result = runStartupMaintenance(db, vault.root);
		expect(result.vaultStats).toMatchObject({
			totalFiles: 1,
			updatedSinceLast: 1,
			unchanged: 0,
			removed: 0,
			maintenancePending: false,
		});
		expect(result.activeDocs.map((item) => item.target)).toEqual(['TaskBoard', 'UserProfile']);
		expect(result.activeDocs.every((item) => item.changed && existsSync(item.path))).toBe(true);
		expect(result.impact).toMatchObject({ taskboardChanged: true, profileChanged: true });
		expect(result.impact.affectedScopes).toEqual(
			expect.arrayContaining([
				{ type: 'file', key: 'project-algebra' },
				{ type: 'project', key: 'project-algebra' },
			]),
		);
	});

	it('无文件变化时报告 unchanged，且不重写 active docs', () => {
		writeTestNote(vault.root, '00_草稿/想法.md', {
			id: 'draft-idea',
			title: '想法',
			type: 'draft',
			status: 'pending',
		});
		runStartupMaintenance(db, vault.root);
		const second = runStartupMaintenance(db, vault.root);
		expect(second.vaultStats).toMatchObject({
			updatedSinceLast: 0,
			unchanged: 1,
			removed: 0,
			maintenancePending: false,
		});
		expect(second.activeDocs.every((item) => item.changed === false)).toBe(true);
		expect(second.impact).toEqual({
			taskboardChanged: false,
			profileChanged: false,
			affectedScopes: [],
		});
	});
});
