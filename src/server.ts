/**
 * server.ts — MCP Server 入口。
 *
 * Registers 11 memory tools and starts the stdio transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as core from './core.js';

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
		const result = coreFn(converted);
		return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
	};
}

// ─── Server instance ──────────────────────────────────────────────────────────

const server = new McpServer({
	name: 'lifeos',
	version: '1.1.2',
});

// ─── Tool registrations ───────────────────────────────────────────────────────

// 1. memory_startup
server.tool(
	'memory_startup',
	'Start session: scan vault, build Layer 0 summary.',
	{
		db_path: z
			.string()
			.default('')
			.describe(
				'Optional. Auto-resolved from vault_root + lifeos.yaml. Do NOT construct manually.',
			),
		vault_root: z.string().default(''),
		session_id: z.string().optional(),
	},
	handleTool(core.memoryStartup),
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
		scene: z.string().optional(),
	},
	handleTool(core.memoryQuery),
);

// 3. memory_recent
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
		scene: z.string().optional(),
	},
	handleTool(core.memoryRecent),
);

// 4. memory_log
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
			.regex(/^[a-z]+:[a-z0-9_-]+$/, 'slot_key must be in format "<category>:<topic>", e.g. "format:latex"')
			.optional()
			.describe(
				'Optional. For preference/correction/decision events, a structured key like "format:latex" that maps to a memory_items slot for cross-agent persistence.',
			),
	},
	handleTool(core.memoryLog),
);

// 5. memory_auto_capture
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
		corrections: z
			.array(
				z.object({
					summary: z.string(),
					detail: z.string().optional(),
					importance: z.number().int().min(1).max(5).optional(),
					scope: z.string().optional(),
					related_files: z.array(z.string()).optional(),
					slot_key: z.string().regex(/^[a-z]+:[a-z0-9_-]+$/).optional(),
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
					slot_key: z.string().regex(/^[a-z]+:[a-z0-9_-]+$/).optional(),
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
					slot_key: z.string().regex(/^[a-z]+:[a-z0-9_-]+$/).optional(),
				}),
			)
			.optional(),
		session_id: z.string().optional(),
	},
	handleTool(core.memoryAutoCapture),
);

// 6. memory_notify
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

// 7. memory_checkpoint
server.tool(
	'memory_checkpoint',
	'Close the current session: refresh active docs, process enhance queue, write session bridge.',
	{
		db_path: z
			.string()
			.default('')
			.describe(
				'Optional. Auto-resolved from vault_root + lifeos.yaml. Do NOT construct manually.',
			),
		vault_root: z.string().default(''),
		session_id: z.string().optional(),
	},
	handleTool(core.memoryCheckpoint),
);

// 8. memory_skill_complete
server.tool(
	'memory_skill_complete',
	'Record that a LifeOS skill has completed its execution.',
	{
		db_path: z
			.string()
			.default('')
			.describe(
				'Optional. Auto-resolved from vault_root + lifeos.yaml. Do NOT construct manually.',
			),
		vault_root: z.string().default(''),
		skill_name: z.string().min(1),
		summary: z.string().min(1),
		scope: z.string().optional(),
		importance: z.number().int().min(1).max(5).optional(),
		detail: z.string().optional(),
		related_files: z.array(z.string()).optional(),
		related_entities: z.array(z.string()).optional(),
		context_sources: z.array(z.string()).optional(),
		refresh_targets: z.array(z.string()).optional(),
	},
	handleTool(core.memorySkillComplete),
);

// 9. memory_refresh
server.tool(
	'memory_refresh',
	'Rebuild AUTO sections of an active doc (TaskBoard or UserProfile) from DB data.',
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
		preserve_manual: z.boolean().optional(),
	},
	handleTool(core.memoryRefresh),
);

// 10. memory_citations
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

// 11. memory_skill_context
server.tool(
	'memory_skill_context',
	'Assemble skill execution context using a named seed profile.',
	{
		db_path: z
			.string()
			.default('')
			.describe(
				'Optional. Auto-resolved from vault_root + lifeos.yaml. Do NOT construct manually.',
			),
		vault_root: z.string().default(''),
		skill_profile: z.string().min(1),
		related_files: z.array(z.string()).optional(),
		query: z.string().optional(),
		limit: z.number().int().min(1).max(50).optional(),
	},
	handleTool(core.memorySkillContext),
);

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
	const args = process.argv.slice(2);
	const vaultRootIdx = args.indexOf('--vault-root');
	if (vaultRootIdx !== -1 && args[vaultRootIdx + 1]) {
		process.env.LIFEOS_VAULT_ROOT = args[vaultRootIdx + 1];
	}
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch(console.error);
