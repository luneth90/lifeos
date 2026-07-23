import { symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type TempVault, createTempVault } from './setup.js';

function startupResult(text = 'Layer0', snapshotId = 'ctx-test') {
	return {
		layer0: {
			text,
			snapshotId,
			meta: {
				tokenEstimate: 10,
				tokenBudget: 1800,
				globalItemsTotal: 1,
				globalItemsLoaded: 1,
				omittedSlotKeys: [],
				oversizedItems: [],
				warnings: [],
				sections: {
					globalRules: { total: 1, loaded: 1, omitted: 0 },
					taskboardFocus: { total: 0, loaded: 0, omitted: 0 },
					userprofileSummary: { total: 0, loaded: 0, omitted: 0 },
					revisionReminder: { total: 0, loaded: 0, omitted: 0 },
				},
			},
		},
		scopeHints: { availableProjects: ['gts'], availableSkills: ['revise'] },
		vaultStats: {
			totalFiles: 0,
			updatedSinceLast: 0,
			unchanged: 0,
			removed: 0,
			maintenancePending: true,
		},
	};
}

const coreMock = vi.hoisted(() => ({
	memoryStartup: vi.fn(),
	memoryStartupMaintenance: vi.fn(() => ({
		impact: { taskboardChanged: false, profileChanged: false, affectedScopes: [] },
	})),
	memoryQuery: vi.fn(() => ({ results: [] })),
	memoryContext: vi.fn(() => ({ matchedScopes: [], rules: [] })),
	memoryLog: vi.fn(() => ({
		itemId: 1,
		slotKey: 'test:key',
		itemKind: 'rule',
		scope: { type: 'global', key: '' },
		action: 'created',
	})),
	memoryRules: vi.fn(() => ({ items: [] })),
	memoryForget: vi.fn(() => ({
		itemId: 1,
		itemKind: 'rule',
		scope: { type: 'global', key: '' },
		status: 'archived',
	})),
	memoryNotify: vi.fn(() => ({
		impact: { taskboardChanged: false, profileChanged: false, affectedScopes: [] },
	})),
	memoryNotifyBatch: vi.fn(() => ({
		impact: { taskboardChanged: false, profileChanged: false, affectedScopes: [] },
	})),
}));

vi.mock('../src/core.js', () => coreMock);

async function loadServerTesting() {
	vi.resetModules();
	const mod = await import('../src/server.js');
	return mod.__testing;
}

async function loadServerModule() {
	vi.resetModules();
	return import('../src/server.js');
}

