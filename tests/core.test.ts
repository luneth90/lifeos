import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetDefaultInstance, getOrCreateVaultConfig } from '../src/config.js';
import {
	memoryContext,
	memoryForget,
	memoryLog,
	memoryNotify,
	memoryQuery,
	memoryRules,
	memoryStartup,
} from '../src/core.js';
import { CONTRACT_VERSION, validateRuntimeContract } from '../src/runtime-contract.js';
import { createTempVault, prepareRuntimeVault, writeTestNote } from './setup.js';

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
	beforeEach(async () => prepareRuntimeVault(vault));

	it('在完整最终 runtime 上只返回结构化 Layer 0', () => {
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

	it('拒绝已存在但为空的数据库，运行时不会把它初始化成新的 V4', () => {
		for (const suffix of ['-wal', '-shm']) rmSync(`${vault.dbPath}${suffix}`, { force: true });
		writeFileSync(vault.dbPath, '');

		expect(() => memoryStartup({ dbPath: vault.dbPath, vaultRoot: vault.root })).toThrow(
			/未版本化|需要离线迁移|Schema V4|schema_version/,
		);
		expect(statSync(vault.dbPath).size).toBe(0);
	});

	it('允许用户修改托管资产，同时保留离线严格校验能力', () => {
		const agentsPath = join(vault.root, 'AGENTS.md');
		writeFileSync(agentsPath, `${readFileSync(agentsPath, 'utf-8')}\n用户自定义规则\n`, 'utf-8');

		expect(validateRuntimeContract({ vaultRoot: vault.root }).issues).toContain(
			'managed asset 哈希不匹配：AGENTS.md',
		);
		expect(() => memoryStartup({ dbPath: vault.dbPath, vaultRoot: vault.root })).not.toThrow();
	});

	it('每次请求只使用一份新配置快照，不受已预热 singleton 污染', () => {
		getOrCreateVaultConfig(vault.root);
		const yamlPath = join(vault.root, 'lifeos.yaml');
		const before = readFileSync(yamlPath, 'utf-8');
		expect(before).toContain('layer0_total: 1800');
		writeFileSync(yamlPath, before.replace('layer0_total: 1800', 'layer0_total: 321'), 'utf-8');

		const result = memoryStartup({ dbPath: vault.dbPath, vaultRoot: vault.root });
		expect(result.layer0.meta.tokenBudget).toBe(321);
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
	beforeEach(async () => prepareRuntimeVault(vault));

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

	it('repository binding 的配置更新在下一次请求立即生效', () => {
		getOrCreateVaultConfig(vault.root);
		const yamlPath = join(vault.root, 'lifeos.yaml');
		const before = readFileSync(yamlPath, 'utf-8');
		expect(before).toContain('repository_bindings: {}');
		writeFileSync(
			yamlPath,
			before.replace(
				'repository_bindings: {}',
				'repository_bindings:\n    lifeos:\n      - /Users/example/code/lifeos',
			),
			'utf-8',
		);

		const result = memoryLog({
			contractVersion: CONTRACT_VERSION,
			dbPath: vault.dbPath,
			vaultRoot: vault.root,
			slotKey: 'repository:release',
			content: '发布前执行完整验证',
			scope: { type: 'repository', key: 'lifeos' },
			itemKind: 'rule',
		});
		expect(result).toMatchObject({
			action: 'created',
			scope: { type: 'repository', key: 'lifeos' },
		});
	});

	it('未知 repository 提供可直接照抄的 lifeos.yaml 修复提示', () => {
		let message = '';
		try {
			memoryLog({
				contractVersion: CONTRACT_VERSION,
				dbPath: vault.dbPath,
				vaultRoot: vault.root,
				slotKey: 'repository:release',
				content: '发布前执行完整验证',
				scope: { type: 'repository', key: 'lifeos' },
				itemKind: 'rule',
			});
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain('unknown_repository');
		expect(message).toContain(join(vault.root, 'lifeos.yaml'));
		expect(message).toContain('现有的 memory.repository_bindings 下合并');
		expect(message).toContain('真实 Git 根目录的绝对路径');
		expect(message).toContain('"lifeos"');
		expect(message).toContain('"/请替换为真实仓库绝对路径"');
		expect(message).not.toContain('\nmemory:');
	});
});

describe('检索与文件通知', () => {
	beforeEach(async () => prepareRuntimeVault(vault));

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
