import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDb } from '../../src/db/schema.js';
import {
  buildMemoryItem,
  upsertMemoryItem,
  cleanupExpiredItems,
  cleanupMemoryItems,
  getActiveMemoryItems,
} from '../../src/active-docs/derived-memory.js';

function createInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  initDb(db);
  return db;
}

describe('buildMemoryItem', () => {
  it('constructs a MemoryItem with correct defaults', () => {
    const item = buildMemoryItem({
      target: 'UserProfile',
      section: 'preferences',
      slotKey: 'format:note-style',
      content: '使用简洁的中文写作风格',
    });

    expect(item.target).toBe('UserProfile');
    expect(item.section).toBe('preferences');
    expect(item.slotKey).toBe('format:note-style');
    expect(item.content).toBe('使用简洁的中文写作风格');
    expect(item.status).toBe('active');
    expect(item.manualFlag).toBe(false);
    expect(item.sourceEventIds).toEqual([]);
    expect(item.itemId).toBeTruthy();
  });

  it('respects provided sourceEventIds and relatedFiles', () => {
    const item = buildMemoryItem({
      target: 'TaskBoard',
      section: 'focus',
      slotKey: 'project:main',
      content: '主要项目',
      sourceEventIds: ['evt-001', 'evt-002'],
      relatedFiles: ['20_项目/ProjectA.md'],
    });

    expect(item.sourceEventIds).toEqual(['evt-001', 'evt-002']);
    expect(item.relatedFiles).toEqual(['20_项目/ProjectA.md']);
  });
});

describe('upsertMemoryItem', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it('inserts a new item and returns item_id', () => {
    const item = buildMemoryItem({
      target: 'UserProfile',
      section: 'preferences',
      slotKey: 'tool:editor',
      content: '使用 VSCode',
    });

    const id = upsertMemoryItem(db, item);
    expect(id).toBeTruthy();

    const row = db
      .prepare('SELECT * FROM memory_items WHERE item_id = ?')
      .get(id) as Record<string, unknown> | undefined;

    expect(row).toBeTruthy();
    expect(row!['content']).toBe('使用 VSCode');
    expect(row!['status']).toBe('active');
  });

  it('updates existing item with same target+section+slot_key', () => {
    const item = buildMemoryItem({
      target: 'UserProfile',
      section: 'preferences',
      slotKey: 'tool:editor',
      content: '使用 VSCode',
    });

    const id1 = upsertMemoryItem(db, item);

    // Upsert with same target+section+slotKey but different content
    const item2 = buildMemoryItem({
      target: 'UserProfile',
      section: 'preferences',
      slotKey: 'tool:editor',
      content: '使用 Neovim',
    });
    const id2 = upsertMemoryItem(db, item2);

    // Should return same item_id
    expect(id2).toBe(id1);

    // Content should be updated
    const row = db
      .prepare('SELECT content FROM memory_items WHERE item_id = ?')
      .get(id1) as { content: string } | undefined;
    expect(row?.content).toBe('使用 Neovim');

    // Only one row should exist
    const count = db
      .prepare("SELECT COUNT(*) as cnt FROM memory_items WHERE target='UserProfile' AND section='preferences' AND slot_key='tool:editor'")
      .get() as { cnt: number };
    expect(count.cnt).toBe(1);
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
    const pastDate = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour ago

    db.prepare(`
      INSERT INTO memory_items
        (item_id, target, section, slot_key, content, manual_flag, status, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, 0, 'active', ?, ?)
    `).run('item-expired', 'UserProfile', 'preferences', 'temp:slot', '临时偏好', new Date().toISOString(), pastDate);

    const result = cleanupExpiredItems(db);
    expect(result.deleted).toBe(1);

    const row = db
      .prepare('SELECT status FROM memory_items WHERE item_id = ?')
      .get('item-expired') as { status: string } | undefined;
    expect(row?.status).toBe('expired');
  });

  it('does not affect non-expired items', () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(); // 1 day from now

    db.prepare(`
      INSERT INTO memory_items
        (item_id, target, section, slot_key, content, manual_flag, status, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, 0, 'active', ?, ?)
    `).run('item-future', 'UserProfile', 'preferences', 'future:slot', '未来偏好', new Date().toISOString(), futureDate);

    const result = cleanupExpiredItems(db);
    expect(result.deleted).toBe(0);
  });

  it('dryRun returns count without deleting', () => {
    const pastDate = new Date(Date.now() - 1000).toISOString();
    db.prepare(`
      INSERT INTO memory_items
        (item_id, target, section, slot_key, content, manual_flag, status, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, 0, 'active', ?, ?)
    `).run('item-dry', 'TaskBoard', 'focus', 'dry:slot', '内容', new Date().toISOString(), pastDate);

    const result = cleanupExpiredItems(db, { dryRun: true });
    expect(result.deleted).toBe(1);

    // Status should remain active
    const row = db
      .prepare('SELECT status FROM memory_items WHERE item_id = ?')
      .get('item-dry') as { status: string } | undefined;
    expect(row?.status).toBe('active');
  });
});

