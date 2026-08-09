import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateToV4, migrateToV5 } from '../../src/db/migrations.js';

function createV4(db: Database.Database): void {
	db.pragma('foreign_keys = ON');
	db.exec(`
		CREATE TABLE schema_version(version INTEGER NOT NULL);
		INSERT INTO schema_version(version) VALUES (3);
		CREATE TABLE vault_index(
			file_path TEXT PRIMARY KEY, title TEXT, type TEXT, status TEXT,
			domain TEXT, category TEXT, tags TEXT, aliases TEXT, summary TEXT,
			search_hints TEXT, wikilinks TEXT, backlinks TEXT, section_heads TEXT,
			content_hash TEXT, file_size INTEGER, created_at TEXT,
			modified_at TEXT, indexed_at TEXT, project TEXT
		);
		CREATE TABLE memory_items(
			slot_key TEXT PRIMARY KEY, content TEXT NOT NULL,
			source TEXT NOT NULL DEFAULT 'preference', related_files TEXT DEFAULT '[]',
			manual_flag INTEGER DEFAULT 0, status TEXT DEFAULT 'active',
			updated_at TEXT, expires_at TEXT
		);
	`);
	migrateToV4(db, { scopeMap: [], preparedAt: '2026-08-08T00:00:00.000Z' });
}

describe('Schema V4 到 V5 迁移', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = new Database(':memory:');
		createV4(db);
	});

	afterEach(() => db.close());

	it('升级版本并为每条现存投影写入唯一 baseline_snapshot', () => {
		db.prepare(`
			INSERT INTO memory_items(
				slot_key, content, item_kind, scope_type, scope_key, priority,
				enforcement, source, related_files, manual_flag, status,
				created_at, updated_at, expires_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			'content:language',
			'必须使用中文',
			'rule',
			'global',
			'',
			100,
			'hard',
			'correction',
			'["AGENTS.md"]',
			1,
			'active',
			'2026-07-01T00:00:00.000Z',
			'2026-07-02T00:00:00.000Z',
			null,
		);

		const result = migrateToV5(db, {
			migratedAt: '2026-08-09T00:00:00.000Z',
			correlationId: 'upgrade:test-v4-v5',
		});

		expect(result).toEqual({
			fromVersion: 4,
			toVersion: 5,
			migrated: true,
			baselineCount: 1,
		});
		expect(
			(db.prepare('SELECT version FROM schema_version').get() as { version: number }).version,
		).toBe(5);
		const event = db.prepare('SELECT * FROM memory_item_events').get() as Record<string, unknown>;
		expect(event).toMatchObject({
			event_id: 1,
			item_id: 1,
			event_type: 'baseline_snapshot',
			before_json: null,
			reason: null,
			actor: 'migration:v4-to-v5',
			occurred_at: '2026-08-09T00:00:00.000Z',
			contract_version: 2,
			correlation_id: 'upgrade:test-v4-v5',
		});
		expect(JSON.parse(String(event.after_json))).toEqual({
			itemId: 1,
			slotKey: 'content:language',
			content: '必须使用中文',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
			priority: 100,
			enforcement: 'hard',
			source: 'correction',
			relatedFiles: ['AGENTS.md'],
			manualFlag: true,
			status: 'active',
			createdAt: '2026-07-01T00:00:00.000Z',
			updatedAt: '2026-07-02T00:00:00.000Z',
			expiresAt: null,
			archivedAt: null,
			archiveReason: null,
		});
	});

	it('建立精确字段、历史索引、唯一 baseline 与级联外键约束', () => {
		migrateToV5(db, {
			migratedAt: '2026-08-09T00:00:00.000Z',
			correlationId: 'upgrade:schema-shape',
		});

		expect(
			(db.prepare('PRAGMA table_info(memory_item_events)').all() as Array<{ name: string }>).map(
				(row) => row.name,
			),
		).toEqual([
			'event_id',
			'item_id',
			'event_type',
			'before_json',
			'after_json',
			'reason',
			'actor',
			'occurred_at',
			'contract_version',
			'correlation_id',
		]);
		const indexes = db.prepare('PRAGMA index_list(memory_item_events)').all() as Array<{
			name: string;
			unique: number;
		}>;
		expect(indexes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: 'idx_memory_item_events_history', unique: 0 }),
				expect.objectContaining({ name: 'idx_memory_item_events_baseline', unique: 1 }),
			]),
		);
		expect(db.prepare('PRAGMA foreign_key_list(memory_item_events)').all()).toEqual([
			expect.objectContaining({
				table: 'memory_items',
				from: 'item_id',
				to: 'item_id',
				on_delete: 'CASCADE',
			}),
		]);
	});

	it('重复升级不重复写入 baseline', () => {
		const first = migrateToV5(db, {
			migratedAt: '2026-08-09T00:00:00.000Z',
			correlationId: 'upgrade:first',
		});
		const second = migrateToV5(db, {
			migratedAt: '2026-08-10T00:00:00.000Z',
			correlationId: 'upgrade:second',
		});

		expect(first).toMatchObject({ migrated: true, baselineCount: 0 });
		expect(second).toEqual({
			fromVersion: 5,
			toVersion: 5,
			migrated: false,
			baselineCount: 0,
		});
		expect(db.prepare('SELECT COUNT(*) AS count FROM memory_item_events').get()).toEqual({
			count: 0,
		});
	});

	it('事件插入失败时回滚事件表与 schema_version', () => {
		db.prepare(`
			INSERT INTO memory_items(
				slot_key, content, item_kind, scope_type, scope_key, priority,
				enforcement, source, related_files, manual_flag, status, created_at, updated_at
			) VALUES ('fact:rollback', '回滚证据', 'fact', 'global', '', 50,
				'soft', 'preference', '[]', 0, 'active', ?, ?)
		`).run('2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z');
		const prepare = db.prepare.bind(db);
		vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
			if (sql.includes('INSERT INTO memory_item_events')) {
				throw new Error('测试注入：事件插入失败');
			}
			return prepare(sql);
		}) as typeof db.prepare);

		expect(() =>
			migrateToV5(db, {
				migratedAt: '2026-08-09T00:00:00.000Z',
				correlationId: 'upgrade:rollback',
			}),
		).toThrow(/事件插入失败/);
		vi.restoreAllMocks();

		expect(
			(db.prepare('SELECT version FROM schema_version').get() as { version: number }).version,
		).toBe(4);
		expect(
			db
				.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_item_events'")
				.get(),
		).toBeUndefined();
		expect(db.prepare('SELECT content FROM memory_items').get()).toEqual({ content: '回滚证据' });
	});
});
