/**
 * server.ts — LifeOS V2 MCP 服务入口。
 *
 * bootstrap 是唯一返回 Layer 0 的工具。其余工具要求 contract_version=2，
 * 并且在启动 Vault、打开数据库或执行任何业务逻辑前完成契约校验。
 */

import { type FSWatcher, watch } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { VERSION } from './cli/utils/version.js';
import * as core from './core.js';
import { SCHEMA_VERSION } from './db/schema.js';
import { CONTRACT_VERSION } from './runtime-contract.js';
import type { MemoryScope, ScopeType, StartupResult } from './types.js';

export const slotKeySchema = z
	.string()
	.regex(/^[a-z]+:[a-z0-9_.-]+$/, 'slot_key 必须使用“<类别>:<主题>”格式，例如 format:latex');

export const contractVersionSchema = z.literal(CONTRACT_VERSION);

const scopeTypeSchema = z.enum(['global', 'skill', 'project', 'repository', 'tool', 'file']);

export const memoryScopeSchema = z
	.object({
		type: scopeTypeSchema,
		key: z.string(),
	})
	.superRefine((scope, ctx) => {
		if (scope.type === 'global' && scope.key !== '') {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['key'],
				message: 'global scope 的 key 必须为空字符串',
			});
		}
		if (scope.type !== 'global' && scope.key.trim() === '') {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['key'],
				message: `${scope.type} scope 的 key 不得为空`,
			});
		}
	});

function snakeToCamel(key: string): string {
	return key.replace(/_([a-z])/g, (_, character: string) => character.toUpperCase());
}

function deepConvertKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(deepConvertKeys);
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
				snakeToCamel(key),
				deepConvertKeys(nested),
			]),
		);
	}
	return value;
}

function normalizeParams<P extends Record<string, unknown>>(params: P): Record<string, unknown> {
	const converted = deepConvertKeys(params) as Record<string, unknown>;
	if (converted.dbPath === '') converted.dbPath = undefined;
	if (converted.vaultRoot === '') converted.vaultRoot = undefined;
	// memory_query 的 filters 使用数据库公开字段名，不能转换为 camelCase。
	if ('filters' in params) converted.filters = params.filters;
	return converted;
}

function assertRequestContract(params: Record<string, unknown>): void {
	if (params.contractVersion !== CONTRACT_VERSION) {
		throw new Error(
			`LifeOS contract_version 必须为 ${CONTRACT_VERSION}，收到 ${String(params.contractVersion)}`,
		);
	}
}

interface RuntimeContext {
	key: string;
	vaultRoot: string;
	dbPath?: string;
	started: boolean;
	startupResult: StartupResult | null;
	startupError: string | null;
	layer0Dirty: boolean;
	globalVersion: number;
	scopeVersions: Map<string, number>;
	watcher: FSWatcher | null;
	pendingFiles: Set<string>;
	batchTimer: NodeJS.Timeout | null;
	notifyInFlight: boolean;
	maintenanceTimer: NodeJS.Immediate | null;
}

const runtimes = new Map<string, RuntimeContext>();
const DEBOUNCE_MS = 500;

function resolveRuntimeIdentity(params: Record<string, unknown>): {
	key: string;
	vaultRoot: string;
	dbPath?: string;
} {
	const rawVault =
		(typeof params.vaultRoot === 'string' && params.vaultRoot) ||
		process.env.LIFEOS_VAULT_ROOT ||
		process.cwd();
	const vaultRoot = resolve(rawVault);
	const dbPath =
		typeof params.dbPath === 'string' && params.dbPath ? resolve(params.dbPath) : undefined;
	return {
		key: `${vaultRoot}\u0000${dbPath ?? ''}`,
		vaultRoot,
		dbPath,
	};
}

function getRuntime(params: Record<string, unknown>): RuntimeContext {
	const identity = resolveRuntimeIdentity(params);
	const existing = runtimes.get(identity.key);
	if (existing) return existing;

	const runtime: RuntimeContext = {
		...identity,
		started: false,
		startupResult: null,
		startupError: null,
		layer0Dirty: false,
		globalVersion: 0,
		scopeVersions: new Map(),
		watcher: null,
		pendingFiles: new Set(),
		batchTimer: null,
		notifyInFlight: false,
		maintenanceTimer: null,
	};
	runtimes.set(identity.key, runtime);
	return runtime;
}

