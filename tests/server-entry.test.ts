import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { describe, expect, it } from 'vitest';
import { toolResultSchemas } from '../src/tool-schemas.js';
import { type TempVault, createTempVault, prepareRuntimeVault, writeTestNote } from './setup.js';

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

function createSourceEntrySandbox(): {
	root: string;
	entry: string;
	cleanup: () => void;
} {
	const repoRoot = process.cwd();
	const tempRoot = join(repoRoot, 'tmp');
	mkdirSync(tempRoot, { recursive: true });
	const root = mkdtempSync(join(tempRoot, 'lifeos-bin-entry-'));

	cpSync(join(repoRoot, 'bin'), join(root, 'bin'), { recursive: true });
	cpSync(join(repoRoot, 'src'), join(root, 'src'), { recursive: true });
	cpSync(join(repoRoot, 'package.json'), join(root, 'package.json'));

	return {
		root,
		entry: join(root, 'bin', 'lifeos.js'),
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

const TOOL_NAMES = [
	'memory_bootstrap',
	'memory_query',
	'memory_context',
	'memory_log',
	'memory_rules',
	'memory_forget',
	'memory_notify',
] as const;

async function withMcpClient<T>(
	vault: TempVault,
	callback: (client: Client) => Promise<T>,
): Promise<T> {
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [join(process.cwd(), 'bin', 'lifeos.js'), '--vault-root', vault.root],
		cwd: process.cwd(),
		stderr: 'pipe',
	});
	const client = new Client({ name: 'vitest', version: '0.1.0' });
	await client.connect(transport);
	try {
		return await callback(client);
	} finally {
		await client.close();
	}
}

function parsedText(result: CallToolResult): unknown {
	const first = result.content[0];
	expect(first?.type).toBe('text');
	if (!first || first.type !== 'text') throw new Error('工具结果缺少文本 JSON');
	return JSON.parse(first.text);
}

function expectEquivalentStructuredResult(result: CallToolResult): void {
	expect(result.isError).not.toBe(true);
	expect(result.structuredContent).toEqual(parsedText(result));
}

function scopedItemFixture(): Record<string, unknown> {
	return {
		itemId: 1,
		slotKey: 'test:structured',
		content: '结构化输出测试',
		itemKind: 'rule',
		scope: { type: 'global', key: '' },
		priority: 50,
		enforcement: 'soft',
		source: 'preference',
		relatedFiles: [],
		manualFlag: false,
		status: 'active',
		createdAt: '2026-08-09T00:00:00.000Z',
		updatedAt: '2026-08-09T00:00:00.000Z',
		expiresAt: null,
		archivedAt: null,
		archiveReason: null,
	};
}

function outputFixtures(): Record<(typeof TOOL_NAMES)[number], Record<string, unknown>> {
	const item = scopedItemFixture();
	return {
		memory_bootstrap: {
			contract_version: 2,
			schema_version: 4,
			status: 'ok',
			startup_ran: true,
			layer0_refreshed: false,
			snapshot_id: 'ctx-test',
			_layer0: 'Layer 0',
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
		},
		memory_query: { results: [] },
		memory_context: {
			snapshotId: 'ctx-test',
			matchedScopes: [],
			effectiveItems: [],
			overriddenItems: [],
			rules: [],
			decisions: [],
			facts: [],
			profiles: [],
			relatedFiles: [],
			text: '',
			diagnostics: {
				unresolvedScopes: [],
				omittedSlotKeys: [],
				oversizedItems: [],
				warnings: [],
			},
		},
		memory_log: { ...item, action: 'created' },
		memory_rules: { items: [item] },
		memory_forget: { archived: 1 },
		memory_notify: {
			action: 'indexed',
			filePath: '40_知识/笔记/结构化输出.md',
			impact: {
				vaultIndexChanged: true,
				backlinksChanged: false,
				taskboardChanged: false,
				profileChanged: false,
				affectedScopes: [],
				changedEntityIds: [],
			},
		},
	};
}

function errorOutputFixtures(): Record<(typeof TOOL_NAMES)[number], Record<string, unknown>> {
	const startupError = { status: 'error', startup_error: '测试启动错误' };
	return {
		memory_bootstrap: {
			contract_version: 2,
			schema_version: 4,
			status: 'error',
			startup_ran: false,
			layer0_refreshed: false,
			snapshot_id: '',
			_layer0: '',
			layer0_meta: null,
			scope_hints: null,
			startup_error: '测试启动错误',
		},
		memory_query: { ...startupError },
		memory_context: { ...startupError },
		memory_log: { ...startupError },
		memory_rules: { ...startupError },
		memory_forget: { ...startupError },
		memory_notify: { ...startupError },
	};
}

