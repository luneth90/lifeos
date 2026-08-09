/** MCP 八工具的结构化输出模式。 */

import { z } from 'zod';
import type { NotifyFileChangedResult } from './services/capture.js';
import type { VaultQueryResult } from './services/retrieval.js';
import type {
	ContextResponse,
	MemoryItemEvent,
	MemoryScope,
	ScopedMemoryItem,
	UpsertMemoryItemResult,
} from './types.js';

const scopeTypeSchema = z.enum(['global', 'skill', 'project', 'repository', 'tool', 'file']);

const memoryScopeOutputSchema: z.ZodType<MemoryScope> = z
	.object({
		type: scopeTypeSchema,
		key: z.string(),
	})
	.strict();

const vaultQueryEvidenceSchema = z
	.object({
		field: z.enum(['title', 'summary', 'search_hints', 'tags']),
		snippet: z.string().max(160),
		matchedTerms: z.array(z.string().min(1)).min(1),
		sourcePath: z.string(),
	})
	.strict();

const vaultRankSortKeySchema = z
	.object({
		field: z.enum(['rankScore', 'modifiedAt', 'filePath']),
		direction: z.enum(['asc', 'desc', 'input']),
		value: z.union([z.number(), z.string(), z.null()]),
	})
	.strict();

const vaultRankExplanationSchema = z
	.object({
		rankSource: z.enum(['vault_fts_bm25', 'deterministic_fallback', 'requested_order']),
		sortKeys: z.array(vaultRankSortKeySchema).min(1),
	})
	.strict();

const startupErrorOutputSchema = z
	.object({
		status: z.literal('error'),
		startup_error: z.string(),
	})
	.strict();

const layer0SectionMetaSchema = z
	.object({
		total: z.number().int().nonnegative(),
		loaded: z.number().int().nonnegative(),
		omitted: z.number().int().nonnegative(),
	})
	.strict();

const layer0MetaSchema = z
	.object({
		token_estimate: z.number().int().nonnegative(),
		token_budget: z.number().int().nonnegative(),
		global_items_total: z.number().int().nonnegative(),
		global_items_loaded: z.number().int().nonnegative(),
		omitted_slot_keys: z.array(z.string()),
		oversized_items: z.array(z.string()),
		warnings: z.array(z.string()),
		sections: z
			.object({
				global_rules: layer0SectionMetaSchema,
				taskboard_focus: layer0SectionMetaSchema,
				userprofile_summary: layer0SectionMetaSchema,
				revision_reminder: layer0SectionMetaSchema,
			})
			.strict(),
	})
	.strict();

const toolBindingSchema = z
	.object({
		commands: z.array(z.string()),
		skills: z.array(z.string()),
	})
	.strict();

const scopeHintsSchema = z
	.object({
		available_projects: z.array(z.string()),
		available_repositories: z.array(z.string()),
		available_skills: z.array(z.string()),
		available_tools: z.array(z.string()),
		tool_bindings: z.record(toolBindingSchema),
	})
	.strict();

const dbMaintenanceMetricsSchema = z
	.object({
		page_count: z.number().int().nonnegative(),
		freelist_count: z.number().int().nonnegative(),
		freelist_bytes: z.number().int().nonnegative(),
		wal_pages: z.number().int().nonnegative().nullable(),
		wal_bytes: z.number().int().nonnegative().nullable(),
	})
	.strict();

