import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../../src/db/schema.js';
import {
	type ScanStateEntry,
	type ScanStateRow,
	buildScanStateRow,
	deleteScanStateRows,
	isSameObservedState,
	loadScanState,
	upsertScanStateRows,
} from '../../src/utils/scan-state.js';
import { type TempVault, createTempVault, createTestDb } from '../setup.js';

// ─── Test fixtures ─────────────────────────────────────────────────────────────

let vault: TempVault;
let db: Database.Database;

beforeEach(() => {
	vault = createTempVault();
	db = createTestDb(vault.dbPath);
	initDb(db);
});

afterEach(() => {
	db.close();
	vault.cleanup();
});

// ─── loadScanState ─────────────────────────────────────────────────────────────

describe('loadScanState', () => {
	it('returns empty record when table is empty', () => {
		const result = loadScanState(db);
		expect(result).toEqual({});
	});

	it('returns all rows keyed by file_path', () => {
		db.prepare(
			'INSERT INTO scan_state (file_path, last_seen_hash, last_seen_mtime, last_seen_size, last_indexed_at) VALUES (?, ?, ?, ?, ?)',
		).run('a/b.md', 'abc123', 1700000000.5, 1024, '2024-01-01T00:00:00Z');

		db.prepare(
			'INSERT INTO scan_state (file_path, last_seen_hash, last_seen_mtime, last_seen_size, last_indexed_at) VALUES (?, ?, ?, ?, ?)',
		).run('c/d.md', null, 1700001000.0, 512, null);

		const result = loadScanState(db);
		expect(Object.keys(result)).toHaveLength(2);
		expect(result['a/b.md']).toMatchObject({
			file_path: 'a/b.md',
			last_seen_hash: 'abc123',
			last_seen_size: 1024,
			last_indexed_at: '2024-01-01T00:00:00Z',
		});
		expect(result['c/d.md']).toMatchObject({
			file_path: 'c/d.md',
			last_seen_hash: null,
			last_seen_size: 512,
			last_indexed_at: null,
		});
	});

	it('coerces mtime and size to numbers', () => {
		db.prepare(
			'INSERT INTO scan_state (file_path, last_seen_hash, last_seen_mtime, last_seen_size, last_indexed_at) VALUES (?, ?, ?, ?, ?)',
		).run('file.md', null, 1700000000.123, 9999, null);

		const result = loadScanState(db);
		expect(typeof result['file.md'].last_seen_mtime).toBe('number');
		expect(result['file.md'].last_seen_mtime).toBeCloseTo(1700000000.123, 2);
		expect(typeof result['file.md'].last_seen_size).toBe('number');
		expect(result['file.md'].last_seen_size).toBe(9999);
	});
});

// ─── isSameObservedState ───────────────────────────────────────────────────────

describe('isSameObservedState', () => {
	it('returns false for null state', () => {
		expect(isSameObservedState(null, 1700000000, 1024)).toBe(false);
		expect(isSameObservedState(undefined, 1700000000, 1024)).toBe(false);
	});

	it('returns true when mtime and size both match', () => {
		const state: ScanStateEntry = {
			file_path: 'x.md',
			last_seen_hash: null,
			last_seen_mtime: 1700000000.5,
			last_seen_size: 2048,
			last_indexed_at: null,
		};
		expect(isSameObservedState(state, 1700000000.5, 2048)).toBe(true);
	});

	it('returns false when mtime differs', () => {
		const state: ScanStateEntry = {
			file_path: 'x.md',
			last_seen_hash: null,
			last_seen_mtime: 1700000000.5,
			last_seen_size: 2048,
			last_indexed_at: null,
		};
		expect(isSameObservedState(state, 1700000001.0, 2048)).toBe(false);
	});

	it('returns false when size differs', () => {
		const state: ScanStateEntry = {
			file_path: 'x.md',
			last_seen_hash: null,
			last_seen_mtime: 1700000000.5,
			last_seen_size: 2048,
			last_indexed_at: null,
		};
		expect(isSameObservedState(state, 1700000000.5, 1024)).toBe(false);
	});

	it('handles zero-value mtime and size', () => {
		const state: ScanStateEntry = {
			file_path: 'x.md',
			last_seen_hash: null,
			last_seen_mtime: 0,
			last_seen_size: 0,
			last_indexed_at: null,
		};
		expect(isSameObservedState(state, 0, 0)).toBe(true);
		expect(isSameObservedState(state, 1, 0)).toBe(false);
	});
});

