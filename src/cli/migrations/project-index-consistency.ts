import { lstatSync } from 'node:fs';
import { extname, isAbsolute, join, win32 } from 'node:path';
import type Database from 'better-sqlite3';
import type { VaultConfig } from '../../config.js';
import { assertSchemaV4 } from '../../db/schema.js';
import { assertVaultPathSafe } from '../../utils/safe-path.js';
import { deleteScanStateRows } from '../../utils/scan-state.js';
import { indexFiles, recomputeAllBacklinks } from '../../utils/vault-indexer.js';
import type { ScopeMapProject } from './v4-scope-map.js';

interface CatalogProjectFile {
	id: string;
	filePath: string;
}

interface PreparedProjectCatalog {
	projectFiles: CatalogProjectFile[];
	directoryPaths: string[];
}

export interface ProjectCatalogIndexResult {
	reindexed: number;
	projectFiles: string[];
	directoryPaths: string[];
	removedStaleProjectPaths: string[];
}

function portableCatalogPath(rawPath: string, projectId: string): string {
	if (rawPath !== rawPath.trim() || !rawPath || rawPath.includes('\0')) {
		throw new Error(`项目 ${projectId} 的 catalog path 非法：${JSON.stringify(rawPath)}`);
	}
	const portable = rawPath.replaceAll('\\', '/');
	if (
		isAbsolute(rawPath) ||
		win32.isAbsolute(rawPath) ||
		portable.startsWith('/') ||
		portable.split('/').some((component) => !component || component === '.' || component === '..')
	) {
		throw new Error(`项目 ${projectId} 的 catalog path 必须是安全的 Vault 相对路径：${rawPath}`);
	}
	return portable;
}

function prepareCatalog(
	vaultRoot: string,
	config: VaultConfig,
	catalog: readonly ScopeMapProject[],
): PreparedProjectCatalog {
	const projectPrefix = config.dirPrefix('projects').replaceAll('\\', '/');
	const ids = new Set<string>();
	const owners = new Map<string, string>();
	const projectFiles: CatalogProjectFile[] = [];
	const directoryPaths = new Set<string>();

	for (const project of catalog) {
		const id = project.id;
		if (!id || id !== id.trim()) throw new Error('项目 catalog 包含空白或带首尾空格的 id');
		if (ids.has(id)) throw new Error(`项目 catalog 的 id 重复：${id}`);
		ids.add(id);

		const paths = project.paths ?? [];
		const ownFiles: string[] = [];
		const ownPaths = new Set<string>();
		for (const rawPath of paths) {
			const path = portableCatalogPath(rawPath, id);
			if (ownPaths.has(path)) throw new Error(`项目 ${id} 的 catalog path 重复：${path}`);
			ownPaths.add(path);
			if (!path.startsWith(projectPrefix)) {
				throw new Error(`项目 ${id} 的 catalog path 不在项目目录内：${path}`);
			}

			const safePath = assertVaultPathSafe(vaultRoot, join(vaultRoot, path));
			let stat: ReturnType<typeof lstatSync>;
			try {
				stat = lstatSync(safePath);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
					throw new Error(`项目 ${id} 的 catalog path 不存在：${path}`);
				}
				throw error;
			}
			if (stat.isSymbolicLink()) throw new Error(`项目 ${id} 的 catalog path 是符号链接：${path}`);
			if (stat.isDirectory()) {
				directoryPaths.add(path);
				continue;
			}
			if (!stat.isFile() || extname(path).toLowerCase() !== '.md') {
				throw new Error(`项目 ${id} 的主文件必须是普通 Markdown 文件：${path}`);
			}
			ownFiles.push(path);
		}

		if (ownFiles.length !== 1) {
			throw new Error(`项目 ${id} 必须且只能声明一个项目主文件，当前为 ${ownFiles.length} 个`);
		}
		const filePath = ownFiles[0] as string;
		const owner = owners.get(filePath);
		if (owner) throw new Error(`项目主文件被多个项目复用：${filePath}（${owner}、${id}）`);
		owners.set(filePath, id);
		projectFiles.push({ id, filePath });
	}

	return {
		projectFiles: projectFiles.sort((a, b) => a.filePath.localeCompare(b.filePath)),
		directoryPaths: [...directoryPaths].sort((a, b) => a.localeCompare(b)),
	};
}

