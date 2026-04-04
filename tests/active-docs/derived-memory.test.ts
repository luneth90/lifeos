import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupExpiredItems, cleanupMemoryItems } from '../../src/active-docs/derived-memory.js';
import { initDb } from '../../src/db/schema.js';
import { upsertRule } from '../../src/services/capture.js';

function createInMemoryDb(): Database.Database {
	const db = new Database(':memory:');
	db.pragma('journal_mode = WAL');
	initDb(db);
	return db;
}

describe('upsertRule', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = createInMemoryDb();
	});

	afterEach(() => {
		db.close();
	});

	it('inserts a new rule and returns created', () => {
		const result = upsertRule(db, {
			slotKey: 'tool:editor',
			content: '使用 VSCode',
		});

		expect(result.slotKey).toBe('tool:editor');
		expect(result.action).toBe('created');

		const row = db.prepare('SELECT * FROM memory_items WHERE slot_key = ?').get('tool:editor') as
			| Record<string, unknown>
			| undefined;

		expect(row).toBeTruthy();
		expect(row!['content']).toBe('使用 VSCode');
		expect(row!['status']).toBe('active');
		expect(row!['source']).toBe('preference');
	});

	it('updates existing rule with same slot_key', () => {
		upsertRule(db, { slotKey: 'tool:editor', content: '使用 VSCode' });
		const result = upsertRule(db, { slotKey: 'tool:editor', content: '使用 Neovim' });

		expect(result.action).toBe('updated');

		const row = db
			.prepare('SELECT content FROM memory_items WHERE slot_key = ?')
			.get('tool:editor') as { content: string } | undefined;
		expect(row?.content).toBe('使用 Neovim');

		const count = db
			.prepare("SELECT COUNT(*) as cnt FROM memory_items WHERE slot_key = 'tool:editor'")
			.get() as { cnt: number };
		expect(count.cnt).toBe(1);
	});

	it('does not downgrade correction to preference', () => {
		upsertRule(db, { slotKey: 'content:lang', content: '必须用中文', source: 'correction' });
		upsertRule(db, { slotKey: 'content:lang', content: '中文优先', source: 'preference' });

		const row = db
			.prepare('SELECT source, content FROM memory_items WHERE slot_key = ?')
			.get('content:lang') as { source: string; content: string };
		expect(row.source).toBe('correction');
		expect(row.content).toBe('中文优先');
	});

	it('upgrades preference to correction', () => {
		upsertRule(db, { slotKey: 'content:lang', content: '中文优先', source: 'preference' });
		upsertRule(db, { slotKey: 'content:lang', content: '必须用中文', source: 'correction' });

		const row = db
			.prepare('SELECT source FROM memory_items WHERE slot_key = ?')
			.get('content:lang') as { source: string };
		expect(row.source).toBe('correction');
	});
});

describe('cleanupExpiredItems', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = createInMemoryDb();
	});

	afterEach(() => {
		db.close();
	});

	it('marks expired items as expired status', () => {
		const pastDate = new Date(Date.now() - 1000 * 60 * 60).toISOString();

		db.prepare(`
      INSERT INTO memory_items (slot_key, content, source, manual_flag, status, updated_at, expires_at)
      VALUES (?, ?, 'preference', 0, 'active', ?, ?)
    `).run('temp:slot', '临时偏好', new Date().toISOString(), pastDate);

		const result = cleanupExpiredItems(db);
		expect(result.deleted).toBe(1);

		const row = db.prepare('SELECT status FROM memory_items WHERE slot_key = ?').get('temp:slot') as
			| { status: string }
			| undefined;
		expect(row?.status).toBe('expired');
	});

	it('does not affect non-expired items', () => {
		const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();

		db.prepare(`
      INSERT INTO memory_items (slot_key, content, source, manual_flag, status, updated_at, expires_at)
      VALUES (?, ?, 'preference', 0, 'active', ?, ?)
    `).run('future:slot', '未来偏好', new Date().toISOString(), futureDate);

		const result = cleanupExpiredItems(db);
		expect(result.deleted).toBe(0);
	});

	it('dryRun returns count without deleting', () => {
		const pastDate = new Date(Date.now() - 1000).toISOString();
		db.prepare(`
      INSERT INTO memory_items (slot_key, content, source, manual_flag, status, updated_at, expires_at)
      VALUES (?, ?, 'preference', 0, 'active', ?, ?)
    `).run('dry:slot', '内容', new Date().toISOString(), pastDate);

		const result = cleanupExpiredItems(db, { dryRun: true });
		expect(result.deleted).toBe(1);

		const row = db.prepare('SELECT status FROM memory_items WHERE slot_key = ?').get('dry:slot') as
			| { status: string }
			| undefined;
		expect(row?.status).toBe('active');
	});
});

describe('cleanupMemoryItems', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = createInMemoryDb();
	});

	afterEach(() => {
		db.close();
	});

	it('delegates to cleanupExpiredItems', () => {
		const pastDate = new Date(Date.now() - 1000).toISOString();
		db.prepare(`
      INSERT INTO memory_items (slot_key, content, source, manual_flag, status, updated_at, expires_at)
      VALUES (?, ?, 'correction', 0, 'active', ?, ?)
    `).run('cleanup:test', '测试', new Date().toISOString(), pastDate);

		const result = cleanupMemoryItems(db);
		expect(result.deleted).toBe(1);
	});
});
