/**
 * startup.ts — 启动服务。
 *
 * Orchestrates session initialization: schema init, vault scan, enhance
 * queue processing, maintenance, and Layer 0 summary construction.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { getVaultConfig } from '../config.js';
import { initDb } from '../db/schema.js';
import type { StartupResult } from '../types.js';
import { ensureContextPolicyExists, loadContextPolicy } from '../utils/context-policy.js';
import { loadCustomDict } from '../utils/segmenter.js';
import { coerceNow, countRows } from '../utils/shared.js';
import { latestSessionBridge } from './capture.js';
import { processEnhanceQueue } from './enhance.js';
import { buildLayer0Summary } from './layer0.js';
import { maintenanceRun, needsMaintenance } from './maintenance.js';

// ─── runStartup ───────────────────────────────────────────────────────────────

/**
 * Orchestrate the full startup sequence for a session.
 *
 * Steps:
 * 1. Init DB schema
 * 2. Detect previous unclean sessions
 * 3. Register current session
 * 4. Load custom dictionary (if exists)
 * 5. Full vault scan (via dbPath stored on the db object)
 * 6. Process enhance queue
 * 7. Run maintenance if needed
 * 8. Build Layer 0 summary
 *
 * @param db               Open better-sqlite3 Database instance
 * @param vaultRoot        Absolute path to the vault root
 * @param resolvedSessionId Session ID already resolved by the caller
 * @param now              Optional time override (ISO string or Date)
 * @returns                Startup result object with stats and Layer 0 summary
 */
export function runStartup(
	db: Database.Database,
	vaultRoot: string,
	resolvedSessionId: string,
	now?: string | Date | null,
): StartupResult {
	const startedAt = coerceNow(now).toISOString();

	// 1. Init DB schema
	initDb(db);

	// 2. Check for previous unclean sessions
	const previousUnclean = db
		.prepare(
			`SELECT session_id FROM session_state
       WHERE closed_at IS NULL AND session_id != ?
       ORDER BY last_seen_at DESC LIMIT 1`,
		)
		.get(resolvedSessionId) as { session_id: string } | undefined;

	// 3. Register current session
	db.prepare(`
    INSERT INTO session_state (session_id, started_at, last_seen_at, closed_at, close_status)
    VALUES (?, ?, ?, NULL, NULL)
    ON CONFLICT(session_id) DO UPDATE SET
      last_seen_at = excluded.last_seen_at,
      closed_at    = NULL,
      close_status = NULL
  `).run(resolvedSessionId, startedAt, startedAt);

	// 4. Load custom dictionary (before scan so tokens use updated segmenter)
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

	// 5. Full vault scan — vault-indexer opens its own DB connection via dbPath
	let scanIndexed = 0;
	try {
		// Dynamically import to avoid circular-dependency issues at module level
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		// biome-ignore format: typeof import() must stay on one line or tsc errors
		const { fullScan } = require('../utils/vault-indexer.js') as typeof import('../utils/vault-indexer.js');
		const dbPath = db.name; // better-sqlite3 exposes .name as the db file path
		const scanResult = fullScan(vaultRoot, dbPath);
		scanIndexed = scanResult.indexed;
	} catch (e) {
		console.warn('[lifeos] vault scan failed:', e);
		scanIndexed = 0;
	}

	// 6. Enhance queue processing
	const enhanceResult = processEnhanceQueue(db, vaultRoot, 5);

	// 7. Maintenance check
	let maintenanceResult = null;
	if (needsMaintenance(db, now)) {
		maintenanceResult = maintenanceRun(db, now);
	}

	// 8. Load context policy and build Layer 0
	ensureContextPolicyExists(vaultRoot);
	const policy = loadContextPolicy(vaultRoot);
	const bridgeRow = latestSessionBridge(db, resolvedSessionId) ?? latestSessionBridge(db);
	const bridgeText = bridgeRow ? bridgeRow.summary : null;

	// 9. Stats
	const totalFiles = countRows(db, 'vault_index');
	const enhanceQueueSize = countRows(db, 'enhance_queue', "status = 'pending'");

	return {
		layer0_summary: buildLayer0Summary(vaultRoot, policy, bridgeText),
		vault_stats: { total_files: totalFiles, updated_since_last: scanIndexed },
		enhance_queue_size: enhanceQueueSize,
		enhanced_files: enhanceResult.processed,
		last_session_bridge: bridgeText,
		recovered_from_unclean_shutdown: previousUnclean !== undefined,
		previous_unclean_session_id: previousUnclean?.session_id ?? null,
		maintenance: maintenanceResult,
	};
}
