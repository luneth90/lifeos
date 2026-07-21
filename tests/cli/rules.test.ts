import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import rules from '../../src/cli/commands/rules.js';
import { VERSION } from '../../src/cli/utils/version.js';
import { _resetDefaultInstance, resolveConfig } from '../../src/config.js';
import { initDb } from '../../src/db/schema.js';
import { RuntimeContractError, writeFreshInstallReceipt } from '../../src/runtime-contract.js';
import { upsertMemoryItem } from '../../src/services/memory-items.js';
import { createTempVault } from '../setup.js';

describe('lifeos rules 最终 V2/V4 治理契约', () => {
	let vault: ReturnType<typeof createTempVault>;
	let db: Database.Database;
	let logSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		_resetDefaultInstance();
		vault = createTempVault();
		// createTempVault 只提供最终配置；initDb 和 fresh receipt 由核心最终路径分别建立。
		db = new Database(vault.dbPath);
		initDb(db);
		writeFreshInstallReceipt(vault.root, resolveConfig(vault.root), VERSION);
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

		writeFreshInstallReceipt(vault.root, resolveConfig(vault.root), VERSION);
		await expect(rules(['list', vault.root, '--scope', 'legacy:default'])).rejects.toThrow(
			/非法 scope type/,
		);
		await expect(rules(['migrate-legacy', vault.root])).rejects.toThrow(
			/未知 rules 命令：migrate-legacy/,
		);
	});
});