function scopeCacheKey(scope: MemoryScope): string {
	return `${scope.type}:${scope.key}`;
}

function invalidateScope(runtime: RuntimeContext, scope: MemoryScope): void {
	const key = scopeCacheKey(scope);
	runtime.scopeVersions.set(key, (runtime.scopeVersions.get(key) ?? 0) + 1);
}

function invalidateLayer0(runtime: RuntimeContext): void {
	runtime.layer0Dirty = true;
	runtime.globalVersion += 1;
}

function isMemoryScope(value: unknown): value is MemoryScope {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.type === 'string' &&
		['global', 'skill', 'project', 'repository', 'tool', 'file'].includes(candidate.type) &&
		typeof candidate.key === 'string'
	);
}

function applyNotifyInvalidation(runtime: RuntimeContext, result: unknown): void {
	if (!result || typeof result !== 'object') {
		invalidateLayer0(runtime);
		return;
	}

	const record = result as Record<string, unknown>;
	const invalidation =
		record.invalidation && typeof record.invalidation === 'object'
			? (record.invalidation as Record<string, unknown>)
			: record.impact && typeof record.impact === 'object'
				? (record.impact as Record<string, unknown>)
				: record;
	const scopes = invalidation.scopes ?? invalidation.affectedScopes;
	if (Array.isArray(scopes)) {
		for (const scope of scopes) {
			if (isMemoryScope(scope)) invalidateScope(runtime, scope);
		}
	}

	const explicitLayer0 =
		invalidation.layer0 ??
		invalidation.layer0Dirty ??
		invalidation.affectsLayer0 ??
		(invalidation.taskboardChanged === true || invalidation.profileChanged === true
			? true
			: undefined);
	if (explicitLayer0 === true) invalidateLayer0(runtime);
	else if (explicitLayer0 === undefined && !Array.isArray(scopes)) invalidateLayer0(runtime);
}

function runBackgroundMaintenance(runtime: RuntimeContext): void {
	if (runtime.maintenanceTimer) return;
	runtime.maintenanceTimer = setImmediate(() => {
		runtime.maintenanceTimer = null;
		try {
			const result = core.memoryStartupMaintenance({
				contractVersion: CONTRACT_VERSION,
				dbPath: runtime.dbPath,
				vaultRoot: runtime.vaultRoot,
			});
			applyNotifyInvalidation(runtime, result);
		} catch (error) {
			console.warn(`[lifeos] 后台维护失败（${runtime.vaultRoot}）:`, error);
		}
	});
}

function ensureStartup(runtime: RuntimeContext): { startedThisCall: boolean } {
	if (runtime.started) return { startedThisCall: false };
	runtime.started = true;
	try {
		runtime.startupResult = core.memoryStartup({
			dbPath: runtime.dbPath,
			vaultRoot: runtime.vaultRoot,
		});
		runtime.startupError = null;
		startVaultWatcher(runtime);
		runBackgroundMaintenance(runtime);
		return { startedThisCall: true };
	} catch (error) {
		runtime.startupResult = null;
		runtime.startupError = error instanceof Error ? error.message : String(error);
		console.warn(`[lifeos] 启动失败（${runtime.vaultRoot}）:`, error);
		return { startedThisCall: false };
	}
}

function refreshLayer0(runtime: RuntimeContext): { ok: boolean; changed: boolean } {
	const previousSnapshot = runtime.startupResult?.layer0.snapshotId ?? null;
	try {
		runtime.startupResult = core.memoryStartup({
			dbPath: runtime.dbPath,
			vaultRoot: runtime.vaultRoot,
		});
		runtime.startupError = null;
		runtime.layer0Dirty = false;
		return {
			ok: true,
			changed: runtime.startupResult.layer0.snapshotId !== previousSnapshot,
		};
	} catch (error) {
		runtime.startupError = error instanceof Error ? error.message : String(error);
		console.warn(`[lifeos] Layer 0 刷新失败（${runtime.vaultRoot}）:`, error);
		return { ok: false, changed: false };
	}
}

