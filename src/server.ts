/**
 * server.ts — MCP Server entry point.
 *
 * Registers memory tools and starts the stdio transport.
 * Automatically handles startup and file watching.
 */

import { type FSWatcher, watch } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { refreshTaskboard, refreshUserprofile } from './active-docs/index.js';
import { getOrCreateVaultConfig } from './config.js';
import * as core from './core.js';
import { initDb } from './db/schema.js';
import { buildLayer0Summary } from './services/layer0.js';
import type { StartupResult } from './types.js';

// ─── Key conversion helpers ──────────────────────────────────────────────────

export const slotKeySchema = z
	.string()
	.regex(
		/^[a-z]+:[a-z0-9_.-]+$/,
		'slot_key must be in format "<category>:<topic>", e.g. "format:latex"',
	);

function snakeToCamel(key: string): string {
	return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function deepConvertKeys(obj: unknown): unknown {
	if (Array.isArray(obj)) return obj.map(deepConvertKeys);
	if (obj !== null && typeof obj === 'object') {
		return Object.fromEntries(
			Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
				snakeToCamel(k),
				deepConvertKeys(v),
			]),
		);
	}
	return obj;
}

// ─── Auto startup guard ─────────────────────────────────────────────────────

let startedUp = false;
let startupResult: StartupResult | null = null;
let startupVaultRoot: string | undefined;
let layer0Dirty = false;
let startupError: string | null = null;

function readStartupContext(params: Record<string, unknown>): {
	vaultRoot: string | undefined;
} {
	const vaultRoot = (params.vault_root as string) || (params.vaultRoot as string) || undefined;
	return { vaultRoot };
}

function closeVaultWatcher(): void {
	if (vaultWatcher) {
		vaultWatcher.close();
		vaultWatcher = null;
	}
	watchedVaultRoot = null;
}

function resetStartupState(): void {
	startedUp = false;
	startupResult = null;
	startupVaultRoot = undefined;
	layer0Dirty = false;
	startupError = null;
	closeVaultWatcher();
}

function ensureStartup(params: Record<string, unknown>): { startedThisCall: boolean } {
	const { vaultRoot } = readStartupContext(params);
	if (startedUp && vaultRoot && startupVaultRoot && vaultRoot !== startupVaultRoot) {
		resetStartupState();
	}
	if (startedUp) return { startedThisCall: false };
	const resolvedVault = vaultRoot || process.env.LIFEOS_VAULT_ROOT;
	if (resolvedVault) startupVaultRoot = resolvedVault;
	try {
		startupResult = core.memoryStartup({ vaultRoot });
		startupError = null;
		startedUp = true;
		// Start file watcher
		if (resolvedVault) startVaultWatcher(resolvedVault);
		return { startedThisCall: true };
	} catch (e) {
		startedUp = true;
		startupResult = null;
		layer0Dirty = false;
		startupError = e instanceof Error ? e.message : String(e);
		console.warn('[lifeos] Auto-startup failed:', e);
		return { startedThisCall: false };
	}
}

function refreshLayer0Summary(params: Record<string, unknown>): boolean {
	const { vaultRoot } = readStartupContext(params);
	const resolvedVault = vaultRoot || startupVaultRoot || process.env.LIFEOS_VAULT_ROOT;
	if (!startupResult || !resolvedVault) return false;

	let db: Database.Database | null = null;
	try {
		const config = getOrCreateVaultConfig(resolvedVault);
		db = new Database(config.dbPath().toString());
		db.pragma('journal_mode = WAL');
		db.pragma('foreign_keys = ON');
		initDb(db);
		refreshTaskboard(db, resolvedVault);
		refreshUserprofile(db, resolvedVault);
		startupResult = {
			...startupResult,
			layer0_summary: buildLayer0Summary(resolvedVault),
		};
		layer0Dirty = false;
		return true;
	} catch (e) {
		console.warn('[lifeos] Layer0 refresh failed:', e);
		return false;
	} finally {
		db?.close();
	}
}

// ─── Vault watcher ──────────────────────────────────────────────────────────

/**
 * Path segments that cause a file event to be ignored.
 * Checked against each segment of the relative path (split by `/`).
 */
const IGNORE_SEGMENTS = new Set(['.git', '.obsidian', '.trash', 'node_modules']);

/**
 * File-level ignore patterns — checked against the full relative path.
 */
const IGNORE_FILE_PATTERNS = [
	/\.sqlite/, // DB files and WAL/journal
	/\.DS_Store$/,
	/~$/, // editor backup files (file.md~)
	/\.tmp$/, // temporary files
	/\.swp$/, // vim swap files
];

function shouldIgnore(filename: string): boolean {
	// Check path segments (handles .git, .obsidian etc. anywhere in path)
	const segments = filename.split('/');
	if (segments.some((s) => s.startsWith('.') || IGNORE_SEGMENTS.has(s))) return true;
	// Check file-level patterns
	return IGNORE_FILE_PATTERNS.some((p) => p.test(filename));
}

