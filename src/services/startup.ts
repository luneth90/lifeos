import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { refreshTaskboard, refreshUserprofile } from '../active-docs/index.js';
import { type VaultConfig, resolveConfig } from '../config.js';
import { initDb } from '../db/schema.js';
import type { StartupMaintenanceResult, StartupResult } from '../types.js';
import { loadCustomDict } from '../utils/segmenter.js';
import { countRows } from '../utils/shared.js';
import { fullScan } from '../utils/vault-indexer.js';
import { buildLayer0Context } from './layer0.js';
import { expireMemoryItems } from './memory-items.js';

export function runStartup(
	db: Database.Database,
	vaultRoot: string,
	config: VaultConfig = resolveConfig(vaultRoot),
): StartupResult {
	initDb(db);
	let dictLoaded: boolean | undefined;
	let dictError: string | undefined;
	const dictPath = join(config.subDirPath('system', 'memory'), 'custom_dict.txt');
	if (existsSync(dictPath)) {
		try {
			loadCustomDict(dictPath);
			dictLoaded = true;
		} catch (error) {
			dictLoaded = false;
			dictError = error instanceof Error ? error.message : String(error);
		}
	}
	expireMemoryItems(db);
	const totalFiles = countRows(db, 'vault_index');
	const availableProjects = (
		db
			.prepare(`
				SELECT DISTINCT entity_id
				FROM vault_index
				WHERE type = 'project' AND entity_id IS NOT NULL
				ORDER BY entity_id
			`)
			.all() as Array<{ entity_id: string }>
	).map((row) => row.entity_id);
	const availableSkills = (
		db
			.prepare(`
				SELECT DISTINCT scope_key
				FROM memory_items
				WHERE status = 'active' AND scope_type = 'skill'
				ORDER BY scope_key
			`)
			.all() as Array<{ scope_key: string }>
	).map((row) => row.scope_key);
	return {
		layer0: buildLayer0Context(db, vaultRoot, config.contextBudgets()),
		scopeHints: { availableProjects, availableSkills },
		vaultStats: {
			totalFiles,
			updatedSinceLast: 0,
			unchanged: 0,
			removed: 0,
			maintenancePending: true,
		},
		dictLoaded,
		dictError,
	};
}

export function runStartupMaintenance(
	db: Database.Database,
	vaultRoot: string,
	config: VaultConfig = resolveConfig(vaultRoot),
): StartupMaintenanceResult {
	initDb(db);
	const scan = fullScan(vaultRoot, db, config);
	const taskboard = refreshTaskboard(db, vaultRoot, { config });
	const userprofile = refreshUserprofile(db, vaultRoot, { config });
	return {
		vaultStats: {
			totalFiles: countRows(db, 'vault_index'),
			updatedSinceLast: scan.indexed,
			unchanged: scan.unchanged,
			removed: scan.removed,
			maintenancePending: false,
		},
		activeDocs: [
			{ target: 'TaskBoard', changed: taskboard.changed, path: taskboard.path },
			{ target: 'UserProfile', changed: userprofile.changed, path: userprofile.path },
		],
		impact: {
			taskboardChanged: scan.impact.taskboardChanged,
			profileChanged: scan.impact.profileChanged,
			affectedScopes: scan.impact.affectedScopes,
		},
	};
}
