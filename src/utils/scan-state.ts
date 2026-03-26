/**
 * scan-state.ts — 扫描状态管理。
 *
 * Tracks file mtime/size to avoid re-indexing unchanged files during
 * incremental vault scans.
 */

import type Database from 'better-sqlite3';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScanStateEntry {
	file_path: string;
	last_seen_hash: string | null;
	last_seen_mtime: number;
	last_seen_size: number;
	last_indexed_at: string | null;
}

/** Tuple layout: [file_path, content_hash, mtime, size, indexed_at] */
export type ScanStateRow = [string, string | null, number, number, string | null];

// ─── Load ─────────────────────────────────────────────────────────────────────

/**
 * Load all scan state rows from the database.
 * Returns a Record keyed by file_path.
 */
export function loadScanState(db: Database.Database): Record<string, ScanStateEntry> {
	const rows = db
		.prepare(
			'SELECT file_path, last_seen_hash, last_seen_mtime, last_seen_size, last_indexed_at FROM scan_state',
		)
		.all() as Array<{
		file_path: string;
		last_seen_hash: string | null;
		last_seen_mtime: number;
		last_seen_size: number;
		last_indexed_at: string | null;
	}>;

	const result: Record<string, ScanStateEntry> = {};
	for (const row of rows) {
		result[row.file_path] = {
			file_path: row.file_path,
			last_seen_hash: row.last_seen_hash,
			last_seen_mtime: Number(row.last_seen_mtime),
			last_seen_size: Number(row.last_seen_size),
			last_indexed_at: row.last_indexed_at,
		};
	}
	return result;
}

// ─── Compare ──────────────────────────────────────────────────────────────────

/**
 * Return true when the stored scan state matches the given mtime and size.
 * Both values must match exactly (float comparison for mtime, int for size).
 */
export function isSameObservedState(
	state: ScanStateEntry | null | undefined,
	mtime: number,
	size: number,
): boolean {
	if (!state) return false;
	return (
		Number.parseFloat(String(state.last_seen_mtime ?? 0)) === Number.parseFloat(String(mtime)) &&
		Number.parseInt(String(state.last_seen_size ?? -1), 10) === Number.parseInt(String(size), 10)
	);
}

// ─── Build ────────────────────────────────────────────────────────────────────

/**
 * Build a scan state row tuple ready for insertion.
 * Layout: [file_path, content_hash, mtime, size, indexed_at]
 */
export function buildScanStateRow(
	filePath: string,
	contentHash: string | null,
	mtime: number,
	size: number,
	indexedAt: string | null,
): ScanStateRow {
	return [filePath, contentHash, Number(mtime), Number(size), indexedAt];
}

// ─── Upsert ───────────────────────────────────────────────────────────────────

/**
 * Batch-upsert scan state rows into the database.
 * No-op when rows array is empty.
 */
export function upsertScanStateRows(db: Database.Database, rows: ScanStateRow[]): void {
	if (rows.length === 0) return;
	const stmt = db.prepare(
		'INSERT OR REPLACE INTO scan_state (file_path, last_seen_hash, last_seen_mtime, last_seen_size, last_indexed_at) VALUES (?, ?, ?, ?, ?)',
	);
	const upsertMany = db.transaction((batch: ScanStateRow[]) => {
		for (const row of batch) {
			stmt.run(row);
		}
	});
	upsertMany(rows);
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * Batch-delete scan state rows by file path.
 * No-op when filePaths array is empty.
 */
export function deleteScanStateRows(db: Database.Database, filePaths: string[]): void {
	if (filePaths.length === 0) return;
	const stmt = db.prepare('DELETE FROM scan_state WHERE file_path = ?');
	const deleteMany = db.transaction((paths: string[]) => {
		for (const fp of paths) {
			stmt.run(fp);
		}
	});
	deleteMany(filePaths);
}