const dbMaintenanceReportSchema = z
	.object({
		mode: z.enum(['routine', 'explicit']),
		state: z.enum(['pending', 'running', 'succeeded', 'failed']),
		started_at: z.string().nullable(),
		finished_at: z.string().nullable(),
		duration_ms: z.number().int().nonnegative().nullable(),
		before: dbMaintenanceMetricsSchema.nullable(),
		after: dbMaintenanceMetricsSchema.nullable(),
		error: z.string().nullable(),
	})
	.strict()
	.superRefine((report, ctx) => {
		const terminalTimesPresent =
			report.started_at !== null && report.finished_at !== null && report.duration_ms !== null;
		const invalid =
			report.state === 'pending'
				? report.started_at !== null ||
					report.finished_at !== null ||
					report.duration_ms !== null ||
					report.before !== null ||
					report.after !== null ||
					report.error !== null
				: report.state === 'running'
					? report.started_at === null ||
						report.finished_at !== null ||
						report.duration_ms !== null ||
						report.before !== null ||
						report.after !== null ||
						report.error !== null
					: report.state === 'succeeded'
						? !terminalTimesPresent ||
							report.before === null ||
							report.after === null ||
							report.error !== null
						: !terminalTimesPresent || report.error === null;
		if (invalid) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `数据库维护状态 ${report.state} 与时间、指标或错误字段不一致`,
			});
		}
	});

const bootstrapSuccessOutputSchema = z
	.object({
		contract_version: z.literal(2),
		schema_version: z.literal(5),
		status: z.literal('ok'),
		startup_ran: z.boolean(),
		layer0_refreshed: z.boolean(),
		snapshot_id: z.string(),
		_layer0: z.string(),
		layer0_meta: layer0MetaSchema,
		scope_hints: scopeHintsSchema,
		db_maintenance: dbMaintenanceReportSchema,
	})
	.strict();

const bootstrapErrorOutputSchema = z
	.object({
		contract_version: z.literal(2),
		schema_version: z.literal(5),
		status: z.literal('error'),
		startup_ran: z.literal(false),
		layer0_refreshed: z.literal(false),
		snapshot_id: z.literal(''),
		_layer0: z.literal(''),
		layer0_meta: z.null(),
		scope_hints: z.null(),
		db_maintenance: z.null(),
		startup_error: z.string(),
	})
	.strict();

export const memoryBootstrapOutputSchema = z.union([
	bootstrapSuccessOutputSchema,
	bootstrapErrorOutputSchema,
]);

const vaultQueryResultSchema: z.ZodType<VaultQueryResult> = z
	.object({
		filePath: z.string(),
		entityId: z.string().nullable(),
		title: z.string(),
		type: z.string().nullable(),
		status: z.string().nullable(),
		domain: z.string().nullable(),
		summary: z.string().nullable(),
		displaySummary: z.string(),
		matchSource: z.enum(['exact_filter', 'fts5', 'hybrid_expand', 'like_fallback']),
		matchedFields: z.array(z.string()),
		score: z.number(),
		rankScore: z.number().nullable(),
		rankPosition: z.number().int().positive(),
		rankExplanation: vaultRankExplanationSchema,
		evidence: z.array(vaultQueryEvidenceSchema),
		modifiedAt: z.string().nullable(),
		masteryStatus: z.string().nullable().optional(),
		tags: z.array(z.string()).optional(),
		aliases: z.array(z.string()).optional(),
		wikilinks: z.array(z.string()).optional(),
		backlinks: z.array(z.string()).optional(),
	})
	.strict();

const memoryQuerySuccessOutputSchema = z
	.object({
		results: z.array(vaultQueryResultSchema),
	})
	.strict();

export const memoryQueryOutputSchema = z.union([
	memoryQuerySuccessOutputSchema,
	startupErrorOutputSchema,
]);

const scopedMemoryItemSchema = z
	.object({
		itemId: z.number().int().positive(),
		slotKey: z.string(),
		content: z.string(),
		itemKind: z.enum(['rule', 'decision', 'fact', 'profile', 'event']),
		scope: memoryScopeOutputSchema,
		priority: z.number().int().min(0).max(100),
		enforcement: z.enum(['hard', 'soft']),
		source: z.enum(['preference', 'correction']),
		relatedFiles: z.array(z.string()),
		manualFlag: z.boolean(),
		status: z.enum(['active', 'expired', 'archived']),
		createdAt: z.string(),
		updatedAt: z.string(),
		expiresAt: z.string().nullable(),
		archivedAt: z.string().nullable(),
		archiveReason: z.string().nullable(),
	})
	.strict() satisfies z.ZodType<ScopedMemoryItem>;

