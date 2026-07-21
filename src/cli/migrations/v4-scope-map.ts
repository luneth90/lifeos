import { createHash } from 'node:crypto';
import type { RepositoryBindings } from '../../config.js';
import type { LegacyScopeMapEntry } from '../../db/migrations.js';
import type {
	MemoryEnforcement,
	MemoryItemKind,
	MemoryItemStatus,
	MemoryScope,
	MemorySource,
} from '../../types.js';

export const V4_SCOPE_MAP_FORMAT = 'lifeos-v4-scope-map' as const;
export const V4_SCOPE_MAP_FORMAT_VERSION = 1 as const;
export const V4_SCOPE_MAP_GENERATOR = 'lifeos-v4-default-generator' as const;
export const V4_SCOPE_MAP_GENERATOR_VERSION = 1 as const;
export const REVIEW_REQUIRED_SCOPE_KEY = '__REVIEW_REQUIRED__' as const;

export const DEFAULT_LIFEOS_SKILL_IDS = [
	'archive',
	'ask',
	'brainstorm',
	'digest',
	'knowledge',
	'project',
	'read-pdf',
	'research',
	'revise',
	'today',
	'translate',
] as const;

export const DEFAULT_LIFEOS_TOOL_IDS = ['claude', 'codex', 'obsidian', 'opencode'] as const;

const DEFAULT_GLOBAL_RULE_SLOTS = [
	'content:language',
	'format:latex',
	'workflow:deferred-todo-followthrough',
	'workflow:plan-directory',
] as const;

const RETIRED_PROFILE_SLOTS = new Map([
	['profile:current_focus', '由 TaskBoard 焦点区块接管'],
	['profile:summary', '由结构化画像条目接管'],
]);

const RETIRED_EVENT_SLOTS = new Map([
	['archive:diary', '一次性历史归档记录，不再进入有效上下文'],
	['workflow:memory-protocol', '已被 V4 作用域记忆协议替代'],
]);

export interface LegacyMemoryInventoryItem {
	legacyIdentity: string;
	slotKey: string;
	content: string;
	contentHash: string;
	source: MemorySource;
	relatedFiles: string[];
	status: string;
	updatedAt: string | null;
}

export interface ScopeMapProject {
	id: string;
	aliases?: readonly string[];
	/** 可同时传项目主文件和项目目录；目录会按路径前缀匹配。 */
	paths?: readonly string[];
}

export interface V4ScopeMapGenerationContext {
	generatedAt: string;
	projects?: readonly ScopeMapProject[];
	repositoryBindings?: Readonly<RepositoryBindings>;
	skillIds?: readonly string[];
	toolIds?: readonly string[];
	/** 在内置全局槽位之外，调用方已明确核验过的全局规则槽位。 */
	globalRuleSlots?: readonly string[];
	contentPreviewLength?: number;
}

/**
 * 指纹只关心会改变默认生成结果的语义上下文；`generatedAt` 可传入但不会参与哈希。
 */
export type V4ScopeMapFingerprintContext = Omit<V4ScopeMapGenerationContext, 'generatedAt'> & {
	generatedAt?: string;
};

export interface GeneratedScopeCandidate {
	scope: MemoryScope;
	reason: string;
}

export interface GeneratedV4ScopeMapEntry extends LegacyScopeMapEntry {
	slotKey: string;
	source: MemorySource;
	relatedFiles: string[];
	updatedAt: string | null;
	confirmed: boolean;
	suggestionReason: string;
	contentPreview: string;
	scopeCandidates: GeneratedScopeCandidate[];
}

export interface V4ScopeMapDocument extends Record<string, unknown> {
	format: typeof V4_SCOPE_MAP_FORMAT;
	formatVersion: typeof V4_SCOPE_MAP_FORMAT_VERSION;
	targetSchemaVersion: 4;
	generatedAt: string;
	contextFingerprint: string;
	generatedEntriesHash: string;
	summary: {
		total: number;
		confirmed: number;
		reviewRequired: number;
	};
	entries: GeneratedV4ScopeMapEntry[];
}

export interface V4ScopeMapFingerprintVerification {
	/** 旧版 formatVersion=1 文档可能没有指纹；此时必须保守地视为不可自动覆盖。 */
	hasFingerprintMetadata: boolean;
	contextMatches: boolean;
	entriesUnchanged: boolean;
	expectedContextFingerprint: string;
	actualEntriesHash: string | null;
}

