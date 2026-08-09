import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultConfig, _resetDefaultInstance, getOrCreateVaultConfig } from '../../src/config.js';
import { initDb } from '../../src/db/schema.js';
import { notifyFileChanged, notifyFilesChanged } from '../../src/services/capture.js';
import { getMemoryHistory } from '../../src/services/memory-history.js';
import { getMemoryItemById, upsertMemoryItem } from '../../src/services/memory-items.js';
import { resolveMemoryScopes } from '../../src/services/scope-resolver.js';
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

	it('无操作移动产生的作用域不会污染后续未变化通知', () => {
		const filePath = '40_知识/稳定笔记.md';
		writeTestNote(vault.root, filePath, {
			id: 'note-stable',
			title: '稳定笔记',
			type: 'knowledge',
			status: 'review',
		});
		notifyFileChanged(db, vault.root, filePath);

		const moved = notifyFileChanged(db, vault.root, filePath, filePath);
		try {
			expect(moved.action).toBe('unchanged');
			expect(moved.impact.affectedScopes).toEqual(
				expect.arrayContaining([
					{ type: 'file', key: filePath },
					{ type: 'file', key: 'note-stable' },
				]),
			);

			const unchanged = notifyFileChanged(db, vault.root, filePath);
			expect(unchanged.action).toBe('unchanged');
			expect(unchanged.impact.affectedScopes).toEqual([]);
		} finally {
			moved.impact.affectedScopes.length = 0;
			moved.impact.changedEntityIds.length = 0;
		}
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

	it('移动到系统归档目录时移除旧索引并迁移真实规范化文件记忆', () => {
		const source = '10_日记/2026-07-01.md';
		const target = '90_系统/归档/日记/2026/07/2026-07-01.md';
		writeTestNote(vault.root, source, {
			id: 'daily-2026-07-01',
			title: '2026-07-01',
			type: 'note',
		});
		notifyFileChanged(db, vault.root, source);
		const config = getOrCreateVaultConfig(vault.root);
		const sourceScope = resolveMemoryScopes(db, [{ type: 'file', key: source }], {
			config,
			allowCreate: true,
		}).resolvedScopes[0];
		expect(sourceScope).toEqual({ type: 'file', key: 'daily-2026-07-01' });
		if (!sourceScope) throw new Error('测试前置失败：来源文件作用域未解析');
		upsertMemoryItem(db, {
			slotKey: 'file:daily-path',
			content: '关联旧日记路径',
			itemKind: 'fact',
			scope: sourceScope,
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
				SELECT scope_key, content, related_files
				FROM memory_items
				WHERE slot_key = 'file:daily-path'
			`)
			.get() as { scope_key: string; content: string; related_files: string };
		expect(memory.scope_key).toBe(target);
		expect(memory.content).toBe('关联旧日记路径');
		expect(JSON.parse(memory.related_files)).toEqual([target]);
		expect(resolveMemoryScopes(db, [{ type: 'file', key: target }], { config })).toEqual({
			resolvedScopes: [],
			unresolvedScopes: [{ scope: { type: 'file', key: target }, reason: 'unknown_file' }],
		});
	});

	it('排除目录中的普通文件没有既有记忆时仍不能新建文件作用域', () => {
		const target = '90_系统/归档/日记/2026/07/2026-07-04.md';
		writeTestNote(vault.root, target, {
			id: 'daily-2026-07-04',
			title: '2026-07-04',
			type: 'note',
		});
		const resolution = resolveMemoryScopes(db, [{ type: 'file', key: target }], {
			config: getOrCreateVaultConfig(vault.root),
			allowCreate: true,
		});

		expect(resolution.resolvedScopes).toEqual([]);
		expect(resolution.unresolvedScopes).toEqual([
			{ scope: { type: 'file', key: target }, reason: 'unknown_file' },
		]);
	});

	it('排除目标存在陈旧索引与扫描状态时一并清除', () => {
		const source = '10_日记/2026-07-02.md';
		const target = '90_系统/归档/日记/2026/07/2026-07-02.md';
		const permissiveConfig = new VaultConfig(vault.root, {
			memory: {
				scan_prefixes: [
					'drafts',
					'diary',
					'projects',
					'research',
					'knowledge',
					'outputs',
					'plans',
					'resources',
					'reflection',
					'system',
				],
				excluded_prefixes: [],
			},
		});
		writeTestNote(vault.root, target, {
			id: 'stale-archive-target',
			title: '陈旧归档目标',
			type: 'note',
		});
		expect(notifyFileChanged(db, vault.root, target, undefined, permissiveConfig).action).toBe(
			'indexed',
		);
		unlinkSync(join(vault.root, target));
		writeTestNote(vault.root, source, {
			id: 'daily-2026-07-02',
			title: '2026-07-02',
			type: 'note',
		});
		notifyFileChanged(db, vault.root, source);
		renameSync(join(vault.root, source), join(vault.root, target));

		const result = notifyFileChanged(db, vault.root, target, source);

		expect(result).toMatchObject({
			action: 'skipped',
			reason: 'excluded by scan rules',
		});
		expect(db.prepare('SELECT 1 FROM vault_index WHERE file_path = ?').get(target)).toBeUndefined();
		expect(db.prepare('SELECT 1 FROM scan_state WHERE file_path = ?').get(target)).toBeUndefined();
	});

	it('排除目标仅残留孤立扫描状态时仍会清除', () => {
		const target = '90_系统/归档/日记/2026/07/2026-07-05.md';
		writeTestNote(vault.root, target, {
			id: 'daily-2026-07-05',
			title: '2026-07-05',
			type: 'note',
		});
		db.prepare(`
			INSERT INTO scan_state(
				file_path, last_seen_hash, last_seen_mtime, last_seen_size, last_indexed_at
			) VALUES (?, ?, ?, ?, ?)
		`).run(target, 'stale-hash', 1, 1, new Date(0).toISOString());
		expect(db.prepare('SELECT 1 FROM vault_index WHERE file_path = ?').get(target)).toBeUndefined();

		const result = notifyFileChanged(db, vault.root, target);

		expect(result).toMatchObject({
			action: 'skipped',
			reason: 'excluded by scan rules',
		});
		expect(db.prepare('SELECT 1 FROM scan_state WHERE file_path = ?').get(target)).toBeUndefined();
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
		const created = upsertMemoryItem(db, {
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
		const history = getMemoryHistory(db, { itemId: created.itemId }).events;
		expect(history).toHaveLength(2);
		const movedEvent = history.at(-1);
		expect(movedEvent).toMatchObject({
			eventType: 'reclassify',
			actor: 'service:capture',
			reason: `文件移动同步：${source} -> ${target}`,
			correlationId: expect.stringContaining(`memory-notify:move:${source}:${target}:`),
			before: {
				scope: { type: 'file', key: source },
				relatedFiles: [source],
			},
			after: {
				scope: { type: 'file', key: 'note-renamed' },
				relatedFiles: [target],
			},
		});
		expect(movedEvent?.after).toEqual(getMemoryItemById(db, created.itemId));
	});

	it('移动会为仅 relatedFiles 变化的非文件作用域条目记录 update 事件', () => {
		const source = '40_知识/关联来源.md';
		const target = '40_知识/关联目标.md';
		writeTestNote(vault.root, source, {
			id: 'related-source',
			title: '关联来源',
			type: 'knowledge',
			status: 'review',
		});
		notifyFileChanged(db, vault.root, source);
		const created = upsertMemoryItem(db, {
			slotKey: 'project:related-path',
			content: '项目关联文件',
			itemKind: 'fact',
			scope: { type: 'project', key: 'project-related' },
			relatedFiles: [source, '40_知识/保留.md'],
		});
		renameSync(join(vault.root, source), join(vault.root, target));

		expect(notifyFileChanged(db, vault.root, target, source).action).toBe('indexed');

		const event = getMemoryHistory(db, { itemId: created.itemId }).events.at(-1);
		expect(event).toMatchObject({
			eventType: 'update',
			actor: 'service:capture',
			reason: `文件移动同步：${source} -> ${target}`,
			correlationId: expect.stringContaining(`memory-notify:move:${source}:${target}:`),
			before: {
				scope: { type: 'project', key: 'project-related' },
				relatedFiles: [source, '40_知识/保留.md'],
			},
			after: {
				scope: { type: 'project', key: 'project-related' },
				relatedFiles: [target, '40_知识/保留.md'],
			},
		});
		expect(event?.after).toEqual(getMemoryItemById(db, created.itemId));
	});

	it('移动事件写入失败时回滚投影、索引与扫描状态', () => {
		const source = '40_知识/事务来源.md';
		const target = '40_知识/事务目标.md';
		writeTestNote(vault.root, source, {
			id: 'transactional-move',
			title: '事务来源',
			type: 'knowledge',
			status: 'review',
		});
		notifyFileChanged(db, vault.root, source);
		const created = upsertMemoryItem(db, {
			slotKey: 'file:transactional-move',
			content: '移动事务回归',
			itemKind: 'fact',
			scope: { type: 'file', key: source },
			relatedFiles: [source],
		});
		const projectionBefore = db
			.prepare('SELECT * FROM memory_items WHERE item_id = ?')
			.get(created.itemId);
		const indexBefore = db.prepare('SELECT * FROM vault_index ORDER BY file_path').all();
		const scanBefore = db.prepare('SELECT * FROM scan_state ORDER BY file_path').all();
		const eventsBefore = db.prepare('SELECT * FROM memory_item_events ORDER BY event_id').all();
		db.exec(`
			CREATE TRIGGER fail_capture_move_event
			BEFORE INSERT ON memory_item_events
			WHEN NEW.actor = 'service:capture'
			BEGIN
				SELECT RAISE(ABORT, '模拟移动事件写入失败');
			END
		`);
		renameSync(join(vault.root, source), join(vault.root, target));

		const result = notifyFileChanged(db, vault.root, target, source);

		expect(result.action).toBe('error');
		expect(result.reason).toContain('模拟移动事件写入失败');
		expect(db.prepare('SELECT * FROM memory_items WHERE item_id = ?').get(created.itemId)).toEqual(
			projectionBefore,
		);
		expect(db.prepare('SELECT * FROM vault_index ORDER BY file_path').all()).toEqual(indexBefore);
		expect(db.prepare('SELECT * FROM scan_state ORDER BY file_path').all()).toEqual(scanBefore);
		expect(db.prepare('SELECT * FROM memory_item_events ORDER BY event_id').all()).toEqual(
			eventsBefore,
		);
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

	it('可索引目标本次读取失败时不接受陈旧索引行', () => {
		const source = '40_知识/读取失败来源.md';
		const target = '40_知识/读取失败目标.md';
		writeTestNote(vault.root, source, {
			id: 'note-read-source',
			title: '读取失败来源',
			type: 'knowledge',
			status: 'review',
		});
		writeTestNote(vault.root, target, {
			id: 'note-stale-target',
			title: '读取失败目标',
			type: 'knowledge',
			status: 'review',
		});
		notifyFileChanged(db, vault.root, source);
		notifyFileChanged(db, vault.root, target);
		unlinkSync(join(vault.root, source));
		unlinkSync(join(vault.root, target));
		mkdirSync(join(vault.root, target));

		const result = notifyFileChanged(db, vault.root, target, source);

		expect(result.action).toBe('error');
		expect(result.reason).toContain('移动后的文件未进入索引');
	});

	it('重复实体 ID 的活跃目录移动继续使用路径文件作用域', () => {
		const source = '40_知识/重复来源.md';
		const sibling = '40_知识/重复同伴.md';
		const target = '40_知识/重复目标.md';
		for (const path of [source, sibling]) {
			writeTestNote(vault.root, path, {
				id: 'duplicate-note-id',
				title: path,
				type: 'knowledge',
				status: 'review',
			});
			notifyFileChanged(db, vault.root, path);
		}
		const config = getOrCreateVaultConfig(vault.root);
		const sourceScope = resolveMemoryScopes(db, [{ type: 'file', key: source }], {
			config,
		}).resolvedScopes[0];
		expect(sourceScope).toEqual({ type: 'file', key: source });
		if (!sourceScope) throw new Error('测试前置失败：重复 ID 来源作用域未解析');
		upsertMemoryItem(db, {
			slotKey: 'file:duplicate-path',
			content: '重复 ID 来源记忆',
			itemKind: 'fact',
			scope: sourceScope,
			relatedFiles: [source],
		});
		renameSync(join(vault.root, source), join(vault.root, target));

		const result = notifyFileChanged(db, vault.root, target, source);

		expect(result.action).toBe('indexed');
		expect(
			db
				.prepare(
					"SELECT scope_key, related_files FROM memory_items WHERE slot_key = 'file:duplicate-path'",
				)
				.get(),
		).toEqual({ scope_key: target, related_files: JSON.stringify([target]) });
	});

	it('文件作用域合并出现同 slot 冲突时失败关闭并回滚索引', () => {
		const source = '10_日记/2026-07-03.md';
		const target = '90_系统/归档/日记/2026/07/2026-07-03.md';
		writeTestNote(vault.root, source, {
			id: 'daily-2026-07-03',
			title: '2026-07-03',
			type: 'note',
		});
		notifyFileChanged(db, vault.root, source);
		for (const scopeKey of ['daily-2026-07-03', target]) {
			upsertMemoryItem(db, {
				slotKey: 'file:conflict',
				content: `作用域 ${scopeKey}`,
				itemKind: 'fact',
				scope: { type: 'file', key: scopeKey },
			});
		}
		mkdirSync(join(vault.root, '90_系统/归档/日记/2026/07'), { recursive: true });
		renameSync(join(vault.root, source), join(vault.root, target));

		const result = notifyFileChanged(db, vault.root, target, source);

		expect(result.action).toBe('error');
		expect(result.reason).toContain('移动后的文件记忆作用域冲突');
		expect(db.prepare('SELECT file_path FROM vault_index ORDER BY file_path').all()).toEqual([
			{ file_path: source },
		]);
	});

	it('越界路径转换为结构化 error，不把异常传播给调用方', () => {
		const result = notifyFileChanged(db, vault.root, '../outside.md');
		expect(result.action).toBe('error');
		expect(result.filePath).toBe('../outside.md');
		expect(result.reason).toMatch(/不在 Vault 内/);
		expect(result.impact.vaultIndexChanged).toBe(false);
	});
});
