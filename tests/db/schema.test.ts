import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withDb } from '../../src/db/index.js';
import {
	InvalidSchemaError,
	MigrationRequiredError,
	SCHEMA_VERSION,
	assertSchemaV4,
	initDb,
} from '../../src/db/schema.js';
import { type TempVault, createTempVault } from '../setup.js';

function names(db: Database.Database, type: 'table' | 'trigger' | 'index'): string[] {
	return (
		db.prepare('SELECT name FROM sqlite_master WHERE type = ? ORDER BY name').all(type) as Array<{
			name: string;
		}>
	).map((row) => row.name);
}

describe('Schema V4', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = new Database(':memory:');
	});

	afterEach(() => db.close());

	it('仅对空数据库创建最终结构，并报告 createdFresh', () => {
		expect(initDb(db)).toEqual({ createdFresh: true });
		expect(names(db, 'table')).toEqual(
			expect.arrayContaining([
				'schema_version',
				'vault_index',
				'scan_state',
				'memory_items',
				'vault_fts',
			]),
		);
		expect(names(db, 'table')).not.toEqual(
			expect.arrayContaining(['session_log', 'session_state', 'session_fts', 'enhance_queue']),
		);
		expect(names(db, 'trigger')).toEqual(
			expect.arrayContaining(['vault_fts_ai', 'vault_fts_ad', 'vault_fts_au']),
		);
		expect(names(db, 'index')).toEqual(
			expect.arrayContaining([
				'idx_vault_index_type_status',
				'idx_vault_index_entity_id',
				'idx_scan_state_last_indexed_at',
				'idx_memory_items_active_scope',
			]),
		);
		const version = db.prepare('SELECT version FROM schema_version').get() as { version: number };
		expect(version.version).toBe(4);
		expect(version.version).toBe(SCHEMA_VERSION);
	});

	it('重复初始化 V4 不改写版本行', () => {
		initDb(db);
		expect(initDb(db)).toEqual({ createdFresh: false });
		expect(db.prepare('SELECT version FROM schema_version').all()).toHaveLength(1);
	});

	it('memory_items 使用稳定 item_id 与 scope/slot 复合唯一键', () => {
		initDb(db);
		const insert = db.prepare(`
			INSERT INTO memory_items(
				slot_key, content, item_kind, scope_type, scope_key, source,
				created_at, updated_at
			) VALUES (?, ?, 'rule', ?, ?, 'preference', ?, ?)
		`);
		const now = '2026-07-21T00:00:00.000Z';
		const global = insert.run('format:answer', '全局简洁', 'global', '', now, now);
		const local = insert.run('format:answer', '项目完整', 'project', 'project-1', now, now);
		expect(Number(global.lastInsertRowid)).toBeGreaterThan(0);
		expect(Number(local.lastInsertRowid)).not.toBe(Number(global.lastInsertRowid));
		expect(() =>
			insert.run('format:answer', '重复项目规则', 'project', 'project-1', now, now),
		).toThrow(/UNIQUE constraint failed/);
	});

	it.each([
		[
			'global scope 带非空 key',
			`INSERT INTO memory_items(slot_key,content,item_kind,scope_type,scope_key,created_at,updated_at)
			 VALUES ('scope:bad','内容','rule','global','x','2026-07-21','2026-07-21')`,
		],
		[
			'非 global scope 缺少 key',
			`INSERT INTO memory_items(slot_key,content,item_kind,scope_type,scope_key,created_at,updated_at)
			 VALUES ('scope:bad','内容','rule','project','','2026-07-21','2026-07-21')`,
		],
		[
			'event 未归档',
			`INSERT INTO memory_items(slot_key,content,item_kind,scope_type,scope_key,created_at,updated_at)
			 VALUES ('event:bad','内容','event','global','','2026-07-21','2026-07-21')`,
		],
		[
			'归档缺少原因',
			`INSERT INTO memory_items(slot_key,content,item_kind,scope_type,scope_key,status,archived_at,created_at,updated_at)
			 VALUES ('archive:bad','内容','rule','global','','archived','2026-07-21','2026-07-21','2026-07-21')`,
		],
		[
			'related_files 不是数组',
			`INSERT INTO memory_items(slot_key,content,item_kind,scope_type,scope_key,related_files,created_at,updated_at)
			 VALUES ('files:bad','内容','rule','global','','{}','2026-07-21','2026-07-21')`,
		],
	] as const)('数据库约束拒绝%s', (_name, sql) => {
		initDb(db);
		expect(() => db.exec(sql)).toThrow(/constraint failed/i);
	});

	it('vault_index 保存 entity_id，且 FTS 触发器同步增删', () => {
		initDb(db);
		db.prepare(`
			INSERT INTO vault_index(file_path,title,type,status,entity_id,search_hints,tags)
			VALUES (?,?,?,?,?,?,?)
		`).run('20_项目/测试.md', '测试项目', 'project', 'active', 'project-1', '唯一检索词', '[]');
		const indexed = db
			.prepare('SELECT file_path FROM vault_fts WHERE vault_fts MATCH ?')
			.all('唯一检索词') as Array<{ file_path: string }>;
		expect(indexed.map((row) => row.file_path)).toEqual(['20_项目/测试.md']);
		expect(
			(db.prepare('SELECT entity_id FROM vault_index').get() as { entity_id: string }).entity_id,
		).toBe('project-1');
		db.prepare('DELETE FROM vault_index WHERE file_path = ?').run('20_项目/测试.md');
		expect(
			db.prepare('SELECT file_path FROM vault_fts WHERE vault_fts MATCH ?').all('唯一检索词'),
		).toHaveLength(0);
	});

	it.each([1, 2, 3])('runtime 拒绝隐式迁移 Schema V%d', (version) => {
		db.exec('CREATE TABLE schema_version(version INTEGER NOT NULL)');
		db.prepare('INSERT INTO schema_version(version) VALUES (?)').run(version);
		expect(() => initDb(db)).toThrow(MigrationRequiredError);
		expect(
			(db.prepare('SELECT version FROM schema_version').get() as { version: number }).version,
		).toBe(version);
	});

	it('拒绝未版本化的非空数据库', () => {
		db.exec('CREATE TABLE foreign_data(value TEXT)');
		expect(() => initDb(db)).toThrow(MigrationRequiredError);
		expect(names(db, 'table')).not.toContain('memory_items');
	});

	it('拒绝伪装成 V4 但缺少关键列或索引的数据库', () => {
		db.exec(`
			CREATE TABLE schema_version(version INTEGER NOT NULL);
			INSERT INTO schema_version(version) VALUES (4);
			CREATE TABLE vault_index(file_path TEXT PRIMARY KEY);
			CREATE TABLE scan_state(file_path TEXT PRIMARY KEY);
			CREATE TABLE memory_items(item_id INTEGER PRIMARY KEY);
			CREATE TABLE vault_fts(value TEXT);
		`);
		expect(() => assertSchemaV4(db)).toThrow(InvalidSchemaError);
		expect(() => initDb(db)).toThrow(InvalidSchemaError);
	});
});

describe('withDb', () => {
	let vault: TempVault;

	beforeEach(() => {
		vault = createTempVault();
	});

	afterEach(() => vault.cleanup());

	it('成功或抛错后都关闭连接', () => {
		let successDb: Database.Database | undefined;
		expect(
			withDb(vault.dbPath, (db) => {
				successDb = db;
				return (db.prepare('SELECT 1 + 1 AS value').get() as { value: number }).value;
			}),
		).toBe(2);
		expect(successDb?.open).toBe(false);

		let failedDb: Database.Database | undefined;
		expect(() =>
			withDb(vault.dbPath, (db) => {
				failedDb = db;
				throw new Error('测试异常');
			}),
		).toThrow('测试异常');
		expect(failedDb?.open).toBe(false);
	});
});
