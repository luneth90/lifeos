import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MigrationValidationError, migrateToV4 } from '../../src/db/migrations.js';
import { assertSchemaV4 } from '../../src/db/schema.js';

function hash(content: string): string {
	return createHash('sha256').update(content, 'utf8').digest('hex');
}

function createV3(db: Database.Database): void {
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
		CREATE TABLE session_log(id INTEGER PRIMARY KEY, content TEXT);
		CREATE TABLE session_state(session_id TEXT PRIMARY KEY);
		CREATE TABLE enhance_queue(id INTEGER PRIMARY KEY);
	`);
}

describe('显式迁移到 Schema V4', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = new Database(':memory:');
		createV3(db);
	});

	afterEach(() => db.close());

	it('依赖完整 scope map 无损迁移，并返回可核验哈希', () => {
		db.prepare(`
			INSERT INTO memory_items(
				slot_key,content,source,related_files,manual_flag,status,updated_at,expires_at
			) VALUES (?,?,?,?,?,?,?,?)
		`).run(
			'content:language',
			'必须使用中文',
			'correction',
			'["AGENTS.md"]',
			1,
			'active',
			'2026-07-01T00:00:00.000Z',
			null,
		);
		db.prepare(`
			INSERT INTO memory_items(
				slot_key,content,source,related_files,manual_flag,status,updated_at,expires_at
			) VALUES (?,?,?,?,?,?,?,?)
		`).run('decision:retired', '旧项目采用方案甲', 'preference', '[]', 0, 'active', null, null);

		const result = migrateToV4(db, {
			preparedAt: '2026-07-21T00:00:00.000Z',
			scopeMap: [
				{
					legacyIdentity: 'slot:content:language',
					contentHash: hash('必须使用中文'),
					scope: { type: 'global', key: '' },
					itemKind: 'rule',
					priority: 100,
					enforcement: 'hard',
				},
				{
					legacyIdentity: 'slot:decision:retired',
					contentHash: hash('旧项目采用方案甲'),
					scope: { type: 'project', key: 'project-old' },
					itemKind: 'event',
					status: 'archived',
					archivedAt: '2026-07-21T00:00:00.000Z',
					archiveReason: '一次性历史事件',
				},
			],
		});

		expect(result).toMatchObject({
			fromVersion: 3,
			toVersion: 4,
			migrated: true,
			itemCount: 2,
		});
		expect(result.afterHash).toBe(result.beforeHash);
		expect(result.beforeHash).toMatch(/^[0-9a-f]{64}$/);
		expect(() => assertSchemaV4(db)).not.toThrow();
		const rows = db
			.prepare(`
				SELECT slot_key,item_kind,scope_type,scope_key,priority,enforcement,
				       source,status,created_at,archived_at,archive_reason
				FROM memory_items ORDER BY slot_key
			`)
			.all() as Array<Record<string, unknown>>;
		expect(rows).toEqual([
			expect.objectContaining({
				slot_key: 'content:language',
				item_kind: 'rule',
				scope_type: 'global',
				scope_key: '',
				priority: 100,
				enforcement: 'hard',
				source: 'correction',
				status: 'active',
				created_at: '2026-07-01T00:00:00.000Z',
			}),
			expect.objectContaining({
				slot_key: 'decision:retired',
				item_kind: 'event',
				scope_type: 'project',
				scope_key: 'project-old',
				status: 'archived',
				created_at: '2026-07-21T00:00:00.000Z',
				archive_reason: '一次性历史事件',
			}),
		]);
		for (const table of ['session_log', 'session_state', 'enhance_queue']) {
			expect(
				db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),
			).toBeUndefined();
		}
	});

	it('迁移 V4 时幂等校验，不再次重建或接受映射', () => {
		const first = migrateToV4(db, {
			preparedAt: '2026-07-21T00:00:00.000Z',
			scopeMap: [],
		});
		expect(first).toMatchObject({ migrated: true, itemCount: 0 });
		const second = migrateToV4(db, {
			preparedAt: '2026-07-22T00:00:00.000Z',
			scopeMap: [],
		});
		expect(second).toMatchObject({ fromVersion: 4, migrated: false, itemCount: 0 });
		expect(second.beforeHash).toBe(second.afterHash);
	});

	it.each([
		['缺少映射', []],
		[
			'内容哈希不匹配',
			[
				{
					legacyIdentity: 'slot:content:language',
					contentHash: hash('错误内容'),
					scope: { type: 'global' as const, key: '' },
					itemKind: 'rule' as const,
				},
			],
		],
	] as const)('%s 时整笔回滚', (_name, scopeMap) => {
		db.prepare(`
			INSERT INTO memory_items(slot_key,content,source,related_files,status,updated_at)
			VALUES ('content:language','必须使用中文','correction','[]','active','2026-07-01')
		`).run();
		expect(() =>
			migrateToV4(db, {
				preparedAt: '2026-07-21T00:00:00.000Z',
				scopeMap: [...scopeMap],
			}),
		).toThrow(MigrationValidationError);
		expect(
			(db.prepare('SELECT version FROM schema_version').get() as { version: number }).version,
		).toBe(3);
		expect(
			(db.prepare('SELECT content FROM memory_items').get() as { content: string }).content,
		).toBe('必须使用中文');
		expect(
			db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_items_v4'").get(),
		).toBeUndefined();
	});

	it('拒绝 event 的 active 映射和不完整归档元数据', () => {
		db.prepare(`
			INSERT INTO memory_items(slot_key,content,source,related_files,status,updated_at)
			VALUES ('event:legacy','历史事件','preference','[]','active','2026-07-01')
		`).run();
		const common = {
			legacyIdentity: 'slot:event:legacy',
			contentHash: hash('历史事件'),
			scope: { type: 'project' as const, key: 'project-1' },
			itemKind: 'event' as const,
		};
		expect(() =>
			migrateToV4(db, {
				preparedAt: '2026-07-21T00:00:00.000Z',
				scopeMap: [common],
			}),
		).toThrow(/event 必须归档/);
		expect(() =>
			migrateToV4(db, {
				preparedAt: '2026-07-21T00:00:00.000Z',
				scopeMap: [{ ...common, status: 'archived' }],
			}),
		).toThrow(/归档元数据不完整/);
	});
});
