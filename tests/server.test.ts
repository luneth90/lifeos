import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTempVault, type TempVault } from './setup.js';

const coreMock = vi.hoisted(() => ({
	memoryStartup: vi.fn(() => ({ layer0_summary: 'Layer0' })),
	memoryQuery: vi.fn(() => ({ results: [] })),
	memoryRecent: vi.fn(() => ({ events: [] })),
	memoryLog: vi.fn(() => ({ status: 'ok' })),
	memoryAutoCapture: vi.fn(() => ({ captured: 0 })),
	memoryNotify: vi.fn(() => ({ status: 'ok' })),
	memoryCheckpoint: vi.fn(() => ({ session_closed: true })),
	memoryCitations: vi.fn(() => ({ items: [] })),
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
		coreMock.memoryRecent.mockClear();
		coreMock.memoryLog.mockClear();
		coreMock.memoryAutoCapture.mockClear();
		coreMock.memoryNotify.mockClear();
		coreMock.memoryCheckpoint.mockClear();
		coreMock.memoryCitations.mockClear();
		coreMock.memoryStartup.mockReturnValue({ layer0_summary: 'Layer0' });
	});

	afterEach(() => {
		testing.resetState();
		vault.cleanup();
		vi.useRealTimers();
	});

	it('auto checkpoint reuses the vault_root and session_id captured at startup', async () => {
		testing.ensureStartup({
			vault_root: vault.root,
			session_id: 'session-from-first-call',
		});
		testing.runAutoCheckpoint();

		expect(coreMock.memoryCheckpoint).toHaveBeenCalledWith({
			vaultRoot: vault.root,
			sessionId: 'session-from-first-call',
		});
	});

	it('auto checkpoint drains queued notify work before closing the session', async () => {
		testing.ensureStartup({
			vault_root: vault.root,
			session_id: 'session-with-queued-notify',
		});
		testing.enqueueNotify({
			vaultRoot: vault.root,
			filename: '40_知识/笔记/测试.md',
		});
		testing.runAutoCheckpoint();

		expect(coreMock.memoryNotify).toHaveBeenCalledWith({
			filePath: '40_知识/笔记/测试.md',
			vaultRoot: vault.root,
		});
		expect(coreMock.memoryNotify.mock.invocationCallOrder[0]).toBeLessThan(
			coreMock.memoryCheckpoint.mock.invocationCallOrder[0],
		);
	});

	it('auto checkpoint flushes debounced notifies before closing the session', async () => {
		vi.useFakeTimers();

		testing.ensureStartup({
			vault_root: vault.root,
			session_id: 'session-with-pending-notify',
		});
		testing.debouncedNotify(vault.root, '20_项目/测试项目.md');
		testing.runAutoCheckpoint();

		expect(coreMock.memoryNotify).toHaveBeenCalledWith({
			filePath: '20_项目/测试项目.md',
			vaultRoot: vault.root,
		});
		expect(coreMock.memoryCheckpoint).toHaveBeenCalledTimes(1);
	});
});
