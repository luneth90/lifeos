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
		expect(coreMock.memoryStartup).toHaveBeenCalledTimes(1);
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
			expect(coreMock.memoryStartup).toHaveBeenCalledTimes(2);
			expect(testing.runtimeCount()).toBe(2);
		} finally {
			other.cleanup();
		}
	});

	it('startup 失败被限制在当前 Vault，不会降级到旧路径', () => {
		const other = createTempVault();
		try {
			coreMock.memoryStartup
				.mockImplementationOnce(() => {
					throw new Error('runtime contract invalid');
				})
				.mockReturnValueOnce(startupResult('Other'));

			const failed = testing.callMemoryBootstrap({ vault_root: vault.root });
			const repeated = testing.callMemoryBootstrap({ vault_root: vault.root });
			const recovered = testing.callMemoryBootstrap({ vault_root: other.root });
			expect(failed).toMatchObject({ status: 'error', startup_error: 'runtime contract invalid' });
			expect(repeated).toMatchObject({
				status: 'error',
				startup_error: 'runtime contract invalid',
			});
			expect(recovered).toMatchObject({ status: 'ok', _layer0: 'Other' });
			expect(coreMock.memoryStartup).toHaveBeenCalledTimes(2);
		} finally {
			other.cleanup();
		}
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