const unresolvedScopeSchema = z
	.object({
		scope: memoryScopeOutputSchema,
		reason: z.string(),
		candidates: z.array(z.string()).optional(),
	})
	.strict();

const contextResponseSchema = z
	.object({
		snapshotId: z.string(),
		matchedScopes: z.array(memoryScopeOutputSchema),
		effectiveItems: z.array(scopedMemoryItemSchema),
		overriddenItems: z.array(scopedMemoryItemSchema),
		rules: z.array(scopedMemoryItemSchema),
		decisions: z.array(scopedMemoryItemSchema),
		facts: z.array(scopedMemoryItemSchema),
		profiles: z.array(scopedMemoryItemSchema),
		relatedFiles: z.array(z.string()),
		text: z.string(),
		diagnostics: z
			.object({
				unresolvedScopes: z.array(unresolvedScopeSchema),
				omittedSlotKeys: z.array(z.string()),
				oversizedItems: z.array(z.string()),
				warnings: z.array(z.string()),
			})
			.strict(),
	})
	.strict() satisfies z.ZodType<ContextResponse>;

export const memoryContextOutputSchema = z.union([contextResponseSchema, startupErrorOutputSchema]);

const upsertMemoryItemSchema = scopedMemoryItemSchema.extend({
	action: z.enum(['created', 'updated']),
}) satisfies z.ZodType<UpsertMemoryItemResult>;

export const memoryLogOutputSchema = z.union([upsertMemoryItemSchema, startupErrorOutputSchema]);

const memoryRulesSuccessOutputSchema = z
	.object({
		items: z.array(scopedMemoryItemSchema),
	})
	.strict();

export const memoryRulesOutputSchema = z.union([
	memoryRulesSuccessOutputSchema,
	startupErrorOutputSchema,
]);

const memoryItemEventSchema: z.ZodType<MemoryItemEvent> = z
	.object({
		eventId: z.number().int().positive(),
		itemId: z.number().int().positive(),
		eventType: z.enum([
			'baseline_snapshot',
			'create',
			'update',
			'archive',
			'restore',
			'reclassify',
			'expire',
		]),
		before: scopedMemoryItemSchema.nullable(),
		after: scopedMemoryItemSchema.nullable(),
		reason: z.string().nullable(),
		actor: z.string().min(1),
		occurredAt: z.string().min(1),
		contractVersion: z.literal(2),
		correlationId: z.string().min(1),
	})
	.strict()
	.superRefine((event, ctx) => {
		const startsHistory = event.eventType === 'baseline_snapshot' || event.eventType === 'create';
		const hasInvalidSnapshots = startsHistory
			? event.before !== null || event.after === null
			: event.before === null || event.after === null;
		if (hasInvalidSnapshots) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `事件 ${event.eventType} 的 before/after 快照语义不一致`,
			});
		}
	});

const memoryHistorySuccessOutputSchema = z
	.object({
		itemId: z.number().int().positive(),
		events: z.array(memoryItemEventSchema),
	})
	.strict();

export const memoryHistoryOutputSchema = z.union([
	memoryHistorySuccessOutputSchema,
	startupErrorOutputSchema,
]);

const archivedCountSchema = z
	.object({
		archived: z.number().int().nonnegative(),
	})
	.strict();

export const memoryForgetOutputSchema = z.union([
	scopedMemoryItemSchema,
	archivedCountSchema,
	startupErrorOutputSchema,
]);

const indexImpactSchema = z
	.object({
		vaultIndexChanged: z.boolean(),
		backlinksChanged: z.boolean(),
		taskboardChanged: z.boolean(),
		profileChanged: z.boolean(),
		affectedScopes: z.array(memoryScopeOutputSchema),
		changedEntityIds: z.array(z.string()),
	})
	.strict();

