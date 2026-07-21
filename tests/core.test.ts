import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetDefaultInstance } from '../src/config.js';
import {
	memoryContext,
	memoryForget,
	memoryLog,
	memoryNotify,
	memoryQuery,
	memoryRules,
	memoryStartup,
} from '../src/core.js';
import { CONTRACT_VERSION } from '../src/runtime-contract.js';
import { createTempVault, writeTestNote } from './setup.js';

let vault: ReturnType<typeof createTempVault>;

beforeEach(() => {
	_resetDefaultInstance();
	vault = createTempVault();
});

afterEach(() => {
	_resetDefaultInstance();
	vault.cleanup();
});

describe('memoryStartup 最终 V2/V4 契约', () => {
	it('只返回结构化 Layer 0，并为 fresh V4 写入运行收据', () => {
		const result = memoryStartup({ dbPath: vault.dbPath, vaultRoot: vault.root });

		expect(result.layer0.text).toEqual(expect.any(String));
		expect(result.layer0.snapshotId).toMatch(/^ctx-/);
		expect(result.scopeHints).toEqual({ availableProjects: [], availableSkills: [] });
		expect(result.vaultStats).toMatchObject({ maintenancePending: true });
		expect(result).not.toHaveProperty('layer0_summary');
		expect(result).not.toHaveProperty('vault_stats');

		const receiptPath = join(vault.root, '90_系统', '记忆', 'runtime-receipt.json');
		expect(existsSync(receiptPath)).toBe(true);
		expect(JSON.parse(readFileSync(receiptPath, 'utf-8'))).toMatchObject({
			contract_version: 2,
			schema_version: 4,
			kind: 'fresh-install',
			state: 'opened',
		});
	});
});

describe('core 非 bootstrap 接口拒绝旧契约', () => {
	it.each([
		[
			'memory_query',
			() =>
				memoryQuery({
					contractVersion: 1,
					dbPath: vault.dbPath,
					vaultRoot: vault.root,
				}),
		],
		[
			'memory_log',
			() =>
				memoryLog({
					contractVersion: 1,
					dbPath: vault.dbPath,
					vaultRoot: vault.root,
					slotKey: 'format:latex',
					content: '使用 LaTeX',
					scope: { type: 'global', key: '' },
					itemKind: 'rule',
				}),
		],
		[
			'memory_notify',
			() =>
				memoryNotify({
					contractVersion: 1,
					dbPath: vault.dbPath,
					vaultRoot: vault.root,
					filePath: '00_草稿/a.md',
				}),
		],
	] as const)('%s 在打开数据库前拒绝 contract_version!=2', (_name, invoke) => {
		expect(invoke).toThrow(/contract_version.*expected 2/i);
		expect(existsSync(vault.dbPath)).toBe(false);
	});
});

describe('scoped memory 核心接口', () => {
	it('允许同一 slot_key 在不同 scope 共存，且只按完整复合键更新', () => {
		const global = memoryLog({
			contractVersion: CONTRACT_VERSION,
			dbPath: vault.dbPath,
			vaultRoot: vault.root,
			slotKey: 'format:latex',
			content: '全局公式规则',
			scope: { type: 'global', key: '' },
			itemKind: 'rule',
			enforcement: 'hard',
		});
		_resetDefaultInstance();
		const skill = memoryLog({
			contractVersion: CONTRACT_VERSION,
			dbPath: vault.dbPath,
			vaultRoot: vault.root,
			slotKey: 'format:latex',
			content: '复习技能局部规则',
			scope: { type: 'skill', key: 'revise' },
			itemKind: 'rule',
		});

		expect(global.action).toBe('created');
		expect(skill.action).toBe('created');
		expect(skill.itemId).not.toBe(global.itemId);
		_resetDefaultInstance();
		const listed = memoryRules({
			contractVersion: CONTRACT_VERSION,
			dbPath: vault.dbPath,
			vaultRoot: vault.root,
			filters: { slotKey: 'format:latex' },
		});
		expect(listed.items).toHaveLength(2);
		expect(listed.items.map((item) => item.scope)).toEqual(
			expect.arrayContaining([
				{ type: 'global', key: '' },
				{ type: 'skill', key: 'revise' },
			]),
		);
	});

	it('memory_context 只读取显式 scope，memory_forget 只做软归档', () => {
		const created = memoryLog({
			contractVersion: CONTRACT_VERSION,
			dbPath: vault.dbPath,
			vaultRoot: vault.root,
			slotKey: 'workflow:revise',
			content: '先主动回忆再看答案',
			scope: { type: 'skill', key: 'revise' },
			itemKind: 'rule',
			relatedFiles: ['40_知识/笔记/a.md'],
		});
		_resetDefaultInstance();

		const context = memoryContext({
			contractVersion: CONTRACT_VERSION,
			dbPath: vault.dbPath,
			vaultRoot: vault.root,
			request: {
				scopes: [{ type: 'skill', key: 'revise' }],
				includeGlobal: false,
				includeRelatedFiles: true,
			},
		});
		expect(context.matchedScopes).toEqual([{ type: 'skill', key: 'revise' }]);
		expect(context.rules.map((item) => item.itemId)).toEqual([created.itemId]);
		expect(context.relatedFiles).toEqual(['40_知识/笔记/a.md']);

		_resetDefaultInstance();
		const archived = memoryForget({
			contractVersion: CONTRACT_VERSION,
			dbPath: vault.dbPath,
			vaultRoot: vault.root,
			itemId: created.itemId,
			reason: '规则已失效',
		});
		expect(archived).toMatchObject({ status: 'archived', archiveReason: '规则已失效' });
	});
});

describe('检索与文件通知', () => {
	it('显式契约下通知文件后可检索，且不接受旧无版本调用', () => {
		writeTestNote(
			vault.root,
			'20_项目/my-project.md',
			{ id: 'my-project', title: 'My Project', type: 'project', status: 'active' },
			'项目内容',
		);
		const notified = memoryNotify({
			contractVersion: CONTRACT_VERSION,
			dbPath: vault.dbPath,
			vaultRoot: vault.root,
			filePath: '20_项目/my-project.md',
		});
		expect(notified).toMatchObject({ action: 'indexed', filePath: '20_项目/my-project.md' });

		_resetDefaultInstance();
		const result = memoryQuery({
			contractVersion: CONTRACT_VERSION,
			dbPath: vault.dbPath,
			vaultRoot: vault.root,
			filters: { type: 'project' },
		});
		expect(result.results.some((item) => item.filePath === '20_项目/my-project.md')).toBe(true);
	});
});
