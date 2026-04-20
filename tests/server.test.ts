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

vi.mock('../src/core.js', () => coreMock);
vi.mock('../src/services/layer0.js', () => layer0Mock);

async function loadServerTesting() {
	vi.resetModules();
	const mod = await import('../src/server.js');
	return mod.__testing;
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
		expect(layer0Mock.buildLayer0Summary).toHaveBeenCalledWith(vault.root);
		expect(refreshed).toMatchObject({
			status: 'ok',
			startup_ran: false,
			layer0_refreshed: true,
			_layer0: 'RefreshedLayer0',
		});
	});

	it('memory_notify 后再次 bootstrap 会轻量刷新 layer0', async () => {
		testing.callMemoryBootstrap({ vault_root: vault.root });
		testing.callTool('memory_notify', {
			vault_root: vault.root,
			file_path: '20_项目/LearningApp.md',
		});

		const refreshed = testing.callMemoryBootstrap({ vault_root: vault.root });

		expect(coreMock.memoryStartup).toHaveBeenCalledTimes(1);
		expect(layer0Mock.buildLayer0Summary).toHaveBeenCalledWith(vault.root);
		expect(refreshed).toMatchObject({
			status: 'ok',
			startup_ran: false,
			layer0_refreshed: true,
			_layer0: 'RefreshedLayer0',
		});
	});
});
