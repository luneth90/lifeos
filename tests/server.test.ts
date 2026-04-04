import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type TempVault, createTempVault } from './setup.js';

const coreMock = vi.hoisted(() => ({
	memoryStartup: vi.fn(() => ({ layer0_summary: 'Layer0' })),
	memoryQuery: vi.fn(() => ({ results: [] })),
	memoryLog: vi.fn(() => ({ slotKey: 'test:key', action: 'created' })),
	memoryNotify: vi.fn(() => ({ status: 'ok' })),
}));

vi.mock('../src/core.js', () => coreMock);

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
});
