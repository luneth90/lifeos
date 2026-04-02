import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createTempVault } from './setup.js';

function createInitializeMessage(): string {
	const payload = JSON.stringify({
		jsonrpc: '2.0',
		id: 0,
		method: 'initialize',
		params: {
			protocolVersion: '2025-11-25',
			capabilities: {},
			clientInfo: {
				name: 'vitest',
				version: '0.1.0',
			},
		},
	});
	return `${payload}\n`;
}

describe('lifeos bin entry', () => {
	it('通过 bin/lifeos.js 启动时会返回 initialize 响应', async () => {
		const vault = createTempVault();

		try {
			const responseText = await new Promise<string>((resolve, reject) => {
				const child = spawn(process.execPath, ['bin/lifeos.js', '--vault-root', vault.root], {
					cwd: process.cwd(),
					stdio: ['pipe', 'pipe', 'pipe'],
				});

				let stdout = '';
				let stderr = '';

				const timeout = setTimeout(() => {
					child.kill();
					reject(
						new Error(
							`等待 initialize 响应超时。exitCode=${child.exitCode}; stdout=${stdout}; stderr=${stderr}`,
						),
					);
				}, 2000);

				child.stdout.setEncoding('utf8');
				child.stderr.setEncoding('utf8');

				child.stdout.on('data', (chunk: string) => {
					stdout += chunk;
					const firstLine = stdout.split('\n')[0]?.trim();
					if (!firstLine) return;
					clearTimeout(timeout);
					child.kill();
					resolve(firstLine);
				});

				child.stderr.on('data', (chunk: string) => {
					stderr += chunk;
				});

				child.on('error', (error) => {
					clearTimeout(timeout);
					reject(error);
				});

				child.on('exit', (code, signal) => {
					if (stdout.trim()) return;
					clearTimeout(timeout);
					reject(
						new Error(
							`进程在返回 initialize 响应前退出。code=${code}; signal=${signal}; stderr=${stderr}`,
						),
					);
				});

				child.stdin.write(createInitializeMessage());
			});

			const response = JSON.parse(responseText) as {
				result?: {
					serverInfo?: {
						name?: string;
					};
				};
			};

			expect(response.result?.serverInfo?.name).toBe('lifeos');
		} finally {
			vault.cleanup();
		}
	});
});
