import type Database from 'better-sqlite3';

export const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_index (
    file_path TEXT PRIMARY KEY,
    title TEXT,
    type TEXT,
    status TEXT,
    domain TEXT,
    category TEXT,
    tags TEXT,
    aliases TEXT,
    summary TEXT,
    semantic_summary TEXT,
    search_hints TEXT,
    wikilinks TEXT,
    backlinks TEXT,
    section_heads TEXT,
    content_hash TEXT,
    file_size INTEGER,
    created_at TEXT,
    modified_at TEXT,
    indexed_at TEXT
);

CREATE TABLE IF NOT EXISTS session_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    importance INTEGER NOT NULL,
    scope TEXT,
    skill_name TEXT,
    summary TEXT NOT NULL,
    detail TEXT,
    source_refs TEXT,
    related_files TEXT,
    related_entities TEXT,
    supersedes TEXT,
    entry_hash TEXT,
    search_hints TEXT,
    rule_key TEXT
);

CREATE TABLE IF NOT EXISTS enhance_queue (
    file_path TEXT PRIMARY KEY,
    priority INTEGER NOT NULL DEFAULT 0,
    queued_at TEXT NOT NULL,
    source TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS scan_state (
    file_path TEXT PRIMARY KEY,
    last_seen_hash TEXT,
    last_seen_mtime REAL,
    last_seen_size INTEGER,
    last_indexed_at TEXT
);

CREATE TABLE IF NOT EXISTS memory_items (
    item_id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    section TEXT NOT NULL,
    slot_key TEXT NOT NULL,
    content TEXT NOT NULL,
    confidence TEXT,
    source_event_ids TEXT,
    source_refs TEXT,
    related_files TEXT,
    manual_flag INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    superseded_by TEXT,
    last_confirmed_at TEXT,
    updated_at TEXT NOT NULL,
    expires_at TEXT
);

CREATE TABLE IF NOT EXISTS session_state (
    session_id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    closed_at TEXT,
    close_status TEXT
);

-- FTS5 virtual tables
CREATE VIRTUAL TABLE IF NOT EXISTS vault_fts USING fts5(
    file_path,
    title,
    summary,
    semantic_summary,
    search_hints,
    tags,
    content='vault_index',
    content_rowid='rowid'
);

CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5(
    summary,
    detail,
    related_entities,
    search_hints,
    content='session_log',
    content_rowid='id'
);

-- FTS5 sync triggers for vault_index
CREATE TRIGGER IF NOT EXISTS vault_fts_ai AFTER INSERT ON vault_index BEGIN
    INSERT INTO vault_fts(rowid, file_path, title, summary, semantic_summary, search_hints, tags)
    VALUES (new.rowid, new.file_path, new.title, new.summary, new.semantic_summary, new.search_hints, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS vault_fts_ad AFTER DELETE ON vault_index BEGIN
    INSERT INTO vault_fts(vault_fts, rowid, file_path, title, summary, semantic_summary, search_hints, tags)
    VALUES ('delete', old.rowid, old.file_path, old.title, old.summary, old.semantic_summary, old.search_hints, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS vault_fts_au AFTER UPDATE ON vault_index BEGIN
    INSERT INTO vault_fts(vault_fts, rowid, file_path, title, summary, semantic_summary, search_hints, tags)
    VALUES ('delete', old.rowid, old.file_path, old.title, old.summary, old.semantic_summary, old.search_hints, old.tags);
    INSERT INTO vault_fts(rowid, file_path, title, summary, semantic_summary, search_hints, tags)
    VALUES (new.rowid, new.file_path, new.title, new.summary, new.semantic_summary, new.search_hints, new.tags);
END;

-- FTS5 sync triggers for session_log
CREATE TRIGGER IF NOT EXISTS session_fts_ai AFTER INSERT ON session_log BEGIN
    INSERT INTO session_fts(rowid, summary, detail, related_entities, search_hints)
    VALUES (new.id, new.summary, new.detail, new.related_entities, new.search_hints);
END;

CREATE TRIGGER IF NOT EXISTS session_fts_ad AFTER DELETE ON session_log BEGIN
    INSERT INTO session_fts(session_fts, rowid, summary, detail, related_entities, search_hints)
    VALUES ('delete', old.id, old.summary, old.detail, old.related_entities, old.search_hints);
END;

CREATE TRIGGER IF NOT EXISTS session_fts_au AFTER UPDATE ON session_log BEGIN
    INSERT INTO session_fts(session_fts, rowid, summary, detail, related_entities, search_hints)
    VALUES ('delete', old.id, old.summary, old.detail, old.related_entities, old.search_hints);
    INSERT INTO session_fts(rowid, summary, detail, related_entities, search_hints)
    VALUES (new.id, new.summary, new.detail, new.related_entities, new.search_hints);
END;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_session_log_time ON session_log (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_session_log_type ON session_log (entry_type);
CREATE INDEX IF NOT EXISTS idx_session_log_scope ON session_log (scope);
CREATE INDEX IF NOT EXISTS idx_session_log_session_id ON session_log (session_id);
CREATE INDEX IF NOT EXISTS idx_session_log_rule_key ON session_log (rule_key);
CREATE INDEX IF NOT EXISTS idx_vault_index_type_status ON vault_index (type, status);
CREATE INDEX IF NOT EXISTS idx_enhance_queue_status ON enhance_queue (status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_scan_state_last_indexed_at ON scan_state (last_indexed_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_items_target_section_status ON memory_items (target, section, status);
CREATE INDEX IF NOT EXISTS idx_session_state_closed_at ON session_state (closed_at);
CREATE INDEX IF NOT EXISTS idx_session_state_last_seen_at ON session_state (last_seen_at DESC);
`;

/**
 * Initialize the database with the V1.0 schema.
 * Idempotent — safe to call multiple times.
 */
export function initDb(db: Database.Database): void {
	db.exec(SCHEMA_SQL);

	const row = db.prepare('SELECT version FROM schema_version').get() as
		| { version: number }
		| undefined;
	if (!row) {
		db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
	}
}