describe('getActiveMemoryItems', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns active items for a target', () => {
    const item1 = buildMemoryItem({ target: 'UserProfile', section: 'preferences', slotKey: 'k1', content: 'v1' });
    const item2 = buildMemoryItem({ target: 'UserProfile', section: 'corrections', slotKey: 'k2', content: 'v2' });
    const item3 = buildMemoryItem({ target: 'TaskBoard', section: 'focus', slotKey: 'k3', content: 'v3' });

    upsertMemoryItem(db, item1);
    upsertMemoryItem(db, item2);
    upsertMemoryItem(db, item3);

    const upItems = getActiveMemoryItems(db, 'UserProfile');
    expect(upItems.length).toBe(2);

    const tbItems = getActiveMemoryItems(db, 'TaskBoard');
    expect(tbItems.length).toBe(1);
  });

  it('filters by section when provided', () => {
    const item1 = buildMemoryItem({ target: 'UserProfile', section: 'preferences', slotKey: 'k1', content: 'v1' });
    const item2 = buildMemoryItem({ target: 'UserProfile', section: 'corrections', slotKey: 'k2', content: 'v2' });
    upsertMemoryItem(db, item1);
    upsertMemoryItem(db, item2);

    const prefItems = getActiveMemoryItems(db, 'UserProfile', 'preferences');
    expect(prefItems.length).toBe(1);
    expect(prefItems[0].section).toBe('preferences');
  });
});

describe('upsertMemoryItem — source_event_ids tracking', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it('appends source_event_ids on update', () => {
    const item1 = buildMemoryItem({
      target: 'UserProfile',
      section: 'preferences',
      slotKey: 'format:note-style',
      content: '使用简洁风格',
      sourceEventIds: ['evt-001'],
    });
    const id = upsertMemoryItem(db, item1);

    const item2 = buildMemoryItem({
      target: 'UserProfile',
      section: 'preferences',
      slotKey: 'format:note-style',
      content: '使用简洁风格（更新）',
      sourceEventIds: ['evt-002'],
    });
    upsertMemoryItem(db, item2);

    const row = db
      .prepare('SELECT source_event_ids FROM memory_items WHERE item_id = ?')
      .get(id) as { source_event_ids: string } | undefined;

    const ids = JSON.parse(row!.source_event_ids);
    expect(ids).toContain('evt-001');
    expect(ids).toContain('evt-002');
    expect(ids).toEqual(['evt-001', 'evt-002']);
  });

  it('caps source_event_ids at 10', () => {
    const existingIds = Array.from({ length: 10 }, (_, i) => `evt-${String(i).padStart(3, '0')}`);

    const item1 = buildMemoryItem({
      target: 'TaskBoard',
      section: 'focus',
      slotKey: 'project:cap-test',
      content: '测试上限',
      sourceEventIds: existingIds,
    });
    const id = upsertMemoryItem(db, item1);

    const item2 = buildMemoryItem({
      target: 'TaskBoard',
      section: 'focus',
      slotKey: 'project:cap-test',
      content: '测试上限（更新）',
      sourceEventIds: ['evt-new'],
    });
    upsertMemoryItem(db, item2);

    const row = db
      .prepare('SELECT source_event_ids FROM memory_items WHERE item_id = ?')
      .get(id) as { source_event_ids: string } | undefined;

    const ids: string[] = JSON.parse(row!.source_event_ids);
    expect(ids.length).toBeLessThanOrEqual(10);
    expect(ids).toContain('evt-new');
  });

  it('deduplicates source_event_ids', () => {
    const item1 = buildMemoryItem({
      target: 'UserProfile',
      section: 'corrections',
      slotKey: 'content:dedup-test',
      content: '去重测试',
      sourceEventIds: ['evt-001'],
    });
    const id = upsertMemoryItem(db, item1);

    const item2 = buildMemoryItem({
      target: 'UserProfile',
      section: 'corrections',
      slotKey: 'content:dedup-test',
      content: '去重测试（更新）',
      sourceEventIds: ['evt-001'],
    });
    upsertMemoryItem(db, item2);

    const row = db
      .prepare('SELECT source_event_ids FROM memory_items WHERE item_id = ?')
      .get(id) as { source_event_ids: string } | undefined;

    const ids: string[] = JSON.parse(row!.source_event_ids);
    const occurrences = ids.filter((x) => x === 'evt-001').length;
    expect(occurrences).toBe(1);
  });
});
