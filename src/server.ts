/**
 * server.ts — MCP Server 入口。
 *
 * Registers 6 memory tools and starts the stdio transport.
 * Automatically handles startup, file watching, and checkpoint.
 */

import { type FSWatcher, watch } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as core from './core.js';
import type { StartupResult } from './types.js';

// ─── Key conversion helpers ──────────────────────────────────────────────────

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
let startupSessionId: string | undefined;

function captureStartupContext(params: Record<string, unknown>): {
	vaultRoot: string | undefined;
	sessionId: string | undefined;
} {
	const vaultRoot = (params.vault_root as string) || (params.vaultRoot as string) || undefined;
	const sessionId = (params.session_id as string) || (params.sessionId as string) || undefined;
	if (vaultRoot) startupVaultRoot = vaultRoot;
	if (sessionId) startupSessionId = sessionId;
	return { vaultRoot, sessionId };
}

function ensureStartup(params: Record<string, unknown>): void {
	if (startedUp) return;
	const { vaultRoot, sessionId } = captureStartupContext(params);
	try {
		startupResult = core.memoryStartup({ vaultRoot, sessionId });
		startedUp = true;
		// 启动文件监听
		const resolvedVault = vaultRoot || process.env.LIFEOS_VAULT_ROOT;
		if (resolvedVault) startupVaultRoot = resolvedVault;
		if (resolvedVault) startVaultWatcher(resolvedVault);
	} catch (e) {
		console.warn('[lifeos] Auto-startup failed:', e);
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

/** Flush all pending debounced notifies synchronously (used at shutdown). */
function flushPendingNotifies(vaultRoot: string): void {
	for (const [filename, timer] of pendingNotifies) {
		clearTimeout(timer);
		try {
			core.memoryNotify({ filePath: filename, vaultRoot });
		} catch (_) {
			// Best-effort at shutdown
		}
	}
	pendingNotifies.clear();
}

function drainNotifyQueue(): void {
	if (notifyInFlight) return;
	while (notifyQueue.length > 0) {
		const item = notifyQueue.shift();
		if (!item) continue;
		try {
			core.memoryNotify({ filePath: item.filename, vaultRoot: item.vaultRoot });
		} catch (_) {
			// Best-effort at shutdown
		}
	}
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

// ─── Auto checkpoint ────────────────────────────────────────────────────────

let checkpointDone = false;

function runAutoCheckpoint(): void {
	if (!startedUp || checkpointDone) return;
	checkpointDone = true;

	const checkpointVaultRoot = watchedVaultRoot ?? startupVaultRoot;
	if (checkpointVaultRoot) {
		flushPendingNotifies(checkpointVaultRoot);
	}
	drainNotifyQueue();

	try {
		core.memoryCheckpoint({
			vaultRoot: startupVaultRoot,
			sessionId: startupSessionId,
		});
	} catch (e) {
		console.error('[lifeos] Auto-checkpoint failed:', e);
	}
}

function setupAutoCheckpoint(): void {
	process.stdin.on('end', () => {
		runAutoCheckpoint();
		if (vaultWatcher) {
			vaultWatcher.close();
			vaultWatcher = null;
		}
		process.exit(0);
	});

	process.on('beforeExit', runAutoCheckpoint);
}

// ─── Tool wrapper ────────────────────────────────────────────────────────────

function handleTool<P extends Record<string, unknown>>(
	// biome-ignore lint/suspicious/noExplicitAny: core functions have varied signatures
	coreFn: (params: any) => unknown,
): (params: P) => Promise<{ content: { type: 'text'; text: string }[] }> {
	return async (params: P) => {
		const converted = deepConvertKeys(params) as Record<string, unknown>;
		if (converted.dbPath === '') converted.dbPath = undefined;
		if (converted.vaultRoot === '') converted.vaultRoot = undefined;
		// filters contains SQL column names — must stay snake_case
		if ('filters' in params) converted.filters = params.filters;

		const wasFirstCall = !startedUp;
		ensureStartup(params);
		const result = coreFn(converted);

		// 首次调用时附带 Layer 0 摘要
		let output: unknown;
		if (wasFirstCall && startupResult) {
			output =
				typeof result === 'object' && result !== null
					? { _layer0: startupResult.layer0_summary, ...(result as Record<string, unknown>) }
					: { _layer0: startupResult.layer0_summary, result };
		} else {
			output = result;
		}

		return { content: [{ type: 'text' as const, text: JSON.stringify(output) }] };
	};
}

// ─── Server instance ──────────────────────────────────────────────────────────

const server = new McpServer({
	name: 'lifeos',
	version: '1.3.0',
});

// ─── Tool registrations ───────────────────────────────────────────────────────

// 1. memory_query
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

// 2. memory_recent
server.tool(
	'memory_recent',
	'Query recent session log events (decisions, corrections, milestones, etc.).',
	{
		db_path: z
			.string()
			.default('')
			.describe(
				'Optional. Auto-resolved from vault_root + lifeos.yaml. Do NOT construct manually.',
			),
		vault_root: z.string().default(''),
		days: z.number().int().min(1).max(365).default(14),
		entry_type: z.string().optional(),
		scope: z.string().optional(),
		query: z.string().optional(),
		limit: z.number().int().min(1).max(100).default(20),
	},
	handleTool(core.memoryRecent),
);

// 3. memory_log
server.tool(
	'memory_log',
	'Log a single memory event (decision, correction, preference, milestone, etc.).',
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
			.describe(
				'Optional. Auto-resolved from environment. Used for instant active-doc refresh on preference/correction/decision writes.',
			),
		entry_type: z.enum([
			'skill_completion',
			'decision',
			'preference',
			'correction',
			'blocker',
			'milestone',
			'session_bridge',
		]),
		importance: z.number().int().min(1).max(5),
		summary: z.string().min(1),
		scope: z.string().optional(),
		session_id: z.string().optional(),
		skill_name: z.string().optional(),
		detail: z.string().optional(),
		source_refs: z.array(z.string()).optional(),
		related_files: z.array(z.string()).optional(),
		related_entities: z.array(z.string()).optional(),
		supersedes: z.string().optional(),
		slot_key: z
			.string()
			.regex(
				/^[a-z]+:[a-z0-9_-]+$/,
				'slot_key must be in format "<category>:<topic>", e.g. "format:latex"',
			)
			.optional()
			.describe(
				'Optional. For preference/correction/decision events, a structured key like "format:latex" that maps to a memory_items slot for cross-agent persistence.',
			),
	},
	handleTool(core.memoryLog),
);

// 4. memory_auto_capture
server.tool(
	'memory_auto_capture',
	'Batch capture corrections, decisions, and preferences from the current session.',
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
			.describe(
				'Optional. Auto-resolved from environment. Used for instant active-doc refresh after batch capture.',
			),
		corrections: z
			.array(
				z.object({
					summary: z.string(),
					detail: z.string().optional(),
					importance: z.number().int().min(1).max(5).optional(),
					scope: z.string().optional(),
					related_files: z.array(z.string()).optional(),
					slot_key: z
						.string()
						.regex(/^[a-z]+:[a-z0-9_-]+$/)
						.optional(),
				}),
			)
			.optional(),
		decisions: z
			.array(
				z.object({
					summary: z.string(),
					detail: z.string().optional(),
					importance: z.number().int().min(1).max(5).optional(),
					scope: z.string().optional(),
					related_files: z.array(z.string()).optional(),
					slot_key: z
						.string()
						.regex(/^[a-z]+:[a-z0-9_-]+$/)
						.optional(),
				}),
			)
			.optional(),
		preferences: z
			.array(
				z.object({
					summary: z.string(),
					detail: z.string().optional(),
					importance: z.number().int().min(1).max(5).optional(),
					scope: z.string().optional(),
					related_files: z.array(z.string()).optional(),
					slot_key: z
						.string()
						.regex(/^[a-z]+:[a-z0-9_-]+$/)
						.optional(),
				}),
			)
			.optional(),
		session_id: z.string().optional(),
	},
	handleTool(core.memoryAutoCapture),
);

// 5. memory_notify
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
	handleTool(core.memoryNotify),
);

// 6. memory_citations
server.tool(
	'memory_citations',
	'Get source event citations for items in TaskBoard or UserProfile.',
	{
		db_path: z
			.string()
			.default('')
			.describe(
				'Optional. Auto-resolved from vault_root + lifeos.yaml. Do NOT construct manually.',
			),
		vault_root: z.string().default(''),
		target: z.enum(['TaskBoard', 'UserProfile']),
		section: z.string().optional(),
		keyword: z.string().optional(),
	},
	handleTool(core.memoryCitations),
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
	setupAutoCheckpoint();
}

export const __testing = {
	ensureStartup,
	debouncedNotify,
	runAutoCheckpoint,
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
		checkpointDone = false;
		startedUp = false;
		startupResult = null;
		startupVaultRoot = undefined;
		startupSessionId = undefined;
		watchedVaultRoot = null;
		if (vaultWatcher) {
			vaultWatcher.close();
			vaultWatcher = null;
		}
	},
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(console.error);
}
