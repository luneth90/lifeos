import type Database from 'better-sqlite3';

export const SCHEMA_VERSION = 5;

export interface InitDbResult {
	createdFresh: boolean;
}

export class MigrationRequiredError extends Error {
	constructor(readonly foundVersion: number | null) {
		super(
			foundVersion === null
				? '检测到未版本化的非空数据库；请先运行 lifeos upgrade'
				: `数据库 Schema V${foundVersion} 不能由 runtime 打开；请先运行 lifeos upgrade`,
		);
		this.name = 'MigrationRequiredError';
	}
}

export class InvalidSchemaError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidSchemaError';
	}
}

export function createMemoryItemsTableSql(tableName: 'memory_items' | 'memory_items_v4'): string {
	return `
CREATE TABLE ${tableName} (
    item_id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_key TEXT NOT NULL CHECK (length(trim(slot_key)) > 0),
    content TEXT NOT NULL CHECK (length(trim(content)) > 0),
    item_kind TEXT NOT NULL CHECK (item_kind IN ('rule', 'decision', 'fact', 'profile', 'event')),
    scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'skill', 'project', 'repository', 'tool', 'file')),
    scope_key TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
    enforcement TEXT NOT NULL DEFAULT 'soft' CHECK (enforcement IN ('hard', 'soft')),
    source TEXT NOT NULL DEFAULT 'preference' CHECK (source IN ('preference', 'correction')),
    related_files TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(related_files) AND json_type(related_files) = 'array'),
    manual_flag INTEGER NOT NULL DEFAULT 0 CHECK (manual_flag IN (0, 1)),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT,
    archived_at TEXT,
    archive_reason TEXT,
    CHECK (scope_key = trim(scope_key)),
    CHECK (
        (scope_type = 'global' AND scope_key = '') OR
        (scope_type != 'global' AND length(scope_key) > 0)
    ),
    CHECK (item_kind != 'event' OR status = 'archived'),
    CHECK (
        (status = 'archived' AND archived_at IS NOT NULL AND archive_reason IS NOT NULL
            AND length(trim(archive_reason)) > 0) OR
        (status != 'archived' AND archived_at IS NULL AND archive_reason IS NULL)
    ),
    UNIQUE(scope_type, scope_key, slot_key)
);`;
}

export const MEMORY_ITEMS_V4_INDEX_SQL = `
CREATE INDEX idx_memory_items_active_scope
ON memory_items(
    status, scope_type, scope_key, item_kind,
    enforcement, priority DESC, updated_at DESC
);`;

export function createMemoryItemEventsTableSql(): string {
	return `
CREATE TABLE memory_item_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES memory_items(item_id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'baseline_snapshot', 'create', 'update', 'archive', 'restore', 'reclassify', 'expire'
    )),
    before_json TEXT CHECK (
        before_json IS NULL OR (json_valid(before_json) AND json_type(before_json) = 'object')
    ),
    after_json TEXT CHECK (
        after_json IS NULL OR (json_valid(after_json) AND json_type(after_json) = 'object')
    ),
    reason TEXT CHECK (reason IS NULL OR length(trim(reason)) > 0),
    actor TEXT NOT NULL CHECK (length(trim(actor)) > 0),
    occurred_at TEXT NOT NULL CHECK (length(trim(occurred_at)) > 0),
    contract_version INTEGER NOT NULL CHECK (contract_version = 2),
    correlation_id TEXT NOT NULL CHECK (length(trim(correlation_id)) > 0),
    CHECK (
        (event_type IN ('baseline_snapshot', 'create') AND before_json IS NULL AND after_json IS NOT NULL)
        OR
        (event_type IN ('update', 'archive', 'restore', 'reclassify', 'expire')
            AND before_json IS NOT NULL AND after_json IS NOT NULL)
    )
);`;
}

export const MEMORY_ITEM_EVENTS_V5_INDEX_SQL = `
CREATE INDEX idx_memory_item_events_history
ON memory_item_events(item_id, occurred_at, event_id);

CREATE UNIQUE INDEX idx_memory_item_events_baseline
ON memory_item_events(item_id)
WHERE event_type = 'baseline_snapshot';`;