describe('server 最终 V2/V4 契约', () => {
	let vault: TempVault;
	let testing: Awaited<ReturnType<typeof loadServerTesting>>;

	beforeEach(async () => {
		vault = createTempVault();
		for (const mock of Object.values(coreMock)) mock.mockClear();
		coreMock.memoryStartup.mockReturnValue(startupResult());
		testing = await loadServerTesting();
	});

	afterEach(() => {
		testing.resetState();
		vault.cleanup();
		vi.useRealTimers();
	});

	it('memory_bootstrap 是唯一无需 contract_version 的入口，并返回规范 V2/V4 元数据', () => {
		const result = testing.callMemoryBootstrap({ vault_root: vault.root });

		expect(coreMock.memoryStartup).toHaveBeenCalledWith({
			dbPath: undefined,
			vaultRoot: vault.root,
		});
		expect(result).toMatchObject({
			contract_version: 2,
			schema_version: 4,
			status: 'ok',
			startup_ran: true,
			layer0_refreshed: false,
			snapshot_id: 'ctx-test',
			_layer0: 'Layer0',
			layer0_meta: {
				token_estimate: 10,
				global_items_total: 1,
				sections: {
					global_rules: { total: 1, loaded: 1, omitted: 0 },
					taskboard_focus: { total: 0, loaded: 0, omitted: 0 },
					userprofile_summary: { total: 0, loaded: 0, omitted: 0 },
					revision_reminder: { total: 0, loaded: 0, omitted: 0 },
				},
			},
			scope_hints: {
				available_projects: ['gts'],
				available_skills: ['revise'],
			},
		});
	});

	it('旧客户端在任何 Vault、数据库或 startup 动作前硬失败', () => {
		expect(() =>
			testing.callTool('memory_query', {
				vault_root: vault.root,
				query: 'test',
			}),
		).toThrow(/contract_version 必须为 2/);
		expect(() =>
			testing.callTool('memory_query', {
				contract_version: 1,
				vault_root: vault.root,
				query: 'test',
			}),
		).toThrow(/contract_version 必须为 2/);
		expect(coreMock.memoryStartup).not.toHaveBeenCalled();
		expect(coreMock.memoryQuery).not.toHaveBeenCalled();
		expect(testing.runtimeCount()).toBe(0);
	});

	it('memory_log 只转发最终字段；global 写入精确失效 Layer 0', () => {
		coreMock.memoryStartup
			.mockReturnValueOnce(startupResult('Initial', 'ctx-initial'))
			.mockReturnValueOnce(startupResult('Refreshed', 'ctx-refreshed'));
		testing.callMemoryBootstrap({ vault_root: vault.root });
		testing.callTool('memory_log', {
			contract_version: 2,
			vault_root: vault.root,
			slot_key: 'content:language',
			content: '所有回复使用中文',
			scope: { type: 'global', key: '' },
			item_kind: 'rule',
			priority: 100,
			enforcement: 'hard',
		});

		expect(coreMock.memoryLog).toHaveBeenCalledWith({
			contractVersion: 2,
			vaultRoot: vault.root,
			slotKey: 'content:language',
			content: '所有回复使用中文',
			scope: { type: 'global', key: '' },
			itemKind: 'rule',
			priority: 100,
			enforcement: 'hard',
		});
		expect(testing.runtimeState({ vault_root: vault.root })).toMatchObject({
			layer0Dirty: true,
			globalVersion: 1,
		});

		const refreshed = testing.callMemoryBootstrap({ vault_root: vault.root });
		expect(refreshed).toMatchObject({
			layer0_refreshed: true,
			_layer0: 'Refreshed',
			snapshot_id: 'ctx-refreshed',
		});
	});

	it('scoped 写入只失效对应 scope，不刷新全局 Layer 0', () => {
		coreMock.memoryLog.mockReturnValueOnce({
			itemId: 2,
			slotKey: 'workflow:revise',
			itemKind: 'rule',
			scope: { type: 'skill', key: 'revise' },
			action: 'created',
		});
		testing.callMemoryBootstrap({ vault_root: vault.root });
		testing.callTool('memory_log', {
			contract_version: 2,
			vault_root: vault.root,
			slot_key: 'workflow:revise',
			content: '先主动回忆',
			scope: { type: 'skill', key: 'revise' },
			item_kind: 'rule',
		});

		expect(testing.runtimeState({ vault_root: vault.root })).toMatchObject({
			layer0Dirty: false,
			globalVersion: 0,
			scopeVersions: { 'skill:revise': 1 },
		});
		const second = testing.callMemoryBootstrap({ vault_root: vault.root });
		expect(second.layer0_refreshed).toBe(false);
		expect(coreMock.memoryStartup).toHaveBeenCalledTimes(2);
	});

	it('memory_forget 使用 camelCase 参数并精确失效归档条目的局部 scope', () => {
		coreMock.memoryForget.mockReturnValueOnce({
			itemId: 2,
			itemKind: 'rule',
			scope: { type: 'skill', key: 'revise' },
			status: 'archived',
		});
		testing.callMemoryBootstrap({ vault_root: vault.root });
		const forgotten = testing.callTool('memory_forget', {
			contract_version: 2,
			vault_root: vault.root,
			item_id: 2,
			reason: '规则已失效',
		});
		expect(forgotten).toMatchObject({ scope: { type: 'skill', key: 'revise' } });

		expect(coreMock.memoryForget).toHaveBeenCalledWith({
			contractVersion: 2,
			vaultRoot: vault.root,
			itemId: 2,
			reason: '规则已失效',
		});
		expect(testing.runtimeState({ vault_root: vault.root })).toMatchObject({
			layer0Dirty: false,
			globalVersion: 0,
			scopeVersions: { 'skill:revise': 1 },
		});
	});

	it('memory_forget 批量归档分支从 params 失效对应 scope 缓存', () => {
		coreMock.memoryForget.mockReturnValueOnce({ archived: 2 });
		testing.callMemoryBootstrap({ vault_root: vault.root });
		const result = testing.callTool('memory_forget', {
			contract_version: 2,
			vault_root: vault.root,
			scope: { type: 'project', key: 'project-gc' },
			reason: '项目归档清理',
		});
		expect(result).toEqual({ archived: 2 });

		expect(coreMock.memoryForget).toHaveBeenCalledWith({
			contractVersion: 2,
			vaultRoot: vault.root,
			scope: { type: 'project', key: 'project-gc' },
			reason: '项目归档清理',
		});
		expect(testing.runtimeState({ vault_root: vault.root })).toMatchObject({
			layer0Dirty: false,
			globalVersion: 0,
			scopeVersions: { 'project:project-gc': 1 },
		});
	});

	it('memory_context 将作用域参数封装为 request，不保留旧上下文字段', () => {
		testing.callTool('memory_context', {
			contract_version: 2,
			vault_root: vault.root,
			scopes: [{ type: 'project', key: 'gts' }],
			include_global: false,
			include_related_files: true,
			token_budget: 800,
		});

		expect(coreMock.memoryContext).toHaveBeenCalledWith({
			contractVersion: 2,
			vaultRoot: vault.root,
			request: {
				scopes: [{ type: 'project', key: 'gts' }],
				includeGlobal: false,
				includeRelatedFiles: true,
				tokenBudget: 800,
			},
		});
	});

	it('两个 Vault 的启动和缓存状态完全隔离', () => {
		const other = createTempVault();
		try {
			coreMock.memoryStartup.mockImplementation(({ vaultRoot }: { vaultRoot: string }) =>
				startupResult(`Layer0:${vaultRoot}`, `ctx:${vaultRoot}`),
			);
			const first = testing.callMemoryBootstrap({ vault_root: vault.root });
			const second = testing.callMemoryBootstrap({ vault_root: other.root });
			const again = testing.callMemoryBootstrap({ vault_root: vault.root });

			expect(first._layer0).toBe(`Layer0:${vault.root}`);
			expect(second._layer0).toBe(`Layer0:${other.root}`);
			expect(again._layer0).toBe(`Layer0:${vault.root}`);
			expect(coreMock.memoryStartup).toHaveBeenCalledTimes(3);
			expect(testing.runtimeCount()).toBe(2);
		} finally {
			other.cleanup();
		}
	});

	it('显式与省略 dbPath 共享同一个 Vault runtime', () => {
		testing.callMemoryBootstrap({ vault_root: vault.root, db_path: vault.dbPath });
		testing.callMemoryBootstrap({ vault_root: vault.root });
		expect(testing.runtimeCount()).toBe(1);
		expect(coreMock.memoryStartup).toHaveBeenCalledTimes(2);
	});

	it('成功工具请求会更新 runtime dbPath，后台维护使用最新路径', () => {
		vi.useFakeTimers();
		const initialDbPath = join(vault.root, 'initial.db');
		const currentDbPath = join(vault.root, 'current.db');
		testing.callMemoryBootstrap({ vault_root: vault.root, db_path: initialDbPath });

		testing.callTool('memory_query', {
			contract_version: 2,
			vault_root: vault.root,
			db_path: currentDbPath,
			query: '最新路径',
		});
		vi.runAllTimers();

		expect(coreMock.memoryStartupMaintenance).toHaveBeenCalledTimes(1);
		expect(coreMock.memoryStartupMaintenance).toHaveBeenCalledWith({
			contractVersion: 2,
			dbPath: currentDbPath,
			vaultRoot: vault.root,
		});
	});

	it('成功刷新会更新 runtime dbPath，后台维护使用刷新请求路径', () => {
		vi.useFakeTimers();
		const initialDbPath = join(vault.root, 'initial.db');
		const refreshedDbPath = join(vault.root, 'refreshed.db');
		testing.callMemoryBootstrap({ vault_root: vault.root, db_path: initialDbPath });

		testing.callMemoryBootstrap({ vault_root: vault.root, db_path: refreshedDbPath });
		vi.runAllTimers();

		expect(coreMock.memoryStartup).toHaveBeenNthCalledWith(2, {
			dbPath: refreshedDbPath,
			vaultRoot: vault.root,
		});
		expect(coreMock.memoryStartupMaintenance).toHaveBeenCalledTimes(1);
		expect(coreMock.memoryStartupMaintenance).toHaveBeenCalledWith({
			contractVersion: 2,
			dbPath: refreshedDbPath,
			vaultRoot: vault.root,
		});
	});

	it.skipIf(process.platform === 'win32')('符号链接别名与真实路径共享同一个 runtime', () => {
		const alias = `${vault.root}-alias`;
		symlinkSync(vault.root, alias, 'dir');
		try {
			testing.callMemoryBootstrap({ vault_root: alias });
			testing.callMemoryBootstrap({ vault_root: vault.root });
			expect(testing.runtimeCount()).toBe(1);
		} finally {
			unlinkSync(alias);
		}
	});

	it('startup 失败会淘汰残留 runtime，下一次同 Vault 请求可重试', () => {
		const other = createTempVault();
		try {
			coreMock.memoryStartup
				.mockImplementationOnce(() => {
					throw new Error('runtime contract invalid');
				})
				.mockReturnValueOnce(startupResult('Recovered'))
				.mockReturnValueOnce(startupResult('Other'));

			const failed = testing.callMemoryBootstrap({ vault_root: vault.root });
			const repeated = testing.callMemoryBootstrap({ vault_root: vault.root });
			const recovered = testing.callMemoryBootstrap({ vault_root: other.root });
			expect(failed).toMatchObject({ status: 'error', startup_error: 'runtime contract invalid' });
			expect(repeated).toMatchObject({ status: 'ok', _layer0: 'Recovered' });
			expect(recovered).toMatchObject({ status: 'ok', _layer0: 'Other' });
			expect(coreMock.memoryStartup).toHaveBeenCalledTimes(3);
			expect(testing.runtimeCount()).toBe(2);
		} finally {
			other.cleanup();
		}
	});

	it('Layer 0 刷新失败同样淘汰 runtime，并允许下次请求恢复', () => {
		coreMock.memoryStartup
			.mockReturnValueOnce(startupResult('Initial', 'ctx-initial'))
			.mockImplementationOnce(() => {
				throw new Error('refresh failed');
			})
			.mockReturnValueOnce(startupResult('Recovered', 'ctx-recovered'));
		expect(testing.callMemoryBootstrap({ vault_root: vault.root }).status).toBe('ok');
		expect(testing.callMemoryBootstrap({ vault_root: vault.root })).toMatchObject({
			status: 'error',
			startup_error: 'refresh failed',
		});
		expect(testing.runtimeCount()).toBe(0);
		expect(testing.callMemoryBootstrap({ vault_root: vault.root })).toMatchObject({
			status: 'ok',
			_layer0: 'Recovered',
		});
	});

	it('不存在的 Vault 返回结构化启动错误且不留下 runtime', () => {
		const result = testing.callMemoryBootstrap({ vault_root: join(vault.root, 'missing') });
		expect(result).toMatchObject({ status: 'error', _layer0: '' });
		expect(result.startup_error).toContain('Vault 不存在');
		expect(testing.runtimeCount()).toBe(0);
		expect(coreMock.memoryStartup).not.toHaveBeenCalled();
	});

	it('公开 schema 只接受 contract 2 和规范 scope', async () => {
		const mod = await loadServerModule();
		expect(mod.contractVersionSchema.parse(2)).toBe(2);
		expect(() => mod.contractVersionSchema.parse(1)).toThrow();
		expect(() => mod.contractVersionSchema.parse(undefined)).toThrow();
		expect(mod.memoryScopeSchema.parse({ type: 'global', key: '' })).toEqual({
			type: 'global',
			key: '',
		});
		expect(() => mod.memoryScopeSchema.parse({ type: 'global', key: 'default' })).toThrow();
		expect(() => mod.memoryScopeSchema.parse({ type: 'project', key: '' })).toThrow();
		expect(() => mod.memoryScopeSchema.parse({ type: 'legacy', key: 'x' })).toThrow();
	});
});
