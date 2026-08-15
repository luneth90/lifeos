import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import rules from '../../src/cli/commands/rules.js';
import { _resetDefaultInstance } from '../../src/config.js';
import { RuntimeContractError } from '../../src/runtime-contract.js';
import { upsertMemoryItem } from '../../src/services/memory-items.js';
import { createTempVault, prepareRuntimeVault } from '../setup.js';

describe('lifeos rules 最终 V2/V5 治理契约', () => {
	let vault: ReturnType<typeof createTempVault>;
	let db: Database.Database;
	let logSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(async () => {
		_resetDefaultInstance();
		vault = createTempVault();
		await prepareRuntimeVault(vault);
		db = new Database(vault.dbPath);
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		logSpy.mockRestore();
		db.close();
		_resetDefaultInstance();
		vault.cleanup();
	});

	it('list 使用完整 scope 过滤，同名 slot_key 不跨 scope 混合', async () => {
		upsertMemoryItem(db, {
			slotKey: 'format:latex',
			content: '全局规则',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
		});
		upsertMemoryItem(db, {
			slotKey: 'format:latex',
			content: '复习局部规则',
			itemKind: 'rule',
			scope: { type: 'skill', key: 'revise' },
		});

		const result = (await rules(['list', vault.root, '--scope', 'skill:revise'])) as Array<{
			content: string;
			scope: { type: string; key: string };
		}>;
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			content: '复习局部规则',
			scope: { type: 'skill', key: 'revise' },
		});
	});

	it('classify 必须按 item_id 显式重分类，archive 必须有原因且只软归档', async () => {
		const created = upsertMemoryItem(db, {
			slotKey: 'decision:old',
			content: '使用最终架构',
			itemKind: 'decision',
			scope: { type: 'global', key: '' },
		});
		const classified = (await rules([
			'classify',
			vault.root,
			'--id',
			String(created.itemId),
			'--scope-type',
			'skill',
			'--scope-key',
			'research',
			'--slot-key',
			'decision:research',
		])) as { itemId: number; scope: { type: string; key: string }; slotKey: string };
		expect(classified).toMatchObject({
			itemId: created.itemId,
			scope: { type: 'skill', key: 'research' },
			slotKey: 'decision:research',
		});

		await expect(rules(['archive', vault.root, '--id', String(created.itemId)])).rejects.toThrow(
			/需要 --reason/,
		);
		const archived = (await rules([
			'archive',
			vault.root,
			'--id',
			String(created.itemId),
			'--reason',
			'决策已替代',
		])) as { status: string; archiveReason: string };
		expect(archived).toMatchObject({ status: 'archived', archiveReason: '决策已替代' });

		const restored = (await rules(['restore', vault.root, '--id', String(created.itemId)])) as {
			status: string;
			archiveReason: string | null;
		};
		expect(restored).toMatchObject({ status: 'active', archiveReason: null });
	});

	it('audit 明确报告 project、repository 和 file 孤儿作用域', async () => {
		upsertMemoryItem(db, {
			slotKey: 'fact:project',
			content: '孤儿项目',
			itemKind: 'fact',
			scope: { type: 'project', key: 'missing-project' },
		});
		upsertMemoryItem(db, {
			slotKey: 'fact:repository',
			content: '孤儿仓库',
			itemKind: 'fact',
			scope: { type: 'repository', key: 'missing-repository' },
		});
		upsertMemoryItem(db, {
			slotKey: 'fact:file',
			content: '孤儿文件',
			itemKind: 'fact',
			scope: { type: 'file', key: 'missing.md' },
		});

		const result = (await rules(['audit', vault.root])) as {
			ok: boolean;
			projectOrphans: unknown[];
			repositoryOrphans: unknown[];
			fileOrphans: unknown[];
		};
		expect(result.ok).toBe(false);
		expect(result.projectOrphans).toHaveLength(1);
		expect(result.repositoryOrphans).toHaveLength(1);
		expect(result.fileOrphans).toHaveLength(1);
	});

	it('export 输出最终结构，包含 item_id 与完整 scope', async () => {
		const created = upsertMemoryItem(db, {
			slotKey: 'workflow:test',
			content: '测试规则',
			itemKind: 'rule',
			scope: { type: 'tool', key: 'codex' },
		});
		const output = join(vault.root, 'rules-export.json');
		await rules(['export', vault.root, '--output', output]);
		const exported = JSON.parse(readFileSync(output, 'utf-8')) as Array<Record<string, unknown>>;
		expect(exported).toHaveLength(1);
		expect(exported[0]).toMatchObject({
			itemId: created.itemId,
			slotKey: 'workflow:test',
			scope: { type: 'tool', key: 'codex' },
		});
	});

	it('缺失最终 runtime receipt、非法 scope 和旧命令均直接失败', async () => {
		unlinkSync(join(vault.root, '90_系统', '记忆', 'runtime-receipt.json'));
		await expect(rules(['list', vault.root])).rejects.toThrow(RuntimeContractError);

		await prepareRuntimeVault(vault);
		await expect(rules(['list', vault.root, '--scope', 'legacy:default'])).rejects.toThrow(
			/非法 scope type/,
		);
		await expect(rules(['migrate-legacy', vault.root])).rejects.toThrow(
			/未知 rules 命令：migrate-legacy/,
		);
	});
});