const notifySuccessOutputSchema = z
	.object({
		action: z.enum(['indexed', 'unchanged', 'removed', 'skipped', 'error']),
		filePath: z.string(),
		impact: indexImpactSchema,
		reason: z.string().optional(),
		previousFilePath: z.string().optional(),
	})
	.strict() satisfies z.ZodType<NotifyFileChangedResult>;

export const memoryNotifyOutputSchema = z.union([
	notifySuccessOutputSchema,
	startupErrorOutputSchema,
]);

export const toolResultSchemas = {
	memory_bootstrap: memoryBootstrapOutputSchema,
	memory_query: memoryQueryOutputSchema,
	memory_context: memoryContextOutputSchema,
	memory_log: memoryLogOutputSchema,
	memory_rules: memoryRulesOutputSchema,
	memory_history: memoryHistoryOutputSchema,
	memory_forget: memoryForgetOutputSchema,
	memory_notify: memoryNotifyOutputSchema,
} as const;

/*
 * MCP SDK 1.30.0 只会发布并校验顶层 ZodObject。这里保留每个分支的全部显式字段，
 * 由上面的严格结果模式在 handler 内校验成功/错误分支的完整性与互斥关系。
 */
const memoryBootstrapMcpOutputSchema = z
	.object({
		contract_version: z.literal(2),
		schema_version: z.literal(5),
		status: z.enum(['ok', 'error']),
		startup_ran: z.boolean(),
		layer0_refreshed: z.boolean(),
		snapshot_id: z.string(),
		_layer0: z.string(),
		layer0_meta: layer0MetaSchema.nullable(),
		scope_hints: scopeHintsSchema.nullable(),
		db_maintenance: dbMaintenanceReportSchema.nullable(),
		startup_error: z.string().optional(),
	})
	.strict();

const memoryQueryMcpOutputSchema = memoryQuerySuccessOutputSchema
	.partial()
	.extend({
		status: z.literal('error').optional(),
		startup_error: z.string().optional(),
	})
	.strict();

const memoryContextMcpOutputSchema = contextResponseSchema
	.partial()
	.extend({
		status: z.literal('error').optional(),
		startup_error: z.string().optional(),
	})
	.strict();

const memoryLogMcpOutputSchema = upsertMemoryItemSchema
	.partial()
	.extend({
		status: z.enum(['active', 'expired', 'archived', 'error']).optional(),
		startup_error: z.string().optional(),
	})
	.strict();

const memoryRulesMcpOutputSchema = memoryRulesSuccessOutputSchema
	.partial()
	.extend({
		status: z.literal('error').optional(),
		startup_error: z.string().optional(),
	})
	.strict();

const memoryHistoryMcpOutputSchema = memoryHistorySuccessOutputSchema
	.partial()
	.extend({
		status: z.literal('error').optional(),
		startup_error: z.string().optional(),
	})
	.strict();

const memoryForgetMcpOutputSchema = scopedMemoryItemSchema
	.partial()
	.extend({
		status: z.enum(['active', 'expired', 'archived', 'error']).optional(),
		archived: z.number().int().nonnegative().optional(),
		startup_error: z.string().optional(),
	})
	.strict();

const memoryNotifyMcpOutputSchema = notifySuccessOutputSchema
	.partial()
	.extend({
		status: z.literal('error').optional(),
		startup_error: z.string().optional(),
	})
	.strict();

export const toolOutputSchemas = {
	memory_bootstrap: memoryBootstrapMcpOutputSchema,
	memory_query: memoryQueryMcpOutputSchema,
	memory_context: memoryContextMcpOutputSchema,
	memory_log: memoryLogMcpOutputSchema,
	memory_rules: memoryRulesMcpOutputSchema,
	memory_history: memoryHistoryMcpOutputSchema,
	memory_forget: memoryForgetMcpOutputSchema,
	memory_notify: memoryNotifyMcpOutputSchema,
} as const;
