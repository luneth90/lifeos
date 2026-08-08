import type Database from 'better-sqlite3';
import type { VaultConfig } from '../config.js';
import type { MemoryScope, ScopeType } from '../types.js';
import { buildScopeCatalog } from './scope-catalog.js';

const SCOPE_TYPES = new Set<ScopeType>([
	'global',
	'skill',
	'project',
	'repository',
	'tool',
	'file',
]);

export interface UnresolvedScope {
	scope: MemoryScope;
	reason: string;
	candidates?: string[];
}

export interface ScopeResolutionResult {
	resolvedScopes: MemoryScope[];
	unresolvedScopes: UnresolvedScope[];
}

export interface ScopeResolverOptions {
	config?: VaultConfig;
	/** @deprecated 保留调用兼容；未知对象不再允许隐式创建。 */
	allowCreate?: boolean;
	/** @deprecated repository 始终要求存在于作用域目录。 */
	requireRepositoryBinding?: boolean;
}

function identity(scope: MemoryScope): string {
	return `${scope.type}\u0000${scope.key}`;
}

function normalize(scope: MemoryScope): MemoryScope | null {
	if (!scope || !SCOPE_TYPES.has(scope.type)) return null;
	const key = typeof scope.key === 'string' ? scope.key.trim() : '';
	if (scope.type === 'global') return key === '' ? { type: 'global', key: '' } : null;
	return key ? { type: scope.type, key } : null;
}

function resolveToolAlias(
	bindings: ReturnType<VaultConfig['toolBindings']>,
	key: string,
): string[] {
	return Object.entries(bindings)
		.filter(
			([toolId, binding]) =>
				toolId === key || binding.commands.includes(key) || binding.skills.includes(key),
		)
		.map(([toolId]) => toolId)
		.sort();
}

export function resolveMemoryScopes(
	db: Database.Database,
	scopes: MemoryScope[],
	options: ScopeResolverOptions = {},
): ScopeResolutionResult {
	const resolvedScopes: MemoryScope[] = [];
	const unresolvedScopes: UnresolvedScope[] = [];
	const seen = new Set<string>();
	const catalog = buildScopeCatalog(db, options.config);

	for (const raw of scopes ?? []) {
		const scope = normalize(raw);
		if (!scope) {
			unresolvedScopes.push({ scope: raw, reason: 'invalid_scope' });
			continue;
		}
		let canonical: MemoryScope | null = null;
		let unresolvedReason: string | null = null;
		let candidates: string[] | null = null;
		if (scope.type === 'global') {
			canonical = scope;
		} else if (scope.type === 'project') {
			const rows = catalog.projects.filter((project) => project.entityId === scope.key);
			canonical = rows.length === 1 ? scope : null;
			unresolvedReason = rows.length > 1 ? 'duplicate_project_entity_id' : 'unknown_project';
		} else if (scope.type === 'file') {
			const exactPath = catalog.files.find((file) => file.filePath === scope.key);
			if (exactPath) {
				const idCount = exactPath.entityId
					? catalog.files.filter((file) => file.entityId === exactPath.entityId).length
					: 0;
				canonical = {
					type: 'file',
					key: exactPath.entityId && idCount === 1 ? exactPath.entityId : exactPath.filePath,
				};
			} else {
				const byId = catalog.files.filter((file) => file.entityId === scope.key);
				canonical = byId.length === 1 ? scope : null;
				unresolvedReason = byId.length > 1 ? 'duplicate_file_entity_id' : 'unknown_file';
			}
		} else if (scope.type === 'repository') {
			canonical = Object.prototype.hasOwnProperty.call(catalog.repositories, scope.key)
				? scope
				: null;
		} else if (scope.type === 'tool') {
			if (Object.prototype.hasOwnProperty.call(catalog.tools, scope.key)) {
				canonical = scope;
			} else {
				const aliases = resolveToolAlias(catalog.tools, scope.key);
				if (aliases.length === 1) {
					canonical = { type: 'tool', key: aliases[0] };
				} else {
					unresolvedReason = aliases.length > 1 ? 'ambiguous_tool_alias' : 'unknown_tool';
					if (aliases.length > 0) candidates = aliases;
				}
			}
		} else {
			canonical = catalog.skills.includes(scope.key) ? scope : null;
		}

		if (!canonical) {
			unresolvedScopes.push({
				scope,
				reason: unresolvedReason ?? `unknown_${scope.type}`,
				...(candidates ? { candidates } : {}),
			});
			continue;
		}
		const id = identity(canonical);
		if (!seen.has(id)) {
			seen.add(id);
			resolvedScopes.push(canonical);
		}
	}
	return { resolvedScopes, unresolvedScopes };
}
