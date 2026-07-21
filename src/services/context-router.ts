import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { type VaultConfig, resolveConfig } from '../config.js';
import type {
	ContextBudgets,
	ContextRequest,
	ContextResponse,
	MemoryScope,
	ScopedMemoryItem,
} from '../types.js';
import { estimateTokens } from '../utils/shared.js';
import { listMemoryItems } from './memory-items.js';
import { resolveMemoryScopes } from './scope-resolver.js';

export interface ContextRouterOptions {
	config?: VaultConfig;
	budgets?: Partial<ContextBudgets>;
}

const SCOPE_RANK: Record<MemoryScope['type'], number> = {
	global: 0,
	tool: 1,
	skill: 2,
	repository: 3,
	project: 4,
	file: 5,
};

function scopeId(scope: MemoryScope): string {
	return `${scope.type}\u0000${scope.key}`;
}

function stableSnapshot(value: unknown): string {
	return `ctx-${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20)}`;
}

function compareItems(
	a: ScopedMemoryItem,
	b: ScopedMemoryItem,
	requestOrder: Map<string, number>,
): number {
	const globalHardA = a.scope.type === 'global' && a.enforcement === 'hard';
	const globalHardB = b.scope.type === 'global' && b.enforcement === 'hard';
	if (globalHardA !== globalHardB) return globalHardA ? -1 : 1;
	const rank = SCOPE_RANK[b.scope.type] - SCOPE_RANK[a.scope.type];
	if (rank) return rank;
	const requested =
		(requestOrder.get(scopeId(a.scope)) ?? 9999) - (requestOrder.get(scopeId(b.scope)) ?? 9999);
	if (requested) return requested;
	if (a.enforcement !== b.enforcement) return a.enforcement === 'hard' ? -1 : 1;
	if (a.priority !== b.priority) return b.priority - a.priority;
	if (a.source !== b.source) return a.source === 'correction' ? -1 : 1;
	const updated = b.updatedAt.localeCompare(a.updatedAt);
	if (updated) return updated;
	return `${scopeId(a.scope)}\u0000${a.slotKey}`.localeCompare(
		`${scopeId(b.scope)}\u0000${b.slotKey}`,
	);
}

function formatItem(item: ScopedMemoryItem): string {
	return `- **${item.slotKey}**: ${item.content}`;
}

function render(items: ScopedMemoryItem[]): string {
	const specs: Array<[ScopedMemoryItem['itemKind'], string]> = [
		['rule', '行为约束'],
		['decision', '已确认决策'],
		['fact', '稳定事实'],
	];
	return specs
		.map(([kind, title]) => {
			const lines = items.filter((item) => item.itemKind === kind).map(formatItem);
			return lines.length ? `## ${title}\n${lines.join('\n')}` : '';
		})
		.filter(Boolean)
		.join('\n\n');
}

function emptyResponse(
	unresolvedScopes: ContextResponse['diagnostics']['unresolvedScopes'] = [],
): ContextResponse {
	const diagnostics = {
		unresolvedScopes,
		omittedSlotKeys: [],
		oversizedItems: [],
		warnings: [],
	};
	return {
		snapshotId: stableSnapshot({ scopes: [], diagnostics }),
		matchedScopes: [],
		effectiveItems: [],
		overriddenItems: [],
		rules: [],
		decisions: [],
		facts: [],
		relatedFiles: [],
		text: '',
		diagnostics,
	};
}