const FRESH_SCHEMA_SQL = `
CREATE TABLE schema_version (version INTEGER NOT NULL);

CREATE TABLE vault_index (
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
    project TEXT,
    entity_id TEXT
);

CREATE TABLE scan_state (
    file_path TEXT PRIMARY KEY,
    last_seen_hash TEXT,
    last_seen_mtime REAL,
    last_seen_size INTEGER,
    last_indexed_at TEXT
);

${createMemoryItemsTableSql('memory_items')}
${createMemoryItemEventsTableSql()}

CREATE VIRTUAL TABLE vault_fts USING fts5(
    file_path, title, summary, search_hints, tags,
    content='vault_index', content_rowid='rowid'
);

CREATE TRIGGER vault_fts_ai AFTER INSERT ON vault_index BEGIN
    INSERT INTO vault_fts(rowid, file_path, title, summary, search_hints, tags)
    VALUES (new.rowid, new.file_path, new.title, new.summary, new.search_hints, new.tags);
END;
CREATE TRIGGER vault_fts_ad AFTER DELETE ON vault_index BEGIN
    INSERT INTO vault_fts(vault_fts, rowid, file_path, title, summary, search_hints, tags)
    VALUES ('delete', old.rowid, old.file_path, old.title, old.summary, old.search_hints, old.tags);
END;
CREATE TRIGGER vault_fts_au AFTER UPDATE ON vault_index BEGIN
    INSERT INTO vault_fts(vault_fts, rowid, file_path, title, summary, search_hints, tags)
    VALUES ('delete', old.rowid, old.file_path, old.title, old.summary, old.search_hints, old.tags);
    INSERT INTO vault_fts(rowid, file_path, title, summary, search_hints, tags)
    VALUES (new.rowid, new.file_path, new.title, new.summary, new.search_hints, new.tags);
END;

CREATE INDEX idx_vault_index_type_status ON vault_index(type, status);
CREATE INDEX idx_vault_index_entity_id ON vault_index(entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX idx_scan_state_last_indexed_at ON scan_state(last_indexed_at DESC);
${MEMORY_ITEMS_V4_INDEX_SQL}
${MEMORY_ITEM_EVENTS_V5_INDEX_SQL}
`;

const REQUIRED_MEMORY_COLUMNS = [
	'item_id',
	'slot_key',
	'content',
	'item_kind',
	'scope_type',
	'scope_key',
	'priority',
	'enforcement',
	'source',
	'related_files',
	'manual_flag',
	'status',
	'created_at',
	'updated_at',
	'expires_at',
	'archived_at',
	'archive_reason',
] as const;

const REQUIRED_MEMORY_EVENT_COLUMNS = [
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
] as const;

const REQUIRED_VAULT_COLUMNS = [
	'file_path',
	'title',
	'type',
	'status',
	'domain',
	'category',
	'tags',
	'aliases',
	'summary',
	'search_hints',
	'wikilinks',
	'backlinks',
	'section_heads',
	'content_hash',
	'file_size',
	'created_at',
	'modified_at',
	'indexed_at',
	'project',
	'entity_id',
] as const;

const REQUIRED_SCAN_STATE_COLUMNS = [
	'file_path',
	'last_seen_hash',
	'last_seen_mtime',
	'last_seen_size',
	'last_indexed_at',
] as const;

const REQUIRED_FTS_COLUMNS = ['file_path', 'title', 'summary', 'search_hints', 'tags'] as const;

function assertExactColumns(
	db: Database.Database,
	table: string,
	expected: readonly string[],
	schemaVersion: 4 | 5,
): void {
	const actual = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
		(row) => row.name,
	);
	if (actual.length !== expected.length || expected.some((column) => !actual.includes(column))) {
		throw new InvalidSchemaError(`Schema V${schemaVersion} ${table} 列结构不匹配`);
	}
}

function hasCompositeMemoryIdentity(db: Database.Database): boolean {
	const indexes = db.prepare('PRAGMA index_list(memory_items)').all() as Array<{
		name: string;
		unique: number;
	}>;
	return indexes.some((index) => {
		if (index.unique !== 1) return false;
		const columns = db.prepare(`PRAGMA index_info(${index.name})`).all() as Array<{
			seqno: number;
			name: string;
		}>;
		return (
			columns
				.sort((a, b) => a.seqno - b.seqno)
				.map((column) => column.name)
				.join(',') === 'scope_type,scope_key,slot_key'
		);
	});
}

