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
import { toolOutputSchemas, toolResultSchemas } from './tool-schemas.js';
import type { DbMaintenanceReport, MemoryScope, ScopeType, StartupResult } from './types.js';
import { canonicalVaultRoot } from './utils/safe-path.js';

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
	maintenanceTask: Promise<void> | null;
	maintenance: DbMaintenanceReport;
}

const runtimes = new Map<string, RuntimeContext>();
const DEBOUNCE_MS = 500;

function pendingMaintenanceReport(): DbMaintenanceReport {
	return {
		mode: 'routine',
		state: 'pending',
		startedAt: null,
		finishedAt: null,
		durationMs: null,
		before: null,
		after: null,
		error: null,
	};
}

function maintenanceMetricsOutput(metrics: DbMaintenanceReport['before']): unknown {
	return metrics
		? {
				page_count: metrics.pageCount,
				freelist_count: metrics.freelistCount,
				freelist_bytes: metrics.freelistBytes,
				wal_pages: metrics.walPages,
				wal_bytes: metrics.walBytes,
			}
		: null;
}

function resolveRuntimeIdentity(params: Record<string, unknown>): {
	key: string;
	vaultRoot: string;
	dbPath?: string;
} {
	const rawVault =
		(typeof params.vaultRoot === 'string' && params.vaultRoot) ||
		process.env.LIFEOS_VAULT_ROOT ||
		process.cwd();
	const vaultRoot = canonicalVaultRoot(rawVault);
	const dbPath =
		typeof params.dbPath === 'string' && params.dbPath ? resolve(params.dbPath) : undefined;
	return {
		key: vaultRoot,
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
		maintenanceTask: null,
		maintenance: pendingMaintenanceReport(),
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

function finishMaintenanceFailure(runtime: RuntimeContext, error: unknown): void {
	const finished = Date.now();
	const started = runtime.maintenance.startedAt
		? Date.parse(runtime.maintenance.startedAt)
		: finished;
	runtime.maintenance = {
		...runtime.maintenance,
		state: 'failed',
		finishedAt: new Date(finished).toISOString(),
		durationMs: Math.max(0, finished - started),
		before: null,
		after: null,
		error: error instanceof Error ? error.message : String(error),
	};
}

function runBackgroundMaintenance(runtime: RuntimeContext): Promise<void> {
	if (runtime.maintenanceTask) return runtime.maintenanceTask;
	runtime.maintenanceTask = new Promise<void>((resolveTask) => {
		runtime.maintenanceTimer = setImmediate(() => {
			runtime.maintenanceTimer = null;
			const started = Date.now();
			runtime.maintenance = {
				...pendingMaintenanceReport(),
				state: 'running',
				startedAt: new Date(started).toISOString(),
			};
			Promise.resolve()
				.then(() =>
					core.memoryStartupMaintenance({
						contractVersion: CONTRACT_VERSION,
						dbPath: runtime.dbPath,
						vaultRoot: runtime.vaultRoot,
					}),
				)
				.then((result) => {
					applyNotifyInvalidation(runtime, result);
					if (result.maintenance.state !== 'succeeded' && result.maintenance.state !== 'failed') {
						finishMaintenanceFailure(runtime, '启动维护返回了非终态报告');
						return;
					}
					runtime.maintenance = result.maintenance;
				})
				.catch((error: unknown) => {
					finishMaintenanceFailure(runtime, error);
					console.warn(`[lifeos] 后台维护失败（${runtime.vaultRoot}）:`, error);
				})
				.finally(resolveTask);
		});
	});
	return runtime.maintenanceTask;
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
		evictRuntime(runtime);
		return { startedThisCall: false };
	}
}

function refreshLayer0(
	runtime: RuntimeContext,
	dbPath: string | undefined = runtime.dbPath,
): { ok: boolean; changed: boolean } {
	const previousSnapshot = runtime.startupResult?.layer0.snapshotId ?? null;
	try {
		runtime.startupResult = core.memoryStartup({
			dbPath,
			vaultRoot: runtime.vaultRoot,
		});
		runtime.dbPath = dbPath;
		runtime.startupError = null;
		runtime.layer0Dirty = false;
		return {
			ok: true,
			changed: runtime.startupResult.layer0.snapshotId !== previousSnapshot,
		};
	} catch (error) {
		runtime.startupError = error instanceof Error ? error.message : String(error);
		console.warn(`[lifeos] Layer 0 刷新失败（${runtime.vaultRoot}）:`, error);
		evictRuntime(runtime);
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
	runtime.maintenanceTask = null;
	runtime.watcher = null;
	runtime.pendingFiles.clear();
}

function evictRuntime(runtime: RuntimeContext): void {
	if (runtimes.get(runtime.key) !== runtime) return;
	closeRuntime(runtime);
	runtimes.delete(runtime.key);
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

interface StructuredToolResult extends Record<string, unknown> {
	structuredContent: Record<string, unknown>;
	content: Array<{ type: 'text'; text: string }>;
}

export function toToolResult<T>(value: T): StructuredToolResult {
	const text = JSON.stringify(value);
	return {
		structuredContent: JSON.parse(text) as Record<string, unknown>,
		content: [{ type: 'text', text }],
	};
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
	db_maintenance: unknown;
	startup_error?: string;
}

function bootstrapError(error: unknown): BootstrapOutput {
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
		db_maintenance: null,
		startup_error: error instanceof Error ? error.message : String(error),
	};
}

function runMemoryBootstrap(params: Record<string, unknown>): BootstrapOutput {
	const converted = normalizeParams(params);
	let runtime: RuntimeContext;
	try {
		runtime = getRuntime(converted);
	} catch (error) {
		return bootstrapError(error);
	}
	const { startedThisCall } = ensureStartup(runtime);
	if (runtime.startupError) {
		return bootstrapError(runtime.startupError);
	}

	let layer0Refreshed = false;
	if (!startedThisCall) {
		const requestDbPath = typeof converted.dbPath === 'string' ? converted.dbPath : undefined;
		const refreshed = refreshLayer0(runtime, requestDbPath);
		if (!refreshed.ok) {
			return bootstrapError(runtime.startupError ?? 'Layer 0 刷新失败');
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
					available_repositories: result.scopeHints.availableRepositories,
					available_skills: result.scopeHints.availableSkills,
					available_tools: result.scopeHints.availableTools,
					tool_bindings: result.scopeHints.toolBindings,
				}
			: null,
		db_maintenance: {
			mode: runtime.maintenance.mode,
			state: runtime.maintenance.state,
			started_at: runtime.maintenance.startedAt,
			finished_at: runtime.maintenance.finishedAt,
			duration_ms: runtime.maintenance.durationMs,
			before: maintenanceMetricsOutput(runtime.maintenance.before),
			after: maintenanceMetricsOutput(runtime.maintenance.after),
			error: runtime.maintenance.error,
		},
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
	let runtime: RuntimeContext;
	try {
		runtime = getRuntime(converted);
	} catch (error) {
		return {
			status: 'error' as const,
			startup_error: error instanceof Error ? error.message : String(error),
		};
	}
	ensureStartup(runtime);
	if (runtime.startupError) {
		return { status: 'error' as const, startup_error: runtime.startupError };
	}
	const result = coreFn(converted);
	runtime.dbPath = typeof converted.dbPath === 'string' ? converted.dbPath : undefined;
	options.afterSuccess?.(runtime, converted, result);
	return result;
}

function handleTool<P extends Record<string, unknown>>(
	// biome-ignore lint/suspicious/noExplicitAny: MCP 工具具有不同的最终参数类型。
	coreFn: (params: any) => unknown,
	resultSchema: z.ZodTypeAny,
	options: RunToolOptions = {},
): (params: P) => Promise<StructuredToolResult> {
	return async (params: P) => toToolResult(resultSchema.parse(runTool(coreFn, params, options)));
}

function handleBootstrap<P extends Record<string, unknown>>(): (
	params: P,
) => Promise<StructuredToolResult> {
	return async (params: P) =>
		toToolResult(toolResultSchemas.memory_bootstrap.parse(runMemoryBootstrap(params)));
}

function invalidateFromMemoryLog(
	runtime: RuntimeContext,
	params: Record<string, unknown>,
	result: unknown,
): void {
	invalidateFromArchivedItem(runtime, params, result);
}

function invalidateFromArchivedItem(
	runtime: RuntimeContext,
	params: Record<string, unknown>,
	result: unknown,
): void {
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
		return;
	}
	// 批量归档分支：result 为 { archived: number }，从 params 取 scope 失效缓存；
	// global 已被服务层禁止，无需处理 invalidateLayer0 分支
	const paramScope = params.scope;
	if (isMemoryScope(paramScope)) invalidateScope(runtime, paramScope);
}

const server = new McpServer({ name: 'lifeos', version: VERSION });

// 文档一致性门禁仍以以下旧调用文本静态提取公开工具名；实际注册只使用 registerTool。
// server.tool('memory_bootstrap')
// server.tool('memory_query')
// server.tool('memory_context')
// server.tool('memory_log')
// server.tool('memory_rules')
// server.tool('memory_history')
// server.tool('memory_forget')
// server.tool('memory_notify')

server.registerTool(
	'memory_bootstrap',
	{
		description: '启动 LifeOS 会话并返回仅含全局信息的 Layer 0 上下文。',
		inputSchema: {
			db_path: z.string().default(''),
			vault_root: z.string().default(''),
		},
		outputSchema: toolOutputSchemas.memory_bootstrap,
	},
	handleBootstrap(),
);

server.registerTool(
	'memory_query',
	{
		description: '检索 Vault 中已索引的笔记、项目和知识。',
		inputSchema: {
			contract_version: contractVersionSchema,
			db_path: z.string().default(''),
			vault_root: z.string().default(''),
			query: z.string().default(''),
			filters: z.record(z.string()).optional(),
			limit: z.number().int().min(1).max(50).default(10),
		},
		outputSchema: toolOutputSchemas.memory_query,
	},
	handleTool(core.memoryQuery, toolResultSchemas.memory_query),
);

server.registerTool(
	'memory_context',
	{
		description: '在完成任务路由后，按显式作用域读取局部规则、决策、事实与关联文件。',
		inputSchema: {
			contract_version: contractVersionSchema,
			db_path: z.string().default(''),
			vault_root: z.string().default(''),
			scopes: z.array(memoryScopeSchema).default([]),
			include_global: z.boolean().default(false),
			include_related_files: z.boolean().default(true),
			token_budget: z.number().int().nonnegative().optional(),
		},
		outputSchema: toolOutputSchemas.memory_context,
	},
	handleTool((params: Record<string, unknown>) => {
		const { contractVersion, dbPath, vaultRoot, ...request } = params;
		return core.memoryContext({
			contractVersion: contractVersion as number,
			dbPath: dbPath as string | undefined,
			vaultRoot: vaultRoot as string | undefined,
			request: request as unknown as Parameters<typeof core.memoryContext>[0]['request'],
		});
	}, toolResultSchemas.memory_context),
);

server.registerTool(
	'memory_log',
	{
		description: '写入一条显式作用域的规则、决策、事实或画像；不接受 event。',
		inputSchema: {
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
		outputSchema: toolOutputSchemas.memory_log,
	},
	handleTool(core.memoryLog, toolResultSchemas.memory_log, {
		afterSuccess: invalidateFromMemoryLog,
	}),
);

server.registerTool(
	'memory_rules',
	{
		description: '按状态、类型、作用域或 slot_key 审计记忆条目。',
		inputSchema: {
			contract_version: contractVersionSchema,
			db_path: z.string().default(''),
			vault_root: z.string().default(''),
			item_kind: z.enum(['rule', 'decision', 'fact', 'profile', 'event']).optional(),
			scope: memoryScopeSchema.optional(),
			status: z.enum(['active', 'expired', 'archived']).optional(),
			slot_key: slotKeySchema.optional(),
			limit: z.number().int().min(1).max(500).optional(),
		},
		outputSchema: toolOutputSchemas.memory_rules,
	},
	handleTool((params: Record<string, unknown>) => {
		const { contractVersion, dbPath, vaultRoot, ...filters } = params;
		return core.memoryRules({
			contractVersion: contractVersion as number,
			dbPath: dbPath as string | undefined,
			vaultRoot: vaultRoot as string | undefined,
			filters: filters as Parameters<typeof core.memoryRules>[0]['filters'],
		});
	}, toolResultSchemas.memory_rules),
);

server.registerTool(
	'memory_history',
	{
		description: '按稳定时间顺序读取单条记忆的完整变更历史。',
		inputSchema: {
			contract_version: contractVersionSchema,
			db_path: z.string().default(''),
			vault_root: z.string().default(''),
			item_id: z.number().int().positive(),
			limit: z.number().int().min(1).max(100).default(50),
		},
		outputSchema: toolOutputSchemas.memory_history,
	},
	handleTool(core.memoryHistory, toolResultSchemas.memory_history),
);

server.registerTool(
	'memory_forget',
	{
		description:
			'按 item_id 软归档单条记忆，或按 scope 批量归档该作用域下所有活跃记忆；item_id 与 scope 必须且只能传其一，并强制记录原因。',
		inputSchema: {
			contract_version: contractVersionSchema,
			db_path: z.string().default(''),
			vault_root: z.string().default(''),
			item_id: z.number().int().positive().optional(),
			scope: memoryScopeSchema.optional(),
			reason: z.string().min(1),
		},
		outputSchema: toolOutputSchemas.memory_forget,
	},
	handleTool(core.memoryForget, toolResultSchemas.memory_forget, {
		afterSuccess: invalidateFromArchivedItem,
	}),
);

server.registerTool(
	'memory_notify',
	{
		description: '通知 LifeOS 某个 Vault 文件已创建、修改、移动或删除。',
		inputSchema: {
			contract_version: contractVersionSchema,
			db_path: z.string().default(''),
			vault_root: z.string().default(''),
			file_path: z.string().min(1),
			previous_file_path: z.string().min(1).optional(),
		},
		outputSchema: toolOutputSchemas.memory_notify,
	},
	handleTool(core.memoryNotify, toolResultSchemas.memory_notify, {
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
			| 'memory_history'
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
			case 'memory_history':
				return runTool(core.memoryHistory, params);
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
			maintenance: runtime.maintenance,
		};
	},
	async waitForMaintenance(params: Record<string, unknown>) {
		const runtime = getRuntime(normalizeParams(params));
		if (runtime.maintenanceTask) await runtime.maintenanceTask;
		return runtime.maintenance;
	},
	resetState: resetRuntimeState,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(console.error);
}