export function buildMemoryContext(
	db: Database.Database,
	vaultRoot: string,
	request: ContextRequest,
	options: ContextRouterOptions = {},
): ContextResponse {
	if (!request.scopes?.length) return emptyResponse();
	const config = options.config ?? resolveConfig(vaultRoot);
	const budgets = { ...config.contextBudgets(), ...options.budgets };
	const resolution = resolveMemoryScopes(db, request.scopes, {
		config,
		requireRepositoryBinding: true,
	});
	if (!resolution.resolvedScopes.length) return emptyResponse(resolution.unresolvedScopes);
	const requestedOrder = new Map(
		resolution.resolvedScopes.map((scope, index) => [scopeId(scope), index]),
	);
	const fetchScopes = [...resolution.resolvedScopes];
	if (request.includeGlobal && !fetchScopes.some((scope) => scope.type === 'global')) {
		fetchScopes.push({ type: 'global', key: '' });
	}
	const now = new Date().toISOString();
	const candidates = fetchScopes
		.flatMap((scope) => listMemoryItems(db, { scope, status: 'active', limit: 10_000 }))
		.filter((item) => ['rule', 'decision', 'fact'].includes(item.itemKind))
		.filter((item) => !item.expiresAt || item.expiresAt >= now);
	const globalHard = listMemoryItems(db, {
		scope: { type: 'global', key: '' },
		itemKind: 'rule',
		status: 'active',
		limit: 10_000,
	}).filter((item) => item.enforcement === 'hard' && (!item.expiresAt || item.expiresAt >= now));
	const blockers = new Map(globalHard.map((item) => [item.slotKey, item]));
	const unique = [...new Map(candidates.map((item) => [item.itemId, item])).values()].sort((a, b) =>
		compareItems(a, b, requestedOrder),
	);
	const effective: ScopedMemoryItem[] = [];
	const overridden: ScopedMemoryItem[] = [];
	const chosen = new Set<string>();
	const warnings: string[] = [];
	for (const item of unique) {
		if (item.scope.type !== 'global' && blockers.has(item.slotKey)) {
			overridden.push(item);
			const warning = `全局硬规则已阻止局部覆盖：${item.slotKey}`;
			if (!warnings.includes(warning)) warnings.push(warning);
			continue;
		}
		if (chosen.has(item.slotKey)) {
			overridden.push(item);
			continue;
		}
		chosen.add(item.slotKey);
		effective.push(item);
	}

	const tokenBudget = Math.max(0, request.tokenBudget ?? budgets.scoped_context);
	const singleMax = Math.max(0, budgets.single_item_max);
	const loaded: ScopedMemoryItem[] = [];
	const omittedSlotKeys: string[] = [];
	const oversizedItems: string[] = [];
	for (const item of effective) {
		const isGlobalHard = item.scope.type === 'global' && item.enforcement === 'hard';
		if (isGlobalHard) {
			if (singleMax === 0 || estimateTokens(formatItem(item)) > singleMax) {
				oversizedItems.push(item.slotKey);
				warnings.push(`全局硬规则超过单条预算：${item.slotKey}`);
			}
			loaded.push(item);
			continue;
		}
		if (singleMax === 0 || estimateTokens(formatItem(item)) > singleMax) {
			oversizedItems.push(item.slotKey);
			continue;
		}
		const candidate = render([...loaded, item]);
		if (estimateTokens(candidate) > tokenBudget) {
			omittedSlotKeys.push(item.slotKey);
			continue;
		}
		loaded.push(item);
	}
	const text = render(loaded);
	if (estimateTokens(text) > tokenBudget) {
		warnings.push('全局硬规则导致 scoped context 超过 token budget');
	}
	const relatedFiles =
		request.includeRelatedFiles === false
			? []
			: [...new Set(loaded.flatMap((item) => item.relatedFiles))].sort();
	const diagnostics = {
		unresolvedScopes: resolution.unresolvedScopes,
		omittedSlotKeys,
		oversizedItems,
		warnings,
	};
	const snapshotId = stableSnapshot({
		scopes: resolution.resolvedScopes,
		items: loaded.map((item) => [item.itemId, item.updatedAt, item.content]),
		relatedFiles,
		text,
		diagnostics,
	});
	return {
		snapshotId,
		matchedScopes: resolution.resolvedScopes,
		effectiveItems: loaded,
		overriddenItems: overridden,
		rules: loaded.filter((item) => item.itemKind === 'rule'),
		decisions: loaded.filter((item) => item.itemKind === 'decision'),
		facts: loaded.filter((item) => item.itemKind === 'fact'),
		relatedFiles,
		text,
		diagnostics,
	};
}
