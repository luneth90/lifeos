import type Database from 'better-sqlite3';

export const SCHEMA_VERSION = 2;

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
    indexed_at TEXT,
    project TEXT
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
    slot_key TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    source TEXT DEFAULT 'preference',
    related_files TEXT,
    manual_flag INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    updated_at TEXT,
    expires_at TEXT
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vault_index_type_status ON vault_index (type, status);
CREATE INDEX IF NOT EXISTS idx_enhance_queue_status ON enhance_queue (status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_scan_state_last_indexed_at ON scan_state (last_indexed_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_items_status ON memory_items (status);
`;

/**
 * Check if a column exists in a table.
 */
function columnExists(db: Database.Database, table: string, column: string): boolean {
	const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
	return cols.some((c) => c.name === column);
}

/**
 * Check if a table exists in the database.
 */
function tableExists(db: Database.Database, table: string): boolean {
	const row = db
		.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
		.get(table) as { name: string } | undefined;
	return row !== undefined;
}

/**
 * Migrate from schema V1 to V2.
 * - Reads existing memory_items data
 * - Drops session_log, session_fts, session_state, old memory_items
 * - Creates new memory_items with simplified schema
 * - Re-inserts migrated data
 * - Adds project column to vault_index if missing
 */
function migrateV1toV2(db: Database.Database): void {
	// 1. Read existing memory_items WHERE status='active'
	interface OldMemoryItem {
		slot_key: string;
		content: string;
		section: string;
		related_files: string | null;
		manual_flag: number;
		updated_at: string;
		expires_at: string | null;
	}

	let migratedItems: OldMemoryItem[] = [];
	if (tableExists(db, 'memory_items')) {
		try {
			migratedItems = db
				.prepare(
					`SELECT slot_key, content, section, related_files, manual_flag, updated_at, expires_at
					 FROM memory_items WHERE status = 'active'
					 ORDER BY CASE section WHEN 'corrections' THEN 0 ELSE 1 END`,
				)
				.all() as OldMemoryItem[];
		} catch {
			// Old schema might not have these columns — skip migration data
			migratedItems = [];
		}
	}

	// 2. Drop old tables (order matters for triggers/FTS)
	const dropStatements = [
		// Drop triggers first
		'DROP TRIGGER IF EXISTS session_fts_ai',
		'DROP TRIGGER IF EXISTS session_fts_ad',
		'DROP TRIGGER IF EXISTS session_fts_au',
		// Drop FTS table
		'DROP TABLE IF EXISTS session_fts',
		// Drop indexes
		'DROP INDEX IF EXISTS idx_session_log_time',
		'DROP INDEX IF EXISTS idx_session_log_type',
		'DROP INDEX IF EXISTS idx_session_log_scope',
		'DROP INDEX IF EXISTS idx_session_log_session_id',
		'DROP INDEX IF EXISTS idx_session_log_rule_key',
		'DROP INDEX IF EXISTS idx_session_state_closed_at',
		'DROP INDEX IF EXISTS idx_session_state_last_seen_at',
		'DROP INDEX IF EXISTS idx_memory_items_slot',
		'DROP INDEX IF EXISTS idx_memory_items_target_section_status',
		// Drop tables
		'DROP TABLE IF EXISTS session_log',
		'DROP TABLE IF EXISTS session_state',
		'DROP TABLE IF EXISTS memory_items',
	];

	for (const stmt of dropStatements) {
		db.exec(stmt);
	}

	// 3. Create new memory_items with new schema
	db.exec(`
		CREATE TABLE IF NOT EXISTS memory_items (
			slot_key TEXT PRIMARY KEY,
			content TEXT NOT NULL,
			source TEXT DEFAULT 'preference',
			related_files TEXT,
			manual_flag INTEGER DEFAULT 0,
			status TEXT DEFAULT 'active',
			updated_at TEXT,
			expires_at TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_memory_items_status ON memory_items (status);
	`);

	// 4. Re-insert migrated data
	if (migratedItems.length > 0) {
		const insert = db.prepare(`
			INSERT OR IGNORE INTO memory_items (slot_key, content, source, related_files, manual_flag, status, updated_at, expires_at)
			VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
		`);
		const tx = db.transaction(() => {
			for (const item of migratedItems) {
				// Map old section to new source: corrections→'correction', else 'preference'
				const source = item.section === 'corrections' ? 'correction' : 'preference';
				insert.run(
					item.slot_key,
					item.content,
					source,
					item.related_files,
					item.manual_flag,
					item.updated_at,
					item.expires_at,
				);
			}
		});
		tx();
	}

	// 5. Add project column to vault_index if missing
	if (!columnExists(db, 'vault_index', 'project')) {
		db.exec('ALTER TABLE vault_index ADD COLUMN project TEXT');
	}

	// 6. Update schema_version to 2
	db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION);
}

/**
 * Initialize the database with the V2 schema.
 * Handles migration from V1 if needed.
 * Idempotent — safe to call multiple times.
 */
export function initDb(db: Database.Database): void {
	// Check if schema_version table exists (indicates existing DB)
	const hasSchemaVersion = tableExists(db, 'schema_version');

	if (hasSchemaVersion) {
		const row = db.prepare('SELECT version FROM schema_version').get() as
			| { version: number }
			| undefined;

		if (row && row.version < 2) {
			// Need migration from V1 to V2
			migrateV1toV2(db);
			return;
		}

		if (row && row.version >= 2) {
			// Already at V2 or higher — just ensure all tables exist
			db.exec(SCHEMA_SQL);
			// Ensure project column exists (idempotent)
			if (!columnExists(db, 'vault_index', 'project')) {
				db.exec('ALTER TABLE vault_index ADD COLUMN project TEXT');
			}
			return;
		}
	}

	// Fresh database — create everything from scratch
	db.exec(SCHEMA_SQL);

	const row = db.prepare('SELECT version FROM schema_version').get() as
		| { version: number }
		| undefined;
	if (!row) {
		db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
	}
}