function assertCatalogIndex(
	db: Database.Database,
	projectFiles: readonly CatalogProjectFile[],
	directoryPaths: readonly string[],
): void {
	const rowsByPath = db.prepare(
		'SELECT file_path, type, entity_id FROM vault_index WHERE file_path = ?',
	);
	const rowsById = db.prepare(
		'SELECT file_path, type, entity_id FROM vault_index WHERE entity_id = ? ORDER BY file_path',
	);
	for (const project of projectFiles) {
		const pathRows = rowsByPath.all(project.filePath) as Array<{
			file_path: string;
			type: string | null;
			entity_id: string | null;
		}>;
		if (pathRows.length !== 1) {
			throw new Error(
				`项目主文件在 vault_index 中必须恰有一行：${project.filePath}（实际 ${pathRows.length} 行）`,
			);
		}
		const row = pathRows[0];
		if (row?.type !== 'project') {
			throw new Error(`项目主文件索引类型不是 project：${project.filePath}`);
		}
		if (row.entity_id !== project.id) {
			throw new Error(
				`项目主文件索引 id 与计划不一致：${project.filePath}（计划 ${project.id}，实际 ${row.entity_id ?? 'null'}）`,
			);
		}

		const idRows = rowsById.all(project.id) as Array<{
			file_path: string;
			type: string | null;
			entity_id: string | null;
		}>;
		if (idRows.length !== 1 || idRows[0]?.file_path !== project.filePath) {
			const paths = idRows.map((item) => item.file_path).join('、') || '无';
			throw new Error(`项目 entity_id 不唯一：${project.id}（索引路径：${paths}）`);
		}
	}

	for (const directoryPath of directoryPaths) {
		const rows = rowsByPath.all(directoryPath) as unknown[];
		if (rows.length > 0) {
			throw new Error(`项目目录不得作为文件写入 vault_index：${directoryPath}`);
		}
	}

	const expectedPaths = projectFiles
		.map((project) => project.filePath)
		.sort((a, b) => a.localeCompare(b));
	const actualPaths = (
		db
			.prepare("SELECT file_path FROM vault_index WHERE type = 'project' ORDER BY file_path")
			.all() as Array<{ file_path: string }>
	)
		.map((row) => row.file_path)
		.sort((a, b) => a.localeCompare(b));
	if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
		throw new Error(
			`vault_index 的正式项目闭包与当前 catalog 不一致：计划 ${expectedPaths.join('、') || '无'}；实际 ${actualPaths.join('、') || '无'}`,
		);
	}
}

function removeStaleProjectRows(
	db: Database.Database,
	projectFiles: readonly CatalogProjectFile[],
): string[] {
	const currentPaths = new Set(projectFiles.map((project) => project.filePath));
	const indexedPaths = db
		.prepare("SELECT file_path FROM vault_index WHERE type = 'project' ORDER BY file_path")
		.all() as Array<{ file_path: string }>;
	const stalePaths = indexedPaths
		.map((row) => row.file_path)
		.filter((path) => !currentPaths.has(path))
		.sort((a, b) => a.localeCompare(b));
	if (stalePaths.length === 0) return [];
	const remove = db.prepare('DELETE FROM vault_index WHERE file_path = ?');
	for (const path of stalePaths) remove.run(path);
	deleteScanStateRows(db, stalePaths);
	return stalePaths;
}

/**
 * 在升级事务内强制重建全部项目主文件索引，并校验 catalog 与 V4 vault_index 一致。
 *
 * 调用方可以已经开启事务；better-sqlite3 会将这里及 indexFiles 的嵌套事务转换为
 * savepoint，因此任何断言失败都会回滚本函数的 scan_state 删除和索引写入。
 */
export function reindexAndAssertProjectCatalog(
	db: Database.Database,
	vaultRoot: string,
	config: VaultConfig,
	catalog: readonly ScopeMapProject[],
): ProjectCatalogIndexResult {
	assertSchemaV4(db);
	const prepared = prepareCatalog(vaultRoot, config, catalog);
	const projectPaths = prepared.projectFiles.map((project) => project.filePath);
	const reindex = db.transaction((): ProjectCatalogIndexResult => {
		const removedStaleProjectPaths = removeStaleProjectRows(db, prepared.projectFiles);
		deleteScanStateRows(db, projectPaths);
		const result = indexFiles(db, vaultRoot, projectPaths, config);
		const failed = result.results.filter((item) => item.status !== 'indexed');
		if (failed.length > 0) {
			throw new Error(
				`项目主文件强制重索引失败：${failed
					.map(
						(item) => `${item.filePath}（${item.status}${item.reason ? `：${item.reason}` : ''}）`,
					)
					.join('、')}`,
			);
		}
		if (removedStaleProjectPaths.length > 0) recomputeAllBacklinks(db);
		assertCatalogIndex(db, prepared.projectFiles, prepared.directoryPaths);
		return {
			reindexed: result.results.length,
			projectFiles: [...projectPaths],
			directoryPaths: [...prepared.directoryPaths],
			removedStaleProjectPaths,
		};
	});
	return reindex();
}

/** 严格保证每条 project scope 都指向当前 catalog 中仍存在且已正确索引的主文件。 */
export function assertProjectMemoryScopesResolveToCatalog(
	db: Database.Database,
	vaultRoot: string,
	config: VaultConfig,
	catalog: readonly ScopeMapProject[],
): void {
	assertSchemaV4(db);
	const prepared = prepareCatalog(vaultRoot, config, catalog);
	const currentProjects = new Map(
		prepared.projectFiles.map((project) => [project.id, project.filePath]),
	);
	const projectScopes = db
		.prepare(
			`SELECT slot_key, scope_key
			 FROM memory_items
			 WHERE scope_type = 'project'
			 ORDER BY slot_key, scope_key`,
		)
		.all() as Array<{ slot_key: string; scope_key: string }>;
	const indexedById = db.prepare(
		"SELECT file_path FROM vault_index WHERE type = 'project' AND entity_id = ? ORDER BY file_path",
	);
	const unresolved: string[] = [];
	for (const scope of projectScopes) {
		const expectedPath = currentProjects.get(scope.scope_key);
		if (!expectedPath) {
			unresolved.push(`${scope.slot_key}→${scope.scope_key}（当前项目 catalog 不存在）`);
			continue;
		}
		const rows = indexedById.all(scope.scope_key) as Array<{ file_path: string }>;
		if (rows.length !== 1 || rows[0]?.file_path !== expectedPath) {
			unresolved.push(`${scope.slot_key}→${scope.scope_key}（当前项目主文件索引不一致）`);
		}
	}
	if (unresolved.length > 0) {
		throw new Error(`升级后仍有无法解析的 project scope：${unresolved.join('、')}`);
	}
}