const pendingNotifies = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 500;

/** Serialization guard — prevents concurrent memoryNotify calls on the same tick */
let notifyInFlight = false;
const notifyQueue: Array<{ vaultRoot: string; filename: string }> = [];

function processNotifyQueue(): void {
	if (notifyInFlight || notifyQueue.length === 0) return;
	notifyInFlight = true;
	const item = notifyQueue.shift();
	if (!item) return;
	const { vaultRoot, filename } = item;
	try {
		core.memoryNotify({ filePath: filename, vaultRoot });
		layer0Dirty = true;
	} catch (e) {
		console.warn(`[lifeos] Auto-notify failed for ${filename}:`, e);
	} finally {
		notifyInFlight = false;
		// Process next item if any
		if (notifyQueue.length > 0) {
			setImmediate(processNotifyQueue);
		}
	}
}

function debouncedNotify(vaultRoot: string, filename: string): void {
	const existing = pendingNotifies.get(filename);
	if (existing) clearTimeout(existing);

	pendingNotifies.set(
		filename,
		setTimeout(() => {
			pendingNotifies.delete(filename);
			notifyQueue.push({ vaultRoot, filename });
			processNotifyQueue();
		}, DEBOUNCE_MS),
	);
}

let vaultWatcher: FSWatcher | null = null;
let watchedVaultRoot: string | null = null;

function startVaultWatcher(vaultRoot: string): void {
	if (vaultWatcher) return;
	watchedVaultRoot = vaultRoot;
	try {
		vaultWatcher = watch(vaultRoot, { recursive: true }, (_event, filename) => {
			if (!filename || shouldIgnore(filename)) return;
			if (!filename.endsWith('.md')) return;
			debouncedNotify(vaultRoot, filename);
		});
		vaultWatcher.on('error', (err) => {
			console.warn('[lifeos] Vault watcher error:', err);
			// Don't crash — watcher errors are non-fatal
		});
	} catch (e) {
		console.warn('[lifeos] Failed to start vault watcher:', e);
	}
}

// ─── Shutdown cleanup ──────────────────────────────────────────────────────

function setupShutdownHandler(): void {
	process.stdin.on('end', () => {
		closeVaultWatcher();
		process.exit(0);
	});
}

// ─── Tool wrapper ────────────────────────────────────────────────────────────

function normalizeParams<P extends Record<string, unknown>>(params: P): Record<string, unknown> {
	const converted = deepConvertKeys(params) as Record<string, unknown>;
	if (converted.dbPath === '') converted.dbPath = undefined;
	if (converted.vaultRoot === '') converted.vaultRoot = undefined;
	// filters contains SQL column names — must stay snake_case
	if ('filters' in params) converted.filters = params.filters;
	return converted;
}

function serializeOutput(output: unknown): { content: { type: 'text'; text: string }[] } {
	return { content: [{ type: 'text' as const, text: JSON.stringify(output) }] };
}

function runTool<P extends Record<string, unknown>>(
	// biome-ignore lint/suspicious/noExplicitAny: core functions have varied signatures
	coreFn: (params: any) => unknown,
	params: P,
	options: { markLayer0DirtyOnSuccess?: boolean } = {},
): unknown {
	const converted = normalizeParams(params);
	const { startedThisCall } = ensureStartup(converted);
	if (startupError) {
		return {
			status: 'error' as const,
			startup_error: startupError,
		};
	}
	const result = coreFn(converted);

	if (options.markLayer0DirtyOnSuccess) {
		layer0Dirty = true;
		if (startedThisCall && startupResult) {
			refreshLayer0Summary(converted);
		}
	}

	if (startedThisCall && startupResult) {
		return typeof result === 'object' && result !== null
			? { _layer0: startupResult.layer0_summary, ...(result as Record<string, unknown>) }
			: { _layer0: startupResult.layer0_summary, result };
	}

	return result;
}

function runMemoryBootstrap<P extends Record<string, unknown>>(
	params: P,
): {
	status: 'ok' | 'error';
	startup_ran: boolean;
	layer0_refreshed: boolean;
	_layer0: string;
	startup_error?: string;
} {
	const converted = normalizeParams(params);
	const { startedThisCall } = ensureStartup(converted);
	if (startupError) {
		return {
			status: 'error',
			startup_ran: false,
			layer0_refreshed: false,
			_layer0: '',
			startup_error: startupError,
		};
	}
	const layer0Refreshed = layer0Dirty ? refreshLayer0Summary(converted) : false;

	return {
		status: 'ok',
		startup_ran: startedThisCall && !!startupResult,
		layer0_refreshed: layer0Refreshed,
		_layer0: startupResult?.layer0_summary ?? '',
	};
}