const IGNORE_SEGMENTS = new Set(['.git', '.obsidian', '.trash', 'node_modules']);
const IGNORE_FILE_PATTERNS = [/\.sqlite/, /\.DS_Store$/, /~$/, /\.tmp$/, /\.swp$/];

function shouldIgnore(filename: string): boolean {
	const segments = filename.split('/');
	if (segments.some((segment) => segment.startsWith('.') || IGNORE_SEGMENTS.has(segment))) {
		return true;
	}
	return IGNORE_FILE_PATTERNS.some((pattern) => pattern.test(filename));
}

function flushNotifyBatch(runtime: RuntimeContext): void {
	if (runtime.notifyInFlight || runtime.pendingFiles.size === 0) return;
	runtime.notifyInFlight = true;
	const files = [...runtime.pendingFiles].sort();
	runtime.pendingFiles.clear();
	try {
		const result = core.memoryNotifyBatch({
			contractVersion: CONTRACT_VERSION,
			dbPath: runtime.dbPath,
			vaultRoot: runtime.vaultRoot,
			filePaths: files,
		});
		applyNotifyInvalidation(runtime, result);
	} finally {
		runtime.notifyInFlight = false;
		if (runtime.pendingFiles.size > 0) scheduleNotifyBatch(runtime);
	}
}

function scheduleNotifyBatch(runtime: RuntimeContext): void {
	if (runtime.batchTimer) clearTimeout(runtime.batchTimer);
	runtime.batchTimer = setTimeout(() => {
		runtime.batchTimer = null;
		try {
			flushNotifyBatch(runtime);
		} catch (error) {
			console.warn(`[lifeos] 文件通知批次失败（${runtime.vaultRoot}）:`, error);
		}
	}, DEBOUNCE_MS);
}

function debouncedNotify(runtime: RuntimeContext, filename: string): void {
	runtime.pendingFiles.add(filename);
	scheduleNotifyBatch(runtime);
}

function startVaultWatcher(runtime: RuntimeContext): void {
	if (runtime.watcher) return;
	try {
		runtime.watcher = watch(runtime.vaultRoot, { recursive: true }, (_event, filename) => {
			if (!filename || shouldIgnore(filename) || !filename.endsWith('.md')) return;
			debouncedNotify(runtime, filename);
		});
		runtime.watcher.on('error', (error) => {
			console.warn(`[lifeos] Vault watcher 失败（${runtime.vaultRoot}）:`, error);
		});
	} catch (error) {
		console.warn(`[lifeos] 无法启动 Vault watcher（${runtime.vaultRoot}）:`, error);
	}
}

function closeRuntime(runtime: RuntimeContext): void {
	if (runtime.batchTimer) clearTimeout(runtime.batchTimer);
	if (runtime.maintenanceTimer) clearImmediate(runtime.maintenanceTimer);
	runtime.watcher?.close();
	runtime.batchTimer = null;
	runtime.maintenanceTimer = null;
	runtime.watcher = null;
	runtime.pendingFiles.clear();
}

function resetRuntimeState(): void {
	for (const runtime of runtimes.values()) closeRuntime(runtime);
	runtimes.clear();
}

function setupShutdownHandler(): void {
	process.stdin.on('end', () => {
		resetRuntimeState();
		process.exit(0);
	});
}

function serializeOutput(output: unknown): { content: { type: 'text'; text: string }[] } {
	return { content: [{ type: 'text' as const, text: JSON.stringify(output) }] };
}

interface BootstrapOutput {
	contract_version: number;
	schema_version: number;
	status: 'ok' | 'error';
	startup_ran: boolean;
	layer0_refreshed: boolean;
	snapshot_id: string;
	_layer0: string;
	layer0_meta: unknown;
	scope_hints: unknown;
	startup_error?: string;
}

