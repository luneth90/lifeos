/**
 * startup.ts — Startup service.
 *
 * Orchestrates session initialization: schema init, vault scan, enhance
 * queue processing, and Layer 0 summary construction.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { refreshTaskboard, refreshUserprofile } from '../active-docs/index.js';
import { getVaultConfig } from '../config.js';
import { initDb } from '../db/schema.js';
import type { StartupResult } from '../types.js';
import { ensureContextPolicyExists, loadContextPolicy } from '../utils/context-policy.js';
import { loadCustomDict } from '../utils/segmenter.js';
import { countRows } from '../utils/shared.js';
import { fullScan } from '../utils/vault-indexer.js';
import { processEnhanceQueue } from './enhance.js';
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
export function runStartup(
	db: Database.Database,
	vaultRoot: string,
): StartupResult {
	// 1. Init DB schema
	initDb(db);

	// 2. Load custom dictionary (before scan so tokens use updated segmenter)
	const config = getVaultConfig();
	if (config) {
		const dictPath = join(config.subDirPath('system', 'memory'), 'custom_dict.txt');
		if (existsSync(dictPath)) {
			try {
				loadCustomDict(dictPath);
			} catch (e) {
				console.warn(`[lifeos] Failed to load custom dict ${dictPath}:`, e);
			}
		}
	}

	// 3. Full vault scan — vault-indexer opens its own DB connection via dbPath
	let scanIndexed = 0;
	let scanRemoved = 0;
	try {
		const dbPath = db.name; // better-sqlite3 exposes .name as the db file path
		const scanResult = fullScan(vaultRoot, dbPath);
		scanIndexed = scanResult.indexed;
		scanRemoved = scanResult.removed;
	} catch (e) {
		console.warn('[lifeos] vault scan failed:', e);
		scanIndexed = 0;
	}

	// 4. Enhance queue processing
	const enhanceResult = processEnhanceQueue(db, vaultRoot, 5);

	// 5. Refresh active docs before building Layer 0 from their AUTO sections.
	refreshTaskboard(db, vaultRoot);
	refreshUserprofile(db, vaultRoot);

	// 6. Load context policy and build Layer 0
	ensureContextPolicyExists(vaultRoot);
	const policy = loadContextPolicy(vaultRoot);

	// 7. Stats
	const totalFiles = countRows(db, 'vault_index');
	const enhanceQueueSize = countRows(db, 'enhance_queue', "status = 'pending'");

	return {
		layer0_summary: buildLayer0Summary(vaultRoot, policy),
		vault_stats: { total_files: totalFiles, updated_since_last: scanIndexed, removed: scanRemoved },
		enhance_queue_size: enhanceQueueSize,
		enhanced_files: enhanceResult.processed,
	};
}
