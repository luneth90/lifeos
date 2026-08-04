import { existsSync, lstatSync } from 'node:fs';
import { isAbsolute, resolve, win32 } from 'node:path';
import type Database from 'better-sqlite3';
import type { VaultConfig } from '../config.js';
import type { MemoryScope, ScopeType } from '../types.js';
import { assertVaultPathSafe } from '../utils/safe-path.js';

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
	allowCreate?: boolean;
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

function hasMemoryScope(db: Database.Database, scope: MemoryScope): boolean {
	return (
		db
			.prepare(`
				SELECT 1 FROM memory_items
				WHERE scope_type = ? AND scope_key = ? AND status = 'active'
				LIMIT 1
			`)
			.get(scope.type, scope.key) !== undefined
	);
}

function resolveToolAlias(config: VaultConfig | undefined, key: string): string[] {
	if (!config) return [];
	const bindings = config.toolBindings();
	return Object.entries(bindings)
		.filter(
			([toolId, binding]) =>
				toolId === key || binding.commands.includes(key) || binding.skills.includes(key),
		)
		.map(([toolId]) => toolId)
		.sort();
}

function resolveExistingVaultFile(
	db: Database.Database,
	config: VaultConfig | undefined,
	key: string,
): MemoryScope | null {
	const vaultRoot = config?.vaultRoot;
	const scope = { type: 'file', key } as const;
	if (!vaultRoot || !hasMemoryScope(db, scope)) return null;
	const portable = key.replaceAll('\\', '/');
	if (
		isAbsolute(key) ||
		win32.isAbsolute(key) ||
		portable.startsWith('/') ||
		portable.split('/').some((component) => component === '.' || component === '..')
	) {
		return null;
	}
	try {
		const candidate = assertVaultPathSafe(vaultRoot, resolve(vaultRoot, portable));
		return existsSync(candidate) && lstatSync(candidate).isFile() ? scope : null;
	} catch {
		return null;
	}
}

export function resolveMemoryScopes(
	db: Database.Database,
	scopes: MemoryScope[],
	options: ScopeResolverOptions = {},
): ScopeResolutionResult {
	const resolvedScopes: MemoryScope[] = [];
	const unresolvedScopes: UnresolvedScope[] = [];
	const seen = new Set<string>();
	const bindings = options.config?.repositoryBindings() ?? {};

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
			const rows = db
				.prepare("SELECT file_path FROM vault_index WHERE type = 'project' AND entity_id = ?")
				.all(scope.key) as Array<{ file_path: string }>;
			canonical = rows.length === 1 ? scope : null;
			unresolvedReason = rows.length > 1 ? 'duplicate_project_entity_id' : 'unknown_project';
		} else if (scope.type === 'file') {
			const exactPath = db
				.prepare('SELECT entity_id, file_path FROM vault_index WHERE file_path = ?')
				.get(scope.key) as { entity_id: string | null; file_path: string } | undefined;
			if (exactPath) {
				const idCount = exactPath.entity_id
					? (
							db
								.prepare('SELECT COUNT(*) AS count FROM vault_index WHERE entity_id = ?')
								.get(exactPath.entity_id) as { count: number }
						).count
					: 0;
				canonical = {
					type: 'file',
					key: exactPath.entity_id && idCount === 1 ? exactPath.entity_id : exactPath.file_path,
				};
			} else {
				const byId = db
					.prepare('SELECT file_path FROM vault_index WHERE entity_id = ?')
					.all(scope.key) as Array<{ file_path: string }>;
				canonical =
					byId.length === 1
						? scope
						: byId.length === 0
							? resolveExistingVaultFile(db, options.config, scope.key)
							: null;
				unresolvedReason = byId.length > 1 ? 'duplicate_file_entity_id' : 'unknown_file';
			}
		} else if (scope.type === 'repository') {
			canonical =
				Object.prototype.hasOwnProperty.call(bindings, scope.key) ||
				(!options.requireRepositoryBinding && hasMemoryScope(db, scope))
					? scope
					: null;
		} else if (scope.type === 'tool') {
			if (hasMemoryScope(db, scope)) {
				canonical = scope;
			} else {
				const aliases = resolveToolAlias(options.config, scope.key);
				if (aliases.length === 1) {
					const candidate = { type: 'tool', key: aliases[0] } as const;
					canonical = options.allowCreate || hasMemoryScope(db, candidate) ? candidate : null;
					if (!canonical) candidates = aliases;
				} else if (aliases.length === 0 && options.allowCreate) {
					canonical = scope;
				} else {
					unresolvedReason = aliases.length > 1 ? 'ambiguous_tool_alias' : 'unknown_tool';
					if (aliases.length > 0) candidates = aliases;
				}
			}
		} else {
			canonical = options.allowCreate || hasMemoryScope(db, scope) ? scope : null;
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