function runMemoryBootstrap(params: Record<string, unknown>): BootstrapOutput {
	const converted = normalizeParams(params);
	const runtime = getRuntime(converted);
	const { startedThisCall } = ensureStartup(runtime);
	if (runtime.startupError) {
		return {
			contract_version: CONTRACT_VERSION,
			schema_version: SCHEMA_VERSION,
			status: 'error',
			startup_ran: false,
			layer0_refreshed: false,
			snapshot_id: '',
			_layer0: '',
			layer0_meta: null,
			scope_hints: null,
			startup_error: runtime.startupError,
		};
	}

	let layer0Refreshed = false;
	if (!startedThisCall) {
		const refreshed = refreshLayer0(runtime);
		if (!refreshed.ok) {
			return {
				contract_version: CONTRACT_VERSION,
				schema_version: SCHEMA_VERSION,
				status: 'error',
				startup_ran: false,
				layer0_refreshed: false,
				snapshot_id: '',
				_layer0: '',
				layer0_meta: null,
				scope_hints: null,
				startup_error: runtime.startupError ?? 'Layer 0 刷新失败',
			};
		}
		layer0Refreshed = refreshed.changed;
	}
	const result = runtime.startupResult;
	const meta = result?.layer0.meta;
	return {
		contract_version: CONTRACT_VERSION,
		schema_version: SCHEMA_VERSION,
		status: 'ok',
		startup_ran: startedThisCall,
		layer0_refreshed: layer0Refreshed,
		snapshot_id: result?.layer0.snapshotId ?? '',
		_layer0: result?.layer0.text ?? '',
		layer0_meta: meta
			? {
					token_estimate: meta.tokenEstimate,
					token_budget: meta.tokenBudget,
					global_items_total: meta.globalItemsTotal,
					global_items_loaded: meta.globalItemsLoaded,
					omitted_slot_keys: meta.omittedSlotKeys,
					oversized_items: meta.oversizedItems,
					warnings: meta.warnings,
					sections: {
						global_rules: meta.sections.globalRules,
						taskboard_focus: meta.sections.taskboardFocus,
						userprofile_summary: meta.sections.userprofileSummary,
						revision_reminder: meta.sections.revisionReminder,
					},
				}
			: null,
		scope_hints: result
			? {
					available_projects: result.scopeHints.availableProjects,
					available_skills: result.scopeHints.availableSkills,
				}
			: null,
	};
}

interface RunToolOptions {
	afterSuccess?: (
		runtime: RuntimeContext,
		params: Record<string, unknown>,
		result: unknown,
	) => void;
}

function runTool<P extends Record<string, unknown>>(
	// biome-ignore lint/suspicious/noExplicitAny: MCP 工具具有不同的最终参数类型。
	coreFn: (params: any) => unknown,
	params: P,
	options: RunToolOptions = {},
): unknown {
	const converted = normalizeParams(params);
	// 必须早于 getRuntime/ensureStartup，保证旧客户端不会触碰 Vault 或数据库。
	assertRequestContract(converted);
	const runtime = getRuntime(converted);
	ensureStartup(runtime);
	if (runtime.startupError) {
		return { status: 'error' as const, startup_error: runtime.startupError };
	}
	const result = coreFn(converted);
	options.afterSuccess?.(runtime, converted, result);
	return result;
}

function handleTool<P extends Record<string, unknown>>(
	// biome-ignore lint/suspicious/noExplicitAny: MCP 工具具有不同的最终参数类型。
	coreFn: (params: any) => unknown,
	options: RunToolOptions = {},
): (params: P) => Promise<{ content: { type: 'text'; text: string }[] }> {
	return async (params: P) => serializeOutput(runTool(coreFn, params, options));
}

function handleBootstrap<P extends Record<string, unknown>>(): (
	params: P,
) => Promise<{ content: { type: 'text'; text: string }[] }> {
	return async (params: P) => serializeOutput(runMemoryBootstrap(params));
}

function invalidateFromMemoryLog(
	runtime: RuntimeContext,
	_params: Record<string, unknown>,
	result: unknown,
): void {
	invalidateFromArchivedItem(runtime, result);
}