function normalizeSchemaSql(value: string): string {
	return value
		.replace(/["`\[\]]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/;$/, '')
		.toLowerCase();
}

function assertMemoryTableDefinition(db: Database.Database): void {
	const row = db
		.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_items'")
		.get() as { sql?: string } | undefined;
	const expected = normalizeSchemaSql(createMemoryItemsTableSql('memory_items'));
	if (!row?.sql || normalizeSchemaSql(row.sql) !== expected) {
		throw new InvalidSchemaError('Schema V4 memory_items 约束定义不匹配');
	}
}

function assertMemoryEventTableDefinition(db: Database.Database): void {
	const row = db
		.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_item_events'")
		.get() as { sql?: string } | undefined;
	const expected = normalizeSchemaSql(createMemoryItemEventsTableSql());
	if (!row?.sql || normalizeSchemaSql(row.sql) !== expected) {
		throw new InvalidSchemaError('Schema V5 memory_item_events 约束定义不匹配');
	}
}

export function tableExists(db: Database.Database, table: string): boolean {
	return (
		db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !==
		undefined
	);
}

function readSchemaVersion(db: Database.Database): number | null {
	if (!tableExists(db, 'schema_version')) return null;
	const rows = db.prepare('SELECT version FROM schema_version').all() as Array<{
		version: unknown;
	}>;
	if (rows.length !== 1 || !Number.isInteger(rows[0]?.version)) {
		throw new InvalidSchemaError('schema_version 必须且只能包含一个整数版本');
	}
	return rows[0]?.version as number;
}

function isFreshDatabase(db: Database.Database): boolean {
	const row = db
		.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
		.get() as { count: number };
	return row.count === 0;
}

export function assertSchemaV4(db: Database.Database): void {
	const version = readSchemaVersion(db);
	if (version !== 4) throw new MigrationRequiredError(version);
	for (const table of ['vault_index', 'scan_state', 'memory_items', 'vault_fts']) {
		if (!tableExists(db, table)) throw new InvalidSchemaError(`Schema V4 缺少表：${table}`);
	}

	assertExactColumns(db, 'memory_items', REQUIRED_MEMORY_COLUMNS, 4);
	assertExactColumns(db, 'vault_index', REQUIRED_VAULT_COLUMNS, 4);
	assertExactColumns(db, 'scan_state', REQUIRED_SCAN_STATE_COLUMNS, 4);
	assertExactColumns(db, 'vault_fts', REQUIRED_FTS_COLUMNS, 4);
	assertMemoryTableDefinition(db);
	if (!hasCompositeMemoryIdentity(db)) {
		throw new InvalidSchemaError('Schema V4 缺少 memory_items 复合唯一键');
	}
	const index = db
		.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
		.get('idx_memory_items_active_scope');
	if (!index) throw new InvalidSchemaError('Schema V4 缺少 memory_items scope 索引');
	for (const trigger of ['vault_fts_ai', 'vault_fts_ad', 'vault_fts_au']) {
		const exists = db
			.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?")
			.get(trigger);
		if (!exists) throw new InvalidSchemaError(`Schema V4 缺少触发器：${trigger}`);
	}
}

export function assertSchemaV5(db: Database.Database): void {
	const version = readSchemaVersion(db);
	if (version !== SCHEMA_VERSION) throw new MigrationRequiredError(version);
	for (const table of [
		'vault_index',
		'scan_state',
		'memory_items',
		'memory_item_events',
		'vault_fts',
	]) {
		if (!tableExists(db, table)) throw new InvalidSchemaError(`Schema V5 缺少表：${table}`);
	}

	assertExactColumns(db, 'memory_items', REQUIRED_MEMORY_COLUMNS, 5);
	assertExactColumns(db, 'memory_item_events', REQUIRED_MEMORY_EVENT_COLUMNS, 5);
	assertExactColumns(db, 'vault_index', REQUIRED_VAULT_COLUMNS, 5);
	assertExactColumns(db, 'scan_state', REQUIRED_SCAN_STATE_COLUMNS, 5);
	assertExactColumns(db, 'vault_fts', REQUIRED_FTS_COLUMNS, 5);
	assertMemoryTableDefinition(db);
	assertMemoryEventTableDefinition(db);
	if (!hasCompositeMemoryIdentity(db)) {
		throw new InvalidSchemaError('Schema V5 缺少 memory_items 复合唯一键');
	}
	for (const indexName of [
		'idx_memory_items_active_scope',
		'idx_memory_item_events_history',
		'idx_memory_item_events_baseline',
	]) {
		const index = db
			.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
			.get(indexName);
		if (!index) throw new InvalidSchemaError(`Schema V5 缺少索引：${indexName}`);
	}
	const foreignKeys = db.prepare('PRAGMA foreign_key_list(memory_item_events)').all() as Array<{
		table: string;
		from: string;
		to: string;
		on_delete: string;
	}>;
	if (
		!foreignKeys.some(
			(key) =>
				key.table === 'memory_items' &&
				key.from === 'item_id' &&
				key.to === 'item_id' &&
				key.on_delete === 'CASCADE',
		)
	) {
		throw new InvalidSchemaError('Schema V5 缺少 memory_item_events 外键');
	}
	for (const trigger of ['vault_fts_ai', 'vault_fts_ad', 'vault_fts_au']) {
		const exists = db
			.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?")
			.get(trigger);
		if (!exists) throw new InvalidSchemaError(`Schema V5 缺少触发器：${trigger}`);
	}
}

export function initDb(db: Database.Database): InitDbResult {
	const version = readSchemaVersion(db);
	if (version !== null) {
		if (version !== SCHEMA_VERSION) throw new MigrationRequiredError(version);
		assertSchemaV5(db);
		return { createdFresh: false };
	}
	if (!isFreshDatabase(db)) throw new MigrationRequiredError(null);
	const create = db.transaction(() => {
		db.exec(FRESH_SCHEMA_SQL);
		db.prepare('INSERT INTO schema_version(version) VALUES (?)').run(SCHEMA_VERSION);
	});
	create.exclusive();
	assertSchemaV5(db);
	return { createdFresh: true };
}