interface RankedScopeCandidate extends GeneratedScopeCandidate {
	score: number;
}

interface ScopeInference {
	scope: MemoryScope;
	confirmed: boolean;
	reason: string;
	candidates: GeneratedScopeCandidate[];
}

interface KindInference {
	itemKind: MemoryItemKind;
	confirmed: boolean;
	reason: string;
}

interface StatusInference {
	status: MemoryItemStatus;
	confirmed: boolean;
	reason: string;
	archivedAt?: string;
	archiveReason?: string;
}

function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function stableCompare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function stableSerialize(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') {
		return JSON.stringify(value);
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error('scope map 指纹不支持非有限数字');
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
	if (typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const fields = Object.keys(record)
			.filter((key) => record[key] !== undefined)
			.sort(stableCompare)
			.map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`);
		return `{${fields.join(',')}}`;
	}
	throw new Error(`scope map 指纹不支持 ${typeof value}`);
}

function normalizeId(value: string): string {
	return value.trim().toLowerCase();
}

function normalizePath(value: string): string {
	const normalized = value
		.trim()
		.replaceAll('\\', '/')
		.replace(/\/{2,}/g, '/');
	return (normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized).toLowerCase();
}

function identifierTokens(value: string): string[] {
	return normalizeId(value)
		.split(/[^a-z0-9\p{Script=Han}]+/u)
		.filter(Boolean);
}

function hasPrefixBoundary(value: string, prefix: string): boolean {
	return (
		value === prefix ||
		value.startsWith(`${prefix}:`) ||
		value.startsWith(`${prefix}-`) ||
		value.startsWith(`${prefix}_`) ||
		value.startsWith(`${prefix}.`)
	);
}

function scopeKey(scope: MemoryScope): string {
	return `${scope.type}\u0000${scope.key}`;
}

function addCandidate(
	candidates: Map<string, RankedScopeCandidate>,
	scope: MemoryScope,
	score: number,
	reason: string,
): void {
	const key = scopeKey(scope);
	const current = candidates.get(key);
	if (!current || score > current.score) candidates.set(key, { scope, score, reason });
}

function normalizedTimestamp(value: string): string {
	const timestamp = Date.parse(value);
	if (!value.trim() || !Number.isFinite(timestamp)) {
		throw new Error('scope map generatedAt 必须是有效时间戳');
	}
	return new Date(timestamp).toISOString();
}

function validateInventory(items: readonly LegacyMemoryInventoryItem[]): void {
	const identities = new Set<string>();
	for (const item of items) {
		if (!item.legacyIdentity.trim()) throw new Error('legacyIdentity 不能为空');
		if (!item.slotKey.trim()) throw new Error(`${item.legacyIdentity} 的 slotKey 不能为空`);
		if (identities.has(item.legacyIdentity)) {
			throw new Error(`legacyIdentity 重复：${item.legacyIdentity}`);
		}
		identities.add(item.legacyIdentity);
		const calculated = sha256(item.content);
		if (calculated !== item.contentHash.toLowerCase()) {
			throw new Error(`${item.legacyIdentity} 的 contentHash 与内容不匹配`);
		}
		if (item.source !== 'preference' && item.source !== 'correction') {
			throw new Error(`${item.legacyIdentity} 的 source 非法`);
		}
	}
}

function validateProjects(projects: readonly ScopeMapProject[]): ScopeMapProject[] {
	const ids = new Set<string>();
	return projects
		.map((project) => ({
			id: project.id.trim(),
			aliases: project.aliases?.map((alias) => alias.trim()).filter(Boolean),
			paths: project.paths?.map(normalizePath).filter(Boolean),
		}))
		.sort(
			(a, b) => stableCompare(normalizeId(a.id), normalizeId(b.id)) || stableCompare(a.id, b.id),
		)
		.map((project) => {
			if (!project.id) throw new Error('项目 id 不能为空');
			const normalized = normalizeId(project.id);
			if (ids.has(normalized)) throw new Error(`项目 id 重复：${project.id}`);
			ids.add(normalized);
			return project;
		});
}

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort(stableCompare);
}

function previewLength(context: V4ScopeMapFingerprintContext): number {
	const value = context.contentPreviewLength ?? 160;
	if (!Number.isInteger(value) || value < 20 || value > 1000) {
		throw new Error('contentPreviewLength 必须是 20–1000 的整数');
	}
	return value;
}

function canonicalProjects(projects: readonly ScopeMapProject[]): Array<{
	id: string;
	aliases: string[];
	paths: string[];
}> {
	return validateProjects(projects).map((project) => ({
		id: project.id,
		aliases: uniqueSorted((project.aliases ?? []).map(normalizeId).filter(Boolean)),
		paths: uniqueSorted((project.paths ?? []).map(normalizePath).filter(Boolean)),
	}));
}

function canonicalRepositoryBindings(bindings: Readonly<RepositoryBindings>): Array<{
	id: string;
	roots: string[];
}> {
	return Object.entries(bindings)
		.map(([id, roots]) => ({
			id,
			roots: uniqueSorted(roots.map(normalizePath).filter(Boolean)),
		}))
		.sort(
			(a, b) => stableCompare(normalizeId(a.id), normalizeId(b.id)) || stableCompare(a.id, b.id),
		);
}

/**
 * 计算默认 V4 生成器的语义上下文指纹。
 *
 * 仅排除每次生成都会变化、但不参与条目生成的 `generatedAt`。旧条目的全部生成输入均纳入
 * 指纹；路径统一为小写 `/` 分隔，集合按代码点稳定排序，确保不同平台得到相同结果。
 */
export function computeV4ScopeMapContextFingerprint(
	inventory: readonly LegacyMemoryInventoryItem[],
	context: V4ScopeMapFingerprintContext,
): string {
	validateInventory(inventory);
	const projects = canonicalProjects(context.projects ?? []);
	const globalRuleSlots = uniqueSorted(
		[...DEFAULT_GLOBAL_RULE_SLOTS, ...(context.globalRuleSlots ?? [])].map(normalizeId),
	);
	const payload = {
		generator: {
			id: V4_SCOPE_MAP_GENERATOR,
			version: V4_SCOPE_MAP_GENERATOR_VERSION,
			format: V4_SCOPE_MAP_FORMAT,
			formatVersion: V4_SCOPE_MAP_FORMAT_VERSION,
			targetSchemaVersion: 4,
		},
		inventory: [...inventory]
			.map((item) => ({
				legacyIdentity: item.legacyIdentity,
				slotKey: item.slotKey,
				contentHash: item.contentHash.toLowerCase(),
				source: item.source,
				relatedFiles: item.relatedFiles.map(normalizePath),
				status: item.status,
				updatedAt: item.updatedAt,
			}))
			.sort(
				(a, b) =>
					stableCompare(a.legacyIdentity, b.legacyIdentity) ||
					stableCompare(a.contentHash, b.contentHash),
			),
		projects,
		repositoryBindings: canonicalRepositoryBindings(context.repositoryBindings ?? {}),
		skillIds: uniqueSorted(
			(context.skillIds ?? DEFAULT_LIFEOS_SKILL_IDS).map((id) => id.trim()).filter(Boolean),
		),
		toolIds: uniqueSorted(
			(context.toolIds ?? DEFAULT_LIFEOS_TOOL_IDS).map((id) => id.trim()).filter(Boolean),
		),
		globalRuleSlots,
		contentPreviewLength: previewLength(context),
	};
	return sha256(stableSerialize(payload));
}

/** 对生成 entries 的全部字段做稳定语义哈希，用于识别任何人工修改。 */
export function computeV4ScopeMapEntriesHash(entries: readonly unknown[]): string {
	const normalized = [...entries].sort((a, b) => {
		const left = stableSerialize(a);
		const right = stableSerialize(b);
		const leftIdentity =
			a &&
			typeof a === 'object' &&
			typeof (a as Record<string, unknown>).legacyIdentity === 'string'
				? ((a as Record<string, unknown>).legacyIdentity as string)
				: '';
		const rightIdentity =
			b &&
			typeof b === 'object' &&
			typeof (b as Record<string, unknown>).legacyIdentity === 'string'
				? ((b as Record<string, unknown>).legacyIdentity as string)
				: '';
		return stableCompare(leftIdentity, rightIdentity) || stableCompare(left, right);
	});
	return sha256(stableSerialize(normalized));
}

/**
 * 验证默认机器生成的 map 是否仍为原始语义内容，以及当前生成上下文是否已经变化。
 * 缺少新增字段的旧 formatVersion=1 文档返回 `hasFingerprintMetadata: false`，由升级器保守处理。
 */
export function verifyV4ScopeMapFingerprints(
	document: unknown,
	inventory: readonly LegacyMemoryInventoryItem[],
	context: V4ScopeMapFingerprintContext,
): V4ScopeMapFingerprintVerification {
	const expectedContextFingerprint = computeV4ScopeMapContextFingerprint(inventory, context);
	const record =
		document && typeof document === 'object' ? (document as Record<string, unknown>) : {};
	const contextFingerprint = record.contextFingerprint;
	const generatedEntriesHash = record.generatedEntriesHash;
	const entries = Array.isArray(record.entries) ? record.entries : null;
	const hashPattern = /^[a-f0-9]{64}$/;
	const hasFingerprintMetadata =
		typeof contextFingerprint === 'string' &&
		hashPattern.test(contextFingerprint) &&
		typeof generatedEntriesHash === 'string' &&
		hashPattern.test(generatedEntriesHash);
	const actualEntriesHash = entries ? computeV4ScopeMapEntriesHash(entries) : null;
	return {
		hasFingerprintMetadata,
		contextMatches: hasFingerprintMetadata && contextFingerprint === expectedContextFingerprint,
		entriesUnchanged:
			hasFingerprintMetadata &&
			actualEntriesHash !== null &&
			generatedEntriesHash === actualEntriesHash,
		expectedContextFingerprint,
		actualEntriesHash,
	};
}

function explicitScopedCandidate(
	slotKey: string,
	prefix: 'skill' | 'tool' | 'repository',
	ids: readonly string[],
	score: number,
	candidates: Map<string, RankedScopeCandidate>,
): void {
	const normalizedSlot = normalizeId(slotKey);
	const tail = normalizedSlot.startsWith(`${prefix}:`)
		? normalizedSlot.slice(prefix.length + 1)
		: prefix === 'skill' && normalizedSlot.startsWith('workflow:')
			? normalizedSlot.slice('workflow:'.length)
			: '';
	if (!tail) return;
	for (const rawId of ids) {
		const id = rawId.trim();
		if (!id || !hasPrefixBoundary(tail, normalizeId(id))) continue;
		addCandidate(
			candidates,
			{ type: prefix, key: id },
			score,
			`${prefix} 前缀与已知标识 ${id} 唯一匹配`,
		);
	}
}

function projectCandidates(
	item: LegacyMemoryInventoryItem,
	projects: readonly ScopeMapProject[],
	candidates: Map<string, RankedScopeCandidate>,
): void {
	const slotTail = normalizeId(item.slotKey.split(':').slice(1).join(':'));
	const tailTokens = identifierTokens(slotTail);
	const relatedFiles = item.relatedFiles.map(normalizePath);
	const normalizedContent = normalizeId(item.content);

	for (const project of projects) {
		const names = [project.id, ...(project.aliases ?? [])].map(normalizeId);
		const projectScope: MemoryScope = { type: 'project', key: project.id };
		if (names.some((name) => slotTail === name)) {
			addCandidate(candidates, projectScope, 100, `槽位后缀精确匹配项目 ${project.id}`);
		}
		if (names.some((name) => hasPrefixBoundary(slotTail, name))) {
			addCandidate(candidates, projectScope, 96, `槽位后缀以项目标识 ${project.id} 开头`);
		}
		const nameTokens = names.flatMap(identifierTokens).filter((token) => token.length >= 3);
		if (tailTokens.some((token) => nameTokens.includes(token))) {
			addCandidate(candidates, projectScope, 82, `槽位标识与项目 ${project.id} 共享稳定标识`);
		}
		if (
			(project.paths ?? []).some((path) =>
				relatedFiles.some((related) => related === path || related.startsWith(`${path}/`)),
			)
		) {
			addCandidate(candidates, projectScope, 98, `related_files 唯一落在项目 ${project.id}`);
		}
		if (names.some((name) => name.length >= 3 && normalizedContent.includes(name))) {
			addCandidate(candidates, projectScope, 78, `内容提到项目标识 ${project.id}`);
		}
	}
}

function repositoryCandidates(
	item: LegacyMemoryInventoryItem,
	bindings: Readonly<RepositoryBindings>,
	candidates: Map<string, RankedScopeCandidate>,
): void {
	const ids = Object.keys(bindings).sort(stableCompare);
	explicitScopedCandidate(item.slotKey, 'repository', ids, 100, candidates);
	const relatedFiles = item.relatedFiles.map(normalizePath);
	const content = normalizePath(item.content);
	const slot = normalizeId(item.slotKey);
	const slotTokens = identifierTokens(slot);
	const contentTokens = identifierTokens(content);
	for (const id of ids) {
		const normalizedId = normalizeId(id);
		if (normalizedId.length >= 3 && slotTokens.includes(normalizedId)) {
			addCandidate(
				candidates,
				{ type: 'repository', key: id },
				86,
				`槽位包含 repository 标识 ${id}`,
			);
		}
		if (normalizedId.length >= 3 && contentTokens.includes(normalizedId)) {
			addCandidate(
				candidates,
				{ type: 'repository', key: id },
				84,
				`内容提到 repository 标识 ${id}`,
			);
		}
		for (const rawRoot of bindings[id] ?? []) {
			const root = normalizePath(rawRoot);
			if (!root) continue;
			if (relatedFiles.some((path) => path === root || path.startsWith(`${root}/`))) {
				addCandidate(
					candidates,
					{ type: 'repository', key: id },
					94,
					`related_files 唯一落在 repository ${id} 的绑定根目录`,
				);
			}
			if (content.includes(root)) {
				addCandidate(
					candidates,
					{ type: 'repository', key: id },
					90,
					`内容包含 repository ${id} 的绑定根目录`,
				);
			}
		}
	}
}

function toolCandidates(
	item: LegacyMemoryInventoryItem,
	toolIds: readonly string[],
	candidates: Map<string, RankedScopeCandidate>,
): void {
	explicitScopedCandidate(item.slotKey, 'tool', toolIds, 100, candidates);
	const content = normalizeId(item.content);
	const contentTokens = identifierTokens(content);
	for (const rawId of toolIds) {
		const id = rawId.trim();
		const normalized = normalizeId(id);
		if (normalized.length < 3 || !contentTokens.includes(normalized)) continue;
		addCandidate(candidates, { type: 'tool', key: id }, 84, `内容提到工具标识 ${id}`);
	}
}

function inferScope(
	item: LegacyMemoryInventoryItem,
	context: {
		projects: readonly ScopeMapProject[];
		repositoryBindings: Readonly<RepositoryBindings>;
		skillIds: readonly string[];
		toolIds: readonly string[];
		globalRuleSlots: ReadonlySet<string>;
	},
): ScopeInference {
	const normalizedSlot = normalizeId(item.slotKey);
	if (context.globalRuleSlots.has(normalizedSlot) || normalizedSlot.startsWith('global:')) {
		return {
			scope: { type: 'global', key: '' },
			confirmed: true,
			reason: '槽位属于已核验的全局规则集合',
			candidates: [{ scope: { type: 'global', key: '' }, reason: '已核验全局槽位' }],
		};
	}
	if (RETIRED_PROFILE_SLOTS.has(normalizedSlot) || RETIRED_EVENT_SLOTS.has(normalizedSlot)) {
		return {
			scope: { type: 'global', key: '' },
			confirmed: true,
			reason: '这是已知的系统级退役槽位，归档后不进入有效上下文',
			candidates: [{ scope: { type: 'global', key: '' }, reason: '已知系统退役槽位' }],
		};
	}

	const ranked = new Map<string, RankedScopeCandidate>();
	explicitScopedCandidate(item.slotKey, 'skill', context.skillIds, 100, ranked);
	toolCandidates(item, context.toolIds, ranked);
	repositoryCandidates(item, context.repositoryBindings, ranked);
	projectCandidates(item, context.projects, ranked);

	if (item.relatedFiles.length === 1) {
		addCandidate(
			ranked,
			{ type: 'file', key: item.relatedFiles[0] ?? REVIEW_REQUIRED_SCOPE_KEY },
			40,
			'仅有一个 related_file，可作为人工复核候选，但不足以自动确认作用域',
		);
	}

	const ordered = [...ranked.values()].sort(
		(a, b) => b.score - a.score || stableCompare(scopeKey(a.scope), scopeKey(b.scope)),
	);
	const publicCandidates = ordered.map(({ scope, reason }) => ({ scope, reason }));
	if (ordered.length === 0) {
		return {
			scope: { type: 'file', key: REVIEW_REQUIRED_SCOPE_KEY },
			confirmed: false,
			reason: '未找到可靠作用域证据；未默认写入 global',
			candidates: [],
		};
	}
	const best = ordered[0];
	if (!best) throw new Error('作用域候选排序失败');
	const tied = ordered.filter((candidate) => candidate.score === best.score);
	if (best.score < 80) {
		return {
			scope: best.scope,
			confirmed: false,
			reason: `${best.reason}，证据不足，需人工确认`,
			candidates: publicCandidates,
		};
	}
	if (tied.length > 1) {
		return {
			scope: best.scope,
			confirmed: false,
			reason: `存在 ${tied.length} 个同等强度的作用域候选，需人工消歧`,
			candidates: publicCandidates,
		};
	}
	return {
		scope: best.scope,
		confirmed: true,
		reason: best.reason,
		candidates: publicCandidates,
	};
}

function inferKind(item: LegacyMemoryInventoryItem): KindInference {
	const slot = normalizeId(item.slotKey);
	const content = item.content;
	if (slot.startsWith('profile:')) {
		return { itemKind: 'profile', confirmed: true, reason: 'profile 槽位确定为画像条目' };
	}
	if (slot.startsWith('event:') || slot.startsWith('archive:')) {
		return { itemKind: 'event', confirmed: true, reason: '事件/归档槽位确定为 event' };
	}
	if (slot === 'workflow:memory-protocol') {
		return { itemKind: 'event', confirmed: true, reason: '已被替代的协议槽位按历史 event 归档' };
	}
	if (slot.startsWith('project:')) {
		return { itemKind: 'decision', confirmed: true, reason: 'project 槽位确定为项目决策' };
	}
	if (
		slot.startsWith('workflow:') ||
		slot.startsWith('format:') ||
		slot.startsWith('preference:') ||
		slot.startsWith('content:') ||
		slot.startsWith('global:')
	) {
		return { itemKind: 'rule', confirmed: true, reason: '规则型槽位前缀确定为 rule' };
	}
	const normative =
		/必须|禁止|不得|不用|不要|只需(?:要)?|一律|应该|应当|优先|默认|务必|\bmust\b|\bnever\b|\balways\b|\bshould\b|\bdefault\b|\bprefer\b/i;
	if (normative.test(content)) {
		return { itemKind: 'rule', confirmed: true, reason: '内容包含明确约束词，确定为 rule' };
	}
	const factual = /路径|目录|源码|位于|\bpath\b|\bdirectory\b|\brepository\b|\bsource\b/i;
	if ((slot.startsWith('tool:') || slot.startsWith('repository:')) && factual.test(content)) {
		return { itemKind: 'fact', confirmed: true, reason: '工具/仓库槽位记录路径类事实' };
	}
	return { itemKind: 'fact', confirmed: false, reason: '无法可靠区分 fact、decision 或 rule' };
}

function inferStatus(
	item: LegacyMemoryInventoryItem,
	itemKind: MemoryItemKind,
	generatedAt: string,
): StatusInference {
	const slot = normalizeId(item.slotKey);
	const retiredReason = RETIRED_PROFILE_SLOTS.get(slot) ?? RETIRED_EVENT_SLOTS.get(slot);
	if (retiredReason) {
		return {
			status: 'archived',
			confirmed: true,
			reason: retiredReason,
			archivedAt: generatedAt,
			archiveReason: retiredReason,
		};
	}
	if (itemKind === 'event') {
		return {
			status: 'archived',
			confirmed: true,
			reason: 'V4 event 必须归档',
			archivedAt: generatedAt,
			archiveReason: '旧事件在 V4 迁移时退出有效上下文',
		};
	}
	if (item.status === 'archived') {
		return {
			status: 'archived',
			confirmed: true,
			reason: '沿用旧归档状态并补齐 V4 归档元数据',
			archivedAt: generatedAt,
			archiveReason: '沿用迁移前归档状态',
		};
	}
	if (item.status === 'active' || item.status === 'expired') {
		return { status: item.status, confirmed: true, reason: `沿用旧状态 ${item.status}` };
	}
	return {
		status: 'active',
		confirmed: false,
		reason: `旧状态 ${item.status} 无法自动映射，暂列 active 等待确认`,
	};
}

function mappingPolicy(
	itemKind: MemoryItemKind,
	scope: MemoryScope,
): {
	priority: number;
	enforcement: MemoryEnforcement;
} {
	if (itemKind === 'rule' && scope.type === 'global') {
		return { priority: 100, enforcement: 'hard' };
	}
	if (itemKind === 'rule') return { priority: 80, enforcement: 'soft' };
	if (itemKind === 'decision') return { priority: 75, enforcement: 'soft' };
	if (itemKind === 'fact') return { priority: 60, enforcement: 'soft' };
	if (itemKind === 'profile') return { priority: 50, enforcement: 'soft' };
	return { priority: 0, enforcement: 'soft' };
}

function contentPreview(content: string, limit: number): string {
	const normalized = content.replace(/\s+/g, ' ').trim();
	const characters = [...normalized];
	return characters.length <= limit ? normalized : `${characters.slice(0, limit).join('')}…`;
}

/**
 * 生成可直接落盘的 V4 scope map 审阅文档。
 *
 * `confirmed: false` 是迁移阻断信号。未解析条目使用非 global 的显式占位 scope，
 * 调用方必须先让用户完成复核，再把 entries 传给 `migrateToV4`。
 */
export function generateV4ScopeMap(
	inventory: readonly LegacyMemoryInventoryItem[],
	context: V4ScopeMapGenerationContext,
): V4ScopeMapDocument {
	validateInventory(inventory);
	const generatedAt = normalizedTimestamp(context.generatedAt);
	const projects = validateProjects(context.projects ?? []);
	const effectivePreviewLength = previewLength(context);
	const globalRuleSlots = new Set(
		[...DEFAULT_GLOBAL_RULE_SLOTS, ...(context.globalRuleSlots ?? [])].map(normalizeId),
	);
	const inferenceContext = {
		projects,
		repositoryBindings: context.repositoryBindings ?? {},
		skillIds: context.skillIds ?? DEFAULT_LIFEOS_SKILL_IDS,
		toolIds: context.toolIds ?? DEFAULT_LIFEOS_TOOL_IDS,
		globalRuleSlots,
	};

	const entries = [...inventory]
		.sort((a, b) => stableCompare(a.legacyIdentity, b.legacyIdentity))
		.map((item): GeneratedV4ScopeMapEntry => {
			const scope = inferScope(item, inferenceContext);
			const kind = inferKind(item);
			const status = inferStatus(item, kind.itemKind, generatedAt);
			const policy = mappingPolicy(kind.itemKind, scope.scope);
			const confirmed = scope.confirmed && kind.confirmed && status.confirmed;
			const reasons = [scope.reason, kind.reason, status.reason];
			if (!confirmed) reasons.push('此条目必须人工确认后才能迁移');
			return {
				legacyIdentity: item.legacyIdentity,
				contentHash: item.contentHash.toLowerCase(),
				scope: scope.scope,
				itemKind: kind.itemKind,
				priority: policy.priority,
				enforcement: policy.enforcement,
				status: status.status,
				...(status.archivedAt ? { archivedAt: status.archivedAt } : {}),
				...(status.archiveReason ? { archiveReason: status.archiveReason } : {}),
				slotKey: item.slotKey,
				source: item.source,
				relatedFiles: [...item.relatedFiles],
				updatedAt: item.updatedAt,
				confirmed,
				suggestionReason: reasons.join('；'),
				contentPreview: contentPreview(item.content, effectivePreviewLength),
				scopeCandidates: scope.candidates,
			};
		});
	const confirmed = entries.filter((entry) => entry.confirmed).length;
	return {
		format: V4_SCOPE_MAP_FORMAT,
		formatVersion: V4_SCOPE_MAP_FORMAT_VERSION,
		targetSchemaVersion: 4,
		generatedAt,
		contextFingerprint: computeV4ScopeMapContextFingerprint(inventory, context),
		generatedEntriesHash: computeV4ScopeMapEntriesHash(entries),
		summary: {
			total: entries.length,
			confirmed,
			reviewRequired: entries.length - confirmed,
		},
		entries,
	};
}