// ─── buildScanStateRow ─────────────────────────────────────────────────────────

describe('buildScanStateRow', () => {
	it('builds tuple with correct layout', () => {
		const row = buildScanStateRow(
			'path/file.md',
			'hash123',
			1700000000.5,
			4096,
			'2024-06-01T00:00:00Z',
		);
		expect(row).toHaveLength(5);
		expect(row[0]).toBe('path/file.md');
		expect(row[1]).toBe('hash123');
		expect(row[2]).toBe(1700000000.5);
		expect(row[3]).toBe(4096);
		expect(row[4]).toBe('2024-06-01T00:00:00Z');
	});

	it('accepts null hash and indexed_at', () => {
		const row = buildScanStateRow('path/file.md', null, 1700000000, 100, null);
		expect(row[1]).toBeNull();
		expect(row[4]).toBeNull();
	});

	it('coerces mtime and size to numbers', () => {
		const row = buildScanStateRow('f.md', null, 1700000000.123, 512, null);
		expect(typeof row[2]).toBe('number');
		expect(typeof row[3]).toBe('number');
	});
});

// ─── upsertScanStateRows ───────────────────────────────────────────────────────

describe('upsertScanStateRows', () => {
	it('no-op when rows is empty', () => {
		upsertScanStateRows(db, []);
		const result = loadScanState(db);
		expect(Object.keys(result)).toHaveLength(0);
	});

	it('inserts multiple rows', () => {
		const rows: ScanStateRow[] = [
			['a.md', 'h1', 1700000000, 100, '2024-01-01T00:00:00Z'],
			['b.md', 'h2', 1700000001, 200, '2024-01-02T00:00:00Z'],
		];
		upsertScanStateRows(db, rows);

		const result = loadScanState(db);
		expect(Object.keys(result)).toHaveLength(2);
		expect(result['a.md'].last_seen_hash).toBe('h1');
		expect(result['b.md'].last_seen_hash).toBe('h2');
	});

	it('replaces existing row on conflict', () => {
		const row1: ScanStateRow = ['a.md', 'old-hash', 1700000000, 100, null];
		upsertScanStateRows(db, [row1]);

		const row2: ScanStateRow = ['a.md', 'new-hash', 1700000999, 200, '2024-06-01T00:00:00Z'];
		upsertScanStateRows(db, [row2]);

		const result = loadScanState(db);
		expect(Object.keys(result)).toHaveLength(1);
		expect(result['a.md'].last_seen_hash).toBe('new-hash');
		expect(result['a.md'].last_seen_size).toBe(200);
	});
});

// ─── deleteScanStateRows ───────────────────────────────────────────────────────

describe('deleteScanStateRows', () => {
	it('deletes specified paths, no-ops on empty/non-existent', () => {
		const rows: ScanStateRow[] = [
			['a.md', null, 0, 0, null],
			['b.md', null, 0, 0, null],
			['c.md', null, 0, 0, null],
		];
		upsertScanStateRows(db, rows);

		// Empty array is no-op
		deleteScanStateRows(db, []);
		expect(Object.keys(loadScanState(db))).toHaveLength(3);

		// Deletes specified paths, ignores non-existent
		deleteScanStateRows(db, ['a.md', 'c.md', 'does-not-exist.md']);
		const result = loadScanState(db);
		expect(Object.keys(result)).toHaveLength(1);
		expect(result['b.md']).toBeDefined();
	});
});