function invalidateFromArchivedItem(runtime: RuntimeContext, result: unknown): void {
	if (!result || typeof result !== 'object') return;
	const record = result as Record<string, unknown>;
	const scope = record.scope;
	if (isMemoryScope(scope)) {
		if (scope.type === 'global') invalidateLayer0(runtime);
		else invalidateScope(runtime, scope);
		return;
	}
	const scopeType = record.scopeType;
	const scopeKey = record.scopeKey;
	if (typeof scopeType === 'string' && typeof scopeKey === 'string') {
		const normalized = { type: scopeType as ScopeType, key: scopeKey };
		if (scopeType === 'global') invalidateLayer0(runtime);
		else invalidateScope(runtime, normalized);
	}
}

const server = new McpServer({ name: 'lifeos', version: VERSION });

server.tool(
	'memory_bootstrap',
	'启动 LifeOS 会话并返回仅含全局信息的 Layer 0 上下文。',
	{
		db_path: z.string().default(''),
		vault_root: z.string().default(''),
	},
	handleBootstrap(),
);

server.tool(
	'memory_query',
	'检索 Vault 中已索引的笔记、项目和知识。',
	{
		contract_version: contractVersionSchema,
		db_path: z.string().default(''),
		vault_root: z.string().default(''),
		query: z.string().default(''),
		filters: z.record(z.string()).optional(),
		limit: z.number().int().min(1).max(50).default(10),
	},
	handleTool(core.memoryQuery),
);

server.tool(
	'memory_context',
	'在完成任务路由后，按显式作用域读取局部规则、决策、事实与关联文件。',
	{
		contract_version: contractVersionSchema,
		db_path: z.string().default(''),
		vault_root: z.string().default(''),
		scopes: z.array(memoryScopeSchema).default([]),
		include_global: z.boolean().default(false),
		include_related_files: z.boolean().default(true),
		token_budget: z.number().int().nonnegative().optional(),
	},
	handleTool((params: Record<string, unknown>) => {
		const { contractVersion, dbPath, vaultRoot, ...request } = params;
		return core.memoryContext({
			contractVersion: contractVersion as number,
			dbPath: dbPath as string | undefined,
			vaultRoot: vaultRoot as string | undefined,
			request: request as unknown as Parameters<typeof core.memoryContext>[0]['request'],
		});
	}),
);

server.tool(
	'memory_log',
	'写入一条显式作用域的规则、决策、事实或画像；不接受 event。',
	{
		contract_version: contractVersionSchema,
		db_path: z.string().default(''),
		vault_root: z.string().default(''),
		slot_key: slotKeySchema,
		content: z.string().min(1),
		scope: memoryScopeSchema,
		item_kind: z.enum(['rule', 'decision', 'fact', 'profile']),
		priority: z.number().int().min(0).max(100).optional(),
		enforcement: z.enum(['hard', 'soft']).optional(),
		source: z.enum(['preference', 'correction']).optional(),
		related_files: z.array(z.string()).optional(),
		expires_at: z.string().nullable().optional(),
	},
	handleTool(core.memoryLog, { afterSuccess: invalidateFromMemoryLog }),
);

server.tool(
	'memory_rules',
	'按状态、类型、作用域或 slot_key 审计记忆条目。',
	{
		contract_version: contractVersionSchema,
		db_path: z.string().default(''),
		vault_root: z.string().default(''),
		item_kind: z.enum(['rule', 'decision', 'fact', 'profile', 'event']).optional(),
		scope: memoryScopeSchema.optional(),
		status: z.enum(['active', 'expired', 'archived']).optional(),
		slot_key: slotKeySchema.optional(),
		limit: z.number().int().min(1).max(500).optional(),
	},
	handleTool((params: Record<string, unknown>) => {
		const { contractVersion, dbPath, vaultRoot, ...filters } = params;
		return core.memoryRules({
			contractVersion: contractVersion as number,
			dbPath: dbPath as string | undefined,
			vaultRoot: vaultRoot as string | undefined,
			filters: filters as Parameters<typeof core.memoryRules>[0]['filters'],
		});
	}),
);