function handleTool<P extends Record<string, unknown>>(
	// biome-ignore lint/suspicious/noExplicitAny: core functions have varied signatures
	coreFn: (params: any) => unknown,
	options: { markLayer0DirtyOnSuccess?: boolean } = {},
): (params: P) => Promise<{ content: { type: 'text'; text: string }[] }> {
	return async (params: P) => {
		return serializeOutput(runTool(coreFn, params, options));
	};
}

function handleBootstrap<P extends Record<string, unknown>>(): (
	params: P,
) => Promise<{ content: { type: 'text'; text: string }[] }> {
	return async (params: P) => {
		return serializeOutput(runMemoryBootstrap(params));
	};
}

// ─── Server instance ──────────────────────────────────────────────────────────

const server = new McpServer({
	name: 'lifeos',
	version: '1.7.0',
});

// ─── Tool registrations ───────────────────────────────────────────────────────

// 1. memory_bootstrap
server.tool(
	'memory_bootstrap',
	'Bootstrap the LifeOS session and return the current Layer 0 context.',
	{
		db_path: z
			.string()
			.default('')
			.describe(
				'Optional. Auto-resolved from vault_root + lifeos.yaml. Do NOT construct manually.',
			),
		vault_root: z.string().default(''),
	},
	handleBootstrap(),
);

// 2. memory_query
server.tool(
	'memory_query',
	'Search vault index for notes, projects, and knowledge.',
	{
		db_path: z
			.string()
			.default('')
			.describe(
				'Optional. Auto-resolved from vault_root + lifeos.yaml. Do NOT construct manually.',
			),
		vault_root: z.string().default(''),
		query: z.string().default(''),
		filters: z.record(z.string()).optional(),
		limit: z.number().int().min(1).max(50).default(10),
	},
	handleTool(core.memoryQuery),
);

// 3. memory_log
server.tool(
	'memory_log',
	'Upsert a rule (preference or correction) into memory. Use slot_key format "<category>:<topic>".',
	{
		db_path: z
			.string()
			.default('')
			.describe(
				'Optional. Auto-resolved from vault_root + lifeos.yaml. Do NOT construct manually.',
			),
		vault_root: z
			.string()
			.default('')
			.describe('Optional. Auto-resolved from environment. Used for instant active-doc refresh.'),
		slot_key: slotKeySchema.describe(
			'Required. A structured key like "format:latex" that identifies this rule.',
		),
		content: z.string().min(1).describe('The rule content to store.'),
		source: z
			.enum(['preference', 'correction'])
			.optional()
			.describe('Source type. Defaults to "preference".'),
		related_files: z.array(z.string()).optional(),
		expires_at: z
			.string()
			.optional()
			.describe('Optional ISO date string. Rule will be auto-expired after this date.'),
	},
	handleTool(core.memoryLog, { markLayer0DirtyOnSuccess: true }),
);

// 4. memory_notify
server.tool(
	'memory_notify',
	'Notify the memory system that a vault file has been created or modified.',
	{
		db_path: z
			.string()
			.default('')
			.describe(
				'Optional. Auto-resolved from vault_root + lifeos.yaml. Do NOT construct manually.',
			),
		vault_root: z.string().default(''),
		file_path: z.string().min(1),
	},
	handleTool(core.memoryNotify, { markLayer0DirtyOnSuccess: true }),
);

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function main() {
	const args = process.argv.slice(2);
	const vaultRootIdx = args.indexOf('--vault-root');
	if (vaultRootIdx !== -1 && args[vaultRootIdx + 1]) {
		process.env.LIFEOS_VAULT_ROOT = args[vaultRootIdx + 1];
	}
	const transport = new StdioServerTransport();
	await server.connect(transport);
	setupShutdownHandler();
}

export const __testing = {
	ensureStartup,
	callMemoryBootstrap(params: Record<string, unknown>) {
		return runMemoryBootstrap(params);
	},
	callTool(name: 'memory_query' | 'memory_log' | 'memory_notify', params: Record<string, unknown>) {
		switch (name) {
			case 'memory_query':
				return runTool(core.memoryQuery, params);
			case 'memory_log':
				return runTool(core.memoryLog, params, { markLayer0DirtyOnSuccess: true });
			case 'memory_notify':
				return runTool(core.memoryNotify, params, { markLayer0DirtyOnSuccess: true });
			default:
				throw new Error(`Unknown tool: ${name}`);
		}
	},
	debouncedNotify,
	enqueueNotify(item: { vaultRoot: string; filename: string }) {
		notifyQueue.push(item);
	},
	resetState() {
		for (const timer of pendingNotifies.values()) {
			clearTimeout(timer);
		}
		pendingNotifies.clear();
		notifyQueue.length = 0;
		notifyInFlight = false;
		resetStartupState();
	},
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(console.error);
}
