import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTempVault, type TempVault } from '../setup.js';
import { withDb } from '../../src/db/index.js';
import { initDb, SCHEMA_VERSION } from '../../src/db/schema.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTableNames(db: Database.Database): string[] {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    .all() as Array<{ name: string }>;
  return rows.map(r => r.name);
}

function getTriggerNames(db: Database.Database): string[] {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name`)
    .all() as Array<{ name: string }>;
  return rows.map(r => r.name);
}

function getIndexNames(db: Database.Database): string[] {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='index' ORDER BY name`)
    .all() as Array<{ name: string }>;
  return rows.map(r => r.name);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('initDb', () => {
  let vault: TempVault;
  let db: Database.Database;

  beforeEach(() => {
    vault = createTempVault();
    db = new Database(vault.dbPath);
    db.pragma('journal_mode = WAL');
    initDb(db);
  });

  afterEach(() => {
    db.close();
    vault.cleanup();
  });

  it('creates all expected regular tables', () => {
    const tables = getTableNames(db);
    const expected = [
      'enhance_queue',
      'memory_items',
      'scan_state',
      'schema_version',
      'vault_index',
    ];
    for (const t of expected) {
      expect(tables, `missing table: ${t}`).toContain(t);
    }
    // session_log and session_state should NOT exist in V2
    expect(tables).not.toContain('session_log');
    expect(tables).not.toContain('session_state');
  });

  it('creates FTS5 virtual tables', () => {
    const tables = getTableNames(db);
    expect(tables).toContain('vault_fts');
    // session_fts should NOT exist in V2
    expect(tables).not.toContain('session_fts');
  });

  it('creates FTS5 sync triggers for vault_index', () => {
    const triggers = getTriggerNames(db);
    expect(triggers).toContain('vault_fts_ai');
    expect(triggers).toContain('vault_fts_ad');
    expect(triggers).toContain('vault_fts_au');
  });

  it('creates indexes', () => {
    const indexes = getIndexNames(db);
    const expected = [
      'idx_vault_index_type_status',
      'idx_enhance_queue_status',
      'idx_scan_state_last_indexed_at',
      'idx_memory_items_status',
    ];
    for (const idx of expected) {
      expect(indexes, `missing index: ${idx}`).toContain(idx);
    }
  });

  it('sets schema_version to 2', () => {
    const row = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(row).toBeDefined();
    expect(row.version).toBe(SCHEMA_VERSION);
    expect(row.version).toBe(2);
  });

  it('is idempotent — calling initDb twice does not error or duplicate rows', () => {
    expect(() => initDb(db)).not.toThrow();
    const rows = db.prepare('SELECT version FROM schema_version').all();
    expect(rows).toHaveLength(1);
  });

  it('can insert and query vault_index', () => {
    db.prepare(`
      INSERT INTO vault_index (file_path, title, type, status, tags, search_hints)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('20_项目/test-project.md', 'Test Project', 'project', 'active', '["TypeScript"]', 'test project typescript');

    const row = db.prepare('SELECT * FROM vault_index WHERE file_path = ?').get('20_项目/test-project.md') as {
      file_path: string;
      title: string;
      type: string;
      status: string;
    };
    expect(row).toBeDefined();
    expect(row.title).toBe('Test Project');
    expect(row.type).toBe('project');
    expect(row.status).toBe('active');
  });

  it('vault_fts trigger auto-populates on vault_index insert', () => {
    db.prepare(`
      INSERT INTO vault_index (file_path, title, type, status, tags, search_hints)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('20_项目/fts-test.md', 'FTS Trigger Test', 'project', 'active', '["fts"]', 'fts trigger test');

    const rows = db.prepare(`SELECT file_path FROM vault_fts WHERE vault_fts MATCH ?`).all('trigger') as Array<{ file_path: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].file_path).toBe('20_项目/fts-test.md');
  });

  it('vault_fts delete trigger removes entry on vault_index delete', () => {
    db.prepare(`
      INSERT INTO vault_index (file_path, title, type, status, tags, search_hints)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('20_项目/delete-me.md', 'Delete Me', 'project', 'active', '[]', 'deleteme unique term xyz');

    const before = db.prepare(`SELECT file_path FROM vault_fts WHERE vault_fts MATCH ?`).all('"unique term xyz"') as Array<{ file_path: string }>;
    expect(before.length).toBe(1);

    db.prepare('DELETE FROM vault_index WHERE file_path = ?').run('20_项目/delete-me.md');

    const after = db.prepare(`SELECT file_path FROM vault_fts WHERE vault_fts MATCH ?`).all('"unique term xyz"') as Array<{ file_path: string }>;
    expect(after.length).toBe(0);
  });

  it('memory_items uses slot_key as primary key', () => {
    db.prepare(`
      INSERT INTO memory_items (slot_key, content, source, status, updated_at)
      VALUES (?, ?, 'preference', 'active', ?)
    `).run('format:latex', 'Use LaTeX', new Date().toISOString());

    expect(() => {
      db.prepare(`
        INSERT INTO memory_items (slot_key, content, source, status, updated_at)
        VALUES (?, ?, 'preference', 'active', ?)
      `).run('format:latex', 'Duplicate', new Date().toISOString());
    }).toThrow(/UNIQUE constraint failed/);
  });

  it('memory_items has correct default values', () => {
    db.prepare(`
      INSERT INTO memory_items (slot_key, content, updated_at)
      VALUES (?, ?, ?)
    `).run('format:commit-msg', 'concise messages', '2026-03-26T10:00:00Z');

    const row = db.prepare('SELECT * FROM memory_items WHERE slot_key = ?').get('format:commit-msg') as {
      manual_flag: number;
      status: string;
      source: string;
    };
    expect(row.manual_flag).toBe(0);
    expect(row.status).toBe('active');
    expect(row.source).toBe('preference');
  });

  it('vault_index has project column', () => {
    db.prepare(`
      INSERT INTO vault_index (file_path, title, type, status, project)
      VALUES (?, ?, ?, ?, ?)
    `).run('40_知识/ch1.md', 'Chapter 1', 'note', 'draft', '[[VGT学习]]');

    const row = db.prepare('SELECT project FROM vault_index WHERE file_path = ?').get('40_知识/ch1.md') as { project: string };
    expect(row.project).toBe('[[VGT学习]]');
  });
});

// ─── withDb tests ────────────────────────────────────────────────────────────

describe('withDb', () => {
  let vault: TempVault;

  beforeEach(() => {
    vault = createTempVault();
  });

  afterEach(() => {
    vault.cleanup();
  });

  it('provides a working database connection', () => {
    const result = withDb(vault.dbPath, db => {
      return db.prepare('SELECT 1 + 1 AS result').get() as { result: number };
    });
    expect(result.result).toBe(2);
  });

  it('auto-closes the connection after fn completes', () => {
    let capturedDb: Database.Database | null = null;
    withDb(vault.dbPath, db => {
      capturedDb = db;
    });
    expect(capturedDb).not.toBeNull();
    expect((capturedDb as unknown as Database.Database).open).toBe(false);
  });

  it('auto-closes even if fn throws', () => {
    let capturedDb: Database.Database | null = null;
    expect(() =>
      withDb(vault.dbPath, db => {
        capturedDb = db;
        throw new Error('test error');
      }),
    ).toThrow('test error');
    expect((capturedDb as unknown as Database.Database).open).toBe(false);
  });
});
