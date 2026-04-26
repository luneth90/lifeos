/**
 * startup.ts — Startup service.
 *
 * Orchestrates session initialization: schema init, vault scan, enhance
 * queue processing, and Layer 0 summary construction.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { cleanupMemoryItems } from '../active-docs/derived-memory.js';
import { refreshTaskboard, refreshUserprofile } from '../active-docs/index.js';
import { getVaultConfig } from '../config.js';
import { initDb } from '../db/schema.js';
import type { StartupResult } from '../types.js';
import { loadCustomDict } from '../utils/segmenter.js';
import { countRows } from '../utils/shared.js';
import { fullScan } from '../utils/vault-indexer.js';
import { buildLayer0Summary } from './layer0.js';

// ─── runStartup ───────────────────────────────────────────────────────────────

/**
 * Orchestrate the full startup sequence for a session.
 *
 * Steps:
 * 1. Init DB schema
 * 2. Load custom dictionary (if exists)
 * 3. Full vault scan
 * 4. Process enhance queue
 * 5. Refresh active docs
 * 6. Build Layer 0 summary
 *
 * @param db               Open better-sqlite3 Database instance
 * @param vaultRoot        Absolute path to the vault root
 * @returns                Startup result object with stats and Layer 0 summary
 */
export function runStartup(db: Database.Database, vaultRoot: string): StartupResult {
	// 1. Init DB schema
	initDb(db);

	// 2. Load custom dictionary (before scan so tokens use updated segmenter)
	let dictLoaded: boolean | undefined;
	let dictError: string | undefined;
	const config = getVaultConfig();
	if (config) {
		const dictPath = join(config.subDirPath('system', 'memory'), 'custom_dict.txt');
		if (existsSync(dictPath)) {
			try {
				loadCustomDict(dictPath);
				dictLoaded = true;
			} catch (e) {
				console.warn(`[lifeos] Failed to load custom dict ${dictPath}:`, e);
				dictLoaded = false;
				dictError = e instanceof Error ? e.message : String(e);
			}
		}
	}

	// 3. Full vault scan — reuses existing DB connection
	let scanIndexed = 0;
	let scanUnchanged = 0;
	let scanRemoved = 0;
	let scanError: string | undefined;
	try {
		const scanResult = fullScan(vaultRoot, db);
		scanIndexed = scanResult.indexed;
		scanUnchanged = scanResult.unchanged;
		scanRemoved = scanResult.removed;
	} catch (e) {
		console.warn('[lifeos] vault scan failed:', e);
		scanError = e instanceof Error ? e.message : String(e);
	}

	// 4. Expire stale rules before refreshing active docs
	cleanupMemoryItems(db);

	// 5. Refresh active docs before building Layer 0 from their AUTO sections.
	refreshTaskboard(db, vaultRoot);
	refreshUserprofile(db, vaultRoot);

	// 6. Build Layer 0
	const totalFiles = countRows(db, 'vault_index');

	const result: StartupResult = {
		layer0_summary: buildLayer0Summary(vaultRoot),
		vault_stats: {
			total_files: totalFiles,
			updated_since_last: scanIndexed,
			unchanged: scanUnchanged,
			removed: scanRemoved,
		},
		dict_loaded: dictLoaded,
		dict_error: dictError,
	};
	if (scanError) result.vault_stats.scan_error = scanError;

	return result;
}
