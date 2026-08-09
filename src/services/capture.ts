/** 文件变更通知服务；记忆条目写入统一由 memory-items.ts 负责。 */

import { isAbsolute, relative, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { type VaultConfig, getOrCreateVaultConfig } from '../config.js';
import type { MemoryScope } from '../types.js';
import type { IndexImpact, IndexResult } from '../utils/vault-indexer.js';
import { createEmptyIndexImpact, indexFiles, shouldIndex } from '../utils/vault-indexer.js';
import { getMemoryItemById, updateMemoryItemForFileMove } from './memory-items.js';

export interface NotifyFileChangedResult {
	action: 'indexed' | 'unchanged' | 'removed' | 'skipped' | 'error';
	filePath: string;
	impact: IndexImpact;
	reason?: string;
	previousFilePath?: string;
}

export interface NotifyFilesChangedResult {
	results: NotifyFileChangedResult[];
	impact: IndexImpact;
}

function toNotifyResult(result: IndexResult, impact: IndexImpact): NotifyFileChangedResult {
	return {
		action: result.status,
		filePath: result.filePath,
		impact,
		reason: result.reason,
	};
}

function vaultRelativePath(vaultRoot: string, filePath: string): string {
	const root = resolve(vaultRoot);
	const absolute = isAbsolute(filePath) ? resolve(filePath) : resolve(root, filePath);
	const path = relative(root, absolute).replace(/\\/g, '/');
	if (!path || path === '..' || path.startsWith('../')) {
		throw new Error(`文件路径不在 Vault 内：${filePath}`);
	}
	return path;
}

function addAffectedScope(scopes: Map<string, MemoryScope>, scope: MemoryScope): void {
	scopes.set(`${scope.type}\u0000${scope.key}`, scope);
}

function mergeIndexImpact(impact: IndexImpact, affectedScopes: MemoryScope[]): IndexImpact {
	const scopes = new Map<string, MemoryScope>();
	for (const scope of [...impact.affectedScopes, ...affectedScopes]) {
		addAffectedScope(scopes, scope);
	}
	return {
		vaultIndexChanged: impact.vaultIndexChanged,
		backlinksChanged: impact.backlinksChanged,
		taskboardChanged: impact.taskboardChanged,
		profileChanged: impact.profileChanged,
		affectedScopes: [...scopes.values()],
		changedEntityIds: [...impact.changedEntityIds],
	};
}

function migrateMovedFileReferences(
	db: Database.Database,
	oldScopeKeys: string[],
	oldPath: string,
	newPath: string,
	newScopeKey: string,
): MemoryScope[] {
	const now = new Date().toISOString();
	const affectedScopes = new Map<string, MemoryScope>();
	const sourceKeys = [...new Set(oldScopeKeys)];
	const allKeys = [...new Set([...sourceKeys, newScopeKey])];
	const placeholders = allKeys.map(() => '?').join(', ');
	const conflict = db
		.prepare(`
			SELECT slot_key
			FROM memory_items
			WHERE scope_type = 'file' AND scope_key IN (${placeholders})
			GROUP BY slot_key
			HAVING COUNT(*) > 1
			LIMIT 1
		`)
		.get(...allKeys) as { slot_key: string } | undefined;
	if (conflict) {
		throw new Error(`移动后的文件记忆作用域冲突：file:${newScopeKey}/${conflict.slot_key}`);
	}
	const migratingKeys = sourceKeys.filter((key) => key !== newScopeKey);
	for (const key of sourceKeys) addAffectedScope(affectedScopes, { type: 'file', key });
	addAffectedScope(affectedScopes, { type: 'file', key: newScopeKey });

	const candidateConditions = ["related_files != '[]'"];
	const candidateParams: string[] = [];
	if (migratingKeys.length > 0) {
		candidateConditions.push(
			`(scope_type = 'file' AND scope_key IN (${migratingKeys.map(() => '?').join(', ')}))`,
		);
		candidateParams.push(...migratingKeys);
	}
	const candidateIds = db
		.prepare(`
			SELECT item_id FROM memory_items
			WHERE ${candidateConditions.join(' OR ')}
			ORDER BY item_id
		`)
		.all(...candidateParams) as Array<{ item_id: number }>;
	const correlationId = `memory-notify:move:${oldPath}:${newPath}:${now}`;
	const reason = `文件移动同步：${oldPath} -> ${newPath}`;
	for (const { item_id: itemId } of candidateIds) {
		const item = getMemoryItemById(db, itemId);
		if (!item) continue;
		const scope =
			item.scope.type === 'file' && migratingKeys.includes(item.scope.key)
				? { type: 'file' as const, key: newScopeKey }
				: item.scope;
		const relatedFiles = item.relatedFiles.map((path) => (path === oldPath ? newPath : path));
		const changed = updateMemoryItemForFileMove(db, {
			itemId,
			scope,
			relatedFiles,
			updatedAt: now,
			actor: 'service:capture',
			correlationId,
			reason,
		});
		if (changed) addAffectedScope(affectedScopes, changed.scope);
	}
	return [...affectedScopes.values()];
}

function notifyFileMoved(
	db: Database.Database,
	vaultRoot: string,
	previousFilePath: string,
	filePath: string,
	config?: VaultConfig,
): NotifyFileChangedResult {
	const oldPath = vaultRelativePath(vaultRoot, previousFilePath);
	const newPath = vaultRelativePath(vaultRoot, filePath);
	const move = db.transaction(() => {
		const cfg = config ?? getOrCreateVaultConfig(vaultRoot);
		const previous = db
			.prepare('SELECT entity_id FROM vault_index WHERE file_path = ?')
			.get(oldPath) as { entity_id: string | null } | undefined;
		const oldScopeKeys = [oldPath];
		if (previous?.entity_id) {
			const count = (
				db
					.prepare('SELECT COUNT(*) AS count FROM vault_index WHERE entity_id = ?')
					.get(previous.entity_id) as { count: number }
			).count;
			if (count === 1) oldScopeKeys.push(previous.entity_id);
		}
		const indexed = indexFiles(db, vaultRoot, [oldPath, newPath], cfg);
		const targetShouldIndex = shouldIndex(newPath, cfg);
		const result = indexed.results.find((candidate) => candidate.filePath === newPath);
		const current = db
			.prepare('SELECT entity_id FROM vault_index WHERE file_path = ?')
			.get(newPath) as { entity_id: string | null } | undefined;
		const targetIndexedSuccessfully =
			result?.status === 'indexed' || result?.status === 'unchanged';
		if (targetShouldIndex && (!current || !targetIndexedSuccessfully)) {
			throw new Error(`移动后的文件未进入索引：${newPath}`);
		}
		if (!targetShouldIndex && current) {
			throw new Error(`移动后的排除文件仍在索引：${newPath}`);
		}
		let newScopeKey = newPath;
		if (current?.entity_id) {
			const count = (
				db
					.prepare('SELECT COUNT(*) AS count FROM vault_index WHERE entity_id = ?')
					.get(current.entity_id) as { count: number }
			).count;
			if (count === 1) newScopeKey = current.entity_id;
		}
		const affectedScopes = migrateMovedFileReferences(
			db,
			oldScopeKeys,
			oldPath,
			newPath,
			newScopeKey,
		);
		return {
			action: result?.status ?? (targetShouldIndex ? 'indexed' : 'skipped'),
			filePath: newPath,
			previousFilePath: oldPath,
			impact: mergeIndexImpact(indexed.impact, affectedScopes),
			reason: result?.reason,
		} satisfies NotifyFileChangedResult;
	});
	return move.immediate();
}

export function notifyFilesChanged(
	db: Database.Database,
	vaultRoot: string,
	filePaths: string[],
	config?: VaultConfig,
): NotifyFilesChangedResult {
	try {
		const indexed = indexFiles(db, vaultRoot, filePaths, config);
		return {
			results: indexed.results.map((result) => toNotifyResult(result, indexed.impact)),
			impact: indexed.impact,
		};
	} catch (error) {
		return {
			results: filePaths.map((filePath) => ({
				action: 'error',
				filePath,
				impact: createEmptyIndexImpact(),
				reason: error instanceof Error ? error.message : String(error),
			})),
			impact: createEmptyIndexImpact(),
		};
	}
}

export function notifyFileChanged(
	db: Database.Database,
	vaultRoot: string,
	filePath: string,
	previousFilePath?: string,
	config?: VaultConfig,
): NotifyFileChangedResult {
	if (previousFilePath) {
		try {
			return notifyFileMoved(db, vaultRoot, previousFilePath, filePath, config);
		} catch (error) {
			return {
				action: 'error',
				filePath,
				previousFilePath,
				impact: createEmptyIndexImpact(),
				reason: error instanceof Error ? error.message : String(error),
			};
		}
	}
	return notifyFilesChanged(db, vaultRoot, [filePath], config)
		.results[0] as NotifyFileChangedResult;
}
