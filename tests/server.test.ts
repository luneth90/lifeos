import { symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryBootstrapOutputSchema } from '../src/tool-schemas.js';
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
		scopeHints: {
			availableProjects: ['gts'],
			availableRepositories: [],
			availableSkills: ['revise'],
			availableTools: ['obsidian'],
			toolBindings: {
				obsidian: { commands: ['obsidian'], skills: ['obsidian-cli'] },
			},
		},
		vaultStats: {
			totalFiles: 0,
			updatedSinceLast: 0,
			unchanged: 0,
			removed: 0,
			maintenanceState: 'pending',
			maintenancePending: true,
		},
	};
}

function successfulMaintenanceResult() {
	return {
		vaultStats: {
			totalFiles: 0,
			updatedSinceLast: 0,
			unchanged: 0,
			removed: 0,
			maintenanceState: 'succeeded' as const,
			maintenancePending: false as const,
		},
		activeDocs: [],
		impact: { taskboardChanged: false, profileChanged: false, affectedScopes: [] },
		maintenance: {
			mode: 'routine' as const,
			state: 'succeeded' as const,
			startedAt: '2026-08-09T00:00:00.000Z',
			finishedAt: '2026-08-09T00:00:00.010Z',
			durationMs: 10,
			before: {
				pageCount: 100,
				freelistCount: 30,
				freelistBytes: 122_880,
				walPages: 4,
				walBytes: 16_512,
			},
			after: {
				pageCount: 80,
				freelistCount: 0,
				freelistBytes: 0,
				walPages: 0,
				walBytes: 0,
			},
			error: null,
		},
	};
}

