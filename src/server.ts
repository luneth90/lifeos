/**
 * server.ts — MCP Server 入口。
 *
 * Registers 11 memory tools and starts the stdio transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as core from './core.js';

// ─── Server instance ──────────────────────────────────────────────────────────

const server = new McpServer({
	name: 'lifeos',
	version: '1.1.0',
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
	async ({ db_path, vault_root, session_id }) => {
		const result = core.memoryStartup({
			dbPath: db_path || undefined,
			vaultRoot: vault_root || undefined,
			sessionId: session_id,
		});
		return { content: [{ type: 'text', text: JSON.stringify(result) }] };
	},
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
	async ({ db_path, vault_root, query, filters, limit, scene }) => {
		const result = core.memoryQuery({
			dbPath: db_path || undefined,
			vaultRoot: vault_root || undefined,
			query: query || undefined,
			filters,
			limit,
			scene,
		});
		return { content: [{ type: 'text', text: JSON.stringify(result) }] };
	},
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
	async ({ db_path, vault_root, days, entry_type, scope, query, limit, scene }) => {
		const result = core.memoryRecent({
			dbPath: db_path || undefined,
			vaultRoot: vault_root || undefined,
			days,
			entryType: entry_type,
			scope,
			query,
			limit,
			scene,
		});
		return { content: [{ type: 'text', text: JSON.stringify(result) }] };
	},
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
	},
	async ({
		db_path,
		entry_type,
		importance,
		summary,
		scope,
		session_id,
		skill_name,
		detail,
		source_refs,
		related_files,
		related_entities,
		supersedes,
	}) => {
		const result = core.memoryLog({
			dbPath: db_path || undefined,
			entryType: entry_type,
			importance,
			summary,
			scope,
			sessionId: session_id,
			skillName: skill_name,
			detail,
			sourceRefs: source_refs,
			relatedFiles: related_files,
			relatedEntities: related_entities,
			supersedes,
		});
		return { content: [{ type: 'text', text: JSON.stringify(result) }] };
	},
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
				}),
			)
			.optional(),
		session_id: z.string().optional(),
	},
	async ({ db_path, corrections, decisions, preferences, session_id }) => {
		const result = core.memoryAutoCapture({
			dbPath: db_path || undefined,
			corrections,
			decisions,
			preferences,
			sessionId: session_id,
		});
		return { content: [{ type: 'text', text: JSON.stringify(result) }] };
	},
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
	async ({ db_path, vault_root, file_path }) => {
		const result = core.memoryNotify({
			dbPath: db_path || undefined,
			vaultRoot: vault_root || undefined,
			filePath: file_path,
		});
		return { content: [{ type: 'text', text: JSON.stringify(result) }] };
	},
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
	async ({ db_path, vault_root, session_id }) => {
		const result = core.memoryCheckpoint({
			dbPath: db_path || undefined,
			vaultRoot: vault_root || undefined,
			sessionId: session_id,
		});
		return { content: [{ type: 'text', text: JSON.stringify(result) }] };
	},
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
	async ({
		db_path,
		vault_root,
		skill_name,
		summary,
		scope,
		importance,
		detail,
		related_files,
		related_entities,
		context_sources,
		refresh_targets,
	}) => {
		const result = core.memorySkillComplete({
			dbPath: db_path || undefined,
			vaultRoot: vault_root || undefined,
			skillName: skill_name,
			summary,
			scope,
			importance,
			detail,
			relatedFiles: related_files,
			relatedEntities: related_entities,
			contextSources: context_sources,
			refreshTargets: refresh_targets,
		});
		return { content: [{ type: 'text', text: JSON.stringify(result) }] };
	},
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
	async ({ db_path, vault_root, target, section, preserve_manual }) => {
		const result = core.memoryRefresh({
			dbPath: db_path || undefined,
			vaultRoot: vault_root || undefined,
			target,
			section,
			preserveManual: preserve_manual,
		});
		return { content: [{ type: 'text', text: JSON.stringify(result) }] };
	},
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
	async ({ db_path, vault_root, target, section, keyword }) => {
		const result = core.memoryCitations({
			dbPath: db_path || undefined,
			vaultRoot: vault_root || undefined,
			target,
			section,
			keyword,
		});
		return { content: [{ type: 'text', text: JSON.stringify(result) }] };
	},
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
	async ({ db_path, vault_root, skill_profile, related_files, query, limit }) => {
		const result = core.memorySkillContext({
			dbPath: db_path || undefined,
			vaultRoot: vault_root || undefined,
			skillProfile: skill_profile,
			relatedFiles: related_files,
			query,
			limit,
		});
		return { content: [{ type: 'text', text: JSON.stringify(result) }] };
	},
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
