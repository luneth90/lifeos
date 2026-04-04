import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDb } from '../../src/db/schema.js';
import { upsertRule } from '../../src/services/capture.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function createInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  initDb(db);
  return db;
}

// ─── upsertRule ──────────────────────────────────────────────────────────────

describe('upsertRule', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it('creates a new rule', () => {
    const result = upsertRule(db, {
      slotKey: 'format:latex',
      content: 'Always use LaTeX for math',
    });
    expect(result.slotKey).toBe('format:latex');
    expect(result.action).toBe('created');

    const row = db.prepare('SELECT * FROM memory_items WHERE slot_key = ?').get('format:latex') as any;
    expect(row).toBeDefined();
    expect(row.content).toBe('Always use LaTeX for math');
    expect(row.source).toBe('preference');
    expect(row.status).toBe('active');
  });

  it('updates an existing rule', () => {
    upsertRule(db, { slotKey: 'format:latex', content: 'Original' });
    const result = upsertRule(db, { slotKey: 'format:latex', content: 'Updated' });
    expect(result.action).toBe('updated');

    const row = db.prepare('SELECT * FROM memory_items WHERE slot_key = ?').get('format:latex') as any;
    expect(row.content).toBe('Updated');
  });

  it('does not downgrade correction to preference', () => {
    upsertRule(db, { slotKey: 'content:language', content: 'Use Chinese', source: 'correction' });
    upsertRule(db, { slotKey: 'content:language', content: 'Use Chinese v2', source: 'preference' });

    const row = db.prepare('SELECT * FROM memory_items WHERE slot_key = ?').get('content:language') as any;
    expect(row.source).toBe('correction');
    expect(row.content).toBe('Use Chinese v2');
  });

  it('stores related_files as JSON', () => {
    upsertRule(db, {
      slotKey: 'workflow:tdd',
      content: 'Use TDD',
      relatedFiles: ['src/core.ts', 'src/server.ts'],
    });

    const row = db.prepare('SELECT * FROM memory_items WHERE slot_key = ?').get('workflow:tdd') as any;
    expect(JSON.parse(row.related_files)).toEqual(['src/core.ts', 'src/server.ts']);
  });

  it('stores expires_at', () => {
    upsertRule(db, {
      slotKey: 'temp:setting',
      content: 'Temporary rule',
      expiresAt: '2025-12-31T00:00:00Z',
    });

    const row = db.prepare('SELECT * FROM memory_items WHERE slot_key = ?').get('temp:setting') as any;
    expect(row.expires_at).toBe('2025-12-31T00:00:00Z');
  });

  it('defaults source to preference', () => {
    upsertRule(db, { slotKey: 'format:style', content: 'Keep it simple' });
    const row = db.prepare('SELECT * FROM memory_items WHERE slot_key = ?').get('format:style') as any;
    expect(row.source).toBe('preference');
  });
});
