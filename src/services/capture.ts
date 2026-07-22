/** 文件变更通知服务；记忆条目写入统一由 memory-items.ts 负责。 */

import { isAbsolute, relative, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import type { VaultConfig } from '../config.js';
import type { MemoryScope } from '../types.js';
import type { IndexImpact, IndexResult } from '../utils/vault-indexer.js';
import { indexFiles } from '../utils/vault-indexer.js';

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

const EMPTY_IMPACT: IndexImpact = {
	vaultIndexChanged: false,
	backlinksChanged: false,
	taskboardChanged: false,
	profileChanged: false,
	affectedScopes: [],
	changedEntityIds: [],
};

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

function addAffectedScope(impact: IndexImpact, scope: MemoryScope): void {
	if (
		!impact.affectedScopes.some(
			(candidate) => candidate.type === scope.type && candidate.key === scope.key,
		)
	) {
		impact.affectedScopes.push(scope);
	}
}

function migrateMovedFileReferences(
	db: Database.Database,
	oldPath: string,
	newPath: string,
	newScopeKey: string,
	impact: IndexImpact,
): void {
	const now = new Date().toISOString();
	if (oldPath !== newScopeKey) {
		db.prepare(`
			UPDATE memory_items SET scope_key = ?, updated_at = ?
			WHERE scope_type = 'file' AND scope_key = ?
		`).run(newScopeKey, now, oldPath);
	}
	addAffectedScope(impact, { type: 'file', key: oldPath });
	addAffectedScope(impact, { type: 'file', key: newScopeKey });

	const rows = db
		.prepare(`
			SELECT item_id, scope_type, scope_key, related_files
			FROM memory_items WHERE related_files != '[]'
		`)
		.all() as Array<{
		item_id: number;
		scope_type: MemoryScope['type'];
		scope_key: string;
		related_files: string;
	}>;
	const update = db.prepare(
		'UPDATE memory_items SET related_files = ?, updated_at = ? WHERE item_id = ?',
	);
	for (const row of rows) {
		const related: unknown = JSON.parse(row.related_files);
		if (!Array.isArray(related) || !related.includes(oldPath)) continue;
		update.run(
			JSON.stringify(related.map((path) => (path === oldPath ? newPath : path))),
			now,
			row.item_id,
		);
		addAffectedScope(impact, { type: row.scope_type, key: row.scope_key });
	}
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
		const indexed = indexFiles(db, vaultRoot, [oldPath, newPath], config);
		const current = db
			.prepare('SELECT entity_id FROM vault_index WHERE file_path = ?')
			.get(newPath) as { entity_id: string | null } | undefined;
		if (!current) throw new Error(`移动后的文件未进入索引：${newPath}`);
		let newScopeKey = newPath;
		if (current.entity_id) {
			const count = (
				db
					.prepare('SELECT COUNT(*) AS count FROM vault_index WHERE entity_id = ?')
					.get(current.entity_id) as { count: number }
			).count;
			if (count === 1) newScopeKey = current.entity_id;
		}
		migrateMovedFileReferences(db, oldPath, newPath, newScopeKey, indexed.impact);
		const result = indexed.results.find((candidate) => candidate.filePath === newPath);
		return {
			action: result?.status ?? 'indexed',
			filePath: newPath,
			previousFilePath: oldPath,
			impact: indexed.impact,
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
				impact: { ...EMPTY_IMPACT },
				reason: error instanceof Error ? error.message : String(error),
			})),
			impact: { ...EMPTY_IMPACT },
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
				impact: { ...EMPTY_IMPACT },
				reason: error instanceof Error ? error.message : String(error),
			};
		}
	}
	return notifyFilesChanged(db, vaultRoot, [filePath], config)
		.results[0] as NotifyFileChangedResult;
}