describe('lifeos bin entry', () => {
	it('通过 bin/lifeos.js 启动时会返回 initialize 响应', async () => {
		const vault = createTempVault();
		const sandbox = createSourceEntrySandbox();

		try {
			const responseText = await new Promise<string>((resolve, reject) => {
				const child = spawn(process.execPath, [sandbox.entry, '--vault-root', vault.root], {
					cwd: sandbox.root,
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
				}, 5000);

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
			sandbox.cleanup();
			vault.cleanup();
		}
	});

	it('七个工具均发布 outputSchema，严格 Zod 模式拒绝缺字段、错误类型和额外字段', async () => {
		const vault = createTempVault();

		try {
			await withMcpClient(vault, async (client) => {
				const listed = await client.listTools();
				const tools = new Map(listed.tools.map((tool) => [tool.name, tool]));
				expect([...tools.keys()].sort()).toEqual([...TOOL_NAMES].sort());

				const validatorProvider = new AjvJsonSchemaValidator();
				const errorFixtures = errorOutputFixtures();
				for (const [name, fixture] of Object.entries(outputFixtures())) {
					const tool = tools.get(name) as Tool | undefined;
					expect(tool?.outputSchema, `${name} 缺少 outputSchema`).toBeDefined();
					if (!tool?.outputSchema) continue;

					const validate = validatorProvider.getValidator(tool.outputSchema);
					expect(validate(fixture).valid, `${name} 应接受完整结果`).toBe(true);
					expect(validate(errorFixtures[name as keyof typeof errorFixtures]).valid).toBe(true);
					expect(validate([]).valid, `${name} 应拒绝错误类型`).toBe(false);
					expect(validate({ ...fixture, unexpected: true }).valid, `${name} 应拒绝额外字段`).toBe(
						false,
					);

					const strictSchema = toolResultSchemas[name as keyof typeof toolResultSchemas];
					expect(strictSchema.safeParse(fixture).success, `${name} 应接受完整结果`).toBe(true);
					const errorFixture = errorFixtures[name as keyof typeof errorFixtures];
					expect(strictSchema.safeParse(errorFixture).success, `${name} 应接受启动错误`).toBe(true);
					expect(
						strictSchema.safeParse({ ...errorFixture, unexpected: true }).success,
						`${name} 应拒绝错误结果中的额外字段`,
					).toBe(false);
					const incompleteError = { ...errorFixture };
					incompleteError.startup_error = undefined;
					expect(
						strictSchema.safeParse(incompleteError).success,
						`${name} 应拒绝缺少 startup_error 的错误结果`,
					).toBe(false);
					expect(strictSchema.safeParse([]).success, `${name} 应拒绝错误类型`).toBe(false);
					expect(
						strictSchema.safeParse({ ...fixture, unexpected: true }).success,
						`${name} 应拒绝额外字段`,
					).toBe(false);
					const missing = structuredClone(fixture);
					delete missing[Object.keys(missing)[0] as keyof typeof missing];
					expect(strictSchema.safeParse(missing).success, `${name} 应拒绝缺少必要字段`).toBe(false);
				}
			});
		} finally {
			vault.cleanup();
		}
	});

	it('七个工具成功调用均返回与文本 JSON 同值的 structuredContent', async () => {
		const vault = createTempVault();

		try {
			await prepareRuntimeVault(vault);
			writeTestNote(
				vault.root,
				'40_知识/笔记/结构化输出.md',
				{ title: '结构化输出', type: 'note', status: 'review' },
				'用于验证 memory_notify。',
			);

			await withMcpClient(vault, async (client) => {
				const results: CallToolResult[] = [];
				results.push(await client.callTool({ name: 'memory_bootstrap', arguments: {} }));
				results.push(
					await client.callTool({
						name: 'memory_query',
						arguments: { contract_version: 2, query: '结构化输出' },
					}),
				);
				results.push(
					await client.callTool({
						name: 'memory_context',
						arguments: { contract_version: 2, scopes: [] },
					}),
				);
				const logged = await client.callTool({
					name: 'memory_log',
					arguments: {
						contract_version: 2,
						slot_key: 'test:structured',
						content: '结构化输出测试',
						scope: { type: 'global', key: '' },
						item_kind: 'rule',
					},
				});
				results.push(logged);
				const loggedText = logged.content[0];
				expect(
					logged.isError,
					loggedText?.type === 'text' ? loggedText.text : 'memory_log 未返回文本结果',
				).not.toBe(true);
				results.push(
					await client.callTool({
						name: 'memory_rules',
						arguments: { contract_version: 2, slot_key: 'test:structured' },
					}),
				);
				const loggedItem = logged.structuredContent as { itemId?: number } | undefined;
				expect(loggedItem?.itemId, JSON.stringify(logged)).toBeTypeOf('number');
				results.push(
					await client.callTool({
						name: 'memory_forget',
						arguments: {
							contract_version: 2,
							item_id: loggedItem?.itemId,
							reason: '测试结束',
						},
					}),
				);
				results.push(
					await client.callTool({
						name: 'memory_notify',
						arguments: {
							contract_version: 2,
							file_path: '40_知识/笔记/结构化输出.md',
						},
					}),
				);

				expect(results).toHaveLength(TOOL_NAMES.length);
				for (const result of results) expectEquivalentStructuredResult(result);
			});
		} finally {
			vault.cleanup();
		}
	});

	it('输入契约错误继续返回 MCP isError，不触发工具成功结果语义', async () => {
		const vault = createTempVault();

		try {
			await withMcpClient(vault, async (client) => {
				const result = await client.callTool({
					name: 'memory_query',
					arguments: { contract_version: 1, query: '旧协议' },
				});
				expect(result.isError).toBe(true);
				const first = result.content[0];
				expect(first?.type).toBe('text');
				if (first?.type === 'text') expect(first.text).toContain('Input validation error');
				expect(result.structuredContent).toBeUndefined();
			});
		} finally {
			vault.cleanup();
		}
	});
});