server.tool(
	'memory_forget',
	'按 item_id 软归档记忆条目，并强制记录原因。',
	{
		contract_version: contractVersionSchema,
		db_path: z.string().default(''),
		vault_root: z.string().default(''),
		item_id: z.number().int().positive(),
		reason: z.string().min(1),
	},
	handleTool(core.memoryForget, { afterSuccess: invalidateFromArchivedItem }),
);

server.tool(
	'memory_notify',
	'通知 LifeOS 某个 Vault 文件已创建、修改、移动或删除。',
	{
		contract_version: contractVersionSchema,
		db_path: z.string().default(''),
		vault_root: z.string().default(''),
		file_path: z.string().min(1),
		previous_file_path: z.string().min(1).optional(),
	},
	handleTool(core.memoryNotify, {
		afterSuccess: (runtime, _params, result) => applyNotifyInvalidation(runtime, result),
	}),
);

export async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const vaultRootIndex = args.indexOf('--vault-root');
	if (vaultRootIndex !== -1 && args[vaultRootIndex + 1]) {
		process.env.LIFEOS_VAULT_ROOT = args[vaultRootIndex + 1];
	}
	const transport = new StdioServerTransport();
	await server.connect(transport);
	setupShutdownHandler();
}

export const __testing = {
	ensureStartup(params: Record<string, unknown>) {
		return ensureStartup(getRuntime(normalizeParams(params)));
	},
	callMemoryBootstrap(params: Record<string, unknown>) {
		return runMemoryBootstrap(params);
	},
	callTool(
		name:
			| 'memory_query'
			| 'memory_context'
			| 'memory_log'
			| 'memory_rules'
			| 'memory_forget'
			| 'memory_notify',
		params: Record<string, unknown>,
	) {
		switch (name) {
			case 'memory_query':
				return runTool(core.memoryQuery, params);
			case 'memory_context':
				return runTool((p: Record<string, unknown>) => {
					const { contractVersion, dbPath, vaultRoot, ...request } = p;
					return core.memoryContext({
						contractVersion: contractVersion as number,
						dbPath: dbPath as string | undefined,
						vaultRoot: vaultRoot as string | undefined,
						request: request as unknown as Parameters<typeof core.memoryContext>[0]['request'],
					});
				}, params);
			case 'memory_log':
				return runTool(core.memoryLog, params, { afterSuccess: invalidateFromMemoryLog });
			case 'memory_rules':
				return runTool((p: Record<string, unknown>) => {
					const { contractVersion, dbPath, vaultRoot, ...filters } = p;
					return core.memoryRules({
						contractVersion: contractVersion as number,
						dbPath: dbPath as string | undefined,
						vaultRoot: vaultRoot as string | undefined,
						filters: filters as Parameters<typeof core.memoryRules>[0]['filters'],
					});
				}, params);
			case 'memory_forget':
				return runTool(core.memoryForget, params, { afterSuccess: invalidateFromArchivedItem });
			case 'memory_notify':
				return runTool(core.memoryNotify, params, {
					afterSuccess: (runtime, _params, result) => applyNotifyInvalidation(runtime, result),
				});
		}
	},
	debouncedNotify(vaultRoot: string, filename: string) {
		const runtime = getRuntime({ vaultRoot });
		debouncedNotify(runtime, filename);
	},
	batchNotifyFlush(vaultRoot?: string) {
		const targets = vaultRoot ? [getRuntime({ vaultRoot })] : [...runtimes.values()];
		for (const runtime of targets) {
			if (runtime.batchTimer) clearTimeout(runtime.batchTimer);
			runtime.batchTimer = null;
			flushNotifyBatch(runtime);
		}
	},
	runtimeCount() {
		return runtimes.size;
	},
	runtimeState(params: Record<string, unknown>) {
		const runtime = getRuntime(normalizeParams(params));
		return {
			started: runtime.started,
			layer0Dirty: runtime.layer0Dirty,
			globalVersion: runtime.globalVersion,
			scopeVersions: Object.fromEntries(runtime.scopeVersions),
		};
	},
	resetState: resetRuntimeState,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(console.error);
}
