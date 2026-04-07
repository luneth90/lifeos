/**
 * capture.ts — Capture service.
 *
 * Handles file change notifications and rule upserts (preferences/corrections).
 */

import { relative } from 'node:path';
import type Database from 'better-sqlite3';
import { indexSingleFile } from '../utils/vault-indexer.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UpsertRuleOpts {
	slotKey: string;
	content: string;
	source?: 'preference' | 'correction';
	relatedFiles?: string[];
	expiresAt?: string | null;
}

export interface UpsertRuleResult {
	slotKey: string;
	action: 'created' | 'updated';
}

export interface NotifyFileChangedResult {
	action: string;
	filePath: string;
}

// ─── upsertRule ──────────────────────────────────────────────────────────────

/**
 * Upsert a rule (preference or correction) into memory_items.
 * If a rule with the same slot_key already exists, update it.
 * Don't downgrade: if existing is correction and new is preference, keep correction source.
 */
export function upsertRule(db: Database.Database, opts: UpsertRuleOpts): UpsertRuleResult {
	const now = new Date().toISOString();
	const source = opts.source ?? 'preference';
	const relatedFilesJson = JSON.stringify(opts.relatedFiles ?? []);

	const existing = db
		.prepare(
			`SELECT slot_key, source FROM memory_items WHERE slot_key = ? AND status = 'active' LIMIT 1`,
		)
		.get(opts.slotKey) as { slot_key: string; source: string } | undefined;

	if (existing) {
		// Don't downgrade: if existing is correction and new is preference, keep correction source but update content
		const finalSource =
			existing.source === 'correction' && source === 'preference' ? 'correction' : source;
		db.prepare(
			'UPDATE memory_items SET content = ?, source = ?, related_files = ?, updated_at = ?, expires_at = ? WHERE slot_key = ?',
		).run(opts.content, finalSource, relatedFilesJson, now, opts.expiresAt ?? null, opts.slotKey);
		return { slotKey: opts.slotKey, action: 'updated' };
	}

	db.prepare(
		`INSERT INTO memory_items (slot_key, content, source, related_files, manual_flag, status, updated_at, expires_at)
     VALUES (?, ?, ?, ?, 0, 'active', ?, ?)`,
	).run(opts.slotKey, opts.content, source, relatedFilesJson, now, opts.expiresAt ?? null);
	return { slotKey: opts.slotKey, action: 'created' };
}

// ─── notifyFileChanged ────────────────────────────────────────────────────────

/**
 * Notify the system that a file has changed.
 * Re-indexes the file and updates the enhance queue if applicable.
 */
export function notifyFileChanged(
	db: Database.Database,
	vaultRoot: string,
	filePath: string,
): NotifyFileChangedResult {
	// Normalize to relative path
	const relPath = filePath.startsWith(vaultRoot)
		? relative(vaultRoot, filePath).replace(/\\/g, '/')
		: filePath.replace(/\\/g, '/');

	let indexResult: { status: string; filePath?: string; reason?: string };
	try {
		const dbPath = db.name; // better-sqlite3 exposes .name as the db file path
		indexResult = indexSingleFile(vaultRoot, dbPath, relPath);
	} catch {
		return { action: 'error', filePath: relPath };
	}

	if (indexResult.status === 'removed' || indexResult.status === 'skipped') {
		return { action: indexResult.status, filePath: relPath };
	}

	return { action: indexResult.status === 'indexed' ? 'indexed' : 'unchanged', filePath: relPath };
}
