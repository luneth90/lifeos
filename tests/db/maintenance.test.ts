import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as dbMaintenance from '../../src/db/index.js';
import { initDb } from '../../src/db/schema.js';

// Maintenance pragmas (incremental_vacuum, wal_checkpoint, auto_vacuum) are
// silent no-ops on :memory: databases, so these tests must use a file-based DB.
describe('runDbMaintenance', () => {
	let dir: string;
	let dbPath: string;
	let db: Database.Database;
	let sql: string[];

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'lifeos-maintenance-'));
		dbPath = join(dir, 'memory.db');
		sql = [];
		db = new Database(dbPath, { verbose: (statement) => sql.push(statement) });
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
			db.prepare('SELECT file_path FROM vault_fts WHERE vault_fts MATCH ?').all(token) as Array<{
				file_path: string;
			}>
		)
			.map((row) => row.file_path)
			.sort();
	}

	it('new databases are created with incremental auto_vacuum', () => {
		expect(db.pragma('auto_vacuum', { simple: true })).toBe(2);
	});

	it('例行维护使用有限 FTS merge 与非截断 checkpoint，并保留查询正确性', () => {
		const insert = db.prepare(`
			INSERT INTO vault_index(file_path, title, type, status, search_hints, tags)
			VALUES (?, ?, 'note', 'active', ?, '[]')
		`);
		insert.run('20_项目/keep.md', 'Keep note', 'probemarker');
		insert.run('20_项目/drop.md', 'Drop note', 'probemarker');
		expect(ftsFiles('probemarker')).toEqual(['20_项目/drop.md', '20_项目/keep.md']);

		db.prepare('DELETE FROM vault_index WHERE file_path = ?').run('20_项目/drop.md');
		expect(ftsFiles('probemarker')).toEqual(['20_项目/keep.md']);

		const result = dbMaintenance.runDbMaintenance(db);
		expect(ftsFiles('probemarker')).toEqual(['20_项目/keep.md']);
		expect(result).toMatchObject({
			mode: 'routine',
			state: 'succeeded',
			startedAt: expect.any(String),
			finishedAt: expect.any(String),
			durationMs: expect.any(Number),
			error: null,
			before: {
				pageCount: expect.any(Number),
				freelistCount: expect.any(Number),
				freelistBytes: expect.any(Number),
				walPages: expect.any(Number),
				walBytes: expect.any(Number),
			},
			after: {
				pageCount: expect.any(Number),
				freelistCount: expect.any(Number),
				freelistBytes: expect.any(Number),
				walPages: expect.any(Number),
				walBytes: expect.any(Number),
			},
		});
		expect(Date.parse(result.finishedAt ?? '')).toBeGreaterThanOrEqual(
			Date.parse(result.startedAt ?? ''),
		);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(sql.some((statement) => statement.includes("VALUES('merge', 4)"))).toBe(true);
		expect(sql.some((statement) => statement.includes("VALUES('optimize')"))).toBe(false);
		expect(sql.some((statement) => statement.includes('wal_checkpoint(PASSIVE)'))).toBe(true);
		expect(sql.some((statement) => statement.includes('wal_checkpoint(TRUNCATE)'))).toBe(false);
	});

	it('显式压缩回收 freelist、执行 FTS optimize 并截断 WAL', () => {
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

		expect(typeof dbMaintenance.runDbCompaction).toBe('function');
		const result = dbMaintenance.runDbCompaction(db);

		expect(result.mode).toBe('explicit');
		expect(result.state).toBe('succeeded');
		expect(result.before?.freelistCount).toBe(freelistBefore);
		expect(result.after?.freelistCount).toBeLessThan(result.before?.freelistCount ?? 0);
		expect((result.after?.freelistCount ?? 1) / (result.after?.pageCount ?? 1)).toBeLessThan(0.05);
		expect(result.after?.walPages).toBe(0);
		expect(result.after?.walBytes).toBe(0);
		expect(sql.some((statement) => statement.includes("VALUES('optimize')"))).toBe(true);
		expect(sql.some((statement) => statement.includes('wal_checkpoint(TRUNCATE)'))).toBe(true);
		// TRUNCATE checkpoint leaves the WAL file at zero bytes (or removes it).
		expect(existsSync(walPath) ? statSync(walPath).size : 0).toBe(0);
	});

	it('显式压缩在读事务阻止 TRUNCATE 时返回 failed 与 checkpoint 诊断', () => {
		const reader = new Database(dbPath);
		try {
			reader.pragma('journal_mode = WAL');
			reader.exec('BEGIN');
			reader.prepare('SELECT COUNT(*) FROM vault_index').get();

			db.prepare(`
				INSERT INTO vault_index(file_path, title, type, status, search_hints, tags)
				VALUES ('20_项目/checkpoint-busy.md', 'Checkpoint busy', 'note', 'active', 'busy', '[]')
			`).run();

			const result = dbMaintenance.runDbCompaction(db);

			expect(result.state).toBe('failed');
			expect(result.error).toMatch(/wal_checkpoint\(TRUNCATE\).*busy=1.*log=\d+.*checkpointed=\d+/);
			expect(result.after?.walBytes).toBeGreaterThan(0);
			expect(existsSync(`${dbPath}-wal`) ? statSync(`${dbPath}-wal`).size : 0).toBeGreaterThan(0);
		} finally {
			reader.exec('ROLLBACK');
			reader.close();
		}
	});
});
