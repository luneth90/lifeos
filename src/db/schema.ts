import type Database from 'better-sqlite3';

export const SCHEMA_VERSION = 3;

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
    search_hints,
    tags,
    content='vault_index',
    content_rowid='rowid'
);

-- FTS5 sync triggers for vault_index
CREATE TRIGGER IF NOT EXISTS vault_fts_ai AFTER INSERT ON vault_index BEGIN
    INSERT INTO vault_fts(rowid, file_path, title, summary, search_hints, tags)
    VALUES (new.rowid, new.file_path, new.title, new.summary, new.search_hints, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS vault_fts_ad AFTER DELETE ON vault_index BEGIN
    INSERT INTO vault_fts(vault_fts, rowid, file_path, title, summary, search_hints, tags)
    VALUES ('delete', old.rowid, old.file_path, old.title, old.summary, old.search_hints, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS vault_fts_au AFTER UPDATE ON vault_index BEGIN
    INSERT INTO vault_fts(vault_fts, rowid, file_path, title, summary, search_hints, tags)
    VALUES ('delete', old.rowid, old.file_path, old.title, old.summary, old.search_hints, old.tags);
    INSERT INTO vault_fts(rowid, file_path, title, summary, search_hints, tags)
    VALUES (new.rowid, new.file_path, new.title, new.summary, new.search_hints, new.tags);
END;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vault_index_type_status ON vault_index (type, status);
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
	// 1. Read only rule rows (preferences/corrections) from old memory_items
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
					 FROM memory_items
					 WHERE status = 'active' AND section IN ('corrections', 'preferences')
					 ORDER BY CASE section WHEN 'corrections' THEN 0 ELSE 1 END`,
				)
				.all() as OldMemoryItem[];
		} catch {
			// Old schema might not have these columns — skip migration data
			migratedItems = [];
		}
	}

	// 2. Atomic migration: wrap everything in a transaction
	const migrate = db.transaction(() => {
		// Drop old tables (order matters for triggers/FTS)
		const dropStatements = [
			'DROP TRIGGER IF EXISTS session_fts_ai',
			'DROP TRIGGER IF EXISTS session_fts_ad',
			'DROP TRIGGER IF EXISTS session_fts_au',
			'DROP TABLE IF EXISTS session_fts',
			'DROP INDEX IF EXISTS idx_session_log_time',
			'DROP INDEX IF EXISTS idx_session_log_type',
			'DROP INDEX IF EXISTS idx_session_log_scope',
			'DROP INDEX IF EXISTS idx_session_log_session_id',
			'DROP INDEX IF EXISTS idx_session_log_rule_key',
			'DROP INDEX IF EXISTS idx_session_state_closed_at',
			'DROP INDEX IF EXISTS idx_session_state_last_seen_at',
			'DROP INDEX IF EXISTS idx_memory_items_slot',
			'DROP INDEX IF EXISTS idx_memory_items_target_section_status',
			'DROP TABLE IF EXISTS session_log',
			'DROP TABLE IF EXISTS session_state',
			'DROP TABLE IF EXISTS memory_items',
		];

		for (const stmt of dropStatements) {
			db.exec(stmt);
		}

		// Create new memory_items with V2 schema
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

		// Re-insert only rule data (corrections first via ORDER BY, INSERT OR IGNORE keeps first)
		if (migratedItems.length > 0) {
			const insert = db.prepare(`
				INSERT OR IGNORE INTO memory_items (slot_key, content, source, related_files, manual_flag, status, updated_at, expires_at)
				VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
			`);
			for (const item of migratedItems) {
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
		}

		// Add project column to vault_index if missing
		if (!columnExists(db, 'vault_index', 'project')) {
			db.exec('ALTER TABLE vault_index ADD COLUMN project TEXT');
		}

		// Update schema_version
		db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION);
	});

	migrate();
}

/**
 * Migrate from schema V2 to V3.
 * - Drops enhance_queue table and index
 * - Drops semantic_summary column from vault_index (recreates FTS)
 */
function migrateV2toV3(db: Database.Database): void {
	const migrate = db.transaction(() => {
		// Drop enhance_queue
		db.exec('DROP INDEX IF EXISTS idx_enhance_queue_status');
		db.exec('DROP TABLE IF EXISTS enhance_queue');

		// Rebuild FTS without semantic_summary:
		// Drop old triggers and FTS table, then recreate from SCHEMA_SQL
		db.exec('DROP TRIGGER IF EXISTS vault_fts_ai');
		db.exec('DROP TRIGGER IF EXISTS vault_fts_ad');
		db.exec('DROP TRIGGER IF EXISTS vault_fts_au');
		db.exec('DROP TABLE IF EXISTS vault_fts');

		// SQLite cannot drop columns in older versions, but the column
		// being present in vault_index is harmless — it just won't be
		// written to anymore. Recreate FTS and triggers without it.
		db.exec(`
			CREATE VIRTUAL TABLE IF NOT EXISTS vault_fts USING fts5(
				file_path, title, summary, search_hints, tags,
				content='vault_index', content_rowid='rowid'
			);
			CREATE TRIGGER IF NOT EXISTS vault_fts_ai AFTER INSERT ON vault_index BEGIN
				INSERT INTO vault_fts(rowid, file_path, title, summary, search_hints, tags)
				VALUES (new.rowid, new.file_path, new.title, new.summary, new.search_hints, new.tags);
			END;
			CREATE TRIGGER IF NOT EXISTS vault_fts_ad AFTER DELETE ON vault_index BEGIN
				INSERT INTO vault_fts(vault_fts, rowid, file_path, title, summary, search_hints, tags)
				VALUES ('delete', old.rowid, old.file_path, old.title, old.summary, old.search_hints, old.tags);
			END;
			CREATE TRIGGER IF NOT EXISTS vault_fts_au AFTER UPDATE ON vault_index BEGIN
				INSERT INTO vault_fts(vault_fts, rowid, file_path, title, summary, search_hints, tags)
				VALUES ('delete', old.rowid, old.file_path, old.title, old.summary, old.search_hints, old.tags);
				INSERT INTO vault_fts(rowid, file_path, title, summary, search_hints, tags)
				VALUES (new.rowid, new.file_path, new.title, new.summary, new.search_hints, new.tags);
			END;
		`);

		// Rebuild FTS index from existing data
		db.exec("INSERT INTO vault_fts(vault_fts) VALUES('rebuild')");

		// Update schema version
		db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION);
	});

	migrate();
}

/**
 * Initialize the database with the V3 schema.
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
			migrateV1toV2(db);
			// Fall through to V2→V3 check
		}

		// Re-read version after potential V1→V2 migration
		const currentRow = db.prepare('SELECT version FROM schema_version').get() as
			| { version: number }
			| undefined;

		if (currentRow && currentRow.version === 2) {
			migrateV2toV3(db);
			return;
		}

		if (currentRow && currentRow.version >= 3) {
			// Already at V3 or higher — just ensure all tables exist
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
