import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type TempVault, createTempVault } from './setup.js';

const coreMock = vi.hoisted(() => ({
	memoryStartup: vi.fn(() => ({ layer0_summary: 'Layer0' })),
	memoryQuery: vi.fn(() => ({ results: [] })),
	memoryLog: vi.fn(() => ({ slotKey: 'test:key', action: 'created' })),
	memoryNotify: vi.fn(() => ({ status: 'ok' })),
}));

const layer0Mock = vi.hoisted(() => ({
	buildLayer0Summary: vi.fn(() => 'RefreshedLayer0'),
}));

const activeDocsMock = vi.hoisted(() => ({
	refreshTaskboard: vi.fn(),
	refreshUserprofile: vi.fn(),
}));

vi.mock('../src/core.js', () => coreMock);
vi.mock('../src/services/layer0.js', () => layer0Mock);
vi.mock('../src/active-docs/index.js', () => activeDocsMock);

async function loadServerTesting() {
	vi.resetModules();
	const mod = await import('../src/server.js');
	return mod.__testing;
}

async function loadServerModule() {
	vi.resetModules();
	return import('../src/server.js');
}

describe('server auto lifecycle', () => {
	let vault: TempVault;
	let testing: Awaited<ReturnType<typeof loadServerTesting>>;

	beforeEach(async () => {
		vault = createTempVault();
		testing = await loadServerTesting();
		coreMock.memoryStartup.mockClear();
		coreMock.memoryQuery.mockClear();
		coreMock.memoryLog.mockClear();
		coreMock.memoryNotify.mockClear();
		coreMock.memoryStartup.mockReturnValue({ layer0_summary: 'Layer0' });
		layer0Mock.buildLayer0Summary.mockClear();
		layer0Mock.buildLayer0Summary.mockReturnValue('RefreshedLayer0');
		activeDocsMock.refreshTaskboard.mockClear();
		activeDocsMock.refreshUserprofile.mockClear();
	});

	afterEach(() => {
		testing.resetState();
		vault.cleanup();
		vi.useRealTimers();
	});

	it('ensureStartup calls memoryStartup with vault_root', async () => {
		testing.ensureStartup({
			vault_root: vault.root,
		});

		expect(coreMock.memoryStartup).toHaveBeenCalledWith({
			vaultRoot: vault.root,
		});
	});

	it('ensureStartup is idempotent — second call is a no-op', async () => {
		testing.ensureStartup({ vault_root: vault.root });
		testing.ensureStartup({ vault_root: vault.root });

		expect(coreMock.memoryStartup).toHaveBeenCalledTimes(1);
	});

	it('memory_bootstrap 首次调用会触发 startup 并返回 _layer0', async () => {
		const result = testing.callMemoryBootstrap({
			vault_root: vault.root,
		});

		expect(coreMock.memoryStartup).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({
			status: 'ok',
			startup_ran: true,
			layer0_refreshed: false,
			_layer0: 'Layer0',
		});
	});

	it('重复 bootstrap 只执行一次 startup', async () => {
		testing.callMemoryBootstrap({ vault_root: vault.root });
		const second = testing.callMemoryBootstrap({ vault_root: vault.root });

		expect(coreMock.memoryStartup).toHaveBeenCalledTimes(1);
		expect(second).toMatchObject({
			status: 'ok',
			startup_ran: false,
			layer0_refreshed: false,
			_layer0: 'Layer0',
		});
	});

	it('memory_log 后再次 bootstrap 会轻量刷新 layer0', async () => {
		testing.callMemoryBootstrap({ vault_root: vault.root });
		testing.callTool('memory_log', {
			vault_root: vault.root,
			slot_key: 'content:language',
			content: '所有回复使用中文',
		});

		const refreshed = testing.callMemoryBootstrap({ vault_root: vault.root });

		expect(coreMock.memoryStartup).toHaveBeenCalledTimes(1);
		expect(activeDocsMock.refreshTaskboard).toHaveBeenCalledWith(expect.anything(), vault.root);
		expect(activeDocsMock.refreshUserprofile).toHaveBeenCalledWith(expect.anything(), vault.root);
		expect(layer0Mock.buildLayer0Summary).toHaveBeenCalledWith(vault.root);
		expect(refreshed).toMatchObject({
			status: 'ok',
			startup_ran: false,
			layer0_refreshed: true,
			_layer0: 'RefreshedLayer0',
		});
	});

	it('memory_log 连续调用会延迟合并刷新 UserProfile', async () => {
		vi.useFakeTimers();
		testing.callMemoryBootstrap({ vault_root: vault.root });

		testing.callTool('memory_log', {
			vault_root: vault.root,
			slot_key: 'content:language',
			content: '所有回复使用中文',
		});
		testing.callTool('memory_log', {
			vault_root: vault.root,
			slot_key: 'format:latex',
			content: '数学公式使用 LaTeX',
		});

		expect(coreMock.memoryLog).toHaveBeenLastCalledWith(
			expect.objectContaining({ refreshActiveDoc: false }),
		);
		expect(activeDocsMock.refreshUserprofile).not.toHaveBeenCalled();

		vi.advanceTimersByTime(500);

		expect(activeDocsMock.refreshUserprofile).toHaveBeenCalledTimes(1);
		expect(layer0Mock.buildLayer0Summary).toHaveBeenCalledTimes(1);
	});

	it('memory_notify 后再次 bootstrap 会轻量刷新 layer0', async () => {
		testing.callMemoryBootstrap({ vault_root: vault.root });
		testing.callTool('memory_notify', {
			vault_root: vault.root,
			file_path: '20_项目/LearningApp.md',
		});

		const refreshed = testing.callMemoryBootstrap({ vault_root: vault.root });

		expect(coreMock.memoryStartup).toHaveBeenCalledTimes(1);
		expect(activeDocsMock.refreshTaskboard).toHaveBeenCalledWith(expect.anything(), vault.root);
		expect(activeDocsMock.refreshUserprofile).toHaveBeenCalledWith(expect.anything(), vault.root);
		expect(layer0Mock.buildLayer0Summary).toHaveBeenCalledWith(vault.root);
		expect(refreshed).toMatchObject({
			status: 'ok',
			startup_ran: false,
			layer0_refreshed: true,
			_layer0: 'RefreshedLayer0',
		});
	});

	it('vault_root 切换后不会复用其他 vault 的 layer0 缓存', async () => {
		const otherVault = createTempVault();
		try {
			coreMock.memoryStartup.mockImplementation(({ vaultRoot }: { vaultRoot?: string }) => ({
				layer0_summary: `Layer0:${vaultRoot ?? 'unknown'}`,
			}));

			const first = testing.callMemoryBootstrap({ vault_root: vault.root });
			const second = testing.callMemoryBootstrap({ vault_root: otherVault.root });
			const third = testing.callMemoryBootstrap({ vault_root: vault.root });

			expect(first._layer0).toBe(`Layer0:${vault.root}`);
			expect(second._layer0).toBe(`Layer0:${otherVault.root}`);
			expect(third._layer0).toBe(`Layer0:${vault.root}`);
			expect(coreMock.memoryStartup).toHaveBeenCalledTimes(3);
		} finally {
			otherVault.cleanup();
		}
	});

	it('startup 失败后同一 vault 不会重复重试', async () => {
		coreMock.memoryStartup.mockImplementation(() => {
			throw new Error('startup failed');
		});

		const first = testing.callMemoryBootstrap({ vault_root: vault.root });
		const second = testing.callMemoryBootstrap({ vault_root: vault.root });

		expect(coreMock.memoryStartup).toHaveBeenCalledTimes(1);
		expect(first).toMatchObject({
			status: 'error',
			startup_ran: false,
			layer0_refreshed: false,
			_layer0: '',
			startup_error: 'startup failed',
		});
		expect(second).toMatchObject({
			status: 'error',
			startup_ran: false,
			layer0_refreshed: false,
			_layer0: '',
			startup_error: 'startup failed',
		});
	});

	it('startup 失败后切换到其他 vault 会重新尝试 startup', async () => {
		const otherVault = createTempVault();
		try {
			coreMock.memoryStartup
				.mockImplementationOnce(() => {
					throw new Error('startup failed');
				})
				.mockImplementationOnce(({ vaultRoot }: { vaultRoot?: string }) => ({
					layer0_summary: `Layer0:${vaultRoot ?? 'unknown'}`,
				}));

			const failed = testing.callMemoryBootstrap({ vault_root: vault.root });
			const recovered = testing.callMemoryBootstrap({ vault_root: otherVault.root });

			expect(coreMock.memoryStartup).toHaveBeenCalledTimes(2);
			expect(failed).toMatchObject({
				status: 'error',
				startup_error: 'startup failed',
			});
			expect(recovered).toMatchObject({
				status: 'ok',
				startup_ran: true,
				_layer0: `Layer0:${otherVault.root}`,
			});
		} finally {
			otherVault.cleanup();
		}
	});

	it('slot_key schema accepts structured profile topics with dot scope', async () => {
		const mod = await loadServerModule();
		expect(() => mod.slotKeySchema.parse('profile:weak.math_group_theory')).not.toThrow();
		expect(() => mod.slotKeySchema.parse('profile:motivation.learningapp')).not.toThrow();
	});

	it('slot_key schema rejects invalid structured profile topics', async () => {
		const mod = await loadServerModule();
		expect(() => mod.slotKeySchema.parse('profile:动机.learningapp')).toThrow();
		expect(() => mod.slotKeySchema.parse('profile::bad')).toThrow();
		expect(() => mod.slotKeySchema.parse('profile:')).toThrow();
	});
});
