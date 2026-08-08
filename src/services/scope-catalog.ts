import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve, win32 } from 'node:path';
import type Database from 'better-sqlite3';
import type { VaultConfig } from '../config.js';
import type { ScopeCatalog, ScopeCatalogFile, ScopeCatalogProject } from '../types.js';
import { assertVaultPathSafe } from '../utils/safe-path.js';

interface CatalogRow {
	file_path: string;
	entity_id: string | null;
	type: string | null;
}

function sortedRecord<T>(record: Record<string, T>, clone: (value: T) => T): Record<string, T> {
	return Object.fromEntries(
		Object.keys(record)
			.sort()
			.map((key) => [key, clone(record[key])]),
	);
}

function isSafeIndexedPath(vaultRoot: string | undefined, filePath: string): boolean {
	const portable = filePath.replaceAll('\\', '/');
	if (
		isAbsolute(filePath) ||
		win32.isAbsolute(filePath) ||
		portable.startsWith('/') ||
		portable.split('/').some((component) => component === '.' || component === '..')
	) {
		return false;
	}
	if (!vaultRoot) return true;
	try {
		assertVaultPathSafe(vaultRoot, resolve(vaultRoot, portable));
		return true;
	} catch {
		return false;
	}
}

function discoverSkills(vaultRoot: string | undefined): string[] {
	if (!vaultRoot) return [];
	const requestedRoot = join(vaultRoot, '.agents', 'skills');
	let skillsRoot: string;
	try {
		skillsRoot = assertVaultPathSafe(vaultRoot, requestedRoot);
	} catch {
		return [];
	}
	if (!existsSync(skillsRoot)) return [];
	return readdirSync(skillsRoot, { withFileTypes: true })
		.filter(
			(entry) => entry.isDirectory() && entry.name !== '_shared' && !entry.name.startsWith('.'),
		)
		.flatMap((entry) => {
			try {
				const skillFile = assertVaultPathSafe(vaultRoot, join(skillsRoot, entry.name, 'SKILL.md'));
				return existsSync(skillFile) && lstatSync(skillFile).isFile() ? [entry.name] : [];
			} catch {
				return [];
			}
		})
		.sort();
}

export function buildScopeCatalog(db: Database.Database, config?: VaultConfig): ScopeCatalog {
	const rows = db
		.prepare(`
			SELECT file_path, entity_id, type
			FROM vault_index
			ORDER BY file_path, COALESCE(entity_id, '')
		`)
		.all() as CatalogRow[];
	const safeRows = rows.filter((row) => isSafeIndexedPath(config?.vaultRoot, row.file_path));
	const files: ScopeCatalogFile[] = safeRows.map((row) => ({
		entityId: row.entity_id,
		filePath: row.file_path,
	}));
	const projects: ScopeCatalogProject[] = safeRows.flatMap((row) =>
		row.type === 'project' && row.entity_id
			? [{ entityId: row.entity_id, filePath: row.file_path }]
			: [],
	);
	const toolBindings = config?.toolBindings?.() ?? {};
	const repositoryBindings = config?.repositoryBindings?.() ?? {};

	return {
		skills: discoverSkills(config?.vaultRoot),
		tools: sortedRecord(toolBindings, (binding) => ({
			commands: [...binding.commands],
			skills: [...binding.skills],
		})),
		repositories: sortedRecord(repositoryBindings, (roots) => [...roots]),
		projects,
		files,
	};
}