describe('lifeos rules purge 永久清除协议', () => {
	let vault: ReturnType<typeof createTempVault>;
	let db: Database.Database;
	let logSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(async () => {
		_resetDefaultInstance();
		const template = createTempVault();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-purge-test-'));
		cpSync(template.root, root, { recursive: true });
		template.cleanup();
		vault = {
			root,
			dbPath: join(root, '90_系统', '记忆', 'memory.db'),
			cleanup: () => rmSync(root, { recursive: true, force: true }),
		};
		await prepareRuntimeVault(vault);
		db = new Database(vault.dbPath);
		db.pragma('foreign_keys = ON');
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		db.close();
		_resetDefaultInstance();
		vault.cleanup();
	});

	function createRule(): ReturnType<typeof upsertMemoryItem> {
		return upsertMemoryItem(db, {
			slotKey: 'privacy:purge',
			content: '需要永久清除的敏感正文',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
			actor: 'test:purge',
			correlationId: 'purge:create',
			occurredAt: '2026-08-09T00:00:00.000Z',
		});
	}

	function purgeArgs(itemId: number, reason = '用户明确要求永久清除'): string[] {
		return [
			'purge',
			vault.root,
			'--item-id',
			String(itemId),
			'--confirm-item-id',
			String(itemId),
			'--reason',
			reason,
		];
	}

	it('拒绝清除 active 条目，投影与事件保持不变', async () => {
		const created = createRule();
		await expect(rules(purgeArgs(created.itemId))).rejects.toThrow(/只允许永久清除已归档条目/);
		expect(db.prepare('SELECT COUNT(*) AS count FROM memory_items').get()).toEqual({ count: 1 });
		expect(db.prepare('SELECT COUNT(*) AS count FROM memory_item_events').get()).toEqual({
			count: 1,
		});
	});

	it('拒绝不一致的确认 id、空 reason 与旧 --id 参数', async () => {
		const created = createRule();
		await expect(
			rules([
				'purge',
				vault.root,
				'--item-id',
				String(created.itemId),
				'--confirm-item-id',
				String(created.itemId + 1),
				'--reason',
				'确认不一致',
			]),
		).rejects.toThrow(/确认 item id 必须完全一致/);
		await expect(rules(purgeArgs(created.itemId, '   '))).rejects.toThrow(
			/purge 需要非空 --reason/,
		);
		await expect(
			rules([
				'purge',
				vault.root,
				'--id',
				String(created.itemId),
				'--confirm-item-id',
				String(created.itemId),
				'--reason',
				'禁止旧参数',
			]),
		).rejects.toThrow(/purge 需要 --item-id/);
	});

	it('备份失败时不删除投影或事件', async () => {
		const created = createRule();
		await rules([
			'archive',
			vault.root,
			'--id',
			String(created.itemId),
			'--reason',
			'准备永久清除',
		]);
		vi.spyOn(Database.prototype, 'backup').mockRejectedValueOnce(new Error('测试注入：备份失败'));

		await expect(rules(purgeArgs(created.itemId))).rejects.toThrow(/备份失败/);
		expect(db.prepare('SELECT COUNT(*) AS count FROM memory_items').get()).toEqual({ count: 1 });
		expect(db.prepare('SELECT COUNT(*) AS count FROM memory_item_events').get()).toEqual({
			count: 2,
		});
	});

	it('成功时先生成可恢复备份，再删除单条投影及其全部事件并返回精确计数', async () => {
		const created = createRule();
		await rules([
			'archive',
			vault.root,
			'--id',
			String(created.itemId),
			'--reason',
			'准备永久清除',
		]);

		const result = (await rules(purgeArgs(created.itemId))) as {
			itemId: number;
			deletedProjection: number;
			deletedEvents: number;
			backupPath: string;
		};
		expect(result).toMatchObject({
			itemId: created.itemId,
			deletedProjection: 1,
			deletedEvents: 2,
		});
		expect(realpathSync(result.backupPath).startsWith(realpathSync(vault.root))).toBe(true);
		expect(db.prepare('SELECT COUNT(*) AS count FROM memory_items').get()).toEqual({ count: 0 });
		expect(db.prepare('SELECT COUNT(*) AS count FROM memory_item_events').get()).toEqual({
			count: 0,
		});

		const backup = new Database(result.backupPath, { readonly: true, fileMustExist: true });
		try {
			expect(backup.pragma('integrity_check', { simple: true })).toBe('ok');
			expect(backup.prepare('SELECT content, status FROM memory_items').get()).toEqual({
				content: '需要永久清除的敏感正文',
				status: 'archived',
			});
			expect(backup.prepare('SELECT COUNT(*) AS count FROM memory_item_events').get()).toEqual({
				count: 2,
			});
		} finally {
			backup.close();
		}
	});
});
