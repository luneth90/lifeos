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
      'session_log',
      'session_state',
      'vault_index',
    ];
    for (const t of expected) {
      expect(tables, `missing table: ${t}`).toContain(t);
    }
  });

  it('creates FTS5 virtual tables', () => {
    const tables = getTableNames(db);
    expect(tables).toContain('vault_fts');
    expect(tables).toContain('session_fts');
  });

  it('creates FTS5 sync triggers for vault_index', () => {
    const triggers = getTriggerNames(db);
    expect(triggers).toContain('vault_fts_ai');
    expect(triggers).toContain('vault_fts_ad');
    expect(triggers).toContain('vault_fts_au');
  });

  it('creates FTS5 sync triggers for session_log', () => {
    const triggers = getTriggerNames(db);
    expect(triggers).toContain('session_fts_ai');
    expect(triggers).toContain('session_fts_ad');
    expect(triggers).toContain('session_fts_au');
  });

  it('creates indexes', () => {
    const indexes = getIndexNames(db);
    const expected = [
      'idx_session_log_time',
      'idx_session_log_type',
      'idx_session_log_scope',
      'idx_session_log_session_id',
      'idx_session_log_rule_key',
      'idx_vault_index_type_status',
      'idx_enhance_queue_status',
      'idx_scan_state_last_indexed_at',
      'idx_memory_items_target_section_status',
      'idx_session_state_closed_at',
      'idx_session_state_last_seen_at',
    ];
    for (const idx of expected) {
      expect(indexes, `missing index: ${idx}`).toContain(idx);
    }
  });

  it('sets schema_version to 1', () => {
    const row = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(row).toBeDefined();
    expect(row.version).toBe(SCHEMA_VERSION);
    expect(row.version).toBe(1);
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

  it('can insert and query session_log', () => {
    db.prepare(`
      INSERT INTO session_log (event_id, session_id, timestamp, entry_type, importance, summary)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('evt-001', 'sess-001', '2026-03-26T10:00:00Z', 'skill_complete', 5, 'Completed /knowledge skill');

    const row = db.prepare('SELECT * FROM session_log WHERE event_id = ?').get('evt-001') as {
      event_id: string;
      session_id: string;
      entry_type: string;
      importance: number;
      summary: string;
    };
    expect(row).toBeDefined();
    expect(row.session_id).toBe('sess-001');
    expect(row.entry_type).toBe('skill_complete');
    expect(row.importance).toBe(5);
    expect(row.summary).toBe('Completed /knowledge skill');
  });

  it('vault_fts trigger auto-populates on vault_index insert', () => {
    db.prepare(`
      INSERT INTO vault_index (file_path, title, type, status, tags, search_hints)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('20_项目/fts-test.md', 'FTS Trigger Test', 'project', 'active', '["fts"]', 'fts trigger test');

    // FTS5 content table search
    const rows = db.prepare(`SELECT file_path FROM vault_fts WHERE vault_fts MATCH ?`).all('trigger') as Array<{ file_path: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].file_path).toBe('20_项目/fts-test.md');
  });

  it('session_fts trigger auto-populates on session_log insert', () => {
    db.prepare(`
      INSERT INTO session_log (event_id, session_id, timestamp, entry_type, importance, summary, search_hints)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('evt-fts-001', 'sess-fts', '2026-03-26T10:00:00Z', 'preference', 3, 'User prefers concise commit messages', 'commit preference concise');

    const rows = db.prepare(`SELECT rowid FROM session_fts WHERE session_fts MATCH ?`).all('concise') as Array<{ rowid: number }>;
    expect(rows.length).toBeGreaterThan(0);
  });

  it('vault_fts delete trigger removes entry on vault_index delete', () => {
    db.prepare(`
      INSERT INTO vault_index (file_path, title, type, status, tags, search_hints)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('20_项目/delete-me.md', 'Delete Me', 'project', 'active', '[]', 'deleteme unique term xyz');

    // Verify it's indexed
    const before = db.prepare(`SELECT file_path FROM vault_fts WHERE vault_fts MATCH ?`).all('"unique term xyz"') as Array<{ file_path: string }>;
    expect(before.length).toBe(1);

    // Delete from vault_index
    db.prepare('DELETE FROM vault_index WHERE file_path = ?').run('20_项目/delete-me.md');

    // Should be removed from FTS
    const after = db.prepare(`SELECT file_path FROM vault_fts WHERE vault_fts MATCH ?`).all('"unique term xyz"') as Array<{ file_path: string }>;
    expect(after.length).toBe(0);
  });

  it('vault_fts update trigger refreshes on vault_index update', () => {
    db.prepare(`
      INSERT INTO vault_index (file_path, title, type, status, tags, search_hints)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('20_项目/update-me.md', 'Before Update', 'project', 'active', '[]', 'beforeterm');

    db.prepare(`UPDATE vault_index SET title = ?, search_hints = ? WHERE file_path = ?`)
      .run('After Update', 'afterterm', '20_项目/update-me.md');

    // Old term should be gone
    const oldRows = db.prepare(`SELECT file_path FROM vault_fts WHERE vault_fts MATCH ?`).all('beforeterm') as Array<{ file_path: string }>;
    expect(oldRows.length).toBe(0);

    // New term should be present
    const newRows = db.prepare(`SELECT file_path FROM vault_fts WHERE vault_fts MATCH ?`).all('afterterm') as Array<{ file_path: string }>;
    expect(newRows.length).toBe(1);
  });

  it('memory_items has unique index on (target, section, slot_key) for active status', () => {
    db.prepare(`
      INSERT INTO memory_items (item_id, target, section, slot_key, content, manual_flag, status, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, 'active', ?)
    `).run('slot-uniq-1', 'UserProfile', 'preferences', 'format:latex', '第一条', new Date().toISOString());

    expect(() => {
      db.prepare(`
        INSERT INTO memory_items (item_id, target, section, slot_key, content, manual_flag, status, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, 'active', ?)
      `).run('slot-uniq-2', 'UserProfile', 'preferences', 'format:latex', '第二条', new Date().toISOString());
    }).toThrow(/UNIQUE constraint failed/);
  });

  it('memory_items has correct default values', () => {
    db.prepare(`
      INSERT INTO memory_items (item_id, target, section, slot_key, content, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('item-001', 'userprofile', 'preferences', 'format:commit-msg', 'concise messages', '2026-03-26T10:00:00Z');

    const row = db.prepare('SELECT * FROM memory_items WHERE item_id = ?').get('item-001') as {
      manual_flag: number;
      status: string;
    };
    expect(row.manual_flag).toBe(0);
    expect(row.status).toBe('active');
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
