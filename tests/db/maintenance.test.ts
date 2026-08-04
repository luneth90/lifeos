import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDbMaintenance } from '../../src/db/index.js';
import { initDb } from '../../src/db/schema.js';

// Maintenance pragmas (incremental_vacuum, wal_checkpoint, auto_vacuum) are
// silent no-ops on :memory: databases, so these tests must use a file-based DB.
describe('runDbMaintenance', () => {
	let dir: string;
	let dbPath: string;
	let db: Database.Database;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'lifeos-maintenance-'));
		dbPath = join(dir, 'memory.db');
		db = new Database(dbPath);
		db.pragma('auto_vacuum = INCREMENTAL');
		db.pragma('journal_mode = WAL');
		initDb(db);
	});

	afterEach(() => {
		db.close();
		rmSync(dir, { recursive: true, force: true });
	});

	function ftsFiles(token: string): string[] {
		return (
			db
				.prepare('SELECT file_path FROM vault_fts WHERE vault_fts MATCH ?')
				.all(token) as Array<{ file_path: string }>
		).map((row) => row.file_path).sort();
	}

	it('new databases are created with incremental auto_vacuum', () => {
		expect(db.pragma('auto_vacuum', { simple: true })).toBe(2);
	});

	it('FTS optimize keeps query results correct after tombstoned deletes', () => {
		const insert = db.prepare(`
			INSERT INTO vault_index(file_path, title, type, status, search_hints, tags)
			VALUES (?, ?, 'note', 'active', ?, '[]')
		`);
		insert.run('20_项目/keep.md', 'Keep note', 'probemarker');
		insert.run('20_项目/drop.md', 'Drop note', 'probemarker');
		expect(ftsFiles('probemarker')).toEqual(['20_项目/drop.md', '20_项目/keep.md']);

		db.prepare('DELETE FROM vault_index WHERE file_path = ?').run('20_项目/drop.md');
		expect(ftsFiles('probemarker')).toEqual(['20_项目/keep.md']);

		runDbMaintenance(db);
		expect(ftsFiles('probemarker')).toEqual(['20_项目/keep.md']);
	});

	it('reclaims freelist pages and truncates the WAL file', () => {
		const insert = db.prepare(`
			INSERT INTO vault_index(file_path, title, type, status, search_hints, tags)
			VALUES (?, ?, 'note', 'active', ?, '[]')
		`);
		const insertMany = db.transaction((count: number) => {
			for (let i = 0; i < count; i += 1) {
				insert.run(`20_项目/row-${i}.md`, `Note ${i}`, 'freelistprobe');
			}
		});
		insertMany(1200);
		db.prepare('DELETE FROM vault_index WHERE file_path LIKE ?').run('20_项目/row-%');

		const walPath = `${dbPath}-wal`;
		expect(existsSync(walPath)).toBe(true);
		expect(statSync(walPath).size).toBeGreaterThan(0);
		const freelistBefore = db.pragma('freelist_count', { simple: true }) as number;
		expect(freelistBefore).toBeGreaterThan(0);

		const result = runDbMaintenance(db);

		expect(result.freelistBefore).toBe(freelistBefore);
		expect(result.freelistAfter).toBeLessThan(result.freelistBefore);
		expect(result.walTruncated).toBe(true);
		// TRUNCATE checkpoint leaves the WAL file at zero bytes (or removes it).
		expect(existsSync(walPath) ? statSync(walPath).size : 0).toBe(0);
	});
});
