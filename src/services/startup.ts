import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { refreshTaskboard, refreshUserprofile } from '../active-docs/index.js';
import { type VaultConfig, resolveConfig } from '../config.js';
import { runDbMaintenance } from '../db/index.js';
import { initDb } from '../db/schema.js';
import {
	type StartupMaintenanceResult,
	type StartupResult,
	maintenanceStateFields,
} from '../types.js';
import { loadCustomDict } from '../utils/segmenter.js';
import { countRows } from '../utils/shared.js';
import { fullScan } from '../utils/vault-indexer.js';
import { buildLayer0Context } from './layer0.js';
import { expireMemoryItems } from './memory-items.js';
import { buildScopeCatalog } from './scope-catalog.js';

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
	const catalog = buildScopeCatalog(db, config);
	const availableProjects = [
		...new Set(catalog.projects.map((project) => project.entityId)),
	].sort();
	const availableTools = Object.keys(catalog.tools);
	return {
		layer0: buildLayer0Context(db, vaultRoot, config.contextBudgets()),
		scopeHints: {
			availableProjects,
			availableRepositories: Object.keys(catalog.repositories),
			availableSkills: catalog.skills,
			availableTools,
			toolBindings: catalog.tools,
		},
		vaultStats: {
			totalFiles,
			updatedSinceLast: 0,
			unchanged: 0,
			removed: 0,
			...maintenanceStateFields('pending'),
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
	const maintenance = runDbMaintenance(db);
	const maintenanceState = maintenance.state === 'succeeded' ? 'succeeded' : 'failed';
	return {
		vaultStats: {
			totalFiles: countRows(db, 'vault_index'),
			updatedSinceLast: scan.indexed,
			unchanged: scan.unchanged,
			removed: scan.removed,
			...maintenanceStateFields(maintenanceState),
		},
		maintenance,
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