function rankedQueryResultFixture() {
	return {
		filePath: '40_知识/可审计检索.md',
		entityId: 'auditable-query',
		title: '可审计检索',
		type: 'note',
		status: 'review',
		domain: '测试',
		summary: '可审计检索证据',
		displaySummary: '可审计检索证据',
		matchSource: 'fts5' as const,
		matchedFields: ['title', 'summary'],
		score: 490,
		rankScore: -1.25,
		rankPosition: 1,
		rankExplanation: {
			rankSource: 'vault_fts_bm25' as const,
			sortKeys: [
				{ field: 'rankScore' as const, direction: 'asc' as const, value: -1.25 },
				{
					field: 'modifiedAt' as const,
					direction: 'desc' as const,
					value: '2026-08-09T00:00:00.000Z',
				},
				{
					field: 'filePath' as const,
					direction: 'asc' as const,
					value: '40_知识/可审计检索.md',
				},
			],
		},
		evidence: [
			{
				field: 'title' as const,
				snippet: '可审计检索',
				matchedTerms: ['可审计检索'],
				sourcePath: '40_知识/可审计检索.md',
			},
		],
		modifiedAt: '2026-08-09T00:00:00.000Z',
		masteryStatus: 'review',
		tags: ['检索'],
		aliases: [],
		wikilinks: [],
		backlinks: [],
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
	memoryHistory: vi.fn(() => ({ itemId: 1, events: [] })),
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

describe('server 最终 V2/V5 契约', () => {
	let vault: TempVault;
	let testing: Awaited<ReturnType<typeof loadServerTesting>>;

	beforeEach(async () => {
		vault = createTempVault();
		for (const mock of Object.values(coreMock)) mock.mockClear();
		coreMock.memoryStartup.mockReturnValue(startupResult());
		coreMock.memoryStartupMaintenance.mockReturnValue(successfulMaintenanceResult());
		testing = await loadServerTesting();
	});

	afterEach(() => {
		testing.resetState();
		vault.cleanup();
		vi.useRealTimers();
	});

	it('memory_bootstrap 是唯一无需 contract_version 的入口，并返回规范 V2/V5 元数据', () => {
		const result = testing.callMemoryBootstrap({ vault_root: vault.root });

		expect(coreMock.memoryStartup).toHaveBeenCalledWith({
			dbPath: undefined,
			vaultRoot: vault.root,
		});
		expect(result).toMatchObject({
			contract_version: 2,
			schema_version: 5,
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
				available_repositories: [],
				available_skills: ['revise'],
				available_tools: ['obsidian'],
				tool_bindings: {
					obsidian: { commands: ['obsidian'], skills: ['obsidian-cli'] },
				},
			},
			db_maintenance: {
				mode: 'routine',
				state: 'pending',
				started_at: null,
				finished_at: null,
				duration_ms: null,
				before: null,
				after: null,
				error: null,
			},
		});
	});

	it('bootstrap 等待延迟扫描时保留内部 DB 维护报告的精确时间区间', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
		let finishMaintenance!: (value: ReturnType<typeof successfulMaintenanceResult>) => void;
		const maintenance = new Promise<ReturnType<typeof successfulMaintenanceResult>>((resolve) => {
			finishMaintenance = resolve;
		});
		coreMock.memoryStartupMaintenance.mockReturnValueOnce(
			maintenance as unknown as ReturnType<typeof successfulMaintenanceResult>,
		);

		const initial = testing.callMemoryBootstrap({ vault_root: vault.root });
		expect(initial.db_maintenance).toMatchObject({
			state: 'pending',
			started_at: null,
			finished_at: null,
		});

		vi.advanceTimersToNextTimer();
		await Promise.resolve();
		const running = testing.callMemoryBootstrap({ vault_root: vault.root });
		expect(running.db_maintenance).toMatchObject({
			state: 'running',
			started_at: '2030-01-01T00:00:00.000Z',
			finished_at: null,
			duration_ms: null,
			before: null,
			after: null,
			error: null,
		});

		finishMaintenance(successfulMaintenanceResult());
		await testing.waitForMaintenance({ vault_root: vault.root });
		const finished = testing.callMemoryBootstrap({ vault_root: vault.root });
		expect(finished.db_maintenance).toMatchObject({
			state: 'succeeded',
			started_at: '2026-08-09T00:00:00.000Z',
			finished_at: '2026-08-09T00:00:00.010Z',
			duration_ms: 10,
			before: {
				page_count: 100,
				freelist_count: 30,
				freelist_bytes: 122_880,
				wal_pages: 4,
				wal_bytes: 16_512,
			},
			after: {
				page_count: 80,
				freelist_count: 0,
				freelist_bytes: 0,
				wal_pages: 0,
				wal_bytes: 0,
			},
			error: null,
		});
		expect(finished.db_maintenance.started_at).not.toBe(running.db_maintenance.started_at);
		expect(Date.parse(finished.db_maintenance.finished_at as string)).toBeGreaterThanOrEqual(
			Date.parse(finished.db_maintenance.started_at as string),
		);
		expect(coreMock.memoryStartupMaintenance).toHaveBeenCalledTimes(1);
	});

	it('同一 Vault 并发 bootstrap 共享维护任务，不同 Vault 各执行一次', async () => {
		vi.useFakeTimers();
		expect(typeof testing.waitForMaintenance).toBe('function');
		const other = createTempVault();
		try {
			const first = testing.callMemoryBootstrap({ vault_root: vault.root });
			const repeated = testing.callMemoryBootstrap({ vault_root: vault.root });
			const isolated = testing.callMemoryBootstrap({ vault_root: other.root });
			expect(first.db_maintenance.state).toBe('pending');
			expect(repeated.db_maintenance.state).toBe('pending');
			expect(isolated.db_maintenance.state).toBe('pending');

			vi.runAllTimers();
			await Promise.all([
				testing.waitForMaintenance({ vault_root: vault.root }),
				testing.waitForMaintenance({ vault_root: other.root }),
			]);
			expect(coreMock.memoryStartupMaintenance).toHaveBeenCalledTimes(2);
			expect(testing.runtimeCount()).toBe(2);
		} finally {
			other.cleanup();
		}
	});

	it('维护失败保留错误详情并进入 failed 终态，不伪装成功', async () => {
		vi.useFakeTimers();
		expect(typeof testing.waitForMaintenance).toBe('function');
		coreMock.memoryStartupMaintenance.mockImplementationOnce(() => {
			throw new Error('routine maintenance exploded');
		});
		testing.callMemoryBootstrap({ vault_root: vault.root });
		vi.runAllTimers();
		await testing.waitForMaintenance({ vault_root: vault.root });

		expect(testing.callMemoryBootstrap({ vault_root: vault.root }).db_maintenance).toMatchObject({
			state: 'failed',
			started_at: expect.any(String),
			finished_at: expect.any(String),
			duration_ms: expect.any(Number),
			before: null,
			after: null,
			error: 'routine maintenance exploded',
		});
		expect(coreMock.memoryStartupMaintenance).toHaveBeenCalledTimes(1);
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

	it('memory_query 严格保留真实排名与索引证据字段', () => {
		const fixture = rankedQueryResultFixture();
		coreMock.memoryQuery.mockReturnValueOnce({ results: [fixture] });

		const result = testing.callTool('memory_query', {
			contract_version: 2,
			vault_root: vault.root,
			query: '可审计检索',
		});

		expect(result).toEqual({ results: [fixture] });
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

	it('memory_history 只转发结构化 item_id 与 limit', () => {
		const result = testing.callTool('memory_history', {
			contract_version: 2,
			vault_root: vault.root,
			item_id: 1,
			limit: 25,
		});

		expect(result).toEqual({ itemId: 1, events: [] });
		expect(coreMock.memoryHistory).toHaveBeenCalledWith({
			contractVersion: 2,
			vaultRoot: vault.root,
			itemId: 1,
			limit: 25,
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

	it('成功工具请求会更新 runtime dbPath，后台维护使用最新路径', async () => {
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
		await testing.waitForMaintenance({ vault_root: vault.root });

		expect(coreMock.memoryStartupMaintenance).toHaveBeenCalledTimes(1);
		expect(coreMock.memoryStartupMaintenance).toHaveBeenCalledWith({
			contractVersion: 2,
			dbPath: currentDbPath,
			vaultRoot: vault.root,
		});
	});

	it('成功刷新会更新 runtime dbPath，后台维护使用刷新请求路径', async () => {
		vi.useFakeTimers();
		const initialDbPath = join(vault.root, 'initial.db');
		const refreshedDbPath = join(vault.root, 'refreshed.db');
		testing.callMemoryBootstrap({ vault_root: vault.root, db_path: initialDbPath });

		testing.callMemoryBootstrap({ vault_root: vault.root, db_path: refreshedDbPath });
		vi.runAllTimers();
		await testing.waitForMaintenance({ vault_root: vault.root });

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

	it('bootstrap 严格结果 schema 精确校验维护状态与可空指标', () => {
		const output = {
			contract_version: 2,
			schema_version: 5,
			status: 'ok',
			startup_ran: true,
			layer0_refreshed: false,
			snapshot_id: 'ctx-schema',
			_layer0: 'Layer0',
			layer0_meta: {
				token_estimate: 1,
				token_budget: 1800,
				global_items_total: 0,
				global_items_loaded: 0,
				omitted_slot_keys: [],
				oversized_items: [],
				warnings: [],
				sections: {
					global_rules: { total: 0, loaded: 0, omitted: 0 },
					taskboard_focus: { total: 0, loaded: 0, omitted: 0 },
					userprofile_summary: { total: 0, loaded: 0, omitted: 0 },
					revision_reminder: { total: 0, loaded: 0, omitted: 0 },
				},
			},
			scope_hints: {
				available_projects: [],
				available_repositories: [],
				available_skills: [],
				available_tools: [],
				tool_bindings: {},
			},
			db_maintenance: {
				mode: 'routine',
				state: 'pending',
				started_at: null,
				finished_at: null,
				duration_ms: null,
				before: null,
				after: null,
				error: null,
			},
		};

		expect(memoryBootstrapOutputSchema.parse(output)).toEqual(output);
		expect(() =>
			memoryBootstrapOutputSchema.parse({
				...output,
				db_maintenance: { ...output.db_maintenance, state: 'unknown' },
			}),
		).toThrow();
		expect(() =>
			memoryBootstrapOutputSchema.parse({
				...output,
				db_maintenance: {
					...output.db_maintenance,
					started_at: '2026-08-09T00:00:00.000Z',
				},
			}),
		).toThrow();
		expect(() => memoryBootstrapOutputSchema.parse({ ...output, extra: true })).toThrow();
	});

	it('toToolResult 以同一份 JSON 值生成结构化结果和兼容文本', async () => {
		const mod = await loadServerModule();
		const result = mod.toToolResult({
			status: 'error',
			startup_error: '测试启动错误',
			omitted: undefined,
		});

		expect(result.structuredContent).toEqual({
			status: 'error',
			startup_error: '测试启动错误',
		});
		expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(result.structuredContent);
	});
});
