import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetDefaultInstance } from '../../src/config.js';
import { initDb } from '../../src/db/schema.js';
import { notifyFileChanged, notifyFilesChanged } from '../../src/services/capture.js';
import { upsertMemoryItem } from '../../src/services/memory-items.js';
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

	it('移动到系统归档目录时移除旧索引并迁移路径记忆', () => {
		const source = '10_日记/2026-07-01.md';
		const target = '90_系统/归档/日记/2026/07/2026-07-01.md';
		writeTestNote(vault.root, source, {
			id: 'daily-2026-07-01',
			title: '2026-07-01',
			type: 'note',
		});
		notifyFileChanged(db, vault.root, source);
		upsertMemoryItem(db, {
			slotKey: 'file:daily-path',
			content: '关联旧日记路径',
			itemKind: 'fact',
			scope: { type: 'file', key: source },
			relatedFiles: [source],
		});
		mkdirSync(join(vault.root, '90_系统/归档/日记/2026/07'), { recursive: true });
		renameSync(join(vault.root, source), join(vault.root, target));

		const result = notifyFileChanged(db, vault.root, target, source);

		expect(result).toMatchObject({
			action: 'skipped',
			filePath: target,
			previousFilePath: source,
			reason: 'excluded by scan rules',
		});
		expect(db.prepare('SELECT file_path FROM vault_index').all()).toEqual([]);
		const memory = db
			.prepare(`
				SELECT scope_key, related_files
				FROM memory_items
				WHERE slot_key = 'file:daily-path'
			`)
			.get() as { scope_key: string; related_files: string };
		expect(memory.scope_key).toBe(target);
		expect(JSON.parse(memory.related_files)).toEqual([target]);
	});

	it('可索引目录之间移动时索引新路径并将文件作用域规范化为唯一 ID', () => {
		const source = '40_知识/旧名.md';
		const target = '40_知识/新名.md';
		writeTestNote(vault.root, source, {
			id: 'note-renamed',
			title: '重命名笔记',
			type: 'knowledge',
			status: 'review',
		});
		notifyFileChanged(db, vault.root, source);
		upsertMemoryItem(db, {
			slotKey: 'file:renamed-path',
			content: '关联旧知识笔记路径',
			itemKind: 'fact',
			scope: { type: 'file', key: source },
			relatedFiles: [source],
		});
		renameSync(join(vault.root, source), join(vault.root, target));

		const result = notifyFileChanged(db, vault.root, target, source);

		expect(result).toMatchObject({
			action: 'indexed',
			filePath: target,
			previousFilePath: source,
		});
		expect(db.prepare('SELECT file_path FROM vault_index').all()).toEqual([{ file_path: target }]);
		const memory = db
			.prepare(`
				SELECT scope_key, related_files
				FROM memory_items
				WHERE slot_key = 'file:renamed-path'
			`)
			.get() as { scope_key: string; related_files: string };
		expect(memory.scope_key).toBe('note-renamed');
		expect(JSON.parse(memory.related_files)).toEqual([target]);
	});

	it('移动到可索引目录但目标无有效 Frontmatter 时保持失败关闭', () => {
		const source = '40_知识/有效来源.md';
		const target = '40_知识/无效目标.md';
		writeTestNote(vault.root, source, {
			id: 'note-invalid-target',
			title: '有效来源',
			type: 'knowledge',
			status: 'review',
		});
		notifyFileChanged(db, vault.root, source);
		renameSync(join(vault.root, source), join(vault.root, target));
		writeFileSync(join(vault.root, target), '# 无 Frontmatter\n', 'utf8');

		const result = notifyFileChanged(db, vault.root, target, source);

		expect(result.action).toBe('error');
		expect(result.reason).toContain('移动后的文件未进入索引');
	});

	it('越界路径转换为结构化 error，不把异常传播给调用方', () => {
		const result = notifyFileChanged(db, vault.root, '../outside.md');
		expect(result.action).toBe('error');
		expect(result.filePath).toBe('../outside.md');
		expect(result.reason).toMatch(/不在 Vault 内/);
		expect(result.impact.vaultIndexChanged).toBe(false);
	});
});
